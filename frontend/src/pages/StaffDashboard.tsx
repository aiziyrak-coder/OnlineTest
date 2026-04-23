import React from 'react';
import { motion } from 'motion/react';
import { translations, Language } from '../i18n';
import { AdminExamsTab } from './AdminExamsTab';

export function StaffDashboard({ token, lang }: { token: string; lang: Language }) {
  const t = translations[lang];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 via-white/60 to-teal-50/40 p-6 sm:p-8 shadow-sm shadow-emerald-900/5"
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-emerald-950 tracking-tight">{t.staffPortalTitle}</h2>
            <p className="text-emerald-900/75 mt-2 text-sm sm:text-base max-w-2xl leading-relaxed">{t.staffPortalSubtitle}</p>
          </div>
          <div className="shrink-0 rounded-2xl bg-emerald-600/10 border border-emerald-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-emerald-800">
            staff
          </div>
        </div>
      </motion.div>

      <AdminExamsTab token={token} lang={lang} hideExamSettings apiVariant="staff" />
    </div>
  );
}
