import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from '../components/ui';
import { translations, Language } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';

type Level = { id: number; name: string };
type Group = {
  id: number;
  name: string;
  level_id: number;
  level_name: string;
  program_track?: string;
  academic_year?: number | null;
};
type StudentRow = {
  id: string;
  name: string;
  role: string;
  status: string;
  group_id: number | null;
  profile_image?: string;
  group_name?: string | null;
};

export function KontingentTab({ token, lang }: { token: string; lang: Language }) {
  const t = translations[lang];
  const h = { Authorization: `Bearer ${token}` };
  const [stats, setStats] = useState({ totalUsers: 0, totalExams: 0, totalViolations: 0, bannedUsers: 0 });
  const [levels, setLevels] = useState<Level[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [view, setView] = useState<'levels' | 'groups' | 'students'>('levels');
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [newLevelName, setNewLevelName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newTrack, setNewTrack] = useState('bachelor');
  const [newYear, setNewYear] = useState('');
  const [userFormError, setUserFormError] = useState('');
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [unbanUser, setUnbanUser] = useState<StudentRow | null>(null);
  const [unbanReason, setUnbanReason] = useState('');
  const [unbanFile, setUnbanFile] = useState<File | null>(null);
  const [banList, setBanList] = useState<StudentRow[]>([]);

  const loadStats = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/stats'), { headers: h });
    const j = await readJsonSafe<typeof stats>(res);
    if (j) setStats(j);
  }, [token]);

  const loadLevels = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/levels'), { headers: h });
    const j = await readJsonSafe<Level[]>(res);
    setLevels(Array.isArray(j) ? j : []);
  }, [token]);

  const loadGroups = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/groups'), { headers: h });
    const j = await readJsonSafe<Group[]>(res);
    setGroups(Array.isArray(j) ? j : []);
  }, [token]);

  const loadStudents = useCallback(
    async (groupId: number) => {
      const res = await fetch(apiUrl(`/api/admin/users?group_id=${groupId}&role=student`), { headers: h });
      const j = await readJsonSafe<StudentRow[]>(res);
      setStudents(Array.isArray(j) ? j : []);
    },
    [token],
  );

  const loadBanned = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/users?role=student&status=Banned'), { headers: h });
    const j = await readJsonSafe<StudentRow[]>(res);
    setBanList(Array.isArray(j) ? j : []);
  }, [token]);

  useEffect(() => {
    loadStats();
    loadLevels();
    loadGroups();
    loadBanned();
  }, [loadStats, loadLevels, loadGroups, loadBanned]);

  useEffect(() => {
    if (view === 'students' && selectedGroup) {
      loadStudents(selectedGroup.id);
    }
  }, [view, selectedGroup, loadStudents]);

  const groupsInLevel = selectedLevel ? groups.filter((g) => g.level_id === selectedLevel.id) : [];

  const addLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(apiUrl('/api/admin/levels'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ name: newLevelName.trim() }),
    });
    if (res.ok) {
      setNewLevelName('');
      loadLevels();
    }
  };

  const addGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLevel) return;
    const body: Record<string, unknown> = {
      name: newGroupName.trim(),
      level_id: selectedLevel.id,
      program_track: newTrack,
    };
    if (newYear.trim()) body.academic_year = Number(newYear);
    const res = await fetch(apiUrl('/api/admin/groups'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setNewGroupName('');
      loadGroups();
    }
  };

  const addUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setUserFormError('');
    const fd = new FormData(e.currentTarget);
    const role = 'student';
    const profileFile = fd.get('profile_image') as File;
    let profileImageBase64 = null;
    if (role === 'student' && (!profileFile || profileFile.size === 0)) {
      setUserFormError(t.profilePhotoRequiredStudent);
      return;
    }
    if (profileFile && profileFile.size > 0) {
      profileImageBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(profileFile);
      });
    }
    const res = await fetch(apiUrl('/api/admin/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({
        id: fd.get('id'),
        password: fd.get('password'),
        role,
        name: fd.get('name'),
        group_id: selectedGroup ? selectedGroup.id : null,
        profile_image: profileImageBase64,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUserFormError(data.error || 'Error');
      return;
    }
    if (selectedGroup) loadStudents(selectedGroup.id);
    loadStats();
    loadBanned();
    e.currentTarget.reset();
  };

  const deleteUser = async (u: StudentRow) => {
    if (!confirm(`${u.name} (${u.id}) ni o'chirasizmi?`)) return;
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(u.id)}`), {
      method: 'DELETE',
      headers: h,
    });
    if (!res.ok) return;
    if (selectedGroup) loadStudents(selectedGroup.id);
    loadStats();
    loadBanned();
  };

  const saveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const payload: any = {
      name: fd.get('name'),
      status: fd.get('status'),
      password: fd.get('password') || undefined,
    };
    const file = fd.get('profile_image') as File;
    if (file && file.size > 0) {
      payload.profile_image = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.readAsDataURL(file);
      });
    }
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(editing.id)}`), {
      method: 'PATCH',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    setEditing(null);
    if (selectedGroup) loadStudents(selectedGroup.id);
    loadStats();
    loadBanned();
  };

  const submitUnban = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unbanUser || !unbanFile) return;
    const fd = new FormData();
    fd.append('reason', unbanReason.trim());
    fd.append('evidence', unbanFile);
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(unbanUser.id)}/unban`), {
      method: 'POST',
      headers: h,
      body: fd,
    });
    const data = await readJsonSafe<{ error?: string }>(res);
    if (!res.ok) {
      alert(data?.error || 'Unban failed');
      return;
    }
    setUnbanUser(null);
    setUnbanReason('');
    setUnbanFile(null);
    if (selectedGroup) loadStudents(selectedGroup.id);
    loadStats();
    loadBanned();
  };

  const item = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 26 } },
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          [t.totalUsers, stats.totalUsers],
          [t.totalExams, stats.totalExams],
          [t.totalViolations, stats.totalViolations],
          [t.bannedUsers, stats.bannedUsers],
        ].map(([label, val]) => (
          <Card key={String(label)} className="border-white/50 bg-white/40 backdrop-blur">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{val as number}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <Button
          type="button"
          variant={view === 'levels' ? 'default' : 'outline'}
          size="sm"
          className="rounded-full"
          onClick={() => {
            setView('levels');
            setSelectedLevel(null);
            setSelectedGroup(null);
          }}
        >
          {t.kontingentLevels}
        </Button>
        {selectedLevel && (
          <>
            <span className="text-gray-400">/</span>
            <Button
              type="button"
              variant={view === 'groups' ? 'default' : 'outline'}
              size="sm"
              className="rounded-full"
              onClick={() => {
                setView('groups');
                setSelectedGroup(null);
              }}
            >
              {selectedLevel.name}
            </Button>
          </>
        )}
        {selectedGroup && (
          <>
            <span className="text-gray-400">/</span>
            <Button type="button" variant={view === 'students' ? 'default' : 'outline'} size="sm" className="rounded-full">
              {selectedGroup.name}
            </Button>
          </>
        )}
      </div>

      {view === 'levels' && (
        <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle>{t.kontingentAddLevel}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={addLevel} className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-sm text-gray-600 block mb-1">{t.levelLabel}</label>
                    <Input value={newLevelName} onChange={(e) => setNewLevelName(e.target.value)} placeholder="1-kurs" required />
                  </div>
                  <Button type="submit">{t.kontingentAddLevel}</Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={item} className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{t.kontingentLevels}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {levels.map((lv) => (
                  <button
                    key={lv.id}
                    type="button"
                    className="w-full text-left p-4 rounded-2xl border border-white/50 bg-white/30 hover:bg-white/50 transition flex justify-between items-center"
                    onClick={() => {
                      setSelectedLevel(lv);
                      setView('groups');
                    }}
                  >
                    <span className="font-semibold text-gray-900">{lv.name}</span>
                    <span className="text-xs text-gray-500">{groups.filter((g) => g.level_id === lv.id).length} {t.kontingentGroups}</span>
                  </button>
                ))}
                {levels.length === 0 && <p className="text-gray-500 text-sm text-center py-6">—</p>}
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={item} className="mt-6">
            <Card className="border-dashed border-amber-200/80 bg-amber-50/20">
              <CardHeader>
                <CardTitle className="text-base">Admin foydalanuvchi (ixtiyoriy)</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const res = await fetch(apiUrl('/api/admin/users'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({
                        id: fd.get('id'),
                        password: fd.get('password'),
                        role: 'admin',
                        name: fd.get('name'),
                        group_id: null,
                        profile_image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                      }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok) {
                      loadStats();
                      (e.target as HTMLFormElement).reset();
                    } else {
                      alert(data.error || 'Error');
                    }
                  }}
                  className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
                >
                  <div>
                    <label className="text-sm text-gray-600">ID</label>
                    <Input name="id" required className="mt-1" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">{t.userFullName}</label>
                    <Input name="name" required className="mt-1" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">{t.password}</label>
                    <Input name="password" type="password" required className="mt-1" />
                  </div>
                  <Button type="submit" className="sm:col-span-3 w-full sm:w-auto">
                    Admin yaratish
                  </Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {view === 'groups' && selectedLevel && (
        <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle>
                  {t.kontingentAddGroup} — {selectedLevel.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={addGroup} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="text-sm text-gray-600 block mb-1">{t.groupName}</label>
                    <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} required />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600 block mb-1">{t.programTrack}</label>
                    <select
                      value={newTrack}
                      onChange={(e) => setNewTrack(e.target.value)}
                      className="w-full h-12 rounded-2xl border border-white/50 bg-white/50 px-3 text-sm"
                    >
                      <option value="bachelor">bachelor</option>
                      <option value="residency">residency</option>
                      <option value="master">master</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-gray-600 block mb-1">{t.academicYear}</label>
                    <Input value={newYear} onChange={(e) => setNewYear(e.target.value)} placeholder="1–6" type="number" min={1} max={6} />
                  </div>
                  <Button type="submit">{t.kontingentAddGroup}</Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={item} className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{t.kontingentGroups}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {groupsInLevel.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="w-full text-left p-4 rounded-2xl border border-white/50 bg-white/30 hover:bg-white/50 transition"
                    onClick={() => {
                      setSelectedGroup(g);
                      setView('students');
                    }}
                  >
                    <p className="font-semibold text-gray-900">{g.name}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {g.program_track || 'bachelor'}
                      {g.academic_year != null ? ` · ${t.academicYear}: ${g.academic_year}` : ''}
                    </p>
                  </button>
                ))}
                {groupsInLevel.length === 0 && <p className="text-gray-500 text-sm text-center py-6">—</p>}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {view === 'students' && selectedGroup && (
        <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle>
                  {t.kontingentAddStudent} — {selectedGroup.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {userFormError && <div className="mb-3 text-sm text-red-700 bg-red-50 border rounded-xl px-3 py-2">{userFormError}</div>}
                <form onSubmit={addUser} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="text-sm text-gray-600">ID</label>
                    <Input name="id" required className="mt-1" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">{t.userFullName}</label>
                    <Input name="name" required className="mt-1" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">{t.password}</label>
                    <Input name="password" type="password" required className="mt-1" />
                  </div>
                  <input type="hidden" name="role" value="student" />
                  <div className="sm:col-span-2">
                    <label className="text-sm text-gray-600">
                      {t.profilePhotoLabel}
                      <span className="text-red-500"> *</span>
                    </label>
                    <Input name="profile_image" type="file" accept="image/*" className="mt-1 h-12 pt-2" required />
                  </div>
                  <Button type="submit">{t.kontingentAddStudent}</Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={item} className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{t.kontingentStudents}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b">
                      <th className="p-2">{t.userFullName}</th>
                      <th className="p-2">ID</th>
                      <th className="p-2">{t.userStatus}</th>
                      <th className="p-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((u) => (
                      <tr key={u.id} className="border-b border-black/5">
                        <td className="p-2 font-medium">{u.name}</td>
                        <td className="p-2 font-mono text-xs">{u.id}</td>
                        <td className="p-2">{u.status}</td>
                        <td className="p-2">
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(u)}>
                              Edit
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => deleteUser(u)}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {students.length === 0 && <p className="text-gray-500 text-center py-6 text-sm">—</p>}
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={item} className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Banned students</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {banList.map((u) => (
                  <div key={u.id} className="p-3 border rounded-xl flex items-center justify-between">
                    <div>
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-gray-500">{u.id}</p>
                    </div>
                    <Button type="button" size="sm" onClick={() => setUnbanUser(u)}>
                      Unban
                    </Button>
                  </div>
                ))}
                {banList.length === 0 && <p className="text-gray-500 text-sm">No banned students</p>}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>Edit student — {editing.id}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveEdit} className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600">Name</label>
                  <Input name="name" defaultValue={editing.name} required />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Status</label>
                  <select
                    name="status"
                    defaultValue={editing.status}
                    className="w-full h-12 rounded-2xl border border-white/50 bg-white/50 px-3 text-sm"
                  >
                    <option value="Active">Active</option>
                    <option value="Banned">Banned</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600">New password (optional)</label>
                  <Input name="password" type="password" />
                </div>
                <div>
                  <label className="text-sm text-gray-600">New profile photo (optional)</label>
                  <Input name="profile_image" type="file" accept="image/*" className="h-12 pt-2" />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {unbanUser && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-xl">
            <CardHeader>
              <CardTitle>Unban evidence — {unbanUser.id}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitUnban} className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600">Reason (required)</label>
                  <textarea
                    value={unbanReason}
                    onChange={(e) => setUnbanReason(e.target.value)}
                    required
                    minLength={8}
                    className="w-full min-h-24 rounded-2xl border border-white/50 bg-white/50 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Evidence file (JPG/PDF)</label>
                  <Input
                    type="file"
                    accept=".jpg,.jpeg,application/pdf,image/jpeg"
                    required
                    onChange={(e) => setUnbanFile(e.target.files?.[0] || null)}
                    className="h-12 pt-2"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setUnbanUser(null)}>
                    Cancel
                  </Button>
                  <Button type="submit">Unban</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
