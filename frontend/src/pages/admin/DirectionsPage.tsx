import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminAlert, AdminBtn, AdminEmpty, AdminField, AdminInput, AdminModal,
  AdminPageMessage, AdminPagination, AdminSelect, usePagedList,
} from './ui';
import type { Direction, Group, Kafedra } from './types';

interface Props {
  token: string;
  lang: Language;
}

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

/** Yo'nalishlar — bir yoki bir nechta kafedraga bog'lanadi; guruhlar yo'nalishga. */
export function DirectionsPage({ token, lang }: Props) {
  const t = translations[lang];
  const h = useMemo(() => authHeaders(token, lang), [token, lang]);

  const [directions, setDirections] = useState<Direction[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [kafedralar, setKafedralar] = useState<Kafedra[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [kafF, setKafF] = useState('');
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [form, setForm] = useState<{ id: number | null; name: string; kafedraIds: number[] } | null>(null);
  const [kafQ, setKafQ] = useState('');
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Direction | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [rD, rG, rK] = await Promise.all([
        fetch(apiUrl('/api/admin/directions'), { headers: h }),
        fetch(apiUrl('/api/admin/groups'), { headers: h }),
        fetch(apiUrl('/api/admin/kafedralar'), { headers: h }),
      ]);
      if (!checkAdminAuthResponse(rD) || !checkAdminAuthResponse(rG) || !checkAdminAuthResponse(rK)) return;
      const [jD, jG, jK] = await Promise.all([readJsonSafe<Direction[]>(rD), readJsonSafe<Group[]>(rG), readJsonSafe<Kafedra[]>(rK)]);
      setDirections(Array.isArray(jD) ? jD : []);
      setGroups(Array.isArray(jG) ? jG : []);
      setKafedralar(Array.isArray(jK) ? jK : []);
    } finally {
      setLoading(false);
    }
  }, [h]);

  useEffect(() => { reload(); }, [reload]);

  const groupCount = useMemo(() => {
    const m = new Map<number, { groups: number; students: number }>();
    groups.forEach((g) => {
      if (!g.direction_id) return;
      const c = m.get(g.direction_id) || { groups: 0, students: 0 };
      c.groups += 1;
      c.students += Number(g.student_count || 0);
      m.set(g.direction_id, c);
    });
    return m;
  }, [groups]);

  const kafIdsOf = (d: Direction) => (d.kafedra_ids?.length ? d.kafedra_ids : d.kafedra_id ? [d.kafedra_id] : []);
  const kafNamesOf = (d: Direction) => (d.kafedra_names?.length ? d.kafedra_names : d.kafedra_name ? [d.kafedra_name] : []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return directions.filter((d) => {
      if (kafF && !kafIdsOf(d).map(String).includes(kafF)) return false;
      return !n || d.name.toLowerCase().includes(n) || kafNamesOf(d).join(' ').toLowerCase().includes(n);
    });
  }, [directions, q, kafF]);
  const page = usePagedList(filtered, 25);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    setSaving(true);
    setFormErr('');
    try {
      const isNew = form.id == null;
      const res = await fetch(apiUrl(isNew ? '/api/admin/directions' : `/api/admin/directions/${form.id}`), {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ name: form.name.trim(), kafedra_ids: form.kafedraIds }),
      });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res);
        setFormErr(d?.error || t.errorGeneric);
        return;
      }
      if (isNew) setMsg({ type: 'success', text: t.directionAddedOk });
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
      const res = await fetch(apiUrl(`/api/admin/directions/${confirmDel.id}`), { method: 'DELETE', headers: h });
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

  const kafChoices = kafedralar.filter((k) => !kafQ.trim() || k.name.toLowerCase().includes(kafQ.trim().toLowerCase()));
  const delGroups = confirmDel ? groupCount.get(confirmDel.id)?.groups ?? 0 : 0;

  return (
    <div className="space-y-4">
      <AdminPageMessage message={msg} onDismiss={() => setMsg(null)} />

      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <p className="text-[13.5px] text-gray-600">
            <b className="font-display text-[18px] font-extrabold tabular-nums text-gray-900">{filtered.length}</b>
            {filtered.length !== directions.length ? <span className="text-gray-400"> / {directions.length}</span> : null} {t.kontingentDirections.toLowerCase()}
          </p>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <AdminSelect value={kafF} onChange={(e) => setKafF(e.target.value)} className="h-9 sm:w-64">
              <option value="">{t.kontingentKafedralar}: —</option>
              {kafedralar.map((k) => <option key={k.id} value={String(k.id)}>{k.name}</option>)}
            </AdminSelect>
            <AdminInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="…" className="h-9 sm:w-56" />
            <AdminBtn size="sm" onClick={() => { setFormErr(''); setKafQ(''); setForm({ id: null, name: '', kafedraIds: kafF ? [Number(kafF)] : [] }); }}>
              + {t.kontingentAddDirection}
            </AdminBtn>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead className="bg-gray-50/80 text-[12px] text-gray-500">
              <tr className="border-b border-gray-200 text-left">
                <th className="w-12 px-4 py-2.5 font-semibold">№</th>
                <th className="px-4 py-2.5 font-semibold">{t.directionLabel}</th>
                <th className="px-4 py-2.5 font-semibold">{t.kontingentKafedralar}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t.kontingentGroups}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t.kontingentStudents}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {page.pageItems.map((d, i) => {
                const c = groupCount.get(d.id) || { groups: 0, students: 0 };
                const names = kafNamesOf(d);
                return (
                  <tr key={d.id} className="hover:bg-gray-50/70">
                    <td className="border-b border-gray-100 px-4 py-3 tabular-nums text-gray-400">{(page.page - 1) * page.pageSize + i + 1}</td>
                    <td className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-900">{d.name}</td>
                    <td className="border-b border-gray-100 px-4 py-3">
                      {names.length ? (
                        <div className="flex max-w-[420px] flex-wrap gap-1">
                          {names.slice(0, 3).map((n) => <span key={n} className="rounded-md bg-gray-100 px-2 py-0.5 text-[12px] text-gray-700">{n}</span>)}
                          {names.length > 3 ? <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[12px] text-gray-500" title={names.join(', ')}>+{names.length - 3}</span> : null}
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums">{c.groups}</td>
                    <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums text-gray-600">{c.students}</td>
                    <td className="border-b border-gray-100 px-4 py-3 text-right whitespace-nowrap">
                      <AdminBtn variant="ghost" size="sm" onClick={() => { setFormErr(''); setKafQ(''); setForm({ id: d.id, name: d.name, kafedraIds: kafIdsOf(d) }); }}>{t.edit}</AdminBtn>
                      <AdminBtn variant="red-ghost" size="sm" className="ml-2" onClick={() => setConfirmDel(d)}>{t.delete}</AdminBtn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && filtered.length === 0 ? <AdminEmpty title={t.emptyDirections} subtitle={directions.length ? undefined : t.directionEmptyHint} /> : null}
        </div>
        <AdminPagination page={page.page} totalPages={page.totalPages} onPageChange={page.setPage} total={page.total} pageSize={page.pageSize} />
      </section>

      <AdminModal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id == null ? t.kontingentAddDirection : `${t.edit} — ${form?.name}`}
        subtitle={form?.id == null ? t.directionSubtitle : undefined}
        maxWidth="max-w-xl"
      >
        {form ? (
          <form onSubmit={save} className="space-y-4">
            {formErr ? <AdminAlert type="error">{formErr}</AdminAlert> : null}
            <AdminField label={t.directionLabel} required>
              <AdminInput autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t.directionPlaceholder} required />
            </AdminField>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-gray-600">{t.directionKafedraLabel}</span>
                <span className="text-[12px] font-semibold text-indigo-700">{form.kafedraIds.length}</span>
              </div>
              <AdminInput type="search" value={kafQ} onChange={(e) => setKafQ(e.target.value)} placeholder="…" className="mb-2 h-9" />
              <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-gray-200 p-1.5">
                {kafChoices.length === 0 ? (
                  <p className="px-2 py-1.5 text-[12.5px] text-gray-400">{t.directionKafedraNone}</p>
                ) : kafChoices.map((k) => {
                  const on = form.kafedraIds.includes(k.id);
                  return (
                    <label key={k.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] ${on ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700 hover:bg-gray-50'}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--color-indigo-600)]"
                        checked={on}
                        onChange={() => setForm({ ...form, kafedraIds: on ? form.kafedraIds.filter((x) => x !== k.id) : [...form.kafedraIds, k.id] })}
                      />
                      <span className="truncate">{k.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            {form.id == null ? <p className="text-[12.5px] leading-relaxed text-gray-500">{t.directionHint}</p> : null}
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
              <AdminAlert type="warning">{t.directionHasGroups.replace('{n}', String(delGroups))}</AdminAlert>
              <div className="flex justify-end"><AdminBtn variant="ghost" onClick={() => setConfirmDel(null)}>{t.cancel}</AdminBtn></div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[14px] text-gray-700">{t.directionDeleteConfirm.replace('{name}', confirmDel.name)}</p>
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
