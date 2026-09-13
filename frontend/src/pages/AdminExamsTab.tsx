import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../lib/apiUrl';
import { authHeaders } from '../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../lib/http';
import { translations, Language } from '../i18n';
import { motion, AnimatePresence } from 'motion/react';
import { LiveMonitor } from '../components/LiveMonitor';
import { ExamEditModal } from '../components/ExamEditModal';
import { AdminBtn, AdminSelect, AdminEmpty, AdminPagination, usePagedList } from './admin/ui';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item: any = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } } };

export function AdminExamsTab({
  token,
  lang,
  apiVariant = 'admin',
}: {
  token: string;
  lang: Language;
  apiVariant?: 'admin' | 'staff';
}) {
  const [exams, setExams] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedExam, setSelectedExam] = useState<any>(null);
  const [results, setResults] = useState<any>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [examListFilter, setExamListFilter] = useState<string>('All');
  /* Auditoriya filtri: 56 ta imtihon orasidan ordinator imtihonini
     topish uchun. Ilgari ro'yxatda imtihon KIM UCHUN ekani umuman
     ko'rsatilmasdi -- sarlavhadan taxmin qilishga to'g'ri kelardi. */
  const [audienceFilter, setAudienceFilter] = useState<string>('All');
  const AUD_LABEL: Record<string, string> = {
    student: lang === 'ru' ? 'Studenty' : lang === 'en' ? 'Students' : 'Talabalar',
    faculty: lang === 'ru' ? 'Prepodavateli' : lang === 'en' ? 'Teachers' : "O'qituvchilar",
    ordinator: lang === 'ru' ? 'Ordinatory' : lang === 'en' ? 'Residents' : 'Ordinatorlar',
    magistr: lang === 'ru' ? 'Magistry' : lang === 'en' ? 'Masters' : 'Magistrlar',
    vacancy: lang === 'ru' ? 'Kandidaty' : lang === 'en' ? 'Applicants' : 'Nomzodlar',
  };
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [activeMonitorExamId, setActiveMonitorExamId] = useState<number | null>(null);
  const [editingExamId, setEditingExamId] = useState<number | null>(null);
  const [questionsExamId, setQuestionsExamId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [kafedraNames, setKafedraNames] = useState<Record<number, string>>({});
  const t = translations[lang];
  const statusLabel = (status?: string | null) =>
    status === 'Completed' ? t.examStatusCompleted
      : status === 'Banned' ? t.examStatusBanned
      : status === 'Failed' ? t.examStatusFailed
      : status === 'In Progress' ? t.examStatusInProgress
      : status === 'Pending' ? t.examStatusPending
      : (status || '');
  const examsListUrl = apiVariant === 'staff' ? '/api/staff/exams' : '/api/admin/exams';
  const resultsUrl = (examId: number) => apiVariant === 'staff' ? `/api/staff/exams/${examId}/results` : `/api/admin/exams/${examId}/results`;
  const isStaffPortal = apiVariant === 'staff';

  const fetchExams = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    const res = await fetch(apiUrl(examsListUrl), { headers: authHeaders(token, lang) });
    if (!checkAdminAuthResponse(res)) { if (manual) setRefreshing(false); return; }
    if (res.ok) { const raw = await readJsonSafe<unknown>(res); setExams(Array.isArray(raw) ? raw : []); }
    if (manual) setRefreshing(false);
  }, [token, examsListUrl]);

  const fetchGroups = useCallback(async () => {
    if (isStaffPortal) return;
    const res = await fetch(apiUrl('/api/admin/groups'), { headers: authHeaders(token, lang) });
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) { const raw = await readJsonSafe<unknown>(res); setGroups(Array.isArray(raw) ? raw : []); }
  }, [token, isStaffPortal]);

  useEffect(() => { void fetchExams(); void fetchGroups(); }, [fetchExams, fetchGroups]);

  useEffect(() => {
    if (isStaffPortal) return;
    (async () => {
      try {
        const r = await fetch(apiUrl('/api/admin/kafedralar'), { headers: authHeaders(token, lang) });
        if (!r.ok) return;
        const raw = await readJsonSafe<any>(r);
        const list = Array.isArray(raw) ? raw : (raw && raw.results) || [];
        const map: Record<number, string> = {};
        list.forEach((k: any) => { map[Number(k.id)] = String(k.name || ''); });
        setKafedraNames(map);
      } catch { /* kafedra nomlari ko'rsatish uchun -- xato bo'lsa jim o'tamiz */ }
    })();
  }, [token, lang, isStaffPortal]);

  const viewResults = async (examId: number) => {
    const res = await fetch(apiUrl(resultsUrl(examId)), { headers: authHeaders(token, lang) });
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      const raw = await readJsonSafe<unknown>(res);
      setResults(raw && typeof raw === 'object' ? raw : null);
      setSelectedExam(examId);
      setSortConfig(null);
      setFilterStatus('All');
      setRecommendedOnly(false);
    }
  };

  const allowRetake = async (studentExamId: number) => {
    const retakeRes = await fetch(apiUrl(`/api/admin/student_exams/${studentExamId}/retake`), {
      method: 'POST', headers: authHeaders(token, lang),
    });
    if (!checkAdminAuthResponse(retakeRes)) return;
    if (selectedExam != null) viewResults(selectedExam);
  };

  const exportCSV = () => {
    if (!results?.results) return;
    const exam = exams.find((e: any) => e.id === selectedExam) as any;
    const headers = ['Student ID', 'Student Name', 'Score', 'Status', 'Started At', 'Completed At', 'Violations'];
    const rows = results.results.map((r: any) => {
      const violations = results.violations.filter((v: any) => v.student_id === r.student_id);
      const violText = violations.map((v: any) => `${v.violation_type} (${new Date(v.timestamp).toLocaleTimeString()})`).join('; ');
      return [r.student_id, r.name, r.score ?? '-', r.status, r.started_at ? new Date(r.started_at).toLocaleString() : '-', r.completed_at ? new Date(r.completed_at).toLocaleString() : '-', `"${violText}"`];
    });
    const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csv);
    link.download = `exam_${exam?.title || selectedExam}_results.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleSort = (key: string) => {
    setSortConfig((prev) => ({ key, direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  };

  const getSortedAndFilteredResults = () => {
    if (!results?.results) return [];
    let filtered = results.results;
    if (filterStatus !== 'All') filtered = filtered.filter((r: any) => r.status === filterStatus);
    if (recommendedOnly) filtered = filtered.filter((r: any) => Boolean(r.recommended_review));
    if (sortConfig) {
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
    return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
  };

  const getIncorrectAnswers = (answersJson: string, questionsJson: string) => {
    if (!answersJson || !questionsJson) return [];
    try {
      const answers = JSON.parse(answersJson) as Record<string, string>;
      const questions = JSON.parse(questionsJson) as Array<{ id: number | string; text?: string; correctAnswer?: string }>;
      if (!answers || typeof answers !== 'object' || !Array.isArray(questions)) return [];
      const incorrect: any[] = [];
      questions.forEach((q: any) => {
        const qid = String(q.id ?? '');
        if (!qid) return;
        const studentAnswer = answers[qid] ?? answers[String(Number(qid))];
        if (studentAnswer !== q.correctAnswer) incorrect.push({ question: q.text, studentAnswer, correctAnswer: q.correctAnswer });
      });
      return incorrect;
    } catch { return []; }
  };

  const getFlaggedCount = (flaggedJson: string) => {
    if (!flaggedJson) return 0;
    try { const p = JSON.parse(flaggedJson); return Array.isArray(p) ? p.length : 0; } catch { return 0; }
  };

  const ExamStatusBadge = ({ e }: { e: any }) => {
    const status = getExamTimeStatus(e);
    if (status === 'upcoming') return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{t.examListUpcoming}</span>;
    if (status === 'ended') return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t.examListEnded}</span>;
    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 animate-pulse">{t.examListLive}</span>;
  };

  const getExamTimeStatus = (e: any): 'upcoming' | 'live' | 'ended' => {
    const now = Date.now();
    const start = new Date(e.start_time).getTime();
    const end = new Date(e.end_time).getTime();
    if (now < start) return 'upcoming';
    if (now > end) return 'ended';
    return 'live';
  };

  const filteredExams = exams.filter((e) => {
    if (audienceFilter !== 'All' && String(e.audience || 'student') !== audienceFilter) {
      return false;
    }
    if (examListFilter === 'All') return true;
    const st = getExamTimeStatus(e);
    if (examListFilter === 'Upcoming') return st === 'upcoming';
    if (examListFilter === 'Live') return st === 'live';
    if (examListFilter === 'Ended') return st === 'ended';
    return true;
  });
  const examPage = usePagedList(filteredExams);

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-5">
      {/* ── Exams list ── */}
      <motion.div variants={item}>
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center shrink-0">
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-gray-900">{isStaffPortal ? t.staffMyExamsTitle : t.exams}</h2>
                <p className="text-[12px] text-gray-400 mt-0.5">
                  {filteredExams.length}
                  {examListFilter !== 'All' ? ` / ${exams.length}` : ''}{' '}
                  {t.examsCountLabel}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <AdminSelect
                value={examListFilter}
                onChange={(e) => setExamListFilter(e.target.value)}
                className="h-9 w-full sm:w-auto min-w-[9rem] text-[13px]"
              >
                <option value="All">{t.examFilterAll}</option>
                <option value="Upcoming">{t.examFilterUpcoming}</option>
                <option value="Live">{t.examFilterLive}</option>
                <option value="Ended">{t.examFilterEnded}</option>
              </AdminSelect>
              <AdminSelect
                value={audienceFilter}
                onChange={(e) => setAudienceFilter(e.target.value)}
                className="h-9 w-full sm:w-auto min-w-[10rem] text-[13px]"
              >
                <option value="All">
                  {lang === 'ru' ? 'Vse auditorii' : lang === 'en' ? 'All audiences' : 'Barcha auditoriyalar'}
                </option>
                {Object.entries(AUD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </AdminSelect>
              <AdminBtn
                variant="ghost"
                size="sm"
                loading={refreshing}
                onClick={() => fetchExams(true)}
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                }
              >
                <span className="hidden sm:inline">{t.reload}</span>
              </AdminBtn>
            </div>
          </div>

          <div className="p-4">
            {filteredExams.length === 0 ? (
              <AdminEmpty
                icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
                title={isStaffPortal ? t.staffNoExamsHint : t.adminNoExamsYet}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {examPage.pageItems.map((e: any, i: number) => (
                  <motion.div
                    key={e.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className={`border rounded-lg p-4 flex flex-col gap-3 transition-colors ${selectedExam === e.id ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-[15px] leading-snug">{e.title}</p>
                        {(e.faculty_subject || e.kafedra_id) && (
                          <p className="text-[12px] text-gray-400 mt-0.5 truncate">
                            {[kafedraNames[Number(e.kafedra_id)], e.faculty_subject]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <ExamStatusBadge e={e} />
                          {(e.exam_mode === 'bank_mixed' || e.exam_mode === 'imentor_mixed') && (
                            <span className="text-[11px] font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                              {e.exam_mode === 'imentor_mixed' ? t.imentorExamBadge : t.bankExamBadge}
                            </span>
                          )}
                          <span className="text-[11px] font-semibold bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full">
                            {AUD_LABEL[String(e.audience || 'student')] || e.audience}
                          </span>
                          <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium uppercase">{e.language}</span>
                          {e.language === 'auto' && e.languages_ready != null && (
                            <span
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                e.languages_ready >= 3
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : e.languages_ready > 0
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {e.languages_ready > 0
                                ? t.examLangReadyLabel.replace('{n}', String(e.languages_ready))
                                : t.examLangPendingLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                        <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-0.5">{t.startTime}</p>
                        <p className="text-[12px] text-gray-700 font-medium">{new Date(e.start_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</p>
                      </div>
                      <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                        <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-0.5">{t.endTime}</p>
                        <p className="text-[12px] text-gray-700 font-medium">{new Date(e.end_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-200">
                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="text-[12px] text-gray-600 font-semibold">{e.duration_minutes} min</span>
                      </div>
                      {e.bank_question_count > 0 && (
                        <div className="bg-indigo-50 rounded-lg px-2.5 py-1.5 border border-indigo-100">
                          <span className="text-[12px] text-indigo-700 font-semibold">{e.bank_question_count} {t.questionsShort}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-auto pt-2 border-t border-gray-100">
                      <AdminBtn variant="ghost" size="sm" onClick={() => setActiveMonitorExamId(e.id)} className="flex-1 text-indigo-600 border-indigo-200 hover:bg-indigo-50">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        {t.monitorBtn}
                      </AdminBtn>
                      <AdminBtn variant={selectedExam === e.id ? 'violet' : 'ghost'} size="sm" onClick={() => viewResults(e.id)} className="flex-1">
                        {t.results}
                      </AdminBtn>
                      {!isStaffPortal && (
                        <AdminBtn variant="ghost" size="sm" onClick={() => setEditingExamId(e.id)} className="flex-1">
                          {t.edit}
                        </AdminBtn>
                      )}
                    </div>
                    {!isStaffPortal && (
                      <AdminBtn
                        variant="ghost"
                        size="sm"
                        onClick={() => setQuestionsExamId(e.id)}
                        className="w-full mt-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                      >
                        {qtext(lang).button}
                      </AdminBtn>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
          <AdminPagination
            page={examPage.page}
            totalPages={examPage.totalPages}
            onPageChange={examPage.setPage}
            total={examPage.total}
            pageSize={examPage.pageSize}
          />
        </div>
      </motion.div>

      {/* ── Results panel ── */}
      <AnimatePresence mode="wait">
        {results && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          >
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-gray-900">{t.results}</h2>
                    {results?.review_priority_counts && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className="text-[12px] px-2.5 py-1 rounded-full border border-red-200 bg-red-50 text-red-700 font-semibold">Critical: {results.review_priority_counts.critical || 0}</span>
                        <span className="text-[12px] px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 font-semibold">High: {results.review_priority_counts.high || 0}</span>
                        <span className="text-[12px] px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 font-semibold">Medium: {results.review_priority_counts.medium || 0}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminSelect value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="h-9 text-[13px] w-full sm:w-[150px]">
                      <option value="All">{t.examStatusAll}</option>
                      <option value="Completed">{t.examStatusCompleted}</option>
                      <option value="Pending">{t.examStatusPending}</option>
                      <option value="Banned">{t.examStatusBanned}</option>
                    </AdminSelect>
                    <div className="flex flex-wrap gap-1 bg-white border border-gray-200 p-1 rounded-xl">
                      {['score', 'name', 'risk_score'].map((key) => (
                        <button key={key} type="button" onClick={() => handleSort(key)}
                          className={`px-2.5 py-1 text-[12px] font-semibold rounded-lg transition-colors ${sortConfig?.key === key ? 'bg-indigo-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}>
                          {key === 'risk_score' ? t.examResultRisk : key === 'score' ? t.examResultScore : t.nameColumn}
                          {sortConfig?.key === key && (sortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                        </button>
                      ))}
                    </div>
                    <AdminBtn variant={recommendedOnly ? 'violet' : 'ghost'} size="sm" onClick={() => setRecommendedOnly((v) => !v)}>
                      {t.examResultReview}
                    </AdminBtn>
                    {!isStaffPortal && <AdminBtn variant="ghost" size="sm" onClick={exportCSV}>{t.exportCsv}</AdminBtn>}
                    <AdminBtn variant="ghost" size="sm" onClick={() => { setResults(null); setSelectedExam(null); }}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </AdminBtn>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
                {getSortedAndFilteredResults().map((r: any) => {
                  const studentViolations = results.violations.filter((v: any) => v.student_id === r.student_id);
                  const timeTaken = calculateTimeTaken(r.started_at, r.completed_at);
                  const flaggedCount = getFlaggedCount(r.flagged_questions_json);
                  const incorrectAnswers = getIncorrectAnswers(r.answers_json, r.questions_json || results.questions_json);

                  return (
                    <div key={r.id} className="px-5 py-4 hover:bg-gray-50/50 transition-colors">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 font-semibold flex items-center justify-center text-[15px] shrink-0">
                            {r.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900 text-[15px]">{r.name}</h3>
                            <p className="text-[13px] text-gray-400 font-mono">{r.student_id}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              {r.recommended_review && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 font-semibold">{t.reviewBadge}</span>}
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">{t.riskLabel}: {r.risk_score ?? 0}</span>
                              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium uppercase ${r.highest_priority === 'critical' ? 'bg-red-50 border-red-200 text-red-700' : r.highest_priority === 'high' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
                                {r.highest_priority === 'critical' ? t.priorityCritical : r.highest_priority === 'high' ? t.priorityHigh : r.highest_priority === 'low' ? t.priorityLow : t.priorityMedium}
                              </span>
                            </div>
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-[12px] font-semibold shrink-0 border ${r.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : r.status === 'Banned' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                          {statusLabel(r.status)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                        {[
                          { label: t.examResultScore, value: r.score !== null ? r.score : '—', cls: 'text-2xl font-extrabold text-gray-900' },
                          { label: t.examResultTime, value: timeTaken, cls: 'text-[15px] font-semibold text-gray-700' },
                          { label: t.examResultFlagged, value: flaggedCount, cls: 'text-[15px] font-semibold text-amber-600' },
                          { label: t.examResultIncorrect, value: incorrectAnswers.length, cls: 'text-[15px] font-semibold text-red-600' },
                        ].map((s) => (
                          <div key={s.label} className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                            <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">{s.label}</p>
                            <p className={s.cls}>{s.value}</p>
                          </div>
                        ))}
                      </div>

                      {incorrectAnswers.length > 0 && r.status === 'Completed' && (
                        <details className="group mb-3">
                          <summary className="text-[13px] font-semibold text-gray-600 cursor-pointer hover:text-indigo-700 transition-colors flex items-center gap-2 select-none py-1.5">
                            <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            {t.examIncorrectAnswers} ({incorrectAnswers.length})
                          </summary>
                          <div className="mt-2 space-y-2 pl-5 border-l-2 border-red-100">
                            {incorrectAnswers.map((inc: any, idx: number) => (
                              <div key={idx} className="text-[13px] bg-red-50 p-3 rounded-xl border border-red-100">
                                <p className="font-medium text-gray-800 mb-1.5">{inc.question}</p>
                                <div className="flex flex-wrap gap-3 text-[12px]">
                                  <span className="text-red-600">{t.examStudentAnswer}: <span className="font-bold">{inc.studentAnswer || '—'}</span></span>
                                  <span className="text-emerald-600">{t.examCorrectAnswer}: <span className="font-bold">{inc.correctAnswer}</span></span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      {Array.isArray(r.question_risk_timeline) && r.question_risk_timeline.length > 0 && (
                        <details className="group mb-3">
                          <summary className="text-[13px] font-semibold text-gray-600 cursor-pointer hover:text-red-600 transition-colors flex items-center gap-2 select-none py-1.5">
                            <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            {t.examResultRisk} Timeline ({r.question_risk_timeline.length})
                          </summary>
                          <div className="mt-2 flex flex-wrap gap-2 pl-5">
                            {r.question_risk_timeline.map((q: any) => (
                              <div key={q.question_id} className="text-[12px] bg-orange-50 px-2.5 py-1.5 rounded-xl border border-orange-100 flex items-center gap-1.5">
                                <span className="font-bold text-gray-800">Q{q.question_no}</span>
                                <span className="text-gray-500">r:{q.risk_score}</span>
                                {q.flagged && <span className="text-red-600 font-semibold">🚩</span>}
                                {q.incorrect && <span className="text-amber-600 font-semibold">✗</span>}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      {studentViolations.length > 0 && (
                        <div className="bg-red-50 rounded-xl border border-red-100 p-3 mb-3">
                          <p className="text-[13px] font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            {t.examViolations} ({studentViolations.length})
                          </p>
                          <ul className="space-y-1">
                            {studentViolations.map((v: any, i: number) => (
                              <li key={i} className="text-[13px] text-red-600 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                                {v.violation_type}
                                <span className="text-red-400 text-[11px]">({new Date(v.timestamp).toLocaleTimeString()})</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {(r.status === 'Banned' || r.status === 'Completed' || r.status === 'Failed') && (
                        <AdminBtn variant="ghost" size="sm" onClick={() => allowRetake(r.id)}>{t.allowRetake}</AdminBtn>
                      )}
                    </div>
                  );
                })}
                {getSortedAndFilteredResults().length === 0 && (
                  <AdminEmpty
                    icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                    title={t.examNoResultsFilter}
                  />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeMonitorExamId && (
          <LiveMonitor examId={activeMonitorExamId} token={token} lang={lang} onClose={() => setActiveMonitorExamId(null)} />
        )}
      </AnimatePresence>

      {editingExamId != null && !isStaffPortal && (
        <ExamEditModal
          token={token}
          lang={lang}
          examId={editingExamId}
          groups={groups}
          onClose={() => setEditingExamId(null)}
          onSaved={(ev) => {
            fetchExams();
            if (ev.deleted && selectedExam === ev.examId) { setResults(null); setSelectedExam(null); }
            setEditingExamId(null);
          }}
        />
      )}

      {questionsExamId != null && (
        <ExamQuestionsModal
          token={token}
          lang={lang}
          examId={questionsExamId}
          apiVariant={apiVariant}
          onClose={() => setQuestionsExamId(null)}
        />
      )}
    </motion.div>
  );
}
// ── Imtihon savollarini ko'rish ────────────────────────────────────────────
// Ma'lumot allaqachon API da bor: GET /api/admin/exams/<id> javobida
// `questions` massivi qaytadi. Bu yerda uni faqat ekranga chiqaramiz.

type QuestionsText = {
  button: string; title: string; count: string; loading: string;
  empty: string; error: string; correct: string; close: string; noAnswer: string;
};

const QUESTIONS_TEXT: Record<string, QuestionsText> = {
  uz: {
    button: 'Savollarni ko‘rish',
    title: 'Imtihon savollari',
    count: 'ta savol',
    loading: 'Yuklanmoqda…',
    empty: 'Bu imtihonda hali savol yo‘q.',
    error: 'Savollarni yuklab bo‘lmadi.',
    correct: 'To‘g‘ri javob',
    close: 'Yopish',
    noAnswer: 'javob belgilanmagan',
  },
  ru: {
    button: 'Посмотреть вопросы',
    title: 'Вопросы экзамена',
    count: 'вопросов',
    loading: 'Загрузка…',
    empty: 'В этом экзамене пока нет вопросов.',
    error: 'Не удалось загрузить вопросы.',
    correct: 'Правильный ответ',
    close: 'Закрыть',
    noAnswer: 'ответ не указан',
  },
  en: {
    button: 'View questions',
    title: 'Exam questions',
    count: 'questions',
    loading: 'Loading…',
    empty: 'This exam has no questions yet.',
    error: 'Could not load questions.',
    correct: 'Correct answer',
    close: 'Close',
    noAnswer: 'no answer marked',
  },
};

function qtext(lang: string): QuestionsText {
  return QUESTIONS_TEXT[lang] || QUESTIONS_TEXT.uz;
}

function ExamQuestionsModal({
  token,
  lang,
  examId,
  apiVariant,
  onClose,
}: {
  token: string;
  lang: Language;
  examId: number;
  apiVariant: 'admin' | 'staff';
  onClose: () => void;
}) {
  const L = qtext(lang);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      const base = '/api/admin/exams/';
      try {
        const res = await fetch(apiUrl(base + examId), { headers: authHeaders(token, lang) });
        if (!checkAdminAuthResponse(res)) return;
        const data = await readJsonSafe<any>(res);
        if (!alive) return;
        if (!res.ok || !data) {
          setError(L.error);
        } else {
          setTitle(String(data.title || ''));
          setQuestions(Array.isArray(data.questions) ? data.questions : []);
        }
      } catch {
        if (alive) setError(L.error);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [examId, token, lang, apiVariant]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="text-base font-semibold text-gray-900">{L.title}</div>
          <div className="text-[13px] text-gray-500 mt-0.5">
            {title}
            {!loading && !error ? ` · ${questions.length} ${L.count}` : ''}
          </div>
        </div>

        <div className="px-5 py-4 overflow-y-auto grow">
          {loading && <div className="text-sm text-gray-500">{L.loading}</div>}
          {!loading && error && <div className="text-sm text-red-600">{error}</div>}
          {!loading && !error && questions.length === 0 && (
            <div className="text-sm text-gray-500">{L.empty}</div>
          )}
          {!loading && !error && questions.map((q: any, qi: number) => {
            const opts: any[] = Array.isArray(q?.options) ? q.options : [];
            const correct = String(q?.correctAnswer ?? '');
            return (
              <div key={q?.id ?? qi} className="mb-5 last:mb-0">
                <div className="text-sm font-medium text-gray-900">
                  {qi + 1}. {String(q?.text ?? '')}
                </div>
                <ul className="mt-2 space-y-1">
                  {opts.map((o: any, oi: number) => {
                    const val = String(o ?? '');
                    const isCorrect = correct !== '' && val === correct;
                    return (
                      <li
                        key={oi}
                        className={
                          'text-[13px] px-2.5 py-1.5 rounded-lg border ' +
                          (isCorrect
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-medium'
                            : 'bg-gray-50 border-gray-100 text-gray-700')
                        }
                      >
                        {String.fromCharCode(65 + oi)}. {val}
                        {isCorrect ? ` ✓ ${L.correct}` : ''}
                      </li>
                    );
                  })}
                </ul>
                {correct === '' && (
                  <div className="text-[12px] text-amber-600 mt-1">{L.noAnswer}</div>
                )}
                {q?.explanation ? (
                  <div className="text-[12px] text-gray-500 mt-1.5">{String(q.explanation)}</div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <AdminBtn variant="ghost" size="sm" onClick={onClose}>
            {L.close}
          </AdminBtn>
        </div>
      </div>
    </div>
  );
}
