import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminBtn,
  AdminEmpty,
  AdminFileInput,
  AdminInput,
  AdminModal,
  AdminPagination,
  AdminSelect,
  AdminTextarea,
  usePagedList,
} from './ui';
import { AudienceReport, EvidenceModal, isTailoredAudience } from './AudienceReport';
import { PeopleDrillModal, type DrillPerson, type DrillState } from './PeopleDrill';

/*
 * Hisobotlar — bitta sahifa, bitta filtr paneli.
 *
 * Ilgari sahifa 8 ta tabdan iborat edi va "Umumiy / Kafedralar / Reyting"
 * natijalarni brauzerda har bir imtihon uchun alohida so'rov bilan yig'ardi
 * (56+ so'rov, har yangilashda boshqa son). Endi hammasi serverdagi tayyor
 * hisobotlardan olinadi: /reports/kafedra, /participants, /absent — bitta
 * mavsum uchun 4 ta so'rov, raqamlar PDF bilan bir xil.
 *
 * Filtrlar (toifa → mavsum → kafedra → qidiruv → holat) barcha bo'limlarga
 * birdan ta'sir qiladi; jadvallar ustun bo'yicha saralanadi; Excel eksport
 * joriy filtrlangan ma'lumotdan haqiqiy .xlsx yasaydi.
 */

interface Props { token: string; lang: Language; }

interface Season { key: string; label: string; audience: string; exam_count: number; course?: number; }

interface KafStatRow {
  kafedra_id: number;
  kafedra_name: string;
  total_teachers: number;
  participated: number;
  unfinished: number;
  not_participated: number;
  passed: number;
  failed: number;
  pass_percent: number;
  participation_percent: number;
}
interface KafStat { pass_threshold: number; kafedralar: KafStatRow[]; }

interface PartPerson {
  student_exam_id: number;
  student_id: string;
  name: string;
  subject: string;
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  completed_at?: string | null;
}
interface PartGroup { kafedra_id: number; kafedra_name: string; people: PartPerson[]; }
interface PartReport { pass_threshold: number; groups: PartGroup[]; }

interface AbsentPerson { student_id: string; name: string; state: string; student_exam_id?: number | null; ban_reason?: string; }
interface AbsentGroup { kafedra_id: number; kafedra_name: string; people: AbsentPerson[]; }
interface AbsentReport { absent_total: number; groups: AbsentGroup[]; }

interface ResultRow extends PartPerson { kafedra: string; }
interface AbsentRow extends AbsentPerson { kafedra: string; }

type Tab = 'overview' | 'kafedra' | 'results' | 'absent' | 'banned';
type SortDir = 'asc' | 'desc';
interface SortState { key: string; dir: SortDir; }

const AUD_ORDER = ['faculty', 'ordinator', 'magistr', 'student', 'vacancy', 'entrant'];

const TXT = {
  uz: {
    aud: { faculty: "O'qituvchilar", ordinator: 'Ordinatorlar', magistr: 'Magistrlar', student: 'Talabalar', vacancy: 'Ishga kiruvchilar', entrant: 'Maxsus kiruvchilar' } as Record<string, string>,
    audience: 'Toifa', season: 'Mavsum', kafedra: 'Kafedra', allKaf: 'Barcha kafedralar', search: "Ism yoki login bo'yicha qidirish",
    refresh: 'Yangilash', excel: 'Excel', pdf: 'PDF', busy: 'Tayyorlanmoqda…', loading: 'Hisobot yuklanmoqda…', loadErr: "Hisobotni yuklab bo'lmadi. Yangilab ko'ring.",
    noSeason: "Bu toifa bo'yicha hali imtihon mavsumi yo'q.",
    tOverview: 'Umumiy', tKafedra: 'Kafedralar', tResults: 'Natijalar', tAbsent: 'Qatnashmaganlar', tBanned: 'Chetlatilganlar',
    registered: "Ro'yxatda", participated: 'Qatnashdi', passed: "O'tdi", failed: "O'tmadi", notPart: 'Qatnashmadi', banned: 'Chetlatilgan', unfinished: 'Tugatmagan',
    coverage: 'qamrov', passRate: "o'tish", ofParticipants: 'qatnashganlardan',
    chartTitle: "Kafedralar bo'yicha", mPass: "O'tish %", mCov: 'Qamrov %', threshold: "O'tish chegarasi",
    topK: 'Eng yaxshi kafedralar', bottomK: 'Eng past kafedralar', noData: "Tanlangan filtr bo'yicha ma'lumot yo'q.",
    rank: '№', person: 'F.I.Sh.', login: 'Login', subject: 'Fan', score: 'Ball', percent: 'Foiz', status: 'Holat', date: 'Sana',
    all: 'Hammasi', editScore: "Ballni tuzatish", save: 'Saqlash', cancel: 'Bekor qilish', scoreRange: "Ball 0 va savollar soni oralig'ida bo'lsin",
    retake: 'Qayta ruxsat', retakeDone: 'Ruxsat berildi', retakeConfirm: 'Bu kishiga imtihonni qayta topshirishga ruxsat berilsinmi?',
    onlyActive: 'Faqat imtihon bo\'lgan kafedralar', subjectsN: 'ta fan (eng yaxshisi)', started: 'Boshlab, tugatmagan', notStarted: 'Kirmagan', retakeGranted: 'Qayta ruxsat berilgan — hali kirmagan',
    unban: 'Banni ochish', unbanReason: 'Sabab (kamida 8 belgi)', unbanFile: 'Asos hujjati (rasm yoki PDF)', chooseFile: 'Fayl tanlash', noFile: 'Fayl tanlanmagan',
    noBanned: "Chetlatilgan foydalanuvchi yo'q.", shown: "ko'rsatilmoqda",
    sheetKaf: 'Kafedralar', sheetRes: 'Natijalar', sheetAbs: 'Qatnashmaganlar', sheetBan: 'Chetlatilganlar',
  },
  ru: {
    aud: { faculty: 'Преподаватели', ordinator: 'Ординаторы', magistr: 'Магистранты', student: 'Студенты', vacancy: 'Кандидаты', entrant: 'Спец. поступающие' } as Record<string, string>,
    audience: 'Категория', season: 'Сезон', kafedra: 'Кафедра', allKaf: 'Все кафедры', search: 'Поиск по имени или логину',
    refresh: 'Обновить', excel: 'Excel', pdf: 'PDF', busy: 'Готовится…', loading: 'Загрузка отчёта…', loadErr: 'Не удалось загрузить отчёт. Обновите.',
    noSeason: 'Для этой категории ещё нет экзаменационных сезонов.',
    tOverview: 'Сводка', tKafedra: 'Кафедры', tResults: 'Результаты', tAbsent: 'Не участвовали', tBanned: 'Заблокированные',
    registered: 'В списке', participated: 'Участвовали', passed: 'Сдали', failed: 'Не сдали', notPart: 'Не участвовали', banned: 'Заблокированы', unfinished: 'Не завершили',
    coverage: 'охват', passRate: 'сдача', ofParticipants: 'от участников',
    chartTitle: 'По кафедрам', mPass: '% сдачи', mCov: '% охвата', threshold: 'Проходной порог',
    topK: 'Лучшие кафедры', bottomK: 'Слабые кафедры', noData: 'Нет данных по выбранному фильтру.',
    rank: '№', person: 'Ф.И.О.', login: 'Логин', subject: 'Предмет', score: 'Балл', percent: '%', status: 'Статус', date: 'Дата',
    all: 'Все', editScore: 'Исправить балл', save: 'Сохранить', cancel: 'Отмена', scoreRange: 'Балл должен быть от 0 до числа вопросов',
    retake: 'Разрешить пересдачу', retakeDone: 'Разрешено', retakeConfirm: 'Разрешить этому человеку пересдать экзамен?',
    onlyActive: 'Только кафедры с экзаменом', subjectsN: 'предм. (лучший)', started: 'Начал, не завершил', notStarted: 'Не входил', retakeGranted: 'Пересдача разрешена — ещё не входил',
    unban: 'Разблокировать', unbanReason: 'Причина (не менее 8 символов)', unbanFile: 'Документ-основание (фото или PDF)', chooseFile: 'Выбрать файл', noFile: 'Файл не выбран',
    noBanned: 'Заблокированных нет.', shown: 'показано',
    sheetKaf: 'Кафедры', sheetRes: 'Результаты', sheetAbs: 'Не участвовали', sheetBan: 'Заблокированные',
  },
  en: {
    aud: { faculty: 'Teachers', ordinator: 'Residents', magistr: 'Master students', student: 'Students', vacancy: 'Applicants', entrant: 'Special entrants' } as Record<string, string>,
    audience: 'Group', season: 'Season', kafedra: 'Department', allKaf: 'All departments', search: 'Search by name or login',
    refresh: 'Refresh', excel: 'Excel', pdf: 'PDF', busy: 'Preparing…', loading: 'Loading report…', loadErr: 'Could not load the report. Refresh to retry.',
    noSeason: 'No exam season for this group yet.',
    tOverview: 'Overview', tKafedra: 'Departments', tResults: 'Results', tAbsent: 'Did not take', tBanned: 'Banned',
    registered: 'Registered', participated: 'Took part', passed: 'Passed', failed: 'Failed', notPart: 'Did not take', banned: 'Banned', unfinished: 'Unfinished',
    coverage: 'coverage', passRate: 'pass rate', ofParticipants: 'of participants',
    chartTitle: 'By department', mPass: 'Pass %', mCov: 'Coverage %', threshold: 'Pass mark',
    topK: 'Strongest departments', bottomK: 'Weakest departments', noData: 'No data for the selected filter.',
    rank: '#', person: 'Full name', login: 'Login', subject: 'Subject', score: 'Score', percent: '%', status: 'Status', date: 'Date',
    all: 'All', editScore: 'Correct score', save: 'Save', cancel: 'Cancel', scoreRange: 'Score must be between 0 and the question count',
    retake: 'Allow retake', retakeDone: 'Allowed', retakeConfirm: 'Allow this person to retake the exam?',
    onlyActive: 'Only departments with an exam', subjectsN: 'subjects (best shown)', started: 'Started, not finished', notStarted: 'Never entered', retakeGranted: 'Retake granted — not entered yet',
    unban: 'Lift ban', unbanReason: 'Reason (at least 8 characters)', unbanFile: 'Supporting document (image or PDF)', chooseFile: 'Choose file', noFile: 'No file selected',
    noBanned: 'No banned users.', shown: 'shown',
    sheetKaf: 'Departments', sheetRes: 'Results', sheetAbs: 'Did not take', sheetBan: 'Banned',
  },
};

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const stamp = () => new Date().toISOString().slice(0, 10);

function sortRows<T>(rows: T[], s: SortState, get: Record<string, (r: T) => string | number>): T[] {
  const g = get[s.key];
  if (!g) return rows;
  const mul = s.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = g(a);
    const y = g(b);
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * mul;
    return String(x).localeCompare(String(y), 'uz') * mul;
  });
}

function SortTh({
  label, k, sort, onSort, align = 'left', className = '',
}: {
  label: string; k: string; sort: SortState; onSort: (s: SortState) => void; align?: 'left' | 'right'; className?: string;
}) {
  const active = sort.key === k;
  return (
    <th className={`py-2.5 px-3 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button
        type="button"
        onClick={() => onSort({ key: k, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
        className={`inline-flex items-center gap-1 rounded-md -mx-1 px-1 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 ${
          active ? 'text-gray-900' : ''
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        {label}
        <span className={`text-[10px] ${active ? 'text-indigo-600' : 'text-gray-300'}`} aria-hidden>
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
        ok ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15' : 'bg-red-50 text-red-700 ring-1 ring-red-600/15'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {children}
    </span>
  );
}

function Bar({ value, tone = 'bg-indigo-600' }: { value: number; tone?: string }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

async function saveBlob(res: Response, filename: string) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type Cell = string | number;
interface Sheet { title: string; columns: string[]; rows: Cell[][]; }

function csvFallback(filename: string, sheets: Sheet[]) {
  const esc = (v: Cell) => {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const body = sheets
    .map((s) => [s.title, s.columns.map(esc).join(';'), ...s.rows.map((r) => r.map(esc).join(';'))].join('\r\n'))
    .join('\r\n\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/\.xlsx$/, '.csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ReportsPage({ token, lang }: Props) {
  const t = TXT[lang] || TXT.uz;

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonsLoaded, setSeasonsLoaded] = useState(false);
  const [audience, setAudience] = useState('');
  const [seasonKey, setSeasonKey] = useState('');

  const [kafStat, setKafStat] = useState<KafStat | null>(null);
  const [part, setPart] = useState<PartReport | null>(null);
  const [absent, setAbsent] = useState<AbsentReport | null>(null);
  /** Kartochka raqamlari BARCHA imtihonli kafedralardan hisoblanadi — ro'yxat oynasi ham to'liq ro'yxatdan olinadi. */
  const [absentFull, setAbsentFull] = useState<AbsentReport | null>(null);
  const [banned, setBanned] = useState<Array<{ id: string; name: string }>>([]);
  const [absentAll, setAbsentAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [tab, setTab] = useState<Tab>('overview');
  /** Kartochka/jadval raqami bosilganda ochiladigan odamlar ro'yxati. */
  const [drill, setDrill] = useState<DrillState | null>(null);
  /** Dalillar (nazorat qaydlari) oynasi — natija qatoridagi tugmadan. */
  const [evSe, setEvSe] = useState<number | null>(null);
  const [kafF, setKafF] = useState('');
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState<'all' | 'passed' | 'failed'>('all');
  const [metric, setMetric] = useState<'pass' | 'cov'>('pass');
  const [kafSort, setKafSort] = useState<SortState>({ key: 'pass', dir: 'desc' });
  const [resSort, setResSort] = useState<SortState>({ key: 'percent', dir: 'desc' });
  const [absSort, setAbsSort] = useState<SortState>({ key: 'kafedra', dir: 'asc' });

  const [busy, setBusy] = useState<'' | 'pdf' | 'xlsx'>('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState('');
  const [retaken, setRetaken] = useState<Record<number, boolean>>({});
  const [unbanFor, setUnbanFor] = useState<{ id: string; name: string } | null>(null);
  const [unbanReason, setUnbanReason] = useState('');
  const [unbanFile, setUnbanFile] = useState<File | null>(null);
  const [unbanErr, setUnbanErr] = useState('');

  const h = useMemo(() => ({ headers: authHeaders(token, lang) }), [token, lang]);

  /* ── Mavsumlar ─────────────────────────────────────────────────────────── */
  const loadSeasons = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/admin/reports/seasons'), h);
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<{ seasons?: Season[] }>(res);
      const list = Array.isArray(j?.seasons) ? j!.seasons : [];
      setSeasons(list);
      setAudience((a) => (a && list.some((s) => s.audience === a) ? a : list[0]?.audience || 'faculty'));
    } finally {
      setSeasonsLoaded(true);
    }
  }, [h]);

  useEffect(() => { loadSeasons(); }, [loadSeasons]);

  const audiences = useMemo(() => {
    const present = new Set(seasons.map((s) => s.audience));
    return AUD_ORDER.filter((a) => present.has(a));
  }, [seasons]);

  const ownSeasons = useMemo(() => seasons.filter((s) => s.audience === audience), [seasons, audience]);

  useEffect(() => {
    if (!ownSeasons.some((s) => s.key === seasonKey)) setSeasonKey(ownSeasons[0]?.key || '');
  }, [ownSeasons, seasonKey]);

  useEffect(() => {
    setKafF(''); setQ(''); setStatusF('all'); setEditId(null);
  }, [audience, seasonKey]);

  const tailored = isTailoredAudience(audience);

  /* ── Hisobot ma'lumoti (kafedra kesimidagi toifalar) ────────────────────── */
  const loadReport = useCallback(async () => {
    if (!seasonKey || tailored) return;
    setLoading(true);
    setError('');
    const sq = '?season=' + encodeURIComponent(seasonKey);
    try {
      const [kr, pr, ar, br, fr] = await Promise.all([
        fetch(apiUrl('/api/admin/reports/kafedra' + sq), h),
        fetch(apiUrl('/api/admin/reports/participants' + sq), h),
        fetch(apiUrl('/api/admin/reports/absent' + sq + (absentAll ? '&all=1' : '')), h),
        fetch(apiUrl('/api/admin/users?role=' + encodeURIComponent(audience) + '&status=Banned&limit=500'), h),
        fetch(apiUrl('/api/admin/reports/absent' + sq + '&all=1'), h),
      ]);
      if (![kr, pr, ar, br].every((r) => checkAdminAuthResponse(r))) return;
      const [kj, pj, aj, bj] = await Promise.all([
        readJsonSafe<KafStat>(kr), readJsonSafe<PartReport>(pr), readJsonSafe<AbsentReport>(ar), readJsonSafe<any>(br),
      ]);
      setKafStat(kr.ok && kj && Array.isArray(kj.kafedralar) ? kj : null);
      setPart(pr.ok && pj && Array.isArray(pj.groups) ? pj : null);
      setAbsent(ar.ok && aj && Array.isArray(aj.groups) ? aj : null);
      const fj = fr.ok ? await readJsonSafe<AbsentReport>(fr) : null;
      setAbsentFull(fj && Array.isArray(fj.groups) ? fj : null);
      const banArr = Array.isArray(bj) ? bj : (bj && bj.results) || [];
      setBanned(br.ok ? banArr.map((b: any) => ({ id: String(b.id), name: String(b.name || b.id) })) : []);
      if (!kr.ok || !pr.ok) setError(t.loadErr);
    } catch {
      setError(t.loadErr);
    } finally {
      setLoading(false);
    }
  }, [seasonKey, tailored, absentAll, audience, h, t.loadErr]);

  useEffect(() => { loadReport(); }, [loadReport]);

  /* ── Filtrlangan ko'rinishlar ──────────────────────────────────────────── */
  const kafOptions = useMemo(() => {
    const names = new Set<string>();
    kafStat?.kafedralar.forEach((k) => k.kafedra_name && names.add(k.kafedra_name));
    part?.groups.forEach((g) => g.kafedra_name && names.add(g.kafedra_name));
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'uz'));
  }, [kafStat, part]);

  const needle = q.trim().toLowerCase();
  const matchPerson = (name: string, login: string) =>
    !needle || name.toLowerCase().includes(needle) || login.toLowerCase().includes(needle);

  const kafRows = useMemo(
    () => (kafStat?.kafedralar || []).filter((k) => !kafF || k.kafedra_name === kafF),
    [kafStat, kafF],
  );

  const totals = useMemo(() => {
    const s = kafRows.reduce(
      (a, k) => ({
        reg: a.reg + k.total_teachers, part: a.part + k.participated, passed: a.passed + k.passed,
        failed: a.failed + k.failed, notPart: a.notPart + k.not_participated, unfinished: a.unfinished + k.unfinished,
      }),
      { reg: 0, part: 0, passed: 0, failed: 0, notPart: 0, unfinished: 0 },
    );
    return { ...s, cov: pct(s.part, s.reg), passPct: pct(s.passed, s.passed + s.failed) };
  }, [kafRows]);

  const kafSorted = useMemo(
    () =>
      sortRows(kafRows, kafSort, {
        name: (k) => k.kafedra_name, reg: (k) => k.total_teachers, part: (k) => k.participated,
        passed: (k) => k.passed, failed: (k) => k.failed, notPart: (k) => k.not_participated,
        pass: (k) => (k.participated ? k.pass_percent : -1), cov: (k) => k.participation_percent,
      }),
    [kafRows, kafSort],
  );

  const resultRows = useMemo<ResultRow[]>(() => {
    const out: ResultRow[] = [];
    (part?.groups || []).forEach((g) => {
      if (kafF && g.kafedra_name !== kafF) return;
      g.people.forEach((p) => {
        if (!matchPerson(p.name, p.student_id)) return;
        if (statusF === 'passed' && !p.passed) return;
        if (statusF === 'failed' && p.passed) return;
        out.push({ ...p, kafedra: g.kafedra_name });
      });
    });
    return sortRows(out, resSort, {
      name: (r) => r.name, kafedra: (r) => r.kafedra, subject: (r) => r.subject,
      score: (r) => r.score, percent: (r) => r.percent, date: (r) => r.completed_at || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part, kafF, needle, statusF, resSort]);

  const absentRows = useMemo<AbsentRow[]>(() => {
    const out: AbsentRow[] = [];
    (absent?.groups || []).forEach((g) => {
      if (kafF && g.kafedra_name !== kafF) return;
      g.people.forEach((p) => {
        if (matchPerson(p.name, p.student_id)) out.push({ ...p, kafedra: g.kafedra_name });
      });
    });
    return sortRows(out, absSort, { name: (r) => r.name, kafedra: (r) => r.kafedra, state: (r) => r.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absent, kafF, needle, absSort]);

  const bannedRows = useMemo(
    () => banned.filter((b) => matchPerson(b.name, b.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [banned, needle],
  );

  const resPaged = usePagedList(resultRows, 50);
  const absPaged = usePagedList(absentRows, 50);

  const threshold = part?.pass_threshold ?? kafStat?.pass_threshold ?? 60;
  const participantsTotal = (part?.groups || []).reduce((s, g) => s + g.people.length, 0);

  /* ── Raqam ortidagi odamlar ──────────────────────────────────────────── */
  type DrillKind = 'reg' | 'part' | 'passed' | 'failed' | 'notPart' | 'unfinished' | 'banned';
  const drillPeople = (kind: DrillKind, kafedra: string): DrillPerson[] => {
    const inKaf = (name: string) => !kafedra || name === kafedra;
    // Kartochka ODAM bo'yicha sanaydi (bir kishi bir nechta fandan topshirgan bo'lsa ham
    // bitta, eng yaxshi natijasi bilan) — ro'yxat ham xuddi shunday bo'lsin.
    const results: DrillPerson[] = [];
    (part?.groups || []).forEach((g) => {
      if (!inKaf(g.kafedra_name)) return;
      const best = new Map<string, { p: PartPerson; n: number }>();
      g.people.forEach((p) => {
        const cur = best.get(p.student_id);
        if (!cur) best.set(p.student_id, { p, n: 1 });
        else best.set(p.student_id, { p: p.percent > cur.p.percent ? p : cur.p, n: cur.n + 1 });
      });
      best.forEach(({ p, n }) => {
        if (kind === 'passed' && !p.passed) return;
        if (kind === 'failed' && p.passed) return;
        results.push({
          key: 'r' + g.kafedra_id + ':' + p.student_id, name: p.name, login: p.student_id, group: g.kafedra_name,
          status: p.passed ? t.passed : t.failed, statusTone: p.passed ? 'good' : 'bad',
          value: `${p.score}/${p.total} · ${p.percent}%` + (n > 1 ? ` · ${n} ${t.subjectsN}` : ''),
        });
      });
    });
    const absentees: DrillPerson[] = [];
    (absentFull || absent)?.groups.forEach((g) => {
      if (!inKaf(g.kafedra_name)) return;
      g.people.forEach((p) => {
        const started = p.state === 'unfinished';
        const granted = p.state === 'retake_granted';
        // Kartochkadagi "qatnashmagan" = umuman kirmaganlar; boshlab tugatmaganlar alohida (+N).
        if (kind === 'notPart' && started) return;
        if (kind === 'unfinished' && !started) return;
        absentees.push({
          key: 'a' + g.kafedra_id + ':' + p.student_id, name: p.name, login: p.student_id, group: g.kafedra_name,
          status: started ? t.started : granted ? t.retakeGranted : t.notStarted,
          statusTone: started ? 'warn' : granted ? 'good' : 'muted',
        });
      });
    });
    const bannedPeople: DrillPerson[] = kafedra
      ? []
      : banned.map((b) => ({ key: 'b' + b.id, name: b.name, login: b.id, status: t.banned, statusTone: 'bad' as const }));
    if (kind === 'part' || kind === 'passed' || kind === 'failed') return results;
    if (kind === 'notPart' || kind === 'unfinished') return absentees;
    if (kind === 'banned') return bannedPeople;
    return [...results, ...absentees];
  };
  const openDrill = (kind: DrillKind, label: string, kafedra = kafF) =>
    setDrill({ title: kafedra ? `${label} · ${kafedra}` : label, people: drillPeople(kind, kafedra) });
  const numBtn = 'rounded px-1 tabular-nums underline-offset-2 hover:bg-indigo-50 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30';

  /* ── Amallar ──────────────────────────────────────────────────────────── */
  const saveScore = async (row: ResultRow) => {
    const n = Number(editVal);
    if (!Number.isFinite(n) || n < 0 || n > row.total) { setEditErr(t.scoreRange); return; }
    setEditBusy(true); setEditErr('');
    try {
      const res = await fetch(apiUrl('/api/admin/student_exams/' + row.student_exam_id + '/score'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({ score: n }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<any>(res);
      if (!res.ok) { setEditErr(String((d && d.error) || 'error')); return; }
      setPart((p) => p && {
        ...p,
        groups: p.groups.map((g) => ({
          ...g,
          people: g.people.map((x) => {
            if (x.student_exam_id !== row.student_exam_id) return x;
            const percent = pct(n, x.total);
            return { ...x, score: n, percent, passed: percent >= p.pass_threshold };
          }),
        })),
      });
      setEditId(null); setEditVal('');
    } finally {
      setEditBusy(false);
    }
  };

  const allowRetake = async (seId: number) => {
    if (!window.confirm(t.retakeConfirm)) return;
    const res = await fetch(apiUrl('/api/admin/student_exams/' + seId + '/retake'), { method: 'POST', headers: authHeaders(token, lang) });
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) setRetaken((m) => ({ ...m, [seId]: true }));
  };

  const doUnban = async () => {
    if (!unbanFor) return;
    if (unbanReason.trim().length < 8) { setUnbanErr(t.unbanReason); return; }
    if (!unbanFile) { setUnbanErr(t.unbanFile); return; }
    const fd = new FormData();
    fd.append('reason', unbanReason.trim());
    fd.append('evidence', unbanFile);
    const res = await fetch(apiUrl('/api/admin/users/' + encodeURIComponent(unbanFor.id) + '/unban'), {
      method: 'POST', headers: authHeaders(token, lang), body: fd,
    });
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      setBanned((b) => b.filter((x) => x.id !== unbanFor.id));
      setUnbanFor(null); setUnbanReason(''); setUnbanFile(null); setUnbanErr('');
    } else {
      const d = await readJsonSafe<any>(res);
      setUnbanErr(String((d && d.error) || 'error'));
    }
  };

  const seasonLabel = ownSeasons.find((s) => s.key === seasonKey)?.label || '';

  const downloadPdf = async () => {
    const sq = '?season=' + encodeURIComponent(seasonKey);
    const [path, name] =
      tab === 'results' ? ['/api/admin/reports/participants.pdf' + sq, 'natijalar']
        : tab === 'absent' ? ['/api/admin/reports/absent.pdf' + sq + (absentAll ? '&all=1' : ''), 'qatnashmaganlar']
          : ['/api/admin/reports/full.pdf' + sq, 'hisobot'];
    setBusy('pdf');
    try {
      const res = await fetch(apiUrl(path), h);
      if (checkAdminAuthResponse(res) && res.ok) await saveBlob(res, `${name}-${stamp()}.pdf`);
    } finally {
      setBusy('');
    }
  };

  const downloadExcel = async () => {
    const pctCell = (v: number) => v;
    const sheets: Sheet[] = [
      {
        title: t.sheetKaf,
        columns: [t.rank, t.kafedra, t.registered, t.participated, t.unfinished, t.notPart, t.passed, t.failed, t.mPass, t.mCov],
        rows: kafSorted.map((k, i) => [
          i + 1, k.kafedra_name, k.total_teachers, k.participated, k.unfinished, k.not_participated,
          k.passed, k.failed, pctCell(k.pass_percent), pctCell(k.participation_percent),
        ]),
      },
      {
        title: t.sheetRes,
        columns: [t.rank, t.person, t.login, t.kafedra, t.subject, t.score, t.percent, t.status, t.date],
        rows: resultRows.map((r, i) => [
          i + 1, r.name, r.student_id, r.kafedra, r.subject, `${r.score}/${r.total}`, r.percent,
          r.passed ? t.passed : t.failed, (r.completed_at || '').slice(0, 16).replace('T', ' '),
        ]),
      },
      {
        title: t.sheetAbs,
        columns: [t.rank, t.person, t.login, t.kafedra, t.status],
        rows: absentRows.map((r, i) => [i + 1, r.name, r.student_id, r.kafedra, r.state === 'unfinished' ? t.started : r.state === 'retake_granted' ? t.retakeGranted : t.notStarted]),
      },
      {
        title: t.sheetBan,
        columns: [t.rank, t.person, t.login],
        rows: bannedRows.map((b, i) => [i + 1, b.name, b.id]),
      },
    ];
    const title = [t.aud[audience] || audience, seasonLabel, kafF].filter(Boolean).join(' · ');
    const filename = `hisobot-${audience}-${stamp()}.xlsx`;
    setBusy('xlsx');
    try {
      const res = await fetch(apiUrl('/api/admin/reports/xlsx'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({ title, filename, sheets }),
      });
      if (!checkAdminAuthResponse(res)) return;
      if (res.ok) await saveBlob(res, filename);
      else csvFallback(filename, sheets);
    } catch {
      csvFallback(filename, sheets);
    } finally {
      setBusy('');
    }
  };

  /* ── Ko'rinish ────────────────────────────────────────────────────────── */
  const tabs: Array<[Tab, string, number | null]> = [
    ['overview', t.tOverview, null],
    ['kafedra', t.tKafedra, kafRows.length],
    ['results', t.tResults, resultRows.length],
    ['absent', t.tAbsent, absentRows.length],
    ['banned', t.tBanned, bannedRows.length],
  ];

  const toolbar = (
    <section className={`${CARD} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={t.audience}>
        {audiences.map((a) => {
          const on = a === audience;
          return (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => { setAudience(a); setTab('overview'); }}
              className={`h-9 rounded-full px-4 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 ${
                on ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t.aud[a] || a}
              <span className={`ml-1.5 tabular-nums ${on ? 'text-white/70' : 'text-gray-400'}`}>
                {seasons.filter((s) => s.audience === a).length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
        <label className="block min-w-0">
          <span className="mb-1.5 block text-[12px] font-semibold text-gray-500">{t.season}</span>
          <AdminSelect value={seasonKey} onChange={(e) => setSeasonKey(e.target.value)} disabled={!ownSeasons.length}>
            {ownSeasons.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </AdminSelect>
        </label>
        {!tailored ? (
          <>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-[12px] font-semibold text-gray-500">{t.kafedra}</span>
              <AdminSelect value={kafF} onChange={(e) => setKafF(e.target.value)} disabled={!kafOptions.length}>
                <option value="">{t.allKaf}</option>
                {kafOptions.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </AdminSelect>
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-[12px] font-semibold text-gray-500">{t.search}</span>
              <AdminInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="…" />
            </label>
            <div className="flex items-end gap-2">
              <AdminBtn variant="ghost" onClick={() => { loadSeasons(); loadReport(); }} disabled={loading}>{t.refresh}</AdminBtn>
              <AdminBtn variant="ghost" onClick={downloadPdf} loading={busy === 'pdf'} disabled={!seasonKey || !!busy || tab === 'banned'}>
                {t.pdf}
              </AdminBtn>
              <AdminBtn variant="blue" onClick={downloadExcel} loading={busy === 'xlsx'} disabled={!seasonKey || !!busy || loading}>
                {t.excel}
              </AdminBtn>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );

  if (seasonsLoaded && !seasons.length) {
    return <div className={CARD}><AdminEmpty title={t.noSeason} /></div>;
  }

  if (tailored) {
    return (
      <div className="space-y-5">
        {toolbar}
        {seasonKey ? (
          <AudienceReport
            embedded
            token={token}
            lang={lang}
            audience={audience}
            audienceOptions={audiences.map((a) => ({ value: a, label: t.aud[a] || a }))}
            onAudience={setAudience}
            seasons={ownSeasons}
            seasonKey={seasonKey}
            onSeason={setSeasonKey}
          />
        ) : null}
      </div>
    );
  }

  const chartRows = [...kafRows]
    .filter((k) => (metric === 'pass' ? k.participated > 0 : k.total_teachers > 0))
    .sort((a, b) =>
      metric === 'pass' ? b.pass_percent - a.pass_percent : b.participation_percent - a.participation_percent,
    );
  const ranked = [...kafRows].filter((k) => k.participated > 0).sort((a, b) => b.pass_percent - a.pass_percent);

  const kpis = [
    { kind: 'reg' as DrillKind, label: t.registered, value: fmt(totals.reg), sub: seasonLabel, tone: 'text-gray-900' },
    { kind: 'part' as DrillKind, label: t.participated, value: fmt(totals.part), sub: `${totals.cov}% ${t.coverage}`, tone: 'text-gray-900' },
    { kind: 'passed' as DrillKind, label: t.passed, value: fmt(totals.passed), sub: `${totals.passPct}% ${t.ofParticipants}`, tone: 'text-emerald-700' },
    { kind: 'failed' as DrillKind, label: t.failed, value: fmt(totals.failed), sub: `${100 - totals.passPct}% ${t.ofParticipants}`, tone: 'text-red-600' },
    { kind: 'notPart' as DrillKind, label: t.notPart, value: fmt(totals.notPart), sub: totals.unfinished ? `${fmt(totals.unfinished)} ${t.unfinished.toLowerCase()}` : '', tone: 'text-amber-600' },
    { kind: 'banned' as DrillKind, label: t.banned, value: fmt(banned.length), sub: t.aud[audience] || '', tone: 'text-gray-900' },
  ];

  const th = 'bg-gray-50/80 text-[12px] text-gray-500 border-b border-gray-200';
  const td = 'py-2.5 px-3 border-b border-gray-100';

  return (
    <div className="space-y-5">
      {toolbar}
      <PeopleDrillModal lang={lang} drill={drill} onClose={() => setDrill(null)} groupLabel={t.kafedra} token={token} />
      <EvidenceModal token={token} lang={lang} seId={evSe} onClose={() => setEvSe(null)} />

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13.5px] font-medium text-amber-800">{error}</div>
      ) : null}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <button
            type="button"
            key={k.label}
            onClick={() => openDrill(k.kind, k.label)}
            disabled={loading}
            className={`${CARD} px-4 py-4 text-left transition-shadow hover:border-indigo-300 hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 disabled:cursor-wait`}
          >
            <p className="text-[12.5px] font-semibold text-gray-500">{k.label}</p>
            {loading && !kafStat ? (
              <span className="mt-2 block h-7 w-16 animate-pulse rounded-md bg-gray-100" />
            ) : (
              <p className={`mt-1.5 font-display text-[26px] font-extrabold leading-none tracking-tight tabular-nums ${k.tone}`}>{k.value}</p>
            )}
            <p className="mt-1.5 truncate text-[12px] text-gray-400">{k.sub || ' '}</p>
          </button>
        ))}
      </div>

      {/* Bo'limlar */}
      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-3 sm:px-4">
          <div className="-mb-px flex overflow-x-auto" role="tablist">
            {tabs.map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`whitespace-nowrap border-b-2 px-3 py-3.5 text-[13.5px] font-semibold transition-colors focus:outline-none focus-visible:text-indigo-700 ${
                  tab === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {label}
                {n != null ? (
                  <span className={`ml-1.5 rounded-full px-1.5 py-px text-[11.5px] tabular-nums ${tab === k ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                    {fmt(n)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 py-2">
            {tab === 'results' ? (
              <div className="flex rounded-lg bg-gray-100 p-0.5">
                {(['all', 'passed', 'failed'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusF(s)}
                    className={`h-8 rounded-md px-3 text-[12.5px] font-semibold ${statusF === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                  >
                    {s === 'all' ? t.all : s === 'passed' ? t.passed : t.failed}
                  </button>
                ))}
              </div>
            ) : null}
            {tab === 'absent' ? (
              <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-gray-600">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-indigo-600)]" checked={!absentAll} onChange={(e) => setAbsentAll(!e.target.checked)} />
                {t.onlyActive}
              </label>
            ) : null}
            <span className="hidden text-[12px] text-gray-400 md:inline">{t.threshold}: {threshold}%</span>
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-14 text-center text-[13.5px] text-gray-500">{t.loading}</div>
        ) : null}

        {/* Umumiy */}
        {!loading && tab === 'overview' ? (
          kafRows.length ? (
            <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="border-b border-gray-100 p-5 lg:border-b-0 lg:border-r">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-bold text-gray-900">{t.chartTitle}</h3>
                  <div className="flex rounded-lg bg-gray-100 p-0.5">
                    {(['pass', 'cov'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMetric(m)}
                        className={`h-7 rounded-md px-2.5 text-[12px] font-semibold ${metric === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                      >
                        {m === 'pass' ? t.mPass : t.mCov}
                      </button>
                    ))}
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {chartRows.map((k) => {
                    const v = metric === 'pass' ? k.pass_percent : k.participation_percent;
                    return (
                      <li key={k.kafedra_id}>
                        <button
                          type="button"
                          onClick={() => { setKafF(k.kafedra_name); setTab('results'); }}
                          className="group grid w-full grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-3 gap-y-1 rounded-lg px-1 py-0.5 text-left hover:bg-gray-50"
                          title={k.kafedra_name}
                        >
                          <span className="truncate text-[13px] text-gray-700 group-hover:text-gray-900">{k.kafedra_name}</span>
                          <span className="row-span-2 self-center text-right font-display text-[14px] font-bold tabular-nums text-gray-900">{v}%</span>
                          <Bar value={v} tone={metric === 'pass' ? 'bg-indigo-600' : 'bg-sky-400'} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="divide-y divide-gray-100">
                {([[t.topK, ranked.slice(0, 5), 'text-emerald-700'], [t.bottomK, ranked.slice(-5).reverse(), 'text-red-600']] as Array<[string, KafStatRow[], string]>).map(
                  ([label, list, tone]) => (
                    <div key={label} className="p-5">
                      <h3 className="mb-3 text-[14px] font-bold text-gray-900">{label}</h3>
                      <ol className="space-y-2">
                        {list.map((k, i) => (
                          <li key={k.kafedra_id} className="flex items-center gap-3 text-[13px]">
                            <span className="w-4 text-right tabular-nums text-gray-400">{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-gray-700">{k.kafedra_name}</span>
                            <span className="tabular-nums text-gray-400">{k.passed}/{k.participated}</span>
                            <span className={`w-10 text-right font-bold tabular-nums ${tone}`}>{k.pass_percent}%</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ),
                )}
              </div>
            </div>
          ) : <AdminEmpty title={t.noData} />
        ) : null}

        {/* Kafedralar */}
        {!loading && tab === 'kafedra' ? (
          kafSorted.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13.5px]">
                <thead className={th}>
                  <tr>
                    <th className="py-2.5 px-3 text-left font-semibold w-10">{t.rank}</th>
                    <SortTh label={t.kafedra} k="name" sort={kafSort} onSort={setKafSort} />
                    <SortTh label={t.registered} k="reg" sort={kafSort} onSort={setKafSort} align="right" />
                    <SortTh label={t.participated} k="part" sort={kafSort} onSort={setKafSort} align="right" />
                    <SortTh label={t.passed} k="passed" sort={kafSort} onSort={setKafSort} align="right" />
                    <SortTh label={t.failed} k="failed" sort={kafSort} onSort={setKafSort} align="right" />
                    <SortTh label={t.notPart} k="notPart" sort={kafSort} onSort={setKafSort} align="right" />
                    <SortTh label={t.mPass} k="pass" sort={kafSort} onSort={setKafSort} className="w-44" />
                    <SortTh label={t.mCov} k="cov" sort={kafSort} onSort={setKafSort} className="w-44" />
                  </tr>
                </thead>
                <tbody>
                  {kafSorted.map((k, i) => (
                    <tr key={k.kafedra_id} className="hover:bg-gray-50/70">
                      <td className={`${td} tabular-nums text-gray-400`}>{i + 1}</td>
                      <td className={`${td} font-semibold text-gray-900`}>
                        <button type="button" className="text-left hover:text-indigo-700 hover:underline" onClick={() => { setKafF(k.kafedra_name); setTab('results'); }}>
                          {k.kafedra_name}
                        </button>
                      </td>
                      <td className={`${td} text-right`}><button type="button" className={numBtn} onClick={() => openDrill('reg', t.registered, k.kafedra_name)}>{k.total_teachers}</button></td>
                      <td className={`${td} text-right`}><button type="button" className={numBtn} onClick={() => openDrill('part', t.participated, k.kafedra_name)}>{k.participated}</button></td>
                      <td className={`${td} text-right text-emerald-700`}><button type="button" className={numBtn} onClick={() => openDrill('passed', t.passed, k.kafedra_name)}>{k.passed}</button></td>
                      <td className={`${td} text-right text-red-600`}><button type="button" className={numBtn} onClick={() => openDrill('failed', t.failed, k.kafedra_name)}>{k.failed}</button></td>
                      <td className={`${td} text-right tabular-nums text-gray-500`}>
                        <button type="button" className={numBtn} onClick={() => openDrill('notPart', t.notPart, k.kafedra_name)}>{k.not_participated}</button>
                        {k.unfinished ? (
                          <button type="button" className={`${numBtn} ml-1 text-amber-600`} onClick={() => openDrill('unfinished', t.started, k.kafedra_name)}>(+{k.unfinished})</button>
                        ) : null}
                      </td>
                      <td className={td}>
                        {k.participated ? (
                          <div className="flex items-center gap-2"><Bar value={k.pass_percent} /><span className="w-10 text-right font-bold tabular-nums">{k.pass_percent}%</span></div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className={td}>
                        <div className="flex items-center gap-2"><Bar value={k.participation_percent} tone="bg-sky-400" /><span className="w-10 text-right tabular-nums text-gray-600">{k.participation_percent}%</span></div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <AdminEmpty title={t.noData} />
        ) : null}

        {/* Natijalar */}
        {!loading && tab === 'results' ? (
          resultRows.length ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-[13.5px]">
                  <thead className={th}>
                    <tr>
                      <th className="py-2.5 px-3 text-left font-semibold w-10">{t.rank}</th>
                      <SortTh label={t.person} k="name" sort={resSort} onSort={setResSort} />
                      <SortTh label={t.kafedra} k="kafedra" sort={resSort} onSort={setResSort} />
                      <SortTh label={t.subject} k="subject" sort={resSort} onSort={setResSort} />
                      <SortTh label={t.score} k="score" sort={resSort} onSort={setResSort} align="right" />
                      <SortTh label={t.percent} k="percent" sort={resSort} onSort={setResSort} align="right" />
                      <th className="py-2.5 px-3 text-left font-semibold">{t.status}</th>
                      <SortTh label={t.date} k="date" sort={resSort} onSort={setResSort} />
                      <th className="py-2.5 px-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {resPaged.pageItems.map((r, i) => (
                      <tr key={r.student_exam_id} className="hover:bg-gray-50/70">
                        <td className={`${td} tabular-nums text-gray-400`}>{(resPaged.page - 1) * resPaged.pageSize + i + 1}</td>
                        <td className={td}>
                          <div className="font-semibold text-gray-900">{r.name}</div>
                          <div className="font-mono text-[11.5px] text-gray-400">{r.student_id}</div>
                        </td>
                        <td className={`${td} max-w-[220px] truncate text-gray-600`} title={r.kafedra}>{r.kafedra}</td>
                        <td className={`${td} max-w-[220px] truncate text-gray-600`} title={r.subject}>{r.subject}</td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                          {editId === r.student_exam_id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <input
                                type="number" min={0} max={r.total} autoFocus value={editVal}
                                onChange={(e) => setEditVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveScore(r);
                                  if (e.key === 'Escape') { setEditId(null); setEditErr(''); }
                                }}
                                className="h-8 w-16 rounded-md border border-gray-300 px-2 text-right text-[13px] focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
                                aria-label={t.editScore}
                              />
                              <span className="text-gray-400">/{r.total}</span>
                              <AdminBtn variant="emerald" size="sm" loading={editBusy} onClick={() => saveScore(r)}>{t.save}</AdminBtn>
                              <AdminBtn variant="ghost" size="sm" onClick={() => { setEditId(null); setEditErr(''); }}>{t.cancel}</AdminBtn>
                            </span>
                          ) : (
                            <button
                              type="button"
                              title={t.editScore}
                              onClick={() => { setEditId(r.student_exam_id); setEditVal(String(r.score)); setEditErr(''); }}
                              className="group inline-flex items-center gap-1.5 rounded-md px-1 hover:bg-indigo-50"
                            >
                              {r.score}/{r.total}
                              <svg className="h-3.5 w-3.5 text-gray-300 group-hover:text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          )}
                          {editId === r.student_exam_id && editErr ? <div className="mt-1 text-[11.5px] text-red-600">{editErr}</div> : null}
                        </td>
                        <td className={`${td} text-right font-bold tabular-nums ${r.passed ? 'text-emerald-700' : 'text-red-600'}`}>{r.percent}%</td>
                        <td className={td}><Pill ok={r.passed}>{r.passed ? t.passed : t.failed}</Pill></td>
                        <td className={`${td} whitespace-nowrap tabular-nums text-gray-500`}>{(r.completed_at || '').slice(0, 16).replace('T', ' ')}</td>
                        <td className={`${td} text-right`}>
                          <div className="flex items-center justify-end gap-1.5">
                            <AdminBtn variant="ghost" size="sm" onClick={() => setEvSe(r.student_exam_id)}>
                              🔍 {lang === 'ru' ? 'Доказательства' : lang === 'en' ? 'Evidence' : 'Dalillar'}
                            </AdminBtn>
                            {!r.passed ? (
                              retaken[r.student_exam_id]
                                ? <span className="text-[12px] text-gray-400">{t.retakeDone}</span>
                                : <AdminBtn variant="ghost" size="sm" onClick={() => allowRetake(r.student_exam_id)}>{t.retake}</AdminBtn>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <AdminPagination page={resPaged.page} totalPages={resPaged.totalPages} onPageChange={resPaged.setPage} total={resPaged.total} pageSize={resPaged.pageSize} />
              {resultRows.length !== participantsTotal ? (
                <p className="border-t border-gray-100 px-4 py-2 text-[12px] text-gray-400">{fmt(resultRows.length)} / {fmt(participantsTotal)} {t.shown}</p>
              ) : null}
            </>
          ) : <AdminEmpty title={t.noData} />
        ) : null}

        {/* Qatnashmaganlar */}
        {!loading && tab === 'absent' ? (
          absentRows.length ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13.5px]">
                  <thead className={th}>
                    <tr>
                      <th className="py-2.5 px-3 text-left font-semibold w-10">{t.rank}</th>
                      <SortTh label={t.person} k="name" sort={absSort} onSort={setAbsSort} />
                      <th className="py-2.5 px-3 text-left font-semibold">{t.login}</th>
                      <SortTh label={t.kafedra} k="kafedra" sort={absSort} onSort={setAbsSort} />
                      <SortTh label={t.status} k="state" sort={absSort} onSort={setAbsSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {absPaged.pageItems.map((r, i) => (
                      <tr key={r.kafedra + r.student_id} className="hover:bg-gray-50/70">
                        <td className={`${td} tabular-nums text-gray-400`}>{(absPaged.page - 1) * absPaged.pageSize + i + 1}</td>
                        <td className={`${td} font-semibold text-gray-900`}>{r.name}</td>
                        <td className={`${td} font-mono text-[12px] text-gray-500`}>{r.student_id}</td>
                        <td className={`${td} text-gray-600`}>{r.kafedra}</td>
                        <td className={td}>
                          {r.state === 'unfinished' ? (
                            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[12px] font-semibold text-amber-800 ring-1 ring-amber-600/20">{t.started}</span>
                          ) : r.state === 'retake_granted' ? (
                            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[12px] font-semibold text-indigo-700 ring-1 ring-indigo-600/20">{t.retakeGranted}</span>
                          ) : (
                            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[12px] font-semibold text-gray-600">{t.notStarted}</span>
                          )}
                          {r.ban_reason ? (
                            <span className="ml-1.5 rounded-full bg-rose-50 px-2 py-0.5 text-[11.5px] font-semibold text-rose-700 ring-1 ring-rose-600/20">
                              {lang === 'ru' ? 'Заблокирован' : lang === 'en' ? 'Banned' : 'Chetlatilgan'}
                            </span>
                          ) : null}
                          {r.student_exam_id && r.state === 'unfinished' ? (
                            <AdminBtn variant="ghost" size="sm" className="ml-1.5" onClick={() => setEvSe(r.student_exam_id ?? null)}>
                              🔍 {lang === 'ru' ? 'Доказательства' : lang === 'en' ? 'Evidence' : 'Dalillar'}
                            </AdminBtn>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <AdminPagination page={absPaged.page} totalPages={absPaged.totalPages} onPageChange={absPaged.setPage} total={absPaged.total} pageSize={absPaged.pageSize} />
            </>
          ) : <AdminEmpty title={t.noData} />
        ) : null}

        {/* Chetlatilganlar */}
        {!loading && tab === 'banned' ? (
          bannedRows.length ? (
            <ul className="divide-y divide-gray-100">
              {bannedRows.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/70">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-[13px] font-bold text-red-700">
                    {(b.name || '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-gray-900">{b.name}</span>
                    <span className="block font-mono text-[11.5px] text-gray-400">{b.id}</span>
                  </span>
                  <AdminBtn variant="ghost" size="sm" onClick={() => { setUnbanFor(b); setUnbanErr(''); }}>{t.unban}</AdminBtn>
                </li>
              ))}
            </ul>
          ) : <AdminEmpty title={t.noBanned} />
        ) : null}
      </section>

      <AdminModal open={!!unbanFor} onClose={() => setUnbanFor(null)} title={t.unban} subtitle={unbanFor?.name}>
        <div className="space-y-3">
          <AdminTextarea rows={3} placeholder={t.unbanReason} value={unbanReason} onChange={(e) => setUnbanReason(e.target.value)} />
          <div>
            <p className="mb-1.5 text-[12.5px] font-semibold text-gray-500">{t.unbanFile}</p>
            <AdminFileInput
              accept="image/*,application/pdf"
              buttonText={t.chooseFile}
              placeholder={t.noFile}
              onChange={(e) => setUnbanFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
            />
          </div>
          {unbanErr ? <p className="text-[12.5px] font-medium text-red-600">{unbanErr}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <AdminBtn variant="ghost" onClick={() => setUnbanFor(null)}>{t.cancel}</AdminBtn>
            <AdminBtn variant="blue" onClick={doUnban}>{t.save}</AdminBtn>
          </div>
        </div>
      </AdminModal>
    </div>
  );
}
