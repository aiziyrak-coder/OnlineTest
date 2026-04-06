import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Button } from '../components/ui';
import { translations, Language } from '../i18n';
import { KontingentTab } from './KontingentTab';
import { TestBankTab } from './TestBankTab';
import { ImtixonTab } from './ImtixonTab';

export function AdminDashboard({ token, lang }: { token: string; lang: Language }) {
  const t = translations[lang];
  const [tab, setTab] = useState<'kontingent' | 'testBank' | 'imtixon'>('kontingent');

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };

  const item: any = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } },
  };

  return (
    <div className="p-2 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap gap-2 mb-8 bg-white/30 backdrop-blur-xl p-2 rounded-full border border-white/50 shadow-sm w-fit">
        <Button
          variant={tab === 'kontingent' ? 'default' : 'ghost'}
          onClick={() => setTab('kontingent')}
          className={tab === 'kontingent' ? 'shadow-md rounded-full' : 'rounded-full'}
        >
          {t.navKontingent}
        </Button>
        <Button
          variant={tab === 'testBank' ? 'default' : 'ghost'}
          onClick={() => setTab('testBank')}
          className={tab === 'testBank' ? 'shadow-md rounded-full' : 'rounded-full'}
        >
          {t.navTestBaza}
        </Button>
        <Button
          variant={tab === 'imtixon' ? 'default' : 'ghost'}
          onClick={() => setTab('imtixon')}
          className={tab === 'imtixon' ? 'shadow-md rounded-full' : 'rounded-full'}
        >
          {t.navImtixon}
        </Button>
      </div>

      <motion.div variants={container} initial="hidden" animate="show" key={tab}>
        <motion.div variants={item}>
          {tab === 'kontingent' && <KontingentTab token={token} lang={lang} />}
          {tab === 'testBank' && <TestBankTab token={token} lang={lang} />}
          {tab === 'imtixon' && <ImtixonTab token={token} lang={lang} />}
        </motion.div>
      </motion.div>
    </div>
  );
}
