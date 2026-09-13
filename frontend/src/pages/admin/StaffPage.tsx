import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, parseAdminUsersList, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminInput, AdminField, AdminBtn, AdminCard,
  AdminEmpty, AdminAlert, AdminPageMessageStack, AdminPagination, usePagedList, PlusIcon,
} from './ui';
import type { StudentRow } from './types';

interface Props { token: string; lang: Language; }

type Msg = { type: 'ok' | 'err'; text: string };

function usePasswordChange(token: string, lang: Language) {
  const h = authHeaders(token, lang);
  const [pwdId, setPwdId] = useState<string | null>(null);
  const [pwdValue, setPwdValue] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<Msg | null>(null);

  const startPwd = (id: string) => { setPwdId(id); setPwdValue(''); setPwdMsg(null); };
  const cancelPwd = () => { setPwdId(null); setPwdValue(''); setPwdMsg(null); };

  const savePwd = async (id: string, lang: Language) => {
    const t = translations[lang];
    if (pwdValue.length < 10) { setPwdMsg({ type: 'err', text: t.adminMinPasswordHint }); return; }
    setPwdSaving(true); setPwdMsg(null);
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ password: pwdValue }),
    });
    setPwdSaving(false);
    if (!checkAdminAuthResponse(res)) return;
    const d = await readJsonSafe<{ error?: string }>(res);
    if (!res.ok) { setPwdMsg({ type: 'err', text: d?.error || t.errorGeneric }); return; }
    setPwdMsg({ type: 'ok', text: t.pwdChangedOk });
    setTimeout(() => { setPwdId(null); setPwdValue(''); setPwdMsg(null); }, 1500);
  };

  return { pwdId, pwdValue, setPwdValue, pwdSaving, pwdMsg, startPwd, cancelPwd, savePwd };
}

// ── UserRow — module-level component so React never unmounts it on re-render ──
type UserRowProps = {
  u: StudentRow;
  lang: Language;
  pwdHook: ReturnType<typeof usePasswordChange>;
  isAdmin?: boolean;
  deleteConfirmId: string | null;
  deletingId: string | null;
  onRequestDelete: (id: string) => void;
  onCancelDelete: () => void;
  onDeleteUser: (id: string) => void;
};

function UserRow({ u, lang, pwdHook, isAdmin = false, deleteConfirmId, deletingId, onRequestDelete, onCancelDelete, onDeleteUser }: UserRowProps) {
  const t = translations[lang];
  const isPwdActive = pwdHook.pwdId === u.id;
  const isDeleteConfirm = deleteConfirmId === u.id;

  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3 sm:py-4 transition-colors ${isPwdActive || isDeleteConfirm ? 'bg-gray-50/80' : 'hover:bg-gray-50'}`}>
        <div className={`w-9 h-9 rounded-lg font-semibold flex items-center justify-center text-[15px] shrink-0 ${isAdmin ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
          {u.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-[140px] min-w-0 overflow-hidden">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-900 text-[14px] sm:text-[15px] truncate">{u.name}</p>
            {isAdmin && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 shrink-0">{t.adminRoleBadge}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono text-[12px] sm:text-[13px] text-gray-400 truncate">{u.id}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${u.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              {u.status === 'Active' ? t.adminStatusActive : t.adminStatusBanned}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDeleteConfirm ? (
            <>
              <AdminBtn variant="red" size="sm" loading={deletingId === u.id} onClick={() => onDeleteUser(u.id)}>
                {t.adminDeleteBtn}
              </AdminBtn>
              <AdminBtn variant="ghost" size="sm" onClick={onCancelDelete}>
                {t.cancel}
              </AdminBtn>
            </>
          ) : (
            <>
              <AdminBtn
                variant={isPwdActive ? 'amber' : 'ghost'}
                size="sm"
                onClick={() => isPwdActive ? pwdHook.cancelPwd() : pwdHook.startPwd(u.id)}
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                }
              >
                <span className="hidden sm:inline">{t.staffChangePassword}</span>
              </AdminBtn>
              <AdminBtn variant="red-ghost" size="sm" onClick={() => onRequestDelete(u.id)}>
                <span className="hidden sm:inline">{t.delete}</span>
                <span className="sm:hidden">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </span>
              </AdminBtn>
            </>
          )}
        </div>
      </div>

      {/* Delete confirm panel */}
      <AnimatePresence>
        {isDeleteConfirm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mx-5 mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700 font-medium">
              {t.userDeleteConfirm.replace('{name}', u.name).replace('{id}', u.id)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Password change panel */}
      <AnimatePresence>
        {isPwdActive && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mx-5 mb-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-[12px] font-semibold text-amber-700 mb-2">
                {t.adminPasswordChangeFor} {u.name}
              </p>
              {pwdHook.pwdMsg && (
                <div className="mb-2">
                  <AdminAlert type={pwdHook.pwdMsg.type === 'ok' ? 'success' : 'error'}>{pwdHook.pwdMsg.text}</AdminAlert>
                </div>
              )}
              <div className="flex items-center gap-2">
                <AdminInput
                  type="password"
                  value={pwdHook.pwdValue}
                  onChange={(e) => pwdHook.setPwdValue(e.target.value)}
                  placeholder={t.adminMinPasswordHint}
                  minLength={10}
                  autoFocus
                  autoComplete="new-password"
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') pwdHook.savePwd(u.id, lang);
                    if (e.key === 'Escape') pwdHook.cancelPwd();
                  }}
                />
                <AdminBtn variant="amber" size="sm" loading={pwdHook.pwdSaving} onClick={() => pwdHook.savePwd(u.id, lang)}>
                  {t.adminSaveShort}
                </AdminBtn>
                <AdminBtn variant="ghost" size="sm" onClick={pwdHook.cancelPwd}>
                  {t.cancel}
                </AdminBtn>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function StaffPage({ token, lang }: Props) {
  const t = translations[lang];
  const h = authHeaders(token, lang);

  const [staffList, setStaffList] = useState<StudentRow[]>([]);
  const [adminList, setAdminList] = useState<StudentRow[]>([]);
  const [staffMsg, setStaffMsg] = useState<Msg | null>(null);
  const [adminMsg, setAdminMsg] = useState<Msg | null>(null);
  const [pageMsg, setPageMsg] = useState<Msg | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'staff' | 'admin'>('staff');
  const [staffFormKey, setStaffFormKey] = useState(0);
  const [adminFormKey, setAdminFormKey] = useState(0);

  const staffPwd = usePasswordChange(token, lang);
  const adminPwd = usePasswordChange(token, lang);

  const reload = useCallback(async () => {
    const [rS, rA] = await Promise.all([
      fetch(apiUrl('/api/admin/users?role=staff'), { headers: h }),
      fetch(apiUrl('/api/admin/users?role=admin'), { headers: h }),
    ]);
    if (!checkAdminAuthResponse(rS) || !checkAdminAuthResponse(rA)) return;
    const jS = await readJsonSafe<unknown>(rS);
    const jA = await readJsonSafe<unknown>(rA);
    setStaffList(parseAdminUsersList<StudentRow>(jS));
    setAdminList(parseAdminUsersList<StudentRow>(jA));
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const addStaff = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStaffMsg(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch(apiUrl('/api/admin/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ id: fd.get('id'), password: fd.get('password'), role: 'staff', name: fd.get('name'), group_id: null }),
    });
    if (!checkAdminAuthResponse(res)) return;
    const d = await readJsonSafe<{ error?: string }>(res);
    if (!res.ok) { setStaffMsg({ type: 'err', text: d?.error || t.errorGeneric }); return; }
    setStaffFormKey((k) => k + 1);
    setStaffMsg({ type: 'ok', text: t.hodimAddedOk });
    setTimeout(() => setStaffMsg(null), 3000);
    reload();
  };

  const addAdmin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAdminMsg(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch(apiUrl('/api/admin/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({
        id: fd.get('id'), password: fd.get('password'), role: 'admin',
        name: fd.get('name'), group_id: null,
      }),
    });
    if (!checkAdminAuthResponse(res)) return;
    const d = await readJsonSafe<{ error?: string }>(res);
    if (!res.ok) { setAdminMsg({ type: 'err', text: d?.error || t.errorGeneric }); return; }
    setAdminFormKey((k) => k + 1);
    setAdminMsg({ type: 'ok', text: t.adminAdminCreatedOk });
    setTimeout(() => setAdminMsg(null), 3000);
    reload();
  };

  const requestDelete = (id: string) => {
    setDeleteConfirmId(id);
    staffPwd.cancelPwd();
    adminPwd.cancelPwd();
  };

  const deleteUser = async (id: string) => {
    setDeletingId(id);
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(id)}`), { method: 'DELETE', headers: h });
    setDeletingId(null);
    setDeleteConfirmId(null);
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      setPageMsg({ type: 'ok', text: t.staffDeletedOk });
      setTimeout(() => setPageMsg(null), 3000);
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      setPageMsg({ type: 'err', text: d?.error || t.errorGeneric });
    }
    reload();
  };

  const tabs = [
    { id: 'staff' as const, label: t.adminStaffTab, count: staffList.length },
    { id: 'admin' as const, label: t.adminAdminTab, count: adminList.length },
  ];
  const staffPage = usePagedList(staffList);
  const adminPage = usePagedList(adminList);

  const namePlaceholder = t.namePlaceholderExample;
  const pwdPlaceholder = t.pwdMinPlaceholder;

  return (
    <div className="space-y-3">
      <AdminPageMessageStack
        messages={[pageMsg, staffMsg, adminMsg]}
        onDismiss={(m) => {
          if (pageMsg && m.text === pageMsg.text) setPageMsg(null);
          else if (staffMsg && m.text === staffMsg.text) setStaffMsg(null);
          else setAdminMsg(null);
        }}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5 items-start">

        {/* ── Left: Add forms ── */}
        <div className="space-y-5">
          {/* Staff qo'shish */}
          <AdminCard icon={<PlusIcon />} title={t.addHodimCardTitle} subtitle={t.staffPortalSubtitle}>
            <div className="px-5 py-4 space-y-4">
              <form key={staffFormKey} onSubmit={addStaff} className="space-y-4">
                <AdminField label="ID" required>
                  <AdminInput name="id" required autoComplete="off" placeholder="staff001" />
                </AdminField>
                <AdminField label={t.userFullName} required>
                  <AdminInput name="name" required placeholder={namePlaceholder} />
                </AdminField>
                <AdminField label={t.password} required>
                  <AdminInput name="password" type="password" required minLength={10} autoComplete="new-password" placeholder={pwdPlaceholder} />
                </AdminField>
                <p className="text-[12px] text-gray-400">{t.addHodimHint}</p>
                <AdminBtn type="submit" variant="blue" size="lg" icon={<PlusIcon size={16} />} className="w-full">
                  {t.addHodimCardTitle}
                </AdminBtn>
              </form>
            </div>
          </AdminCard>

          {/* Admin qo'shish */}
          <AdminCard
            icon={<svg style={{width:18,height:18}} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>}
            title={t.adminAddUserTitle}
            subtitle={t.adminAdminSubtitle}
          >
            <div className="px-5 py-4 space-y-4">
              <form key={adminFormKey} onSubmit={addAdmin} className="space-y-4">
                <AdminField label="ID" required>
                  <AdminInput name="id" required autoComplete="off" placeholder="admin001" />
                </AdminField>
                <AdminField label={t.userFullName} required>
                  <AdminInput name="name" required placeholder={namePlaceholder} />
                </AdminField>
                <AdminField label={t.password} required>
                  <AdminInput name="password" type="password" required minLength={10} autoComplete="new-password" placeholder={pwdPlaceholder} />
                </AdminField>
                <AdminBtn type="submit" variant="violet" size="lg" icon={<PlusIcon size={16} />} className="w-full">
                  {t.adminCreateAdmin}
                </AdminBtn>
              </form>
            </div>
          </AdminCard>
        </div>

        {/* ── Right: Users list with tabs ── */}
        <AdminCard
          title={t.adminStaffListTitle}
          count={activeTab === 'staff' ? staffList.length : adminList.length}
          right={
            <div className="flex items-center h-8 bg-gray-100 rounded-lg p-0.5">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => { setActiveTab(tab.id); setDeleteConfirmId(null); staffPwd.cancelPwd(); adminPwd.cancelPwd(); }}
                  className={`h-full px-3 rounded-md text-[12px] font-semibold transition-colors ${activeTab === tab.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                >
                  {tab.label}
                  <span className={`ml-1.5 text-[11px] ${activeTab === tab.id ? 'text-indigo-400' : 'text-gray-400'}`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          }
        >
          <div className="divide-y divide-gray-100">
            {activeTab === 'staff' && (
              staffList.length === 0 ? (
                <AdminEmpty
                  icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6a4 4 0 11-8 0 4 4 0 018 0zM12 14v7" /></svg>}
                  title={t.staffListEmpty}
                />
              ) : staffPage.pageItems.map((u) => (
                <UserRow
                  key={u.id} u={u} lang={lang} pwdHook={staffPwd}
                  deleteConfirmId={deleteConfirmId} deletingId={deletingId}
                  onRequestDelete={requestDelete} onCancelDelete={() => setDeleteConfirmId(null)} onDeleteUser={deleteUser}
                />
              ))
            )}
            {activeTab === 'admin' && (
              adminList.length === 0 ? (
                <AdminEmpty
                  icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>}
                  title={t.adminAdminEmpty}
                />
              ) : adminPage.pageItems.map((u) => (
                <UserRow
                  key={u.id} u={u} lang={lang} pwdHook={adminPwd} isAdmin
                  deleteConfirmId={deleteConfirmId} deletingId={deletingId}
                  onRequestDelete={requestDelete} onCancelDelete={() => setDeleteConfirmId(null)} onDeleteUser={deleteUser}
                />
              ))
            )}
          </div>
          {activeTab === 'staff' ? (
            <AdminPagination
              page={staffPage.page}
              totalPages={staffPage.totalPages}
              onPageChange={staffPage.setPage}
              total={staffPage.total}
              pageSize={staffPage.pageSize}
            />
          ) : (
            <AdminPagination
              page={adminPage.page}
              totalPages={adminPage.totalPages}
              onPageChange={adminPage.setPage}
              total={adminPage.total}
              pageSize={adminPage.pageSize}
            />
          )}
        </AdminCard>
      </div>
    </div>
  );
}
