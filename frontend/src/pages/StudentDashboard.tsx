import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '../components/ui';
import { translations, Language } from '../i18n';
import { InstituteLogo } from '../components/InstituteLogo';
import { ExamResultSummary, type ExamResultPayload } from '../components/ExamResultSummary';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';

export function StudentDashboard({ token, onStartExam, lang }: { token: string, onStartExam: (exam: any, studentExamId: number) => void, lang: Language }) {
  const [exams, setExams] = useState([]);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'available' | 'results'>('available');
  const [isBanned, setIsBanned] = useState(false);
  const [detailPayload, setDetailPayload] = useState<ExamResultPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const t = translations[lang];

  useEffect(() => {
    fetchExams();
    fetchResults();
  }, []);

  const fetchExams = async () => {
    const res = await fetch(apiUrl('/api/student/exams'), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 403) {
      setIsBanned(true);
      return;
    }
    if (res.ok) {
      const j = await readJsonSafe<any[]>(res);
      setExams(Array.isArray(j) ? j : []);
    }
  };

  const fetchResults = async () => {
    const res = await fetch(apiUrl('/api/student/results'), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 403) {
      setIsBanned(true);
      return;
    }
    if (res.ok) {
      const j = await readJsonSafe<any[]>(res);
      setResults(Array.isArray(j) ? j : []);
    }
  };

  const startExam = (exam: any) => {
    onStartExam(exam, 0); // 0 is a placeholder, will be set in PreExamCheck
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const item: any = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
  };

  if (isBanned) {
    return (
      <div className="p-2 sm:p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full border-red-200 bg-red-50/50">
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h2 className="text-2xl font-bold text-red-700 mb-2">Account Banned</h2>
            <p className="text-red-600/80">Your account has been suspended due to multiple rule violations during exams. Please contact your administrator for more information.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const openResultDetail = async (examId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${examId}/result-details`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const j = await readJsonSafe<ExamResultPayload>(res);
      if (!j?.result_public_id) return;
      setDetailPayload({
        exam_id: examId,
        result_public_id: j.result_public_id,
        verify_url: j.verify_url,
        overview: j.overview,
        questions: j.questions,
        score: j.score,
        total: j.total,
        integrity_code: j.integrity_code,
        percentage: j.percentage,
        completed_at: j.completed_at,
        exam_title: j.exam_title,
        student_name: j.student_name,
      });
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto relative">
      {detailPayload && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-900/50 backdrop-blur-sm p-4">
          <ExamResultSummary
            data={detailPayload}
            token={token}
            onBack={() => setDetailPayload(null)}
          />
        </div>
      )}
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-3">
          <InstituteLogo size="sm" className="shrink-0" />
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">{t.exams}</h2>
        </div>
        
        <div className="bg-white/30 backdrop-blur-md p-1 rounded-full flex gap-1 border border-white/40 shadow-sm">
          <button 
            onClick={() => setActiveTab('available')}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${activeTab === 'available' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            Available Exams
          </button>
          <button 
            onClick={() => setActiveTab('results')}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${activeTab === 'results' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            My Results
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-700 bg-blue-50/90 border border-blue-100 rounded-2xl px-4 py-3 mb-6 leading-relaxed shadow-sm">
        {t.semesterExamBanner}
      </p>
      
      {error && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-red-50/80 backdrop-blur-md border border-red-100 text-red-800 p-4 rounded-2xl mb-8 shadow-sm">
          {error}
        </motion.div>
      )}
      
      <AnimatePresence mode="wait">
        {activeTab === 'available' ? (
          <motion.div key="available" variants={container} initial="hidden" animate="show" exit={{ opacity: 0, y: -20 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exams.map((e: any) => {
              const now = new Date();
              const start = new Date(e.start_time);
              const end = new Date(e.end_time);
              const isOngoing = now >= start && now <= end;
              const isUpcoming = now < start;
              const isPast = now > end;

              return (
                <motion.div variants={item} key={e.id}>
                  <Card className={`h-full flex flex-col transition-all duration-500 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] ${isPast ? 'opacity-60 grayscale-[50%]' : ''}`}>
                    <CardHeader className="pb-4">
                      <CardTitle className="flex justify-between items-start gap-4 flex-wrap">
                        <span className="text-xl font-bold leading-tight">{e.title}</span>
                        <div className="flex flex-wrap gap-1.5 justify-end shrink-0">
                          {e.exam_mode === 'bank_mixed' && (
                            <span className="text-[9px] font-semibold bg-indigo-100 text-indigo-800 px-2 py-1 rounded-full uppercase tracking-wide border border-indigo-200/60">
                              {t.bankExamBadge}
                            </span>
                          )}
                          <span className="text-[10px] font-bold bg-black/5 text-black/60 px-2.5 py-1 rounded-full uppercase tracking-wider">
                            {e.language}
                          </span>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6 flex-1 flex flex-col">
                      <div className="space-y-3 text-sm text-gray-600 bg-white/30 rounded-2xl p-4 border border-white/40 shadow-inner flex-1">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-500 font-medium">{t.startTime}</span>
                          <span className="font-semibold text-gray-900">{start.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-500 font-medium">{t.endTime}</span>
                          <span className="font-semibold text-gray-900">{end.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-black/5">
                          <span className="text-gray-500 font-medium">{t.duration}</span>
                          <span className="font-semibold text-gray-900 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">{e.duration_minutes} min</span>
                        </div>
                        {e.exam_mode === 'bank_mixed' && e.bank_question_count ? (
                          <p className="text-[11px] text-gray-500 pt-1">{t.examBankQuestionCount}: {e.bank_question_count}</p>
                        ) : null}
                        {e.has_pin && (
                          <div className="flex justify-between items-center pt-2 border-t border-black/5">
                            <span className="text-yellow-600 font-medium flex items-center gap-1">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                              PIN Required
                            </span>
                          </div>
                        )}
                      </div>
                      
                      <div className="pt-2 mt-auto">
                        {isOngoing ? (
                          <Button className="w-full shadow-lg shadow-blue-500/20" onClick={() => startExam(e)}>{t.takeExam}</Button>
                        ) : isUpcoming ? (
                          <Button className="w-full" variant="secondary" disabled>Upcoming</Button>
                        ) : (
                          <Button className="w-full" variant="ghost" disabled>Ended</Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
            {exams.length === 0 && (
              <div className="col-span-full text-center py-20 bg-white/30 backdrop-blur-xl border border-white/50 rounded-3xl shadow-sm">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                </div>
                <p className="text-gray-500 font-medium text-lg">No exams available at the moment.</p>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="results" variants={container} initial="hidden" animate="show" exit={{ opacity: 0, y: -20 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {results.map((r: any) => (
              <motion.div variants={item} key={r.id}>
                <Card className="h-full flex flex-col overflow-hidden border-white/40 bg-white/40 backdrop-blur-xl transition-all hover:bg-white/50 hover:shadow-xl hover:shadow-black/5">
                  <CardHeader className="bg-white/30 border-b border-white/20">
                    <CardTitle className="text-xl font-semibold text-gray-800">{r.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col p-6 space-y-4">
                    <div className="flex justify-between items-center bg-white/50 p-4 rounded-2xl">
                      <span className="text-gray-600 font-medium">Score</span>
                      <span className={`text-2xl font-bold ${(r.percentage ?? 0) >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                        {r.percentage != null ? `${r.percentage}%` : r.score != null ? `${r.score}` : 'Pending'}
                        {r.total_questions > 0 && r.percentage != null && (
                          <span className="block text-xs font-normal text-gray-500">
                            ({r.score}/{r.total_questions})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between items-center bg-white/50 p-4 rounded-2xl">
                      <span className="text-gray-600 font-medium">Status</span>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        r.status === 'Completed' ? 'bg-green-100 text-green-700' :
                        r.status === 'Banned' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {r.status}
                      </span>
                    </div>
                    {r.completed_at && (
                      <div className="text-xs text-gray-500 text-center pt-2">
                        Completed: {new Date(r.completed_at).toLocaleString()}
                      </div>
                    )}
                    {r.status === 'Completed' && r.result_public_id && (
                      <Button
                        className="w-full rounded-full mt-2"
                        variant="outline"
                        disabled={detailLoading}
                        onClick={() => openResultDetail(r.exam_id)}
                      >
                        Sertifikat va batafsil
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
            {results.length === 0 && (
              <div className="col-span-full text-center py-20 bg-white/30 backdrop-blur-xl border border-white/50 rounded-3xl shadow-sm">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                <p className="text-gray-500 font-medium text-lg">No results available yet.</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
