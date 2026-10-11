import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../i18n';
import { readJsonSafe, checkAdminAuthResponse, fetchWithTimeout } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { authHeaders } from '../lib/uiLangHeader';
import { AdminInput, AdminSelect, AdminField, AdminBtn, AdminCard, AdminAlert, AdminEmpty, AdminFileInput, AdminPageMessageStack, PlusIcon } from './admin/ui';

/* ── Types ── */
type Category = {
  id: number;
  name: string;
  description?: string;
  sort_order?: number;
  question_count?: number;
  source_language?: string;
  program_track?: string;
  academic_year?: number;
  preview?: { text_en: string; text_uz: string; text_ru: string } | null;
};

type Question = {
  id: number;
  category_id: number;
  text: string;
  text_uz: string;
  text_ru: string;
  text_en: string;
  options_json: string;
  options_uz_json: string;
  options_ru_json: string;
  options_en_json: string;
  correct_answer: string;
  correct_answer_uz: string;
  correct_answer_ru: string;
  correct_answer_en: string;
  language: string;
};

/* ── Import progress (singleton across remounts) ── */
type ImportProgressState = { running: boolean; progress: number; stage: string; startedAt: number };
const sharedImportState: ImportProgressState = { running: false, progress: 0, stage: '', startedAt: 0 };

const STAGE_LABELS: Record<string, Record<Language, string>> = {
  uploading:   { uz: 'Fayl yuborilmoqda…',             ru: 'Загрузка файла…',          en: 'Uploading file…' },
  extracting:  { uz: 'Matn ajratilmoqda…',             ru: 'Извлечение текста…',        en: 'Extracting text…' },
  parsing:     { uz: 'Savollar tahlil qilinmoqda…',    ru: 'Анализ вопросов…',          en: 'Parsing questions…' },
  translating: { uz: 'Tarjima qilinmoqda (UZ/RU/EN)…', ru: 'Перевод (UZ/RU/EN)…',     en: 'Translating (UZ/RU/EN)…' },
  saving:      { uz: 'Bazaga saqlanmoqda…',            ru: 'Сохранение в базу…',        en: 'Saving to bank…' },
  done:        { uz: 'Tugadi ✓',                       ru: 'Готово ✓',                  en: 'Done ✓' },
};

function getStageLabel(elapsed: number, lang: Language): string {
  const key = elapsed < 8 ? 'uploading' : elapsed < 20 ? 'extracting' : elapsed < 50 ? 'parsing' : elapsed < 90 ? 'translating' : 'saving';
  return STAGE_LABELS[key][lang];
}

const SOURCE_LANGUAGE_OPTIONS = [
  { value: 'auto', labelUz: 'Avtomatik aniqlash', labelRu: 'Авто',        labelEn: 'Auto-detect' },
  { value: 'uz',   labelUz: "O'zbek (lotin)",      labelRu: 'Узбекский',  labelEn: 'Uzbek' },
  { value: 'ru',   labelUz: 'Rus',                 labelRu: 'Русский',    labelEn: 'Russian' },
  { value: 'en',   labelUz: 'Ingliz',              labelRu: 'Английский', labelEn: 'English' },
];

function getLangLabel(opt: (typeof SOURCE_LANGUAGE_OPTIONS)[0], lang: Language): string {
  if (lang === 'ru') return opt.labelRu;
  if (lang === 'en') return opt.labelEn;
  return opt.labelUz;
}

/* ── Questions panel for a single category ── */
function QuestionsPanel({ catId, lang, token }: { catId: number; lang: Language; token: string }) {
  const t = translations[lang];
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(apiUrl(`/api/admin/test-bank/questions?category_id=${catId}`), {
      headers: authHeaders(token, lang),
    })
      .then(async (r) => {
        if (!checkAdminAuthResponse(r)) { setLoading(false); return; }
        const data = await readJsonSafe<Question[]>(r);
        setQuestions(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [catId, token, lang]);

  const getText = (q: Question) => {
    if (lang === 'uz' && q.text_uz) return q.text_uz;
    if (lang === 'ru' && q.text_ru) return q.text_ru;
    if (lang === 'en' && q.text_en) return q.text_en;
    return q.text_en || q.text || q.text_uz || q.text_ru;
  };

  const getOptions = (q: Question): string[] => {
    try {
      if (lang === 'uz' && q.options_uz_json) return JSON.parse(q.options_uz_json);
      if (lang === 'ru' && q.options_ru_json) return JSON.parse(q.options_ru_json);
      if (lang === 'en' && q.options_en_json) return JSON.parse(q.options_en_json);
      return JSON.parse(q.options_json);
    } catch { return []; }
  };

  const getCorrect = (q: Question) => {
    if (lang === 'uz' && q.correct_answer_uz) return q.correct_answer_uz;
    if (lang === 'ru' && q.correct_answer_ru) return q.correct_answer_ru;
    if (lang === 'en' && q.correct_answer_en) return q.correct_answer_en;
    return q.correct_answer;
  };

  const filtered = searchQ.trim()
    ? questions.filter((q) => getText(q).toLowerCase().includes(searchQ.toLowerCase()))
    : questions;

  if (loading) {
    return (
      <div className="px-5 py-6 flex justify-center">
        <svg className="w-5 h-5 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="px-5 py-4 text-[13px] text-gray-400 italic">{t.testBankNoQuestionsLoaded}</div>
    );
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50/60">
      {/* Search bar */}
      <div className="px-5 py-3 border-b border-gray-100">
        <AdminInput
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder={t.searchQuestions}
          className="h-8 text-[12px] max-w-sm"
        />
        <span className="ml-3 text-[12px] text-gray-400 tabular-nums">
          {filtered.length} / {questions.length}
        </span>
      </div>

      {/* Questions list */}
      <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
        {filtered.map((q, i) => {
          const opts = getOptions(q);
          const correct = getCorrect(q);
          return (
            <motion.div
              key={q.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.01 }}
              className="px-5 py-3.5"
            >
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 text-[11px] font-bold flex items-center justify-center tabular-nums mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-gray-800 leading-snug">{getText(q)}</p>
                  {opts.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-2">
                      {opts.map((opt, oi) => {
                        const letter = String.fromCharCode(65 + oi);
                        const isCorrect = opt === correct || letter === correct || String(oi + 1) === correct;
                        return (
                          <div
                            key={oi}
                            className={`flex items-start gap-1.5 text-[12px] px-2 py-1 rounded-lg ${
                              isCorrect ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-gray-600'
                            }`}
                          >
                            <span className={`shrink-0 font-bold ${isCorrect ? 'text-emerald-600' : 'text-gray-400'}`}>{letter})</span>
                            <span className="leading-snug">{opt}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {correct && opts.length === 0 && (
                    <p className="mt-1.5 text-[12px] text-emerald-700 font-semibold">
                      ✓ {t.testBankCorrectAnswer}: {correct}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main component ── */
interface QualityRow {
  id: number; name: string; total: number; avg_score: number; avg_len: number;
  defects: number; review: number; strong: number; weak: number;
}
interface QualityReport {
  totals: { collections: number; total: number; strong: number; defects: number; review: number };
  categories: QualityRow[];
}

export function TestBankTab({ token, lang }: { token: string; lang: Language }) {
  const t = translations[lang];
  const h = authHeaders(token, lang);
  const trackLabel = (track?: string | null) =>
    track === 'residency' ? t.trackResidency : track === 'master' ? t.trackMaster : t.trackBachelor;

  const [categories, setCategories] = useState<Category[]>([]);
  const [pageMsg, setPageMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Import form state
  const [collectionName, setCollectionName] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [smartFile, setSmartFile] = useState<File | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [smartBusy, setSmartBusy] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStage, setImportStage] = useState('');
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Category delete confirm
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Expanded questions panel
  const [expandedId, setExpandedId] = useState<number | null>(null);

  /* Sifat ko'rsatkichlari: har to'plamda nechta savol imtihonga tayyor
   * (USMLE balli baland va nuqsonsiz), nechtasida apellyatsiyaga sabab
   * bo'luvchi nuqson bor, nechtasini odam ko'rib chiqishi kerak. */
  const [quality, setQuality] = useState<QualityReport | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/test-bank/categories'), { headers: h });
    if (!checkAdminAuthResponse(res)) return;
    const data = await readJsonSafe<Category[]>(res);
    setCategories(Array.isArray(data) ? data : []);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const loadQuality = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/test-bank/quality'), { headers: h });
    if (!checkAdminAuthResponse(res) || !res.ok) return;
    const data = await readJsonSafe<QualityReport>(res);
    if (data && Array.isArray(data.categories)) setQuality(data);
  }, [token]);

  useEffect(() => { loadQuality(); }, [loadQuality]);

  useEffect(() => {
    setSmartBusy(sharedImportState.running);
    setImportProgress(sharedImportState.progress);
    setImportStage(sharedImportState.stage);
    const timer = window.setInterval(() => {
      if (!sharedImportState.running) return;
      const elapsed = Math.floor((Date.now() - sharedImportState.startedAt) / 1000);
      const p = Math.min(95, Math.floor(elapsed * 1.2));
      sharedImportState.progress = p;
      sharedImportState.stage = getStageLabel(elapsed, lang);
      setImportProgress(p);
      setImportStage(sharedImportState.stage);
      setSmartBusy(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lang]);

  const delCategory = async (id: number) => {
    setDeletingId(id);
    const res = await fetch(apiUrl(`/api/admin/test-bank/categories/${id}`), {
      method: 'DELETE', headers: h,
    });
    setDeletingId(null);
    setDeleteConfirmId(null);
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      setPageMsg({ type: 'ok', text: t.testBankDeletedOk });
      setTimeout(() => setPageMsg(null), 3000);
      if (expandedId === id) setExpandedId(null);
      load();
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      setPageMsg({ type: 'err', text: d?.error || t.errorGeneric });
    }
  };

  const importSmart = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportMsg(null);
    const name = collectionName.trim();
    if (!name) { setImportMsg({ type: 'err', text: t.testCollectionNameEn }); return; }
    if (!smartFile) { setImportMsg({ type: 'err', text: t.testBankAiNeedPdf }); return; }
    if (sharedImportState.running) {
      setImportMsg({ type: 'err', text: t.importStillRunning });
      return;
    }
    const fn = smartFile.name?.toLowerCase() || '';
    if (!fn.endsWith('.pdf') && !fn.endsWith('.docx') && !fn.endsWith('.doc')) {
      setImportMsg({ type: 'err', text: t.importAllowedFormats });
      return;
    }
    if (smartFile.size > 50 * 1024 * 1024) {
      setImportMsg({ type: 'err', text: t.importFileTooLarge });
      return;
    }

    setSmartBusy(true);
    sharedImportState.running = true;
    sharedImportState.progress = 3;
    sharedImportState.stage = STAGE_LABELS.uploading[lang];
    sharedImportState.startedAt = Date.now();
    setImportProgress(3);
    setImportStage(sharedImportState.stage);

    try {
      const fd = new FormData();
      fd.append('file', smartFile);
      fd.append('collection_name', name);
      fd.append('language', sourceLanguage);
      // AI (OCR/parse/tarjima) katta fayllarda bir necha daqiqa cho'zilishi mumkin —
      // 8 daqiqa (avvalgi holat: aniq timeout umuman yo'q edi, tarmoq/proksi o'z
      // chegarasida uzib qo'yardi; endi kamida shu vaqtgacha kutamiz).
      const res = await fetchWithTimeout(
        apiUrl('/api/admin/test-bank/import-smart'),
        { method: 'POST', headers: h, body: fd },
        480_000,
      );
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{
        error?: string; detail?: string; inserted?: number; detected?: number;
        chunks?: number; source_language?: string; translation_limited?: boolean;
        ai_skipped_for_size?: boolean; openai_available?: boolean;
        categories?: { name: string; questions_added: number }[];
      }>(res);

      if (res.ok && d && typeof d.inserted === 'number') {
        sharedImportState.progress = 100;
        sharedImportState.stage = STAGE_LABELS.done[lang];
        setImportProgress(100);
        setImportStage(STAGE_LABELS.done[lang]);
        const catLines = Array.isArray(d.categories) && d.categories.length
          ? d.categories.map((c) => `${c.name}: +${c.questions_added}`).join('; ') : '';
        const detectedNote = typeof d.detected === 'number' ? ` · topildi: ${d.detected}` : '';
        const srcLangNote = d.source_language ? ` · til: ${d.source_language}` : '';
        const chunksNote = d.chunks && d.chunks > 1 ? ` · bo'laklari: ${d.chunks}` : '';
        const localNote = d.ai_skipped_for_size ? ' · katta fayl: lokal parser' : '';
        const trNote = d.translation_limited ? ' · tarjima qisman' : '';
        const aiNote = d.openai_available === false ? ' · OpenAI yo\'q: lokal parser' : '';
        setImportMsg({ type: 'ok', text: `${t.testBankAiResult.replace('{n}', String(d.inserted))}${detectedNote}${srcLangNote}${catLines ? ` — ${catLines}` : ''}${chunksNote}${localNote}${trNote}${aiNote}` });
        // Clear form
        setCollectionName('');
        setSmartFile(null);
        setFormKey((k) => k + 1);
        load();
      } else {
        setImportMsg({ type: 'err', text: d?.error || d?.detail || t.importError });
      }
    } catch {
      setImportMsg({ type: 'err', text: t.importNetworkError });
    } finally {
      sharedImportState.running = false;
      setSmartBusy(false);
    }
  };

  const totalQuestions = categories.reduce((s, c) => s + (c.question_count ?? 0), 0);

  return (
    <div className="space-y-5">
      <AdminPageMessageStack
        messages={[pageMsg, importMsg]}
        onDismiss={(m) => {
          if (pageMsg && m.text === pageMsg.text) setPageMsg(null);
          else setImportMsg(null);
        }}
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        {[
          { label: t.bankCollections, value: categories.length, tone: '' },
          { label: t.bankTotalQuestions, value: totalQuestions, tone: '' },
          { label: t.bankStrong, value: quality?.totals.strong ?? '—', tone: 'text-emerald-700' },
          { label: t.bankDefects, value: quality?.totals.defects ?? '—', tone: 'text-red-700' },
          { label: t.bankReview, value: quality?.totals.review ?? '—', tone: 'text-amber-700' },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-lg px-4 py-3.5">
            <p className={`text-[26px] font-semibold leading-none tabular-nums ${s.tone || 'text-gray-900'}`}>{s.value}</p>
            <p className="text-[13px] text-gray-500 mt-1.5">{s.label}</p>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] leading-relaxed text-gray-500">{t.bankQualityHint}</p>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5 items-start">

        {/* ── Import form ── */}
        <AdminCard
          icon={<svg style={{ width: 18, height: 18 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
          title={t.testBankAiTitle}
          subtitle={t.testBankAiHint}
        >
          <div className="px-5 py-4 space-y-4">
            <form key={formKey} onSubmit={importSmart} className="space-y-4">
              <AdminField label={`${t.testCollectionNameEn} *`}>
                <AdminInput
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  placeholder={t.bankCategoryPlaceholder}
                  required
                  disabled={smartBusy}
                />
              </AdminField>

              <AdminField label={t.bankDocLanguage}>
                <AdminSelect value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)} disabled={smartBusy}>
                  {SOURCE_LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{getLangLabel(opt, lang)}</option>
                  ))}
                </AdminSelect>
                <p className="text-[12px] text-gray-400 mt-1">
                  {t.bankAutoDetect}
                </p>
              </AdminField>

              <AdminField label={`${t.testBankAiPdfLabel} *`}>
                <AdminFileInput
                  key={`file-${formKey}`}
                  accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => setSmartFile(e.target.files?.[0] ?? null)}
                  disabled={smartBusy}
                  buttonText={t.filePick}
                  placeholder={t.fileNone}
                />
                <p className="text-[12px] text-gray-400 mt-1">
                  PDF, DOCX, DOC · {t.bankMaxSize}
                </p>
              </AdminField>

              <AdminBtn
                type="submit"
                variant="violet"
                size="lg"
                loading={smartBusy}
                icon={<PlusIcon size={16} />}
                className="w-full"
              >
                {smartBusy ? t.testBankAiRunning : t.testBankAiRun}
              </AdminBtn>

              {/* Progress */}
              {smartBusy && (
                <div className="space-y-2 pt-1">
                  <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden border border-gray-200">
                    <motion.div
                      className="h-full bg-indigo-600 rounded-full"
                      animate={{ width: `${importProgress}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] text-gray-600 font-medium">{importStage || t.testBankAiRunning}</p>
                    <p className="text-[13px] text-indigo-600 font-bold tabular-nums">{importProgress}%</p>
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    {t.bankDontClose}
                  </div>
                </div>
              )}
            </form>
          </div>
        </AdminCard>

        {/* ── Kategoriyalar ── */}
        <AdminCard title={t.testCollectionsList} count={categories.length}>
          <div className="divide-y divide-gray-100">
            {categories.length === 0 ? (
              <AdminEmpty
                icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                title={t.testBankNoQuestions}
                subtitle={t.bankUploadHint}
              />
            ) : categories.map((c, i) => {
              const isDeleteConfirm = deleteConfirmId === c.id;
              const isExpanded = expandedId === c.id;
              return (
                <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  {/* Category row */}
                  <div className={`px-5 py-4 transition-colors ${isDeleteConfirm ? 'bg-red-50/40' : isExpanded ? 'bg-indigo-50/30' : 'hover:bg-gray-50'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-[15px] leading-tight">{c.name}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="text-[12px] font-semibold text-gray-600 bg-gray-100 px-2.5 py-0.5 rounded-md">
                            {c.question_count ?? 0} {t.questionsShort}
                          </span>
                          {c.source_language && (
                            <span className="text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{c.source_language.toUpperCase()}</span>
                          )}
                          {c.program_track && c.program_track !== 'any' && (
                            <span className="text-[11px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">{trackLabel(c.program_track)}</span>
                          )}
                          {c.academic_year && (
                            <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                              {c.academic_year}{t.bankCourseSuffix}
                            </span>
                          )}
                        </div>

                        {/* Sample question preview */}
                        {c.preview && !isExpanded && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                            {[
                              { key: 'text_uz', label: 'UZ', bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-800' },
                              { key: 'text_ru', label: 'RU', bg: 'bg-sky-50 border-sky-100', text: 'text-sky-800' },
                              { key: 'text_en', label: 'EN', bg: 'bg-gray-50 border-gray-100', text: 'text-gray-700' },
                            ].map(({ key, label, bg, text }) => (
                              <div key={key} className={`p-2 rounded-xl border ${bg}`}>
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${text} block mb-1`}>{label}</span>
                                <p className="text-[11px] text-gray-600 line-clamp-2">
                                  {(c.preview as any)[key] || <span className="text-gray-400 italic">—</span>}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 shrink-0">
                        {isDeleteConfirm ? (
                          <>
                            <AdminBtn variant="red" size="sm" loading={deletingId === c.id} onClick={() => delCategory(c.id)}>
                              {t.adminDeleteBtn}
                            </AdminBtn>
                            <AdminBtn variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>
                              {t.cancel}
                            </AdminBtn>
                          </>
                        ) : (
                          <>
                            <AdminBtn
                              variant={isExpanded ? 'blue' : 'ghost'}
                              size="sm"
                              onClick={() => setExpandedId(isExpanded ? null : c.id)}
                            >
                              {isExpanded ? t.testBankHideQuestions : t.testBankViewQuestions}
                            </AdminBtn>
                            <AdminBtn variant="red-ghost" size="sm" onClick={() => { setDeleteConfirmId(c.id); setExpandedId(null); }}>
                              {t.delete}
                            </AdminBtn>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Delete confirm text */}
                    <AnimatePresence>
                      {isDeleteConfirm && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                          <p className="mt-3 text-[13px] font-medium text-red-700">
                            {t.testBankDeleteConfirmText.replace('{name}', c.name)}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Expanded questions panel */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <QuestionsPanel catId={c.id} lang={lang} token={token} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </AdminCard>
      </div>
    </div>
  );
}
