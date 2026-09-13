import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminBtn, AdminEmpty, AdminInput, AdminSelect } from './ui';

/* Ordinator / nomzod (vakansiya) / maxsus kiruvchi hisobotlari.

   O'qituvchilar hisobotidagi "kafedradagi jami" mezoni bu toifalar uchun
   noto'g'ri edi, shuning uchun har biri o'z ko'rinishida:
     - ordinator: yo'nalishlar, ruxsat berilganlar, hali topshirmaganlar, qarzdorlar;
     - nomzod: har bir lavozim bo'yicha tanlov reytingi va tavsiya etilgan nomzod;
     - maxsus kiruvchi: har bir kishiga individual natija varaqasi.
   Hammasi serverda hisoblanadi (/api/admin/reports/audience). */

export const TAILORED_AUDIENCES = ['ordinator', 'vacancy', 'entrant'];
export function isTailoredAudience(a: string): boolean {
  return TAILORED_AUDIENCES.includes(String(a || ''));
}

interface SeasonLite { key: string; label: string; audience: string; exam_count: number; }
interface Viol { total: number; technical: number; top: { type: string; label: string; count: number }[]; }
interface SubjectRow { subject: string; correct: number; total: number; answered: number; percent: number; }
interface Person {
  student_exam_id: number | null;
  student_id: string;
  name: string;
  state: string;
  state_label: string;
  score: number | null;
  total: number;
  percent: number | null;
  passed: boolean;
  started_label: string;
  completed_label: string;
  minutes: number | null;
  warnings: number;
  violations: Viol;
  ban_reason: string;
  result_id: string;
  access_granted: boolean;
  hold: string;
  direction?: string;
  phone?: string;
  subject?: string;
  kafedra_name?: string;
  rank?: number | null;
  verdict?: string;
  verdict_label?: string;
  exam_title?: string;
  threshold?: number;
  duration_limit?: number;
  answered?: number;
  subjects?: SubjectRow[];
  subjects_exact?: boolean;
  plan?: { subject: string; count: number }[];
  identity?: { verified_at: string; matched: boolean | null; score: number | null };
  consent?: { at: string; version: string; ip: string; mic: number | null };
  timeline?: { type: string; label: string; at: string; technical: boolean }[];
  certificate?: boolean;
  bank_pct?: number | null;
  ai_pct?: number | null;
  flags?: { code: string; label: string }[];
}
interface Stats {
  completed: number; passed: number; failed: number; pass_percent: number; avg_percent: number;
  best_percent: number; worst_percent: number; avg_minutes: number | null; banned: number;
  in_progress: number; not_started: number; absent: number;
}
interface OrdGroup extends Stats {
  exam_id: number; direction: string; kafedra_name: string; allowed: number; debt: number;
  threshold: number; question_count: number; duration: number; people: Person[];
}
interface Competition extends Stats {
  kafedra_name: string; subject: string; threshold: number; candidates: number; contested: boolean;
  winner: string[]; tie: boolean; people: Person[];
}
interface KafRow {
  kafedra_name: string; positions: number; candidates: number; completed: number; passed: number;
  not_started: number; banned: number; recommended: number;
}
interface Report {
  kind: string;
  title?: string;
  generated_label?: string;
  season?: { label: string };
  pass_threshold?: number | null;
  one_attempt?: boolean;
  totals?: Record<string, number>;
  groups?: OrdGroup[];
  todo?: Person[];
  debtors?: Person[];
  top?: Person[];
  competitions?: Competition[];
  kafedras?: KafRow[];
  not_taken?: Person[];
  people?: Person[];
  suspects?: Person[];
}

interface Props {
  token: string;
  lang: Language;
  audience: string;
  audienceOptions: { value: string; label: string }[];
  onAudience: (a: string) => void;
  seasons: SeasonLite[];
  seasonKey: string;
  onSeason: (k: string) => void;
}

const TX: Record<string, Record<string, string>> = {
  uz: {
    season: 'Test mavsumi', audience: 'Kim uchun', refresh: 'Yangilash', pdf: 'PDF hisobot', excel: 'Excelga yuklash',
    loading: 'Yuklanmoqda...', noSeason: "Bu toifa uchun hali imtihon yo'q.", failed: "Hisobotni yuklab bo'lmadi. Yangilang.",
    search: "Ism, login yoki telefon bo'yicha qidirish...", allowed: 'Ruxsat berilgan', completed: 'Topshirdi',
    passed: "O'tdi", failed_: "O'tmadi", remaining: 'Hali topshirmagan', debt: "Qarzdor (ruxsat yo'q)",
    passPct: "O'tish foizi", avg: "O'rtacha natija", coverage: 'Qamrov', inProgress: 'Hozir topshirmoqda',
    banned: 'Chetlatilgan', directions: "Yo'nalishlar", todo: 'Hali topshirmaganlar', debtors: 'Qarzdorlar',
    top: 'Eng yaxshi 10', direction: "Yo'nalish", kafedra: 'Kafedra', person: 'F.I.Sh.', login: 'Login',
    state: 'Holat', score: 'Ball', percent: 'Foiz', result: 'Natija', minutes: 'Vaqt, daq.', viol: 'Nazorat qaydlari',
    oneAttempt: 'Bir martalik imtihon — qayta topshirish faqat administrator qarori bilan',
    basis: "Hisob asosi — ruxsat berilganlar (grafik bo'yicha), kafedradagi barcha ordinator emas.",
    threshold: "O'tish chegarasi", registered: "Ro'yxatdan o'tgan", competitions: 'Lavozimlar (tanlovlar)',
    recommended: 'Tavsiya etilgan', notTaken: 'Topshirmaganlar', kafedras: 'Kafedralar', rank: "O'rin",
    phone: 'Telefon', subject: 'Fan (lavozim)', verdict: 'Xulosa', candidates: 'nomzod', best: 'Eng yuqori', allKaf: 'Barcha kafedralar',
    contested: 'raqobatli', tieNote: 'Teng natija — yakuniy qarorni komissiya qabul qiladi',
    rankNote: "Natija foizi bo'yicha; teng foizda tezroq yakunlagan yuqorida. Tavsiya — eng yuqori natija va chegaradan yuqori.",
    people: 'Topshiruvchilar', subjects: 'Fanlar kesimida', process: 'Imtihon jarayoni', started: 'Boshlangan',
    finished: 'Yakunlangan', spent: 'Sarflangan vaqt', answered: 'Javob berilgan', identity: "Shaxs tasdig'i",
    consent: 'Qoidalarga rozilik', mic: 'Mikrofon darajasi', warnings: 'Rasmiy ogohlantirishlar',
    resultId: 'Natija raqami', cert: 'Sertifikat (PDF)', timeline: 'Nazorat qaydlari xronologiyasi',
    technical: 'texnik', control: 'nazorat', matched: 'mos keldi', notMatched: 'MOS KELMADI', notGiven: 'berilmagan',
    of: 'dan', min: 'daq.', approx: "Fanlar bo'yicha taqsimot javoblardan qayta hisoblangan; rasmiy natija — umumiy ball.",
    empty: "Ma'lumot yo'q.", positions: 'lavozim', winner: "G'olib",
    suspects: 'Shubhalilar', evidence: 'Dalillar', evidenceTitle: 'Nazorat qaydlari va dalil rasmlari',
    noImage: "rasm yo'q", close: 'Yopish', evidenceEmpty: "Qayd yo'q.", screens: 'Ekran rasmlari', webcamShots: 'Kamera kadrlari', roomShots: "Imtihon oldidan xona",
    outWarn: '{n}-ogohlantirish', outBan: "BAN — imtihon to'xtatildi", outRetake: 'Qayta topshirish berildi',
    outMerged: 'Hisoblanmadi (takroriy signal)', outTech: "Texnik — jazo yo'q", outReview: "Admin ko'rib chiqadi",
    sinceStart: 'boshlanganidan', factLabel: 'Fakt', sumStatus: 'Holat', sumWarnings: 'Rasmiy ogohlantirish',
    sumRecords: 'Jami qayd', sumBan: 'Chetlatish sababi', sumStarted: 'Boshlagan',
    suspicious: 'shubhali', suspiciousTotal: 'Shubhali natijalar (admin ko\'rib chiqishi kerak)',
  },
  ru: {
    season: 'Sezon testirovaniya', audience: 'Dlya kogo', refresh: 'Obnovit', pdf: 'Otchet PDF', excel: 'Skachat v Excel',
    loading: 'Zagruzka...', noSeason: 'Dlya etoy kategorii ekzamenov poka net.', failed: 'Ne udalos zagruzit otchet.',
    search: 'Poisk po FIO, loginu ili telefonu...', allowed: 'Dopushcheno', completed: 'Sdali',
    passed: 'Sdal', failed_: 'Ne sdal', remaining: 'Eshche ne sdali', debt: 'Zadolzhennost (bez dopuska)',
    passPct: 'Protsent sdachi', avg: 'Sredniy rezultat', coverage: 'Okhvat', inProgress: 'Sdayut seychas',
    banned: 'Otstraneny', directions: 'Napravleniya', todo: 'Eshche ne sdali', debtors: 'Dolzhniki',
    top: 'Luchshie 10', direction: 'Napravlenie', kafedra: 'Kafedra', person: 'F.I.O.', login: 'Login',
    state: 'Status', score: 'Ball', percent: 'Protsent', result: 'Rezultat', minutes: 'Vremya, min', viol: 'Narusheniya',
    oneAttempt: 'Odnorazovyy ekzamen — peresdacha tolko po resheniyu administratora',
    basis: 'Osnova rascheta — dopushchennye (po grafiku), a ne vse ordinatory kafedry.',
    threshold: 'Prokhodnoy porog', registered: 'Zaregistrirovano', competitions: 'Dolzhnosti (konkursy)',
    recommended: 'Rekomendovano', notTaken: 'Ne sdavali', kafedras: 'Kafedry', rank: 'Mesto',
    phone: 'Telefon', subject: 'Predmet (dolzhnost)', verdict: 'Zaklyuchenie', candidates: 'kandidatov', best: 'Luchshiy', allKaf: 'Vse kafedry',
    contested: 'konkurentnyy', tieNote: 'Ravnyy rezultat — reshenie prinimaet komissiya',
    rankNote: 'Po protsentu; pri ravenstve vyshe tot, kto zavershil bystree.',
    people: 'Uchastniki', subjects: 'Po predmetam', process: 'Khod ekzamena', started: 'Nachalo',
    finished: 'Zavershenie', spent: 'Zatracheno', answered: 'Otvecheno', identity: 'Podtverzhdenie lichnosti',
    consent: 'Soglasie s pravilami', mic: 'Uroven mikrofona', warnings: 'Ofitsialnye preduprezhdeniya',
    resultId: 'Nomer rezultata', cert: 'Sertifikat (PDF)', timeline: 'Khronologiya narusheniy',
    technical: 'tekhnich.', control: 'kontrol', matched: 'sovpalo', notMatched: 'NE SOVPALO', notGiven: 'ne dano',
    of: 'iz', min: 'min', approx: 'Raspredelenie po predmetam pereschitano po otvetam; ofitsialnyy — obshchiy ball.',
    empty: 'Net dannykh.', positions: 'dolzhnostey', winner: 'Pobeditel',
    suspects: 'Podozritelnye', evidence: 'Dokazatelstva', evidenceTitle: 'Zapisi kontrolya i snimki',
    noImage: 'net snimka', close: 'Zakryt', evidenceEmpty: 'Net zapisey.', screens: 'Snimki ekrana', webcamShots: 'Kadry kamery', roomShots: 'Pomeshchenie pered ekzamenom',
    outWarn: 'Preduprezhdenie {n}', outBan: 'BAN — ekzamen ostanovlen', outRetake: 'Dana peresdacha',
    outMerged: 'Ne zaschitano (povtor signala)', outTech: 'Tekhnicheskoe — bez nakazaniya', outReview: 'Na rassmotrenii admina',
    sinceStart: 'ot nachala', factLabel: 'Fakt', sumStatus: 'Status', sumWarnings: 'Ofitsialnye preduprezhdeniya',
    sumRecords: 'Vsego zapisey', sumBan: 'Prichina udaleniya', sumStarted: 'Nachalo',
    suspicious: 'podozritelno', suspiciousTotal: 'Podozritelnye rezultaty (proverit)',
  },
  en: {
    season: 'Test season', audience: 'Audience', refresh: 'Refresh', pdf: 'PDF report', excel: 'Download for Excel',
    loading: 'Loading...', noSeason: 'No exams for this category yet.', failed: 'Could not load the report.',
    search: 'Search by name, login or phone...', allowed: 'Admitted', completed: 'Completed',
    passed: 'Passed', failed_: 'Failed', remaining: 'Not taken yet', debt: 'Debt (no access)',
    passPct: 'Pass rate', avg: 'Average', coverage: 'Coverage', inProgress: 'In progress',
    banned: 'Removed', directions: 'Specialties', todo: 'Not taken yet', debtors: 'Debtors',
    top: 'Top 10', direction: 'Specialty', kafedra: 'Department', person: 'Name', login: 'Login',
    state: 'Status', score: 'Score', percent: 'Percent', result: 'Result', minutes: 'Time, min', viol: 'Proctoring flags',
    oneAttempt: 'One-time exam — retake only by administrator decision',
    basis: 'Basis — admitted residents (per schedule), not all residents of the department.',
    threshold: 'Pass mark', registered: 'Registered', competitions: 'Positions (competitions)',
    recommended: 'Recommended', notTaken: 'Did not take', kafedras: 'Departments', rank: 'Rank',
    phone: 'Phone', subject: 'Subject (position)', verdict: 'Conclusion', candidates: 'candidates', best: 'Best', allKaf: 'All departments',
    contested: 'contested', tieNote: 'Tie — the commission decides',
    rankNote: 'By percent; on a tie the faster finisher ranks higher.',
    people: 'Participants', subjects: 'By subject', process: 'Exam process', started: 'Started',
    finished: 'Finished', spent: 'Time spent', answered: 'Answered', identity: 'Identity check',
    consent: 'Rules consent', mic: 'Microphone level', warnings: 'Official warnings',
    resultId: 'Result ID', cert: 'Certificate (PDF)', timeline: 'Proctoring timeline',
    technical: 'technical', control: 'proctoring', matched: 'matched', notMatched: 'NOT MATCHED', notGiven: 'not given',
    of: 'of', min: 'min', approx: 'Per-subject split recomputed from answers; the official result is the total score.',
    empty: 'No data.', positions: 'positions', winner: 'Winner',
    suspects: 'Suspicious', evidence: 'Evidence', evidenceTitle: 'Proctoring records and snapshots',
    noImage: 'no snapshot', close: 'Close', evidenceEmpty: 'No records.', screens: 'Screen snapshots', webcamShots: 'Camera frames', roomShots: 'Room before the exam',
    outWarn: 'Warning {n}', outBan: 'BAN — exam stopped', outRetake: 'Retake granted',
    outMerged: 'Not counted (repeat signal)', outTech: 'Technical — no penalty', outReview: 'Admin review',
    sinceStart: 'since start', factLabel: 'Fact', sumStatus: 'Status', sumWarnings: 'Formal warnings',
    sumRecords: 'Records', sumBan: 'Removal reason', sumStarted: 'Started',
    suspicious: 'suspicious', suspiciousTotal: 'Suspicious results (review)',
  },
};

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function pctTone(p: number | null | undefined, thr?: number | null): string {
  if (p == null) return 'text-gray-400';
  const t = thr || 60;
  if (p >= t) return 'text-emerald-700';
  if (p >= t - 15) return 'text-amber-700';
  return 'text-red-600';
}

function fmtMin(v: number | null | undefined): string {
  return v == null ? '—' : String(Math.round(v * 10) / 10);
}

const STATE_CLS: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700',
  banned: 'bg-rose-100 text-rose-800',
  in_progress: 'bg-sky-50 text-sky-700',
  absent: 'bg-gray-100 text-gray-500',
  unfinished: 'bg-amber-50 text-amber-800',
  not_started: 'bg-amber-50 text-amber-800',
  no_session: 'bg-gray-100 text-gray-500',
  debt: 'bg-rose-100 text-rose-800',
};

const VERDICT_CLS: Record<string, string> = {
  recommended: 'bg-emerald-600 text-white',
  tie: 'bg-amber-100 text-amber-900',
  passed: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  banned: 'bg-rose-100 text-rose-800',
  absent: 'bg-gray-100 text-gray-500',
};

function Badge({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={'inline-block text-[11.5px] px-2 py-0.5 rounded-full whitespace-nowrap ' + cls}>{children}</span>;
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <div className="text-[12px] text-gray-500 leading-tight">{label}</div>
      <div className={'text-2xl font-bold mt-1 ' + (tone || 'text-gray-900')}>{value}</div>
    </div>
  );
}

function ViolCell({ v, T }: { v: Viol; T: Record<string, string> }) {
  if (!v || (!v.total && !v.technical)) return <span className="text-gray-300">—</span>;
  return (
    <span className="text-[12px]" title={v.top.map((x) => x.label + ': ' + x.count).join('\n')}>
      {v.total ? <span className="text-red-600 font-semibold">{v.total}</span> : null}
      {v.technical ? <span className="text-gray-400">{v.total ? ' · ' : ''}{T.technical} {v.technical}</span> : null}
    </span>
  );
}

export function AudienceReport(props: Props) {
  const { token, lang, audience, audienceOptions, onAudience, seasons, seasonKey, onSeason } = props;
  const T = TX[lang] || TX.uz;
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('main');
  const [kafF, setKafF] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [ev, setEv] = useState<null | {
    name: string;
    exam_title: string;
    items: {
      at: string; type: string; label: string; technical: boolean; image: string;
      note?: string; detail?: string; outcome?: string; elapsed?: string;
    }[];
    summary?: {
      state_label?: string; ban_reason?: string; ban_reason_label?: string; official_warnings?: number;
      warning_limit?: number; records?: number; counted?: number; started?: string;
    };
    screens?: { at: string; image: string; kind?: string }[];
  }>(null);
  const [evBusy, setEvBusy] = useState(false);
  const outcomeBadge = (o?: string) => {
    const v = String(o || '');
    if (!v || v === 'logged') return null;
    let text = '';
    let cls = 'bg-gray-100 text-gray-600';
    if (v.startsWith('warning:')) {
      text = T.outWarn.replace('{n}', v.slice(8));
      cls = 'bg-amber-100 text-amber-900';
    } else if (v === 'ban') {
      text = T.outBan;
      cls = 'bg-rose-600 text-white';
    } else if (v === 'retake') {
      text = T.outRetake;
      cls = 'bg-indigo-100 text-indigo-800';
    } else if (v === 'merged') {
      text = T.outMerged;
    } else if (v === 'technical') {
      text = T.outTech;
    } else if (v === 'review') {
      text = T.outReview;
      cls = 'bg-sky-100 text-sky-800';
    } else {
      return null;
    }
    return <span className={'rounded px-1.5 py-0.5 font-semibold ' + cls}>{text}</span>;
  };
  const openEvidence = async (seId: number | null) => {
    if (!seId) return;
    setEvBusy(true);
    try {
      const res = await fetch(apiUrl('/api/admin/student_exams/' + seId + '/evidence'), {
        headers: authHeaders(token, lang),
      });
      if (!checkAdminAuthResponse(res) || !res.ok) return;
      const j = await readJsonSafe<any>(res);
      if (j && Array.isArray(j.items)) setEv(j);
    } finally {
      setEvBusy(false);
    }
  };

  const load = useCallback(async () => {
    if (!seasonKey) { setData(null); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(apiUrl('/api/admin/reports/audience?season=' + encodeURIComponent(seasonKey)), {
        headers: authHeaders(token, lang),
      });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<Report>(res);
      if (!res.ok || !j) { setError(T.failed); setData(null); return; }
      setData(j);
    } catch {
      setError(T.failed);
    } finally {
      setLoading(false);
    }
  }, [seasonKey, token, lang, T.failed]);

  useEffect(() => { setTab('main'); setQ(''); setKafF(''); setOpen({}); }, [audience, seasonKey]);
  useEffect(() => { load(); }, [load]);

  const match = useCallback((p: Person) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (p.name || '').toLowerCase().includes(s) || (p.student_id || '').includes(s) || (p.phone || '').includes(s);
  }, [q]);

  const fetchBlob = async (url: string, filename: string) => {
    setPdfBusy(true);
    try {
      const res = await fetch(apiUrl(url), { headers: authHeaders(token, lang) });
      if (!checkAdminAuthResponse(res) || !res.ok) return;
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(u);
    } finally {
      setPdfBusy(false);
    }
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const downloadPdf = () =>
    fetchBlob('/api/admin/reports/audience.pdf?season=' + encodeURIComponent(seasonKey),
      ({ ordinator: 'ordinatorlar', vacancy: 'nomzodlar', entrant: 'maxsus-kiruvchilar' } as Record<string, string>)[audience]
      + '-hisobot-' + stamp + '.pdf');

  const exportCsv = () => {
    if (!data) return;
    if (data.kind === 'ordinator') {
      downloadCsv('ordinatorlar-' + stamp + '.csv', [
        [T.direction, T.person, T.login, T.state, T.score, T.percent, T.result, T.minutes, T.viol],
        ...(data.groups || []).flatMap((g) => g.people.map((p) => [
          g.direction, p.name, p.student_id, p.state_label,
          p.score != null ? p.score + '/' + p.total : '', p.percent ?? '',
          p.state === 'completed' ? (p.passed ? T.passed : T.failed_) : '', fmtMin(p.minutes), p.violations.total,
        ])),
        ...(data.debtors || []).map((p) => [p.direction || '', p.name, p.student_id, p.state_label, '', '', '', '', '']),
      ]);
    } else if (data.kind === 'vacancy') {
      downloadCsv('nomzodlar-' + stamp + '.csv', [
        [T.kafedra, T.subject, T.rank, T.person, T.login, T.phone, T.score, T.percent, T.minutes, T.viol, T.verdict],
        ...(data.competitions || []).flatMap((c) => c.people.map((p) => [
          c.kafedra_name, c.subject, p.rank ?? '', p.name, p.student_id, p.phone || '',
          p.score != null ? p.score + '/' + p.total : '', p.percent ?? '', fmtMin(p.minutes),
          p.violations.total, p.verdict_label || p.state_label,
        ])),
      ]);
    } else if (data.kind === 'entrant') {
      downloadCsv('maxsus-kiruvchilar-' + stamp + '.csv', [
        [T.person, T.login, T.state, T.score, T.percent, T.result, ...Array.from(new Set((data.people || []).flatMap((p) => (p.subjects || []).map((s) => s.subject))))],
        ...(data.people || []).map((p) => {
          const subj = Array.from(new Set((data.people || []).flatMap((x) => (x.subjects || []).map((s) => s.subject))));
          return [
            p.name, p.student_id, p.state_label, p.score != null ? p.score + '/' + p.total : '', p.percent ?? '',
            p.state === 'completed' ? (p.passed ? T.passed : T.failed_) : '',
            ...subj.map((s) => {
              const r = (p.subjects || []).find((x) => x.subject === s);
              return r ? r.correct + '/' + r.total + ' (' + r.percent + '%)' : '';
            }),
          ];
        }),
      ]);
    }
  };

  const totals = data?.totals || {};

  const header = (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grow min-w-[220px]">
          <div className="text-lg font-semibold text-gray-900">{data?.title || audienceOptions.find((o) => o.value === audience)?.label}</div>
          {data?.generated_label ? (
            <div className="text-[12px] text-gray-500 mt-0.5">{data.season?.label} · {data.generated_label}</div>
          ) : null}
        </div>
        <div>
          <div className="text-[12px] text-gray-500 mb-1">{T.season}</div>
          <AdminSelect value={seasonKey} onChange={(e: any) => onSeason(e.target.value)}>
            {seasons.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </AdminSelect>
        </div>
        <div>
          <div className="text-[12px] text-gray-500 mb-1">{T.audience}</div>
          <AdminSelect value={audience} onChange={(e: any) => onAudience(e.target.value)}>
            {audienceOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </AdminSelect>
        </div>
        <AdminBtn variant="ghost" size="sm" onClick={() => load()}>{T.refresh}</AdminBtn>
        <AdminBtn variant="blue" size="sm" onClick={downloadPdf} loading={pdfBusy} disabled={!data || !seasonKey}>{T.pdf}</AdminBtn>
        <AdminBtn variant="violet" size="sm" onClick={exportCsv} disabled={!data}>{T.excel}</AdminBtn>
      </div>
    </div>
  );

  const tabs = (items: [string, string][]) => (
    <div className="flex flex-wrap gap-1 border-b border-gray-200">
      {items.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => setTab(k)}
          className={'px-3 py-2 text-sm font-medium -mb-px border-b-2 ' + (tab === k ? 'border-violet-500 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-700')}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const searchBox = (
    <div className="min-w-[240px] grow max-w-md">
      <AdminInput placeholder={T.search} value={q} onChange={(e: any) => setQ(e.target.value)} />
    </div>
  );

  const resultCell = (p: Person) =>
    p.state === 'completed'
      ? <Badge cls={p.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>{p.passed ? T.passed : T.failed_}</Badge>
      : null;

  /* ------------------------------------------------------------ ordinator */
  const ordinatorBody = (d: Report) => {
    const groups = d.groups || [];
    const personTable = (list: Person[], thr?: number, showDirection = false) => (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-[12px] border-b border-gray-100">
              <th className="py-2 pl-4 pr-2 w-8">#</th>
              <th className="py-2 pr-2">{T.person}</th>
              {showDirection ? <th className="py-2 pr-2">{T.direction}</th> : null}
              <th className="py-2 pr-2">{T.state}</th>
              <th className="py-2 pr-2">{T.score}</th>
              <th className="py-2 pr-2">{T.percent}</th>
              <th className="py-2 pr-2">{T.result}</th>
              <th className="py-2 pr-2">{T.minutes}</th>
              <th className="py-2 pr-2">{T.viol}</th>
            </tr>
          </thead>
          <tbody>
            {list.filter(match).map((p, i) => (
              <tr key={(p.student_exam_id ?? p.student_id) + ':' + i} className="border-b border-gray-50 last:border-0">
                <td className="py-1.5 pl-4 pr-2 text-gray-400">{i + 1}</td>
                <td className="py-1.5 pr-2 text-gray-900">
                  {p.name}
                  <div className="font-mono text-[11px] text-gray-400">{p.student_id}</div>
                  {(p.flags || []).map((f) => (
                    <span
                      key={f.code}
                      title={f.label}
                      className="mt-0.5 mr-1 inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-800"
                    >
                      ⚠ {T.suspicious}: {f.label}
                    </span>
                  ))}
                  {p.student_exam_id && (p.violations?.total || p.violations?.technical || (p.flags || []).length) ? (
                    <button
                      type="button"
                      disabled={evBusy}
                      onClick={() => void openEvidence(p.student_exam_id)}
                      className="mt-0.5 block text-[11.5px] font-semibold text-violet-700 hover:underline disabled:opacity-50"
                    >
                      🔍 {T.evidence}
                    </button>
                  ) : null}
                </td>
                {showDirection ? <td className="py-1.5 pr-2 text-gray-600">{p.direction}</td> : null}
                <td className="py-1.5 pr-2"><Badge cls={STATE_CLS[p.state] || 'bg-gray-100 text-gray-600'}>{p.state_label}</Badge></td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{p.score != null ? p.score + '/' + p.total : '—'}</td>
                <td className={'py-1.5 pr-2 font-semibold ' + pctTone(p.percent, thr)}>{p.percent != null ? p.percent + '%' : '—'}</td>
                <td className="py-1.5 pr-2">{resultCell(p)}</td>
                <td className="py-1.5 pr-2 text-gray-600">{fmtMin(p.minutes)}</td>
                <td className="py-1.5 pr-2"><ViolCell v={p.violations} T={T} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Stat label={T.allowed} value={totals.allowed ?? 0} />
            <Stat label={T.completed} value={totals.completed ?? 0} />
            <Stat label={T.passed} value={totals.passed ?? 0} tone="text-emerald-700" />
            <Stat label={T.failed_} value={totals.failed ?? 0} tone="text-red-600" />
            <Stat label={T.remaining} value={totals.remaining ?? 0} tone="text-amber-700" />
            <Stat label={T.debt} value={totals.debt ?? 0} tone="text-rose-700" />
            <Stat label={T.passPct} value={(totals.pass_percent ?? 0) + '%'} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-500">
            <span>{T.basis}</span>
            <span>{T.coverage}: <b className="text-gray-700">{totals.coverage_percent ?? 0}%</b></span>
            {totals.suspicious ? (
              <span className="text-rose-700 font-semibold">⚠ {T.suspiciousTotal}: {totals.suspicious}</span>
            ) : null}
            <span>{T.avg}: <b className="text-gray-700">{totals.avg_percent ?? 0}%</b></span>
            {d.pass_threshold ? <span>{T.threshold}: <b className="text-gray-700">{d.pass_threshold}%</b></span> : null}
            {totals.in_progress ? <span className="text-sky-700">{T.inProgress}: {totals.in_progress}</span> : null}
          </div>
          {d.one_attempt ? (
            <div className="text-[12.5px] rounded-md bg-violet-50 border border-violet-100 text-violet-800 px-3 py-2">{T.oneAttempt}</div>
          ) : null}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {tabs([
              ['main', T.directions + ' (' + groups.length + ')'],
              ['todo', T.todo + ' (' + (d.todo || []).length + ')'],
              ['debt', T.debtors + ' (' + (d.debtors || []).length + ')'],
              ['sus', '⚠ ' + T.suspects + ' (' + (d.suspects || []).length + ')'],
              ['top', T.top],
            ])}
            {searchBox}
          </div>

          {tab === 'main' ? (
            groups.length ? (
              <div className="space-y-2">
                {groups.map((g) => {
                  const key = String(g.exam_id);
                  const hasHit = !q.trim() || g.people.some(match);
                  if (!hasHit) return null;
                  const isOpen = open[key] || !!q.trim();
                  const left = g.not_started + g.in_progress;
                  return (
                    <div key={key} className="border border-gray-200 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setOpen((m) => ({ ...m, [key]: !m[key] }))}
                        className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left bg-gray-50/60 hover:bg-gray-50 rounded-lg"
                      >
                        <span className="font-semibold text-gray-900 grow">{g.direction}
                          <span className="block text-[11.5px] font-normal text-gray-400">{g.kafedra_name}</span>
                        </span>
                        <span className="text-[12.5px] text-gray-600">{T.allowed}: <b>{g.allowed}</b></span>
                        <span className="text-[12.5px] text-gray-600">{T.completed}: <b>{g.completed}</b></span>
                        <span className="text-[12.5px] text-emerald-700">{T.passed}: <b>{g.passed}</b></span>
                        {g.failed ? <span className="text-[12.5px] text-red-600">{T.failed_}: <b>{g.failed}</b></span> : null}
                        {left ? <span className="text-[12.5px] text-amber-700">{T.remaining}: <b>{left}</b></span> : null}
                        {g.debt ? <span className="text-[12.5px] text-rose-700">{T.debtors}: <b>{g.debt}</b></span> : null}
                        <span className={'text-[13px] font-bold ' + pctTone(g.completed ? g.avg_percent : null, g.threshold)}>
                          {g.completed ? g.avg_percent + '%' : '—'}
                        </span>
                        <span className="text-gray-400">{isOpen ? '▾' : '▸'}</span>
                      </button>
                      {isOpen && g.people.length ? personTable(g.people, g.threshold) : null}
                    </div>
                  );
                })}
              </div>
            ) : <AdminEmpty title={T.empty} />
          ) : null}
          {tab === 'todo' ? ((d.todo || []).length ? personTable(d.todo || [], d.pass_threshold || undefined, true) : <AdminEmpty title={T.empty} />) : null}
          {tab === 'debt' ? ((d.debtors || []).length ? personTable(d.debtors || [], d.pass_threshold || undefined, true) : <AdminEmpty title={T.empty} />) : null}
          {tab === 'top' ? ((d.top || []).length ? personTable(d.top || [], d.pass_threshold || undefined, true) : <AdminEmpty title={T.empty} />) : null}
          {tab === 'sus' ? ((d.suspects || []).length ? personTable(d.suspects || [], d.pass_threshold || undefined, true) : <AdminEmpty title={T.empty} />) : null}
        </div>
      </div>
    );
  };

  /* -------------------------------------------------------------- vacancy */
  const vacancyBody = (d: Report) => {
    const comps = (d.competitions || []).filter((c) => !kafF || c.kafedra_name === kafF);
    const kafNames = Array.from(new Set((d.competitions || []).map((c) => c.kafedra_name)));
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Stat label={T.registered} value={totals.registered ?? 0} />
            <Stat label={T.completed} value={totals.completed ?? 0} />
            <Stat label={T.passed} value={totals.passed ?? 0} tone="text-emerald-700" />
            <Stat label={T.failed_} value={totals.failed ?? 0} tone="text-red-600" />
            <Stat label={T.notTaken} value={(totals.not_started ?? 0) + (totals.absent ?? 0)} tone="text-amber-700" />
            <Stat label={T.banned} value={totals.banned ?? 0} tone="text-rose-700" />
            <Stat label={T.recommended} value={(totals.recommended ?? 0) + ' / ' + (totals.competitions ?? 0)} tone="text-emerald-700" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-500">
            <span>{T.rankNote}</span>
            {d.pass_threshold ? <span>{T.threshold}: <b className="text-gray-700">{d.pass_threshold}%</b></span> : null}
            <span>{T.avg}: <b className="text-gray-700">{totals.avg_percent ?? 0}%</b></span>
            <span>{T.contested}: <b className="text-gray-700">{totals.contested ?? 0}</b></span>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {tabs([
              ['main', T.competitions + ' (' + (d.competitions || []).length + ')'],
              ['kaf', T.kafedras + ' (' + (d.kafedras || []).length + ')'],
              ['nt', T.notTaken + ' (' + (d.not_taken || []).length + ')'],
            ])}
            {tab === 'main' ? (
              <AdminSelect value={kafF} onChange={(e: any) => setKafF(e.target.value)}>
                <option value="">{T.allKaf}</option>
                {kafNames.map((k) => <option key={k} value={k}>{k}</option>)}
              </AdminSelect>
            ) : null}
            {searchBox}
          </div>

          {tab === 'main' ? (
            comps.length ? (
              <div className="space-y-3">
                {comps.map((c) => {
                  const list = c.people.filter(match);
                  if (!list.length) return null;
                  return (
                    <div key={c.kafedra_name + '|' + c.subject} className="border border-gray-200 rounded-lg">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 bg-gray-50/60 rounded-t-lg border-b border-gray-100">
                        <div className="grow">
                          <div className="font-semibold text-gray-900">{c.subject}</div>
                          <div className="text-[11.5px] text-gray-500">{c.kafedra_name}</div>
                        </div>
                        <span className="text-[12.5px] text-gray-600">{c.candidates} {T.candidates}</span>
                        <span className="text-[12.5px] text-gray-600">{T.completed}: <b>{c.completed}</b></span>
                        <span className="text-[12.5px] text-gray-600">{T.best}: <b className={pctTone(c.completed ? c.best_percent : null, c.threshold)}>{c.completed ? c.best_percent + '%' : '—'}</b></span>
                        {c.winner.length ? (
                          <Badge cls={c.tie ? 'bg-amber-100 text-amber-900' : 'bg-emerald-600 text-white'}>
                            {(c.tie ? T.tieNote + ': ' : T.winner + ': ') + c.winner.join(', ')}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-500 text-[12px] border-b border-gray-100">
                              <th className="py-2 pl-4 pr-2 w-12">{T.rank}</th>
                              <th className="py-2 pr-2">{T.person}</th>
                              <th className="py-2 pr-2">{T.phone}</th>
                              <th className="py-2 pr-2">{T.score}</th>
                              <th className="py-2 pr-2">{T.percent}</th>
                              <th className="py-2 pr-2">{T.minutes}</th>
                              <th className="py-2 pr-2">{T.viol}</th>
                              <th className="py-2 pr-2">{T.verdict}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((p) => (
                              <tr key={p.student_id} className={'border-b border-gray-50 last:border-0 ' + (p.verdict === 'recommended' ? 'bg-emerald-50/50' : '')}>
                                <td className={'py-1.5 pl-4 pr-2 font-bold ' + (p.rank === 1 ? 'text-emerald-700' : 'text-gray-400')}>{p.rank ?? '—'}</td>
                                <td className="py-1.5 pr-2 text-gray-900">
                                  {p.name}
                                  <div className="font-mono text-[11px] text-gray-400">{p.student_id}</div>
                                </td>
                                <td className="py-1.5 pr-2 whitespace-nowrap">
                                  {p.phone ? <a className="text-violet-700 hover:underline" href={'tel:' + p.phone.replace(/[^\d+]/g, '')}>{p.phone}</a> : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="py-1.5 pr-2 whitespace-nowrap">{p.score != null ? p.score + '/' + p.total : '—'}</td>
                                <td className={'py-1.5 pr-2 font-semibold ' + pctTone(p.percent, c.threshold)}>{p.percent != null ? p.percent + '%' : '—'}</td>
                                <td className="py-1.5 pr-2 text-gray-600">{fmtMin(p.minutes)}</td>
                                <td className="py-1.5 pr-2"><ViolCell v={p.violations} T={T} /></td>
                                <td className="py-1.5 pr-2"><Badge cls={VERDICT_CLS[p.verdict || 'absent']}>{p.verdict_label || p.state_label}</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <AdminEmpty title={T.empty} />
          ) : null}

          {tab === 'kaf' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-[12px] border-b border-gray-100">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">{T.kafedra}</th>
                    <th className="py-2 pr-2">{T.positions}</th>
                    <th className="py-2 pr-2">{T.registered}</th>
                    <th className="py-2 pr-2">{T.completed}</th>
                    <th className="py-2 pr-2">{T.passed}</th>
                    <th className="py-2 pr-2">{T.notTaken}</th>
                    <th className="py-2 pr-2">{T.banned}</th>
                    <th className="py-2 pr-2">{T.recommended}</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.kafedras || []).map((k, i) => (
                    <tr key={k.kafedra_name} className="border-b border-gray-50">
                      <td className="py-2 pr-2 text-gray-400">{i + 1}</td>
                      <td className="py-2 pr-2 font-medium text-gray-900">{k.kafedra_name}</td>
                      <td className="py-2 pr-2">{k.positions}</td>
                      <td className="py-2 pr-2">{k.candidates}</td>
                      <td className="py-2 pr-2">{k.completed}</td>
                      <td className="py-2 pr-2 text-emerald-700">{k.passed}</td>
                      <td className={'py-2 pr-2 ' + (k.not_started ? 'text-amber-700' : 'text-gray-400')}>{k.not_started}</td>
                      <td className={'py-2 pr-2 ' + (k.banned ? 'text-rose-700' : 'text-gray-400')}>{k.banned}</td>
                      <td className="py-2 pr-2 font-semibold text-emerald-700">{k.recommended}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === 'nt' ? (
            (d.not_taken || []).length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 text-[12px] border-b border-gray-100">
                      <th className="py-2 pr-2">#</th>
                      <th className="py-2 pr-2">{T.person}</th>
                      <th className="py-2 pr-2">{T.phone}</th>
                      <th className="py-2 pr-2">{T.kafedra}</th>
                      <th className="py-2 pr-2">{T.state}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.not_taken || []).filter(match).map((p, i) => (
                      <tr key={p.student_id} className="border-b border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-400">{i + 1}</td>
                        <td className="py-1.5 pr-2 text-gray-900">{p.name}<div className="font-mono text-[11px] text-gray-400">{p.student_id}</div></td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          {p.phone ? <a className="text-violet-700 hover:underline" href={'tel:' + p.phone.replace(/[^\d+]/g, '')}>{p.phone}</a> : '—'}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-600">{p.kafedra_name}<div className="text-[11px] text-gray-400">{p.subject}</div></td>
                        <td className="py-1.5 pr-2"><Badge cls={STATE_CLS[p.state] || 'bg-gray-100 text-gray-600'}>{p.state_label}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <AdminEmpty title={T.empty} />
          ) : null}
        </div>
      </div>
    );
  };

  /* -------------------------------------------------------------- entrant */
  const entrantBody = (d: Report) => {
    const people = (d.people || []).filter(match);
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label={T.people} value={totals.people ?? 0} />
            <Stat label={T.completed} value={totals.completed ?? 0} />
            <Stat label={T.passed} value={totals.passed ?? 0} tone="text-emerald-700" />
            <Stat label={T.failed_} value={totals.failed ?? 0} tone="text-red-600" />
            <Stat label={T.avg} value={(totals.avg_percent ?? 0) + '%'} />
          </div>
          {(d.people || []).length > 3 ? <div className="mt-3">{searchBox}</div> : null}
        </div>
        {people.length ? people.map((p) => {
          const done = p.state === 'completed';
          const ident = p.identity || { verified_at: '', matched: null, score: null };
          const cons = p.consent || { at: '', version: '', ip: '', mic: null };
          return (
            <div key={p.student_exam_id ?? p.student_id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="flex flex-wrap items-center gap-4 px-5 py-4 border-b border-gray-100">
                <div className="grow min-w-[220px]">
                  <div className="text-[17px] font-semibold text-gray-900">{p.name}</div>
                  <div className="text-[12.5px] text-gray-500">
                    <span className="font-mono">{p.student_id}</span> · {p.exam_title}
                  </div>
                </div>
                <div className="text-right">
                  <div className={'text-3xl font-bold ' + (done ? (p.passed ? 'text-emerald-700' : 'text-red-600') : 'text-amber-700')}>
                    {done ? p.score + ' / ' + p.total : p.state_label}
                  </div>
                  {done ? (
                    <div className="text-[12.5px] text-gray-500">
                      {p.percent}% · {T.threshold} {p.threshold}%{' '}
                      <Badge cls={p.passed ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}>{p.passed ? T.passed : T.failed_}</Badge>
                    </div>
                  ) : null}
                </div>
                {p.certificate && p.student_exam_id ? (
                  <AdminBtn
                    variant="emerald"
                    size="sm"
                    loading={pdfBusy}
                    onClick={() => fetchBlob('/api/admin/student_exams/' + p.student_exam_id + '/certificate.pdf', 'sertifikat-' + p.student_id + '.pdf')}
                  >
                    {T.cert}
                  </AdminBtn>
                ) : null}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x divide-gray-100">
                <div className="p-5 space-y-3">
                  <div className="text-[13px] font-semibold text-gray-700">{T.subjects}</div>
                  {(p.subjects || []).length ? (p.subjects || []).map((s) => (
                    <div key={s.subject}>
                      <div className="flex justify-between text-[12.5px] mb-1">
                        <span className="text-gray-700">{s.subject}</span>
                        <span className={'font-semibold ' + pctTone(s.percent, p.threshold)}>{s.correct} / {s.total} ({s.percent}%)</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: s.percent + '%' }}
                          transition={{ duration: 0.6 }}
                          className={'h-full rounded-full ' + (s.percent >= (p.threshold || 60) ? 'bg-emerald-500' : s.percent >= (p.threshold || 60) - 15 ? 'bg-amber-500' : 'bg-red-500')}
                        />
                      </div>
                    </div>
                  )) : <div className="text-[12.5px] text-gray-400">{T.empty}</div>}
                  {p.subjects_exact === false ? <div className="text-[11.5px] text-gray-400">{T.approx}</div> : null}
                </div>
                <div className="p-5">
                  <div className="text-[13px] font-semibold text-gray-700 mb-2">{T.process}</div>
                  <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
                    <dt className="text-gray-500">{T.started}</dt><dd className="text-gray-800">{p.started_label || '—'}</dd>
                    <dt className="text-gray-500">{T.finished}</dt><dd className="text-gray-800">{p.completed_label || '—'}</dd>
                    <dt className="text-gray-500">{T.spent}</dt>
                    <dd className="text-gray-800">{p.minutes != null ? fmtMin(p.minutes) + ' ' + T.min + ' / ' + (p.duration_limit || 0) + ' ' + T.min : '—'}</dd>
                    <dt className="text-gray-500">{T.answered}</dt><dd className="text-gray-800">{(p.answered || 0) + ' / ' + p.total}</dd>
                    <dt className="text-gray-500">{T.identity}</dt>
                    <dd className={ident.matched === false ? 'text-red-600 font-semibold' : 'text-gray-800'}>
                      {(ident.verified_at || '—') + (ident.matched == null ? '' : ' · ' + (ident.matched ? T.matched : T.notMatched))}
                    </dd>
                    <dt className="text-gray-500">{T.consent}</dt><dd className="text-gray-800">{cons.at || T.notGiven}{cons.ip ? ' · IP ' + cons.ip : ''}</dd>
                    <dt className="text-gray-500">{T.mic}</dt><dd className="text-gray-800">{cons.mic == null ? '—' : Number(cons.mic).toFixed(3)}</dd>
                    <dt className="text-gray-500">{T.warnings}</dt><dd className="text-gray-800">{p.warnings}</dd>
                    <dt className="text-gray-500">{T.viol}</dt><dd><ViolCell v={p.violations} T={T} /></dd>
                    <dt className="text-gray-500">{T.resultId}</dt><dd className="font-mono text-gray-800">{p.result_id || '—'}</dd>
                  </dl>
                </div>
              </div>

              {(p.timeline || []).length ? (
                <div className="px-5 pb-5">
                  <div className="text-[13px] font-semibold text-gray-700 mb-2">{T.timeline}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(p.timeline || []).map((x, i) => (
                      <span key={i} className={'text-[11.5px] px-2 py-1 rounded-md border ' + (x.technical ? 'bg-gray-50 border-gray-200 text-gray-500' : 'bg-amber-50 border-amber-200 text-amber-800')}>
                        {x.at.slice(-5)} · {x.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        }) : <AdminEmpty title={T.empty} />}
      </div>
    );
  };

  let body: React.ReactNode = null;
  if (!seasons.length) body = <AdminEmpty title={T.noSeason} />;
  else if (loading && !data) body = <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-500">{T.loading}</div>;
  else if (error) body = <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2 text-sm">{error}</div>;
  else if (data && data.kind === 'ordinator') body = ordinatorBody(data);
  else if (data && data.kind === 'vacancy') body = vacancyBody(data);
  else if (data && data.kind === 'entrant') body = entrantBody(data);
  else if (data) body = <AdminEmpty title={T.empty} />;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {header}
      {body}
      {ev ? (
        <div
          className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-8"
          role="dialog"
          aria-modal="true"
          onClick={() => setEv(null)}
        >
          <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div>
                <div className="text-[15px] font-bold text-gray-900">{T.evidenceTitle}</div>
                <div className="text-[12.5px] text-gray-500">{ev.name} · {ev.exam_title}</div>
              </div>
              <AdminBtn variant="ghost" size="sm" onClick={() => setEv(null)}>{T.close}</AdminBtn>
            </div>
            {ev.summary ? (
              <div className="flex flex-wrap gap-2 border-b border-gray-100 px-5 py-3 text-[12px]">
                <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-700">{T.sumStatus}: <b>{ev.summary.state_label}</b></span>
                <span className={'rounded-md px-2 py-1 ' + ((ev.summary.official_warnings || 0) > 0 ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700')}>
                  {T.sumWarnings}: <b>{Math.min(ev.summary.official_warnings || 0, ev.summary.warning_limit || 3)} / {ev.summary.warning_limit || 3}</b>
                </span>
                <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-700">{T.sumRecords}: <b>{ev.summary.records}</b></span>
                {ev.summary.started ? <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-700">{T.sumStarted}: <b>{ev.summary.started}</b></span> : null}
                {ev.summary.ban_reason ? (
                  <span className="rounded-md bg-rose-100 px-2 py-1 text-rose-800">{T.sumBan}: <b>{ev.summary.ban_reason_label || ev.summary.ban_reason}</b></span>
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
              {ev.items.length ? ev.items.map((it, i) => (
                <div key={i} className={'rounded-lg border p-2 ' + (it.technical ? 'border-gray-200' : 'border-amber-200 bg-amber-50/40')}>
                  <div className="mb-1 flex justify-between gap-2 text-[12px]">
                    <span className="font-semibold text-gray-800">{it.label}</span>
                    <span className="whitespace-nowrap text-gray-500">{it.at}</span>
                  </div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {outcomeBadge(it.outcome)}
                    {it.elapsed ? <span className="text-gray-500">{it.elapsed} {T.sinceStart}</span> : null}
                  </div>
                  {it.detail || it.note ? (
                    <div className="mb-1.5 rounded-md bg-rose-50 px-2 py-1.5 text-[12px] break-words text-rose-800">
                      <b>{T.factLabel}:</b> {it.detail || it.note}
                    </div>
                  ) : null}
                  {it.image ? (
                    <img src={it.image} alt={it.label} className="w-full rounded-md border border-gray-100" />
                  ) : it.detail || it.note ? null : (
                    <div className="rounded-md bg-gray-50 py-6 text-center text-[12px] text-gray-400">{T.noImage}</div>
                  )}
                </div>
              )) : <div className="text-sm text-gray-500">{T.evidenceEmpty}</div>}
            </div>
            {ev.screens && ev.screens.length > 0 ? (
              <div className="border-t border-gray-100 p-5 space-y-5">
                {([
                  ['room', T.roomShots],
                  ['webcam', T.webcamShots],
                  ['screen', T.screens],
                ] as Array<[string, string]>).map(([kind, title]) => {
                  const list = (ev.screens || []).filter((sc) => (sc.kind || 'screen') === kind);
                  if (!list.length) return null;
                  return (
                    <div key={kind}>
                      <div className="mb-3 text-[13px] font-semibold text-gray-800">{title} ({list.length})</div>
                      <div className={`grid gap-3 ${kind === 'screen' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
                        {list.map((sc, i) => (
                          <div key={`${kind}-${i}`} className="rounded-lg border border-gray-200 p-2">
                            <div className="mb-1.5 text-right text-[11px] text-gray-500">{sc.at}</div>
                            <img src={sc.image} alt={sc.at} loading="lazy" className="w-full rounded-md border border-gray-100" />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}

export default AudienceReport;
