import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from '../components/ui';
import { translations, Language } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';

type ImportProgressState = {
  running: boolean;
  progress: number;
  stage: string;
  startedAt: number;
};

// Sahifalar orasida import holati saqlanadi (module-level singleton)
const sharedImportState: ImportProgressState = {
  running: false,
  progress: 0,
  stage: '',
  startedAt: 0,
};

const STAGE_LABELS: Record<string, Record<Language, string>> = {
  uploading: { uz: 'Fayl yuborilmoqda...', ru: 'Загрузка файла...', en: 'Uploading file...' },
  extracting: { uz: 'Matn ajratilmoqda...', ru: 'Извлечение текста...', en: 'Extracting text...' },
  parsing: { uz: 'Savollar tahlil qilinmoqda...', ru: 'Анализ вопросов...', en: 'Parsing questions...' },
  translating: { uz: 'Tarjima qilinmoqda (UZ/RU/EN)...', ru: 'Перевод (UZ/RU/EN)...', en: 'Translating (UZ/RU/EN)...' },
  saving: { uz: 'Bazaga saqlanmoqda...', ru: 'Сохранение в базу...', en: 'Saving to bank...' },
  done: { uz: 'Tugadi ✓', ru: 'Готово ✓', en: 'Done ✓' },
};

function getStageLabel(elapsed: number, lang: Language): string {
  const key =
    elapsed < 8 ? 'uploading' :
    elapsed < 20 ? 'extracting' :
    elapsed < 50 ? 'parsing' :
    elapsed < 90 ? 'translating' :
    'saving';
  return STAGE_LABELS[key][lang];
}

const SOURCE_LANGUAGE_OPTIONS = [
  { value: 'auto', labelUz: 'Avtomatik aniqlash', labelRu: 'Авто', labelEn: 'Auto-detect' },
  { value: 'uz', labelUz: "O'zbek (lotin)", labelRu: 'Узбекский', labelEn: 'Uzbek' },
  { value: 'ru', labelUz: 'Rus', labelRu: 'Русский', labelEn: 'Russian' },
  { value: 'en', labelUz: 'Ingliz', labelRu: 'Английский', labelEn: 'English' },
];

function getLangLabel(opt: (typeof SOURCE_LANGUAGE_OPTIONS)[0], lang: Language): string {
  if (lang === 'ru') return opt.labelRu;
  if (lang === 'en') return opt.labelEn;
  return opt.labelUz;
}

export function TestBankTab({ token, lang }: { token: string; lang: Language }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [collectionName, setCollectionName] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [smartFile, setSmartFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [smartBusy, setSmartBusy] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStage, setImportStage] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err' | ''; text: string }>({ type: '', text: '' });
  const t = translations[lang];

  const load = async () => {
    const h = { Authorization: `Bearer ${token}` };
    const cRes = await fetch(apiUrl('/api/admin/test-bank/categories'), { headers: h });
    const c = cRes.ok ? await readJsonSafe<any[]>(cRes) : null;
    setCategories(Array.isArray(c) ? c : []);
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    setSmartBusy(sharedImportState.running);
    setImportProgress(sharedImportState.progress);
    setImportStage(sharedImportState.stage);

    const timer = window.setInterval(() => {
      if (!sharedImportState.running) return;
      const elapsed = Math.floor((Date.now() - sharedImportState.startedAt) / 1000);
      // Progress: tezroq boshlanganda sekinroq yetadi 95% ga
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
    if (!confirm(t.testBankCatDeleteConfirm)) return;
    await fetch(apiUrl(`/api/admin/test-bank/categories/${id}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  };

  const importSmart = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });

    const name = collectionName.trim();
    if (!name) {
      setMsg({ type: 'err', text: t.testCollectionNameEn });
      return;
    }
    if (!smartFile) {
      setMsg({ type: 'err', text: t.testBankAiNeedPdf });
      return;
    }
    if (sharedImportState.running) {
      setMsg({ type: 'err', text: lang === 'ru' ? 'Предыдущий анализ ещё не завершён.' : lang === 'en' ? 'Previous import still running.' : 'Oldingi tahlil hali tugamagan.' });
      return;
    }

    const fn = smartFile.name?.toLowerCase() || '';
    if (!fn.endsWith('.pdf') && !fn.endsWith('.docx') && !fn.endsWith('.doc')) {
      setMsg({ type: 'err', text: 'PDF, DOC yoki DOCX' });
      return;
    }

    // Max hajm tekshiruvi (50MB)
    if (smartFile.size > 50 * 1024 * 1024) {
      setMsg({
        type: 'err',
        text: lang === 'ru' ? 'Файл слишком большой (макс. 50 МБ).' : lang === 'en' ? 'File too large (max 50 MB).' : 'Fayl juda katta (maks. 50 MB).',
      });
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

      const res = await fetch(apiUrl('/api/admin/test-bank/import-smart'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const d = await readJsonSafe<{
        error?: string;
        detail?: string;
        inserted?: number;
        detected?: number;
        chunks?: number;
        source_language?: string;
        translation_limited?: boolean;
        ai_skipped_for_size?: boolean;
        categories?: { name: string; questions_added: number }[];
      }>(res);

      if (res.ok && d && typeof d.inserted === 'number') {
        sharedImportState.progress = 100;
        sharedImportState.stage = STAGE_LABELS.done[lang];
        setImportProgress(100);
        setImportStage(STAGE_LABELS.done[lang]);

        const catLines =
          Array.isArray(d.categories) && d.categories.length
            ? d.categories.map((c) => `${c.name}: +${c.questions_added}`).join('; ')
            : '';
        const detectedNote = typeof d.detected === 'number' ? ` · topildi: ${d.detected}` : '';
        const srcLangNote = d.source_language ? ` · til: ${d.source_language}` : '';
        const chunksNote = d.chunks && d.chunks > 1 ? ` · bo'laklari: ${d.chunks}` : '';
        const localNote = d.ai_skipped_for_size ? ' · katta fayl: lokal parser' : '';
        const trNote = d.translation_limited ? ' · tarjima qisman' : '';

        setMsg({
          type: 'ok',
          text: `${t.testBankAiResult.replace('{n}', String(d.inserted))}${detectedNote}${srcLangNote}${catLines ? ` — ${catLines}` : ''}${chunksNote}${localNote}${trNote}`,
        });
        setSmartFile(null);
        setFileKey((k) => k + 1);
        setCollectionName('');
        load();
      } else {
        setMsg({ type: 'err', text: d?.error || d?.detail || 'Import xatosi' });
      }
    } catch {
      setMsg({
        type: 'err',
        text: lang === 'ru' ? 'Ошибка сети или таймаут. Проверьте логи.' : lang === 'en' ? 'Network error or timeout.' : 'Tarmoq xatosi yoki timeout. API/Nginx logini tekshiring.',
      });
    } finally {
      sharedImportState.running = false;
      setSmartBusy(false);
    }
  };

  const anim = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 26 } },
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">{t.testBankPageTitle}</h2>
        <p className="text-sm text-gray-500 max-w-xl mx-auto">{t.testCollectionFileHint}</p>
      </div>

      {msg.text && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-sm px-4 py-3 rounded-2xl border ${
            msg.type === 'ok'
              ? 'bg-green-500/10 border-green-500/20 text-green-800'
              : 'bg-red-500/10 border-red-500/20 text-red-800'
          }`}
        >
          {msg.text}
        </motion.div>
      )}

      {/* Import form */}
      <motion.div variants={anim} initial="hidden" animate="show">
        <Card className="border-violet-200/60 bg-gradient-to-br from-violet-50/40 to-white/30">
          <CardHeader>
            <CardTitle>{t.testBankAiTitle}</CardTitle>
            <p className="text-sm text-gray-500 mt-1">{t.testBankAiHint}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={importSmart} className="space-y-4">
              {/* To'plam nomi */}
              <div>
                <label className="text-xs text-gray-600 block mb-1 font-medium">
                  {t.testCollectionNameEn} *
                </label>
                <Input
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  placeholder={lang === 'ru' ? 'Внутренняя медицина — 2025' : lang === 'en' ? 'Internal Medicine — 2025' : 'Ichki kasalliklar — 2025'}
                  required
                  disabled={smartBusy}
                />
              </div>

              {/* Manba til tanlash */}
              <div>
                <label className="text-xs text-gray-600 block mb-1 font-medium">
                  {lang === 'ru' ? 'Язык документа' : lang === 'en' ? 'Document language' : 'Hujjat tili'}
                </label>
                <select
                  value={sourceLanguage}
                  onChange={(e) => setSourceLanguage(e.target.value)}
                  disabled={smartBusy}
                  className="w-full h-10 rounded-xl border border-gray-200 bg-white/70 px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-400 transition"
                >
                  {SOURCE_LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {getLangLabel(opt, lang)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  {lang === 'ru'
                    ? 'Авто: система определит язык сама. Укажите явно для точности.'
                    : lang === 'en'
                    ? 'Auto: system detects language. Set explicitly for best accuracy.'
                    : "Avtomatik: tizim o'zi aniqlaydi. Aniqroq natija uchun qo'lda belgilang."}
                </p>
              </div>

              {/* Fayl */}
              <div>
                <label className="text-xs text-gray-600 block mb-1 font-medium">
                  {t.testBankAiPdfLabel} *
                </label>
                <Input
                  key={fileKey}
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => setSmartFile(e.target.files?.[0] ?? null)}
                  className="cursor-pointer"
                  disabled={smartBusy}
                />
                <p className="text-xs text-gray-400 mt-1">
                  {lang === 'ru'
                    ? 'PDF, DOCX, DOC · Макс. 50 МБ · PDF до 15 страниц рекомендуется'
                    : lang === 'en'
                    ? 'PDF, DOCX, DOC · Max 50 MB · PDF within 15 pages recommended'
                    : 'PDF, DOCX, DOC · Maks. 50 MB · PDF uchun 15 betgacha tavsiya etiladi'}
                </p>
                {smartFile && (
                  <p className="text-xs text-violet-700 mt-1 font-medium">
                    {smartFile.name} ({(smartFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              <Button type="submit" disabled={smartBusy} className="w-full sm:w-auto">
                {smartBusy ? t.testBankAiRunning : t.testBankAiRun}
              </Button>

              {/* Progress bar */}
              {smartBusy && (
                <div className="pt-2 space-y-2">
                  <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                    <motion.div
                      className="h-2 bg-violet-500 rounded-full"
                      animate={{ width: `${importProgress}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-600">{importStage || t.testBankAiRunning}</p>
                    <p className="text-xs text-violet-600 font-medium">{importProgress}%</p>
                  </div>
                  <p className="text-xs text-gray-400">
                    {lang === 'ru'
                      ? 'Не закрывайте страницу — процесс продолжится.'
                      : lang === 'en'
                      ? 'Do not close the page — import continues in background.'
                      : "Sahifani yopmang — jarayon orqafonda davom etadi."}
                  </p>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </motion.div>

      {/* Kategoriyalar ro'yxati */}
      <motion.div variants={anim} initial="hidden" animate="show">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t.testCollectionsList}</CardTitle>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                {categories.length} {lang === 'ru' ? 'категорий' : lang === 'en' ? 'collections' : 'kategoriya'}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {categories.length === 0 ? (
              <p className="text-gray-500 text-center py-10">{t.testBankNoQuestions}</p>
            ) : (
              <ul className="space-y-4">
                {categories.map((c) => (
                  <li
                    key={c.id}
                    className="p-4 rounded-2xl border border-white/40 bg-white/25 space-y-3"
                  >
                    <div className="flex flex-wrap justify-between gap-2 items-start">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{c.name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-gray-500">
                            {c.question_count ?? 0}{' '}
                            {lang === 'ru' ? 'вопр.' : lang === 'en' ? 'qs' : 'savol'}
                          </span>
                          {c.source_language && (
                            <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                              {c.source_language.toUpperCase()}
                            </span>
                          )}
                          {c.program_track && c.program_track !== 'any' && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              {c.program_track}
                            </span>
                          )}
                          {c.academic_year && (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                              {c.academic_year}{lang === 'ru' ? ' курс' : lang === 'en' ? 'y' : '-kurs'}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 shrink-0"
                        onClick={() => delCategory(c.id)}
                      >
                        {t.testBankDelete}
                      </Button>
                    </div>

                    {/* Tarjima ko'rinishi */}
                    {c.preview && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                        <div className="p-2 rounded-xl bg-white/50 border border-white/40">
                          <span className="font-semibold text-gray-600 block mb-1">
                            EN {!c.preview.text_en && <span className="text-orange-400 font-normal">— yo'q</span>}
                          </span>
                          <p className="text-gray-800 line-clamp-4">
                            {c.preview.text_en || <span className="text-gray-400 italic">tarjima yo'q</span>}
                          </p>
                        </div>
                        <div className="p-2 rounded-xl bg-emerald-50/50 border border-emerald-100">
                          <span className="font-semibold text-emerald-800 block mb-1">
                            UZ {!c.preview.text_uz && <span className="text-orange-400 font-normal">— yo'q</span>}
                          </span>
                          <p className="text-gray-800 line-clamp-4">
                            {c.preview.text_uz || <span className="text-gray-400 italic">tarjima yo'q</span>}
                          </p>
                        </div>
                        <div className="p-2 rounded-xl bg-sky-50/50 border border-sky-100">
                          <span className="font-semibold text-sky-900 block mb-1">
                            RU {!c.preview.text_ru && <span className="text-orange-400 font-normal">— yo'q</span>}
                          </span>
                          <p className="text-gray-800 line-clamp-4">
                            {c.preview.text_ru || <span className="text-gray-400 italic">tarjima yo'q</span>}
                          </p>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
