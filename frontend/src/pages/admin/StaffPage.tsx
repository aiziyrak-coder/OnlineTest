import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, parseAdminUsersList, checkAdminAuthResponse } from '../../lib/http';
import { AdminAlert, AdminBtn, AdminEmpty, AdminField, AdminInput, AdminModal, AdminPageMessage } from './ui';
import type { AdminPageMsg } from './ui';
import type { StudentRow } from './types';

interface Props { token: string; lang: Language; }

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

type Role = 'staff' | 'admin';

/** Xodimlar — kuzatuvchilar (staff) va administratorlar, bitta jadval. */
export function StaffPage({ token, lang }: Props) {
  const t = translations[lang];
  const h = useMemo(() => authHeaders(token, lang), [token, lang]);

  const [staff, setStaff] = useState<StudentRow[]>([]);
  const [admins, setAdmins] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Role>('staff');
  const [msg, setMsg] = useState<AdminPageMsg | null>(null);

  const [addRole, setAddRole] = useState<Role | null>(null);
  const [addErr, setAddErr] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [pwFor, setPwFor] = useState<StudentRow | null>(null);
  const [pwValue, setPwValue] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [confirmDel, setConfirmDel] = useState<StudentRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [rS, rA] = await Promise.all([
        fetch(apiUrl('/api/admin/users?role=staff&limit=500'), { headers: h }),
        fetch(apiUrl('/api/admin/users?role=admin&limit=500'), { headers: h }),
      ]);
      if (!checkAdminAuthResponse(rS) || !checkAdminAuthResponse(rA)) return;
      const [jS, jA] = await Promise.all([readJsonSafe<unknown>(rS), readJsonSafe<unknown>(rA)]);
      setStaff(parseAdminUsersList<StudentRow>(jS));
      setAdmins(parseAdminUsersList<StudentRow>(jA));
    } finally {
      setLoading(false);
    }
  }, [h]);

  useEffect(() => { reload(); }, [reload]);

  const list = tab === 'staff' ? staff : admins;

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!addRole) return;
    const fd = new FormData(e.currentTarget);
    setAddBusy(true);
    setAddErr('');
    try {
      const res = await fetch(apiUrl('/api/admin/users'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ id: fd.get('id'), password: fd.get('password'), role: addRole, name: fd.get('name'), group_id: null }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) { setAddErr(d?.error || t.errorGeneric); return; }
      setMsg({ type: 'ok', text: addRole === 'staff' ? t.hodimAddedOk : t.adminAdminCreatedOk });
      setTab(addRole);
      setAddRole(null);
      reload();
    } finally {
      setAddBusy(false);
    }
  };

  const savePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwFor) return;
    if (pwValue.length < 10) { setPwErr(t.adminMinPasswordHint); return; }
    setPwBusy(true);
    setPwErr('');
    try {
      const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(pwFor.id)}`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ password: pwValue }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) { setPwErr(d?.error || t.errorGeneric); return; }
      setMsg({ type: 'ok', text: t.pwdChangedOk });
      setPwFor(null);
      setPwValue('');
    } finally {
      setPwBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmDel) return;
    setDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(confirmDel.id)}`), { method: 'DELETE', headers: h });
      if (!checkAdminAuthResponse(res)) return;
      if (res.ok) setMsg({ type: 'ok', text: t.staffDeletedOk });
      else {
        const d = await readJsonSafe<{ error?: string }>(res);
        setMsg({ type: 'err', text: d?.error || t.errorGeneric });
      }
      reload();
    } finally {
      setDeleting(false);
      setConfirmDel(null);
    }
  };

  const tabs: Array<[Role, string, number]> = [
    ['staff', t.adminStaffTab, staff.length],
    ['admin', t.adminAdminTab, admins.length],
  ];

  return (
    <div className="space-y-4">
      <AdminPageMessage message={msg} onDismiss={() => setMsg(null)} />

      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 px-3 sm:px-4">
          <div className="-mb-px flex" role="tablist">
            {tabs.map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`whitespace-nowrap border-b-2 px-3 py-3.5 text-[13.5px] font-semibold transition-colors ${
                  tab === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {label}
                <span className={`ml-1.5 rounded-full px-1.5 py-px text-[11.5px] tabular-nums ${tab === k ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>{n}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 py-2">
            <AdminBtn variant="ghost" size="sm" onClick={() => { setAddErr(''); setAddRole('admin'); }}>+ {t.adminCreateAdmin}</AdminBtn>
            <AdminBtn size="sm" onClick={() => { setAddErr(''); setAddRole('staff'); }}>+ {t.addHodimCardTitle}</AdminBtn>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead className="bg-gray-50/80 text-[12px] text-gray-500">
              <tr className="border-b border-gray-200 text-left">
                <th className="px-4 py-2.5 font-semibold">{t.userFullName}</th>
                <th className="px-4 py-2.5 font-semibold">ID</th>
                <th className="px-4 py-2.5 font-semibold">{t.adminStudentTableStatus}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50/70">
                  <td className="border-b border-gray-100 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${tab === 'admin' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700'}`}>
                        {(u.name || '?').charAt(0).toUpperCase()}
                      </span>
                      <span className="font-semibold text-gray-900">{u.name}</span>
                      {tab === 'admin' ? <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700">{t.adminRoleBadge}</span> : null}
                    </div>
                  </td>
                  <td className="border-b border-gray-100 px-4 py-3 font-mono text-[12.5px] text-gray-500">{u.id}</td>
                  <td className="border-b border-gray-100 px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${u.status === 'Active' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-red-50 text-red-700 ring-red-600/15'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${u.status === 'Active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      {u.status === 'Active' ? t.adminStatusActive : t.adminStatusBanned}
                    </span>
                  </td>
                  <td className="border-b border-gray-100 px-4 py-3 text-right whitespace-nowrap">
                    <AdminBtn variant="ghost" size="sm" onClick={() => { setPwErr(''); setPwValue(''); setPwFor(u); }}>{t.staffChangePassword}</AdminBtn>
                    <AdminBtn variant="red-ghost" size="sm" className="ml-2" onClick={() => setConfirmDel(u)}>{t.delete}</AdminBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && list.length === 0 ? <AdminEmpty title={tab === 'staff' ? t.staffListEmpty : t.adminAdminEmpty} /> : null}
        </div>
      </section>

      <AdminModal
        open={!!addRole}
        onClose={() => setAddRole(null)}
        title={addRole === 'admin' ? t.adminAddUserTitle : t.addHodimCardTitle}
        subtitle={addRole === 'admin' ? t.adminAdminSubtitle : t.staffPortalSubtitle}
      >
        {addRole ? (
          <form key={addRole} onSubmit={add} className="space-y-4" autoComplete="off">
            {addErr ? <AdminAlert type="error">{addErr}</AdminAlert> : null}
            <AdminField label="ID" required><AdminInput name="id" required autoComplete="off" placeholder={addRole === 'admin' ? 'admin001' : 'staff001'} /></AdminField>
            <AdminField label={t.userFullName} required><AdminInput name="name" required placeholder={t.namePlaceholderExample} /></AdminField>
            <AdminField label={t.password} required>
              <AdminInput name="password" type="password" required minLength={10} autoComplete="new-password" placeholder={t.pwdMinPlaceholder} />
            </AdminField>
            {addRole === 'staff' ? <p className="text-[12.5px] text-gray-500">{t.addHodimHint}</p> : null}
            <div className="flex justify-end gap-2">
              <AdminBtn variant="ghost" onClick={() => setAddRole(null)}>{t.cancel}</AdminBtn>
              <AdminBtn type="submit" loading={addBusy}>{addRole === 'admin' ? t.adminCreateAdmin : t.addHodimCardTitle}</AdminBtn>
            </div>
          </form>
        ) : null}
      </AdminModal>

      <AdminModal open={!!pwFor} onClose={() => setPwFor(null)} title={t.staffChangePassword} subtitle={pwFor ? `${t.adminPasswordChangeFor} ${pwFor.name}` : undefined}>
        {pwFor ? (
          <form onSubmit={savePw} className="space-y-4" autoComplete="off">
            <input type="text" name="fakeuser" autoComplete="username" tabIndex={-1} aria-hidden className="hidden" />
            {pwErr ? <AdminAlert type="error">{pwErr}</AdminAlert> : null}
            <AdminInput type="password" autoFocus minLength={10} autoComplete="new-password" value={pwValue} onChange={(e) => setPwValue(e.target.value)} placeholder={t.adminMinPasswordHint} />
            <div className="flex justify-end gap-2">
              <AdminBtn variant="ghost" onClick={() => setPwFor(null)}>{t.cancel}</AdminBtn>
              <AdminBtn type="submit" loading={pwBusy}>{t.adminSaveShort}</AdminBtn>
            </div>
          </form>
        ) : null}
      </AdminModal>

      <AdminModal open={!!confirmDel} onClose={() => setConfirmDel(null)} title={t.delete}>
        {confirmDel ? (
          <div className="space-y-4">
            <p className="text-[14px] text-gray-700">{t.userDeleteConfirm.replace('{name}', confirmDel.name).replace('{id}', confirmDel.id)}</p>
            <div className="flex justify-end gap-2">
              <AdminBtn variant="ghost" onClick={() => setConfirmDel(null)}>{t.cancel}</AdminBtn>
              <AdminBtn variant="red" loading={deleting} onClick={remove}>{t.adminDeleteBtn}</AdminBtn>
            </div>
          </div>
        ) : null}
      </AdminModal>
    </div>
  );
}
