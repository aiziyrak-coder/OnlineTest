import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from '../components/ui';
import { translations, Language, type TranslationBundle } from '../i18n';
import { readJsonSafe, parseAdminUsersList } from '../lib/http';
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
  profile_image?: string | null;
  has_photo?: boolean;
  group_name?: string | null;
};

type MainTab = 'kontingent' | 'students' | 'banned';

const anim = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 26 } },
};

export function KontingentTab({ token, lang }: { token: string; lang: Language }) {
  const t = translations[lang];
  const h = { Authorization: `Bearer ${token}` };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({ totalUsers: 0, totalExams: 0, totalViolations: 0, bannedUsers: 0 });

  // ── Kontingent ─────────────────────────────────────────────────────────────
  const [levels, setLevels] = useState<Level[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [kontView, setKontView] = useState<'levels' | 'groups' | 'students'>('levels');
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupStudents, setGroupStudents] = useState<StudentRow[]>([]);
  const [newLevelName, setNewLevelName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newTrack, setNewTrack] = useState('bachelor');
  const [newYear, setNewYear] = useState('');
  const [addUserError, setAddUserError] = useState('');

  // ── Barcha talabalar ───────────────────────────────────────────────────────
  const [allStudents, setAllStudents] = useState<StudentRow[]>([]);
  const [studSearch, setStudSearch] = useState('');
  const [studGroupFilter, setStudGroupFilter] = useState('');

  // ── Bloklangan ─────────────────────────────────────────────────────────────
  const [banList, setBanList] = useState<StudentRow[]>([]);
  const [banSearch, setBanSearch] = useState('');

  // ── Umumiy tab ─────────────────────────────────────────────────────────────
  const [mainTab, setMainTab] = useState<MainTab>('kontingent');

  // ── Modallar ───────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [unbanUser, setUnbanUser] = useState<StudentRow | null>(null);
  const [unbanReason, setUnbanReason] = useState('');
  const [unbanFile, setUnbanFile] = useState<File | null>(null);
  const [unbanError, setUnbanError] = useState('');
  const [unbanBusy, setUnbanBusy] = useState(false);

  // ── Load funksiyalar ───────────────────────────────────────────────────────
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

  const loadGroupStudents = useCallback(async (groupId: number) => {
    const res = await fetch(apiUrl(`/api/admin/users?group_id=${groupId}&role=student`), { headers: h });
    const j = await readJsonSafe<unknown>(res);
    setGroupStudents(parseAdminUsersList<StudentRow>(j));
  }, [token]);

  const loadAllStudents = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/users?role=student'), { headers: h });
    const j = await readJsonSafe<unknown>(res);
    setAllStudents(parseAdminUsersList<StudentRow>(j));
  }, [token]);

  const loadBanned = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/users?role=student&status=Banned'), { headers: h });
    const j = await readJsonSafe<unknown>(res);
    setBanList(parseAdminUsersList<StudentRow>(j));
  }, [token]);

  const reloadAll = useCallback(() => {
    loadStats();
    loadLevels();
    loadGroups();
    loadAllStudents();
    loadBanned();
    if (selectedGroup) loadGroupStudents(selectedGroup.id);
  }, [loadStats, loadLevels, loadGroups, loadAllStudents, loadBanned, selectedGroup, loadGroupStudents]);

  useEffect(() => {
    loadStats();
    loadLevels();
    loadGroups();
    loadAllStudents();
    loadBanned();
  }, [token]);

  useEffect(() => {
    if (kontView === 'students' && selectedGroup) {
      loadGroupStudents(selectedGroup.id);
    }
  }, [kontView, selectedGroup]);

  useEffect(() => {
    if (mainTab === 'students') loadAllStudents();
    if (mainTab === 'banned') loadBanned();
  }, [mainTab]);

  // ── CRUD ───────────────────────────────────────────────────────────────────
  const addLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(apiUrl('/api/admin/levels'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ name: newLevelName.trim() }),
    });
    if (res.ok) { setNewLevelName(''); loadLevels(); }
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
    if (res.ok) { setNewGroupName(''); loadGroups(); }
  };

  const addStudent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAddUserError('');
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const profileFile = fd.get('profile_image') as File;
    if (!profileFile || profileFile.size === 0) {
      setAddUserError(t.profilePhotoRequiredStudent);
      return;
    }
    const profileImageBase64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(profileFile);
    });
    const res = await fetch(apiUrl('/api/admin/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({
        id: fd.get('id'),
        password: fd.get('password'),
        role: 'student',
        name: fd.get('name'),
        group_id: selectedGroup ? selectedGroup.id : null,
        profile_image: profileImageBase64,
      }),
    });
      const data = (await readJsonSafe<{ error?: string }>(res)) || {};
      if (!res.ok) { setAddUserError(data.error || 'Xatolik'); return; }
    formEl.reset();
    reloadAll();
  };

  const deleteUser = async (u: StudentRow) => {
    if (!confirm(`"${u.name}" (${u.id}) ni o'chirasizmi? Bu amalni qaytarib bo'lmaydi.`)) return;
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(u.id)}`), {
      method: 'DELETE', headers: h,
    });
    if (res.ok) reloadAll();
  };

  const saveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const payload: any = {
      name: fd.get('name'),
      status: fd.get('status'),
      password: fd.get('password') || undefined,
      group_id: fd.get('group_id') ? Number(fd.get('group_id')) : undefined,
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
    if (res.ok) { setEditing(null); reloadAll(); }
  };

  const submitUnban = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unbanUser || !unbanFile) return;
    if (unbanReason.trim().length < 8) {
      setUnbanError("Sabab kamida 8 ta belgi bo'lishi kerak.");
      return;
    }
    setUnbanBusy(true);
    setUnbanError('');
    const fd = new FormData();
    fd.append('reason', unbanReason.trim());
    fd.append('evidence', unbanFile);
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(unbanUser.id)}/unban`), {
      method: 'POST', headers: h, body: fd,
    });
    const data = await readJsonSafe<{ error?: string }>(res);
    setUnbanBusy(false);
    if (!res.ok) { setUnbanError(data?.error || "Bandan chiqarishda xatolik."); return; }
    setUnbanUser(null);
    setUnbanReason('');
    setUnbanFile(null);
    setUnbanError('');
    reloadAll();
  };

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filteredStudents = allStudents.filter((u) => {
    const q = studSearch.toLowerCase();
    const matchSearch = !q || u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
    const matchGroup = !studGroupFilter || String(u.group_id) === studGroupFilter;
    return matchSearch && matchGroup;
  });

  const filteredBanned = banList.filter((u) => {
    const q = banSearch.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
  });

  const groupsInLevel = selectedLevel ? groups.filter((g) => g.level_id === selectedLevel.id) : [];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-6xl mx-auto">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {([
          [t.totalUsers, stats.totalUsers, 'text-blue-600'],
          [t.totalExams, stats.totalExams, 'text-green-600'],
          [t.totalViolations, stats.totalViolations, 'text-orange-600'],
          [t.bannedUsers, stats.bannedUsers, 'text-red-600'],
        ] as [string, number, string][]).map(([label, val, color]) => (
          <Card key={label} className="border-white/50 bg-white/40 backdrop-blur">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{val}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Asosiy tablar */}
      <div className="flex flex-wrap gap-2">
        {([
          ['kontingent', t.kontingentTitle],
          ['students', t.kontingentStudents],
          ['banned', `${t.bannedUsers}${banList.length > 0 ? ` (${banList.length})` : ''}`],
        ] as [MainTab, string][]).map(([tab, label]) => (
          <Button
            key={tab}
            type="button"
            variant={mainTab === tab ? 'default' : 'outline'}
            size="sm"
            className={`rounded-full ${tab === 'banned' && banList.length > 0 ? 'border-red-300 text-red-700' : ''}`}
            onClick={() => setMainTab(tab)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* ── TAB: KONTINGENT ── */}
      {mainTab === 'kontingent' && (
        <div className="space-y-6">
          {/* Breadcrumb */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button type="button" variant={kontView === 'levels' ? 'default' : 'outline'} size="sm" className="rounded-full"
              onClick={() => { setKontView('levels'); setSelectedLevel(null); setSelectedGroup(null); }}>
              {t.kontingentLevels}
            </Button>
            {selectedLevel && (
              <>
                <span className="text-gray-400">/</span>
                <Button type="button" variant={kontView === 'groups' ? 'default' : 'outline'} size="sm" className="rounded-full"
                  onClick={() => { setKontView('groups'); setSelectedGroup(null); }}>
                  {selectedLevel.name}
                </Button>
              </>
            )}
            {selectedGroup && (
              <>
                <span className="text-gray-400">/</span>
                <Button type="button" variant="default" size="sm" className="rounded-full">
                  {selectedGroup.name}
                </Button>
              </>
            )}
          </div>

          {/* Darajalar */}
          {kontView === 'levels' && (
            <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }} className="space-y-4">
              <motion.div variants={anim}>
                <Card>
                  <CardHeader><CardTitle>{t.kontingentAddLevel}</CardTitle></CardHeader>
                  <CardContent>
                    <form onSubmit={addLevel} className="flex gap-3 items-end">
                      <div className="flex-1">
                        <label className="text-sm text-gray-600 block mb-1">{t.levelLabel}</label>
                        <Input value={newLevelName} onChange={(e) => setNewLevelName(e.target.value)} placeholder="1-kurs" required />
                      </div>
                      <Button type="submit">{t.kontingentAddLevel}</Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div variants={anim}>
                <Card>
                  <CardHeader><CardTitle>{t.kontingentLevels}</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {levels.map((lv) => (
                      <button key={lv.id} type="button"
                        className="w-full text-left p-4 rounded-2xl border border-white/50 bg-white/30 hover:bg-white/60 transition flex justify-between items-center"
                        onClick={() => { setSelectedLevel(lv); setKontView('groups'); }}>
                        <span className="font-semibold text-gray-900">{lv.name}</span>
                        <span className="text-xs text-gray-500">{groups.filter((g) => g.level_id === lv.id).length} {t.kontingentGroups}</span>
                      </button>
                    ))}
                    {levels.length === 0 && <p className="text-gray-400 text-center py-6 text-sm">Hozircha darajalar yo'q</p>}
                  </CardContent>
                </Card>
              </motion.div>
              {/* Admin yaratish */}
              <motion.div variants={anim}>
                <Card className="border-dashed border-amber-200/80 bg-amber-50/20">
                  <CardHeader><CardTitle className="text-base">Admin foydalanuvchi qo'shish</CardTitle></CardHeader>
                  <CardContent>
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      const formEl = e.currentTarget;
                      const fd = new FormData(formEl);
                      const res = await fetch(apiUrl('/api/admin/users'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({
                          id: fd.get('id'), password: fd.get('password'), role: 'admin',
                          name: fd.get('name'), group_id: null,
                          profile_image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                        }),
                      });
                      const data = (await readJsonSafe<{ error?: string }>(res)) || {};
                      if (res.ok) { loadStats(); formEl.reset(); }
                      else alert(data.error || 'Xatolik');
                    }} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                      <div><label className="text-sm text-gray-600">ID</label><Input name="id" required className="mt-1" /></div>
                      <div><label className="text-sm text-gray-600">{t.userFullName}</label><Input name="name" required className="mt-1" /></div>
                      <div><label className="text-sm text-gray-600">{t.password}</label><Input name="password" type="password" required minLength={10} autoComplete="new-password" className="mt-1" /></div>
                      <Button type="submit" className="sm:col-span-3 w-full sm:w-auto">Admin yaratish</Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>
          )}

          {/* Guruhlar */}
          {kontView === 'groups' && selectedLevel && (
            <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }} className="space-y-4">
              <motion.div variants={anim}>
                <Card>
                  <CardHeader><CardTitle>{t.kontingentAddGroup} — {selectedLevel.name}</CardTitle></CardHeader>
                  <CardContent>
                    <form onSubmit={addGroup} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                      <div><label className="text-sm text-gray-600 block mb-1">{t.groupName}</label>
                        <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} required /></div>
                      <div><label className="text-sm text-gray-600 block mb-1">{t.programTrack}</label>
                        <select value={newTrack} onChange={(e) => setNewTrack(e.target.value)}
                          className="w-full h-12 rounded-2xl border border-white/50 bg-white/50 px-3 text-sm">
                          <option value="bachelor">bachelor</option>
                          <option value="residency">residency</option>
                          <option value="master">master</option>
                        </select></div>
                      <div><label className="text-sm text-gray-600 block mb-1">{t.academicYear}</label>
                        <Input value={newYear} onChange={(e) => setNewYear(e.target.value)} placeholder="1–6" type="number" min={1} max={6} /></div>
                      <Button type="submit">{t.kontingentAddGroup}</Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div variants={anim}>
                <Card>
                  <CardHeader><CardTitle>{t.kontingentGroups}</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {groupsInLevel.map((g) => (
                      <button key={g.id} type="button"
                        className="w-full text-left p-4 rounded-2xl border border-white/50 bg-white/30 hover:bg-white/60 transition"
                        onClick={() => { setSelectedGroup(g); setKontView('students'); }}>
                        <p className="font-semibold text-gray-900">{g.name}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {g.program_track || 'bachelor'}
                          {g.academic_year != null ? ` · ${t.academicYear}: ${g.academic_year}` : ''}
                        </p>
                      </button>
                    ))}
                    {groupsInLevel.length === 0 && <p className="text-gray-400 text-center py-6 text-sm">Guruhlar yo'q</p>}
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>
          )}

          {/* Guruh talabalari */}
          {kontView === 'students' && selectedGroup && (
            <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }} className="space-y-4">
              <motion.div variants={anim}>
                <Card>
                  <CardHeader><CardTitle>{t.kontingentAddStudent} — {selectedGroup.name}</CardTitle></CardHeader>
                  <CardContent>
                    {addUserError && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{addUserError}</div>}
                    <form onSubmit={addStudent} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
                      <div><label className="text-sm text-gray-600">ID</label><Input name="id" required className="mt-1" /></div>
                      <div><label className="text-sm text-gray-600">{t.userFullName}</label><Input name="name" required className="mt-1" /></div>
                      <div><label className="text-sm text-gray-600">{t.password}</label><Input name="password" type="password" required minLength={10} autoComplete="new-password" className="mt-1" /></div>
                      <div className="sm:col-span-2">
                        <label className="text-sm text-gray-600">{t.profilePhotoLabel} <span className="text-red-500">*</span></label>
                        <Input name="profile_image" type="file" accept="image/*" className="mt-1 h-12 pt-2" required />
                      </div>
                      <Button type="submit">{t.kontingentAddStudent}</Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div variants={anim}>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>{t.kontingentStudents} — {selectedGroup.name}</CardTitle>
                      <span className="text-sm text-gray-500">{groupStudents.length} ta</span>
                    </div>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <StudentTable students={groupStudents} groups={groups} t={t}
                      onEdit={setEditing} onDelete={deleteUser} onUnban={setUnbanUser} />
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>
          )}
        </div>
      )}

      {/* ── TAB: BARCHA TALABALAR ── */}
      {mainTab === 'students' && (
        <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }} className="space-y-4">
          <motion.div variants={anim}>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>{t.kontingentStudents}</CardTitle>
                  <span className="text-sm text-gray-500">{filteredStudents.length} / {allStudents.length} ta</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filter */}
                <div className="flex flex-wrap gap-3">
                  <Input
                    placeholder="Ism yoki ID bo'yicha qidirish..."
                    value={studSearch}
                    onChange={(e) => setStudSearch(e.target.value)}
                    className="flex-1 min-w-[200px]"
                  />
                  <select
                    value={studGroupFilter}
                    onChange={(e) => setStudGroupFilter(e.target.value)}
                    className="h-12 rounded-2xl border border-white/50 bg-white/50 px-3 text-sm min-w-[160px]"
                  >
                    <option value="">Barcha guruhlar</option>
                    {groups.map((g) => (
                      <option key={g.id} value={String(g.id)}>{g.name}</option>
                    ))}
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <StudentTable students={filteredStudents} groups={groups} t={t}
                    onEdit={setEditing} onDelete={deleteUser} onUnban={setUnbanUser} showGroup />
                </div>
                {filteredStudents.length === 0 && (
                  <p className="text-gray-400 text-center py-8 text-sm">Talabalar topilmadi</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {/* ── TAB: BLOKLANGAN ── */}
      {mainTab === 'banned' && (
        <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }} className="space-y-4">
          <motion.div variants={anim}>
            <Card className="border-red-200/60 bg-red-50/20">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-red-700">{t.bannedUsers}</CardTitle>
                    <p className="text-sm text-gray-500 mt-1">
                      Bandan chiqarish uchun sabab va dalil fayl (JPG/PDF) talab qilinadi.
                    </p>
                  </div>
                  <span className={`text-sm font-semibold px-3 py-1 rounded-full ${banList.length > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {banList.length} ta bloklangan
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Ism yoki ID bo'yicha qidirish..."
                  value={banSearch}
                  onChange={(e) => setBanSearch(e.target.value)}
                />
                {filteredBanned.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p className="text-gray-500 font-medium">Bloklangan talabalar yo'q</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-200">
                          <th className="p-3 text-left font-medium">Talaba</th>
                          <th className="p-3 text-left font-medium">ID</th>
                          <th className="p-3 text-left font-medium">Guruh</th>
                          <th className="p-3 text-right font-medium">Amallar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBanned.map((u) => (
                          <tr key={u.id} className="border-b border-red-100/50 hover:bg-red-50/30 transition">
                            <td className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-red-100 border-2 border-red-200 flex items-center justify-center flex-shrink-0">
                                  {u.has_photo ? (
                                    <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                                    </svg>
                                  ) : (
                                    <span className="text-red-600 font-bold text-sm">{u.name.charAt(0).toUpperCase()}</span>
                                  )}
                                </div>
                                <div>
                                  <p className="font-semibold text-gray-900">{u.name}</p>
                                  <span className="inline-block text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full mt-0.5">
                                    Bloklangan
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="p-3 font-mono text-xs text-gray-600">{u.id}</td>
                            <td className="p-3 text-gray-600 text-xs">
                              {groups.find((g) => g.id === u.group_id)?.name || '—'}
                            </td>
                            <td className="p-3">
                              <div className="flex justify-end gap-2">
                                <Button type="button" size="sm" variant="outline"
                                  className="text-blue-600 border-blue-200 hover:bg-blue-50"
                                  onClick={() => setEditing(u)}>
                                  {t.edit}
                                </Button>
                                <Button type="button" size="sm"
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                  onClick={() => { setUnbanUser(u); setUnbanError(''); }}>
                                  {t.unban}
                                </Button>
                                <Button type="button" size="sm" variant="outline"
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                  onClick={() => deleteUser(u)}>
                                  {t.delete}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {/* ── MODAL: Tahrirlash ── */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}
          >
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg">
              <Card>
                <CardHeader>
                  <CardTitle>{t.editUser} — {editing.name}</CardTitle>
                  <p className="text-xs text-gray-500 mt-1">ID: {editing.id}</p>
                </CardHeader>
                <CardContent>
                  <form onSubmit={saveEdit} className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">{t.userFullName}</label>
                      <Input name="name" defaultValue={editing.name} required />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">{t.userStatus}</label>
                      <select name="status" defaultValue={editing.status}
                        className="w-full h-12 rounded-2xl border border-white/50 bg-white/50 px-3 text-sm">
                        <option value="Active">Faol (Active)</option>
                        <option value="Banned">Bloklangan (Banned)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">Guruh</label>
                      <select name="group_id" defaultValue={editing.group_id ?? ''}
                        className="w-full h-12 rounded-2xl border border-white/50 bg-white/50 px-3 text-sm">
                        <option value="">— Guruhi yo'q —</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">{t.newPasswordOptional}</label>
                      <Input name="password" type="password" minLength={10} placeholder="Bo'sh yoki kamida 10 belgi" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">
                        {t.profilePhotoLabel} <span className="text-gray-400 font-normal">({t.keepPhoto})</span>
                      </label>
                      <Input name="profile_image" type="file" accept="image/*" className="h-12 pt-2" />
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                      <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t.cancel}</Button>
                      <Button type="submit">{t.save}</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MODAL: Bandan chiqarish ── */}
      <AnimatePresence>
        {unbanUser && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setUnbanUser(null); }}
          >
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-xl">
              <Card>
                <CardHeader>
                  <CardTitle className="text-green-700">{t.unban}</CardTitle>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="w-12 h-12 rounded-full bg-red-100 border-2 border-red-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-red-600 font-bold text-lg">{unbanUser.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{unbanUser.name}</p>
                      <p className="text-xs text-gray-500">ID: {unbanUser.id}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {unbanError && (
                    <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                      {unbanError}
                    </div>
                  )}
                  <form onSubmit={submitUnban} className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">
                        Bandan chiqarish sababi <span className="text-red-500">*</span>
                        <span className="text-gray-400 font-normal ml-1">(kamida 8 ta belgi)</span>
                      </label>
                      <textarea
                        value={unbanReason}
                        onChange={(e) => setUnbanReason(e.target.value)}
                        required
                        minLength={8}
                        rows={3}
                        placeholder="Masalan: Talaba imtihon paytida texnik nosozlik yuz berdi..."
                        className="w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 resize-none"
                      />
                      <p className="text-xs text-gray-400 mt-1">{unbanReason.length} / 8 belgi minimum</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-1">
                        Dalil fayl (JPG yoki PDF) <span className="text-red-500">*</span>
                        <span className="text-gray-400 font-normal ml-1">(maks. 5 MB)</span>
                      </label>
                      <Input
                        type="file"
                        accept=".jpg,.jpeg,application/pdf,image/jpeg"
                        required
                        onChange={(e) => setUnbanFile(e.target.files?.[0] || null)}
                        className="h-12 pt-2"
                      />
                      {unbanFile && (
                        <p className="text-xs text-green-700 mt-1">{unbanFile.name} ({(unbanFile.size / 1024).toFixed(1)} KB)</p>
                      )}
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                      <Button type="button" variant="outline" onClick={() => setUnbanUser(null)}>{t.cancel}</Button>
                      <Button type="submit" disabled={unbanBusy || unbanReason.trim().length < 8 || !unbanFile}
                        className="bg-green-600 hover:bg-green-700 text-white">
                        {unbanBusy ? 'Saqlanmoqda...' : t.unban}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Talabalar jadvali komponenti ──────────────────────────────────────────────
function StudentTable({
  students,
  groups,
  t,
  onEdit,
  onDelete,
  onUnban,
  showGroup = false,
}: {
  students: StudentRow[];
  groups: Group[];
  t: TranslationBundle;
  onEdit: (u: StudentRow) => void;
  onDelete: (u: StudentRow) => void;
  onUnban: (u: StudentRow) => void;
  showGroup?: boolean;
}) {
  if (students.length === 0) {
    return <p className="text-gray-400 text-center py-8 text-sm">Talabalar yo'q</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-gray-500 border-b border-gray-200">
          <th className="p-3 text-left font-medium">Talaba</th>
          <th className="p-3 text-left font-medium">ID</th>
          {showGroup && <th className="p-3 text-left font-medium">Guruh</th>}
          <th className="p-3 text-left font-medium">Holat</th>
          <th className="p-3 text-right font-medium">Amallar</th>
        </tr>
      </thead>
      <tbody>
        {students.map((u) => (
          <tr key={u.id} className={`border-b border-black/5 hover:bg-white/40 transition ${u.status === 'Banned' ? 'bg-red-50/30' : ''}`}>
            <td className="p-3">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 border ${
                  u.has_photo ? 'bg-blue-100 border-blue-200' : 'bg-gray-100 border-gray-200'
                }`}>
                  {u.has_photo ? (
                    <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                    </svg>
                  ) : (
                    <span className="text-gray-500 font-bold text-sm">{u.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <span className="font-medium text-gray-900">{u.name}</span>
              </div>
            </td>
            <td className="p-3 font-mono text-xs text-gray-600">{u.id}</td>
            {showGroup && (
              <td className="p-3 text-xs text-gray-600">
                {groups.find((g) => g.id === u.group_id)?.name || '—'}
              </td>
            )}
            <td className="p-3">
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                u.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>
                {u.status === 'Active' ? 'Faol' : 'Bloklangan'}
              </span>
            </td>
            <td className="p-3">
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="outline"
                  className="text-blue-600 border-blue-200 hover:bg-blue-50"
                  onClick={() => onEdit(u)}>
                  {t.edit}
                </Button>
                {u.status === 'Banned' && (
                  <Button type="button" size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white text-xs"
                    onClick={() => onUnban(u)}>
                    {t.unban}
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => onDelete(u)}>
                  {t.delete}
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
