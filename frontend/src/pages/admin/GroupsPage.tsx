import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminAlert, AdminBtn, AdminEmpty, AdminField, AdminInput, AdminModal,
  AdminPageMessage, AdminPagination, AdminSelect, usePagedList,
} from './ui';
import type { Level, Direction, Group } from './types';

interface Props {
  token: string;
  lang: Language;
  initialLevelId?: number | null;
  onViewStudents: (group: Group) => void;
}

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

const levelNum = (name: string) => {
  const m = /(\d+)/.exec(name || '');
  return m ? Number(m[1]) : 99;
};

type FormState = {
  name: string; levelId: string; directionId: string; track: string; year: string; intake: string;
};

/** Guruhlar — kurs chiplari, yo'nalish filtri, qidiruv va jadval. */
export function GroupsPage({ token, lang, initialLevelId, onViewStudents }: Props) {
  const t = translations[lang];
  const h = useMemo(() => authHeaders(token, lang), [token, lang]);
  const trackLabel = (track?: string | null) =>
    track === 'residency' ? t.trackResidency : track === 'master' ? t.trackMaster : t.trackBachelor;

  const [levels, setLevels] = useState<Level[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelF, setLevelF] = useState(initialLevelId ? String(initialLevelId) : '');
  const [dirF, setDirF] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [addForm, setAddForm] = useState<FormState | null>(null);
  const [edit, setEdit] = useState<{ id: number; name: string } | null>(null);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Group | null>(null);
  const [needForce, setNeedForce] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [rL, rD, rG] = await Promise.all([
        fetch(apiUrl('/api/admin/levels'), { headers: h }),
        fetch(apiUrl('/api/admin/directions'), { headers: h }),
        fetch(apiUrl('/api/admin/groups'), { headers: h }),
      ]);
      if (!checkAdminAuthResponse(rL) || !checkAdminAuthResponse(rD) || !checkAdminAuthResponse(rG)) return;
      const [jL, jD, jG] = await Promise.all([readJsonSafe<Level[]>(rL), readJsonSafe<Direction[]>(rD), readJsonSafe<Group[]>(rG)]);
      setLevels(Array.isArray(jL) ? jL : []);
      setDirections(Array.isArray(jD) ? jD : []);
      setGroups(Array.isArray(jG) ? jG : []);
    } finally {
      setLoading(false);
    }
  }, [h]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (initialLevelId) setLevelF(String(initialLevelId)); }, [initialLevelId]);

  const sortedLevels = useMemo(() => [...levels].sort((a, b) => levelNum(a.name) - levelNum(b.name)), [levels]);
  const levelCounts = useMemo(() => {
    const m = new Map<number, number>();
    groups.forEach((g) => m.set(g.level_id, (m.get(g.level_id) || 0) + 1));
    return m;
  }, [groups]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return groups
      .filter((g) => (!levelF || String(g.level_id) === levelF) && (!dirF || String(g.direction_id ?? '') === dirF) && (!n || g.name.toLowerCase().includes(n)))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [groups, levelF, dirF, q]);
  const page = usePagedList(filtered, 50);
  const shownStudents = filtered.reduce((s, g) => s + Number(g.student_count || 0), 0);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm) return;
    if (!addForm.levelId) { setFormErr(t.emptyLevels); return; }
    if (!addForm.name.trim()) return;
    setSaving(true);
    setFormErr('');
    try {
      const body: Record<string, unknown> = {
        name: addForm.name.trim(),
        level_id: Number(addForm.levelId),
        direction_id: addForm.directionId ? Number(addForm.directionId) : null,
        program_track: addForm.track,
      };
      if (addForm.year.trim()) body.academic_year = Number(addForm.year);
      if (addForm.intake.trim()) body.intake_year = Number(addForm.intake);
      const res = await fetch(apiUrl('/api/admin/groups'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body),
      });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res);
        setFormErr(d?.error || t.errorGeneric);
        return;
      }
      setMsg({ type: 'success', text: t.groupAddedOk });
      setAddForm(null);
      reload();
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit || !edit.name.trim()) return;
    setSaving(true);
    setFormErr('');
    try {
      const res = await fetch(apiUrl(`/api/admin/groups/${edit.id}`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ name: edit.name.trim() }),
      });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res);
        setFormErr(d?.error || t.errorGeneric);
        return;
      }
      setEdit(null);
      reload();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (force: boolean) => {
    if (!confirmDel) return;
    setDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/groups/${confirmDel.id}`), {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ force }),
      });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string; requires_force?: boolean }>(res);
        if (d?.requires_force) { setNeedForce(true); return; }
        setMsg({ type: 'error', text: d?.error || t.errorGeneric });
        setConfirmDel(null);
        return;
      }
      setConfirmDel(null);
      reload();
    } finally {
      setDeleting(false);
    }
  };

  const chip = (on: boolean) =>
    `h-9 rounded-full px-4 text-[13px] font-semibold transition-colors ${on ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:ring-gray-300'}`;

  return (
    <div className="space-y-4">
      <AdminPageMessage message={msg} onDismiss={() => setMsg(null)} />

      <div className="flex flex-wrap gap-2">
        <button type="button" className={chip(!levelF)} onClick={() => setLevelF('')}>
          {t.allLevels} <span className={`ml-1 tabular-nums ${!levelF ? 'text-white/70' : 'text-gray-400'}`}>{groups.length}</span>
        </button>
        {sortedLevels.map((l) => {
          const on = levelF === String(l.id);
          return (
            <button key={l.id} type="button" className={chip(on)} onClick={() => setLevelF(String(l.id))}>
              {l.name} <span className={`ml-1 tabular-nums ${on ? 'text-white/70' : 'text-gray-400'}`}>{levelCounts.get(l.id) || 0}</span>
            </button>
          );
        })}
      </div>

      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <p className="text-[13.5px] text-gray-600">
            <b className="font-display text-[18px] font-extrabold tabular-nums text-gray-900">{filtered.length}</b> {t.kontingentGroups.toLowerCase()}
            <span className="mx-2 text-gray-300">·</span>
            <b className="tabular-nums text-gray-900">{shownStudents}</b> {t.kontingentStudents.toLowerCase()}
          </p>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <AdminSelect value={dirF} onChange={(e) => setDirF(e.target.value)} className="h-9 sm:w-56">
              <option value="">{t.kontingentDirections}: —</option>
              {directions.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
            </AdminSelect>
            <AdminInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="…" className="h-9 sm:w-48" />
            <AdminBtn
              size="sm"
              onClick={() => { setFormErr(''); setAddForm({ name: '', levelId: levelF, directionId: dirF, track: 'bachelor', year: '', intake: '' }); }}
            >
              + {t.kontingentAddGroup}
            </AdminBtn>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13.5px]">
            <thead className="bg-gray-50/80 text-[12px] text-gray-500">
              <tr className="border-b border-gray-200 text-left">
                <th className="px-4 py-2.5 font-semibold">{t.groupName}</th>
                <th className="px-4 py-2.5 font-semibold">{t.levelLabel}</th>
                <th className="px-4 py-2.5 font-semibold">{t.directionLabel}</th>
                <th className="px-4 py-2.5 font-semibold">{t.programTrack}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t.kontingentStudents}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {page.pageItems.map((g) => (
                <tr key={g.id} className="hover:bg-gray-50/70">
                  <td className="border-b border-gray-100 px-4 py-3">
                    <span className="font-semibold text-gray-900">{g.name}</span>
                    {g.is_active === false ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-800">{t.groupGraduated}</span> : null}
                  </td>
                  <td className="border-b border-gray-100 px-4 py-3 whitespace-nowrap"><span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[12px] font-semibold text-indigo-700">{g.level_name}</span></td>
                  <td className="border-b border-gray-100 px-4 py-3 text-gray-600">{g.direction_name || <span className="text-gray-300">—</span>}</td>
                  <td className="border-b border-gray-100 px-4 py-3 text-[12.5px] text-gray-500">
                    {trackLabel(g.program_track)}
                    {g.intake_year != null ? <span className="text-gray-400"> · {g.intake_year}</span> : null}
                  </td>
                  <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums">
                    <button type="button" onClick={() => onViewStudents(g)} className="font-semibold text-indigo-700 hover:underline" title={t.kontingentStudents}>
                      {g.student_count ?? 0}
                    </button>
                  </td>
                  <td className="border-b border-gray-100 px-4 py-3 text-right whitespace-nowrap">
                    <AdminBtn variant="ghost" size="sm" onClick={() => { setFormErr(''); setEdit({ id: g.id, name: g.name }); }}>{t.edit}</AdminBtn>
                    <AdminBtn variant="red-ghost" size="sm" className="ml-2" onClick={() => { setNeedForce(false); setConfirmDel(g); }}>{t.delete}</AdminBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filtered.length === 0 ? <AdminEmpty title={t.groupsEmpty} /> : null}
        </div>
        <AdminPagination page={page.page} totalPages={page.totalPages} onPageChange={page.setPage} total={page.total} pageSize={page.pageSize} />
      </section>

      <AdminModal open={!!addForm} onClose={() => setAddForm(null)} title={t.kontingentAddGroup} subtitle={t.groupsAddSubtitle} maxWidth="max-w-xl">
        {addForm ? (
          <form onSubmit={add} className="space-y-4">
            {formErr ? <AdminAlert type="error">{formErr}</AdminAlert> : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AdminField label={t.levelLabel} required>
                <AdminSelect value={addForm.levelId} onChange={(e) => setAddForm({ ...addForm, levelId: e.target.value })} required>
                  <option value="">—</option>
                  {sortedLevels.map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
                </AdminSelect>
              </AdminField>
              <AdminField label={t.directionLabel}>
                <AdminSelect value={addForm.directionId} onChange={(e) => setAddForm({ ...addForm, directionId: e.target.value })}>
                  <option value="">{t.directionNone}</option>
                  {directions.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
                </AdminSelect>
              </AdminField>
              <AdminField label={t.groupName} required className="sm:col-span-2">
                <AdminInput autoFocus value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="A-guruh" required />
              </AdminField>
              <AdminField label={t.programTrack}>
                <AdminSelect value={addForm.track} onChange={(e) => setAddForm({ ...addForm, track: e.target.value })}>
                  <option value="bachelor">{t.trackBachelor}</option>
                  <option value="residency">{t.trackResidency}</option>
                  <option value="master">{t.trackMaster}</option>
                </AdminSelect>
              </AdminField>
              <div className="grid grid-cols-2 gap-3">
                <AdminField label={t.academicYear}>
                  <AdminInput type="number" min={1} max={6} value={addForm.year} onChange={(e) => setAddForm({ ...addForm, year: e.target.value })} placeholder="1–6" />
                </AdminField>
                <AdminField label={t.intakeYear}>
                  <AdminInput type="number" min={2000} max={2100} value={addForm.intake} onChange={(e) => setAddForm({ ...addForm, intake: e.target.value })} placeholder="2025" />
                </AdminField>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <AdminBtn variant="ghost" onClick={() => setAddForm(null)}>{t.cancel}</AdminBtn>
              <AdminBtn type="submit" loading={saving}>{t.groupAddBtn}</AdminBtn>
            </div>
          </form>
        ) : null}
      </AdminModal>

      <AdminModal open={!!edit} onClose={() => setEdit(null)} title={edit ? `${t.edit} — ${edit.name}` : ''}>
        {edit ? (
          <form onSubmit={saveEdit} className="space-y-4">
            {formErr ? <AdminAlert type="error">{formErr}</AdminAlert> : null}
            <AdminField label={t.groupName} required>
              <AdminInput autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
            </AdminField>
            <div className="flex justify-end gap-2">
              <AdminBtn variant="ghost" onClick={() => setEdit(null)}>{t.cancel}</AdminBtn>
              <AdminBtn type="submit" loading={saving}>{t.save}</AdminBtn>
            </div>
          </form>
        ) : null}
      </AdminModal>

      <AdminModal open={!!confirmDel} onClose={() => setConfirmDel(null)} title={t.delete}>
        {confirmDel ? (
          <div className="space-y-4">
            {needForce ? (
              <AdminAlert type="warning">
                {(confirmDel.student_count ?? 0) > 0
                  ? t.groupHasStudents.replace('{n}', String(confirmDel.student_count))
                  : t.groupDeleteConfirm.replace('{name}', confirmDel.name)}
              </AdminAlert>
            ) : (
              <p className="text-[14px] text-gray-700">{t.groupDeleteConfirm.replace('{name}', confirmDel.name)}</p>
            )}
            <div className="flex justify-end gap-2">
              <AdminBtn variant="ghost" onClick={() => setConfirmDel(null)}>{t.cancel}</AdminBtn>
              <AdminBtn variant="red" loading={deleting} onClick={() => remove(needForce)}>
                {needForce ? t.groupDeleteForce : t.adminDeleteBtn}
              </AdminBtn>
            </div>
          </div>
        ) : null}
      </AdminModal>
    </div>
  );
}
