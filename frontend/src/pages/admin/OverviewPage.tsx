import React, { useEffect, useState } from 'react';
import { translations, Language, type TranslationBundle } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import type { AdminStats } from './types';

type AdminPage =
  | 'levels' | 'kafedralar' | 'directions' | 'groups' | 'students'
  | 'banned' | 'staff' | 'exam_create' | 'exam_list' | 'examinees' | 'reports';

type Tone = 'accent' | 'ok' | 'warn' | 'bad';

const TONE: Record<Tone, { tile: string; num: string }> = {
  accent: { tile: 'bg-indigo-50 text-indigo-600', num: 'text-gray-900' },
  ok: { tile: 'bg-emerald-50 text-emerald-600', num: 'text-gray-900' },
  warn: { tile: 'bg-amber-50 text-amber-600', num: 'text-amber-600' },
  bad: { tile: 'bg-rose-50 text-rose-600', num: 'text-rose-600' },
};

const CARD =
  'rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_16px_rgba(16,24,40,0.05)]';

function Ico({ d }: { d: string }) {
  return (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d={d} />
    </svg>
  );
}

const KPI = (t: TranslationBundle, s: AdminStats) => [
  {
    label: t.totalUsers, value: s.totalUsers, tone: 'accent' as Tone, page: 'examinees' as AdminPage,
    sub: `${s.totalStudents} talaba · ${s.totalFaculty ?? 0} o‘qituvchi`,
    d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  },
  {
    label: t.totalExams, value: s.totalExams, tone: 'ok' as Tone, page: 'exam_list' as AdminPage,
    sub: 'faol va yakunlangan', d: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    label: t.totalViolations, value: s.totalViolations, tone: 'warn' as Tone, page: 'reports' as AdminPage,
    sub: 'nazorat qaydlari', d: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  {
    label: t.bannedUsers, value: s.bannedUsers, tone: 'bad' as Tone, page: 'examinees' as AdminPage,
    sub: 'chetlatilgan', d: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
  },
];

const CONTINGENT = (t: TranslationBundle, s: AdminStats) => [
  { label: t.totalStudents, value: s.totalStudents, page: 'examinees' as AdminPage },
  { label: 'Ordinatorlar', value: s.totalOrdinators ?? 0, page: 'examinees' as AdminPage },
  { label: 'Magistrlar', value: s.totalMagistrs ?? 0, page: 'examinees' as AdminPage },
  { label: t.sidebarFacultySub, value: s.totalFaculty ?? 0, page: 'examinees' as AdminPage },
  { label: t.totalKafedralar, value: s.totalKafedralar, page: 'kafedralar' as AdminPage },
  { label: t.totalDirections, value: s.totalDirections, page: 'directions' as AdminPage },
  { label: t.totalGroups, value: s.totalGroups, page: 'groups' as AdminPage },
  { label: t.totalLevels, value: s.totalLevels, page: 'levels' as AdminPage },
];

const QUICK = (t: TranslationBundle) => [
  { label: t.sidebarExamCreateSub, page: 'exam_create' as AdminPage, desc: t.quickActionExamCreateDesc, d: 'M12 4v16m8-8H4' },
  { label: t.sidebarExamListSub, page: 'exam_list' as AdminPage, desc: t.quickActionExamListDesc, d: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
  { label: 'Hisobotlar', page: 'reports' as AdminPage, desc: 'Natijalar, kafedra reytingi, eksport', d: 'M9 19v-6m4 6V9m4 10V5M4 21h16' },
  { label: 'Test topshiruvchilar', page: 'examinees' as AdminPage, desc: 'Talaba, ordinator, o‘qituvchi — bir joyda', d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M9 20H2v-2a3 3 0 015.356-1.857M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
];

interface Props {
  token: string;
  lang: Language;
  onNavigate: (page: AdminPage) => void;
}

export function OverviewPage({ token, lang, onNavigate }: Props) {
  const t = translations[lang];
  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0, totalExams: 0, totalViolations: 0, bannedUsers: 0,
    totalKafedralar: 0, totalDirections: 0, totalLevels: 0, totalGroups: 0,
    totalStudents: 0, totalFaculty: 0, totalOrdinators: 0, totalMagistrs: 0, totalVacancy: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch(apiUrl('/api/admin/stats'), { headers: authHeaders(token, lang) });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<AdminStats>(res);
      if (j) setStats(j);
      setLoading(false);
    })();
  }, [token]);

  const kpis = KPI(t, stats);
  const contingent = CONTINGENT(t, stats);
  const quick = QUICK(t);
  const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => onNavigate(k.page)}
            className={`${CARD} text-left p-5 transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
          >
            <div className="flex items-center justify-between mb-3.5">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${TONE[k.tone].tile}`}>
                <Ico d={k.d} />
              </span>
              <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            {loading ? (
              <div className="h-8 w-20 rounded-md bg-gray-100 animate-pulse" />
            ) : (
              <p className={`text-[30px] font-bold leading-none tracking-tight tabular-nums ${TONE[k.tone].num}`}>
                {fmt(k.value)}
              </p>
            )}
            <p className="mt-2 text-[13px] font-semibold text-gray-700">{k.label}</p>
            <p className="mt-0.5 text-[12px] text-gray-400 leading-snug">{k.sub}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className={`${CARD} xl:col-span-2 overflow-hidden`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-[15px] font-bold text-gray-900">{t.overviewContingentSection}</h3>
            <span className="text-[12px] text-gray-400 font-medium">Jami {fmt(stats.totalUsers)} foydalanuvchi</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-gray-100">
            {contingent.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onNavigate(c.page)}
                className="text-left px-5 py-4 hover:bg-gray-50/70 transition-colors"
              >
                {loading ? (
                  <div className="h-6 w-12 rounded bg-gray-100 animate-pulse" />
                ) : (
                  <p className="text-[22px] font-bold leading-none tabular-nums text-gray-900">{fmt(c.value)}</p>
                )}
                <p className="mt-1.5 text-[12.5px] text-gray-500 leading-tight">{c.label}</p>
              </button>
            ))}
          </div>
        </div>

        <div className={`${CARD} p-2`}>
          <div className="px-3 py-2.5">
            <h3 className="text-[15px] font-bold text-gray-900">{t.quickActions}</h3>
          </div>
          <div className="flex flex-col gap-1">
            {quick.map((q) => (
              <button
                key={q.page}
                type="button"
                onClick={() => onNavigate(q.page)}
                className="group flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-indigo-50/70 transition-colors text-left"
              >
                <span className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center shrink-0 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                  <Ico d={q.d} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-gray-800 leading-tight">{q.label}</span>
                  <span className="block text-[12px] text-gray-400 mt-0.5 leading-snug">{q.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
