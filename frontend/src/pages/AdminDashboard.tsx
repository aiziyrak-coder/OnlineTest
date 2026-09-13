import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate as useRRNavigate, useLocation } from 'react-router-dom';
import { translations, Language } from '../i18n';
import { apiUrl } from '../lib/apiUrl';
import { authHeaders } from '../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../lib/http';
import { ImtixonTab } from './ImtixonTab';
import { AdminExamsTab } from './AdminExamsTab';
import { ExamineesHub } from './admin/ExamineesHub';
import { OverviewPage } from './admin/OverviewPage';
import { LevelsPage } from './admin/LevelsPage';
import { KafedralarPage } from './admin/KafedralarPage';
import { ReportsPage } from './admin/ReportsPage';
import { VacancyApplicantsPage } from './admin/VacancyApplicantsPage';
import { ExamineesPage } from './admin/ExamineesPage';
import { ReceiptsPage } from './admin/ReceiptsPage';
import { DirectionsPage } from './admin/DirectionsPage';
import { GroupsPage } from './admin/GroupsPage';
import { StudentsPage } from './admin/StudentsPage';
import { FacultyPage } from './admin/FacultyPage';
import { BannedPage } from './admin/BannedPage';
import { StaffPage } from './admin/StaffPage';
import { AuditPage } from './admin/AuditPage';
import { AdminToastLayer } from './admin/ui';
import type { Level, Group } from './admin/types';

type AdminPage =
  | 'overview'
  | 'examinees'
  | 'levels'
  | 'kafedralar'
  | 'directions'
  | 'groups'
  | 'students'
  | 'faculty'
  | 'banned'
  | 'staff'
  | 'audit'
  | 'exam_create'
  | 'exam_list'
  | 'reports'
  | 'vacancy'
  | 'ordinators'
  | 'magistrs'
  | 'receipts'
  | 'entrants';

interface NavItem {
  id: AdminPage;
  icon: React.ReactNode;
  badgeKey?: 'banned';
}

const IC = {
  overview: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  examinees: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  levels: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  kafedralar: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 6v-3a1 1 0 011-1h2a1 1 0 011 1v3" />
    </svg>
  ),
  directions: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
    </svg>
  ),
  groups: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  students: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
    </svg>
  ),
  faculty: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  banned: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  ),
  staff: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6a4 4 0 11-8 0 4 4 0 018 0zM12 14v7" />
    </svg>
  ),
  exam_create: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  exam_list: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  vacancy: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6a3 3 0 116 0 3 3 0 01-6 0zM4 20a8 8 0 1116 0H4z" />
    </svg>
  ),
  reports: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6m4 6V9m4 10V5M4 21h16" />
    </svg>
  ),
  ordinators: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
    </svg>
  ),
  magistrs: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  ),
  entrants: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  receipts: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
    </svg>
  ),
  audit: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
};

const PAGE_PATHS: Record<AdminPage, string> = {
  overview:     '/admin',
  examinees:    '/admin/test-topshiruvchilar',
  levels:       '/admin/levels',
  kafedralar:   '/admin/kafedralar',
  directions:   '/admin/directions',
  groups:       '/admin/groups',
  students:     '/admin/students',
  faculty:      '/admin/faculty',
  banned:       '/admin/banned',
  staff:        '/admin/staff',
  audit:        '/admin/audit',
  exam_create:  '/admin/exam/create',
  exam_list:    '/admin/exam/list',
  reports:      '/admin/reports',
  vacancy:      '/admin/vakansiya',
  ordinators:   '/admin/ordinatorlar',
  magistrs:     '/admin/magistrlar',
  receipts:     '/admin/kvitansiyalar',
  entrants:     '/admin/maxsus-kiruvchilar',
};

function pathToPage(pathname: string): AdminPage {
  if (pathname === '/admin/testbank') return 'exam_create';
  // Longest path first so /admin/exam/create doesn't accidentally match /admin
  const sorted = (Object.entries(PAGE_PATHS) as [AdminPage, string][])
    .sort((a, b) => b[1].length - a[1].length);
  const found = sorted.find(([, path]) => pathname === path);
  return found ? found[0] : 'overview';
}

function isKnownAdminPath(pathname: string): boolean {
  return Object.values(PAGE_PATHS).includes(pathname);
}

export function AdminDashboard({
  token,
  lang,
  adminUserId,
}: {
  token: string;
  lang: Language;
  adminUserId?: string;
}) {
  const t = translations[lang];
  const rrNavigate = useRRNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bannedCount, setBannedCount] = useState(0);

  const knownPath = isKnownAdminPath(location.pathname);
  const page = knownPath ? pathToPage(location.pathname) : 'overview';

  // Cross-page navigation state
  const [filterLevelId, setFilterLevelId] = useState<number | null>(null);
  const [filterGroupId, setFilterGroupId] = useState<number | null>(null);

  useEffect(() => {
    if (location.pathname === '/admin/testbank') {
      rrNavigate(PAGE_PATHS.exam_create, { replace: true });
    }
  }, [location.pathname, rrNavigate]);

  useEffect(() => {
    fetch(apiUrl('/api/admin/stats'), { headers: authHeaders(token, lang) })
      .then(async (res) => {
        if (!checkAdminAuthResponse(res) || !res.ok) return;
        const j = await readJsonSafe<{ bannedUsers?: number }>(res);
        if (j?.bannedUsers != null) setBannedCount(j.bannedUsers);
      })
      .catch(() => {});
  }, [token]);

  const navigateTo = (p: AdminPage) => {
    rrNavigate(PAGE_PATHS[p]);
    setSidebarOpen(false);
  };

  const navigateSidebar = (p: AdminPage) => {
    setFilterLevelId(null);
    setFilterGroupId(null);
    navigateTo(p);
  };

  const L2 = (uz: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : uz);
  const navGroups: { label: string; items: { id: AdminPage; label: string; color?: string }[] }[] = [
    {
      label: '',
      items: [{ id: 'overview', label: t.navOverview }],
    },
    {
      label: L2('Hisobotlar', 'Otchety', 'Reports'),
      items: [{ id: 'reports', label: L2('Hisobotlar', 'Otchety', 'Reports') }],
    },
    {
      label: L2('Test topshiruvchilar', 'Ekzamenuemye', 'Exam takers'),
      items: [{ id: 'examinees', label: L2('Test topshiruvchilar', 'Ekzamenuemye', 'Exam takers') }],
    },
    {
      label: L2('Imtihonlar', 'Ekzameny', 'Exams'),
      items: [
        { id: 'exam_create', label: t.sidebarExamCreateSub },
        { id: 'exam_list', label: t.sidebarExamListSub },
      ],
    },
    {
      label: L2('Boshqaruv', 'Upravlenie', 'Management'),
      items: [
        { id: 'kafedralar', label: t.kontingentKafedralar },
        { id: 'directions', label: t.kontingentDirections },
        { id: 'groups', label: t.sidebarGroupsSub },
        { id: 'levels', label: t.sidebarLevelsSub },
        { id: 'staff', label: t.sidebarStaffSub },
        { id: 'audit', label: t.sidebarAuditSub },
      ],
    },
  ];

  const { pageTitle, pageSection } = (() => {
    for (const g of navGroups) {
      const found = g.items.find((it) => it.id === page);
      if (found) return { pageTitle: found.label, pageSection: g.label };
    }
    return { pageTitle: '', pageSection: '' };
  })();
  // Breadcrumb-ko'rinish: bo'lim nomi (bo'lsa), aks holda umumiy panel nomi.
  const pageSubtitle = pageSection || t.adminDash;

  const SidebarContent = () => (
    <nav className="flex flex-col pb-4 px-3">
      {navGroups.map((group, gi) => (
        <div key={gi} className={gi > 0 ? 'mt-5' : ''}>
          {group.label && (
            <p className="px-2.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-gray-400 mb-2">
              {group.label}
            </p>
          )}
          <div className="flex flex-col gap-1">
            {group.items.map((item) => {
              const isActive = page === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateSidebar(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : item.color === 'red'
                        ? 'text-red-500 hover:bg-red-50 hover:text-red-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <span className="shrink-0">{IC[item.id]}</span>
                  <span className={`truncate text-[13.5px] leading-snug ${isActive ? 'font-semibold' : 'font-medium'}`}>
                    {item.label}
                  </span>
                  {item.id === 'examinees' && bannedCount > 0 && (
                    <span className="ml-auto shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold tabular-nums flex items-center justify-center">
                      {bannedCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-[calc(100vh-var(--admin-header-h,62px))] relative">
      <AdminToastLayer />
      {/* ── Desktop sidebar (fixed, header ostidan boshlanadi) ─────────────── */}
      <aside className="hidden lg:flex flex-col w-60 fixed left-0 top-[62px] sm:top-[66px] z-30 h-[calc(100vh-62px)] sm:h-[calc(100vh-66px)] border-r border-gray-200 bg-white overflow-y-auto overscroll-contain">
        <SidebarContent />
      </aside>
      <div className="hidden lg:block w-60 shrink-0" aria-hidden />

      {/* ── Mobile sidebar drawer ──────────────────────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="fixed top-0 left-0 z-50 h-full w-64 bg-white shadow-2xl lg:hidden overflow-y-auto"
            >
              <div className="flex items-center justify-between px-4 h-[62px] sm:h-[66px] border-b border-gray-100">
                <p className="font-bold text-gray-800 text-[15px]">{t.adminDash}</p>
                <button onClick={() => setSidebarOpen(false)}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 pl-0 lg:pl-6 pr-4 lg:pr-6 py-6 overflow-x-hidden text-[15px]">
        {/* Page header */}
        <div className="flex items-center gap-3 mb-5">
          <button
            type="button"
            className="lg:hidden w-9 h-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center shrink-0 hover:bg-gray-50 transition"
            onClick={() => setSidebarOpen(true)}
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 leading-tight">{pageTitle}</h1>
            <p className="text-xs font-medium text-gray-400 mt-0.5 tracking-wide">{pageSubtitle}</p>
          </div>
        </div>

        {/* Page content */}
        <motion.div
          key={knownPath ? page : 'not-found'}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          {!knownPath ? (
            <div className="text-center py-16 px-4">
              <p className="text-lg font-semibold text-gray-800 mb-2">{t.adminPageNotFound}</p>
              <button
                type="button"
                onClick={() => navigateSidebar('overview')}
                className="text-indigo-600 hover:text-indigo-800 text-[14px] font-medium underline"
              >
                {t.adminBackToDashboard}
              </button>
            </div>
          ) : (
          <>
          {page === 'overview' && (
            <OverviewPage token={token} lang={lang} onNavigate={navigateSidebar} />
          )}
          {page === 'examinees' && (
            <ExamineesHub token={token} lang={lang} bannedCount={bannedCount} />
          )}
          {page === 'levels' && (
            <LevelsPage
              token={token}
              lang={lang}
              onViewGroups={(level: Level) => {
                setFilterLevelId(level.id);
                navigateTo('groups');
              }}
            />
          )}
          {page === 'kafedralar' && (
            <KafedralarPage token={token} lang={lang} />
          )}
          {page === 'directions' && (
            <DirectionsPage token={token} lang={lang} />
          )}
          {page === 'groups' && (
            <GroupsPage
              token={token}
              lang={lang}
              initialLevelId={filterLevelId}
              onViewStudents={(group: Group) => {
                setFilterGroupId(group.id);
                navigateTo('students');
              }}
            />
          )}
          {page === 'students' && (
            <StudentsPage token={token} lang={lang} initialGroupId={filterGroupId} />
          )}
          {page === 'faculty' && (
            <FacultyPage token={token} lang={lang} />
          )}
          {page === 'banned' && (
            <BannedPage token={token} lang={lang} />
          )}
          {page === 'staff' && (
            <StaffPage token={token} lang={lang} />
          )}
          {page === 'audit' && (
            <AuditPage token={token} lang={lang} />
          )}
          {page === 'exam_create' && (
            <ImtixonTab token={token} lang={lang} adminUserId={adminUserId} />
          )}
          {page === 'exam_list' && (
            <AdminExamsTab token={token} lang={lang} />
          )}
          {page === 'reports' && (
            <ReportsPage token={token} lang={lang} />
          )}
          {page === 'vacancy' && (
            <VacancyApplicantsPage token={token} lang={lang} />
          )}
          {page === 'ordinators' && (
            <ExamineesPage token={token} lang={lang} role="ordinator" />
          )}
          {page === 'magistrs' && (
            <ExamineesPage token={token} lang={lang} role="magistr" />
          )}
          {page === 'receipts' && (
            <ReceiptsPage token={token} lang={lang} />
          )}
          {page === 'entrants' && (
            <ExamineesPage token={token} lang={lang} role="entrant" />
          )}
          </>
          )}
        </motion.div>
      </main>
    </div>
  );
}
