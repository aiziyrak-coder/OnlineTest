import React, { useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from './ui';
import { translations, Language } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';

function toLocalDatetimeValue(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type ExamSavedEvent = { examId: number; deleted?: boolean };

type Props = {
  token: string;
  lang: Language;
  examId: number;
  groups: { id: number; name: string; level_name: string }[];
  onClose: () => void;
  onSaved: (ev: ExamSavedEvent) => void;
};

export function ExamEditModal({ token, lang, examId, groups, onClose, onSaved }: Props) {
  const t = translations[lang];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [exam, setExam] = useState<any>(null);
  const [bankCats, setBankCats] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [duration, setDuration] = useState(60);
  const [language, setLanguage] = useState('uz');
  const [pin, setPin] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [questionsJson, setQuestionsJson] = useState('');
  const [selectedBankCats, setSelectedBankCats] = useState<number[]>([]);
  const [bankCount, setBankCount] = useState(12);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(apiUrl(`/api/admin/exams/${examId}`), { headers: { Authorization: `Bearer ${token}` } });
        const data = await readJsonSafe<any>(res);
        if (!res.ok) throw new Error(data?.error || 'Load failed');
        if (!data) throw new Error('Invalid server response');
        if (cancelled) return;
        setExam(data);
        setTitle(data.title);
        setStartLocal(toLocalDatetimeValue(data.start_time));
        setEndLocal(toLocalDatetimeValue(data.end_time));
        setDuration(Number(data.duration_minutes) || 60);
        setLanguage(data.language || 'uz');
        setPin(data.pin || '');
        setCustomRules(data.custom_rules || '');
        setSelectedGroups(Array.isArray(data.group_ids) ? data.group_ids : []);
        setQuestionsJson(JSON.stringify(data.questions || [], null, 2));
        setSelectedBankCats(Array.isArray(data.bank_category_ids) ? data.bank_category_ids : []);
        setBankCount(Number(data.bank_question_count) || 12);
        if (data.exam_mode === 'bank_mixed') {
          const cr = await fetch(apiUrl('/api/admin/test-bank/categories'), { headers: { Authorization: `Bearer ${token}` } });
          if (cr.ok && !cancelled) {
            const cats = await readJsonSafe<any[]>(cr);
            setBankCats(Array.isArray(cats) ? cats : []);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, token]);

  const toggleGroup = (id: number) => {
    setSelectedGroups((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleBankCat = (id: number) => {
    setSelectedBankCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    if (selectedGroups.length === 0) {
      setError('Select at least one group');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const startIso = new Date(startLocal).toISOString();
      const endIso = new Date(endLocal).toISOString();
      const body: Record<string, unknown> = {
        title,
        start_time: startIso,
        end_time: endIso,
        duration_minutes: duration,
        language,
        pin,
        custom_rules: customRules,
        group_ids: selectedGroups,
      };
      if (exam?.exam_mode === 'static') {
        try {
          const parsed = JSON.parse(questionsJson);
          if (Array.isArray(parsed) && parsed.length > 0) body.questions = parsed;
        } catch {
          setError(t.testBankInvalidJson);
          setSaving(false);
          return;
        }
      }
      if (exam?.exam_mode === 'bank_mixed') {
        body.bank_category_ids = selectedBankCats;
        body.bank_question_count = bankCount;
      }
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = (await readJsonSafe<{ error?: string }>(res)) || {};
      if (!res.ok) throw new Error(data.error || 'Save failed');
      onSaved({ examId });
      onClose();
    } catch (e: any) {
      setError(e.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t.confirmDeleteExam)) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await readJsonSafe<{ error?: string }>(res)) || {};
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      onSaved({ examId, deleted: true });
      onClose();
    } catch (e: any) {
      setError(e.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-white/40" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-center justify-between gap-4 sticky top-0 bg-white/95 backdrop-blur z-10 border-b">
          <CardTitle>{t.editExam}</CardTitle>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t.cancel}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {loading && <p className="text-gray-500 text-sm">{t.loading}</p>}
          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</div>}
          {!loading && exam && (
            <>
              <div>
                <label className="text-sm font-medium text-gray-700">{t.title}</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.startTime}</label>
                  <Input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.endTime}</label>
                  <Input type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} className="mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.duration}</label>
                  <Input type="number" min={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.language}</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="mt-1 w-full h-12 rounded-2xl border border-white/50 bg-white/50 px-3 text-sm"
                  >
                    <option value="uz">O‘zbekcha</option>
                    <option value="ru">Русский</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.pin}</label>
                  <Input value={pin} onChange={(e) => setPin(e.target.value)} className="mt-1" placeholder="—" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">{t.customRules}</label>
                <textarea
                  value={customRules}
                  onChange={(e) => setCustomRules(e.target.value)}
                  className="mt-1 w-full min-h-[72px] rounded-2xl border border-white/50 bg-white/50 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">{t.selectGroups}</label>
                <div className="flex flex-wrap gap-2">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm cursor-pointer bg-white/40 px-3 py-2 rounded-xl border">
                      <input type="checkbox" checked={selectedGroups.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                      {g.name} ({g.level_name})
                    </label>
                  ))}
                </div>
              </div>
              {exam.exam_mode === 'static' && (
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.examQuestionsJsonHint}</label>
                  <textarea
                    value={questionsJson}
                    onChange={(e) => setQuestionsJson(e.target.value)}
                    className="mt-1 w-full min-h-[160px] font-mono text-xs rounded-2xl border border-white/50 bg-white/50 px-3 py-2"
                  />
                </div>
              )}
              {exam.exam_mode === 'bank_mixed' && (
                <>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-2 block">{t.bankCategoriesEdit}</label>
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                      {bankCats.map((c: any) => (
                        <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer bg-white/40 px-3 py-2 rounded-xl border">
                          <input type="checkbox" checked={selectedBankCats.includes(c.id)} onChange={() => toggleBankCat(c.id)} />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">{t.examBankQuestionCount}</label>
                    <Input type="number" min={8} max={200} value={bankCount} onChange={(e) => setBankCount(Number(e.target.value))} className="mt-1" />
                  </div>
                </>
              )}
              <div className="flex flex-wrap gap-2 pt-4 border-t">
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving ? '…' : t.save}
                </Button>
                <Button type="button" variant="outline" onClick={onClose}>
                  {t.cancel}
                </Button>
                <Button type="button" variant="outline" className="text-red-600 border-red-200 ml-auto" onClick={handleDelete} disabled={saving}>
                  {t.delete}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
