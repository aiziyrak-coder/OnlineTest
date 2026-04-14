import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from './ui';
import { translations, Language } from '../i18n';
import { motion } from 'motion/react';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';

interface ExamSettingsProps {
  token: string;
  lang: Language;
  groups: any[];
  onSuccess: () => void;
}

export function ExamSettings({ token, lang, groups, onSuccess }: ExamSettingsProps) {
  const [method, setMethod] = useState<'pdf' | 'manual' | 'bank'>('pdf');
  const [bankCategories, setBankCategories] = useState<any[]>([]);
  const [manualQuestions, setManualQuestions] = useState([{ text: '', options: ['', '', '', ''], correctAnswer: '' }]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const t = translations[lang];

  useEffect(() => {
    if (method !== 'bank') return;
    (async () => {
      const res = await fetch(apiUrl('/api/admin/test-bank/categories'), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const raw = await readJsonSafe<unknown>(res);
        setBankCategories(Array.isArray(raw) ? raw : []);
      }
    })();
  }, [method, token]);

  const handleCreateExam = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    setError('');
    setSuccess('');
    const fd = new FormData(formEl);
    
    // Collect selected groups
    const selectedGroups = Array.from(fd.getAll('group_ids')).map(Number);
    if (selectedGroups.length === 0) {
      setError('Please select at least one group.');
      return;
    }
    fd.delete('group_ids');
    fd.append('group_ids', JSON.stringify(selectedGroups));

    if (method === 'bank') {
      const catIds = Array.from(fd.getAll('bank_category_ids')).map(Number).filter(Boolean);
      if (catIds.length === 0) {
        setError(t.testBankPickCategory);
        return;
      }
      const selectedPoolCount = bankCategories
        .filter((c: any) => catIds.includes(Number(c.id)))
        .reduce((sum: number, c: any) => sum + Math.max(0, Number(c.question_count) || 0), 0);
      if (selectedPoolCount < 1) {
        setError('Selected categories contain no questions.');
        return;
      }
      fd.delete('bank_category_ids');
      fd.append('exam_mode', 'bank_mixed');
      fd.append('bank_category_ids', JSON.stringify(catIds));
      const count = fd.get('bank_question_count');
      fd.delete('bank_question_count');
      const normalizedCount = Math.max(1, Math.min(200, Number(count) || 1));
      fd.append('bank_question_count', String(Math.min(normalizedCount, selectedPoolCount)));
    }

    if (method === 'manual') {
      const formattedQuestions = manualQuestions.map((q, i) => ({
        id: i + 1,
        text: q.text,
        options: q.options,
        correctAnswer: q.correctAnswer || q.options[0]
      }));
      fd.append('manual_questions', JSON.stringify(formattedQuestions));
    }

    try {
      const res = await fetch(apiUrl('/api/admin/exams'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        setError(data?.error || 'Failed to create exam');
        return;
      }
      
      setSuccess('Exam created successfully!');
      formEl.reset();
      setManualQuestions([{ text: '', options: ['', '', '', ''], correctAnswer: '' }]);
      onSuccess();
      setTimeout(() => {
        setSuccess('');
      }, 3000);
    } catch (err) {
      setError('An error occurred while creating the exam.');
    }
  };

  const addManualQuestion = () => {
    setManualQuestions([...manualQuestions, { text: '', options: ['', '', '', ''], correctAnswer: '' }]);
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-2xl font-semibold text-gray-800">{t.addExam}</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 mb-6">
          <Button type="button" variant={method === 'pdf' ? 'default' : 'outline'} onClick={() => setMethod('pdf')}>{t.uploadPdf}</Button>
          <Button type="button" variant={method === 'manual' ? 'default' : 'outline'} onClick={() => setMethod('manual')}>{t.manualEntry}</Button>
          <Button type="button" variant={method === 'bank' ? 'default' : 'outline'} onClick={() => setMethod('bank')}>{t.examModeBank}</Button>
        </div>
        {method === 'bank' && (
          <p className="text-sm text-gray-600 mb-4 border border-blue-100 bg-blue-50/40 rounded-2xl px-4 py-3">{t.examModeBankHint}</p>
        )}

        {error && <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-red-500/10 border border-red-500/20 text-red-600 p-4 rounded-2xl mb-6 text-sm backdrop-blur-md">{error}</motion.div>}
        {success && <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-green-500/10 border border-green-500/20 text-green-600 p-4 rounded-2xl mb-6 text-sm backdrop-blur-md">{success}</motion.div>}

        <form onSubmit={handleCreateExam} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div><label className="block text-sm font-medium text-gray-700 mb-2">{t.title}</label><Input name="title" required /></div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t.language}</label>
              <select name="language" className="glass-input w-full px-4 py-3 rounded-2xl bg-white/50 border border-white/50 focus:outline-none focus:ring-2 focus:ring-black/5 transition-all duration-300">
                <option value="uz">O'zbekcha</option>
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">{t.startTime}</label><Input name="start_time" type="datetime-local" required /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">{t.endTime}</label><Input name="end_time" type="datetime-local" required /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">{t.duration}</label><Input name="duration_minutes" type="number" required /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">{t.pin} (Optional)</label><Input name="pin" type="text" placeholder="e.g. 1234" /></div>
            
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">{t.customRules} (Optional)</label>
              <textarea name="custom_rules" rows={3} className="glass-input w-full px-4 py-3 rounded-2xl bg-white/50 border border-white/50 focus:outline-none focus:ring-2 focus:ring-black/5 transition-all duration-300 resize-none" placeholder="Enter any specific rules for this exam..."></textarea>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">{t.selectGroups}</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border border-white/40 bg-white/30 p-4 rounded-2xl h-40 overflow-y-auto backdrop-blur-sm">
                {groups.map((g: any) => (
                  <label key={g.id} className="flex items-center gap-3 p-2 hover:bg-white/50 rounded-xl cursor-pointer transition-colors">
                    <input type="checkbox" name="group_ids" value={g.id} className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black" />
                    <span className="text-sm font-medium text-gray-700">{g.name} <span className="text-xs text-gray-500">({g.level_name})</span></span>
                  </label>
                ))}
              </div>
            </div>

            {method === 'pdf' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.uploadPdf}</label>
                <Input type="file" name="pdf" accept="application/pdf" required className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-black/5 file:text-black hover:file:bg-black/10 transition-all" />
                <p className="text-xs text-gray-500 mt-2 ml-2">Format: 1. Question text \n A) Correct answer \n B) Wrong \n C) Wrong \n D) Wrong</p>
              </div>
            )}

            {method === 'bank' && (
              <>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.testBankCategories}</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-white/40 bg-white/30 p-4 rounded-2xl max-h-48 overflow-y-auto">
                    {bankCategories.length === 0 && <span className="text-sm text-amber-800">{t.testBankNeedFirst}</span>}
                    {bankCategories.map((c: any) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="bank_category_ids" value={c.id} className="rounded border-gray-300" />
                        <span>{c.name}</span>
                        <span className="text-xs text-gray-400">({c.question_count ?? 0})</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.examBankQuestionCount}</label>
                  <Input name="bank_question_count" type="number" min={1} max={200} defaultValue={20} required />
                </div>
              </>
            )}
          </div>

          {method === 'manual' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-6 border-t border-gray-200/50 pt-6">
              <h3 className="font-semibold text-lg text-gray-800">Questions</h3>
              {manualQuestions.map((q, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-6 border border-white/40 rounded-3xl bg-white/40 backdrop-blur-md shadow-sm space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Question {i + 1}</label>
                    <Input 
                      value={q.text} 
                      onChange={e => {
                        const newQ = [...manualQuestions];
                        newQ[i].text = e.target.value;
                        setManualQuestions(newQ);
                      }} 
                      required 
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {q.options.map((opt, optIndex) => (
                      <div key={optIndex}>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          {optIndex === 0 ? 'Option A (Correct)' : `Option ${String.fromCharCode(65 + optIndex)}`}
                        </label>
                        <Input 
                          value={opt} 
                          onChange={e => {
                            const newQ = [...manualQuestions];
                            newQ[i].options[optIndex] = e.target.value;
                            if (optIndex === 0) newQ[i].correctAnswer = e.target.value;
                            setManualQuestions(newQ);
                          }} 
                          required 
                        />
                      </div>
                    ))}
                  </div>
                </motion.div>
              ))}
              <Button type="button" variant="outline" onClick={addManualQuestion} className="w-full border-dashed border-2">{t.addQuestion}</Button>
            </motion.div>
          )}

          <div className="pt-4">
            <Button type="submit" className="w-full md:w-auto px-8" disabled={method === 'bank' && bankCategories.length === 0}>
              {t.createExam}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
