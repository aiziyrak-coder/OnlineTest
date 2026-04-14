import React, { useState, useEffect } from 'react';
import { apiUrl } from '../lib/apiUrl';
import { readJsonSafe } from '../lib/http';
import { Card, CardContent, CardHeader, CardTitle, Button } from '../components/ui';
import { translations, Language } from '../i18n';
import { motion, AnimatePresence } from 'motion/react';
import { ExamSettings } from '../components/ExamSettings';
import { LiveMonitor } from '../components/LiveMonitor';
import { ExamEditModal } from '../components/ExamEditModal';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const item: any = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

export function AdminExamsTab({
  token,
  lang,
  hideExamSettings,
}: {
  token: string;
  lang: Language;
  hideExamSettings?: boolean;
}) {
  const [exams, setExams] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedExam, setSelectedExam] = useState<any>(null);
  const [results, setResults] = useState<any>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [activeMonitorExamId, setActiveMonitorExamId] = useState<number | null>(null);
  const [editingExamId, setEditingExamId] = useState<number | null>(null);
  const t = translations[lang];

  useEffect(() => {
    fetchExams();
    fetchGroups();
  }, []);

  const fetchExams = async () => {
    const res = await fetch(apiUrl('/api/admin/exams'), { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const raw = await readJsonSafe<unknown>(res);
      setExams(Array.isArray(raw) ? raw : []);
    }
  };

  const fetchGroups = async () => {
    const res = await fetch(apiUrl('/api/admin/groups'), { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const raw = await readJsonSafe<unknown>(res);
      setGroups(Array.isArray(raw) ? raw : []);
    }
  };

  const viewResults = async (examId: number) => {
    const res = await fetch(apiUrl(`/api/admin/exams/${examId}/results`), { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const raw = await readJsonSafe<unknown>(res);
      setResults(raw && typeof raw === 'object' ? raw : null);
      setSelectedExam(examId);
      setSortConfig(null);
      setFilterStatus('All');
    }
  };

  const allowRetake = async (studentExamId: number) => {
    await fetch(apiUrl(`/api/admin/student_exams/${studentExamId}/retake`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (selectedExam != null) viewResults(selectedExam);
  };

  const exportCSV = () => {
    if (!results || !results.results) return;
    const exam = exams.find((e: any) => e.id === selectedExam) as any;
    const headers = ['Student ID', 'Student Name', 'Score', 'Status', 'Started At', 'Completed At', 'Violations'];
    const rows = results.results.map((r: any) => {
      const studentViolations = results.violations.filter((v: any) => v.student_id === r.student_id);
      const violationText = studentViolations.map((v: any) => `${v.violation_type} (${new Date(v.timestamp).toLocaleTimeString()})`).join('; ');
      return [
        r.student_id,
        r.name,
        r.score !== null ? r.score : '-',
        r.status,
        r.started_at ? new Date(r.started_at).toLocaleString() : '-',
        r.completed_at ? new Date(r.completed_at).toLocaleString() : '-',
        `"${violationText}"`,
      ];
    });
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `exam_${exam?.title || selectedExam}_results.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortedAndFilteredResults = () => {
    if (!results || !results.results) return [];
    let filtered = results.results;
    if (filterStatus !== 'All') {
      filtered = filtered.filter((r: any) => r.status === filterStatus);
    }
    if (sortConfig !== null) {
      filtered = [...filtered].sort((a: any, b: any) => {
        if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
        if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return filtered;
  };

  const calculateTimeTaken = (start: string, end: string) => {
    if (!start || !end) return '-';
    const diff = new Date(end).getTime() - new Date(start).getTime();
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const getIncorrectAnswers = (answersJson: string, questionsJson: string) => {
    if (!answersJson || !questionsJson) return [];
    try {
      const answers = JSON.parse(answersJson);
      const questions = JSON.parse(questionsJson);
      const incorrect: any[] = [];
      questions.forEach((q: any) => {
        if (answers[q.id] !== q.correctAnswer) {
          incorrect.push({ question: q.text, studentAnswer: answers[q.id], correctAnswer: q.correctAnswer });
        }
      });
      return incorrect;
    } catch {
      return [];
    }
  };

  const getFlaggedCount = (flaggedJson: string) => {
    if (!flaggedJson) return 0;
    try {
      return JSON.parse(flaggedJson).length;
    } catch {
      return 0;
    }
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      {!hideExamSettings && (
        <motion.div variants={item}>
          <ExamSettings token={token} lang={lang} groups={groups} onSuccess={fetchExams} />
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div variants={item}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-xl font-semibold text-gray-800">{t.exams}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {exams.map((e: any) => (
                  <motion.li
                    key={e.id}
                    whileHover={{ scale: 1.01 }}
                    className="p-4 border border-white/40 bg-white/30 rounded-2xl flex justify-between items-center backdrop-blur-sm shadow-sm hover:shadow-md transition-all gap-3 flex-wrap"
                  >
                    <div>
                      <p className="font-semibold text-gray-800 flex flex-wrap items-center gap-2">
                        <span>{e.title}</span>
                        {e.exam_mode === 'bank_mixed' && (
                          <span className="text-[9px] font-semibold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full uppercase border border-indigo-200/60">
                            {t.bankExamBadge}
                          </span>
                        )}
                        <span className="text-[10px] bg-black/5 text-black/70 px-2 py-0.5 rounded-full uppercase font-medium">
                          {e.language}
                        </span>
                      </p>
                      {e.exam_mode === 'bank_mixed' && e.bank_question_count ? (
                        <p className="text-[11px] text-gray-500 mt-1">{t.examBankQuestionCount}: {e.bank_question_count}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                        <span className="bg-white/50 px-2 py-1 rounded-md border border-white/40 shadow-sm">
                          Start:{' '}
                          <span className="font-medium text-gray-700">
                            {new Date(e.start_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </span>
                        <span className="bg-white/50 px-2 py-1 rounded-md border border-white/40 shadow-sm">
                          End:{' '}
                          <span className="font-medium text-gray-700">
                            {new Date(e.end_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </span>
                        <span className="bg-blue-50/50 text-blue-700 px-2 py-1 rounded-md border border-blue-100 shadow-sm font-medium">
                          {e.duration_minutes} min
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveMonitorExamId(e.id)}
                        className="rounded-full px-4 border-blue-200 text-blue-600 hover:bg-blue-50"
                      >
                        Monitor
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => viewResults(e.id)} className="rounded-full px-4">
                        {t.results}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingExamId(e.id)} className="rounded-full px-4">
                        {t.edit}
                      </Button>
                    </div>
                  </motion.li>
                ))}
                {exams.length === 0 && <p className="text-sm text-gray-500 text-center py-8">No exams created yet.</p>}
              </ul>
            </CardContent>
          </Card>
        </motion.div>

        <AnimatePresence mode="wait">
          {results && (
            <motion.div
              key="results"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <Card className="h-full">
                <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <CardTitle className="text-xl font-semibold text-gray-800">{t.results}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="text-sm border-gray-200 rounded-full px-3 py-1.5 bg-white/50 backdrop-blur-md focus:ring-2 focus:ring-blue-500/20 outline-none"
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                    >
                      <option value="All">All Statuses</option>
                      <option value="Completed">Completed</option>
                      <option value="Pending">Pending</option>
                      <option value="Banned">Banned</option>
                    </select>
                    <div className="flex gap-1 bg-white/50 p-1 rounded-full border border-gray-200/50 backdrop-blur-md">
                      <button
                        type="button"
                        onClick={() => handleSort('score')}
                        className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${sortConfig?.key === 'score' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-600'}`}
                      >
                        Score {sortConfig?.key === 'score' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSort('name')}
                        className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${sortConfig?.key === 'name' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-600'}`}
                      >
                        Name {sortConfig?.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </button>
                    </div>
                    <Button size="sm" variant="outline" onClick={exportCSV} className="rounded-full">
                      {t.exportCsv}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                    {getSortedAndFilteredResults().map((r: any) => {
                      const studentViolations = results.violations.filter((v: any) => v.student_id === r.student_id);
                      const timeTaken = calculateTimeTaken(r.started_at, r.completed_at);
                      const flaggedCount = getFlaggedCount(r.flagged_questions_json);
                      const incorrectAnswers = getIncorrectAnswers(r.answers_json, r.questions_json || results.questions_json);

                      return (
                        <div
                          key={r.id}
                          className="p-5 border border-white/40 bg-white/40 rounded-2xl backdrop-blur-md shadow-sm transition-all hover:shadow-md"
                        >
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <h3 className="font-semibold text-gray-900 text-lg">{r.name}</h3>
                              <p className="text-gray-500 text-sm font-mono">{r.student_id}</p>
                            </div>
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-medium shadow-sm ${
                                r.status === 'Completed'
                                  ? 'bg-green-500/10 text-green-700 border border-green-500/20'
                                  : r.status === 'Banned'
                                    ? 'bg-red-500/10 text-red-700 border border-red-500/20'
                                    : 'bg-yellow-500/10 text-yellow-700 border border-yellow-500/20'
                              }`}
                            >
                              {r.status}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 bg-white/50 p-4 rounded-xl border border-gray-100">
                            <div>
                              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Score</p>
                              <p className="text-xl font-bold text-gray-900">{r.score !== null ? r.score : '-'}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Time Taken</p>
                              <p className="text-sm font-medium text-gray-700 mt-1">{timeTaken}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Flagged</p>
                              <p className="text-sm font-medium text-gray-700 mt-1">{flaggedCount} questions</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Incorrect</p>
                              <p className="text-sm font-medium text-red-600 mt-1">{incorrectAnswers.length} questions</p>
                            </div>
                          </div>

                          {incorrectAnswers.length > 0 && r.status === 'Completed' && (
                            <div className="mb-4">
                              <details className="group">
                                <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-blue-600 transition-colors flex items-center gap-2 select-none">
                                  <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                  View Incorrect Answers
                                </summary>
                                <div className="mt-3 space-y-2 pl-6 border-l-2 border-red-100">
                                  {incorrectAnswers.map((inc: any, idx: number) => (
                                    <div key={idx} className="text-sm bg-red-50/50 p-3 rounded-lg border border-red-100/50">
                                      <p className="font-medium text-gray-800 mb-1">{inc.question}</p>
                                      <div className="flex flex-col sm:flex-row sm:gap-4 text-xs">
                                        <span className="text-red-600">
                                          Answer: <span className="font-semibold">{inc.studentAnswer || 'None'}</span>
                                        </span>
                                        <span className="text-green-600">
                                          Correct: <span className="font-semibold">{inc.correctAnswer}</span>
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            </div>
                          )}

                          {studentViolations.length > 0 && (
                            <div className="mt-3 p-4 bg-red-500/5 rounded-xl border border-red-500/10">
                              <p className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                  />
                                </svg>
                                Violations ({studentViolations.length})
                              </p>
                              <ul className="text-sm text-red-600/90 list-disc pl-5 space-y-1.5">
                                {studentViolations.map((v: any, i: number) => (
                                  <li key={i}>
                                    {v.violation_type}{' '}
                                    <span className="text-red-500/70 text-xs ml-2">({new Date(v.timestamp).toLocaleTimeString()})</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {(r.status === 'Banned' || r.status === 'Completed') && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-4 text-sm rounded-full w-full sm:w-auto sm:px-8 shadow-sm"
                              onClick={() => allowRetake(r.id)}
                            >
                              {t.allowRetake}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    {getSortedAndFilteredResults().length === 0 && (
                      <div className="text-center py-12 bg-gray-50/50 rounded-2xl border border-gray-100 border-dashed">
                        <p className="text-gray-500 font-medium">No results found matching your criteria.</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {activeMonitorExamId && (
          <LiveMonitor examId={activeMonitorExamId} token={token} onClose={() => setActiveMonitorExamId(null)} />
        )}
      </AnimatePresence>

      {editingExamId != null && (
        <ExamEditModal
          token={token}
          lang={lang}
          examId={editingExamId}
          groups={groups}
          onClose={() => setEditingExamId(null)}
          onSaved={(ev) => {
            fetchExams();
            if (ev.deleted && selectedExam === ev.examId) {
              setResults(null);
              setSelectedExam(null);
            }
            setEditingExamId(null);
          }}
        />
      )}
    </motion.div>
  );
}
