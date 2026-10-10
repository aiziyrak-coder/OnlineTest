import React, { useState } from 'react';
import { motion } from 'motion/react';
import { translations, Language } from '../i18n';
import { AdminExamsTab } from './AdminExamsTab';
import { TestCenterPage } from './admin/TestCenterPage';

/*
 * Nazoratchi kabineti.
 *
 * Nazoratchi imtihon payti hamma amalni bajara oladi (backend: STAFF_FULL_POWERS):
 * jonli ro'yxat, ekran va kamera kadri, sessiyani yakunlash, texnik muammoda
 * qayta ruxsat. Shuning uchun bu yerda admin paneldagi «Test markazi» oynasi
 * aynan o'zi qayta ishlatiladi — nazoratchi uchun alohida, kambag'alroq nusxa
 * yasash o'rniga. Odam o'chirish/blokdan chiqarish adminda qoladi.
 */

type Tab = 'center' | 'exams';

export function StaffDashboard({ token, lang }: { token: string; lang: Language }) {
  const t = translations[lang];
  const [tab, setTab] = useState<Tab>('center');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'center', label: t.staffTabCenter },
    { key: 'exams', label: t.staffTabExams },
  ];

  return (
    <div className="px-3 sm:px-6 pt-4 sm:pt-6 pb-6 max-w-7xl mx-auto space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between gap-3"
      >
        <div className="min-w-0">
          <h1 className="text-[18px] sm:text-[22px] font-bold tracking-tight text-gray-900 leading-tight">{t.staffPortalTitle}</h1>
          <p className="text-[13px] text-gray-500 mt-0.5 leading-relaxed">{t.staffPortalSubtitle}</p>
        </div>
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-md">
          {t.staffBadge}
        </span>
      </motion.div>

      <div className="flex flex-wrap gap-1.5 border-b border-gray-200">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            onClick={() => setTab(x.key)}
            aria-current={tab === x.key ? 'page' : undefined}
            className={`-mb-px rounded-t-lg px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
              tab === x.key
                ? 'border-b-2 border-indigo-600 text-indigo-700'
                : 'border-b-2 border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'center' ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-gray-500">{t.staffPowersNote}</p>
          <TestCenterPage token={token} lang={lang} />
        </>
      ) : (
        <AdminExamsTab token={token} lang={lang} apiVariant="staff" />
      )}
    </div>
  );
}
