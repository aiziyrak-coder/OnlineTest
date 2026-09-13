import React, { useState } from 'react';
import { Language } from '../../i18n';
import { StudentsPage } from './StudentsPage';
import { ExamineesPage } from './ExamineesPage';
import { FacultyPage } from './FacultyPage';
import { BannedPage } from './BannedPage';
import { ReceiptsPage } from './ReceiptsPage';
import { VacancyApplicantsPage } from './VacancyApplicantsPage';

/**
 * "Test topshiruvchilar" — barcha toifadagi topshiruvchilar bitta sahifada,
 * rol bo'yicha tab bilan. Har bir tab mavjud sahifani qayta ishlatadi
 * (talabalar 1-6 kurs + kafedra filtri, ordinator/magistr/maxsus, o'qituvchilar,
 * nomzodlar, chetlatilganlar, kvitansiyalar).
 */
type HubTab =
  | 'students'
  | 'ordinators'
  | 'magistrs'
  | 'faculty'
  | 'entrants'
  | 'vacancy'
  | 'banned'
  | 'receipts';

const L = (lang: Language, uz: string, ru: string, en: string) =>
  lang === 'ru' ? ru : lang === 'en' ? en : uz;

const STORE_KEY = 'admin_examinees_tab';

export function ExamineesHub({
  token,
  lang,
  bannedCount = 0,
}: {
  token: string;
  lang: Language;
  bannedCount?: number;
}) {
  const [tab, setTab] = useState<HubTab>(() => {
    try {
      const v = sessionStorage.getItem(STORE_KEY) as HubTab | null;
      return v || 'students';
    } catch {
      return 'students';
    }
  });
  const select = (t: HubTab) => {
    setTab(t);
    try {
      sessionStorage.setItem(STORE_KEY, t);
    } catch {
      /* ignore */
    }
  };

  const tabs: { id: HubTab; label: string; badge?: number }[] = [
    { id: 'students', label: L(lang, 'Talabalar', 'Studenty', 'Students') },
    { id: 'ordinators', label: L(lang, 'Ordinatorlar', 'Ordinatory', 'Residents') },
    { id: 'magistrs', label: L(lang, 'Magistrlar', 'Magistry', "Master's") },
    { id: 'faculty', label: L(lang, "O'qituvchilar", 'Prepodavateli', 'Teachers') },
    { id: 'entrants', label: L(lang, 'Maxsus kiruvchilar', 'Osobye', 'Special entrants') },
    { id: 'vacancy', label: L(lang, 'Nomzodlar', 'Kandidaty', 'Applicants') },
    { id: 'banned', label: L(lang, 'Chetlatilganlar', 'Otstranennye', 'Banned'), badge: bannedCount },
    { id: 'receipts', label: L(lang, 'Kvitansiyalar', 'Kvitantsii', 'Receipts') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-gray-200 pb-2">
        {tabs.map((tb) => {
          const active = tab === tb.id;
          return (
            <button
              key={tb.id}
              type="button"
              onClick={() => select(tb.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                active
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
              }`}
            >
              {tb.label}
              {tb.badge && tb.badge > 0 ? (
                <span
                  className={`min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums flex items-center justify-center ${
                    active ? 'bg-white/25 text-white' : 'bg-red-100 text-red-700'
                  }`}
                >
                  {tb.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div>
        {tab === 'students' && <StudentsPage token={token} lang={lang} />}
        {tab === 'ordinators' && <ExamineesPage token={token} lang={lang} role="ordinator" />}
        {tab === 'magistrs' && <ExamineesPage token={token} lang={lang} role="magistr" />}
        {tab === 'faculty' && <FacultyPage token={token} lang={lang} />}
        {tab === 'entrants' && <ExamineesPage token={token} lang={lang} role="entrant" />}
        {tab === 'vacancy' && <VacancyApplicantsPage token={token} lang={lang} />}
        {tab === 'banned' && <BannedPage token={token} lang={lang} />}
        {tab === 'receipts' && <ReceiptsPage token={token} lang={lang} />}
      </div>
    </div>
  );
}

export default ExamineesHub;
