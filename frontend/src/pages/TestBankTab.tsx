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
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkJson, setBulkJson] = useState(
    '[\n  {"text":"Namuna savol matni?","options":["To\'g\'ri javob","Noto\'g\'ri 1","Noto\'g\'ri 2","Noto\'g\'ri 3"],"correctAnswer":"To\'g\'ri javob"}\n]',
  );
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

  const importBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    if (!bulkCategoryId) {
      setMsg({ type: 'err', text: t.testBankPickCategory });
      return;
    }
    let arr: any[];
    try {
      arr = JSON.parse(bulkJson);
      if (!Array.isArray(arr)) throw new Error();
    } catch {
      setMsg({ type: 'err', text: t.testBankInvalidJson });
      return;
    }
    const res = await fetch(apiUrl('/api/admin/test-bank/questions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ category_id: Number(bulkCategoryId), questions: arr, language: 'uz' }),
    });
    const d = await readJsonSafe<{ error?: string }>(res);
    if (res.ok) {
      setMsg({ type: 'ok', text: `${t.testBankImported} (${arr.length})` });
      load();
    } else {
      setMsg({ type: 'err', text: d?.error || 'Error' });
    }
  };

  const item = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 26 } },
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
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
        <Card>
          <CardHeader>
            <CardTitle>{t.testBankCategories}</CardTitle>
            <p className="text-sm text-gray-500 font-normal">{t.testBankCategoriesHint}</p>
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
          <CardHeader>
            <CardTitle>{t.testBankBulkImport}</CardTitle>
            <p className="text-sm text-gray-500 font-normal">{t.testBankBulkHint}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={importBulk} className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">{t.testBankTargetCategory}</label>
                <select
                  className="w-full h-12 rounded-2xl border border-white/50 bg-white/50 px-4 text-sm"
                  value={bulkCategoryId}
                  onChange={(e) => setBulkCategoryId(e.target.value)}
                >
                  <option value="">{t.testBankPickCategory}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">JSON</label>
                <textarea
                  value={bulkJson}
                  onChange={(e) => setBulkJson(e.target.value)}
                  rows={10}
                  className="w-full rounded-2xl border border-white/50 bg-white/40 px-4 py-3 text-sm font-mono"
                />
              </div>
              <Button type="submit">{t.testBankImportBtn}</Button>
            </form>
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
