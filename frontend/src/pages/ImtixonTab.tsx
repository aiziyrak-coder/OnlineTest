import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from '../components/ui';
import { translations, Language } from '../i18n';
import { readJsonSafe, parseAdminUsersList } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { AdminExamsTab } from './AdminExamsTab';

type StudentRow = { id: string; name: string; group_id: number | null };

function toIsoOrNull(localValue: string): string | null {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function ImtixonTab({ token, lang }: { token: string; lang: Language }) {
  const t = translations[lang];
  const h = { Authorization: `Bearer ${token}` };
  const [groups, setGroups] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [duration, setDuration] = useState(60);
  const [language, setLanguage] = useState('uz');
  const [pin, setPin] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [bankCount, setBankCount] = useState(20);
  const [selGroups, setSelGroups] = useState<number[]>([]);
  const [selCats, setSelCats] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [exModal, setExModal] = useState(false);
  const [poolStudents, setPoolStudents] = useState<StudentRow[]>([]);
  const [exMap, setExMap] = useState<Record<string, { on: boolean; reason: string }>>({});
  const [examKey, setExamKey] = useState(0);

  const loadMeta = useCallback(async () => {
    const [gr, cr] = await Promise.all([
      fetch(apiUrl('/api/admin/groups'), { headers: h }),
      fetch(apiUrl('/api/admin/test-bank/categories'), { headers: h }),
    ]);
    const gj = gr.ok ? await readJsonSafe<any[]>(gr) : null;
    const cj = cr.ok ? await readJsonSafe<any[]>(cr) : null;
    setGroups(Array.isArray(gj) ? gj : []);
    setCategories(Array.isArray(cj) ? cj : []);
  }, [token]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const toggleG = (id: number) => {
    setSelGroups((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const toggleC = (id: number) => {
    setSelCats((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const openExceptions = async () => {
    if (selGroups.length === 0) return;
    setMsg({ type: '', text: '' });
    const lists = await Promise.all(
      selGroups.map(async (gid) => {
        const res = await fetch(apiUrl(`/api/admin/users?group_id=${gid}&role=student`), { headers: h });
        const j = await readJsonSafe<unknown>(res);
        return parseAdminUsersList<StudentRow>(j);
      }),
    );
    const merged: StudentRow[] = [];
    const seen = new Set<string>();
    for (const row of lists.flat()) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    merged.sort((a, b) => a.name.localeCompare(b.name));
    setPoolStudents(merged);
    setExMap((prev) => {
      const next = { ...prev };
      for (const s of merged) {
        if (!next[s.id]) next[s.id] = { on: false, reason: '' };
      }
      return next;
    });
    setExModal(true);
  };

  const exceptionsPayload = useMemo(() => {
    return Object.entries(exMap)
      .filter(([, v]) => v.on)
      .map(([student_id, v]) => ({ student_id, reason: v.reason.trim() || t.exceptionsHint }));
  }, [exMap, t.exceptionsHint]);

  const createExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    if (selGroups.length === 0) {
      setMsg({ type: 'err', text: t.selectGroups });
      return;
    }
    if (selCats.length === 0) {
      setMsg({ type: 'err', text: t.testBankPickCategory });
      return;
    }
    if (!startLocal || !endLocal) {
      setMsg({ type: 'err', text: t.examDateTimeRequired });
      return;
    }
    const startIso = toIsoOrNull(startLocal);
    const endIso = toIsoOrNull(endLocal);
    const normalizedBankCount = Math.max(1, Math.min(200, Number(bankCount) || 1));
    if (!startIso || !endIso) {
      setMsg({ type: 'err', text: t.examInvalidDateTime });
      return;
    }
    if (new Date(startIso).getTime() >= new Date(endIso).getTime()) {
      setMsg({ type: 'err', text: t.examStartMustBeBeforeEnd });
      return;
    }
    const selectedPoolCount = categories
      .filter((c: any) => selCats.includes(c.id))
      .reduce((sum: number, c: any) => sum + Math.max(0, Number(c.question_count) || 0), 0);
    if (selectedPoolCount < 1) {
      setMsg({ type: 'err', text: t.examCreateBankCategoriesEmpty });
      return;
    }
    const effectiveBankCount = Math.min(normalizedBankCount, selectedPoolCount);
    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        start_time: startIso,
        end_time: endIso,
        duration_minutes: duration,
        language,
        pin: pin || '',
        custom_rules: customRules || '',
        exam_mode: 'bank_mixed',
        bank_category_ids: selCats,
        bank_question_count: effectiveBankCount,
        group_ids: selGroups,
        exam_exceptions: exceptionsPayload,
      };
      const res = await fetch(apiUrl('/api/admin/exams'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify(body),
      });
      const d = await readJsonSafe<{ error?: string; id?: number }>(res);
      if (!res.ok) {
        setMsg({ type: 'err', text: d?.error || t.errorGeneric });
        return;
      }
      setMsg({
        type: 'ok',
        text:
          effectiveBankCount !== normalizedBankCount
            ? t.examCreatedWithQuestionCountAdjusted.replace('{n}', String(effectiveBankCount))
            : t.examCreated,
      });
      setTitle('');
      setPin('');
      setSelCats([]);
      setSelGroups([]);
      setExMap({});
      setExamKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-10 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-white/50 bg-white/40 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-xl">{t.examCreateBankTitle}</CardTitle>
            <p className="text-sm text-gray-600 leading-relaxed">{t.examBankMixedExplain}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={createExam} className="space-y-5">
              {msg.text && (
                <div
                  className={`text-sm rounded-2xl px-4 py-3 border ${
                    msg.type === 'ok' ? 'bg-emerald-50 text-emerald-900 border-emerald-100' : 'bg-red-50 text-red-800 border-red-100'
                  }`}
                >
                  {msg.text}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.title}</label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" required />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.language}</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="mt-1 w-full h-12 rounded-2xl border border-white/50 bg-white/50 px-3 text-sm"
                  >
                    <option value="uz">{t.langUzbek}</option>
                    <option value="ru">{t.langRussian}</option>
                    <option value="en">{t.langEnglish}</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.startTime}</label>
                  <Input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} className="mt-1" required />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.endTime}</label>
                  <Input type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} className="mt-1" required />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.duration}</label>
                  <Input type="number" min={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-1" required />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.pin}</label>
                  <Input value={pin} onChange={(e) => setPin(e.target.value)} className="mt-1" placeholder="—" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">{t.selectGroups}</label>
                <div className="flex flex-wrap gap-2 p-3 rounded-2xl border border-white/40 bg-white/20 max-h-36 overflow-y-auto">
                  {groups.map((g: any) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm cursor-pointer bg-white/50 px-3 py-2 rounded-xl border">
                      <input type="checkbox" checked={selGroups.includes(g.id)} onChange={() => toggleG(g.id)} />
                      {g.name} ({g.level_name})
                    </label>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2 rounded-full" onClick={openExceptions}>
                  {t.exceptionsBtn}
                  {exceptionsPayload.length > 0 ? ` (${exceptionsPayload.length})` : ''}
                </Button>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">{t.testBankCategories}</label>
                <div className="flex flex-wrap gap-2 p-3 rounded-2xl border border-white/40 bg-white/20 max-h-40 overflow-y-auto">
                  {categories.map((c: any) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer bg-white/50 px-3 py-2 rounded-xl border">
                      <input type="checkbox" checked={selCats.includes(c.id)} onChange={() => toggleC(c.id)} />
                      {c.name}{' '}
                      <span className="text-xs text-gray-400">({c.question_count ?? 0})</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">{t.examBankQuestionCount}</label>
                <Input type="number" min={1} max={200} value={bankCount} onChange={(e) => setBankCount(Number(e.target.value))} className="mt-1" required />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">{t.customRules}</label>
                <textarea
                  value={customRules}
                  onChange={(e) => setCustomRules(e.target.value)}
                  className="mt-1 w-full min-h-[72px] rounded-2xl border border-white/50 bg-white/50 px-3 py-2 text-sm"
                />
              </div>
              <Button type="submit" disabled={busy} className="rounded-full">
                {busy ? '…' : t.createExam}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <div key={examKey}>
        <AdminExamsTab token={token} lang={lang} hideExamSettings />
      </div>

      {exModal && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setExModal(false)}
        >
          <Card className="max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle className="text-lg">{t.exceptionsTitle}</CardTitle>
              <Button type="button" variant="ghost" size="sm" onClick={() => setExModal(false)}>
                {t.cancel}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-gray-600">{t.exceptionsHint}</p>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {poolStudents.map((s) => (
                  <div key={s.id} className="p-3 rounded-xl border border-white/50 bg-white/30 space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={exMap[s.id]?.on ?? false}
                        onChange={(e) =>
                          setExMap((p) => ({
                            ...p,
                            [s.id]: { on: e.target.checked, reason: p[s.id]?.reason || '' },
                          }))
                        }
                      />
                      {s.name} <span className="text-xs text-gray-500 font-mono">{s.id}</span>
                    </label>
                    {(exMap[s.id]?.on ?? false) && (
                      <Input
                        placeholder={t.exceptionReason}
                        value={exMap[s.id]?.reason || ''}
                        onChange={(e) =>
                          setExMap((p) => ({
                            ...p,
                            [s.id]: { on: true, reason: e.target.value },
                          }))
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
              <Button type="button" className="w-full rounded-full" onClick={() => setExModal(false)}>
                OK
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
