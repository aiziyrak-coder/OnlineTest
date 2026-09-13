import React from 'react';
import { motion } from 'motion/react';
import { translations, Language } from '../i18n';
import { AdminExamsTab } from './AdminExamsTab';

export function StaffDashboard({ token, lang }: { token: string; lang: Language }) {
  const t = translations[lang];

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

      <AdminExamsTab token={token} lang={lang} apiVariant="staff" />
    </div>
  );
}
