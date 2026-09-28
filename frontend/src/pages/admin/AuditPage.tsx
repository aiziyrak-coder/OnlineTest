import React, { useCallback, useEffect, useState } from 'react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminAlert, AdminBtn, AdminEmpty, AdminInput, AdminSelect } from './ui';

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

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

/* Amal turi rangi: yaratish — yashil, o'chirish/rad — qizil, o'zgartirish — sariq,
   qolganlari — neytral. Rang faqat ma'noni bildiradi, bezak emas. */
const ACTIONS = [
  'create_user', 'delete_user', 'update_user', 'create_level', 'rename_level', 'delete_level',
  'create_group', 'update_group', 'delete_group', 'unban_user', 'approve_appeal', 'reject_appeal',
  'create_exam', 'update_exam', 'delete_exam', 'import_testbank', 'create_category', 'delete_category',
  'add_questions', 'retake_exam', 'unblock_student',
];

function actionTone(action: string): string {
  if (/^(delete|reject)/.test(action)) return 'bg-red-50 text-red-700 ring-red-600/15';
  if (/^(create|approve|unban|unblock|import|add)/.test(action)) return 'bg-emerald-50 text-emerald-700 ring-emerald-600/15';
  if (/^(update|rename|retake)/.test(action)) return 'bg-amber-50 text-amber-800 ring-amber-600/20';
  return 'bg-gray-100 text-gray-600 ring-gray-500/10';
}

function getActionLabel(action: string, lang: Language): string {
  const t = translations[lang];
  const map: Record<string, string> = {
    create_user: t.auditActionCreateUser, delete_user: t.auditActionDeleteUser, update_user: t.auditActionUpdateUser,
    create_level: t.auditActionCreateLevel, rename_level: t.auditActionRenameLevel, delete_level: t.auditActionDeleteLevel,
    create_group: t.auditActionCreateGroup, update_group: t.auditActionUpdateGroup, delete_group: t.auditActionDeleteGroup,
    unban_user: t.auditActionUnbanUser, approve_appeal: t.auditActionApproveAppeal, reject_appeal: t.auditActionRejectAppeal,
    create_exam: t.auditActionCreateExam, update_exam: t.auditActionUpdateExam, delete_exam: t.auditActionDeleteExam,
    import_testbank: t.auditActionImportTestbank, create_category: t.auditActionCreateCategory, delete_category: t.auditActionDeleteCategory,
    add_questions: t.auditActionAddQuestions, retake_exam: t.auditActionRetakeExam, unblock_student: t.auditActionUnblockStudent,
  };
  return map[action] ?? action;
}

type Period = '' | 'today' | 'week' | 'month' | 'year';

/** Audit paroli sessiya davomida eslab qolinadi (yopilsa — qaytadan). */
const AUDIT_PW_KEY = 'fjsti_audit_pw';
const LIMIT = 50;

const pad = (n: number) => String(n).padStart(2, '0');
function splitDate(iso: string): [string, string] {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return [iso, ''];
  return [`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`];
}

export function AuditPage({ token, lang }: Props) {
  const t = translations[lang];
  const L = (uz: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : uz);
  const [pw, setPw] = useState<string>(() => {
    try { return sessionStorage.getItem(AUDIT_PW_KEY) || ''; } catch { return ''; }
  });
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [period, setPeriod] = useState<Period>('');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  const headers = useCallback(() => ({ ...authHeaders(token, lang), 'X-Audit-Password': pw }), [token, lang, pw]);

  const buildParams = useCallback((pg: number, forExport = false) => {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(pg * LIMIT) });
    if (actorFilter.trim()) params.set('actor', actorFilter.trim());
    if (actionFilter) params.set('action', actionFilter);
    if (period) params.set('period', period);
    if (forExport) params.set('export', 'csv');
    return params;
  }, [actorFilter, actionFilter, period]);

  const reload = useCallback(async (pg = 0) => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/audit-log?${buildParams(pg)}`), { headers: headers() });
      // Qulf tekshiruvi `checkAdminAuthResponse` dan OLDIN — aks holda 423 sessiya
      // xatosi deb hisoblanib login sahifasiga uloqtiradi.
      if (res.status === 423) {
        setUnlocked(false);
        setPwError(pw ? L('Parol noto‘g‘ri', 'Неверный пароль', 'Wrong password') : '');
        try { sessionStorage.removeItem(AUDIT_PW_KEY); } catch { /* ignore */ }
        return;
      }
      if (!checkAdminAuthResponse(res)) return;
      const data = await readJsonSafe<{ total: number; rows: AuditRow[] }>(res);
      setRows(data?.rows ?? []);
      setTotal(data?.total ?? 0);
      setUnlocked(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildParams, headers, pw]);

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
      <div className="mx-auto mt-10 max-w-sm">
        <form onSubmit={submitPw} autoComplete="off" className={`${CARD} space-y-4 p-6`}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-[16px] font-bold text-gray-900">{L('Audit jurnali qulflangan', 'Журнал аудита закрыт', 'Audit log is locked')}</p>
            <p className="mt-1 text-[13px] text-gray-500">{L('Ko‘rish uchun parolni kiriting', 'Введите пароль для просмотра', 'Enter the password to view it')}</p>
          </div>
          <input type="text" name="fakeuser" autoComplete="username" tabIndex={-1} aria-hidden className="hidden" />
          <AdminInput type="password" name="audit_pw" autoComplete="new-password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} placeholder={L('Parol', 'Пароль', 'Password')} autoFocus />
          {pwError ? <AdminAlert type="error">{pwError}</AdminAlert> : null}
          <AdminBtn type="submit" className="w-full" disabled={!pwInput.trim()}>{L('Ochish', 'Открыть', 'Unlock')}</AdminBtn>
        </form>
      </div>
    );
  }

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/audit-log?${buildParams(0, true)}`), { headers: headers() });
      if (res.status === 423) { setUnlocked(false); return; }
      if (!checkAdminAuthResponse(res)) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const PERIODS: { key: Period; label: string }[] = [
    { key: '', label: t.auditPeriodAll },
    { key: 'today', label: t.auditPeriodToday },
    { key: 'week', label: t.auditPeriodWeek },
    { key: 'month', label: t.auditPeriodMonth },
    { key: 'year', label: t.auditPeriodYear },
  ];

  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3">
        <div className="flex rounded-lg bg-gray-100 p-0.5">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key || 'all'}
              type="button"
              onClick={() => setPeriod(key)}
              className={`h-8 whitespace-nowrap rounded-md px-3 text-[12.5px] font-semibold ${period === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <AdminInput value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} placeholder={t.auditActorFilter} className="h-9 sm:w-44" />
        <AdminSelect value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="h-9 sm:w-56">
          <option value="">{t.auditAllActions}</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{getActionLabel(a, lang)}</option>)}
        </AdminSelect>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[13px] text-gray-500"><b className="tabular-nums text-gray-900">{total}</b> {L('yozuv', 'записей', 'records')}</span>
          <AdminBtn variant="ghost" size="sm" loading={loading} onClick={() => reload(page)}>{L('Yangilash', 'Обновить', 'Refresh')}</AdminBtn>
          <AdminBtn variant="ghost" size="sm" loading={exporting} onClick={exportCsv}>{t.auditExportCsv}</AdminBtn>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[13.5px]">
          <thead className="bg-gray-50/80 text-[12px] text-gray-500">
            <tr className="border-b border-gray-200 text-left">
              <th className="w-36 px-4 py-2.5 font-semibold">{t.auditColDate}</th>
              <th className="px-4 py-2.5 font-semibold">{t.auditColAction}</th>
              <th className="px-4 py-2.5 font-semibold">{t.auditColTarget}</th>
              <th className="px-4 py-2.5 font-semibold">{t.auditColAdmin}</th>
              <th className="px-4 py-2.5 font-semibold">{t.auditColDetail}</th>
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-60' : ''}>
            {rows.map((row) => {
              const [d, tm] = splitDate(row.created_at);
              return (
                <tr key={row.id} className="align-top hover:bg-gray-50/70">
                  <td className="border-b border-gray-100 px-4 py-3 whitespace-nowrap tabular-nums">
                    <p className="font-medium text-gray-800">{d}</p>
                    <p className="text-[12px] text-gray-400">{tm}</p>
                  </td>
                  <td className="border-b border-gray-100 px-4 py-3">
                    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${actionTone(row.action)}`}>
                      {getActionLabel(row.action, lang)}
                    </span>
                  </td>
                  <td className="border-b border-gray-100 px-4 py-3">
                    {row.target_name ? <p className="max-w-[240px] truncate font-medium text-gray-800" title={row.target_name}>{row.target_name}</p> : null}
                    {row.target_id ? <p className="font-mono text-[11.5px] text-gray-400">{row.target_type ? `${row.target_type} · ` : ''}{row.target_id}</p> : null}
                  </td>
                  <td className="border-b border-gray-100 px-4 py-3">
                    <p className="max-w-[180px] truncate font-medium text-gray-700">{row.actor_name}</p>
                    {row.actor_name !== row.actor_id ? <p className="font-mono text-[11.5px] text-gray-400">{row.actor_id}</p> : null}
                  </td>
                  <td className="border-b border-gray-100 px-4 py-3">
                    {row.detail ? <p className="max-w-[320px] break-words text-[12.5px] text-gray-500">{row.detail}</p> : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && !loading ? <AdminEmpty title={t.auditNoRecords} subtitle={t.auditNoRecordsHint} /> : null}
      </div>

      {total > LIMIT ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
          <span className="text-[12.5px] tabular-nums text-gray-500">{page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} / {total}</span>
          <div className="flex items-center gap-1.5">
            <AdminBtn variant="ghost" size="sm" onClick={() => setPage(0)} disabled={page === 0}>«</AdminBtn>
            <AdminBtn variant="ghost" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>‹ {t.auditPrev}</AdminBtn>
            <span className="px-2 text-[13px] font-semibold tabular-nums text-gray-700">{page + 1} / {totalPages}</span>
            <AdminBtn variant="ghost" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= totalPages}>{t.auditNext} ›</AdminBtn>
            <AdminBtn variant="ghost" size="sm" onClick={() => setPage(totalPages - 1)} disabled={page + 1 >= totalPages}>»</AdminBtn>
          </div>
        </div>
      ) : null}
    </section>
  );
}
