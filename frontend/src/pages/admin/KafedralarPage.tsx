import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminAlert, AdminBtn, AdminEmpty, AdminField, AdminInput, AdminModal,
  AdminPageMessage, AdminPagination, usePagedList,
} from './ui';
import type { Kafedra } from './types';

interface Props {
  token: string;
  lang: Language;
}

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

/** Kafedralar — Kafedra → Yo'nalish → Guruh → Talaba zanjirining boshi. */
export function KafedralarPage({ token, lang }: Props) {
  const t = translations[lang];
  const h = useMemo(() => authHeaders(token, lang), [token, lang]);

  const [rows, setRows] = useState<Kafedra[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [form, setForm] = useState<{ id: number | null; name: string; code: string } | null>(null);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Kafedra | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/admin/kafedralar'), { headers: h });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<Kafedra[]>(res);
      setRows(Array.isArray(j) ? j : []);
    } finally {
      setLoading(false);
    }
  }, [h]);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((k) => !n || k.name.toLowerCase().includes(n) || (k.code || '').toLowerCase().includes(n));
  }, [rows, q]);
  const page = usePagedList(filtered, 25);
  const totalDirections = rows.reduce((s, k) => s + (k.direction_count ?? 0), 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    setSaving(true);
    setFormErr('');
    try {
      const isNew = form.id == null;
      const res = await fetch(apiUrl(isNew ? '/api/admin/kafedralar' : `/api/admin/kafedralar/${form.id}`), {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ name: form.name.trim(), code: form.code.trim() || (isNew ? undefined : null) }),
      });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        const d = await readJsonSafe<{ error?: string }>(res);
        setFormErr(d?.error || t.errorGeneric);
        return;
      }
      if (isNew) setMsg({ type: 'success', text: t.kafedraAddedOk });
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
      const res = await fetch(apiUrl(`/api/admin/kafedralar/${confirmDel.id}`), { method: 'DELETE', headers: h });
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

  return (
    <div className="space-y-4">
      <AdminPageMessage message={msg} onDismiss={() => setMsg(null)} />

      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <p className="text-[13.5px] text-gray-600">
            <b className="font-display text-[18px] font-extrabold tabular-nums text-gray-900">{rows.length}</b> {t.kontingentKafedralar.toLowerCase()}
            <span className="mx-2 text-gray-300">·</span>
            <b className="tabular-nums text-gray-900">{totalDirections}</b> {t.kontingentDirections.toLowerCase()}
          </p>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <AdminInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="…" className="h-9 sm:w-64" />
            <AdminBtn size="sm" onClick={() => { setFormErr(''); setForm({ id: null, name: '', code: '' }); }}>
              + {t.kontingentAddKafedra}
            </AdminBtn>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead className="bg-gray-50/80 text-[12px] text-gray-500">
              <tr className="border-b border-gray-200 text-left">
                <th className="w-12 px-4 py-2.5 font-semibold">№</th>
                <th className="px-4 py-2.5 font-semibold">{t.kafedraLabel}</th>
                <th className="px-4 py-2.5 font-semibold">{t.kafedraCodeLabel}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t.kontingentDirections}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {page.pageItems.map((k, i) => (
                <tr key={k.id} className="hover:bg-gray-50/70">
                  <td className="border-b border-gray-100 px-4 py-3 tabular-nums text-gray-400">{(page.page - 1) * page.pageSize + i + 1}</td>
                  <td className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-900">{k.name}</td>
                  <td className="border-b border-gray-100 px-4 py-3 font-mono text-[12.5px] text-gray-500">{k.code || <span className="text-gray-300">—</span>}</td>
                  <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums">
                    {(k.direction_count ?? 0) > 0 ? (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[12px] font-semibold text-indigo-700">{k.direction_count}</span>
                    ) : <span className="text-gray-300">0</span>}
                  </td>
                  <td className="border-b border-gray-100 px-4 py-3 text-right whitespace-nowrap">
                    <AdminBtn variant="ghost" size="sm" onClick={() => { setFormErr(''); setForm({ id: k.id, name: k.name, code: k.code || '' }); }}>{t.edit}</AdminBtn>
                    <AdminBtn variant="red-ghost" size="sm" className="ml-2" onClick={() => setConfirmDel(k)}>{t.delete}</AdminBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filtered.length === 0 ? <AdminEmpty title={t.emptyKafedralar} subtitle={rows.length ? undefined : t.kafedraEmptyHint} /> : null}
        </div>
        <AdminPagination page={page.page} totalPages={page.totalPages} onPageChange={page.setPage} total={page.total} pageSize={page.pageSize} />
      </section>

      <AdminModal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id == null ? t.kontingentAddKafedra : `${t.edit} — ${form?.name}`}
        subtitle={form?.id == null ? t.kafedraSubtitle : undefined}
      >
        {form ? (
          <form onSubmit={save} className="space-y-4">
            {formErr ? <AdminAlert type="error">{formErr}</AdminAlert> : null}
            <AdminField label={t.kafedraLabel} required>
              <AdminInput autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t.kafedraPlaceholder} required />
            </AdminField>
            <AdminField label={t.kafedraCodeLabel}>
              <AdminInput value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={t.kafedraCodePlaceholder} />
            </AdminField>
            {form.id == null ? <p className="text-[12.5px] leading-relaxed text-gray-500">{t.kafedraHint}</p> : null}
            <div className="flex justify-end gap-2">
              <AdminBtn variant="ghost" onClick={() => setForm(null)}>{t.cancel}</AdminBtn>
              <AdminBtn type="submit" loading={saving}>{t.save}</AdminBtn>
            </div>
          </form>
        ) : null}
      </AdminModal>

      <AdminModal open={!!confirmDel} onClose={() => setConfirmDel(null)} title={t.delete}>
        {confirmDel ? (
          (confirmDel.direction_count ?? 0) > 0 ? (
            <div className="space-y-4">
              <AdminAlert type="warning">{t.kafedraHasDirections.replace('{n}', String(confirmDel.direction_count))}</AdminAlert>
              <div className="flex justify-end"><AdminBtn variant="ghost" onClick={() => setConfirmDel(null)}>{t.cancel}</AdminBtn></div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[14px] text-gray-700">{t.kafedraDeleteConfirm.replace('{name}', confirmDel.name)}</p>
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
