import { useEffect, useState } from 'react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import type { AdminStats } from './types';

type AdminPage =
  | 'levels' | 'kafedralar' | 'directions' | 'groups' | 'students'
  | 'banned' | 'staff' | 'exam_create' | 'exam_list' | 'examinees' | 'reports';

interface Props {
  token: string;
  lang: Language;
  onNavigate: (page: AdminPage) => void;
}

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

const MONTHS_UZ = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function todayLabel(lang: Language): string {
  const d = new Date();
  if (lang === 'uz') return `${d.getDate()}-${MONTHS_UZ[d.getMonth()]}, ${d.getFullYear()}`;
  return d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Skel({ w, h }: { w: string; h: string }) {
  return <span className={`block ${w} ${h} rounded-md bg-gray-100 animate-pulse`} />;
}

function Ico({ d }: { d: string }) {
  return (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d={d} />
    </svg>
  );
}

export function OverviewPage({ token, lang, onNavigate }: Props) {
  const t = translations[lang];
  const L = (uz: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : uz);
  const [stats, setStats] = useState<AdminStats | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/admin/stats'), { headers: authHeaders(token, lang) });
        if (!checkAdminAuthResponse(res)) return;
        const j = await readJsonSafe<AdminStats>(res);
        if (alive && j) setStats(j);
      } catch {
        /* tarmoq xatosi — skelet qoladi */
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const ready = stats !== null;
  const s = stats;

  const segments = [
    { key: 'students', label: t.totalStudents, value: s?.totalStudents ?? 0, dot: 'bg-indigo-600' },
    { key: 'ordinators', label: L('Ordinatorlar', 'Ординаторы', 'Residents'), value: s?.totalOrdinators ?? 0, dot: 'bg-sky-400' },
    { key: 'magistrs', label: L('Magistrlar', 'Магистранты', 'Master students'), value: s?.totalMagistrs ?? 0, dot: 'bg-violet-400' },
    { key: 'faculty', label: t.sidebarFacultySub, value: s?.totalFaculty ?? 0, dot: 'bg-amber-400' },
    { key: 'vacancy', label: L('Maxsus topshiruvchilar', 'Спец. кандидаты', 'Special applicants'), value: s?.totalVacancy ?? 0, dot: 'bg-gray-400' },
  ];
  const takers = segments.reduce((sum, x) => sum + x.value, 0);

  const tiles = [
    {
      label: t.totalExams, value: s?.totalExams ?? 0, page: 'exam_list' as AdminPage, tone: 'text-gray-900',
      hint: L('Yaratilgan imtihonlar', 'Созданные экзамены', 'Exams created'),
    },
    {
      label: t.totalViolations, value: s?.totalViolations ?? 0, page: 'reports' as AdminPage, tone: 'text-amber-600',
      hint: L('Qayd etilgan qoidabuzarliklar', 'Зафиксированные нарушения', 'Logged violations'),
    },
    {
      label: t.bannedUsers, value: s?.bannedUsers ?? 0, page: 'examinees' as AdminPage, tone: 'text-red-600',
      hint: L('Chetlatilgan foydalanuvchilar', 'Заблокированные', 'Banned users'),
    },
  ];

  const structure = [
    { label: t.totalKafedralar, value: s?.totalKafedralar ?? 0, page: 'kafedralar' as AdminPage },
    { label: t.totalDirections, value: s?.totalDirections ?? 0, page: 'directions' as AdminPage },
    { label: t.totalGroups, value: s?.totalGroups ?? 0, page: 'groups' as AdminPage },
    { label: t.totalLevels, value: s?.totalLevels ?? 0, page: 'levels' as AdminPage },
  ];

  const quick = [
    { label: t.sidebarExamCreateSub, desc: t.quickActionExamCreateDesc, page: 'exam_create' as AdminPage, d: 'M12 4v16m8-8H4' },
    { label: t.sidebarExamListSub, desc: t.quickActionExamListDesc, page: 'exam_list' as AdminPage, d: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
    {
      label: L('Hisobotlar', 'Отчёты', 'Reports'),
      desc: L('Natijalar, kafedra reytingi, eksport', 'Результаты, рейтинг кафедр, экспорт', 'Results, department ranking, export'),
      page: 'reports' as AdminPage, d: 'M9 19v-6m4 6V9m4 10V5M4 21h16',
    },
    {
      label: L('Test topshiruvchilar', 'Экзаменуемые', 'Exam takers'),
      desc: L('Talaba, ordinator, o‘qituvchi — bir joyda', 'Студенты, ординаторы, преподаватели', 'Students, residents, faculty'),
      page: 'examinees' as AdminPage,
      d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M9 20H2v-2a3 3 0 015.356-1.857M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    },
  ];

  return (
    <div className="space-y-5">
      {/* ── Test topshiruvchilar: jami + tarkib chizig'i ─────────────────── */}
      <section className={`${CARD} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-indigo-700">
              {L('Test topshiruvchilar', 'Экзаменуемые', 'Exam takers')}
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {ready ? (
                <span className="font-display text-[42px] leading-none font-extrabold tracking-tight text-gray-900 tabular-nums">
                  {fmt(takers)}
                </span>
              ) : (
                <Skel w="w-36" h="h-10" />
              )}
              <span className="text-[13.5px] text-gray-500">
                {L('kishi ro‘yxatda', 'человек в базе', 'people registered')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-[12.5px] font-medium text-gray-500">{todayLabel(lang)}</span>
            <button
              type="button"
              onClick={() => onNavigate('examinees')}
              className="h-9 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/25"
            >
              {L('Ro‘yxatni ochish', 'Открыть список', 'Open list')}
            </button>
          </div>
        </div>

        <div
          className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-gray-100"
          role="img"
          aria-label={segments.map((x) => `${x.label}: ${x.value}`).join(', ')}
        >
          {ready &&
            takers > 0 &&
            segments
              .filter((x) => x.value > 0)
              .map((x) => (
                <span
                  key={x.key}
                  className={`${x.dot} h-full border-r-2 border-white last:border-r-0`}
                  style={{ width: `${(x.value / takers) * 100}%` }}
                />
              ))}
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">
          {segments.map((x) => (
            <div key={x.key} className="flex items-start gap-2.5 min-w-0">
              <span className={`mt-[7px] w-2.5 h-2.5 rounded-[3px] shrink-0 ${x.dot}`} />
              <div className="min-w-0">
                {ready ? (
                  <p className="font-display text-[19px] font-bold leading-tight text-gray-900 tabular-nums">{fmt(x.value)}</p>
                ) : (
                  <Skel w="w-12" h="h-5" />
                )}
                <p className="text-[12.5px] text-gray-500 truncate">
                  {x.label}
                  {ready && takers > 0 ? ` · ${Math.round((x.value / takers) * 100)}%` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Imtihon / nazorat ko'rsatkichlari ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tiles.map((k) => (
          <button
            key={k.page + k.label}
            type="button"
            onClick={() => onNavigate(k.page)}
            className={`${CARD} group p-5 text-left transition-colors hover:border-indigo-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20`}
          >
            <p className="text-[13px] font-semibold text-gray-600">{k.label}</p>
            <div className="mt-2.5">
              {ready ? (
                <p className={`font-display text-[32px] leading-none font-extrabold tracking-tight tabular-nums ${k.tone}`}>
                  {fmt(k.value)}
                </p>
              ) : (
                <Skel w="w-20" h="h-8" />
              )}
            </div>
            <p className="mt-2.5 flex items-center justify-between gap-2 text-[12.5px] text-gray-500">
              <span className="truncate">{k.hint}</span>
              <span className="text-gray-300 transition-colors group-hover:text-indigo-600" aria-hidden>
                →
              </span>
            </p>
          </button>
        ))}
      </div>

      {/* ── Tuzilma + tezkor amallar ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <section className={`${CARD} lg:col-span-2 overflow-hidden`}>
          <div className="flex items-center justify-between px-5 pt-4 pb-3.5">
            <h3 className="text-[15px] font-bold text-gray-900">
              {L('Institut tuzilmasi', 'Структура института', 'Institute structure')}
            </h3>
            <span className="text-[12px] text-gray-500">
              {L('Boshqaruv bo‘limi', 'Раздел управления', 'Management')}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100 border-t border-gray-100">
            {structure.map((c) => (
              <button
                key={c.page}
                type="button"
                onClick={() => onNavigate(c.page)}
                className="bg-white text-left px-5 py-4 transition-colors hover:bg-indigo-50/60 focus:outline-none focus-visible:bg-indigo-50"
              >
                {ready ? (
                  <p className="font-display text-[24px] font-extrabold leading-none text-gray-900 tabular-nums">{fmt(c.value)}</p>
                ) : (
                  <Skel w="w-10" h="h-6" />
                )}
                <p className="mt-1.5 text-[12.5px] text-gray-500 leading-tight">{c.label}</p>
              </button>
            ))}
          </div>
        </section>

        <section className={`${CARD} p-2`}>
          <h3 className="px-3 pt-2.5 pb-2 text-[15px] font-bold text-gray-900">{t.quickActions}</h3>
          <div className="flex flex-col gap-0.5">
            {quick.map((q) => (
              <button
                key={q.page}
                type="button"
                onClick={() => onNavigate(q.page)}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:bg-indigo-50"
              >
                <span className="w-9 h-9 shrink-0 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center transition-colors group-hover:bg-indigo-600 group-hover:text-white">
                  <Ico d={q.d} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold leading-tight text-gray-900">{q.label}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-gray-500">{q.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
