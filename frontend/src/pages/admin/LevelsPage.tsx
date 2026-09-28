import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminAlert, AdminBtn, AdminEmpty, AdminField, AdminInput, AdminModal, AdminPageMessage } from './ui';
import type { Level, Group } from './types';

interface Props {
  token: string;
  lang: Language;
  onViewGroups: (level: Level) => void;
}

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

const levelNum = (name: string) => {
  const m = /(\d+)/.exec(name || '');
  return m ? Number(m[1]) : 99;
};

/** Darajalar (kurslar) — har biri kartochka: guruh va talaba soni bilan. */
export function LevelsPage({ token, lang, onViewGroups }: Props) {
  const t = translations[lang];
  const h = useMemo(() => authHeaders(token, lang), [token, lang]);

  const [levels, setLevels] = useState<Level[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [form, setForm] = useState<{ id: number | null; name: string } | null>(null);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Level | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [rL, rG] = await Promise.all([
        fetch(apiUrl('/api/admin/levels'), { headers: h }),
        fetch(apiUrl('/api/admin/groups'), { headers: h }),
      ]);
      if (!checkAdminAuthResponse(rL) || !checkAdminAuthResponse(rG)) return;
      const [jL, jG] = await Promise.all([readJsonSafe<Level[]>(rL), readJsonSafe<Group[]>(rG)]);
      setLevels(Array.isArray(jL) ? jL : []);
      setGroups(Array.isArray(jG) ? jG : []);
    } finally {
      setLoading(false);
    }
  }, [h]);

  useEffect(() => { reload(); }, [reload]);

  const stats = useMemo(() => {
    const m = new Map<number, { groups: number; students: number; directions: Set<string> }>();
    groups.forEach((g) => {
      const c = m.get(g.level_id) || { groups: 0, students: 0, directions: new Set<string>() };
      c.groups += 1;
      c.students += Number(g.student_count || 0);
      if (g.direction_name) c.directions.add(g.direction_name);
      m.set(g.level_id, c);
    });
    return m;
  }, [groups]);

  const sorted = useMemo(() => [...levels].sort((a, b) => levelNum(a.name) - levelNum(b.name) || a.name.localeCompare(b.name)), [levels]);
  const maxStudents = Math.max(1, ...sorted.map((l) => stats.get(l.id)?.students ?? 0));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    setSaving(true);
    setFormErr('');
    try {
      const isNew = form.id == null;
      const res = await fetch(apiUrl(isNew ? '/api/admin/levels' : `/api/admin/levels/${form.id}`), {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ name: form.name.trim() }),
      });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res);
        setFormErr(d?.error || t.errorGeneric);
        return;
      }
      if (isNew) setMsg({ type: 'success', text: t.levelAddedOk });
      setForm(null);
      reload();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDel) return;
    setDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/levels/${confirmDel.id}`), { method: 'DELETE', headers: h });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res);
        setMsg({ type: 'error', text: d?.error || t.errorGeneric });
      } else reload();
    } finally {
      setDeleting(false);
      setConfirmDel(null);
    }
  };

  const delGroups = confirmDel ? stats.get(confirmDel.id)?.groups ?? 0 : 0;

  return (
    <div className="space-y-4">
      <AdminPageMessage message={msg} onDismiss={() => setMsg(null)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-gray-600">
          <b className="font-display text-[18px] font-extrabold tabular-nums text-gray-900">{levels.length}</b> {t.kontingentLevels.toLowerCase()}
          <span className="mx-2 text-gray-300">·</span>
          <b className="tabular-nums text-gray-900">{groups.length}</b> {t.kontingentGroups.toLowerCase()}
        </p>
        <AdminBtn size="sm" onClick={() => { setFormErr(''); setForm({ id: null, name: '' }); }}>+ {t.kontingentAddLevel}</AdminBtn>
      </div>

      {!loading && sorted.length === 0 ? (
        <div className={CARD}><AdminEmpty title={t.emptyLevels} subtitle={t.levelEmptyHint} /></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((lv) => {
            const s = stats.get(lv.id) || { groups: 0, students: 0, directions: new Set<string>() };
            return (
              <article key={lv.id} className={`${CARD} flex flex-col p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[19px] font-extrabold text-gray-900">{lv.name}</h3>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => { setFormErr(''); setForm({ id: lv.id, name: lv.name }); }} className="rounded-md px-2 py-1 text-[12.5px] font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-900">{t.edit}</button>
                    <button type="button" onClick={() => setConfirmDel(lv)} className="rounded-md px-2 py-1 text-[12.5px] font-semibold text-red-600 hover:bg-red-50">{t.delete}</button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div>
                    <p className="font-display text-[22px] font-extrabold leading-none tabular-nums text-gray-900">{s.students}</p>
                    <p className="mt-1 text-[12px] text-gray-500">{t.kontingentStudents}</p>
                  </div>
                  <div>
                    <p className="font-display text-[22px] font-extrabold leading-none tabular-nums text-gray-900">{s.groups}</p>
                    <p className="mt-1 text-[12px] text-gray-500">{t.kontingentGroups}</p>
                  </div>
                  <div>
                    <p className="font-display text-[22px] font-extrabold leading-none tabular-nums text-gray-900">{s.directions.size}</p>
                    <p className="mt-1 text-[12px] text-gray-500">{t.kontingentDirections}</p>
                  </div>
                </div>
                <span className="mt-4 block h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <span className="block h-full rounded-full bg-indigo-600" style={{ width: `${(s.students / maxStudents) * 100}%` }} />
                </span>
                <div className="mt-4 flex-1" />
                <AdminBtn variant="ghost" size="sm" className="w-full" onClick={() => onViewGroups(lv)}>
                  {t.kontingentGroups} →
                </AdminBtn>
              </article>
            );
          })}
        </div>
      )}

      <AdminModal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id == null ? t.kontingentAddLevel : `${t.edit} — ${form?.name}`}
        subtitle={form?.id == null ? t.levelSubtitle : undefined}
      >
        {form ? (
          <form onSubmit={save} className="space-y-4">
            {formErr ? <AdminAlert type="error">{formErr}</AdminAlert> : null}
            <AdminField label={t.levelLabel} required>
              <AdminInput autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t.levelPlaceholder} required />
            </AdminField>
            {form.id == null ? <p className="text-[12.5px] leading-relaxed text-gray-500">{t.levelHint}</p> : null}
            <div className="flex justify-end gap-2">
              <AdminBtn variant="ghost" onClick={() => setForm(null)}>{t.cancel}</AdminBtn>
              <AdminBtn type="submit" loading={saving}>{t.save}</AdminBtn>
            </div>
          </form>
        ) : null}
      </AdminModal>

      <AdminModal open={!!confirmDel} onClose={() => setConfirmDel(null)} title={t.delete}>
        {confirmDel ? (
          delGroups > 0 ? (
            <div className="space-y-4">
              <AdminAlert type="warning">{t.levelHasGroups.replace('{n}', String(delGroups))}</AdminAlert>
              <div className="flex justify-end"><AdminBtn variant="ghost" onClick={() => setConfirmDel(null)}>{t.cancel}</AdminBtn></div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[14px] text-gray-700">{t.levelDeleteConfirm.replace('{name}', confirmDel.name)}</p>
              <div className="flex justify-end gap-2">
                <AdminBtn variant="ghost" onClick={() => setConfirmDel(null)}>{t.cancel}</AdminBtn>
                <AdminBtn variant="red" loading={deleting} onClick={remove}>{t.adminDeleteBtn}</AdminBtn>
              </div>
            </div>
          )
        ) : null}
      </AdminModal>
    </div>
  );
}
