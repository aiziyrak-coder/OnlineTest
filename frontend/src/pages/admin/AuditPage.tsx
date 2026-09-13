import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminCard, AdminEmpty, AdminInput, AdminSelect, AdminBtn, AdminAlert
} from './ui';

interface Props { token: string; lang: Language; }

interface AuditRow {
  id: number;
  actor_id: string;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string;
  target_name: string;
  detail: string;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  create_user:       'bg-emerald-100 text-emerald-700',
  delete_user:       'bg-red-100 text-red-700',
  update_user:       'bg-amber-100 text-amber-700',
  create_level:      'bg-blue-100 text-blue-700',
  rename_level:      'bg-indigo-100 text-indigo-700',
  delete_level:      'bg-red-100 text-red-700',
  create_group:      'bg-violet-100 text-violet-700',
  update_group:      'bg-amber-100 text-amber-700',
  delete_group:      'bg-red-100 text-red-700',
  unban_user:        'bg-emerald-100 text-emerald-700',
  approve_appeal:    'bg-emerald-100 text-emerald-700',
  reject_appeal:     'bg-red-100 text-red-700',
  create_exam:       'bg-sky-100 text-sky-700',
  update_exam:       'bg-amber-100 text-amber-700',
  delete_exam:       'bg-red-100 text-red-700',
  import_testbank:   'bg-purple-100 text-purple-700',
  create_category:   'bg-blue-100 text-blue-700',
  delete_category:   'bg-red-100 text-red-700',
  add_questions:     'bg-purple-100 text-purple-700',
  retake_exam:       'bg-orange-100 text-orange-700',
  unblock_student:   'bg-cyan-100 text-cyan-700',
};

const ALL_ACTIONS = Object.keys(ACTION_COLORS);

function getActionLabel(action: string, lang: Language): string {
  const t = translations[lang];
  const map: Record<string, string> = {
    create_user:     t.auditActionCreateUser,
    delete_user:     t.auditActionDeleteUser,
    update_user:     t.auditActionUpdateUser,
    create_level:    t.auditActionCreateLevel,
    rename_level:    t.auditActionRenameLevel,
    delete_level:    t.auditActionDeleteLevel,
    create_group:    t.auditActionCreateGroup,
    update_group:    t.auditActionUpdateGroup,
    delete_group:    t.auditActionDeleteGroup,
    unban_user:      t.auditActionUnbanUser,
    approve_appeal:  t.auditActionApproveAppeal,
    reject_appeal:   t.auditActionRejectAppeal,
    create_exam:     t.auditActionCreateExam,
    update_exam:     t.auditActionUpdateExam,
    delete_exam:     t.auditActionDeleteExam,
    import_testbank: t.auditActionImportTestbank,
    create_category: t.auditActionCreateCategory,
    delete_category: t.auditActionDeleteCategory,
    add_questions:   t.auditActionAddQuestions,
    retake_exam:     t.auditActionRetakeExam,
    unblock_student: t.auditActionUnblockStudent,
  };
  return map[action] ?? action;
}

type Period = '' | 'today' | 'week' | 'month' | 'year';

/** Audit paroli sessiya davomida eslab qolinadi (yopilsa — qaytadan). */
const AUDIT_PW_KEY = 'fjsti_audit_pw';

export function AuditPage({ token, lang }: Props) {
  const t = translations[lang];
  const [pw, setPw] = useState<string>(() => {
    try {
      return sessionStorage.getItem(AUDIT_PW_KEY) || '';
    } catch {
      return '';
    }
  });
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const h = { ...authHeaders(token, lang), 'X-Audit-Password': pw };
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [period, setPeriod] = useState<Period>('');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const LIMIT = 50;

  const buildParams = (pg: number, forExport = false) => {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(pg * LIMIT) });
    if (actorFilter.trim()) params.set('actor', actorFilter.trim());
    if (actionFilter) params.set('action', actionFilter);
    if (period) params.set('period', period);
    if (forExport) params.set('export', 'csv');
    return params;
  };

  const reload = useCallback(async (pg = 0) => {
    setLoading(true);
    const res = await fetch(apiUrl(`/api/admin/audit-log?${buildParams(pg)}`), { headers: h });
    // DIQQAT: qulf tekshiruvi `checkAdminAuthResponse` dan OLDIN. Aks holda
    // u qulfni sessiya xatosi deb hisoblab, login sahifasiga uloqtiradi.
    if (res.status === 423) {
      // Parol noto'g'ri yoki hali kiritilmagan — qulf oynasini ko'rsatamiz.
      setUnlocked(false);
      setPwError(pw ? 'Parol noto‘g‘ri' : '');
      try { sessionStorage.removeItem(AUDIT_PW_KEY); } catch { /* ignore */ }
      setLoading(false);
      return;
    }
    if (!checkAdminAuthResponse(res)) { setLoading(false); return; }
    const data = await readJsonSafe<{ total: number; rows: AuditRow[] }>(res);
    setRows(data?.rows ?? []);
    setTotal(data?.total ?? 0);
    setUnlocked(true);
    setLoading(false);
  }, [token, actorFilter, actionFilter, period, pw]);

  useEffect(() => { setPage(0); }, [actorFilter, actionFilter, period]);
  useEffect(() => { reload(page); }, [reload, page]);

  const submitPw = (e: React.FormEvent) => {
    e.preventDefault();
    const v = pwInput.trim();
    if (!v) return;
    try { sessionStorage.setItem(AUDIT_PW_KEY, v); } catch { /* ignore */ }
    setPwError('');
    setPw(v);
    setPwInput('');
  };

  if (!unlocked) {
    return (
      <div className="max-w-sm mx-auto mt-10">
        <form
          onSubmit={submitPw}
          autoComplete="off"
          className="bg-white rounded-xl border border-gray-200 p-6 space-y-4"
        >
          <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mx-auto">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-[15px] font-semibold text-gray-900">
              {lang === 'ru' ? 'Zhurnal audita zakryt' : lang === 'en'
                ? 'Audit log is locked' : 'Audit jurnali qulflangan'}
            </p>
            <p className="text-[13px] text-gray-500 mt-1">
              {lang === 'ru' ? 'Vvedite parol dlya prosmotra' : lang === 'en'
                ? 'Enter the password to view it' : 'Ko‘rish uchun parolni kiriting'}
            </p>
          </div>
          <input type="text" name="fakeuser" autoComplete="username"
            tabIndex={-1} aria-hidden className="hidden" />
          <AdminInput
            type="password"
            name="audit_pw"
            autoComplete="new-password"
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            placeholder={lang === 'ru' ? 'Parol' : lang === 'en' ? 'Password' : 'Parol'}
            autoFocus
          />
          {pwError ? <AdminAlert type="error">{pwError}</AdminAlert> : null}
          <AdminBtn type="submit" className="w-full" disabled={!pwInput.trim()}>
            {lang === 'ru' ? 'Otkryt' : lang === 'en' ? 'Unlock' : 'Ochish'}
          </AdminBtn>
        </form>
      </div>
    );
  }

  const exportCsv = async () => {
    setExporting(true);
    const url = apiUrl(`/api/admin/audit-log?${buildParams(0, true)}`);
    const res = await fetch(url, { headers: h });
    if (res.status === 423) {
      setUnlocked(false);
      setExporting(false);
      return;
    }
    if (!checkAdminAuthResponse(res)) { setExporting(false); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setExporting(false);
  };

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    } catch { return iso; }
  };

  const totalPages = Math.ceil(total / LIMIT);

  const PERIODS: { key: Period; label: string }[] = [
    { key: '',       label: t.auditPeriodAll },
    { key: 'today',  label: t.auditPeriodToday },
    { key: 'week',   label: t.auditPeriodWeek },
    { key: 'month',  label: t.auditPeriodMonth },
    { key: 'year',   label: t.auditPeriodYear },
  ];

  return (
    <div className="space-y-5">
      <AdminCard
        icon={
          <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        }
        title={t.auditPageTitle}
        subtitle={t.auditEventsCount.replace('{n}', String(total))}
        count={total || undefined}
      >
        {/* ── Filter toolbar ── */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 overflow-x-auto">
          {/* Period chips */}
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors border whitespace-nowrap ${
                period === key
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}

          <div className="w-px h-5 bg-gray-200 shrink-0 mx-1" />

          {/* Actor filter */}
          <AdminInput
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            placeholder={t.auditActorFilter}
            className="h-8 !w-36 shrink-0 text-[12px]"
          />

          {/* Action filter */}
          <AdminSelect
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-8 !w-44 shrink-0 text-[12px]"
          >
            <option value="">{t.auditAllActions}</option>
            {ALL_ACTIONS.map((a) => (
              <option key={a} value={a}>{getActionLabel(a, lang)}</option>
            ))}
          </AdminSelect>

          {/* Refresh */}
          <button
            type="button"
            onClick={() => reload(page)}
            disabled={loading}
            className="shrink-0 w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 flex items-center justify-center transition-colors disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Export CSV */}
          <div className="ml-auto shrink-0">
            <AdminBtn
              variant="ghost"
              size="sm"
              loading={exporting}
              onClick={exportCsv}
              icon={
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              }
            >
              {t.auditExportCsv}
            </AdminBtn>
          </div>
        </div>

        {/* ── Table ── */}
        {rows.length === 0 && !loading ? (
          <AdminEmpty
            icon={
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
            title={t.auditNoRecords}
            subtitle={t.auditNoRecordsHint}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 text-[11px] uppercase tracking-wide w-10">#</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 text-[11px] uppercase tracking-wide">{t.auditColAction}</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 text-[11px] uppercase tracking-wide">{t.auditColTarget}</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 text-[11px] uppercase tracking-wide">{t.auditColAdmin}</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500 text-[11px] uppercase tracking-wide hidden lg:table-cell">{t.auditColDetail}</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-gray-500 text-[11px] uppercase tracking-wide whitespace-nowrap">{t.auditColDate}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((row, i) => {
                  const color = ACTION_COLORS[row.action] ?? 'bg-gray-100 text-gray-600';
                  const lbl = getActionLabel(row.action, lang);
                  return (
                    <motion.tr
                      key={row.id}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.015 }}
                      className="hover:bg-gray-50/60 transition-colors"
                    >
                      {/* # */}
                      <td className="px-4 py-3 text-gray-400 tabular-nums font-mono text-[11px]">
                        {page * LIMIT + i + 1}
                      </td>
                      {/* Action badge */}
                      <td className="px-4 py-3">
                        <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${color}`}>
                          {lbl}
                        </span>
                      </td>
                      {/* Target */}
                      <td className="px-4 py-3">
                        {row.target_name ? (
                          <span className="font-medium text-gray-800 truncate block max-w-[160px]">{row.target_name}</span>
                        ) : null}
                        {row.target_id ? (
                          <span className="font-mono text-gray-400 text-[11px]">{row.target_id}</span>
                        ) : null}
                      </td>
                      {/* Admin */}
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-700 block truncate max-w-[130px]">{row.actor_name}</span>
                        {row.actor_name !== row.actor_id && (
                          <span className="font-mono text-gray-400 text-[11px]">{row.actor_id}</span>
                        )}
                      </td>
                      {/* Detail */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {row.detail ? (
                          <span className="text-gray-400 truncate block max-w-[220px]">{row.detail}</span>
                        ) : (
                          <span className="text-gray-200">—</span>
                        )}
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3 text-right text-gray-400 whitespace-nowrap tabular-nums">
                        {fmtDate(row.created_at)}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ── */}
        {total > LIMIT && (
          <div className="px-4 sm:px-5 py-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-gray-500 tabular-nums">
              {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} / {total}
            </span>
            <div className="flex items-center gap-1">
              <AdminBtn variant="ghost" size="sm" onClick={() => setPage(0)} disabled={page === 0}>«</AdminBtn>
              <AdminBtn variant="ghost" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                <span className="hidden sm:inline">{t.auditPrev}</span>
                <span className="sm:hidden">‹</span>
              </AdminBtn>
              <span className="px-2 text-[12px] text-gray-500 tabular-nums">{page + 1} / {totalPages}</span>
              <AdminBtn variant="ghost" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= totalPages}>
                <span className="hidden sm:inline">{t.auditNext}</span>
                <span className="sm:hidden">›</span>
              </AdminBtn>
              <AdminBtn variant="ghost" size="sm" onClick={() => setPage(totalPages - 1)} disabled={page + 1 >= totalPages}>»</AdminBtn>
            </div>
          </div>
        )}
      </AdminCard>
    </div>
  );
}
