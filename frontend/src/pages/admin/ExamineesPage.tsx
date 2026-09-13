import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminAlert,
  AdminBtn,
  AdminEmpty,
  AdminInput,
  AdminModal,
  AdminSelect,
  SpinnerIcon,
} from './ui';

/**
 * Ordinatorlar / magistrlar sahifasi.
 *
 * Bu ikki toifa imtihonga TO'LOV asosida kiradi: birinchi urinish ham bepul
 * emas. Shu sabab sahifada har bir kishining yonida "Ruxsat berish" tugmasi
 * turadi — buxgalteriya to'lovni tasdiqlagach admin bosadi va imtihon
 * ochiladi. Tizim aybi bilan uzilgan urinishlar (ban, tugallanmagan test)
 * uchun 3 tagacha BEPUL qayta urinish beriladi, ustunda ko'rinib turadi.
 */

type Role = 'ordinator' | 'magistr' | 'entrant';

interface Session {
  student_exam_id: number;
  exam_id: number;
  exam_title: string;
  status: string;
  score: number | null;
  access_granted: boolean;
  paid_attempts: number;
  tech_retries_used: number;
  tech_retries_left: number;
  served_total: number;
  locked: boolean;
  lock_code: string;
  one_attempt?: boolean;
  ban_reason?: string;
  started_at?: string | null;
  completed_at?: string | null;
  answered?: number;
  total?: number;
  percent?: number | null;
  pass_threshold?: number;
  passed?: boolean;
  warnings?: number;
  violations?: number;
  violation_types?: Record<string, number>;
}

interface Receipt {
  id: number;
  status: string;
  created_at: string;
}

interface Examinee {
  id: string;
  name: string;
  status: string;
  course?: number;
  kafedra_id: number | null;
  kafedra_name: string;
  has_photo: boolean;
  sessions: Session[];
  last_receipt: Receipt | null;
}

interface ExamRow {
  id: number;
  title: string;
  course?: number;
  kafedra_id: number | null;
  kafedra_name: string;
  faculty_subject: string;
  question_count: number;
  per_student: number;
}

interface Payload {
  role: string;
  total: number;
  examinees: Examinee[];
  exams: ExamRow[];
  kafedras: { id: number; name: string }[];
  pending_receipts: number;
}

const TXT: Record<string, Record<string, string>> = {
  uz: {
    ordinator: 'Ordinatorlar', magistr: 'Magistrlar', entrant: 'Maxsus kiruvchilar',
    search: 'F.I.Sh yoki ID boyicha qidirish...', allKaf: 'Barcha kafedralar',
    total: 'Jami', granted: 'Ruxsat berilgan', done: 'Topshirgan', waiting: 'Kvitansiya kutilmoqda',
    name: 'F.I.Sh.', login: 'ID (login)', kafedra: 'Kafedra', exam: 'Imtihon',
    attempts: 'Urinishlar', receipt: 'Kvitansiya', actions: 'Amallar',
    grant: 'Ruxsat berish', revoke: 'Bekor qilish', resetPw: 'Parol', del: 'Ochirish',
    add: 'Yangi qoshish', refresh: 'Yangilash', empty: 'Royxat bosh.',
    noExam: 'imtihon biriktirilmagan', notStarted: 'boshlanmagan',
    locked: 'yopiq', open: 'ochiq', paid: 'pullik urinish', free: 'bepul qayta urinish',
    oneAttempt: '1 urinish', techRetry: 'texnik zaxira (VAC nosozligida)', noRetake: "qayta urinish yo'q",
    stPending: 'kutilmoqda', stProgress: 'topshirmoqda', stDone: 'yakunlangan',
    stBanned: 'chetlatilgan', stFailed: 'yiqilgan', passedL: "O'TDI", failedL: 'YIQILDI',
    answeredL: 'javob', violL: 'qoidabuzarlik', certL: 'Sertifikat', banL: 'Sabab', debtHold: 'Fandan qarzdor — ruxsat berilmagan',
    certErr: 'Sertifikatni olib bolmadi', notDone: 'Test hali yakunlanmagan',
    bank: 'Savol banki', perStudent: 'har kishiga', upload: 'Savollarni yuklash',
    uploadHint: 'PDF, DOCX yoki TXT. Savol matni, A) B) C) D) variantlar va javoblar kaliti bolsin.',
    replace: 'Almashtirish', append: 'Qoshish', save: 'Saqlash', cancel: 'Bekor qilish',
    addTitle: 'Yangi ordinator/magistr', fio: 'F.I.Sh.', idLabel: 'ID (JSHSHIR / login)',
    pwLabel: 'Parol (bosh qoldirilsa login = parol)',
    confirmDel: 'Ochirilsinmi?', questions: 'savol',
    served: 'berilgan savollar', score: 'Ball',
    photo: 'Rasm', photoAdd: 'Rasm yuklash', photoOk: 'rasm bor',
    photoNo: 'rasm yo‘q', photoSaved: 'Rasm saqlandi',
    course: 'Kurs', allCourses: 'Barcha kurslar',
    c1: '1-kurs', c2: '2-kurs', noCourse: 'belgilanmagan',
  },
  ru: {
    ordinator: 'Ordinatory', magistr: 'Magistry', entrant: 'Osobye postupayushchie',
    search: 'Poisk po FIO ili ID...', allKaf: 'Vse kafedry',
    total: 'Vsego', granted: 'Dopushcheno', done: 'Sdali', waiting: 'Zhdut kvitantsiyu',
    name: 'FIO', login: 'ID (login)', kafedra: 'Kafedra', exam: 'Ekzamen',
    attempts: 'Popytki', receipt: 'Kvitantsiya', actions: 'Deystviya',
    grant: 'Dopustit', revoke: 'Otmenit', resetPw: 'Parol', del: 'Udalit',
    add: 'Dobavit', refresh: 'Obnovit', empty: 'Spisok pust.',
    noExam: 'ekzamen ne naznachen', notStarted: 'ne nachat',
    locked: 'zakryt', open: 'otkryt', paid: 'platnaya popytka', free: 'besplatnaya popytka',
    oneAttempt: '1 popytka', techRetry: 'tehnicheskiy rezerv (pri sboe VAC)', noRetake: 'bez povtornoy popytki',
    stPending: 'ozhidaet', stProgress: 'sdaet', stDone: 'zaversheno',
    stBanned: 'otstranyon', stFailed: 'ne sdal', passedL: 'SDAL', failedL: 'NE SDAL',
    answeredL: 'otvetov', violL: 'narusheniy', certL: 'Sertifikat', banL: 'Prichina', debtHold: 'Zadolzhennost po predmetu — dostup zakryt',
    certErr: 'Ne udalos poluchit sertifikat', notDone: 'Test eshchyo ne zavershyon',
    bank: 'Bank voprosov', perStudent: 'na cheloveka', upload: 'Zagruzit voprosy',
    uploadHint: 'PDF, DOCX ili TXT s variantami A) B) C) D) i klyuchom otvetov.',
    replace: 'Zamenit', append: 'Dobavit', save: 'Sohranit', cancel: 'Otmena',
    addTitle: 'Novyy ordinator/magistr', fio: 'FIO', idLabel: 'ID (login)',
    pwLabel: 'Parol (pusto = login)',
    confirmDel: 'Udalit?', questions: 'voprosov',
    served: 'vydano voprosov', score: 'Ball',
    photo: 'Foto', photoAdd: 'Zagruzit foto', photoOk: 'foto yest',
    photoNo: 'net foto', photoSaved: 'Foto sohraneno',
    course: 'Kurs', allCourses: 'Vse kursy',
    c1: '1 kurs', c2: '2 kurs', noCourse: 'ne ukazan',
  },
  en: {
    ordinator: 'Residents', magistr: "Master's students", entrant: 'Special entrants',
    search: 'Search by name or ID...', allKaf: 'All departments',
    total: 'Total', granted: 'Granted', done: 'Completed', waiting: 'Awaiting receipt',
    name: 'Full name', login: 'ID (login)', kafedra: 'Department', exam: 'Exam',
    attempts: 'Attempts', receipt: 'Receipt', actions: 'Actions',
    grant: 'Grant access', revoke: 'Revoke', resetPw: 'Password', del: 'Delete',
    add: 'Add new', refresh: 'Refresh', empty: 'Nothing here yet.',
    noExam: 'no exam assigned', notStarted: 'not started',
    locked: 'locked', open: 'open', paid: 'paid attempt', free: 'free retry',
    oneAttempt: '1 attempt', techRetry: 'technical reserve (on VAC failure)', noRetake: 'no retake',
    stPending: 'pending', stProgress: 'in progress', stDone: 'completed',
    stBanned: 'removed', stFailed: 'failed', passedL: 'PASSED', failedL: 'FAILED',
    answeredL: 'answered', violL: 'violations', certL: 'Certificate', banL: 'Reason', debtHold: 'Subject debt — access withheld',
    certErr: 'Could not get the certificate', notDone: 'Test not completed yet',
    bank: 'Question bank', perStudent: 'per person', upload: 'Upload questions',
    uploadHint: 'PDF, DOCX or TXT with A) B) C) D) options and an answer key.',
    replace: 'Replace', append: 'Append', save: 'Save', cancel: 'Cancel',
    addTitle: 'New resident / master student', fio: 'Full name', idLabel: 'ID (login)',
    pwLabel: 'Password (empty = login)',
    confirmDel: 'Delete?', questions: 'questions',
    served: 'questions served', score: 'Score',
    photo: 'Photo', photoAdd: 'Upload photo', photoOk: 'has photo',
    photoNo: 'no photo', photoSaved: 'Photo saved',
    course: 'Year', allCourses: 'All years',
    c1: 'Year 1', c2: 'Year 2', noCourse: 'not set',
  },
};

const Stat = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
  <div className={`rounded-xl border px-4 py-3 ${tone}`}>
    <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
    <p className="text-2xl font-bold tabular-nums leading-tight mt-0.5">{value}</p>
  </div>
);

export function ExamineesPage({
  token,
  lang,
  role,
}: {
  token: string;
  lang: Language;
  role: Role;
}) {
  const T = TXT[lang] ?? TXT.uz;
  const h = useMemo(() => authHeaders(token, lang), [token, lang]);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'error' | 'success' | 'warning'; text: string } | null>(null);
  const [q, setQ] = useState('');
  const [kafFilter, setKafFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [busyId, setBusyId] = useState('');
  const [photoBusy, setPhotoBusy] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [nf, setNf] = useState({
    id: '', name: '', kafedra_id: '', password: '', course: '1',
  });

  const [bankExam, setBankExam] = useState<ExamRow | null>(null);
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [bankMode, setBankMode] = useState<'replace' | 'append'>('replace');
  const [bankPer, setBankPer] = useState('20');
  const [bankBusy, setBankBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/examinees?role=${role}`), { headers: h });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<Payload>(res);
      if (j) setData(j);
    } catch {
      setMsg({ type: 'error', text: 'Server bilan aloqa yoq' });
    } finally {
      setLoading(false);
    }
  }, [h, role]);

  useEffect(() => {
    setQ('');
    setKafFilter('');
    load();
  }, [load]);

  const kafedras = useMemo(
    () => (data?.kafedras ?? []).map((k) => [k.id, k.name] as [number, string]),
    [data],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.examinees ?? []).filter((e) => {
      if (kafFilter && String(e.kafedra_id ?? '') !== kafFilter) return false;
      if (courseFilter && String(e.course ?? 0) !== courseFilter) return false;
      if (!needle) return true;
      return e.name.toLowerCase().includes(needle) || e.id.toLowerCase().includes(needle);
    });
  }, [data, q, kafFilter]);

  const stats = useMemo(() => {
    const all = data?.examinees ?? [];
    let granted = 0;
    let done = 0;
    all.forEach((e) => {
      if (e.sessions.some((s) => s.access_granted)) granted += 1;
      if (e.sessions.some((s) => s.status === 'Completed')) done += 1;
    });
    return { total: all.length, granted, done, waiting: data?.pending_receipts ?? 0 };
  }, [data]);

  const post = async (url: string, body?: unknown, method = 'POST') => {
    const res = await fetch(apiUrl(url), {
      method,
      headers: { 'Content-Type': 'application/json', ...h },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!checkAdminAuthResponse(res)) return null;
    const j = await readJsonSafe<Record<string, unknown>>(res);
    if (!res.ok) {
      setMsg({ type: 'error', text: String(j?.error ?? 'Xatolik') });
      return null;
    }
    return j ?? {};
  };

  const grant = async (e: Examinee, examId?: number) => {
    setBusyId(e.id);
    const j = await post(`/api/admin/examinees/${encodeURIComponent(e.id)}/grant-access`, {
      exam_id: examId ?? e.sessions[0]?.exam_id ?? null,
    });
    setBusyId('');
    if (j) {
      setMsg({ type: 'success', text: `${e.name}: ${T.grant.toLowerCase()} ✓` });
      load();
    }
  };

  const revoke = async (e: Examinee, examId: number) => {
    setBusyId(e.id);
    const j = await post(`/api/admin/examinees/${encodeURIComponent(e.id)}/revoke-access`, {
      exam_id: examId,
    });
    setBusyId('');
    if (j) load();
  };

  /** Profil rasmini yuklash — imtihon oldi shaxs tekshiruvi shu rasm
      bilan solishtiradi, shusiz imtihonni boshlab bo'lmaydi. */
  const uploadPhoto = async (e: Examinee, file: File) => {
    setPhotoBusy(e.id);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('read'));
        fr.onload = () => resolve(String(fr.result || ''));
        fr.readAsDataURL(file);
      });
      const j = await post(
        `/api/admin/examinees/${encodeURIComponent(e.id)}`,
        { profile_image: b64 },
        'PATCH',
      );
      if (j) {
        setMsg({ type: 'success', text: `${e.name}: ${T.photoSaved}` });
        load();
      }
    } finally {
      setPhotoBusy('');
    }
  };

  const resetPw = async (e: Examinee) => {
    const pw = window.prompt(`${e.name} — ${T.resetPw}`, e.id);
    if (!pw) return;
    const j = await post(`/api/admin/examinees/${encodeURIComponent(e.id)}`, { password: pw }, 'PATCH');
    if (j) setMsg({ type: 'success', text: `${e.name}: ${pw}` });
  };

  const remove = async (e: Examinee) => {
    if (!window.confirm(`${e.name} — ${T.confirmDel}`)) return;
    const j = await post(`/api/admin/examinees/${encodeURIComponent(e.id)}`, undefined, 'DELETE');
    if (j) load();
  };

  const create = async () => {
    if (!nf.id.trim() || !nf.name.trim()) return;
    const j = await post('/api/admin/examinees', {
      id: nf.id.trim(),
      name: nf.name.trim(),
      role,
      kafedra_id: nf.kafedra_id || null,
      course: Number(nf.course) || 0,
      password: nf.password.trim() || nf.id.trim(),
    });
    if (j) {
      setAddOpen(false);
      setNf({ id: '', name: '', kafedra_id: '', password: '', course: '1' });
      setMsg({ type: 'success', text: `${j.id}: ${j.password}` });
      load();
    }
  };

  const uploadBank = async () => {
    if (!bankExam || !bankFile) return;
    setBankBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', bankFile);
      fd.append('mode', bankMode);
      fd.append('per_student', bankPer);
      const res = await fetch(apiUrl(`/api/admin/exams/${bankExam.id}/question-bank`), {
        method: 'POST',
        headers: h,
        body: fd,
      });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<Record<string, unknown>>(res);
      if (!res.ok) {
        setMsg({ type: 'error', text: String(j?.error ?? 'Xatolik') });
        return;
      }
      const warn = String(j?.warning ?? '');
      setMsg({
        type: warn ? 'warning' : 'success',
        text: `${bankExam.title}: ${j?.total} ${T.questions}, ${T.perStudent} ${j?.per_student}${
          warn ? ` — ${warn}` : ''
        }`,
      });
      setBankExam(null);
      setBankFile(null);
      load();
    } finally {
      setBankBusy(false);
    }
  };

  const [certBusy, setCertBusy] = useState<number | null>(null);

  /** Sertifikatni PDF sifatida yuklab oladi (yakunlangan sessiya uchun). */
  const downloadCert = async (seId: number, name: string) => {
    setCertBusy(seId);
    try {
      const res = await fetch(
        apiUrl('/api/admin/student_exams/' + seId + '/certificate.pdf'),
        { headers: h },
      );
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        window.alert(res.status === 409 ? T.notDone : T.certErr);
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = (name || 'sertifikat').replace(/[^\w\-]+/g, '_') + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } finally {
      setCertBusy(null);
    }
  };

  /** Holat nomi va rangi — admin bir qarashda nima bo'lganini ko'rsin. */
  const statusView = (s: Session): { label: string; cls: string } => {
    switch (s.status) {
      case 'In Progress':
        return { label: T.stProgress, cls: 'bg-sky-50 text-sky-700' };
      case 'Completed':
        return { label: T.stDone, cls: 'bg-emerald-50 text-emerald-700' };
      case 'Banned':
        return { label: T.stBanned, cls: 'bg-rose-50 text-rose-700' };
      case 'Failed':
        return { label: T.stFailed, cls: 'bg-rose-50 text-rose-700' };
      default:
        return { label: T.stPending, cls: 'bg-gray-100 text-gray-600' };
    }
  };

  const sessionCell = (e: Examinee) => {
    if (!e.sessions.length) {
      return <span className="text-[12px] text-gray-400">{T.notStarted}</span>;
    }
    return (
      <div className="space-y-2">
        {e.sessions.map((s) => {
          const sv = statusView(s);
          const vt = Object.entries(s.violation_types || {});
          return (
            <div key={s.student_exam_id} className="text-[12px] leading-snug">
              <div>
                <span className="font-medium text-gray-700">
                  {s.exam_title || `#${s.exam_id}`}
                </span>
                <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[11px] font-semibold ${sv.cls}`}>
                  {sv.label}
                </span>
              </div>

              {s.lock_code === 'DEBT_HOLD' && (
                <div className="mt-0.5 text-[11.5px] font-semibold text-rose-700">{T.debtHold}</div>
              )}

              {s.status === 'Completed' && (
                <div className="mt-0.5">
                  <span className="text-gray-700">
                    {T.score}: <b>{s.score ?? 0}</b>/{s.total ?? 0}
                    {s.percent != null && <> ({s.percent}%)</>}
                  </span>
                  {s.percent != null && (
                    <span
                      className={`ml-1.5 px-1.5 py-0.5 rounded text-[11px] font-bold ${
                        s.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {s.passed ? T.passedL : T.failedL} · {s.pass_threshold}%
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={certBusy === s.student_exam_id}
                    onClick={() => void downloadCert(s.student_exam_id, e.name)}
                    className="ml-2 text-[11.5px] font-medium text-indigo-600 hover:underline disabled:text-gray-400"
                  >
                    {T.certL}
                  </button>
                </div>
              )}

              {(s.status === 'In Progress' || s.status === 'Banned') && (s.total ?? 0) > 0 && (
                <div className="mt-0.5 text-gray-500">
                  {s.answered ?? 0}/{s.total} {T.answeredL}
                </div>
              )}

              {s.status === 'Banned' && s.ban_reason && (
                <div className="mt-0.5 text-rose-700">
                  {T.banL}: {s.ban_reason}
                </div>
              )}

              {(s.violations ?? 0) > 0 && (
                <div className="mt-0.5 text-gray-400">
                  {s.violations} {T.violL}
                  {vt.length > 0 && (
                    <> · {vt.map(([k, v]) => `${k.toLowerCase()}×${v}`).join(', ')}</>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {msg && <AdminAlert type={msg.type}>{msg.text}</AdminAlert>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={T.total} value={stats.total} tone="border-slate-200 bg-white text-slate-700" />
        <Stat label={T.granted} value={stats.granted} tone="border-emerald-200 bg-emerald-50 text-emerald-800" />
        <Stat label={T.done} value={stats.done} tone="border-indigo-200 bg-indigo-50 text-indigo-800" />
        <Stat label={T.waiting} value={stats.waiting} tone="border-amber-200 bg-amber-50 text-amber-800" />
      </div>

      {/* Imtihonlar va savol banki */}
      {(data?.exams ?? []).length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[12px] font-extrabold uppercase tracking-wide text-gray-400 mb-2.5">
            {T.bank}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(data?.exams ?? []).map((ex) => (
              <div
                key={ex.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-gray-800 truncate">{ex.title}</p>
                  <p className="text-[12px] text-gray-500 truncate">
                    {ex.kafedra_name}
                    {ex.faculty_subject ? ` · ${ex.faculty_subject}` : ''}
                    {ex.course ? ` · ${ex.course === 1 ? T.c1 : T.c2}` : ''}
                  </p>
                  <p className="text-[12px] mt-0.5">
                    <span
                      className={
                        ex.question_count > 0
                          ? 'text-emerald-700 font-semibold'
                          : 'text-rose-600 font-semibold'
                      }
                    >
                      {ex.question_count} {T.questions}
                    </span>
                    <span className="text-gray-400"> · {T.perStudent} {ex.per_student}</span>
                  </p>
                </div>
                <AdminBtn
                  variant="ghost"
                  onClick={() => {
                    setBankExam(ex);
                    setBankPer(String(ex.per_student || 20));
                    setBankFile(null);
                  }}
                >
                  {T.upload}
                </AdminBtn>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtrlar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <AdminInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.search} />
        </div>
        <div className="w-full sm:w-64">
          <AdminSelect value={kafFilter} onChange={(e) => setKafFilter(e.target.value)}>
            <option value="">{T.allKaf}</option>
            {kafedras.map(([id, name]) => (
              <option key={id} value={String(id)}>
                {name}
              </option>
            ))}
          </AdminSelect>
        </div>
        <div className="w-full sm:w-40">
          <AdminSelect value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
            <option value="">{T.allCourses}</option>
            <option value="1">{T.c1}</option>
            <option value="2">{T.c2}</option>
          </AdminSelect>
        </div>
        <AdminBtn variant="ghost" onClick={load}>
          {T.refresh}
        </AdminBtn>
        <AdminBtn onClick={() => setAddOpen(true)}>{T.add}</AdminBtn>
      </div>

      {loading ? (
        <div className="flex justify-center py-14 text-gray-400">
          <SpinnerIcon />
        </div>
      ) : rows.length === 0 ? (
        <AdminEmpty title={T.empty} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-[13.5px]">
            <thead className="bg-gray-50 text-gray-500">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-semibold">{T.name}</th>
                <th className="px-3 py-2.5 font-semibold">{T.login}</th>
                <th className="px-3 py-2.5 font-semibold">{T.kafedra}</th>
                <th className="px-3 py-2.5 font-semibold">{T.course}</th>
                <th className="px-3 py-2.5 font-semibold">{T.photo}</th>
                <th className="px-3 py-2.5 font-semibold">{T.exam}</th>
                <th className="px-3 py-2.5 font-semibold">{T.attempts}</th>
                <th className="px-3 py-2.5 font-semibold">{T.receipt}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{T.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((e) => {
                const s = e.sessions[0];
                return (
                  <tr key={e.id} className="hover:bg-gray-50/70 align-top">
                    <td className="px-3 py-2.5 font-medium text-gray-800">{e.name}</td>
                    <td className="px-3 py-2.5 text-gray-500 tabular-nums">{e.id}</td>
                    <td className="px-3 py-2.5 text-gray-600">{e.kafedra_name || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {e.course ? (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[12px] font-semibold">
                          {e.course === 1 ? T.c1 : T.c2}
                        </span>
                      ) : (
                        <span className="text-[12px] text-gray-300">{T.noCourse}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {e.has_photo ? (
                        <span className="text-[12px] text-emerald-700">✓ {T.photoOk}</span>
                      ) : (
                        <label className="text-[12px] text-indigo-600 underline cursor-pointer">
                          {photoBusy === e.id ? '…' : T.photoAdd}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(ev) => {
                              const f = ev.target.files?.[0];
                              ev.target.value = '';
                              if (f) uploadPhoto(e, f);
                            }}
                          />
                        </label>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{sessionCell(e)}</td>
                    <td className="px-3 py-2.5 text-[12px] text-gray-600 whitespace-nowrap">
                      {s ? (
                        <>
                          {/* Kiruvchi imtihon to'lovga bog'liq emas: unga bir
                              marta urinish beriladi, qolgani faqat texnik
                              nosozlik uchun zaxira. Ordinator/magistrda esa
                              to'lov mantig'i kuchda. */}
                          {role === 'entrant' || s.one_attempt ? (
                            <>
                              <div>{T.oneAttempt}</div>
                              <div className="text-gray-400">
                                {s.one_attempt ? T.noRetake : `${s.tech_retries_left} ${T.techRetry}`}
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                {s.paid_attempts} {T.paid}
                              </div>
                              <div className="text-gray-400">
                                {s.tech_retries_left} {T.free}
                              </div>
                            </>
                          )}
                          {s.served_total > 0 && (
                            <div className="text-gray-400">
                              {s.served_total} {T.served}
                            </div>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[12px]">
                      {e.last_receipt ? (
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold ${
                            e.last_receipt.status === 'Approved'
                              ? 'bg-emerald-50 text-emerald-700'
                              : e.last_receipt.status === 'Rejected'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {e.last_receipt.status}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {s && s.access_granted && !s.locked ? (
                          <AdminBtn variant="ghost" onClick={() => revoke(e, s.exam_id)}>
                            {T.revoke}
                          </AdminBtn>
                        ) : (
                          <AdminBtn
                            onClick={() => grant(e)}
                            disabled={busyId === e.id || (!s && (data?.exams ?? []).length === 0)}
                          >
                            {busyId === e.id ? '…' : T.grant}
                          </AdminBtn>
                        )}
                        <AdminBtn variant="ghost" onClick={() => resetPw(e)}>
                          {T.resetPw}
                        </AdminBtn>
                        <AdminBtn variant="red-ghost" onClick={() => remove(e)}>
                          {T.del}
                        </AdminBtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Yangi qo'shish */}
      <AdminModal open={addOpen} title={T.addTitle} onClose={() => setAddOpen(false)}>
        <div className="space-y-3">
          <AdminInput
            value={nf.name}
            onChange={(e) => setNf({ ...nf, name: e.target.value })}
            placeholder={T.fio}
          />
          <AdminInput
            value={nf.id}
            onChange={(e) => setNf({ ...nf, id: e.target.value })}
            placeholder={T.idLabel}
          />
          <AdminSelect
            value={nf.kafedra_id}
            onChange={(e) => setNf({ ...nf, kafedra_id: e.target.value })}
          >
            <option value="">{T.allKaf}</option>
            {kafedras.map(([id, name]) => (
              <option key={id} value={String(id)}>
                {name}
              </option>
            ))}
          </AdminSelect>
          <AdminSelect
            value={nf.course}
            onChange={(e) => setNf({ ...nf, course: e.target.value })}
          >
            <option value="1">{T.c1}</option>
            <option value="2">{T.c2}</option>
            <option value="0">{T.noCourse}</option>
          </AdminSelect>
          <AdminInput
            value={nf.password}
            onChange={(e) => setNf({ ...nf, password: e.target.value })}
            placeholder={T.pwLabel}
          />
          <div className="flex justify-end gap-2 pt-1">
            <AdminBtn variant="ghost" onClick={() => setAddOpen(false)}>
              {T.cancel}
            </AdminBtn>
            <AdminBtn onClick={create}>{T.save}</AdminBtn>
          </div>
        </div>
      </AdminModal>

      {/* Savol banki yuklash */}
      <AdminModal
        open={!!bankExam}
        title={`${T.upload} — ${bankExam?.title ?? ''}`}
        onClose={() => setBankExam(null)}
      >
        <div className="space-y-3">
          <p className="text-[12.5px] text-gray-500">{T.uploadHint}</p>
          <input
            type="file"
            accept=".pdf,.docx,.txt,.csv,.md"
            onChange={(e) => setBankFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[13px] text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-indigo-700 file:font-semibold"
          />
          <div className="grid grid-cols-2 gap-3">
            <AdminSelect
              value={bankMode}
              onChange={(e) => setBankMode(e.target.value === 'append' ? 'append' : 'replace')}
            >
              <option value="replace">{T.replace}</option>
              <option value="append">{T.append}</option>
            </AdminSelect>
            <AdminInput
              value={bankPer}
              onChange={(e) => setBankPer(e.target.value.replace(/\D/g, ''))}
              placeholder={T.perStudent}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <AdminBtn variant="ghost" onClick={() => setBankExam(null)}>
              {T.cancel}
            </AdminBtn>
            <AdminBtn onClick={uploadBank} disabled={!bankFile || bankBusy}>
              {bankBusy ? '…' : T.save}
            </AdminBtn>
          </div>
        </div>
      </AdminModal>
    </div>
  );
}
