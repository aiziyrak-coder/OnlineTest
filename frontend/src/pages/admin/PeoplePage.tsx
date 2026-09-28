import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { fileToProfileImageBase64, ProfileImageError } from '../../lib/profileImage';
import {
  AdminAlert,
  AdminBtn,
  AdminEmpty,
  AdminField,
  AdminFileInput,
  AdminInput,
  AdminModal,
  AdminPageMessage,
  AdminSelect,
} from './ui';
import type { AdminPageMsg } from './ui';
import type { Group, Kafedra } from './types';

/*
 * Talabalar va o'qituvchilar — bitta jadval, serverda sahifalanadi.
 *
 * Eski StudentsPage `/api/admin/users?role=student` ni limitsiz so'rardi va
 * server standart 200 ta qaytarardi: 5 300 talabadan faqat birinchi 200 tasi
 * ko'rinardi, qidiruv ham shu 200 ichida ishlardi. Endi har bir filtr
 * (kurs, yo'nalish, guruh, kafedra, holat, rasm, qidiruv) serverga ketadi.
 */

type Role = 'student' | 'faculty';

interface Person {
  id: string;
  name: string;
  role: string;
  status: string;
  group_id: number | null;
  group_name?: string | null;
  level_id?: number | null;
  level_name?: string | null;
  direction_name?: string | null;
  kafedra_id?: number | null;
  kafedra_name?: string | null;
  position?: string;
  stavka?: string;
  has_photo?: boolean;
}

const PAGE = 50;

const TXT = {
  uz: {
    student: 'Talabalar', faculty: "O'qituvchilar",
    allCourses: 'Barcha kurslar', direction: "Yo'nalish", allDirections: "Barcha yo'nalishlar", group: 'Guruh', allGroups: 'Barcha guruhlar',
    kafedra: 'Kafedra', allKafedras: 'Barcha kafedralar', status: 'Holat', any: 'Hammasi', active: 'Faol', banned: 'Chetlatilgan',
    photo: 'Rasm', photoYes: 'Rasm bor', photoNo: "Rasm yo'q", search: 'Ism yoki login', searchPh: 'Qidirish…',
    add: "Qo'shish", excel: 'Excel', refresh: 'Yangilash', reset: 'Filtrni tozalash',
    name: 'F.I.Sh.', login: 'Login', course: 'Kurs', position: 'Lavozim', actions: '',
    edit: 'Tahrirlash', del: "O'chirish", delConfirm: "Rostdan o'chirilsinmi? Natijalari ham o'chadi.", yesDel: "Ha, o'chirish", cancel: 'Bekor qilish', save: 'Saqlash',
    found: 'ta topildi', of: 'dan', empty: "Filtr bo'yicha hech kim topilmadi.", loading: 'Yuklanmoqda…',
    addStudent: "Talaba qo'shish", addFaculty: "O'qituvchi qo'shish", editTitle: 'Tahrirlash',
    idLabel: 'Login (ID)', password: 'Parol', pwHint: 'kamida 10 belgi', newPw: "Yangi parol (bo'sh qoldirsa o'zgarmaydi)",
    stavka: 'Stavka', photoLabel: 'Profil rasmi', photoRequired: 'Talaba uchun rasm majburiy', photoTooLarge: 'Rasm juda katta',
    chooseFile: 'Fayl tanlash', noFile: 'Fayl tanlanmagan', noGroup: "Guruhsiz", err: 'Xatolik yuz berdi',
    added: "Qo'shildi", saved: 'Saqlandi', deleted: "O'chirildi", exporting: 'Tayyorlanmoqda…', sheet: "Ro'yxat",
    prev: 'Oldingi', next: 'Keyingi',
  },
  ru: {
    student: 'Студенты', faculty: 'Преподаватели',
    allCourses: 'Все курсы', direction: 'Направление', allDirections: 'Все направления', group: 'Группа', allGroups: 'Все группы',
    kafedra: 'Кафедра', allKafedras: 'Все кафедры', status: 'Статус', any: 'Все', active: 'Активен', banned: 'Заблокирован',
    photo: 'Фото', photoYes: 'Есть фото', photoNo: 'Нет фото', search: 'Имя или логин', searchPh: 'Поиск…',
    add: 'Добавить', excel: 'Excel', refresh: 'Обновить', reset: 'Сбросить фильтры',
    name: 'Ф.И.О.', login: 'Логин', course: 'Курс', position: 'Должность', actions: '',
    edit: 'Изменить', del: 'Удалить', delConfirm: 'Удалить? Результаты тоже будут удалены.', yesDel: 'Да, удалить', cancel: 'Отмена', save: 'Сохранить',
    found: 'найдено', of: 'из', empty: 'По фильтру никого не найдено.', loading: 'Загрузка…',
    addStudent: 'Добавить студента', addFaculty: 'Добавить преподавателя', editTitle: 'Редактирование',
    idLabel: 'Логин (ID)', password: 'Пароль', pwHint: 'не менее 10 символов', newPw: 'Новый пароль (пусто — без изменений)',
    stavka: 'Ставка', photoLabel: 'Фото профиля', photoRequired: 'Для студента фото обязательно', photoTooLarge: 'Фото слишком большое',
    chooseFile: 'Выбрать файл', noFile: 'Файл не выбран', noGroup: 'Без группы', err: 'Произошла ошибка',
    added: 'Добавлено', saved: 'Сохранено', deleted: 'Удалено', exporting: 'Готовится…', sheet: 'Список',
    prev: 'Назад', next: 'Вперёд',
  },
  en: {
    student: 'Students', faculty: 'Teachers',
    allCourses: 'All years', direction: 'Programme', allDirections: 'All programmes', group: 'Group', allGroups: 'All groups',
    kafedra: 'Department', allKafedras: 'All departments', status: 'Status', any: 'Any', active: 'Active', banned: 'Banned',
    photo: 'Photo', photoYes: 'Has photo', photoNo: 'No photo', search: 'Name or login', searchPh: 'Search…',
    add: 'Add', excel: 'Excel', refresh: 'Refresh', reset: 'Clear filters',
    name: 'Full name', login: 'Login', course: 'Year', position: 'Position', actions: '',
    edit: 'Edit', del: 'Delete', delConfirm: 'Delete this person? Their results are removed too.', yesDel: 'Yes, delete', cancel: 'Cancel', save: 'Save',
    found: 'found', of: 'of', empty: 'Nobody matches the filters.', loading: 'Loading…',
    addStudent: 'Add student', addFaculty: 'Add teacher', editTitle: 'Edit',
    idLabel: 'Login (ID)', password: 'Password', pwHint: 'at least 10 characters', newPw: 'New password (leave empty to keep)',
    stavka: 'Rate', photoLabel: 'Profile photo', photoRequired: 'A photo is required for students', photoTooLarge: 'The photo is too large',
    chooseFile: 'Choose file', noFile: 'No file selected', noGroup: 'No group', err: 'Something went wrong',
    added: 'Added', saved: 'Saved', deleted: 'Deleted', exporting: 'Preparing…', sheet: 'List',
    prev: 'Previous', next: 'Next',
  },
};

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const levelNum = (name: string) => {
  const m = /(\d+)/.exec(name || '');
  return m ? Number(m[1]) : 99;
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

function StatusPill({ status, t }: { status: string; t: (typeof TXT)['uz'] }) {
  const ok = status === 'Active';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
        ok ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15' : 'bg-red-50 text-red-700 ring-1 ring-red-600/15'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {ok ? t.active : t.banned}
    </span>
  );
}

export function PeoplePage({ token, lang, role }: { token: string; lang: Language; role: Role }) {
  const t = TXT[lang] || TXT.uz;
  const h = useMemo(() => authHeaders(token, lang), [token, lang]);
  const isStudent = role === 'student';

  const [groups, setGroups] = useState<Group[]>([]);
  const [kafedras, setKafedras] = useState<Kafedra[]>([]);

  const [rows, setRows] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  const [q, setQ] = useState('');
  const [levelId, setLevelId] = useState('');
  const [directionId, setDirectionId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [kafedraId, setKafedraId] = useState('');
  const [status, setStatus] = useState('');
  const [photo, setPhoto] = useState('');
  const [sort, setSort] = useState('name');
  const dq = useDebounced(q.trim(), 350);

  const [msg, setMsg] = useState<AdminPageMsg | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addErr, setAddErr] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addKey, setAddKey] = useState(0);

  const [editing, setEditing] = useState<Person | null>(null);
  const [editErr, setEditErr] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [photoCurrent, setPhotoCurrent] = useState<string | null>(null);
  const [photoPick, setPhotoPick] = useState<string | null>(null);

  /* ── Ma'lumotnomalar ─────────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      const [rG, rK] = await Promise.all([
        isStudent ? fetch(apiUrl('/api/admin/groups'), { headers: h }) : Promise.resolve(null),
        !isStudent ? fetch(apiUrl('/api/admin/kafedralar'), { headers: h }) : Promise.resolve(null),
      ]);
      if (rG && checkAdminAuthResponse(rG)) {
        const j = await readJsonSafe<Group[]>(rG);
        setGroups(Array.isArray(j) ? j : []);
      }
      if (rK && checkAdminAuthResponse(rK)) {
        const j = await readJsonSafe<Kafedra[] | { results?: Kafedra[] }>(rK);
        setKafedras(Array.isArray(j) ? j : (j && Array.isArray(j.results) ? j.results : []));
      }
    })();
  }, [h, isStudent]);

  const levels = useMemo(() => {
    const m = new Map<number, { id: number; name: string; count: number }>();
    groups.forEach((g) => {
      if (!g.level_id) return;
      const cur = m.get(g.level_id) || { id: g.level_id, name: g.level_name, count: 0 };
      cur.count += Number(g.student_count || 0);
      m.set(g.level_id, cur);
    });
    return Array.from(m.values()).sort((a, b) => levelNum(a.name) - levelNum(b.name));
  }, [groups]);

  const directions = useMemo(() => {
    const m = new Map<number, string>();
    groups.forEach((g) => {
      if (levelId && String(g.level_id) !== levelId) return;
      if (g.direction_id && g.direction_name) m.set(g.direction_id, g.direction_name);
    });
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [groups, levelId]);

  const groupOptions = useMemo(
    () =>
      groups
        .filter((g) => (!levelId || String(g.level_id) === levelId) && (!directionId || String(g.direction_id) === directionId))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [groups, levelId, directionId],
  );

  /* ── Ro'yxat (server sahifalash) ─────────────────────────────────────── */
  const query = useCallback(
    (off: number, limit: number) => {
      const p = new URLSearchParams({ role, limit: String(limit), offset: String(off), sort });
      if (dq) p.set('q', dq);
      if (status) p.set('status', status);
      if (photo) p.set('photo', photo);
      if (isStudent) {
        if (groupId) p.set('group_id', groupId);
        else {
          if (levelId) p.set('level_id', levelId);
          if (directionId) p.set('direction_id', directionId);
        }
      } else if (kafedraId) {
        p.set('kafedra_id', kafedraId);
      }
      return '/api/admin/users?' + p.toString();
    },
    [role, sort, dq, status, photo, isStudent, groupId, levelId, directionId, kafedraId],
  );

  const reqId = useRef(0);
  const load = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(query(offset, PAGE)), { headers: h });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<{ results?: Person[]; total?: number }>(res);
      if (my !== reqId.current) return;
      setRows(Array.isArray(j?.results) ? j!.results : []);
      setTotal(Number(j?.total || 0));
    } catch {
      if (my === reqId.current) setMsg({ type: 'err', text: t.err });
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [query, offset, h, t.err]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); }, [dq, status, photo, groupId, levelId, directionId, kafedraId, sort]);

  const filtersOn = Boolean(q || levelId || directionId || groupId || kafedraId || status || photo);
  const clearFilters = () => {
    setQ(''); setLevelId(''); setDirectionId(''); setGroupId(''); setKafedraId(''); setStatus(''); setPhoto('');
  };

  /* ── Amallar ─────────────────────────────────────────────────────────── */
  const toast = (type: 'ok' | 'err', text: string) => setMsg({ type, text });

  const remove = async (id: string) => {
    setDelBusy(true);
    try {
      const res = await fetch(apiUrl('/api/admin/users/' + encodeURIComponent(id)), { method: 'DELETE', headers: h });
      if (!checkAdminAuthResponse(res)) return;
      if (res.ok) { toast('ok', t.deleted); load(); }
      else {
        const d = await readJsonSafe<{ error?: string }>(res);
        toast('err', d?.error || t.err);
      }
    } finally {
      setDelBusy(false);
      setConfirmDel(null);
    }
  };

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAddErr('');
    const fd = new FormData(e.currentTarget);
    const file = fd.get('profile_image') as File | null;
    let b64 = '';
    if (file && file.size > 0) {
      try { b64 = await fileToProfileImageBase64(file); }
      catch (err) { setAddErr(err instanceof ProfileImageError ? t.photoTooLarge : t.err); return; }
    } else if (isStudent) {
      setAddErr(t.photoRequired);
      return;
    }
    setAddBusy(true);
    try {
      const body: Record<string, unknown> = {
        id: String(fd.get('id') || '').trim(),
        name: String(fd.get('name') || '').trim(),
        password: String(fd.get('password') || ''),
        role,
        profile_image: b64,
      };
      if (isStudent) body.group_id = fd.get('group_id') ? Number(fd.get('group_id')) : null;
      else {
        body.kafedra_id = fd.get('kafedra_id') ? Number(fd.get('kafedra_id')) : null;
        body.position = String(fd.get('position') || '');
        body.stavka = String(fd.get('stavka') || '');
      }
      const res = await fetch(apiUrl('/api/admin/users'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) { setAddErr(d?.error || t.err); return; }
      setAddOpen(false);
      setAddKey((k) => k + 1);
      toast('ok', t.added);
      load();
    } finally {
      setAddBusy(false);
    }
  };

  const openEdit = async (p: Person) => {
    setEditErr(''); setPhotoCurrent(null); setPhotoPick(null);
    setEditing(p); setEditLoading(true);
    try {
      const res = await fetch(apiUrl('/api/admin/users/' + encodeURIComponent(p.id)), { headers: h });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<Person & { profile_image?: string }>(res);
      if (d) {
        setPhotoCurrent(d.profile_image || null);
        setEditing((prev) => (prev ? { ...prev, ...d } : prev));
      }
    } finally {
      setEditLoading(false);
    }
  };

  const onEditPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setEditErr('');
    if (!f) { setPhotoPick(null); return; }
    try { setPhotoPick(await fileToProfileImageBase64(f)); }
    catch (err) { setPhotoPick(null); e.target.value = ''; setEditErr(err instanceof ProfileImageError ? t.photoTooLarge : t.err); }
  };

  const saveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || editBusy) return;
    const fd = new FormData(e.currentTarget);
    const pw = String(fd.get('password') || '').trim();
    if (pw && pw.length < 10) { setEditErr(t.pwHint); return; }
    const payload: Record<string, unknown> = { name: fd.get('name'), status: fd.get('status') };
    if (isStudent) payload.group_id = fd.get('group_id') ? Number(fd.get('group_id')) : null;
    else {
      payload.kafedra_id = fd.get('kafedra_id') ? Number(fd.get('kafedra_id')) : null;
      payload.position = fd.get('position') || '';
      payload.stavka = fd.get('stavka') || '';
    }
    if (pw) payload.password = pw;
    if (photoPick) payload.profile_image = photoPick;
    setEditBusy(true);
    try {
      const res = await fetch(apiUrl('/api/admin/users/' + encodeURIComponent(editing.id)), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(payload),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) { setEditErr(d?.error || t.err); return; }
      setEditing(null);
      toast('ok', t.saved);
      load();
    } finally {
      setEditBusy(false);
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const all: Person[] = [];
      for (let off = 0; off < Math.max(total, 1) && off < 20000; off += 500) {
        const res = await fetch(apiUrl(query(off, 500)), { headers: h });
        if (!checkAdminAuthResponse(res) || !res.ok) break;
        const j = await readJsonSafe<{ results?: Person[] }>(res);
        const part = Array.isArray(j?.results) ? j!.results : [];
        all.push(...part);
        if (part.length < 500) break;
      }
      const columns = isStudent
        ? ['№', t.name, t.login, t.course, t.direction, t.group, t.photo, t.status]
        : ['№', t.name, t.login, t.kafedra, t.position, t.stavka, t.photo, t.status];
      const data = all.map((p, i) =>
        isStudent
          ? [i + 1, p.name, p.id, p.level_name || '', p.direction_name || '', p.group_name || '', p.has_photo ? t.photoYes : t.photoNo, p.status === 'Active' ? t.active : t.banned]
          : [i + 1, p.name, p.id, p.kafedra_name || '', p.position || '', p.stavka || '', p.has_photo ? t.photoYes : t.photoNo, p.status === 'Active' ? t.active : t.banned],
      );
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `${role === 'student' ? 'talabalar' : 'oqituvchilar'}-${stamp}.xlsx`;
      const lvl = levels.find((l) => String(l.id) === levelId)?.name;
      const kaf = kafedras.find((k) => String(k.id) === kafedraId)?.name;
      const res = await fetch(apiUrl('/api/admin/reports/xlsx'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({
          title: [isStudent ? t.student : t.faculty, lvl, kaf].filter(Boolean).join(' · '),
          filename,
          sheets: [{ title: t.sheet, columns, rows: data }],
        }),
      });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) { toast('err', t.err); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  /* ── Ko'rinish ───────────────────────────────────────────────────────── */
  const SortHead = ({ k, label, className = '' }: { k: string; label: string; className?: string }) => {
    const active = sort === k || sort === '-' + k;
    const desc = sort === '-' + k;
    return (
      <th className={`px-4 py-2.5 text-left font-semibold ${className}`}>
        <button
          type="button"
          onClick={() => setSort(active && !desc ? '-' + k : k)}
          className={`inline-flex items-center gap-1 rounded-md -mx-1 px-1 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 ${active ? 'text-gray-900' : ''}`}
        >
          {label}
          <span className={`text-[10px] ${active ? 'text-indigo-600' : 'text-gray-300'}`} aria-hidden>
            {active ? (desc ? '▼' : '▲') : '↕'}
          </span>
        </button>
      </th>
    );
  };

  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + PAGE, total);
  const td = 'px-4 py-3 border-b border-gray-100';

  return (
    <div className="space-y-4">
      <AdminPageMessage message={msg} onDismiss={() => setMsg(null)} />

      {/* Kurs chiplari (talabalar) */}
      {isStudent && levels.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t.course}>
          {[{ id: '', name: t.allCourses, count: levels.reduce((s, l) => s + l.count, 0) }, ...levels.map((l) => ({ ...l, id: String(l.id) }))].map((l) => {
            const on = levelId === l.id;
            return (
              <button
                key={l.id || 'all'}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => { setLevelId(l.id); setDirectionId(''); setGroupId(''); }}
                className={`h-9 rounded-full px-4 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 ${
                  on ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:ring-gray-300'
                }`}
              >
                {l.name}
                {l.count ? <span className={`ml-1.5 tabular-nums ${on ? 'text-white/70' : 'text-gray-400'}`}>{fmt(l.count)}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <section className={`${CARD} overflow-hidden`}>
        {/* Filtrlar */}
        <div className="grid grid-cols-1 gap-3 border-b border-gray-200 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12px] font-semibold text-gray-500">{t.search}</span>
            <AdminInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPh} />
          </label>
          {isStudent ? (
            <>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-[12px] font-semibold text-gray-500">{t.direction}</span>
                <AdminSelect value={directionId} onChange={(e) => { setDirectionId(e.target.value); setGroupId(''); }}>
                  <option value="">{t.allDirections}</option>
                  {directions.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
                </AdminSelect>
              </label>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-[12px] font-semibold text-gray-500">{t.group}</span>
                <AdminSelect value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">{t.allGroups}</option>
                  {groupOptions.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
                </AdminSelect>
              </label>
            </>
          ) : (
            <label className="block min-w-0 xl:col-span-2">
              <span className="mb-1.5 block text-[12px] font-semibold text-gray-500">{t.kafedra}</span>
              <AdminSelect value={kafedraId} onChange={(e) => setKafedraId(e.target.value)}>
                <option value="">{t.allKafedras}</option>
                {kafedras.map((k) => <option key={k.id} value={String(k.id)}>{k.name}</option>)}
              </AdminSelect>
            </label>
          )}
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12px] font-semibold text-gray-500">{t.status}</span>
            <AdminSelect value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t.any}</option>
              <option value="Active">{t.active}</option>
              <option value="Banned">{t.banned}</option>
            </AdminSelect>
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12px] font-semibold text-gray-500">{t.photo}</span>
            <AdminSelect value={photo} onChange={(e) => setPhoto(e.target.value)}>
              <option value="">{t.any}</option>
              <option value="yes">{t.photoYes}</option>
              <option value="no">{t.photoNo}</option>
            </AdminSelect>
          </label>
        </div>

        {/* Natija qatori */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-[13.5px] text-gray-600">
            <b className="font-display text-[18px] font-extrabold tabular-nums text-gray-900">{fmt(total)}</b> {t.found}
            {filtersOn ? (
              <button type="button" onClick={clearFilters} className="ml-3 text-[12.5px] font-semibold text-indigo-700 hover:underline">
                {t.reset}
              </button>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <AdminBtn variant="ghost" size="sm" onClick={load} disabled={loading}>{t.refresh}</AdminBtn>
            <AdminBtn variant="ghost" size="sm" onClick={exportExcel} loading={exporting} disabled={!total || exporting}>
              {exporting ? t.exporting : t.excel}
            </AdminBtn>
            <AdminBtn size="sm" onClick={() => { setAddErr(''); setAddOpen(true); }}>
              + {isStudent ? t.addStudent : t.addFaculty}
            </AdminBtn>
          </div>
        </div>

        {/* Jadval */}
        <div className="overflow-x-auto border-t border-gray-200">
          <table className="w-full min-w-[820px] text-[13.5px]">
            <thead className="bg-gray-50/80 text-[12px] text-gray-500">
              <tr className="border-b border-gray-200">
                <SortHead k="name" label={t.name} />
                <SortHead k="id" label={t.login} />
                {isStudent ? (
                  <>
                    <th className="px-4 py-2.5 text-left font-semibold">{t.course}</th>
                    <SortHead k="group" label={t.group} />
                  </>
                ) : (
                  <>
                    <SortHead k="kafedra" label={t.kafedra} />
                    <th className="px-4 py-2.5 text-left font-semibold">{t.position}</th>
                  </>
                )}
                <th className="px-4 py-2.5 text-left font-semibold">{t.photo}</th>
                <th className="px-4 py-2.5 text-left font-semibold">{t.status}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-50 transition-opacity' : ''}>
              {rows.map((p) => (
                <tr key={p.id} className={confirmDel === p.id ? 'bg-red-50/60' : 'hover:bg-gray-50/70'}>
                  <td className={td}>
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                          p.status === 'Active' ? 'bg-indigo-50 text-indigo-700' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {(p.name || '?').charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate font-semibold text-gray-900" title={p.name}>{p.name}</span>
                    </div>
                  </td>
                  <td className={`${td} font-mono text-[12.5px] text-gray-500`}>{p.id}</td>
                  {isStudent ? (
                    <>
                      <td className={`${td} whitespace-nowrap`}>
                        {p.level_name ? <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[12px] font-semibold text-indigo-700">{p.level_name}</span> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className={td}>
                        <div className="font-medium text-gray-800">{p.group_name || t.noGroup}</div>
                        {p.direction_name ? <div className="text-[12px] text-gray-400">{p.direction_name}</div> : null}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className={`${td} max-w-[260px] truncate text-gray-700`} title={p.kafedra_name || ''}>{p.kafedra_name || <span className="text-gray-300">—</span>}</td>
                      <td className={`${td} text-gray-500`}>
                        {p.position || <span className="text-gray-300">—</span>}
                        {p.stavka ? <div className="text-[12px] text-gray-400">{p.stavka}</div> : null}
                      </td>
                    </>
                  )}
                  <td className={`${td} whitespace-nowrap`}>
                    {p.has_photo ? (
                      <span className="text-[12.5px] font-medium text-emerald-700">✓ {t.photoYes}</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[12px] font-semibold text-amber-800 ring-1 ring-amber-600/20">{t.photoNo}</span>
                    )}
                  </td>
                  <td className={td}><StatusPill status={p.status} t={t} /></td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    {confirmDel === p.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="hidden text-[12.5px] font-medium text-red-700 lg:inline">{t.delConfirm}</span>
                        <AdminBtn variant="red" size="sm" loading={delBusy} onClick={() => remove(p.id)}>{t.yesDel}</AdminBtn>
                        <AdminBtn variant="ghost" size="sm" onClick={() => setConfirmDel(null)}>{t.cancel}</AdminBtn>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <AdminBtn variant="ghost" size="sm" onClick={() => openEdit(p)}>{t.edit}</AdminBtn>
                        <AdminBtn variant="red-ghost" size="sm" onClick={() => setConfirmDel(p.id)}>{t.del}</AdminBtn>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 ? <AdminEmpty title={t.empty} /> : null}
          {loading && rows.length === 0 ? <p className="py-14 text-center text-[13.5px] text-gray-500">{t.loading}</p> : null}
        </div>

        {total > PAGE ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
            <span className="text-[12.5px] tabular-nums text-gray-500">{fmt(from)}–{fmt(to)} / {fmt(total)}</span>
            <div className="flex items-center gap-2">
              <AdminBtn variant="ghost" size="sm" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>‹ {t.prev}</AdminBtn>
              <span className="px-1 text-[13px] font-semibold tabular-nums text-gray-700">
                {Math.floor(offset / PAGE) + 1} / {Math.max(1, Math.ceil(total / PAGE))}
              </span>
              <AdminBtn variant="ghost" size="sm" disabled={offset + PAGE >= total || loading} onClick={() => setOffset(offset + PAGE)}>{t.next} ›</AdminBtn>
            </div>
          </div>
        ) : null}
      </section>

      {/* Qo'shish */}
      <AdminModal open={addOpen} onClose={() => setAddOpen(false)} title={isStudent ? t.addStudent : t.addFaculty} maxWidth="max-w-xl">
        {addErr ? <AdminAlert type="error">{addErr}</AdminAlert> : null}
        <form key={addKey} onSubmit={add} className="space-y-4" autoComplete="off">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AdminField label={t.idLabel} required><AdminInput name="id" required autoComplete="off" /></AdminField>
            <AdminField label={t.name} required><AdminInput name="name" required autoComplete="off" /></AdminField>
            <AdminField label={`${t.password} (${t.pwHint})`} required>
              <AdminInput name="password" type="password" required minLength={10} autoComplete="new-password" />
            </AdminField>
            {isStudent ? (
              <AdminField label={t.group}>
                <AdminSelect name="group_id" defaultValue={groupId}>
                  <option value="">{t.noGroup}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>{g.name} · {g.level_name}{g.direction_name ? ` · ${g.direction_name}` : ''}</option>
                  ))}
                </AdminSelect>
              </AdminField>
            ) : (
              <>
                <AdminField label={t.kafedra}>
                  <AdminSelect name="kafedra_id" defaultValue={kafedraId}>
                    <option value="">—</option>
                    {kafedras.map((k) => <option key={k.id} value={String(k.id)}>{k.name}</option>)}
                  </AdminSelect>
                </AdminField>
                <AdminField label={t.position}><AdminInput name="position" autoComplete="off" /></AdminField>
                <AdminField label={t.stavka}><AdminInput name="stavka" autoComplete="off" /></AdminField>
              </>
            )}
          </div>
          <AdminField label={t.photoLabel} required={isStudent}>
            <AdminFileInput name="profile_image" accept="image/*" buttonText={t.chooseFile} placeholder={t.noFile} />
          </AdminField>
          <div className="flex justify-end gap-2 pt-1">
            <AdminBtn variant="ghost" onClick={() => setAddOpen(false)}>{t.cancel}</AdminBtn>
            <AdminBtn type="submit" loading={addBusy}>{t.save}</AdminBtn>
          </div>
        </form>
      </AdminModal>

      {/* Tahrirlash */}
      <AdminModal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${t.editTitle} — ${editing.name}` : ''}
        subtitle={editing ? `${t.login}: ${editing.id}` : undefined}
        maxWidth="max-w-xl"
      >
        {editing ? (
          <>
            {editErr ? <AdminAlert type="error">{editErr}</AdminAlert> : null}
            {editLoading ? (
              <p className="py-8 text-center text-[14px] text-gray-400">{t.loading}</p>
            ) : (
              <form onSubmit={saveEdit} className="space-y-4" autoComplete="off">
                {/* Chrome saqlangan login/parolni ko'rinmas soxta maydonlarga yozadi. */}
                <input type="text" name="fakeuser" autoComplete="username" tabIndex={-1} aria-hidden className="hidden" />
                <input type="password" name="fakepass" autoComplete="current-password" tabIndex={-1} aria-hidden className="hidden" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <AdminField label={t.name}>
                    <AdminInput key={`nm-${editing.id}`} name="name" defaultValue={editing.name} required autoComplete="off" />
                  </AdminField>
                  <AdminField label={t.status}>
                    <AdminSelect key={`st-${editing.id}-${editing.status}`} name="status" defaultValue={editing.status}>
                      <option value="Active">{t.active}</option>
                      <option value="Banned">{t.banned}</option>
                    </AdminSelect>
                  </AdminField>
                  {isStudent ? (
                    <AdminField label={t.group} className="sm:col-span-2">
                      <AdminSelect key={`gr-${editing.id}-${editing.group_id ?? 'x'}`} name="group_id" defaultValue={editing.group_id ?? ''}>
                        <option value="">{t.noGroup}</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name} · {g.level_name}{g.direction_name ? ` · ${g.direction_name}` : ''}</option>
                        ))}
                      </AdminSelect>
                    </AdminField>
                  ) : (
                    <>
                      <AdminField label={t.kafedra} className="sm:col-span-2">
                        <AdminSelect key={`kf-${editing.id}-${editing.kafedra_id ?? 'x'}`} name="kafedra_id" defaultValue={editing.kafedra_id ?? ''}>
                          <option value="">—</option>
                          {kafedras.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                        </AdminSelect>
                      </AdminField>
                      <AdminField label={t.position}>
                        <AdminInput key={`ps-${editing.id}`} name="position" defaultValue={editing.position || ''} autoComplete="off" />
                      </AdminField>
                      <AdminField label={t.stavka}>
                        <AdminInput key={`sv-${editing.id}`} name="stavka" defaultValue={editing.stavka || ''} autoComplete="off" />
                      </AdminField>
                    </>
                  )}
                  <AdminField label={t.newPw} className="sm:col-span-2">
                    <AdminInput key={`pw-${editing.id}`} name="password" type="password" minLength={10} autoComplete="new-password" />
                  </AdminField>
                </div>
                <div className="flex items-center gap-4">
                  {photoCurrent || photoPick ? (
                    <img src={photoPick || photoCurrent || ''} alt="" className="h-16 w-16 shrink-0 rounded-2xl border border-gray-200 object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-[11px] font-semibold text-amber-800">{t.photoNo}</span>
                  )}
                  <AdminField label={t.photoLabel} className="min-w-0 flex-1">
                    <AdminFileInput key={`ph-${editing.id}`} accept="image/*" onChange={onEditPhoto} buttonText={t.chooseFile} placeholder={t.noFile} />
                  </AdminField>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <AdminBtn variant="ghost" onClick={() => setEditing(null)}>{t.cancel}</AdminBtn>
                  <AdminBtn type="submit" loading={editBusy}>{t.save}</AdminBtn>
                </div>
              </form>
            )}
          </>
        ) : null}
      </AdminModal>
    </div>
  );
}

export default PeoplePage;
