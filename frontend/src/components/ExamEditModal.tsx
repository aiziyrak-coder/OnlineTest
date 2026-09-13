import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { translations, Language } from '../i18n';
import { readJsonSafe, checkAdminAuthResponse } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { authHeaders } from '../lib/uiLangHeader';
import { fromIsoToDatetimeLocal } from '../lib/datetimeLocal';
import { DateTimeField } from './DateTimeField';
import {
  AdminInput,
  AdminSelect,
  AdminField,
  AdminBtn,
  AdminAlert,
  PlusIcon,
} from '../pages/admin/ui';

function toIsoOrNull(localValue: string): string | null {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export type ExamSavedEvent = { examId: number; deleted?: boolean };

type Props = {
  token: string;
  lang: Language;
  examId: number;
  groups: { id: number; name: string; level_name: string }[];
  onClose: () => void;
  onSaved: (ev: ExamSavedEvent) => void;
};

export function ExamEditModal({ token, lang, examId, groups, onClose, onSaved }: Props) {
  const t = translations[lang];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [exam, setExam] = useState<any>(null);
  const [bankCats, setBankCats] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [duration, setDuration] = useState(60);
  const [language, setLanguage] = useState('uz');
  /** Tashqi shovqin nazorati (talabaning o'z nutqiga ta'sir qilmaydi). */
  const [ambientAudioEnabled, setAmbientAudioEnabled] = useState(true);
  const [customRules, setCustomRules] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [questionsJson, setQuestionsJson] = useState('');
  const [selectedBankCats, setSelectedBankCats] = useState<number[]>([]);
  const [bankCount, setBankCount] = useState(12);
  const [exceptions, setExceptions] = useState<{ student_id: string; reason: string }[]>([]);
  const [retakeList, setRetakeList] = useState<
    { id: number; student_id: string; window_start: string; window_end: string; note: string }[]
  >([]);
  const [rtStudent, setRtStudent] = useState('');
  const [rtStart, setRtStart] = useState('');
  const [rtEnd, setRtEnd] = useState('');
  const [rtNote, setRtNote] = useState('');
  const [exBusy, setExBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'main' | 'advanced'>('main');
  /* Imtihon kim uchun: talaba GURUHGA, qolganlari KAFEDRAGA biriktiriladi.
     Ilgari bu oyna faqat talaba imtihonini bilardi -- o'qituvchi yoki
     ordinator imtihonini ochsangiz "Guruh tanlang" deb saqlatmasdi va
     kafedra/fan maydonlari umuman ko'rinmasdi. */
  const [audience, setAudience] = useState('student');
  const [kafedraId, setKafedraId] = useState('');
  const [facultySubject, setFacultySubject] = useState('');
  const [perStudent, setPerStudent] = useState(0);
  const [course, setCourse] = useState(0);
  const [aiCount, setAiCount] = useState(0);
  const [kafedralar, setKafedralar] = useState<{ id: number; name: string }[]>([]);
  const isKafedraAudience = audience !== 'student';
  const AUD_LABEL: Record<string, string> = {
    student: t.examAudienceStudent,
    faculty: t.examAudienceFaculty,
    ordinator: lang === 'ru' ? 'Ordinatory' : lang === 'en' ? 'Residents' : 'Ordinatorlar',
    magistr: lang === 'ru' ? 'Magistry' : lang === 'en' ? 'Masters' : 'Magistrlar',
    vacancy: t.examAudienceVacancy,
    entrant: lang === 'ru' ? 'Osobye postupayushchie' : lang === 'en'
      ? 'Special entrants' : 'Maxsus kiruvchilar',
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(apiUrl(`/api/admin/exams/${examId}`), { headers: authHeaders(token, lang) });
        if (!checkAdminAuthResponse(res)) return;
        const data = await readJsonSafe<any>(res);
        if (!res.ok) throw new Error(data?.error || t.examLoadFailed);
        if (!data) throw new Error(t.loginInvalidServerResponse);
        if (cancelled) return;
        setExam(data);
        setTitle(data.title);
        setStartLocal(fromIsoToDatetimeLocal(data.start_time));
        setEndLocal(fromIsoToDatetimeLocal(data.end_time));
        setDuration(Number(data.duration_minutes) || 60);
        setLanguage(data.language || 'uz');
        setAmbientAudioEnabled(data.ambient_audio_enabled !== false);
        setCustomRules(data.custom_rules || '');
        setSelectedGroups(Array.isArray(data.group_ids) ? data.group_ids : []);
        setQuestionsJson(JSON.stringify(data.questions || [], null, 2));
        setSelectedBankCats(Array.isArray(data.bank_category_ids) ? data.bank_category_ids : []);
        setBankCount(Number(data.bank_question_count) || 12);
        setExceptions(Array.isArray(data.exceptions) ? data.exceptions : []);
        setRetakeList(Array.isArray(data.retake_windows) ? data.retake_windows : []);
        setAudience(String(data.audience || 'student'));
        setKafedraId(data.kafedra_id != null ? String(data.kafedra_id) : '');
        setFacultySubject(String(data.faculty_subject || ''));
        setPerStudent(Number(data.bank_question_count) || 0);
        setCourse(Number(data.course) || 0);
        setAiCount(Number(data.ai_question_count) || 0);
        if (String(data.audience || 'student') !== 'student') {
          const kr = await fetch(apiUrl('/api/admin/kafedralar'), { headers: authHeaders(token, lang) });
          if (kr.ok && !cancelled) {
            const raw = await readJsonSafe<any>(kr);
            const list = Array.isArray(raw) ? raw : (raw && raw.results) || [];
            setKafedralar(list.map((k: any) => ({ id: Number(k.id), name: String(k.name || '') })));
          }
        }
        if (data.exam_mode === 'bank_mixed') {
          const cr = await fetch(apiUrl('/api/admin/test-bank/categories'), { headers: authHeaders(token, lang) });
          if (!checkAdminAuthResponse(cr)) return;
          if (cr.ok && !cancelled) {
            const cats = await readJsonSafe<any[]>(cr);
            setBankCats(Array.isArray(cats) ? cats : []);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || t.errorGeneric);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, token, t]);

  const toggleBankCat = (id: number) => {
    setSelectedBankCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    // Guruh FAQAT talaba imtihonida majburiy.
    if (!isKafedraAudience && selectedGroups.length === 0) {
      setError(t.examCreateSelectGroup);
      return;
    }
    if (isKafedraAudience && !kafedraId) {
      setError(t.examFacultyPickKafedra);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const startIso = toIsoOrNull(startLocal);
      const endIso = toIsoOrNull(endLocal);
      if (!startIso || !endIso) {
        setError(t.examInvalidDateTime);
        setSaving(false);
        return;
      }
      const body: Record<string, unknown> = {
        title,
        start_time: startIso,
        end_time: endIso,
        duration_minutes: duration,
        language,
        ambient_audio_enabled: ambientAudioEnabled,
        custom_rules: customRules,
        group_ids: isKafedraAudience ? [] : selectedGroups,
      };
      if (isKafedraAudience) {
        body.kafedra_id = Number(kafedraId);
        body.faculty_subject = facultySubject.trim();
      }
      if (exam?.exam_mode === 'static' && perStudent > 0) {
        body.bank_question_count = perStudent;
      }
      if (audience === 'ordinator' || audience === 'magistr') {
        body.course = course;
        body.ai_question_count = aiCount;
      }
      if (exam?.exam_mode === 'static') {
        try {
          const parsed = JSON.parse(questionsJson);
          if (Array.isArray(parsed) && parsed.length > 0) body.questions = parsed;
        } catch {
          setError(t.testBankInvalidJson);
          setSaving(false);
          return;
        }
      }
      if (exam?.exam_mode === 'bank_mixed') {
        const selectedPoolCount = bankCats
          .filter((c: any) => selectedBankCats.includes(c.id))
          .reduce((sum: number, c: any) => sum + Math.max(0, Number(c.question_count) || 0), 0);
        if (selectedPoolCount < 1) {
          setError(t.examCreateBankCategoriesEmpty);
          setSaving(false);
          return;
        }
        body.bank_category_ids = selectedBankCats;
        body.bank_question_count = Math.min(
          Math.max(1, Math.min(200, Number(bankCount) || 1)),
          selectedPoolCount,
        );
      }
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify(body),
      });
      if (!checkAdminAuthResponse(res)) return;
      const data = (await readJsonSafe<{ error?: string }>(res)) || {};
      if (!res.ok) throw new Error(data.error || t.examSaveFailed);
      onSaved({ examId });
      onClose();
    } catch (e: any) {
      setError(e.message || t.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

  const saveExceptions = async () => {
    setExBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}/exceptions`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({ items: exceptions }),
      });
      if (!checkAdminAuthResponse(res)) { setExBusy(false); return; }
      const data = (await readJsonSafe<{ error?: string }>(res)) || {};
      if (!res.ok) throw new Error(data.error || t.examSaveFailed);
    } catch (e: any) {
      setError(e.message || t.errorGeneric);
    } finally {
      setExBusy(false);
    }
  };

  const addExceptionRow = () => {
    setExceptions((p) => [...p, { student_id: '', reason: '' }]);
  };

  const addRetake = async () => {
    if (!rtStudent.trim() || !rtStart || !rtEnd) {
      setError(t.retakeWindowNeedFields);
      return;
    }
    setExBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}/retake-windows`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({
          student_id: rtStudent.trim(),
          window_start: new Date(rtStart).toISOString(),
          window_end: new Date(rtEnd).toISOString(),
          note: rtNote,
        }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const data = (await readJsonSafe<{ error?: string; id?: number }>(res)) || {};
      if (!res.ok) throw new Error(data.error || t.examSaveFailed);
      const r2 = await fetch(apiUrl(`/api/admin/exams/${examId}`), { headers: authHeaders(token, lang) });
      if (!checkAdminAuthResponse(r2)) return;
      const ex = await readJsonSafe<any>(r2);
      if (r2.ok && ex?.retake_windows) setRetakeList(ex.retake_windows);
      setRtStudent('');
      setRtNote('');
    } catch (e: any) {
      setError(e.message || t.errorGeneric);
    } finally {
      setExBusy(false);
    }
  };

  const delRetake = async (wid: number) => {
    setExBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}/retake-windows/${wid}`), {
        method: 'DELETE',
        headers: authHeaders(token, lang),
      });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        const data = (await readJsonSafe<{ error?: string }>(res)) || {};
        throw new Error(data.error || t.examDeleteFailed);
      }
      setRetakeList((p) => p.filter((x) => x.id !== wid));
    } catch (e: any) {
      setError(e.message || t.errorGeneric);
    } finally {
      setExBusy(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}`), {
        method: 'DELETE',
        headers: authHeaders(token, lang),
      });
      if (!checkAdminAuthResponse(res)) return;
      const data = (await readJsonSafe<{ error?: string }>(res)) || {};
      if (!res.ok) throw new Error(data.error || t.examDeleteFailed);
      onSaved({ examId, deleted: true });
      onClose();
    } catch (e: any) {
      setError(e.message || t.errorGeneric);
    } finally {
      setSaving(false);
      setDeleteConfirm(false);
    }
  };

  const TAB_LABELS = {
    main:     t.examEditMain,
    advanced: t.examEditAdvanced,
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 bg-gray-900/50 flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ scale: 0.97, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.97, opacity: 0, y: 10 }}
          transition={{ duration: 0.15 }}
          className="w-full max-w-lg bg-white rounded-2xl border border-gray-200 shadow-2xl flex flex-col max-h-[88vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-gray-900">{t.editExam}</h3>
              {exam?.title && <p className="text-[12px] text-gray-400 mt-0.5 truncate">{exam.title}</p>}
            </div>
            <button type="button" onClick={onClose}
              className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors shrink-0">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          {!loading && exam && (
            <div className="flex border-b border-gray-100 shrink-0 px-5">
              {(['main', 'advanced'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`py-2.5 px-1 mr-5 text-[13px] font-semibold border-b-2 transition-colors ${
                    activeTab === tab
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>
          )}

          {/* Scrollable body */}
          <div className="overflow-y-auto flex-1 px-5 py-4">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <svg className="w-6 h-6 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
            )}

            {error && <AdminAlert type="error">{error}</AdminAlert>}

            {!loading && exam && activeTab === 'main' && (
              <div className="space-y-4">
                {/* Title */}
                <AdminField label={t.title} required>
                  <AdminInput value={title} onChange={(e) => setTitle(e.target.value)} />
                </AdminField>

                {/* Start + End */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <AdminField label={t.startTime} required>
                    <DateTimeField value={startLocal} onChange={setStartLocal}
                      dateLabel={t.examDateLabel} timeLabel={t.examTimeLabel} hint={t.dateTimeHint24h} />
                  </AdminField>
                  <AdminField label={t.endTime} required>
                    <DateTimeField value={endLocal} onChange={setEndLocal}
                      min={startLocal || undefined} dateLabel={t.examDateLabel} timeLabel={t.examTimeLabel} hint={t.dateTimeHint24h} />
                  </AdminField>
                </div>

                {/* Duration + Lang + PIN */}
                <div className="grid grid-cols-3 sm:grid-cols-3 gap-3">
                  <AdminField label={`${t.duration} (min)`} required>
                    <AdminInput type="number" min={5} value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))} />
                  </AdminField>
                  <AdminField label={t.language}>
                    <AdminSelect value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <option value="uz">{t.langUzbek}</option>
                      <option value="ru">{t.langRussian}</option>
                      <option value="en">{t.langEnglish}</option>
                    </AdminSelect>
                  </AdminField>
                  <AdminField label={t.ambientAudioLabel}>
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={ambientAudioEnabled}
                        onChange={(e) => setAmbientAudioEnabled(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-gray-800">
                          {ambientAudioEnabled ? t.ambientAudioOn : t.ambientAudioOff}
                        </span>
                        <span className="block text-[12px] text-gray-400 leading-snug mt-0.5">
                          {t.ambientAudioHint}
                        </span>
                      </span>
                    </label>
                  </AdminField>
                </div>

                {/* Kim uchun -- faqat ko'rsatiladi, o'zgartirilmaydi:
                    auditoriya o'zgarsa savol manbasi ham boshqacha bo'ladi. */}
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-gray-500">{t.examAudienceLabel}:</span>
                  <span className="text-[12px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
                    {AUD_LABEL[audience] || audience}
                  </span>
                </div>

                {/* Kafedraga biriktiriladigan auditoriyalar: kafedra + fan */}
                {isKafedraAudience && (
                  <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-3 space-y-3">
                    <AdminField label={t.kafedraLabel} required>
                      <AdminSelect value={kafedraId} onChange={(e) => setKafedraId(e.target.value)}>
                        <option value="">{t.examFacultyPickKafedra}</option>
                        {kafedralar.map((k) => (
                          <option key={k.id} value={String(k.id)}>{k.name}</option>
                        ))}
                      </AdminSelect>
                    </AdminField>
                    <AdminField label={t.imentorSubjectsLabel}>
                      <AdminInput value={facultySubject}
                        onChange={(e) => setFacultySubject(e.target.value)} />
                    </AdminField>
                  </div>
                )}

                {/* Ordinatura kursi — 1-kurs va 2-kurs imtihonlari ajratiladi */}
                {(audience === 'ordinator' || audience === 'magistr') && (
                  <AdminField label={lang === 'ru' ? 'Kurs' : lang === 'en' ? 'Year' : 'Kurs'}>
                    <AdminSelect
                      value={String(course)}
                      onChange={(e) => setCourse(Number(e.target.value) || 0)}
                    >
                      <option value="0">
                        {lang === 'ru' ? 'Vse kursy' : lang === 'en' ? 'All years' : 'Barcha kurslar'}
                      </option>
                      <option value="1">
                        {lang === 'ru' ? '1 kurs' : lang === 'en' ? 'Year 1' : '1-kurs'}
                      </option>
                      <option value="2">
                        {lang === 'ru' ? '2 kurs (DAK)' : lang === 'en' ? 'Year 2 (final)' : '2-kurs (DAK)'}
                      </option>
                    </AdminSelect>
                  </AdminField>
                )}

                {/* Admin yuklagan bankdan har kishiga nechta savol tushishi */}
                {exam.exam_mode === 'static' && (
                  <AdminField label={t.examBankQuestionCount}>
                    <AdminInput type="number" min={0} max={200} value={perStudent}
                      onChange={(e) => setPerStudent(Number(e.target.value) || 0)}
                      className="max-w-[140px]" />
                    {(audience === 'ordinator' || audience === 'magistr') && (
                      <div className="mt-2">
                        <label className="text-[13px] font-medium text-gray-600 block mb-1">
                          {lang === 'ru' ? 'Iz nih sozdayet AI' : lang === 'en'
                            ? 'Of these, generated by AI' : 'Shundan AI yaratadi'}
                        </label>
                        <AdminInput type="number" min={0} max={50} value={aiCount}
                          onChange={(e) => setAiCount(Number(e.target.value) || 0)}
                          className="max-w-[140px]" />
                      </div>
                    )}
                    <p className="text-[12px] text-gray-400 mt-1.5">
                      {lang === 'ru'
                        ? 'Skolko voprosov iz banka poluchit kazhdyy uchastnik. 0 -- ves bank.'
                        : lang === 'en'
                          ? 'How many questions each participant gets from the bank. 0 means the whole bank.'
                          : 'Bankdan har bir topshiruvchiga nechta savol tushadi. 0 bo\'lsa -- butun bank.'}
                    </p>
                  </AdminField>
                )}

                {/* Groups -- faqat talaba imtihonida */}
                {!isKafedraAudience && (
                <div>
                  <label className="text-[13px] font-medium text-gray-600 block mb-2">
                    {t.selectGroups} <span className="text-red-500">*</span>
                  </label>
                  <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[180px] overflow-y-auto">
                    {groups.length === 0 ? (
                      <p className="text-[13px] text-gray-400 text-center py-4">{t.adminNoExamsYet}</p>
                    ) : groups.map((g) => (
                      <label key={g.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer transition-colors border-b border-gray-50 last:border-0">
                        <input
                          type="checkbox"
                          checked={selectedGroups.includes(g.id)}
                          onChange={() => setSelectedGroups((prev) =>
                            prev.includes(g.id) ? prev.filter((x) => x !== g.id) : [...prev, g.id]
                          )}
                          className="w-4 h-4 rounded border-gray-300 accent-indigo-600"
                        />
                        <span className="text-[13px] text-gray-800 font-medium flex-1 truncate">{g.name}</span>
                        {g.level_name && (
                          <span className="text-[11px] text-gray-400 shrink-0">{g.level_name}</span>
                        )}
                      </label>
                    ))}
                  </div>
                  {selectedGroups.length > 0 && (
                    <p className="text-[12px] text-indigo-600 font-semibold mt-1.5">{selectedGroups.length} ta tanlandi</p>
                  )}
                </div>
                )}

                {/* Bank mode */}
                {exam.exam_mode === 'bank_mixed' && (
                  <div className="space-y-3 pt-1">
                    <label className="text-[13px] font-medium text-gray-600 block">{t.bankCategoriesEdit}</label>
                    <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[140px] overflow-y-auto">
                      {bankCats.length === 0 ? (
                        <div className="p-3 text-center text-[13px] text-amber-700 bg-amber-50">{t.testBankNeedFirst}</div>
                      ) : bankCats.map((c: any) => (
                        <label key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0">
                          <input type="checkbox" checked={selectedBankCats.includes(c.id)}
                            onChange={() => toggleBankCat(c.id)}
                            className="w-4 h-4 rounded border-gray-300 accent-violet-600" />
                          <span className="text-[13px] text-gray-800 font-medium flex-1 truncate">{c.name}</span>
                          <span className="text-[11px] font-semibold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded-full shrink-0">{c.question_count ?? 0}</span>
                        </label>
                      ))}
                    </div>
                    <AdminField label={t.examBankQuestionCount} required>
                      <AdminInput type="number" min={1} max={200} value={bankCount}
                        onChange={(e) => setBankCount(Number(e.target.value))} className="max-w-[140px]" />
                    </AdminField>
                  </div>
                )}
              </div>
            )}

            {!loading && exam && activeTab === 'advanced' && (
              <div className="space-y-5">
                {/* Custom rules */}
                <AdminField label={`${t.customRules} (opt.)`}>
                  <textarea value={customRules} onChange={(e) => setCustomRules(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors resize-none"
                  />
                </AdminField>

                {/* Static questions JSON */}
                {exam.exam_mode === 'static' && (
                  <AdminField label={t.examQuestionsJsonHint}>
                    <textarea value={questionsJson} onChange={(e) => setQuestionsJson(e.target.value)}
                      rows={6}
                      className="w-full font-mono text-[11px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors resize-none"
                    />
                  </AdminField>
                )}

                {/* Exceptions */}
                <div className="space-y-3">
                  <div>
                    <p className="text-[13px] font-semibold text-gray-700">{t.exceptionsTitle}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{t.exceptionsHint}</p>
                  </div>
                  {exceptions.map((row, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2">
                      <AdminInput placeholder="student_id" value={row.student_id}
                        onChange={(e) => { const v = e.target.value; setExceptions((p) => p.map((x, j) => j === i ? { ...x, student_id: v } : x)); }} />
                      <AdminInput placeholder={t.exceptionReason} value={row.reason}
                        onChange={(e) => { const v = e.target.value; setExceptions((p) => p.map((x, j) => j === i ? { ...x, reason: v } : x)); }} />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <AdminBtn type="button" variant="ghost" size="sm" icon={<PlusIcon size={13} />} onClick={addExceptionRow}>
                      {t.examAddException}
                    </AdminBtn>
                    <AdminBtn type="button" variant="violet" size="sm" loading={exBusy} onClick={saveExceptions}>
                      {t.examSaveExceptions}
                    </AdminBtn>
                  </div>
                </div>

                {/* Retake windows */}
                <div className="space-y-3 pt-3 border-t border-gray-100">
                  <p className="text-[13px] font-semibold text-gray-700">{t.retakeSectionTitle}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <AdminField label={t.retakeStudent}>
                      <AdminInput value={rtStudent} onChange={(e) => setRtStudent(e.target.value)} />
                    </AdminField>
                    <AdminField label={t.retakeNote}>
                      <AdminInput value={rtNote} onChange={(e) => setRtNote(e.target.value)} />
                    </AdminField>
                    <AdminField label={t.startTime}>
                      <DateTimeField value={rtStart} onChange={setRtStart}
                        dateLabel={t.examDateLabel} timeLabel={t.examTimeLabel} hint={t.dateTimeHint24h} />
                    </AdminField>
                    <AdminField label={t.endTime}>
                      <DateTimeField value={rtEnd} onChange={setRtEnd}
                        min={rtStart || undefined} dateLabel={t.examDateLabel} timeLabel={t.examTimeLabel} hint={t.dateTimeHint24h} />
                    </AdminField>
                  </div>
                  <AdminBtn type="button" variant="ghost" size="sm" loading={exBusy} onClick={addRetake}>
                    {t.retakeAddBtn}
                  </AdminBtn>
                  {retakeList.length > 0 && (
                    <ul className="space-y-1.5 max-h-32 overflow-y-auto">
                      {retakeList.map((rw) => (
                        <li key={rw.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-[12px]">
                          <span className="font-mono font-medium text-gray-700 shrink-0">{rw.student_id}</span>
                          <span className="text-gray-400 truncate flex-1 text-center text-[11px]">
                            {new Date(rw.window_start).toLocaleString()} — {new Date(rw.window_end).toLocaleString()}
                          </span>
                          <button type="button" onClick={() => delRetake(rw.id)}
                            className="w-6 h-6 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors font-bold shrink-0 flex items-center justify-center">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {!loading && exam && (
            <div className="px-5 py-3.5 border-t border-gray-100 shrink-0">
              <AnimatePresence>
                {deleteConfirm && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700 font-medium">
                      {t.confirmDeleteExam}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="flex items-center gap-2">
                {deleteConfirm ? (
                  <>
                    <AdminBtn type="button" variant="red" size="sm" loading={saving} onClick={handleDelete}>
                      {t.adminDeleteBtn}
                    </AdminBtn>
                    <AdminBtn type="button" variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>
                      {t.cancel}
                    </AdminBtn>
                  </>
                ) : (
                  <>
                    <AdminBtn type="button" variant="blue" size="sm" loading={saving} onClick={handleSave}>
                      {t.save}
                    </AdminBtn>
                    <AdminBtn type="button" variant="ghost" size="sm" onClick={onClose}>
                      {t.cancel}
                    </AdminBtn>
                    <AdminBtn type="button" variant="red-ghost" size="sm" className="ml-auto" onClick={() => setDeleteConfirm(true)}>
                      {t.delete}
                    </AdminBtn>
                  </>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
