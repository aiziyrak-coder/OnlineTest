import { useCallback, useEffect, useMemo, useState } from 'react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminBtn, AdminInput, AdminModal } from './ui';

/**
 * Ruxsat berish — ro'yxatdan tanlab.
 *
 * Ismni qo'lda yozish o'rniga: filtr (rol, kurs, kafedra, holat) + qidiruv,
 * belgilab tanlash va bitta tugma bilan ruxsat berish. Ro'yxatda yo'q odamni
 * shu yerdan qo'shib, darhol ruxsat berish ham mumkin.
 */

interface ExamOpt { id: number; title: string; open?: boolean }
interface HistoryRow { exam_id: number; exam_title: string; status: string; score: number | null }
interface PersonRow {
  id: string;
  name: string;
  course: number;
  kafedra: string;
  kafedra_id: number | null;
  has_photo: boolean;
  state: 'none' | 'has_access' | 'done';
  exams: ExamOpt[];
  history: HistoryRow[];
}
interface GrantRow { user_id: string; name?: string; ok: boolean; error?: string; exam_title?: string }

const TX = {
  uz: {
    title: 'Ruxsat berish',
    hint: 'Ro‘yxatdan kerakli odamlarni belgilang, imtihonini tekshiring va ruxsat bering.',
    search: 'Qidirish: familiya, ism yoki login',
    role: 'Toifa', course: 'Kurs', kafedra: 'Kafedra', state: 'Holat',
    all: 'Hammasi', ordinator: 'Ordinator', magistr: 'Magistr', vacancy: 'Ishga kiruvchi',
    entrant: 'Abituriyent', faculty: 'O‘qituvchi', student: 'Talaba (harbiy va b.)',
    needQuery: 'Talabani topish uchun familiya, ism yoki login yozing.',
    none: 'Ruxsati yo‘q', has_access: 'Ruxsati bor', done: 'Topshirgan / chetlatilgan',
    person: 'Kim', exam: 'Imtihon', st: 'Holat', selectAll: 'Barchasini belgilash',
    grant: 'Ruxsat berish', granting: 'Berilmoqda…', selected: 'tanlandi',
    openToday: 'Imtihon yopiq bo‘lsa, bugun 18:00 gacha ochilsin',
    add: '+ Yangi odam qo‘shish', addTitle: 'Yangi topshiruvchi',
    fId: 'Login (JSHSHIR yoki ordinator raqami)', fName: 'F.I.Sh', fCourse: 'Kurs', fKaf: 'Kafedra',
    save: 'Qo‘shish', cancel: 'Bekor qilish',
    loading: 'Yuklanmoqda…', empty: 'Hech kim topilmadi', failed: 'Bajarilmadi',
    result: 'Natija', noExam: 'Mos imtihon yo‘q', photoNo: 'rasmi yo‘q', found: 'ta odam',
    grantOne: 'Ruxsat ber', chooseExam: 'imtihonni tanlang',
  },
  ru: {
    title: 'Выдача доступа',
    hint: 'Отметьте нужных людей в списке, проверьте экзамен и выдайте доступ.',
    search: 'Поиск: фамилия, имя или логин',
    role: 'Категория', course: 'Курс', kafedra: 'Кафедра', state: 'Статус',
    all: 'Все', ordinator: 'Ординатор', magistr: 'Магистр', vacancy: 'Соискатель',
    entrant: 'Абитуриент', faculty: 'Преподаватель', student: 'Студент (военные и др.)',
    needQuery: 'Введите фамилию, имя или логин, чтобы найти студента.',
    none: 'Без доступа', has_access: 'Доступ есть', done: 'Сдал / отстранён',
    person: 'Кто', exam: 'Экзамен', st: 'Статус', selectAll: 'Отметить всех',
    grant: 'Выдать доступ', granting: 'Выдаётся…', selected: 'выбрано',
    openToday: 'Если экзамен закрыт — открыть сегодня до 18:00',
    add: '+ Добавить человека', addTitle: 'Новый экзаменуемый',
    fId: 'Логин (ПИНФЛ или номер)', fName: 'Ф.И.О.', fCourse: 'Курс', fKaf: 'Кафедра',
    save: 'Добавить', cancel: 'Отмена',
    loading: 'Загрузка…', empty: 'Никого не найдено', failed: 'Не выполнено',
    result: 'Результат', noExam: 'Нет экзамена', photoNo: 'нет фото', found: 'чел.',
    grantOne: 'Выдать', chooseExam: 'выберите экзамен',
  },
  en: {
    title: 'Grant access',
    hint: 'Tick the people you need, check the exam and grant access.',
    search: 'Search: surname, name or login',
    role: 'Category', course: 'Course', kafedra: 'Department', state: 'Status',
    all: 'All', ordinator: 'Resident', magistr: 'Master', vacancy: 'Job applicant',
    entrant: 'Entrant', faculty: 'Teacher', student: 'Student (military etc.)',
    needQuery: 'Type a surname, name or login to find a student.',
    none: 'No access', has_access: 'Has access', done: 'Completed / banned',
    person: 'Person', exam: 'Exam', st: 'Status', selectAll: 'Select all',
    grant: 'Grant access', granting: 'Granting…', selected: 'selected',
    openToday: 'If the exam is closed, open it today until 18:00',
    add: '+ Add a person', addTitle: 'New examinee',
    fId: 'Login (PINFL or ID)', fName: 'Full name', fCourse: 'Course', fKaf: 'Department',
    save: 'Add', cancel: 'Cancel',
    loading: 'Loading…', empty: 'Nobody found', failed: 'Failed',
    result: 'Result', noExam: 'No exam', photoNo: 'no photo', found: 'people',
    grantOne: 'Grant', chooseExam: 'choose an exam',
  },
} as const;

const ROLES = ['ordinator', 'magistr', 'vacancy', 'entrant', 'faculty', 'student'] as const;

export function BulkAccessPage({ token, lang }: { token: string; lang: Language }) {
  const t = TX[lang] || TX.uz;
  const [role, setRole] = useState<string>('ordinator');
  const [course, setCourse] = useState('');
  const [kafedra, setKafedra] = useState('');
  const [state, setState] = useState('none');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [kafs, setKafs] = useState<{ id: number; name: string }[]>([]);
  const [courses, setCourses] = useState<number[]>([]);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [pick, setPick] = useState<Record<string, number>>({});
  const [openToday, setOpenToday] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<GrantRow[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', course: '', kafedra_id: '' });

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      const p = new URLSearchParams({ role });
      if (course) p.set('course', course);
      if (kafedra) p.set('kafedra_id', kafedra);
      if (state) p.set('state', state);
      if (q.trim()) p.set('q', q.trim());
      const res = await fetch(apiUrl(`/api/admin/bulk-access/people?${p.toString()}`), {
        headers: authHeaders(token, lang),
      });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<{ rows: PersonRow[]; kafedras: { id: number; name: string }[]; courses: number[] }>(res);
      if (!res.ok || !j) { setErr(t.failed); return; }
      setRows(j.rows || []);
      if (!kafedra) setKafs(j.kafedras || []);
      if (!course) setCourses(j.courses || []);
      setPick((prev) => {
        const next = { ...prev };
        for (const r of j.rows || []) {
          if (next[r.id]) continue;
          // Faqat bitta OCHIQ imtihon bo'lsa o'zi tanlanadi; bir nechtasi bo'lsa
          // admin o'zi tanlaydi (noto'g'ri fan tushib qolmasligi uchun).
          const open = r.exams.filter((e) => e.open);
          if (open.length === 1) next[r.id] = open[0].id;
        }
        return next;
      });
    } catch {
      setErr(t.failed);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, course, kafedra, state, q, token, lang]);

  useEffect(() => { void load(); }, [load]);

  const chosen = useMemo(
    () => (rows || []).filter((r) => sel[r.id] && pick[r.id] && r.state !== 'done'),
    [rows, sel, pick],
  );

  const send = useCallback(async (items: { user_id: string; exam_id: number }[]) => {
    if (!items.length) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch(apiUrl('/api/admin/bulk-access/grant'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({ open_today: openToday, items }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<{ results: GrantRow[] }>(res);
      if (!res.ok || !j) { setErr(t.failed); return; }
      setDone(j.results || []);
      setSel({});
      await load();
    } catch {
      setErr(t.failed);
    } finally {
      setBusy(false);
    }
  }, [openToday, token, lang, t, load]);

  const grant = useCallback(
    () => send(chosen.map((r) => ({ user_id: r.id, exam_id: pick[r.id] }))),
    [send, chosen, pick],
  );

  const addPerson = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      const res = await fetch(apiUrl('/api/admin/examinees'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({
          id: form.id.trim(), name: form.name.trim(), role,
          course: Number(form.course || 0) || 0,
          kafedra_id: Number(form.kafedra_id || 0) || null,
        }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) { setErr(j?.error || t.failed); return; }
      setAddOpen(false);
      setForm({ id: '', name: '', course: '', kafedra_id: '' });
      setQ(form.id.trim());
      setState('');
      await load();
    } catch {
      setErr(t.failed);
    } finally {
      setBusy(false);
    }
  }, [form, role, token, lang, t, load]);

  const badge = (s: PersonRow['state']) => {
    const cls = s === 'none'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
      : s === 'has_access'
        ? 'bg-sky-50 text-sky-700 ring-sky-600/20'
        : 'bg-gray-100 text-gray-600 ring-gray-500/20';
    return <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ring-1 ${cls}`}>{t[s]}</span>;
  };

  const sl = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[13px] text-gray-700';

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 p-1">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t.title}</h2>
          <p className="mt-1 text-[13px] text-gray-500">{t.hint}</p>
        </div>
        <AdminBtn variant="ghost" onClick={() => setAddOpen(true)}>{t.add}</AdminBtn>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={sl} value={role} onChange={(e) => { setRole(e.target.value); setKafedra(''); setCourse(''); }}>
          {ROLES.map((r) => <option key={r} value={r}>{t[r]}</option>)}
        </select>
        <select className={sl} value={course} onChange={(e) => setCourse(e.target.value)}>
          <option value="">{t.course}: {t.all}</option>
          {courses.map((c) => <option key={c} value={c}>{c}-kurs</option>)}
        </select>
        <select className={sl} value={kafedra} onChange={(e) => setKafedra(e.target.value)}>
          <option value="">{t.kafedra}: {t.all}</option>
          {kafs.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <select className={sl} value={state} onChange={(e) => setState(e.target.value)}>
          <option value="none">{t.none}</option>
          <option value="has_access">{t.has_access}</option>
          <option value="done">{t.done}</option>
          <option value="">{t.state}: {t.all}</option>
        </select>
        <input
          className={`${sl} min-w-[16rem] flex-1`}
          placeholder={t.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-[12px] text-gray-500">{rows ? `${rows.length} ${t.found}` : ''}</span>
      </div>

      {err ? <div className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{err}</div> : null}

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-[13px]">
          <thead className="bg-gray-50 text-left text-[12px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  title={t.selectAll}
                  checked={Boolean(rows?.length) && rows!.filter((r) => r.state !== 'done').every((r) => sel[r.id])}
                  onChange={(e) => {
                    const on = e.target.checked;
                    const next: Record<string, boolean> = {};
                    for (const r of rows || []) if (r.state !== 'done') next[r.id] = on;
                    setSel(next);
                  }}
                />
              </th>
              <th className="px-3 py-2">{t.person}</th>
              <th className="px-3 py-2">{t.exam}</th>
              <th className="px-3 py-2">{t.st}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {busy && !rows ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">{t.loading}</td></tr>
            ) : null}
            {rows && rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">{t.empty}</td></tr>
            ) : null}
            {(rows || []).map((r) => (
              <tr key={r.id} className="align-top hover:bg-gray-50/60">
                <td className="px-3 py-2">
                  {r.state !== 'done' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(sel[r.id])}
                      onChange={(e) => setSel((s) => ({ ...s, [r.id]: e.target.checked }))}
                    />
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{r.name}</div>
                  <div className="text-[12px] text-gray-500">
                    {r.id} · {r.kafedra}{r.course ? ` · ${r.course}-kurs` : ''}
                    {r.has_photo ? '' : ` · ${t.photoNo}`}
                  </div>
                  {r.history.length ? (
                    <div className="mt-0.5 text-[12px] text-gray-500">
                      {r.history.map((h) => `${h.exam_title.slice(0, 38)} — ${h.status}${h.score != null ? ` (${h.score})` : ''}`).join(' · ')}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {r.exams.length ? (
                    <select
                      value={pick[r.id] || ''}
                      onChange={(e) => setPick((p) => ({ ...p, [r.id]: Number(e.target.value) }))}
                      className="w-full max-w-[24rem] rounded-lg border border-gray-200 px-2 py-1 text-[13px]"
                    >
                      <option value="">— {t.chooseExam} —</option>
                      {r.exams.map((e) => (
                        <option key={e.id} value={e.id}>{e.open ? '● ' : '○ '}{e.title}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[12px] text-rose-600">{t.noExam}</span>
                  )}
                </td>
                <td className="px-3 py-2">{badge(r.state)}</td>
                <td className="px-3 py-2 text-right">
                  {r.state !== 'done' && r.exams.length ? (
                    <AdminBtn
                      variant="emerald"
                      size="sm"
                      disabled={busy || !pick[r.id]}
                      onClick={() => send([{ user_id: r.id, exam_id: pick[r.id] }])}
                    >
                      {t.grantOne}
                    </AdminBtn>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <AdminBtn variant="emerald" onClick={grant} disabled={busy || !chosen.length}>
          {busy && done === null ? t.granting : `${t.grant} (${chosen.length} ${t.selected})`}
        </AdminBtn>
        <label className="flex items-center gap-2 text-[13px] text-gray-600">
          <input type="checkbox" checked={openToday} onChange={(e) => setOpenToday(e.target.checked)} />
          {t.openToday}
        </label>
      </div>

      {done ? (
        <div className="rounded-xl border border-gray-200 p-3">
          <div className="mb-2 text-[13px] font-semibold text-gray-900">{t.result}</div>
          <ul className="space-y-1 text-[13px]">
            {done.map((d, i) => (
              <li key={`${d.user_id}-${i}`} className={d.ok ? 'text-emerald-700' : 'text-rose-700'}>
                {d.ok ? '✓' : '✕'} {d.name || d.user_id} {d.ok ? `— ${d.exam_title}` : `— ${d.error || ''}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <AdminModal open={addOpen} title={t.addTitle} onClose={() => setAddOpen(false)}>
          <div className="space-y-2">
            <label className="block text-[13px] text-gray-600">{t.fId}
              <AdminInput className="mt-1" value={form.id} onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} />
            </label>
            <label className="block text-[13px] text-gray-600">{t.fName}
              <AdminInput className="mt-1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="block text-[13px] text-gray-600">{t.fCourse}
              <AdminInput className="mt-1" inputMode="numeric" value={form.course} onChange={(e) => setForm((f) => ({ ...f, course: e.target.value }))} />
            </label>
            <label className="block text-[13px] text-gray-600">
              {t.fKaf}
              <select
                className={`${sl} mt-1 w-full`}
                value={form.kafedra_id}
                onChange={(e) => setForm((f) => ({ ...f, kafedra_id: e.target.value }))}
              >
                <option value="">—</option>
                {kafs.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </label>
            <p className="text-[12px] text-gray-500">Parol login bilan bir xil qilib yaratiladi.</p>
            <div className="flex gap-2 pt-1">
              <AdminBtn variant="blue" onClick={addPerson} disabled={busy || form.id.trim().length < 5 || form.name.trim().length < 3}>
                {t.save}
              </AdminBtn>
              <AdminBtn variant="ghost" onClick={() => setAddOpen(false)}>{t.cancel}</AdminBtn>
            </div>
          </div>
      </AdminModal>
    </div>
  );
}
