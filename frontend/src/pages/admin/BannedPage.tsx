import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, parseAdminUsersList, checkAdminAuthResponse } from '../../lib/http';
import { AdminInput, AdminBtn, AdminCard, AdminAlert, AdminEmpty, AdminLabel, AdminTextarea, AdminModal, AdminFileInput, AdminPageMessage, AdminPagination, usePagedList, AdminSelect,
} from './ui';
import type { BanAppeal, Group, StudentRow } from './types';

interface Props { token: string; lang: Language; }

export function BannedPage({ token, lang }: Props) {
  const t = translations[lang];
  const h = authHeaders(token, lang);

  const [groups, setGroups] = useState<Group[]>([]);
  const [banList, setBanList] = useState<StudentRow[]>([]);
  const [appeals, setAppeals] = useState<BanAppeal[]>([]);
  const [reviewQueue, setReviewQueue] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [pageMsg, setPageMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [appealNotes, setAppealNotes] = useState<Record<number, string>>({});
  const [appealBusy, setAppealBusy] = useState<Record<number, boolean>>({});
  const [queueBusy, setQueueBusy] = useState<Record<number, boolean>>({});

  // Unban modal
  const [unbanUser, setUnbanUser] = useState<StudentRow | null>(null);
  const [unbanReason, setUnbanReason] = useState('');
  const [unbanFile, setUnbanFile] = useState<File | null>(null);
  const [unbanError, setUnbanError] = useState('');
  const [unbanBusy, setUnbanBusy] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const ROLE_LABEL: Record<string, string> = {
    student: lang === 'ru' ? 'Student' : lang === 'en' ? 'Student' : 'Talaba',
    faculty: lang === 'ru' ? 'Prepodavatel' : lang === 'en' ? 'Teacher' : "O'qituvchi",
    ordinator: lang === 'ru' ? 'Ordinator' : lang === 'en' ? 'Resident' : 'Ordinator',
    magistr: lang === 'ru' ? 'Magistr' : lang === 'en' ? 'Master' : 'Magistr',
    vacancy: lang === 'ru' ? 'Kandidat' : lang === 'en' ? 'Applicant' : 'Nomzod',
    staff: lang === 'ru' ? 'Nablyudatel' : lang === 'en' ? 'Proctor' : 'Kuzatuvchi',
  };

  const load = useCallback(async () => {
    const [rG, rB, rA, rQ] = await Promise.all([
      fetch(apiUrl('/api/admin/groups'), { headers: h }),
      // Bloklanganlar ro'yxati BARCHA rollarni qamrab oladi. Ilgari faqat
      // talaba so'ralardi: bloklangan o'qituvchi, ordinator, magistr yoki
      // vakansiya nomzodi bu oynada umuman ko'rinmasdi va banini ochishning
      // iloji yo'q edi.
      fetch(
        apiUrl(
          '/api/admin/users?role=student,faculty,ordinator,magistr,vacancy,staff&status=Banned&limit=500',
        ),
        { headers: h },
      ),
      fetch(apiUrl('/api/admin/ban-appeals?status=Pending'), { headers: h }),
      fetch(apiUrl('/api/admin/review-queue?limit=40'), { headers: h }),
    ]);
    if (!checkAdminAuthResponse(rG) || !checkAdminAuthResponse(rB) || !checkAdminAuthResponse(rA) || !checkAdminAuthResponse(rQ)) return;
    const jG = await readJsonSafe<Group[]>(rG);
    const jB = await readJsonSafe<unknown>(rB);
    const jA = await readJsonSafe<BanAppeal[]>(rA);
    const jQ = await readJsonSafe<{ results?: any[] }>(rQ);
    setGroups(Array.isArray(jG) ? jG : []);
    setBanList(parseAdminUsersList<StudentRow>(jB));
    setAppeals(Array.isArray(jA) ? jA : []);
    setReviewQueue(Array.isArray(jQ?.results) ? jQ!.results : []);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const requestDeleteUser = (u: StudentRow) => {
    setDeleteConfirmId(u.id);
    setUnbanUser(null);
  };

  const deleteUser = async (id: string) => {
    setDeletingId(id);
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(id)}`), { method: 'DELETE', headers: h });
    setDeletingId(null);
    setDeleteConfirmId(null);
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      setPageMsg({ type: 'ok', text: t.studentDeletedOk });
      setTimeout(() => setPageMsg(null), 3000);
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      setPageMsg({ type: 'err', text: d?.error || t.errorGeneric });
    }
    load();
  };

  const submitUnban = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unbanUser || !unbanFile) return;
    if (unbanReason.trim().length < 8) { setUnbanError(t.adminUnbanMinChars); return; }
    setUnbanBusy(true); setUnbanError('');
    const fd = new FormData();
    fd.append('reason', unbanReason.trim());
    fd.append('evidence', unbanFile);
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(unbanUser.id)}/unban`), { method: 'POST', headers: h, body: fd });
    if (!checkAdminAuthResponse(res)) { setUnbanBusy(false); return; }
    const d = await readJsonSafe<{ error?: string }>(res);
    setUnbanBusy(false);
    if (!res.ok) { setUnbanError(d?.error || t.errorGeneric); return; }
    setUnbanUser(null); setUnbanReason(''); setUnbanFile(null); setUnbanError('');
    setPageMsg({ type: 'ok', text: t.unbanSuccessOk });
    setTimeout(() => setPageMsg(null), 3000);
    load();
  };

  const resolveAppeal = async (id: number, decision: 'approve' | 'reject') => {
    const note = appealNotes[id] ?? '';
    if (decision === 'reject' && !note.trim()) return;
    setAppealBusy((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(apiUrl(`/api/admin/ban-appeals/${id}/resolve`), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ decision, note }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        setPageMsg({ type: 'err', text: d?.error || t.errorGeneric });
      } else {
        const msgKey = decision === 'approve' ? t.appealApprovedOk : t.appealRejectedOk;
        setPageMsg({ type: 'ok', text: msgKey });
        setTimeout(() => setPageMsg(null), 3000);
      }
      setAppealNotes((p) => { const n = { ...p }; delete n[id]; return n; });
      load();
    } finally {
      setAppealBusy((p) => ({ ...p, [id]: false }));
    }
  };

  // Ko'rib chiqish navbati ilgari faqat ma'lumot ko'rsatardi: adashib
  // bloklangan o'qituvchini shu yerdan chiqarib bo'lmasdi. Endi har qatorda
  // ikkita amal bor - blokdan chiqarish va qayta topshirishga ruxsat.
  const queueAction = async (seId: number, action: 'unblock' | 'retake') => {
    if (!seId) return;
    // "Qayta imkon berish" TOPSHIRILGAN NATIJANI BUTUNLAY O'CHIRADI: javoblar,
    // ball, tugatilgan vaqt — hammasi tozalanadi va qaytarib bo'lmaydi.
    // Tugma "Blokdan chiqarish" yonida turgani uchun adashib bosilgan va bir
    // o'qituvchining tayyor natijasi yo'qolgan edi. Endi tasdiq so'raladi.
    if (action === 'retake') {
      const warn = lang === 'ru'
        ? 'Внимание! Уже сданный результат (ответы и балл) будет УДАЛЁН безвозвратно, человеку придётся сдавать заново. Продолжить?'
        : lang === 'en'
          ? 'Warning! The submitted result (answers and score) will be PERMANENTLY DELETED and the person must take the exam again. Continue?'
          : "Diqqat! Topshirilgan natija (javoblar va ball) BUTUNLAY o'chadi va bu kishi imtihonni qaytadan topshirishi kerak bo'ladi. Davom etamizmi?";
      if (!window.confirm(warn)) return;
    }
    setQueueBusy((p) => ({ ...p, [seId]: true }));
    try {
      const path = action === 'retake'
        ? `/api/admin/student_exams/${seId}/retake`
        : `/api/admin/student_exams/${seId}/unblock`;
      const res = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify(action === 'unblock' ? { can_retake: true } : {}),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) { setPageMsg({ type: 'err', text: d?.error || t.errorGeneric }); return; }
      setPageMsg({ type: 'ok', text: lang === 'ru' ? 'Готово' : lang === 'en' ? 'Done' : 'Bajarildi' });
      setTimeout(() => setPageMsg(null), 3000);
      load();
    } finally {
      setQueueBusy((p) => ({ ...p, [seId]: false }));
    }
  };

  const filtered = banList.filter((u) => {
    if (roleFilter && String(u.role || '') !== roleFilter) return false;
    const q = search.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
  });
  const bannedPage = usePagedList(filtered);
  const appealsPage = usePagedList(appeals);

  return (
    <div className="space-y-5">
      <AdminPageMessage message={pageMsg} onDismiss={() => setPageMsg(null)} />
      {/* Bloklangan talabalar */}
      <AdminCard
        title={t.bannedUsers}
        subtitle={t.adminBannedSubtitle}
        count={banList.length}
        borderColor="border-red-200/70"
      >
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex flex-wrap gap-2">
          <AdminInput
            placeholder={t.searchByNameOrId}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-[13px] flex-1 min-w-[200px]"
          />
          <AdminSelect
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-9 text-[13px] w-full sm:w-52"
          >
            <option value="">
              {lang === 'ru' ? 'Vse roli' : lang === 'en' ? 'All roles' : 'Barcha rollar'}
            </option>
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </AdminSelect>
        </div>
        <div className="divide-y divide-gray-100">
          {filtered.length === 0 ? (
            <AdminEmpty
              icon={<svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
              title={t.adminBannedEmpty}
            />
          ) : bannedPage.pageItems.map((u, i) => (
            <motion.div key={u.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
              <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3 sm:py-4 transition-colors ${deleteConfirmId === u.id ? 'bg-red-50/40' : 'hover:bg-red-50/20'}`}>
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-red-100 border border-red-200 flex items-center justify-center text-red-600 font-bold shrink-0 text-base">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-[130px] min-w-0 overflow-hidden">
                  <p className="font-semibold text-gray-900 text-[14px] sm:text-[15px] truncate">{u.name}</p>
                  <p className="text-[12px] sm:text-[13px] text-gray-400 truncate">
                    {u.id} · {u.role === 'student'
                      ? (groups.find((g) => g.id === u.group_id)?.name || '—')
                      : (u.kafedra_name || '—')}
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-semibold">
                      {ROLE_LABEL[String(u.role || '')] || u.role}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  {deleteConfirmId === u.id ? (
                    <>
                      <AdminBtn variant="red" size="sm" loading={deletingId === u.id} onClick={() => deleteUser(u.id)}>{t.adminDeleteBtn}</AdminBtn>
                      <AdminBtn variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>{t.cancel}</AdminBtn>
                    </>
                  ) : (
                    <>
                      <AdminBtn variant="emerald" size="sm" onClick={() => { setUnbanUser(u); setUnbanError(''); setDeleteConfirmId(null); }}>
                        {t.unban}
                      </AdminBtn>
                      <AdminBtn variant="red-ghost" size="sm" onClick={() => requestDeleteUser(u)}
                        icon={<svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}>
                        <span className="hidden sm:inline">{t.delete}</span>
                      </AdminBtn>
                    </>
                  )}
                </div>
              </div>
              <AnimatePresence>
                {deleteConfirmId === u.id && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="mx-5 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700 font-medium">
                      «{u.name}» ({u.id}) — {t.confirmDeleteUser}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
        <AdminPagination
          page={bannedPage.page}
          totalPages={bannedPage.totalPages}
          onPageChange={bannedPage.setPage}
          total={bannedPage.total}
          pageSize={bannedPage.pageSize}
        />
      </AdminCard>

      {/* Proctoring review queue */}
      <AdminCard title={t.reviewQueueTitle} count={reviewQueue.length} borderColor="border-indigo-200/60" headerBg="bg-indigo-50/30">
        <div className="px-5 py-4">
          {reviewQueue.length === 0 ? (
            <p className="text-[14px] text-indigo-400 py-2">{t.reviewQueueEmpty}</p>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {reviewQueue.map((q: any, idx: number) => (
                <div key={`${q.exam_id}-${q.student_id}-${idx}`}
                  className="text-[13px] px-3 py-2.5 rounded-xl bg-white border border-indigo-100 flex items-center justify-between gap-2 flex-wrap">
                  <span className="truncate text-gray-700 min-w-0 flex-1">{q.student_name} · {q.exam_title}</span>
                  <span className="text-[12px] text-gray-400 shrink-0">{q.status}</span>
                  <span className={`px-2 py-0.5 rounded-lg text-[12px] font-semibold shrink-0 ${q.sla_bucket === 'urgent' ? 'bg-red-100 text-red-700' : q.sla_bucket === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                    {q.sla_bucket}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <AdminBtn
                      size="sm"
                      variant="ghost"
                      loading={!!queueBusy[q.student_exam_id]}
                      onClick={() => queueAction(Number(q.student_exam_id), 'unblock')}
                    >
                      {lang === 'ru' ? 'Разблокировать' : lang === 'en' ? 'Unblock' : 'Blokdan chiqarish'}
                    </AdminBtn>
                    <AdminBtn
                      size="sm"
                      variant="red-ghost"
                      loading={!!queueBusy[q.student_exam_id]}
                      onClick={() => queueAction(Number(q.student_exam_id), 'retake')}
                    >
                      {lang === 'ru' ? 'Дать пересдачу' : lang === 'en' ? 'Allow retake' : 'Qayta imkon berish'}
                    </AdminBtn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminCard>

      {/* Ban appeals */}
      <AdminCard title={t.pendingAppealsTitle} count={appeals.length} borderColor="border-amber-200/60" headerBg="bg-amber-50/30">
        <div className="px-5 py-4">
          {appeals.length === 0 ? (
            <p className="text-[14px] text-amber-500 py-2">{t.pendingAppealsEmpty}</p>
          ) : (
            <div className="space-y-4">
              {appealsPage.pageItems.map((a) => {
                const note = appealNotes[a.id] ?? '';
                const busy = appealBusy[a.id] ?? false;
                return (
                  <div key={a.id} className="p-4 rounded-2xl border border-amber-200 bg-white space-y-3">
                    <div>
                      <p className="font-semibold text-gray-900 text-[15px]">{a.student_name} <span className="font-mono text-[13px] text-gray-400">({a.student_id})</span></p>
                      <p className="text-[13px] text-gray-500 mt-0.5">{a.exam_title || '—'} · {new Date(a.created_at).toLocaleString()}</p>
                    </div>
                    <p className="text-[14px] text-gray-700 border-l-2 border-amber-300 pl-3 whitespace-pre-wrap">{a.reason}</p>
                    <div className="space-y-2">
                      <AdminInput
                        placeholder={t.appealNoteOptional}
                        value={note}
                        onChange={(e) => setAppealNotes((p) => ({ ...p, [a.id]: e.target.value }))}
                        className="h-10 text-[14px]"
                      />
                      <div className="flex gap-2">
                        <AdminBtn variant="emerald" size="sm" disabled={busy} loading={busy} onClick={() => resolveAppeal(a.id, 'approve')} className="flex-1">
                          {t.appealApprove}
                        </AdminBtn>
                        <AdminBtn variant="red-ghost" size="sm" disabled={busy || !note.trim()} onClick={() => resolveAppeal(a.id, 'reject')} className="flex-1">
                          {t.appealReject}
                        </AdminBtn>
                      </div>
                      {!note.trim() && <p className="text-[12px] text-red-500">{t.appealNoteRequired}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <AdminPagination
          page={appealsPage.page}
          totalPages={appealsPage.totalPages}
          onPageChange={appealsPage.setPage}
          total={appealsPage.total}
          pageSize={appealsPage.pageSize}
        />
      </AdminCard>

      {/* Unban modal */}
      <AdminModal
        open={!!unbanUser}
        onClose={() => setUnbanUser(null)}
        title={unbanUser ? `${t.unban} — ${unbanUser.name}` : ''}
        titleClassName="text-emerald-700"
      >
        {unbanUser && (
          <>
            {unbanError && <AdminAlert type="error">{unbanError}</AdminAlert>}
            <form onSubmit={submitUnban} className="space-y-4">
                <div>
                  <AdminLabel required>{t.adminUnbanReason}</AdminLabel>
                  <AdminTextarea value={unbanReason} onChange={(e) => setUnbanReason(e.target.value)} required minLength={8} rows={3} className="min-h-[84px]" />
                  <p className="text-[12px] text-gray-400 mt-1">{unbanReason.length}/8 min</p>
                </div>
                <div>
                  <AdminLabel required>{t.adminUnbanEvidence} (JPG/PDF)</AdminLabel>
                  <AdminFileInput accept=".jpg,.jpeg,application/pdf,image/jpeg" required onChange={(e) => setUnbanFile(e.target.files?.[0] || null)} buttonText={t.filePick} placeholder={t.fileNone} />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <AdminBtn variant="ghost" onClick={() => setUnbanUser(null)}>{t.cancel}</AdminBtn>
                  <AdminBtn
                    type="submit"
                    variant="emerald"
                    loading={unbanBusy}
                    disabled={unbanBusy || unbanReason.trim().length < 8 || !unbanFile}
                  >
                    {t.unban}
                  </AdminBtn>
                </div>
            </form>
          </>
        )}
      </AdminModal>
    </div>
  );
}
