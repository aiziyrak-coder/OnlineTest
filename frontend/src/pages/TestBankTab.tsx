import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from '../components/ui';
import { translations, Language } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';

export function TestBankTab({ token, lang }: { token: string; lang: Language }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [collectionName, setCollectionName] = useState('');
  const [smartFile, setSmartFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [smartBusy, setSmartBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const t = translations[lang];

  const load = async () => {
    const h = { Authorization: `Bearer ${token}` };
    const cRes = await fetch(apiUrl('/api/admin/test-bank/categories'), { headers: h });
    const c = cRes.ok ? await readJsonSafe<any[]>(cRes) : null;
    setCategories(Array.isArray(c) ? c : []);
  };

  useEffect(() => {
    load();
  }, [token]);

  const delCategory = async (id: number) => {
    if (!confirm(t.testBankCatDeleteConfirm)) return;
    await fetch(apiUrl(`/api/admin/test-bank/categories/${id}`), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    load();
  };

  const importSmart = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    const name = collectionName.trim();
    if (!name) {
      setMsg({ type: 'err', text: t.testCollectionNameEn });
      return;
    }
    if (!smartFile) {
      setMsg({ type: 'err', text: t.testBankAiNeedPdf });
      return;
    }
    const fn = smartFile.name?.toLowerCase() || '';
    const okExt = fn.endsWith('.pdf') || fn.endsWith('.docx') || fn.endsWith('.doc');
    if (!okExt) {
      setMsg({ type: 'err', text: 'PDF, DOC yoki DOCX' });
      return;
    }
    setSmartBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', smartFile);
      fd.append('collection_name', name);
      fd.append('language', 'auto');
      const res = await fetch(apiUrl('/api/admin/test-bank/import-smart'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const d = await readJsonSafe<{
        error?: string;
        detail?: string;
        inserted?: number;
        detected?: number;
        chunks?: number;
        translation_limited?: boolean;
        ai_skipped_for_size?: boolean;
        categories?: { name: string; questions_added: number }[];
      }>(res);
      if (res.ok && d && typeof d.inserted === 'number') {
        const catLines =
          Array.isArray(d.categories) && d.categories.length
            ? d.categories.map((c) => `${c.name}: +${c.questions_added}`).join('; ')
            : '';
        setMsg({
          type: 'ok',
          text: `${t.testBankAiResult.replace('{n}', String(d.inserted))}${typeof d.detected === 'number' ? ` · topildi: ${d.detected}` : ''}${catLines ? ` — ${catLines}` : ''}${d.chunks && d.chunks > 1 ? ` · chunks: ${d.chunks}` : ''}${d.ai_skipped_for_size ? ' · katta fayl: lokal parser ishlatildi' : ''}${d.translation_limited ? ' · tarjima qisman (katta fayl)' : ''}`,
        });
        setSmartFile(null);
        setFileKey((k) => k + 1);
        load();
      } else {
        setMsg({ type: 'err', text: d?.error || d?.detail || 'Error' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Tarmoq xatosi yoki timeout. API/Nginx logini tekshiring.' });
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
        <p className="text-sm text-gray-500 max-w-xl mx-auto">{t.testCollectionFileHint}</p>
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
          </CardHeader>
          <CardContent>
            <form onSubmit={importSmart} className="space-y-4">
              <div>
                <label className="text-xs text-gray-600 block mb-1 font-medium">{t.testCollectionNameEn}</label>
                <Input value={collectionName} onChange={(e) => setCollectionName(e.target.value)} placeholder="Internal Medicine Final — EN" required />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">{t.testBankAiPdfLabel}</label>
                <Input
                  key={fileKey}
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => setSmartFile(e.target.files?.[0] ?? null)}
                  className="cursor-pointer"
                />
              </div>
              <Button type="submit" disabled={smartBusy}>
                {smartBusy ? t.testBankAiRunning : t.testBankAiRun}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={item} initial="hidden" animate="show">
        <Card>
          <CardHeader>
            <CardTitle>{t.testCollectionsList}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-4">
              {categories.map((c) => (
                <li key={c.id} className="p-4 rounded-2xl border border-white/40 bg-white/25 space-y-3">
                  <div className="flex flex-wrap justify-between gap-2 items-start">
                    <div>
                      <p className="font-semibold text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {c.question_count ?? 0} savol · EN → UZ / RU
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="text-red-600 border-red-200 shrink-0" onClick={() => delCategory(c.id)}>
                      {t.testBankDelete}
                    </Button>
                  </div>
                  {c.preview && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                      <div className="p-2 rounded-xl bg-white/50 border border-white/40">
                        <span className="font-semibold text-gray-600 block mb-1">EN</span>
                        <p className="text-gray-800 line-clamp-4">{c.preview.text_en || '—'}</p>
                      </div>
                      <div className="p-2 rounded-xl bg-emerald-50/50 border border-emerald-100">
                        <span className="font-semibold text-emerald-800 block mb-1">UZ</span>
                        <p className="text-gray-800 line-clamp-4">{c.preview.text_uz || '—'}</p>
                      </div>
                      <div className="p-2 rounded-xl bg-sky-50/50 border border-sky-100">
                        <span className="font-semibold text-sky-900 block mb-1">RU</span>
                        <p className="text-gray-800 line-clamp-4">{c.preview.text_ru || '—'}</p>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {categories.length === 0 && <p className="text-gray-500 text-center py-8">{t.testBankNoQuestions}</p>}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
