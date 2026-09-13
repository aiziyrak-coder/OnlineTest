import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminCard, AdminBtn, AdminInput, AdminSelect, AdminEmpty,
  AdminPageMessage, AdminPagination, usePagedList,
} from './ui';

/*
 * Imtihon natijalari — alohida sahifa. Imtihonlar ro'yxati ostidagi panelda
 * sahifalash yo'q edi (500+ talaba bitta DOM'da) va talabaga nisbatan
 * amallardan faqat "qayta topshirish" bor edi — "yiqitish" va "+3 texnik
 * imkon" esa faqat jonli kuzatuv oynasidan chaqirilardi.
 */

type ExamRow = { id: number; title: string; start_time: string | null };

type Violation = { student_id: string; violation_type: string; timestamp: string; priority?: string };

type ResultRow = {
  id: number;
  student_id: string;
  name: string;
  status: string;
  score: number | null;
  started_at: string | null;
  completed_at: string | null;
  risk_score?: number;
  violations_count?: number;
  highest_priority?: string;
  recommended_review?: boolean;
  technical_retakes_remaining?: number;
  identity_retakes_remaining?: number;
};

type ResultsPayload = {
  results: ResultRow[];
  violations: Violation[];
  review_priority_counts?: { critical?: number; high?: number; medium?: number };
};

type SortKey = 'name' | 'score' | 'risk_score';

interface Props {
  token: string;
  lang: Language;
}

export function ExamResultsPage({ token, lang }: Props) {
  const t = translations[lang];
  const h = authHeaders(token, lang);
  const [searchParams, setSearchParams] = useSearchParams();
  const examIdParam = searchParams.get('exam') || '';

  const [exams, setExams] = useState<ExamRow[]>([]);
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const statusLabel = (status?: string | null) =>
    status === 'Completed' ? t.examStatusCompleted
      : status === 'Banned' ? t.examStatusBanned
      : status === 'Failed' ? t.examStatusFailed
      : status === 'In Progress' ? t.examStatusInProgress
      : status === 'Pending' ? t.examStatusPending
      : (status || '');

  const loadExams = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/exams'), { headers: h });
    if (!checkAdminAuthResponse(res) || !res.ok) return;
    const raw = await readJsonSafe<ExamRow[]>(res);
    setExams(Array.isArray(raw) ? raw : []);
  }, [token]);

  const loadResults = useCallback(async () => {
    if (!examIdParam) { setData(null); return; }
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${examIdParam}/results`), { headers: h });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res);
        setMsg({ type: 'error', text: d?.error || t.errorGeneric });
        setData(null);
        return;
      }
      const raw = await readJsonSafe<ResultsPayload>(res);
      setData(raw && Array.isArray(raw.results) ? raw : { results: [], violations: [] });
    } finally {
      setLoading(false);
    }
  }, [examIdParam, token]);

  useEffect(() => { loadExams(); }, [loadExams]);
  useEffect(() => { loadResults(); }, [loadResults]);
  useEffect(() => { setSearch(''); setStatusFilter('All'); setReviewOnly(false); }, [examIdParam]);

  const act = async (studentExamId: number, path: string, okText: string) => {
    setBusyId(studentExamId);
    try {
      const res = await fetch(apiUrl(`/api/admin/student_exams/${studentExamId}/${path}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({}),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) { setMsg({ type: 'error', text: d?.error || t.errorGeneric }); return; }
      setMsg({ type: 'success', text: okText });
      loadResults();
    } finally {
      setBusyId(null);
    }
  };

  const violationsFor = useCallback(
    (studentId: string) => (data?.violations ?? []).filter((v) => v.student_id === studentId),
    [data],
  );

  const visible = useMemo(() => {
    let rows = data?.results ?? [];
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.student_id.toLowerCase().includes(q));
    if (statusFilter !== 'All') rows = rows.filter((r) => r.status === statusFilter);
    if (reviewOnly) rows = rows.filter((r) => Boolean(r.recommended_review));
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortKey] ?? 0;
        const bv = b[sortKey] ?? 0;
        if (av < bv) return sortAsc ? -1 : 1;
        if (av > bv) return sortAsc ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }, [data, search, statusFilter, reviewOnly, sortKey, sortAsc]);

  const paged = usePagedList(visible);

  const selectedExam = exams.find((e) => String(e.id) === examIdParam);

  const exportCsv = () => {
    if (!data?.results.length) return;
    const head = ['Student ID', 'Name', 'Score', 'Status', 'Started', 'Completed', 'Violations'];
    const lines = data.results.map((r) => {
      const v = violationsFor(r.student_id)
        .map((x) => `${x.violation_type} (${new Date(x.timestamp).toLocaleTimeString()})`)
        .join('; ');
      return [
        r.student_id,
        `"${r.name.replace(/"/g, '""')}"`,
        r.score ?? '-',
        r.status,
        r.started_at ? new Date(r.started_at).toLocaleString() : '-',
        r.completed_at ? new Date(r.completed_at).toLocaleString() : '-',
        `"${v.replace(/"/g, '""')}"`,
      ].join(',');
    });
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `exam_${selectedExam?.title || examIdParam}_results.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  };

  const counts = data?.review_priority_counts;

  return (
    <div className="space-y-5">
      <AdminPageMessage message={msg} onDismiss={() => setMsg(null)} />

      {/* ── Imtihon tanlash ── */}
      <AdminCard title={t.results} subtitle={selectedExam?.title}>
        <div className="px-5 py-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <AdminSelect
              value={examIdParam}
              onChange={(e) => setSearchParams(e.target.value ? { exam: e.target.value } : {}, { replace: true })}
            >
              <option value="">{t.examResultsPickExam}</option>
              {exams.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.title}
                  {e.start_time ? ` · ${new Date(e.start_time).toLocaleDateString()}` : ''}
                </option>
              ))}
            </AdminSelect>
          </div>
          <AdminBtn variant="ghost" size="md" loading={loading} onClick={loadResults} disabled={!examIdParam}>
            {t.reload}
          </AdminBtn>
          <AdminBtn variant="ghost" size="md" onClick={exportCsv} disabled={!data?.results.length}>
            {t.exportCsv}
          </AdminBtn>
        </div>

        {counts && (
          <div className="px-5 pb-4 flex flex-wrap gap-2">
            <span className="text-[12px] px-2.5 py-1 rounded-full border border-red-200 bg-red-50 text-red-700 font-semibold">
              {t.priorityCritical}: {counts.critical || 0}
            </span>
            <span className="text-[12px] px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 font-semibold">
              {t.priorityHigh}: {counts.high || 0}
            </span>
            <span className="text-[12px] px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 font-semibold">
              {t.priorityMedium}: {counts.medium || 0}
            </span>
          </div>
        )}
      </AdminCard>

      {!examIdParam ? (
        <AdminCard title={t.results}>
          <AdminEmpty
            icon={
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            title={t.examResultsNoExam}
          />
        </AdminCard>
      ) : (
        <AdminCard
          title={t.results}
          count={visible.length}
          right={
            <span className="text-[12px] text-gray-400">
              {t.examResultsStudentCount.replace('{n}', String(data?.results.length ?? 0))}
            </span>
          }
        >
          {/* ── Filtrlar ── */}
          <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
            <AdminInput
              placeholder={t.searchByNameOrId}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[160px] h-9 text-[13px]"
            />
            <AdminSelect
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 text-[13px] !w-[150px] shrink-0"
            >
              <option value="All">{t.examStatusAll}</option>
              <option value="Completed">{t.examStatusCompleted}</option>
              <option value="Pending">{t.examStatusPending}</option>
              <option value="In Progress">{t.examStatusInProgress}</option>
              <option value="Banned">{t.examStatusBanned}</option>
              <option value="Failed">{t.examStatusFailed}</option>
            </AdminSelect>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 shrink-0">
              {(['score', 'name', 'risk_score'] as SortKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSort(key)}
                  className={`px-2.5 h-8 text-[12px] font-semibold rounded-md transition-colors ${
                    sortKey === key ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {key === 'risk_score' ? t.examResultRisk : key === 'score' ? t.examResultScore : t.nameColumn}
                  {sortKey === key && (sortAsc ? ' ↑' : ' ↓')}
                </button>
              ))}
            </div>
            <AdminBtn
              variant={reviewOnly ? 'violet' : 'ghost'}
              size="sm"
              onClick={() => setReviewOnly((v) => !v)}
            >
              {t.examResultReview}
            </AdminBtn>
          </div>

          {/* ── Ro'yxat ── */}
          <div className="divide-y divide-gray-100">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : visible.length === 0 ? (
              <AdminEmpty
                icon={
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
                title={t.examNoResultsFilter}
              />
            ) : (
              paged.pageItems.map((r, i) => {
                const vs = violationsFor(r.student_id);
                const busy = busyId === r.id;
                return (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="px-4 sm:px-5 py-4 hover:bg-gray-50/60 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 font-semibold flex items-center justify-center text-[15px] shrink-0">
                          {r.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 text-[15px] truncate">{r.name}</p>
                          <p className="text-[12px] text-gray-400 font-mono">{r.student_id}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {r.recommended_review && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                                {t.reviewBadge}
                              </span>
                            )}
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                              {t.riskLabel}: {r.risk_score ?? 0}
                            </span>
                            {vs.length > 0 && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                {t.examViolations}: {vs.length}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-[22px] font-bold text-gray-900 leading-none tabular-nums">
                            {r.score ?? '—'}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-1">{t.examResultScore}</p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-[12px] font-semibold border ${
                            r.status === 'Completed'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : r.status === 'Banned' || r.status === 'Failed'
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {statusLabel(r.status)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-3">
                      <AdminBtn
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => act(r.id, 'retake', t.allowRetake)}
                      >
                        {t.allowRetake}
                      </AdminBtn>
                      <AdminBtn
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => act(r.id, 'grant-technical-retakes', t.examActionGrantRetakes)}
                      >
                        {t.examActionGrantRetakes}
                        {r.technical_retakes_remaining != null && (
                          <span className="ml-1 text-[11px] text-gray-400">({r.technical_retakes_remaining})</span>
                        )}
                      </AdminBtn>
                      <AdminBtn
                        variant="red-ghost"
                        size="sm"
                        loading={busy}
                        disabled={r.status === 'Completed'}
                        onClick={() => act(r.id, 'fail', t.examActionFail)}
                      >
                        {t.examActionFail}
                      </AdminBtn>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>

          <AdminPagination
            page={paged.page}
            totalPages={paged.totalPages}
            onPageChange={paged.setPage}
            total={paged.total}
            pageSize={paged.pageSize}
          />
        </AdminCard>
      )}
    </div>
  );
}
