import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from '../components/ui';
import { translations, Language } from '../i18n';
import { AdminExamsTab } from './AdminExamsTab';
import { TestBankTab } from './TestBankTab';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';

function getViewerIdFromToken(token: string): string {
  try {
    return JSON.parse(atob(token.split('.')[1])).id as string;
  } catch {
    return '';
  }
}

export function AdminDashboard({ token, lang }: { token: string, lang: Language }) {
  const [users, setUsers] = useState([]);
  const [levels, setLevels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [stats, setStats] = useState({ totalUsers: 0, totalExams: 0, totalViolations: 0, bannedUsers: 0 });
  const [tab, setTab] = useState('stats');
  const [newUserRole, setNewUserRole] = useState('student');
  const [userFormError, setUserFormError] = useState('');
  const [editUser, setEditUser] = useState<any>(null);
  const [editUserSaving, setEditUserSaving] = useState(false);
  const [editUserErr, setEditUserErr] = useState('');
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('student');
  const [editGroupId, setEditGroupId] = useState<string>('');
  const [editStatus, setEditStatus] = useState('Active');
  const [editPassword, setEditPassword] = useState('');
  const [editGroup, setEditGroup] = useState<any>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editLevelId, setEditLevelId] = useState<string>('');
  const [editGroupSaving, setEditGroupSaving] = useState(false);
  const [editGroupErr, setEditGroupErr] = useState('');
  const t = translations[lang];
  const viewerId = getViewerIdFromToken(token);

  useEffect(() => {
    fetchData();
  }, [tab]);

  const fetchData = async () => {
    const headers = { Authorization: `Bearer ${token}` };
    if (tab === 'stats') {
      const res = await fetch(apiUrl('/api/admin/stats'), { headers });
      const j = await readJsonSafe<{
        totalUsers: number;
        totalExams: number;
        totalViolations: number;
        bannedUsers: number;
      }>(res);
      if (j) setStats(j);
    } else if (tab === 'users') {
      const res = await fetch(apiUrl('/api/admin/users'), { headers });
      const u = await readJsonSafe<any[]>(res);
      setUsers(Array.isArray(u) ? u : []);
      const res2 = await fetch(apiUrl('/api/admin/groups'), { headers });
      const g = await readJsonSafe<any[]>(res2);
      setGroups(Array.isArray(g) ? g : []);
    } else if (tab === 'groups') {
      const res1 = await fetch(apiUrl('/api/admin/levels'), { headers });
      const lv = await readJsonSafe<any[]>(res1);
      setLevels(Array.isArray(lv) ? lv : []);
      const res2 = await fetch(apiUrl('/api/admin/groups'), { headers });
      const g2 = await readJsonSafe<any[]>(res2);
      setGroups(Array.isArray(g2) ? g2 : []);
    }
  };

  const unbanUser = async (id: string) => {
    await fetch(apiUrl(`/api/admin/users/${id}/unban`), { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    fetchData();
  };

  const openEditUser = (u: any) => {
    setEditUser(u);
    setEditName(u.name || '');
    setEditRole(u.role || 'student');
    setEditGroupId(u.group_id != null ? String(u.group_id) : '');
    setEditStatus(u.status || 'Active');
    setEditPassword('');
    setEditUserErr('');
  };

  const saveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditUserSaving(true);
    setEditUserErr('');
    const fd = new FormData(e.target as HTMLFormElement);
    const file = fd.get('profile_file') as File;
    let profile_image: string | undefined;
    if (file && file.size > 0) {
      profile_image = (await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.readAsDataURL(file);
      })) as string;
    }
    const body: Record<string, unknown> = {
      name: editName,
      role: editRole,
      group_id: editGroupId === '' ? null : Number(editGroupId),
      status: editStatus,
    };
    if (editPassword.trim()) body.password = editPassword;
    if (profile_image) body.profile_image = profile_image;
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(editUser.id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setEditUserSaving(false);
    if (!res.ok) {
      setEditUserErr(data.error || 'Error');
      return;
    }
    setEditUser(null);
    fetchData();
  };

  const deleteUser = async (u: any) => {
    if (!window.confirm(t.confirmDeleteUser)) return;
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(u.id)}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Error');
      return;
    }
    fetchData();
  };

  const openEditGroup = (g: any) => {
    setEditGroup(g);
    setEditGroupName(g.name || '');
    setEditLevelId(String(g.level_id));
    setEditGroupErr('');
  };

  const saveEditGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editGroup) return;
    setEditGroupSaving(true);
    setEditGroupErr('');
    const res = await fetch(apiUrl(`/api/admin/groups/${editGroup.id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: editGroupName, level_id: Number(editLevelId) }),
    });
    const data = await res.json().catch(() => ({}));
    setEditGroupSaving(false);
    if (!res.ok) {
      setEditGroupErr(data.error || 'Error');
      return;
    }
    setEditGroup(null);
    fetchData();
  };

  const deleteGroup = async (g: any) => {
    if (!window.confirm(t.confirmDeleteGroup)) return;
    const res = await fetch(apiUrl(`/api/admin/groups/${g.id}`), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Error');
      return;
    }
    fetchData();
  };

  const addGroup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await fetch(apiUrl('/api/admin/groups'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: fd.get('name'), level_id: fd.get('level_id') }),
    });
    fetchData();
  };

  const addUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setUserFormError('');
    const fd = new FormData(e.currentTarget);
    const role = fd.get('role') as string;
    const profileFile = fd.get('profile_image') as File;
    let profileImageBase64 = null;

    if (role === 'student' && (!profileFile || profileFile.size === 0)) {
      setUserFormError(t.profilePhotoRequiredStudent);
      return;
    }

    if (profileFile && profileFile.size > 0) {
      profileImageBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(profileFile);
      });
    }

    const res = await fetch(apiUrl('/api/admin/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id: fd.get('id'),
        password: fd.get('password'),
        role,
        name: fd.get('name'),
        group_id: fd.get('group_id') || null,
        profile_image: profileImageBase64
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUserFormError(data.error || 'Error');
      return;
    }
    fetchData();
    (e.target as HTMLFormElement).reset();
    setNewUserRole('student');
  };

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const item: any = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
  };

  return (
    <div className="p-2 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap gap-3 mb-8 bg-white/30 backdrop-blur-xl p-2 rounded-full border border-white/50 shadow-sm w-fit">
        <Button variant={tab === 'stats' ? 'default' : 'ghost'} onClick={() => setTab('stats')} className={tab === 'stats' ? 'shadow-md' : ''}>{t.stats}</Button>
        <Button variant={tab === 'users' ? 'default' : 'ghost'} onClick={() => setTab('users')} className={tab === 'users' ? 'shadow-md' : ''}>{t.users}</Button>
        <Button variant={tab === 'groups' ? 'default' : 'ghost'} onClick={() => setTab('groups')} className={tab === 'groups' ? 'shadow-md' : ''}>{t.groups}</Button>
        <Button variant={tab === 'exams' ? 'default' : 'ghost'} onClick={() => setTab('exams')} className={tab === 'exams' ? 'shadow-md' : ''}>{t.exams}</Button>
        <Button variant={tab === 'testBank' ? 'default' : 'ghost'} onClick={() => setTab('testBank')} className={tab === 'testBank' ? 'shadow-md' : ''}>{t.testBank}</Button>
      </div>

      <motion.div variants={container} initial="hidden" animate="show" key={tab}>
        {tab === 'stats' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <motion.div variants={item}>
              <Card className="h-full hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-500">
                <CardHeader className="pb-2"><CardTitle className="text-gray-500 font-medium text-sm uppercase tracking-wider">{t.totalUsers}</CardTitle></CardHeader>
                <CardContent className="text-5xl font-bold tracking-tight text-gray-900">{stats.totalUsers}</CardContent>
              </Card>
            </motion.div>
            <motion.div variants={item}>
              <Card className="h-full hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-500">
                <CardHeader className="pb-2"><CardTitle className="text-gray-500 font-medium text-sm uppercase tracking-wider">{t.totalExams}</CardTitle></CardHeader>
                <CardContent className="text-5xl font-bold tracking-tight text-gray-900">{stats.totalExams}</CardContent>
              </Card>
            </motion.div>
            <motion.div variants={item}>
              <Card className="h-full hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-500">
                <CardHeader className="pb-2"><CardTitle className="text-gray-500 font-medium text-sm uppercase tracking-wider">{t.totalViolations}</CardTitle></CardHeader>
                <CardContent className="text-5xl font-bold tracking-tight text-orange-500">{stats.totalViolations}</CardContent>
              </Card>
            </motion.div>
            <motion.div variants={item}>
              <Card className="h-full hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-500">
                <CardHeader className="pb-2"><CardTitle className="text-gray-500 font-medium text-sm uppercase tracking-wider">{t.bannedUsers}</CardTitle></CardHeader>
                <CardContent className="text-5xl font-bold tracking-tight text-red-600">{stats.bannedUsers}</CardContent>
              </Card>
            </motion.div>
          </div>
        )}

        {tab === 'users' && (
          <div className="space-y-8">
            <motion.div variants={item}>
              <Card>
                <CardHeader><CardTitle>Add New User</CardTitle></CardHeader>
                <CardContent>
                  {userFormError && (
                    <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{userFormError}</div>
                  )}
                  <form onSubmit={addUser} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                    <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700 ml-1">ID</label><Input name="id" required placeholder="User ID" /></div>
                    <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700 ml-1">Name</label><Input name="name" required placeholder="Full Name" /></div>
                    <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700 ml-1">Password</label><Input name="password" type="password" required placeholder="••••••••" /></div>
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-gray-700 ml-1">Role</label>
                      <select
                        name="role"
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value)}
                        className="flex h-12 w-full rounded-2xl border border-white/50 bg-white/50 backdrop-blur-xl px-4 py-2 text-sm text-gray-900 shadow-inner focus:outline-none focus:ring-2 focus:ring-black/10 focus:bg-white/80 transition-all duration-300"
                        required
                      >
                        <option value="student">Student</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-gray-700 ml-1">Group (Students)</label>
                      <select name="group_id" className="flex h-12 w-full rounded-2xl border border-white/50 bg-white/50 backdrop-blur-xl px-4 py-2 text-sm text-gray-900 shadow-inner focus:outline-none focus:ring-2 focus:ring-black/10 focus:bg-white/80 transition-all duration-300">
                        <option value="">None</option>
                        {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name} ({g.level_name})</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-gray-700 ml-1">
                        {t.profilePhotoLabel}
                        {newUserRole === 'student' && <span className="text-red-500"> *</span>}
                      </label>
                      <Input
                        name="profile_image"
                        type="file"
                        accept="image/*"
                        className="h-12 pt-2"
                        required={newUserRole === 'student'}
                      />
                    </div>
                    <div className="lg:col-span-5 flex justify-end mt-2">
                      <Button type="submit">Create User</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
            
            <motion.div variants={item}>
              <Card className="overflow-hidden">
                <CardHeader className="bg-white/30 border-b border-white/40"><CardTitle>{t.users}</CardTitle></CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-black/5 text-gray-600 text-sm uppercase tracking-wider">
                        <th className="p-4 font-medium">Photo</th>
                        <th className="p-4 font-medium">ID</th>
                        <th className="p-4 font-medium">Name</th>
                        <th className="p-4 font-medium">Role</th>
                        <th className="p-4 font-medium">Group</th>
                        <th className="p-4 font-medium">Status</th>
                        <th className="p-4 font-medium text-right">{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {users.map((u: any) => (
                        <tr key={u.id} className="hover:bg-white/40 transition-colors">
                          <td className="p-4">
                            {u.profile_image ? (
                              <img src={u.profile_image} alt={u.name} className="w-10 h-10 rounded-full object-cover border border-white/50 shadow-sm" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-400">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                              </div>
                            )}
                          </td>
                          <td className="p-4 font-medium text-gray-900">{u.id}</td>
                          <td className="p-4">{u.name}</td>
                          <td className="p-4 capitalize">
                            <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="p-4">{u.group_name || <span className="text-gray-400">-</span>}</td>
                          <td className="p-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${u.status === 'Banned' ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-green-100 text-green-800 border border-green-200'}`}>
                              {u.status}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex flex-wrap gap-1 justify-end">
                              <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => openEditUser(u)}>
                                {t.edit}
                              </Button>
                              {u.id !== viewerId && (
                                <Button size="sm" variant="outline" className="h-8 px-2 text-xs text-red-600 border-red-200" onClick={() => deleteUser(u)}>
                                  {t.delete}
                                </Button>
                              )}
                              {u.status === 'Banned' && (
                                <Button size="sm" variant="outline" onClick={() => unbanUser(u.id)} className="h-8 px-2 text-xs border-red-200 text-red-600 hover:bg-red-50">
                                  {t.unban}
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </motion.div>
          </div>
        )}

        {tab === 'exams' && <AdminExamsTab token={token} lang={lang} />}

        {tab === 'testBank' && <TestBankTab token={token} lang={lang} />}

        {tab === 'groups' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <motion.div variants={item} className="lg:col-span-1">
              <Card>
                <CardHeader><CardTitle>Create Group</CardTitle></CardHeader>
                <CardContent>
                  <form onSubmit={addGroup} className="space-y-5">
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-gray-700 ml-1">Level</label>
                      <select name="level_id" className="flex h-12 w-full rounded-2xl border border-white/50 bg-white/50 backdrop-blur-xl px-4 py-2 text-sm text-gray-900 shadow-inner focus:outline-none focus:ring-2 focus:ring-black/10 focus:bg-white/80 transition-all duration-300" required>
                        {levels.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-gray-700 ml-1">Group Name</label>
                      <Input name="name" required placeholder="e.g. 101-A" />
                    </div>
                    <Button type="submit" className="w-full mt-2">Add Group</Button>
                  </form>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={item} className="lg:col-span-2">
              <Card className="h-full">
                <CardHeader className="bg-white/30 border-b border-white/40"><CardTitle>{t.groups}</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y divide-black/5">
                    {groups.map((g: any) => (
                      <li key={g.id} className="p-4 flex flex-wrap justify-between items-center gap-2 hover:bg-white/40 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold shrink-0">
                            {g.name.charAt(0)}
                          </div>
                          <span className="font-semibold text-gray-900 text-lg truncate">{g.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-gray-600 bg-white/50 border border-white/60 px-3 py-1 rounded-lg text-sm font-medium shadow-sm">
                            {g.level_name}
                          </span>
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openEditGroup(g)}>
                            {t.edit}
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-200" onClick={() => deleteGroup(g)}>
                            {t.delete}
                          </Button>
                        </div>
                      </li>
                    ))}
                    {groups.length === 0 && (
                      <li className="p-8 text-center text-gray-500">No groups found.</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        )}
      </motion.div>

      {editUser && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setEditUser(null)}
        >
          <Card className="max-w-lg w-full shadow-2xl border border-white/40" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t.editUser}</CardTitle>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditUser(null)}>
                {t.cancel}
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveEditUser} className="space-y-4">
                {editUserErr && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{editUserErr}</div>}
                <p className="text-sm text-gray-500">
                  ID: <span className="font-mono font-medium text-gray-800">{editUser.id}</span>
                </p>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.userFullName}</label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1" required />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.userRole}</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                    className="mt-1 flex h-12 w-full rounded-2xl border border-white/50 bg-white/50 px-4 py-2 text-sm"
                  >
                    <option value="student">Student</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.groups}</label>
                  <select
                    value={editGroupId}
                    onChange={(e) => setEditGroupId(e.target.value)}
                    className="mt-1 flex h-12 w-full rounded-2xl border border-white/50 bg-white/50 px-4 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {groups.map((g: any) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.level_name})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.userStatus}</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="mt-1 flex h-12 w-full rounded-2xl border border-white/50 bg-white/50 px-4 py-2 text-sm"
                  >
                    <option value="Active">Active</option>
                    <option value="Banned">Banned</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.newPasswordOptional}</label>
                  <Input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} className="mt-1" autoComplete="new-password" />
                </div>
                {editRole === 'student' && (
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      {t.profilePhotoLabel} <span className="text-gray-400 font-normal">({t.keepPhoto})</span>
                    </label>
                    <Input name="profile_file" type="file" accept="image/*" className="mt-1 h-12 pt-2" />
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={editUserSaving}>
                    {editUserSaving ? '…' : t.save}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
                    {t.cancel}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {editGroup && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setEditGroup(null)}
        >
          <Card className="max-w-md w-full shadow-2xl border border-white/40" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t.editGroup}</CardTitle>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditGroup(null)}>
                {t.cancel}
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveEditGroup} className="space-y-4">
                {editGroupErr && <div className="text-sm text-red-700 bg-red-50 border rounded-xl px-3 py-2">{editGroupErr}</div>}
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.groupName}</label>
                  <Input value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} className="mt-1" required />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t.levelLabel}</label>
                  <select
                    value={editLevelId}
                    onChange={(e) => setEditLevelId(e.target.value)}
                    className="mt-1 flex h-12 w-full rounded-2xl border border-white/50 bg-white/50 px-4 py-2 text-sm"
                    required
                  >
                    {levels.map((l: any) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={editGroupSaving}>
                    {editGroupSaving ? '…' : t.save}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setEditGroup(null)}>
                    {t.cancel}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
