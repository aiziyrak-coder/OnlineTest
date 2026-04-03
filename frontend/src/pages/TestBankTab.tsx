import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from '../components/ui';
import { translations, Language } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';

export function TestBankTab({ token, lang }: { token: string; lang: Language }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [filterCat, setFilterCat] = useState<string>('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [smartFile, setSmartFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [smartLang, setSmartLang] = useState<'uz' | 'ru' | 'en'>(lang);
  const [smartBusy, setSmartBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const t = translations[lang];

  const load = async () => {
    const h = { Authorization: `Bearer ${token}` };
    const [cRes, qRes] = await Promise.all([
      fetch(apiUrl('/api/admin/test-bank/categories'), { headers: h }),
      fetch(apiUrl(`/api/admin/test-bank/questions${filterCat ? `?category_id=${filterCat}` : ''}`), {
        headers: h,
      }),
    ]);
    const c = cRes.ok ? await readJsonSafe<any[]>(cRes) : null;
    const q = qRes.ok ? await readJsonSafe<any[]>(qRes) : null;
    setCategories(Array.isArray(c) ? c : []);
    setQuestions(Array.isArray(q) ? q : []);
  };

  useEffect(() => {
    load();
  }, [filterCat]);

  const addCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    const res = await fetch(apiUrl('/api/admin/test-bank/categories'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newCatName, description: newCatDesc }),
    });
    if (res.ok) {
      setNewCatName('');
      setNewCatDesc('');
      setMsg({ type: 'ok', text: t.testBankCatAdded });
      load();
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      setMsg({ type: 'err', text: d?.error || 'Error' });
    }
  };

  const delCategory = async (id: number) => {
    if (!confirm(t.testBankCatDeleteConfirm)) return;
    await fetch(apiUrl(`/api/admin/test-bank/categories/${id}`), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    load();
  };

  const importSmart = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    if (!smartFile) {
      setMsg({ type: 'err', text: t.testBankAiNeedPdf });
      return;
    }
    const name = smartFile.name?.toLowerCase() || '';
    if (!name.endsWith('.pdf') && smartFile.type !== 'application/pdf') {
      setMsg({ type: 'err', text: t.testBankAiPdfOnly });
      return;
    }
    setSmartBusy(true);
    const h: HeadersInit = { Authorization: `Bearer ${token}` };
    try {
      const fd = new FormData();
      fd.append('file', smartFile);
      fd.append('language', smartLang);
      const res = await fetch(apiUrl('/api/admin/test-bank/import-smart'), { method: 'POST', headers: h, body: fd });
      const d = await readJsonSafe<{
        error?: string;
        detail?: string;
        inserted?: number;
        categories?: { name: string; questions_added: number }[];
      }>(res);
      if (res.ok && d && typeof d.inserted === 'number') {
        const catLines =
          Array.isArray(d.categories) && d.categories.length
            ? d.categories.map((c) => `${c.name}: +${c.questions_added}`).join('; ')
            : '';
        setMsg({
          type: 'ok',
          text: `${t.testBankAiResult.replace('{n}', String(d.inserted))}${catLines ? ` — ${t.testBankAiCategories}: ${catLines}` : ''}`,
        });
        setSmartFile(null);
        setFileKey((k) => k + 1);
        load();
      } else {
        const err = d?.error || d?.detail || 'Error';
        setMsg({ type: 'err', text: err });
      }
    } finally {
      setSmartBusy(false);
    }
  };

  const item = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 26 } },
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">{t.testBankPageTitle}</h2>
        <p className="text-sm text-gray-500">{t.testBankCategoriesHint}</p>
      </div>
      {msg.text && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`text-sm px-4 py-3 rounded-2xl border ${msg.type === 'ok' ? 'bg-green-500/10 border-green-500/20 text-green-800' : 'bg-red-500/10 border-red-500/20 text-red-800'}`}
        >
          {msg.text}
        </motion.div>
      )}

      <motion.div variants={item} initial="hidden" animate="show">
        <Card className="border-violet-200/60 bg-gradient-to-br from-violet-50/40 to-white/30">
          <CardHeader>
            <CardTitle>{t.testBankAiTitle}</CardTitle>
            <p className="text-sm text-gray-500 font-normal">{t.testBankAiHint}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={importSmart} className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[220px]">
                  <label className="text-xs text-gray-500 block mb-1">{t.testBankAiPdfLabel}</label>
                  <Input
                    key={fileKey}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => setSmartFile(e.target.files?.[0] ?? null)}
                    className="cursor-pointer"
                  />
                </div>
                <div className="min-w-[140px]">
                  <label className="text-xs text-gray-500 block mb-1">{t.testBankAiLanguage}</label>
                  <select
                    className="w-full h-12 rounded-2xl border border-white/50 bg-white/50 px-4 text-sm"
                    value={smartLang}
                    onChange={(e) => setSmartLang(e.target.value as 'uz' | 'ru' | 'en')}
                  >
                    <option value="uz">O‘zbek</option>
                    <option value="ru">Русский</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <Button type="submit" disabled={smartBusy} className="shrink-0">
                  {smartBusy ? t.testBankAiRunning : t.testBankAiRun}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={item} initial="hidden" animate="show">
        <Card>
          <CardHeader>
            <CardTitle>{t.testBankCategories}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={addCategory} className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[160px]">
                <label className="text-xs text-gray-500 block mb-1">{t.testBankCatName}</label>
                <Input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} required placeholder="Ichki kasalliklari" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-gray-500 block mb-1">{t.testBankCatDesc}</label>
                <Input value={newCatDesc} onChange={(e) => setNewCatDesc(e.target.value)} placeholder="Qisqa izoh" />
              </div>
              <Button type="submit">{t.testBankAddCat}</Button>
            </form>
            <ul className="divide-y divide-black/5 border border-white/40 rounded-2xl overflow-hidden bg-white/20">
              {categories.map((c) => (
                <li key={c.id} className="flex justify-between items-center px-4 py-3 gap-2">
                  <div>
                    <span className="font-medium text-gray-900">{c.name}</span>
                    <span className="text-xs text-gray-500 ml-2">({c.question_count ?? 0} savol)</span>
                    {c.description ? <p className="text-xs text-gray-500 mt-0.5">{c.description}</p> : null}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="shrink-0 text-red-600 border-red-200" onClick={() => delCategory(c.id)}>
                    {t.testBankDelete}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={item} initial="hidden" animate="show">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>{t.testBankRecentQuestions}</CardTitle>
            <select
              className="text-sm rounded-xl border border-white/50 bg-white/50 px-3 py-2"
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
            >
              <option value="">{t.testBankAllCats}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto text-sm space-y-2">
            {questions.slice(0, 80).map((q) => (
              <div key={q.id} className="p-3 rounded-xl bg-white/30 border border-white/30 text-gray-800">
                <span className="text-[10px] uppercase text-gray-400">{q.category_name || '—'}</span>
                <p className="mt-1">{q.text}</p>
              </div>
            ))}
            {questions.length === 0 && <p className="text-gray-500 text-center py-8">{t.testBankNoQuestions}</p>}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
