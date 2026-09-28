import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { apiUrl } from '../lib/apiUrl';
import { authHeaders } from '../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../lib/http';
import { translations, Language } from '../i18n';
import { LiveMonitor } from '../components/LiveMonitor';
import { ExamEditModal } from '../components/ExamEditModal';
import { AdminBtn, AdminEmpty, AdminInput, AdminModal, AdminPagination, AdminSelect, usePagedList } from './admin/ui';

/*
 * Imtihonlar ro'yxati — jadval ko'rinishi.
 *
 * Ilgari har imtihon katta kartochka edi (sahifaga 6 ta sig'ardi) va 100+
 * imtihon orasidan keraklisini topish qiyin edi. Endi: holat tablari
 * (soni bilan), toifa chiplari, qidiruv, saralash va ixcham qatorlar.
 * Natijalar tanlangan imtihon ostida emas, alohida panelda — ro'yxat
 * joyidan siljimaydi.
 *
 * Staff portal ham shu komponentni ishlatadi (apiVariant="staff"): u yerda
 * tahrirlash/savollar yo'q va eksport CSV (xlsx endpointi faqat admin).
 */

type TimeStatus = 'upcoming' | 'live' | 'ended';

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

const AUD_ORDER = ['student', 'faculty', 'ordinator', 'magistr', 'entrant', 'vacancy'];

const TX = {
  uz: {
    aud: { student: 'Talabalar', faculty: "O'qituvchilar", ordinator: 'Ordinatorlar', magistr: 'Magistrlar', entrant: 'Maxsus kiruvchilar', vacancy: 'Nomzodlar' } as Record<string, string>,
    all: 'Barchasi', live: 'Jonli', upcoming: 'Kelgusi', ended: 'Tugagan', allAud: 'Barcha toifalar',
    search: 'Nomi, kafedra yoki fan', title: 'Imtihon', when: 'Vaqti', audience: 'Toifa', params: 'Parametrlar',
    min: 'daq', q: 'savol', ai: 'AI', course: 'kurs', sortNew: 'Yangilari avval', sortOld: 'Eskilari avval', sortSoon: 'Yaqinlashayotgan',
    monitor: 'Jonli kuzatuv', results: 'Natijalar', edit: 'Tahrirlash', questions: 'Savollar', more: 'Yana',
    found: 'ta imtihon', refresh: 'Yangilash', empty: "Filtr bo'yicha imtihon yo'q.",
    rTitle: 'Natijalar', rTotal: 'Jami', rDone: 'Topshirdi', rAvg: "O'rtacha ball", rBanned: 'Chetlatildi', rReview: "Ko'rib chiqish kerak",
    rAllSt: 'Barcha holatlar', onlyReview: "Faqat ko'rib chiqiladiganlar", export: 'Excel', close: 'Yopish',
    name: 'F.I.Sh.', score: 'Ball', time: 'Vaqt', risk: 'Xavf', viol: 'Qoidabuzarlik', status: 'Holat',
    details: 'Tafsilot', retake: 'Qayta ruxsat', retakeConfirm: 'Bu kishiga imtihonni qayta topshirishga ruxsat berilsinmi?',
    incorrect: "Noto'g'ri javoblar", timeline: "Savollar bo'yicha xavf", violations: 'Qoidabuzarliklar', flagged: 'Belgilangan',
    noResults: "Natija yo'q.", student: 'Javobi', correct: "To'g'ri", langPending: 'tarjima kutilmoqda', langReady: '{n}/3 til',
  },
  ru: {
    aud: { student: 'Студенты', faculty: 'Преподаватели', ordinator: 'Ординаторы', magistr: 'Магистранты', entrant: 'Спец. поступающие', vacancy: 'Кандидаты' } as Record<string, string>,
    all: 'Все', live: 'Идут', upcoming: 'Предстоящие', ended: 'Завершённые', allAud: 'Все категории',
    search: 'Название, кафедра или предмет', title: 'Экзамен', when: 'Время', audience: 'Категория', params: 'Параметры',
    min: 'мин', q: 'вопр.', ai: 'ИИ', course: 'курс', sortNew: 'Сначала новые', sortOld: 'Сначала старые', sortSoon: 'Ближайшие',
    monitor: 'Мониторинг', results: 'Результаты', edit: 'Изменить', questions: 'Вопросы', more: 'Ещё',
    found: 'экзаменов', refresh: 'Обновить', empty: 'Нет экзаменов по фильтру.',
    rTitle: 'Результаты', rTotal: 'Всего', rDone: 'Сдали', rAvg: 'Средний балл', rBanned: 'Отстранены', rReview: 'Требуют проверки',
    rAllSt: 'Все статусы', onlyReview: 'Только на проверку', export: 'Excel', close: 'Закрыть',
    name: 'Ф.И.О.', score: 'Балл', time: 'Время', risk: 'Риск', viol: 'Нарушения', status: 'Статус',
    details: 'Подробнее', retake: 'Разрешить пересдачу', retakeConfirm: 'Разрешить этому человеку пересдать экзамен?',
    incorrect: 'Неверные ответы', timeline: 'Риск по вопросам', violations: 'Нарушения', flagged: 'Отмечено',
    noResults: 'Нет результатов.', student: 'Ответ', correct: 'Верно', langPending: 'ожидает перевода', langReady: '{n}/3 языка',
  },
  en: {
    aud: { student: 'Students', faculty: 'Teachers', ordinator: 'Residents', magistr: 'Master students', entrant: 'Special entrants', vacancy: 'Applicants' } as Record<string, string>,
    all: 'All', live: 'Live', upcoming: 'Upcoming', ended: 'Ended', allAud: 'All groups',
    search: 'Title, department or subject', title: 'Exam', when: 'When', audience: 'Group', params: 'Setup',
    min: 'min', q: 'q', ai: 'AI', course: 'year', sortNew: 'Newest first', sortOld: 'Oldest first', sortSoon: 'Starting soon',
    monitor: 'Live monitor', results: 'Results', edit: 'Edit', questions: 'Questions', more: 'More',
    found: 'exams', refresh: 'Refresh', empty: 'No exams match the filter.',
    rTitle: 'Results', rTotal: 'Total', rDone: 'Completed', rAvg: 'Average score', rBanned: 'Banned', rReview: 'Needs review',
    rAllSt: 'All statuses', onlyReview: 'Needs review only', export: 'Excel', close: 'Close',
    name: 'Full name', score: 'Score', time: 'Time', risk: 'Risk', viol: 'Violations', status: 'Status',
    details: 'Details', retake: 'Allow retake', retakeConfirm: 'Allow this person to retake the exam?',
    incorrect: 'Incorrect answers', timeline: 'Risk by question', violations: 'Violations', flagged: 'Flagged',
    noResults: 'No results.', student: 'Answer', correct: 'Correct', langPending: 'translation pending', langReady: '{n}/3 languages',
  },
};

const pad = (n: number) => String(n).padStart(2, '0');
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function timeStatus(e: any): TimeStatus {
  const now = Date.now();
  const s = new Date(e.start_time).getTime();
  const en = new Date(e.end_time).getTime();
  if (now < s) return 'upcoming';
  if (now > en) return 'ended';
  return 'live';
}
function parseList(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function minutesBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const d = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(d) && d >= 0 ? d / 60000 : null;
}

function StatusDot({ st, T }: { st: TimeStatus; T: (typeof TX)['uz'] }) {
  const map: Record<TimeStatus, string> = {
    live: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    upcoming: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    ended: 'bg-gray-100 text-gray-600 ring-gray-500/10',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${map[st]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st === 'live' ? 'bg-emerald-500 animate-pulse' : st === 'upcoming' ? 'bg-amber-500' : 'bg-gray-400'}`} />
      {st === 'live' ? T.live : st === 'upcoming' ? T.upcoming : T.ended}
    </span>
  );
}

export function AdminExamsTab({
  token,
  lang,
  apiVariant = 'admin',
}: {
  token: string;
  lang: Language;
  apiVariant?: 'admin' | 'staff';
}) {
  const t = translations[lang];
  const T = TX[lang] || TX.uz;
  const isStaffPortal = apiVariant === 'staff';
  const examsListUrl = isStaffPortal ? '/api/staff/exams' : '/api/admin/exams';
  const resultsUrl = (id: number) => (isStaffPortal ? `/api/staff/exams/${id}/results` : `/api/admin/exams/${id}/results`);
  const h = useMemo(() => authHeaders(token, lang), [token, lang]);

  const [exams, setExams] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [kafedraNames, setKafedraNames] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [stF, setStF] = useState<'all' | TimeStatus>('all');
  const [audF, setAudF] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'new' | 'old' | 'soon'>('new');

  const [activeMonitorExamId, setActiveMonitorExamId] = useState<number | null>(null);
  const [editingExamId, setEditingExamId] = useState<number | null>(null);
  const [questionsExamId, setQuestionsExamId] = useState<number | null>(null);

  const [selectedExam, setSelectedExam] = useState<number | null>(null);
  const [results, setResults] = useState<any>(null);
  const [resLoading, setResLoading] = useState(false);
  const [rStatus, setRStatus] = useState('All');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [rSort, setRSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const statusLabel = (s?: string | null) =>
    s === 'Completed' ? t.examStatusCompleted
      : s === 'Banned' ? t.examStatusBanned
      : s === 'Failed' ? t.examStatusFailed
      : s === 'In Progress' ? t.examStatusInProgress
      : s === 'Pending' ? t.examStatusPending
      : (s || '');

  const fetchExams = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch(apiUrl(examsListUrl), { headers: h });
      if (!checkAdminAuthResponse(res)) return;
      if (res.ok) {
        const raw = await readJsonSafe<unknown>(res);
        setExams(Array.isArray(raw) ? raw : []);
      }
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  }, [examsListUrl, h]);

  useEffect(() => { void fetchExams(); }, [fetchExams]);

  useEffect(() => {
    if (isStaffPortal) return;
    (async () => {
      try {
        const [rg, rk] = await Promise.all([
          fetch(apiUrl('/api/admin/groups'), { headers: h }),
          fetch(apiUrl('/api/admin/kafedralar'), { headers: h }),
        ]);
        if (rg.ok) {
          const g = await readJsonSafe<unknown>(rg);
          setGroups(Array.isArray(g) ? g : []);
        }
        if (rk.ok) {
          const raw = await readJsonSafe<any>(rk);
          const list = Array.isArray(raw) ? raw : (raw && raw.results) || [];
          const map: Record<number, string> = {};
          list.forEach((k: any) => { map[Number(k.id)] = String(k.name || ''); });
          setKafedraNames(map);
        }
      } catch {
        /* nomlarsiz ham ishlaydi */
      }
    })();
  }, [h, isStaffPortal]);

  /* ── Ro'yxat filtrlari ─────────────────────────────────────────────────── */
  const byAud = useMemo(() => exams.filter((e) => !audF || String(e.audience || 'student') === audF), [exams, audF]);
  const counts = useMemo(() => {
    const c = { all: byAud.length, live: 0, upcoming: 0, ended: 0 };
    byAud.forEach((e) => { c[timeStatus(e)] += 1; });
    return c;
  }, [byAud]);
  const audiences = useMemo(() => {
    const present = new Map<string, number>();
    exams.forEach((e) => {
      const a = String(e.audience || 'student');
      present.set(a, (present.get(a) || 0) + 1);
    });
    return AUD_ORDER.filter((a) => present.has(a)).map((a) => ({ id: a, n: present.get(a) || 0 }));
  }, [exams]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = byAud.filter((e) => {
      if (stF !== 'all' && timeStatus(e) !== stF) return false;
      if (!needle) return true;
      const hay = [e.title, e.faculty_subject, kafedraNames[Number(e.kafedra_id)], e.teacher_name].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
    const ts = (e: any) => new Date(e.start_time).getTime() || 0;
    if (sort === 'old') list.sort((a, b) => ts(a) - ts(b));
    else if (sort === 'soon') {
      const now = Date.now();
      list.sort((a, b) => Math.abs(ts(a) - now) - Math.abs(ts(b) - now));
    } else list.sort((a, b) => ts(b) - ts(a));
    return list;
  }, [byAud, stF, q, sort, kafedraNames]);

  const examPage = usePagedList(filtered, 25);
  const selected = exams.find((e) => e.id === selectedExam) || null;

  /* ── Natijalar ───────────────────────────────────────────────────────── */
  const viewResults = async (examId: number) => {
    setSelectedExam(examId);
    setResults(null);
    setResLoading(true);
    setRStatus('All');
    setReviewOnly(false);
    setOpenRow(null);
    try {
      const res = await fetch(apiUrl(resultsUrl(examId)), { headers: h });
      if (!checkAdminAuthResponse(res)) return;
      if (res.ok) {
        const raw = await readJsonSafe<unknown>(res);
        setResults(raw && typeof raw === 'object' ? raw : null);
      }
    } finally {
      setResLoading(false);
    }
  };

  const allowRetake = async (seId: number) => {
    if (!window.confirm(T.retakeConfirm)) return;
    const res = await fetch(apiUrl(`/api/admin/student_exams/${seId}/retake`), { method: 'POST', headers: h });
    if (!checkAdminAuthResponse(res)) return;
    if (selectedExam != null) void viewResults(selectedExam);
  };

  const rows = useMemo(() => {
    const list: any[] = Array.isArray(results?.results) ? results.results : [];
    const viol: any[] = Array.isArray(results?.violations) ? results.violations : [];
    const examTotal = Number(selected?.bank_question_count || 0);
    return list.map((r) => {
      const qs = parseList(r.session_questions_json).length || parseList(r.questions_json).length || parseList(results?.questions_json).length;
      const total = qs || examTotal;
      const pct = r.score != null && total ? Math.round((Number(r.score) / total) * 100) : null;
      return {
        ...r,
        _total: total,
        _pct: pct,
        _min: minutesBetween(r.started_at, r.completed_at),
        _viol: viol.filter((v) => v.student_id === r.student_id),
      };
    });
  }, [results, selected]);

  const rStats = useMemo(() => {
    const done = rows.filter((r) => r.status === 'Completed');
    const pcts = done.map((r) => r._pct).filter((p): p is number => p != null);
    return {
      total: rows.length,
      done: done.length,
      avg: pcts.length ? Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length) : null,
      banned: rows.filter((r) => r.status === 'Banned').length,
      review: rows.filter((r) => r.recommended_review).length,
    };
  }, [rows]);

  const shownRows = useMemo(() => {
    let list = rows;
    if (rStatus !== 'All') list = list.filter((r) => r.status === rStatus);
    if (reviewOnly) list = list.filter((r) => r.recommended_review);
    const get: Record<string, (r: any) => string | number> = {
      name: (r) => String(r.name || ''),
      score: (r) => (r._pct ?? -1),
      risk: (r) => Number(r.risk_score || 0),
      viol: (r) => r._viol.length,
      time: (r) => (r._min ?? -1),
    };
    const g = get[rSort.key] || get.name;
    const mul = rSort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = g(a);
      const y = g(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * mul;
    });
  }, [rows, rStatus, reviewOnly, rSort]);

  const incorrectOf = (r: any) => {
    try {
      const answers = JSON.parse(r.answers_json || '{}') as Record<string, string>;
      const questions = parseList(r.session_questions_json).length ? parseList(r.session_questions_json) : parseList(r.questions_json || results?.questions_json);
      return questions
        .filter((qq: any) => {
          const id = String(qq?.id ?? '');
          if (!id) return false;
          const a = answers[id] ?? answers[String(Number(id))];
          return a !== qq.correctAnswer;
        })
        .map((qq: any) => {
          const id = String(qq.id);
          return { question: qq.text, studentAnswer: answers[id] ?? answers[String(Number(id))], correctAnswer: qq.correctAnswer };
        });
    } catch {
      return [];
    }
  };

  const exportResults = async () => {
    if (!selected) return;
    const columns = ['№', T.name, 'Login', T.status, T.score, '%', T.time, T.risk, T.viol];
    const data = shownRows.map((r, i) => [
      i + 1, r.name, r.student_id, statusLabel(r.status),
      r.score != null ? `${r.score}/${r._total || '?'}` : '', r._pct ?? '',
      r._min != null ? Math.round(r._min) : '', Number(r.risk_score || 0),
      r._viol.map((v: any) => v.violation_type).join(', '),
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = String(selected.title || 'imtihon').replace(/[^\w\-]+/g, '_').slice(0, 60);
    if (isStaffPortal) {
      const esc = (v: unknown) => {
        const s = String(v ?? '');
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = '﻿' + [columns, ...data].map((r) => r.map(esc).join(';')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${base}-${stamp}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
    setExporting(true);
    try {
      const res = await fetch(apiUrl('/api/admin/reports/xlsx'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ title: selected.title, filename: `${base}-${stamp}.xlsx`, sheets: [{ title: T.rTitle, columns, rows: data }] }),
      });
      if (!checkAdminAuthResponse(res) || !res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${base}-${stamp}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  /* ── Ko'rinish ───────────────────────────────────────────────────────── */
  const statTabs: Array<['all' | TimeStatus, string, number]> = [
    ['all', T.all, counts.all],
    ['live', T.live, counts.live],
    ['upcoming', T.upcoming, counts.upcoming],
    ['ended', T.ended, counts.ended],
  ];

  const RSortTh = ({ k, label, right = false }: { k: string; label: string; right?: boolean }) => {
    const on = rSort.key === k;
    return (
      <th className={`px-3 py-2.5 font-semibold ${right ? 'text-right' : 'text-left'}`}>
        <button
          type="button"
          onClick={() => setRSort({ key: k, dir: on && rSort.dir === 'desc' ? 'asc' : on ? 'desc' : k === 'name' ? 'asc' : 'desc' })}
          className={`inline-flex items-center gap-1 hover:text-gray-900 ${on ? 'text-gray-900' : ''}`}
        >
          {label}
          <span className={`text-[10px] ${on ? 'text-indigo-600' : 'text-gray-300'}`}>{on ? (rSort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    );
  };

  const td = 'px-4 py-3 border-b border-gray-100 align-top';

  return (
    <div className="space-y-5">
      <section className={`${CARD} overflow-hidden`}>
        {/* Holat tablari */}
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 px-3 sm:px-4">
          <div className="-mb-px flex overflow-x-auto" role="tablist">
            {statTabs.map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={stF === k}
                onClick={() => setStF(k)}
                className={`whitespace-nowrap border-b-2 px-3 py-3.5 text-[13.5px] font-semibold transition-colors ${
                  stF === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {k === 'live' && n > 0 ? <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500 align-middle" /> : null}
                {label}
                <span className={`ml-1.5 rounded-full px-1.5 py-px text-[11.5px] tabular-nums ${stF === k ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>{n}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 py-2">
            <AdminBtn variant="ghost" size="sm" loading={refreshing} onClick={() => fetchExams(true)}>{T.refresh}</AdminBtn>
          </div>
        </div>

        {/* Toifa + qidiruv + saralash */}
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setAudF('')}
              className={`h-8 rounded-full px-3 text-[12.5px] font-semibold ${!audF ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {T.allAud}
            </button>
            {audiences.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAudF(a.id)}
                className={`h-8 rounded-full px-3 text-[12.5px] font-semibold ${audF === a.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {T.aud[a.id] || a.id}
                <span className={`ml-1 tabular-nums ${audF === a.id ? 'text-white/60' : 'text-gray-400'}`}>{a.n}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <AdminInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.search} className="h-9 sm:w-72" />
            <AdminSelect value={sort} onChange={(e) => setSort(e.target.value as 'new' | 'old' | 'soon')} className="h-9 sm:w-48">
              <option value="new">{T.sortNew}</option>
              <option value="soon">{T.sortSoon}</option>
              <option value="old">{T.sortOld}</option>
            </AdminSelect>
          </div>
        </div>

        {/* Jadval */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[13.5px]">
            <thead className="bg-gray-50/80 text-[12px] text-gray-500">
              <tr className="border-b border-gray-200 text-left">
                <th className="px-4 py-2.5 font-semibold">{T.title}</th>
                <th className="px-4 py-2.5 font-semibold">{T.when}</th>
                <th className="px-4 py-2.5 font-semibold">{T.params}</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {examPage.pageItems.map((e: any) => {
                const st = timeStatus(e);
                const kaf = kafedraNames[Number(e.kafedra_id)];
                const sameDay = fmtDate(e.start_time) === fmtDate(e.end_time);
                const on = selectedExam === e.id;
                return (
                  <tr key={e.id} className={on ? 'bg-indigo-50/50' : 'hover:bg-gray-50/70'}>
                    <td className={`${td} max-w-[420px]`}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold leading-snug text-gray-900">{e.title}</p>
                          {kaf || e.faculty_subject ? (
                            <p className="mt-0.5 truncate text-[12.5px] text-gray-500">{[kaf, e.faculty_subject].filter(Boolean).join(' · ')}</p>
                          ) : null}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <StatusDot st={st} T={T} />
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11.5px] font-semibold text-indigo-700">
                              {T.aud[String(e.audience || 'student')] || e.audience}
                              {e.course ? ` · ${e.course}-${T.course}` : ''}
                            </span>
                            {e.test_center_pin ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-800 ring-1 ring-emerald-600/15">
                                {lang === 'ru' ? 'PIN центра' : lang === 'en' ? 'Centre PIN' : 'Test markazi PIN'}: <b className="font-mono tracking-wider">{e.test_center_pin}</b>
                              </span>
                            ) : null}
                            {e.language === 'auto' && e.languages_ready != null && e.languages_ready < 3 ? (
                              <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${e.languages_ready > 0 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>
                                {e.languages_ready > 0 ? T.langReady.replace('{n}', String(e.languages_ready)) : T.langPending}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      <p className="font-medium tabular-nums text-gray-800">{fmtDate(e.start_time)}</p>
                      <p className="text-[12.5px] tabular-nums text-gray-500">
                        {fmtTime(e.start_time)} – {sameDay ? fmtTime(e.end_time) : `${fmtDate(e.end_time)} ${fmtTime(e.end_time)}`}
                      </p>
                    </td>
                    <td className={`${td} whitespace-nowrap text-[12.5px] text-gray-600`}>
                      <p><b className="font-semibold tabular-nums text-gray-900">{e.duration_minutes}</b> {T.min}</p>
                      {Number(e.bank_question_count) > 0 ? (
                        <p>
                          <b className="font-semibold tabular-nums text-gray-900">{e.bank_question_count}</b> {T.q}
                          {Number(e.ai_question_count) > 0 ? <span className="text-gray-400"> · {e.ai_question_count} {T.ai}</span> : null}
                        </p>
                      ) : null}
                    </td>
                    <td className={`${td} text-right`}>
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {st === 'live' ? (
                          <AdminBtn size="sm" onClick={() => setActiveMonitorExamId(e.id)}>{T.monitor}</AdminBtn>
                        ) : (
                          <AdminBtn variant="ghost" size="sm" onClick={() => setActiveMonitorExamId(e.id)}>{T.monitor}</AdminBtn>
                        )}
                        <AdminBtn variant={on ? 'blue' : 'ghost'} size="sm" onClick={() => viewResults(e.id)}>{T.results}</AdminBtn>
                        {!isStaffPortal ? (
                          <>
                            <AdminBtn variant="ghost" size="sm" onClick={() => setQuestionsExamId(e.id)}>{T.questions}</AdminBtn>
                            <AdminBtn variant="ghost" size="sm" onClick={() => setEditingExamId(e.id)}>{T.edit}</AdminBtn>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && filtered.length === 0 ? (
            <AdminEmpty title={isStaffPortal && exams.length === 0 ? t.staffNoExamsHint : T.empty} />
          ) : null}
          {loading ? <p className="py-14 text-center text-[13.5px] text-gray-500">…</p> : null}
        </div>
        <AdminPagination page={examPage.page} totalPages={examPage.totalPages} onPageChange={examPage.setPage} total={examPage.total} pageSize={examPage.pageSize} />
      </section>

      {/* Natijalar paneli */}
      {selectedExam != null ? (
        <section className={`${CARD} overflow-hidden`}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
            <div className="min-w-0">
              <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-indigo-700">{T.rTitle}</p>
              <h3 className="mt-0.5 truncate text-[18px] font-extrabold text-gray-900">{selected?.title}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AdminSelect value={rStatus} onChange={(e) => setRStatus(e.target.value)} className="h-9 w-44">
                <option value="All">{T.rAllSt}</option>
                <option value="Completed">{t.examStatusCompleted}</option>
                <option value="In Progress">{t.examStatusInProgress}</option>
                <option value="Pending">{t.examStatusPending}</option>
                <option value="Banned">{t.examStatusBanned}</option>
              </AdminSelect>
              <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-gray-600">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-indigo-600)]" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
                {T.onlyReview}
              </label>
              <AdminBtn variant="ghost" size="sm" loading={exporting} disabled={!shownRows.length} onClick={exportResults}>{T.export}</AdminBtn>
              <AdminBtn variant="ghost" size="sm" onClick={() => { setSelectedExam(null); setResults(null); }}>{T.close}</AdminBtn>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px bg-gray-100 sm:grid-cols-5">
            {[
              { l: T.rTotal, v: rStats.total, tone: 'text-gray-900' },
              { l: T.rDone, v: rStats.done, tone: 'text-gray-900' },
              { l: T.rAvg, v: rStats.avg != null ? `${rStats.avg}%` : '—', tone: 'text-gray-900' },
              { l: T.rBanned, v: rStats.banned, tone: rStats.banned ? 'text-red-600' : 'text-gray-900' },
              { l: T.rReview, v: rStats.review, tone: rStats.review ? 'text-amber-600' : 'text-gray-900' },
            ].map((s) => (
              <div key={s.l} className="bg-white px-5 py-3.5">
                <p className="text-[12px] font-semibold text-gray-500">{s.l}</p>
                <p className={`mt-1 font-display text-[22px] font-extrabold leading-none tabular-nums ${s.tone}`}>{resLoading ? '…' : s.v}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto border-t border-gray-200">
            <table className="w-full min-w-[860px] text-[13.5px]">
              <thead className="bg-gray-50/80 text-[12px] text-gray-500">
                <tr className="border-b border-gray-200">
                  <RSortTh k="name" label={T.name} />
                  <th className="px-3 py-2.5 text-left font-semibold">{T.status}</th>
                  <RSortTh k="score" label={T.score} right />
                  <RSortTh k="time" label={T.time} right />
                  <RSortTh k="risk" label={T.risk} right />
                  <RSortTh k="viol" label={T.viol} right />
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r: any) => {
                  const open = openRow === r.id;
                  const sCls =
                    r.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
                      : r.status === 'Banned' ? 'bg-red-50 text-red-700 ring-red-600/15'
                        : r.status === 'In Progress' ? 'bg-sky-50 text-sky-700 ring-sky-600/15'
                          : 'bg-gray-100 text-gray-600 ring-gray-500/10';
                  const pri = r.highest_priority;
                  const incorrect = open ? incorrectOf(r) : [];
                  return (
                    <React.Fragment key={r.id}>
                      <tr className={open ? 'bg-gray-50' : 'hover:bg-gray-50/70'}>
                        <td className="border-b border-gray-100 px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-gray-900">{r.name}</p>
                              <p className="font-mono text-[11.5px] text-gray-400">{r.student_id}</p>
                            </div>
                            {r.recommended_review ? (
                              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-600/20">!</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="border-b border-gray-100 px-3 py-2.5">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${sCls}`}>{statusLabel(r.status)}</span>
                        </td>
                        <td className="border-b border-gray-100 px-3 py-2.5 text-right tabular-nums">
                          {r.score != null ? (
                            <>
                              <b className="font-bold text-gray-900">{r.score}</b>
                              <span className="text-gray-400">/{r._total || '?'}</span>
                              {r._pct != null ? <span className="ml-1.5 text-gray-500">{r._pct}%</span> : null}
                            </>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="border-b border-gray-100 px-3 py-2.5 text-right tabular-nums text-gray-600">
                          {r._min != null ? `${Math.floor(r._min)}:${pad(Math.round((r._min % 1) * 60))}` : '—'}
                        </td>
                        <td className="border-b border-gray-100 px-3 py-2.5 text-right">
                          <span className={`tabular-nums font-semibold ${pri === 'critical' ? 'text-red-600' : pri === 'high' ? 'text-amber-600' : 'text-gray-600'}`}>
                            {Number(r.risk_score || 0)}
                          </span>
                        </td>
                        <td className="border-b border-gray-100 px-3 py-2.5 text-right tabular-nums">
                          <span className={r._viol.length ? 'font-semibold text-red-600' : 'text-gray-400'}>{r._viol.length}</span>
                        </td>
                        <td className="border-b border-gray-100 px-3 py-2.5 text-right whitespace-nowrap">
                          <button type="button" onClick={() => setOpenRow(open ? null : r.id)} className="mr-2 text-[12.5px] font-semibold text-indigo-700 hover:underline">
                            {T.details} {open ? '▴' : '▾'}
                          </button>
                          {!isStaffPortal && (r.status === 'Banned' || r.status === 'Completed' || r.status === 'Failed') ? (
                            <AdminBtn variant="ghost" size="sm" onClick={() => allowRetake(r.id)}>{T.retake}</AdminBtn>
                          ) : null}
                        </td>
                      </tr>
                      {open ? (
                        <tr className="bg-gray-50">
                          <td colSpan={7} className="border-b border-gray-200 px-4 pb-4 pt-1">
                            <div className="grid gap-3 lg:grid-cols-3">
                              <div className="rounded-xl border border-gray-200 bg-white p-3">
                                <p className="mb-2 text-[12.5px] font-bold text-gray-800">{T.violations} ({r._viol.length})</p>
                                {r._viol.length ? (
                                  <ul className="max-h-48 space-y-1 overflow-y-auto text-[12.5px]">
                                    {r._viol.map((v: any, i: number) => (
                                      <li key={i} className="flex justify-between gap-2">
                                        <span className="truncate text-gray-700">{v.violation_type}</span>
                                        <span className="shrink-0 tabular-nums text-gray-400">{fmtTime(v.timestamp)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : <p className="text-[12.5px] text-gray-400">—</p>}
                              </div>
                              <div className="rounded-xl border border-gray-200 bg-white p-3">
                                <p className="mb-2 text-[12.5px] font-bold text-gray-800">{T.timeline}</p>
                                {Array.isArray(r.question_risk_timeline) && r.question_risk_timeline.length ? (
                                  <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                                    {r.question_risk_timeline.map((qq: any) => (
                                      <span
                                        key={qq.question_id}
                                        title={`r:${qq.risk_score}`}
                                        className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums ${
                                          qq.flagged ? 'bg-red-50 text-red-700' : qq.incorrect ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'
                                        }`}
                                      >
                                        {qq.question_no}{qq.flagged ? ' ⚑' : ''}
                                      </span>
                                    ))}
                                  </div>
                                ) : <p className="text-[12.5px] text-gray-400">—</p>}
                              </div>
                              <div className="rounded-xl border border-gray-200 bg-white p-3">
                                <p className="mb-2 text-[12.5px] font-bold text-gray-800">{T.incorrect} ({r.status === 'Completed' ? incorrect.length : '—'})</p>
                                {r.status === 'Completed' && incorrect.length ? (
                                  <ul className="max-h-48 space-y-2 overflow-y-auto text-[12.5px]">
                                    {incorrect.map((inc: any, i: number) => (
                                      <li key={i} className="border-b border-gray-100 pb-1.5 last:border-0">
                                        <p className="text-gray-800">{inc.question}</p>
                                        <p className="mt-0.5">
                                          <span className="text-red-600">{T.student}: <b>{inc.studentAnswer || '—'}</b></span>
                                          <span className="ml-2 text-emerald-700">{T.correct}: <b>{inc.correctAnswer}</b></span>
                                        </p>
                                      </li>
                                    ))}
                                  </ul>
                                ) : <p className="text-[12.5px] text-gray-400">—</p>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {!resLoading && shownRows.length === 0 ? <AdminEmpty title={T.noResults} /> : null}
            {resLoading ? <p className="py-10 text-center text-[13.5px] text-gray-500">…</p> : null}
          </div>
        </section>
      ) : null}

      <AnimatePresence>
        {activeMonitorExamId && (
          <LiveMonitor examId={activeMonitorExamId} token={token} lang={lang} onClose={() => setActiveMonitorExamId(null)} />
        )}
      </AnimatePresence>

      {editingExamId != null && !isStaffPortal && (
        <ExamEditModal
          token={token}
          lang={lang}
          examId={editingExamId}
          groups={groups}
          onClose={() => setEditingExamId(null)}
          onSaved={(ev) => {
            fetchExams();
            if (ev.deleted && selectedExam === ev.examId) { setResults(null); setSelectedExam(null); }
            setEditingExamId(null);
          }}
        />
      )}

      {questionsExamId != null && (
        <ExamQuestionsModal token={token} lang={lang} examId={questionsExamId} onClose={() => setQuestionsExamId(null)} />
      )}
    </div>
  );
}

// ── Imtihon savollarini ko'rish ────────────────────────────────────────────
// GET /api/admin/exams/<id> javobidagi `questions` massivi ekranga chiqariladi.

const QUESTIONS_TEXT: Record<string, { title: string; count: string; loading: string; empty: string; error: string; correct: string; noAnswer: string }> = {
  uz: { title: 'Imtihon savollari', count: 'ta savol', loading: 'Yuklanmoqda…', empty: 'Bu imtihonda hali savol yo‘q.', error: 'Savollarni yuklab bo‘lmadi.', correct: 'To‘g‘ri javob', noAnswer: 'javob belgilanmagan' },
  ru: { title: 'Вопросы экзамена', count: 'вопросов', loading: 'Загрузка…', empty: 'В этом экзамене пока нет вопросов.', error: 'Не удалось загрузить вопросы.', correct: 'Правильный ответ', noAnswer: 'ответ не указан' },
  en: { title: 'Exam questions', count: 'questions', loading: 'Loading…', empty: 'This exam has no questions yet.', error: 'Could not load questions.', correct: 'Correct answer', noAnswer: 'no answer marked' },
};

function ExamQuestionsModal({ token, lang, examId, onClose }: { token: string; lang: Language; examId: number; onClose: () => void }) {
  const L = QUESTIONS_TEXT[lang] || QUESTIONS_TEXT.uz;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(apiUrl('/api/admin/exams/' + examId), { headers: authHeaders(token, lang) });
        if (!checkAdminAuthResponse(res)) return;
        const data = await readJsonSafe<any>(res);
        if (!alive) return;
        if (!res.ok || !data) setError(L.error);
        else {
          setTitle(String(data.title || ''));
          setQuestions(Array.isArray(data.questions) ? data.questions : []);
        }
      } catch {
        if (alive) setError(L.error);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, token, lang]);

  return (
    <AdminModal
      open
      onClose={onClose}
      title={L.title}
      subtitle={`${title}${!loading && !error ? ` · ${questions.length} ${L.count}` : ''}`}
      maxWidth="max-w-3xl"
      scroll
    >
      {loading ? <p className="text-[13.5px] text-gray-500">{L.loading}</p> : null}
      {!loading && error ? <p className="text-[13.5px] text-red-600">{error}</p> : null}
      {!loading && !error && questions.length === 0 ? <p className="text-[13.5px] text-gray-500">{L.empty}</p> : null}
      <ol className="space-y-5">
        {!loading && !error && questions.map((qq: any, qi: number) => {
          const opts: any[] = Array.isArray(qq?.options) ? qq.options : [];
          const correct = String(qq?.correctAnswer ?? '');
          return (
            <li key={qq?.id ?? qi}>
              <p className="text-[14px] font-semibold text-gray-900">{qi + 1}. {String(qq?.text ?? '')}</p>
              <ul className="mt-2 space-y-1">
                {opts.map((o: any, oi: number) => {
                  const val = String(o ?? '');
                  const ok = correct !== '' && val === correct;
                  return (
                    <li key={oi} className={`rounded-lg border px-2.5 py-1.5 text-[13px] ${ok ? 'border-emerald-200 bg-emerald-50 font-medium text-emerald-800' : 'border-gray-100 bg-gray-50 text-gray-700'}`}>
                      {String.fromCharCode(65 + oi)}. {val}{ok ? ` ✓ ${L.correct}` : ''}
                    </li>
                  );
                })}
              </ul>
              {correct === '' ? <p className="mt-1 text-[12px] text-amber-700">{L.noAnswer}</p> : null}
              {qq?.explanation ? <p className="mt-1.5 text-[12px] text-gray-500">{String(qq.explanation)}</p> : null}
            </li>
          );
        })}
      </ol>
    </AdminModal>
  );
}
