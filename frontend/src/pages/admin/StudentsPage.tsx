import React, { useCallback, useEffect, useState } from 'react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, parseAdminUsersList, checkAdminAuthResponse } from '../../lib/http';
import { fileToProfileImageBase64, ProfileImageError } from '../../lib/profileImage';
import {
  AdminInput, AdminSelect, AdminField, AdminBtn, AdminCard,
  AdminEmpty, AdminAlert, AdminModal, AdminFileInput, AdminPageMessageStack,
  AdminPagination, usePagedList, PlusIcon,
} from './ui';
import type { Group, StudentRow } from './types';

interface Props {
  token: string;
  lang: Language;
  initialGroupId?: number | null;
}

export function StudentsPage({ token, lang, initialGroupId }: Props) {
  const t = translations[lang];
  const h = authHeaders(token, lang);

  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState(initialGroupId ? String(initialGroupId) : '');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [addMsg, setAddMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [addError, setAddError] = useState('');
  const [addFormKey, setAddFormKey] = useState(0);
  const [pageMsg, setPageMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [selectedGroupForAdd, setSelectedGroupForAdd] = useState(initialGroupId ? String(initialGroupId) : '');

  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [editPhotoCurrent, setEditPhotoCurrent] = useState<string | null>(null);
  const [editPhotoPick, setEditPhotoPick] = useState<string | null>(null);
  const [editPhotoFile, setEditPhotoFile] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    const [rG, rS] = await Promise.all([
      fetch(apiUrl('/api/admin/groups'), { headers: h }),
      fetch(apiUrl('/api/admin/users?role=student'), { headers: h }),
    ]);
    if (!checkAdminAuthResponse(rG) || !checkAdminAuthResponse(rS)) { setLoading(false); return; }
    const jG = await readJsonSafe<Group[]>(rG);
    const jS = await readJsonSafe<unknown>(rS);
    setGroups(Array.isArray(jG) ? jG : []);
    setStudents(parseAdminUsersList<StudentRow>(jS));
    setLoading(false);
  }, [token]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (initialGroupId) {
      setGroupFilter(String(initialGroupId));
      setSelectedGroupForAdd(String(initialGroupId));
    }
  }, [initialGroupId]);

  const addStudent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAddError('');
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const profileFile = fd.get('profile_image') as File;
    if (!profileFile || profileFile.size === 0) { setAddError(t.profilePhotoRequiredStudent); return; }
    let b64: string;
    try { b64 = await fileToProfileImageBase64(profileFile); }
    catch (err) { setAddError(err instanceof ProfileImageError ? t.profilePhotoTooLarge : t.errorGeneric); return; }
    const res = await fetch(apiUrl('/api/admin/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({
        id: fd.get('id'), password: fd.get('password'), role: 'student',
        name: fd.get('name'), group_id: selectedGroupForAdd ? Number(selectedGroupForAdd) : null,
        profile_image: b64,
      }),
    });
    if (!checkAdminAuthResponse(res)) return;
    const d = await readJsonSafe<{ error?: string }>(res);
    if (!res.ok) { setAddError(d?.error || t.errorGeneric); return; }
    setAddFormKey((k) => k + 1);
    setSelectedGroupForAdd(initialGroupId ? String(initialGroupId) : '');
    setAddMsg({ type: 'ok', text: t.studentAddedOk });
    setTimeout(() => setAddMsg(null), 3000);
    reload();
  };

  const requestDelete = (u: StudentRow) => {
    setDeleteConfirmId(u.id);
    setEditing(null);
  };

  const deleteStudent = async (id: string) => {
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
    reload();
  };

  const openEdit = async (u: StudentRow) => {
    setEditError(''); setEditPhotoCurrent(null); setEditPhotoPick(null); setEditPhotoFile('');
    setEditing(u); setEditLoading(true);
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(u.id)}`), { headers: h });
    if (!checkAdminAuthResponse(res)) { setEditLoading(false); return; }
    const d = await readJsonSafe<StudentRow & { profile_image?: string }>(res);
    if (d) setEditPhotoCurrent(d.profile_image || null);
    setEditLoading(false);
  };

  const saveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || editSaving) return;
    setEditError('');
    const fd = new FormData(e.currentTarget);
    const pw = String(fd.get('password') || '').trim();
    if (pw && pw.length < 10) {
      setEditError(t.pwdMinPlaceholder);
      return;
    }
    const payload: Record<string, unknown> = {
      name: fd.get('name'), status: fd.get('status'),
      group_id: fd.get('group_id') ? Number(fd.get('group_id')) : null,
    };
    if (pw) payload.password = pw;
    if (editPhotoPick) payload.profile_image = editPhotoPick;
    setEditSaving(true);
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(editing.id)}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(payload),
    });
    if (!checkAdminAuthResponse(res)) { setEditSaving(false); return; }
    const d = await readJsonSafe<{ error?: string }>(res);
    setEditSaving(false);
    if (!res.ok) { setEditError(d?.error || t.errorGeneric); return; }
    setEditing(null);
    setPageMsg({ type: 'ok', text: t.studentEditedOk });
    setTimeout(() => setPageMsg(null), 3000);
    reload();
  };

  const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setEditError('');
    if (!f) { setEditPhotoPick(null); setEditPhotoFile(''); return; }
    try { const b64 = await fileToProfileImageBase64(f); setEditPhotoPick(b64); setEditPhotoFile(f.name); }
    catch (err) { setEditPhotoPick(null); setEditPhotoFile(''); e.target.value = ''; setEditError(err instanceof ProfileImageError ? t.profilePhotoTooLarge : t.errorGeneric); }
  };

  const filtered = students.filter((u) => {
    const q = search.toLowerCase();
    const matchQ = !q || u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
    const matchG = !groupFilter || String(u.group_id) === groupFilter;
    return matchQ && matchG;
  });
  const studentPage = usePagedList(filtered);

  return (
    <div className="space-y-5">
      <AdminPageMessageStack
        messages={[
          pageMsg,
          addMsg,
          addError ? { type: 'err', text: addError } : null,
        ]}
        onDismiss={(m) => {
          if (pageMsg && m.text === pageMsg.text && m.type === pageMsg.type) setPageMsg(null);
          else if (addMsg && m.text === addMsg.text && m.type === addMsg.type) setAddMsg(null);
          else setAddError('');
        }}
      />

      {/* ── Talaba qo'shish ── */}
      <AdminCard
        icon={<PlusIcon />}
        iconBg="bg-sky-600"
        title={t.kontingentAddStudent}
        subtitle={t.adminStudentAddSubtitle}
      >
        <div className="px-5 py-4 space-y-4">
          <form key={addFormKey} onSubmit={addStudent} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <AdminField label="ID" required>
                <AdminInput name="id" required placeholder="s001" />
              </AdminField>
              <AdminField label={t.userFullName} required>
                <AdminInput name="name" required placeholder={t.namePlaceholderExample} />
              </AdminField>
              <AdminField label={t.password} required>
                <AdminInput name="password" type="password" required minLength={10} autoComplete="new-password" placeholder={t.pwdMinPlaceholder} />
              </AdminField>
              <AdminField label={t.kontingentGroups}>
                <AdminSelect value={selectedGroupForAdd} onChange={(e) => setSelectedGroupForAdd(e.target.value)}>
                  <option value="">{t.allGroups}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.name} ({g.level_name}{g.direction_name ? ` · ${g.direction_name}` : ''})
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <AdminField label={`${t.profilePhotoLabel} *`} className="flex-1 min-w-[200px]">
                <AdminFileInput name="profile_image" accept="image/*" required buttonText={t.filePick} placeholder={t.fileNone} />
              </AdminField>
              <AdminBtn type="submit" variant="blue" size="lg" icon={<PlusIcon size={16} />}>
                {t.kontingentAddStudent}
              </AdminBtn>
            </div>
          </form>
        </div>
      </AdminCard>

      {/* ── Talabalar ro'yxati ── */}
      <AdminCard
        title={t.kontingentStudents}
        count={filtered.length}
        right={
          <span className="text-[13px] text-gray-400">/ {students.length}</span>
        }
      >
        {/* Search + filter */}
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex flex-wrap gap-2">
          <AdminInput
            placeholder={t.searchByNameOrId}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[160px] h-9 text-[13px]"
          />
          <AdminSelect
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="h-9 text-[13px] w-full sm:w-[170px]"
          >
            <option value="">{t.allGroups}</option>
            {groups.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
          </AdminSelect>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <AdminEmpty
            icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0112 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" /></svg>}
            title={t.studentsEmpty}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-[12px] font-semibold text-gray-400 uppercase tracking-wider">{t.adminStudentTableStudent}</th>
                  <th className="px-5 py-3 text-left text-[12px] font-semibold text-gray-400 uppercase tracking-wider">ID</th>
                  <th className="px-5 py-3 text-left text-[12px] font-semibold text-gray-400 uppercase tracking-wider">{t.kontingentGroups}</th>
                  <th className="px-5 py-3 text-left text-[12px] font-semibold text-gray-400 uppercase tracking-wider">{t.adminStudentTableStatus}</th>
                  <th className="px-5 py-3 text-right text-[12px] font-semibold text-gray-400 uppercase tracking-wider">{t.adminStudentTableActions}</th>
                </tr>
              </thead>
              <tbody>
                {studentPage.pageItems.map((u) => (
                  <tr key={u.id} className={`border-b border-gray-50 transition-colors ${deleteConfirmId === u.id ? 'bg-red-50/30' : u.status === 'Banned' ? 'bg-red-50/20 hover:bg-red-50/40' : 'hover:bg-gray-50/60'}`}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold shrink-0 ${u.has_photo ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-gray-900 text-[15px] truncate max-w-[140px]">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[13px] text-gray-500">{u.id}</td>
                      <td className="px-5 py-3.5 text-[14px] text-gray-600">
                        {(() => {
                          const g = groups.find((gr) => gr.id === u.group_id);
                          if (!g) return '—';
                          return g.direction_name ? `${g.name} · ${g.direction_name}` : g.name;
                        })()}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center text-[12px] px-2.5 py-0.5 rounded-full font-semibold ${u.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {u.status === 'Active' ? t.adminStatusActive : t.adminStatusBanned}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-end gap-2">
                          {deleteConfirmId === u.id ? (
                            <>
                              <AdminBtn variant="red" size="sm" loading={deletingId === u.id} onClick={() => deleteStudent(u.id)}>{t.adminDeleteBtn}</AdminBtn>
                              <AdminBtn variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>{t.cancel}</AdminBtn>
                            </>
                          ) : (
                            <>
                              <AdminBtn variant="ghost" size="sm" onClick={() => openEdit(u)}>{t.edit}</AdminBtn>
                              <AdminBtn variant="red-ghost" size="sm" onClick={() => requestDelete(u)}>{t.delete}</AdminBtn>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AdminPagination
          page={studentPage.page}
          totalPages={studentPage.totalPages}
          onPageChange={studentPage.setPage}
          total={studentPage.total}
          pageSize={studentPage.pageSize}
        />
      </AdminCard>

      {/* ── Edit modal ── */}
      <AdminModal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${t.editUser} — ${editing.name}` : ''}
        subtitle={editing ? `ID: ${editing.id}` : undefined}
      >
        {editing && (
          <>
            {editError && <AdminAlert type="error">{editError}</AdminAlert>}
            {editLoading ? (
                <p className="text-[14px] text-gray-400 text-center py-8">{t.loading}</p>
              ) : (
                <form onSubmit={saveEdit} className="space-y-4" autoComplete="off">
                  {/* Chrome parol formalarida "autocomplete=off" ni e'tiborsiz
                      qoldiradi va tasodifiy maydonlarga saqlangan login/parolni
                      yozib qo'yadi (masalan "Stavka" ga). Ko'rinmas soxta
                      maydonlar avtoto'ldirishni o'ziga tortadi. */}
                  <input type="text" name="fakeuser" autoComplete="username"
                    tabIndex={-1} aria-hidden className="hidden" />
                  <input type="password" name="fakepass" autoComplete="current-password"
                    tabIndex={-1} aria-hidden className="hidden" />
                  <AdminField label={t.userFullName}>
                    <AdminInput key={`nm-${editing.id}`} name="name"
                      defaultValue={editing.name} required autoComplete="off" />
                  </AdminField>
                  <AdminField label={t.userStatus}>
                    <AdminSelect key={`st-${editing.id}-${editing.status}`}
                      name="status" defaultValue={editing.status}>
                      <option value="Active">{t.adminStatusActive}</option>
                      <option value="Banned">{t.adminStatusBanned}</option>
                    </AdminSelect>
                  </AdminField>
                  <AdminField label={t.kontingentGroups}>
                    <AdminSelect key={`gr-${editing.id}-${editing.group_id ?? 'x'}`}
                      name="group_id" defaultValue={editing.group_id ?? ''}>
                      <option value="">{t.adminEditGroupEmpty}</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.level_name}{g.direction_name ? ` · ${g.direction_name}` : ''})
                        </option>
                      ))}
                    </AdminSelect>
                  </AdminField>
                  <AdminField label={t.newPasswordOptional}>
                    <AdminInput key={`pw-${editing.id}`} name="password" type="password"
                      minLength={10} autoComplete="new-password"
                      placeholder={t.adminPasswordPlaceholder} />
                  </AdminField>
                  <div>
                    <p className="text-[13px] font-medium text-gray-600 mb-1.5">{t.profilePhotoLabel}</p>
                    {editPhotoCurrent && (
                      <img src={editPhotoCurrent} alt="" className="w-16 h-16 rounded-2xl object-cover border border-gray-200 mb-2" />
                    )}
                    <AdminFileInput
                      key={editing.id}
                      accept="image/*"
                      onChange={onPhotoChange}
                      buttonText={t.filePick}
                      placeholder={t.fileNone}
                    />
                    {editPhotoPick && <p className="text-[12px] text-emerald-600 mt-1">✓ {editPhotoFile}</p>}
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <AdminBtn variant="ghost" onClick={() => setEditing(null)}>{t.cancel}</AdminBtn>
                    <AdminBtn type="submit" variant="violet" loading={editSaving || editLoading}>
                      {t.save}
                    </AdminBtn>
                  </div>
                </form>
            )}
          </>
        )}
      </AdminModal>
    </div>
  );
}
