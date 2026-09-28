import { useEffect, useMemo, useState } from 'react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { PeoplePage } from './PeoplePage';
import { ExamineesPage } from './ExamineesPage';
import { BannedPage } from './BannedPage';
import { ReceiptsPage } from './ReceiptsPage';
import { VacancyApplicantsPage } from './VacancyApplicantsPage';
import { VerificationPage } from './VerificationPage';
import { IntegrityDigestPage } from './IntegrityDigestPage';
import type { AdminStats } from './types';

/**
 * "Test topshiruvchilar" — barcha toifalar bitta sahifada.
 *
 * Yuqorida toifa tanlovi (soni bilan), pastda o'sha toifaning ishchi
 * jadvali. Talaba va o'qituvchi — PeoplePage (serverda sahifalanadi, kurs /
 * yo'nalish / guruh / kafedra / rasm filtri). Ordinator, magistr, maxsus
 * kiruvchi — to'lov/ruxsat mantig'i bor ExamineesPage. "Nazorat" guruhi —
 * chetlatilganlar va kvitansiyalar.
 */
type HubTab = 'students' | 'faculty' | 'ordinators' | 'magistrs' | 'entrants' | 'vacancy' | 'banned' | 'receipts' | 'verify' | 'digest';

const STORE_KEY = 'admin_examinees_tab';
const TABS: HubTab[] = ['students', 'faculty', 'ordinators', 'magistrs', 'entrants', 'vacancy', 'banned', 'receipts', 'verify', 'digest'];

export function ExamineesHub({
  token,
  lang,
  bannedCount = 0,
}: {
  token: string;
  lang: Language;
  bannedCount?: number;
}) {
  const L = (uz: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : uz);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [verifyCount, setVerifyCount] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState<HubTab>(() => {
    try {
      const v = sessionStorage.getItem(STORE_KEY) as HubTab | null;
      return v && TABS.includes(v) ? v : 'students';
    } catch {
      return 'students';
    }
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/admin/stats'), { headers: authHeaders(token, lang) });
        if (!checkAdminAuthResponse(res)) return;
        const j = await readJsonSafe<AdminStats>(res);
        if (j) setStats(j);
      } catch {
        /* sonlarsiz ham ishlaydi */
      }
    })();
  }, [token, lang]);

  const select = (t: HubTab) => {
    setTab(t);
    try {
      sessionStorage.setItem(STORE_KEY, t);
    } catch {
      /* ignore */
    }
  };

  const groups = useMemo(
    () => [
      {
        label: L('Toifalar', 'Категории', 'Groups'),
        items: [
          { id: 'students' as HubTab, label: L('Talabalar', 'Студенты', 'Students'), count: stats?.totalStudents },
          { id: 'faculty' as HubTab, label: L("O'qituvchilar", 'Преподаватели', 'Teachers'), count: stats?.totalFaculty },
          { id: 'ordinators' as HubTab, label: L('Ordinatorlar', 'Ординаторы', 'Residents'), count: stats?.totalOrdinators },
          { id: 'magistrs' as HubTab, label: L('Magistrlar', 'Магистранты', 'Master students'), count: stats?.totalMagistrs },
          { id: 'entrants' as HubTab, label: L('Maxsus kiruvchilar', 'Спец. поступающие', 'Special entrants'), count: undefined },
          { id: 'vacancy' as HubTab, label: L('Ishga nomzodlar', 'Кандидаты', 'Job applicants'), count: stats?.totalVacancy },
        ],
      },
      {
        label: L('Nazorat', 'Контроль', 'Control'),
        items: [
          { id: 'digest' as HubTab, label: L('Kunlik nazorat', 'Ежедневный контроль', 'Daily review'), count: undefined },
          { id: 'verify' as HubTab, label: L('Tasdiqlash navbati', 'Очная проверка', 'Verification'), count: verifyCount, alert: true },
          { id: 'banned' as HubTab, label: L('Chetlatilganlar', 'Заблокированные', 'Banned'), count: bannedCount, alert: true },
          { id: 'receipts' as HubTab, label: L('Kvitansiyalar', 'Квитанции', 'Receipts'), count: undefined },
        ],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats, bannedCount, verifyCount, lang],
  );

  return (
    <div className="space-y-5">
      <nav
        className="flex flex-wrap items-stretch gap-x-6 gap-y-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]"
        aria-label={L('Test topshiruvchilar', 'Экзаменуемые', 'Exam takers')}
      >
        {groups.map((g, gi) => (
          <div key={g.label} className={`flex min-w-0 flex-col gap-1.5 ${gi > 0 ? 'lg:border-l lg:border-gray-100 lg:pl-6' : ''}`}>
            <span className="px-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-gray-400">{g.label}</span>
            <div className="flex flex-wrap gap-1.5" role="tablist">
              {g.items.map((it) => {
                const on = tab === it.id;
                const alert = 'alert' in it && it.alert && (it.count || 0) > 0;
                return (
                  <button
                    key={it.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => select(it.id)}
                    className={`inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 ${
                      on ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {it.label}
                    {it.count != null ? (
                      <span
                        className={`rounded-full px-1.5 py-px text-[11.5px] font-bold tabular-nums ${
                          on ? 'bg-white/20 text-white' : alert ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {String(it.count).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div>
        {tab === 'students' && <PeoplePage key="student" token={token} lang={lang} role="student" />}
        {tab === 'faculty' && <PeoplePage key="faculty" token={token} lang={lang} role="faculty" />}
        {tab === 'ordinators' && <ExamineesPage token={token} lang={lang} role="ordinator" />}
        {tab === 'magistrs' && <ExamineesPage token={token} lang={lang} role="magistr" />}
        {tab === 'entrants' && <ExamineesPage token={token} lang={lang} role="entrant" />}
        {tab === 'vacancy' && <VacancyApplicantsPage token={token} lang={lang} />}
        {tab === 'banned' && <BannedPage token={token} lang={lang} />}
        {tab === 'receipts' && <ReceiptsPage token={token} lang={lang} />}
        {tab === 'verify' && <VerificationPage token={token} lang={lang} onCount={setVerifyCount} />}
        {tab === 'digest' && <IntegrityDigestPage token={token} lang={lang} />}
      </div>
    </div>
  );
}

export default ExamineesHub;
