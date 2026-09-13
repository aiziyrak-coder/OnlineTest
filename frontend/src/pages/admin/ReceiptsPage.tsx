import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminAlert,
  AdminBtn,
  AdminEmpty,
  AdminInput,
  AdminModal,
  AdminSelect,
  AdminTextarea,
  SpinnerIcon,
} from './ui';

/**
 * To'lov kvitansiyalari — buxgalteriya tekshiruvi.
 *
 * Ordinator/magistr imtihonga to'lov asosida kiradi. U to'lov chekini rasmga
 * olib yuklaydi, kvitansiya shu yerga tushadi. Admin faylni ochib ko'radi,
 * buxgalteriya bilan solishtiradi va TASDIQLAYDI — shunda o'sha odamga
 * BITTA urinish ochiladi (savollar oldingisidan farq qiladi).
 */

interface Receipt {
  id: number;
  student_id: string;
  student_name: string;
  role: string;
  kafedra_name: string;
  exam_id: number | null;
  exam_title: string;
  file_name: string;
  file_mime: string;
  note: string;
  status: string;
  admin_note: string;
  created_at: string;
}

const TXT: Record<string, Record<string, string>> = {
  uz: {
    title: 'Tolov kvitansiyalari', pending: 'Kutilmoqda', approved: 'Tasdiqlangan',
    rejected: 'Rad etilgan', all: 'Barchasi', search: 'F.I.Sh yoki ID boyicha qidirish...',
    who: 'Kim', role: 'Toifa', kafedra: 'Kafedra', exam: 'Imtihon', file: 'Fayl',
    date: 'Sana', status: 'Holat', actions: 'Amallar', view: 'Korish',
    approve: 'Tasdiqlash', reject: 'Rad etish', note: 'Izoh (ixtiyoriy)',
    empty: 'Kvitansiyalar yoq.', refresh: 'Yangilash',
    approvedMsg: 'Tasdiqlandi — urinish ochildi', rejectedMsg: 'Rad etildi',
    studentNote: 'Nomzod izohi', open: 'Yangi oynada ochish', close: 'Yopish',
  },
  ru: {
    title: 'Kvitantsii ob oplate', pending: 'Ozhidayet', approved: 'Podtverzhdeno',
    rejected: 'Otkloneno', all: 'Vse', search: 'Poisk po FIO ili ID...',
    who: 'Kto', role: 'Kategoriya', kafedra: 'Kafedra', exam: 'Ekzamen', file: 'Fayl',
    date: 'Data', status: 'Status', actions: 'Deystviya', view: 'Smotret',
    approve: 'Podtverdit', reject: 'Otklonit', note: 'Kommentariy',
    empty: 'Kvitantsiy net.', refresh: 'Obnovit',
    approvedMsg: 'Podtverzhdeno — popytka otkryta', rejectedMsg: 'Otkloneno',
    studentNote: 'Kommentariy kandidata', open: 'Otkryt v novom okne', close: 'Zakryt',
  },
  en: {
    title: 'Payment receipts', pending: 'Pending', approved: 'Approved',
    rejected: 'Rejected', all: 'All', search: 'Search by name or ID...',
    who: 'Person', role: 'Category', kafedra: 'Department', exam: 'Exam', file: 'File',
    date: 'Date', status: 'Status', actions: 'Actions', view: 'View',
    approve: 'Approve', reject: 'Reject', note: 'Note (optional)',
    empty: 'No receipts yet.', refresh: 'Refresh',
    approvedMsg: 'Approved — one attempt opened', rejectedMsg: 'Rejected',
    studentNote: 'Applicant note', open: 'Open in new tab', close: 'Close',
  },
};

const STATUS_CLS: Record<string, string> = {
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function ReceiptsPage({ token, lang }: { token: string; lang: Language }) {
  const T = TXT[lang] ?? TXT.uz;
  const h = useMemo(() => authHeaders(token, lang), [token, lang]);

  const [rows, setRows] = useState<Receipt[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusF, setStatusF] = useState('Pending');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [view, setView] = useState<{ receipt: Receipt; url: string } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = statusF ? `?status=${statusF}` : '';
      const res = await fetch(apiUrl(`/api/admin/payment-receipts${qs}`), { headers: h });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<{ receipts: Receipt[]; pending: number }>(res);
      if (j) {
        setRows(j.receipts ?? []);
        setPending(j.pending ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [h, statusF]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.student_name.toLowerCase().includes(needle) ||
        r.student_id.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const openFile = async (r: Receipt) => {
    const res = await fetch(apiUrl(`/api/admin/payment-receipts/${r.id}/file`), { headers: h });
    if (!checkAdminAuthResponse(res)) return;
    const j = await readJsonSafe<{ file_base64: string; file_mime: string }>(res);
    if (!j?.file_base64) {
      setMsg({ type: 'error', text: 'Fayl ochilmadi' });
      return;
    }
    setNote('');
    setView({ receipt: r, url: `data:${j.file_mime || 'image/jpeg'};base64,${j.file_base64}` });
  };

  const resolve = async (r: Receipt, decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/payment-receipts/${r.id}/resolve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ decision, note }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<Record<string, unknown>>(res);
      if (!res.ok) {
        setMsg({ type: 'error', text: String(j?.error ?? 'Xatolik') });
        return;
      }
      setMsg({
        type: 'success',
        text: `${r.student_name}: ${decision === 'approve' ? T.approvedMsg : T.rejectedMsg}`,
      });
      setView(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {msg && <AdminAlert type={msg.type}>{msg.text}</AdminAlert>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <AdminInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.search} />
        </div>
        <div className="w-full sm:w-56">
          <AdminSelect value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="Pending">
              {T.pending}
              {pending > 0 ? ` (${pending})` : ''}
            </option>
            <option value="Approved">{T.approved}</option>
            <option value="Rejected">{T.rejected}</option>
            <option value="">{T.all}</option>
          </AdminSelect>
        </div>
        <AdminBtn variant="ghost" onClick={load}>
          {T.refresh}
        </AdminBtn>
      </div>

      {loading ? (
        <div className="flex justify-center py-14 text-gray-400">
          <SpinnerIcon />
        </div>
      ) : shown.length === 0 ? (
        <AdminEmpty title={T.empty} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-[13.5px]">
            <thead className="bg-gray-50 text-gray-500">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-semibold">{T.who}</th>
                <th className="px-3 py-2.5 font-semibold">{T.kafedra}</th>
                <th className="px-3 py-2.5 font-semibold">{T.exam}</th>
                <th className="px-3 py-2.5 font-semibold">{T.date}</th>
                <th className="px-3 py-2.5 font-semibold">{T.status}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{T.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/70">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-gray-800">{r.student_name}</p>
                    <p className="text-[12px] text-gray-400 tabular-nums">
                      {r.student_id} · {r.role}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{r.kafedra_name || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.exam_title || '—'}</td>
                  <td className="px-3 py-2.5 text-[12.5px] text-gray-500 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[12px] font-semibold ${
                        STATUS_CLS[r.status] ?? 'bg-gray-50 text-gray-600 border-gray-200'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <AdminBtn size="sm" onClick={() => openFile(r)}>
                      {T.view}
                    </AdminBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminModal
        open={!!view}
        title={view?.receipt.student_name}
        subtitle={view ? `${view.receipt.student_id} · ${view.receipt.exam_title || ''}` : ''}
        maxWidth="max-w-2xl"
        scroll
        onClose={() => setView(null)}
      >
        {view && (
          <div className="space-y-3">
            {view.receipt.note && (
              <p className="text-[13px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                <span className="font-semibold">{T.studentNote}: </span>
                {view.receipt.note}
              </p>
            )}
            <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
              {view.receipt.file_mime === 'application/pdf' ? (
                <object data={view.url} type="application/pdf" className="w-full h-[60vh]">
                  <a href={view.url} target="_blank" rel="noreferrer" className="text-indigo-600 underline p-4 block">
                    {T.open}
                  </a>
                </object>
              ) : (
                <img src={view.url} alt={view.receipt.file_name} className="w-full object-contain max-h-[60vh]" />
              )}
            </div>
            <AdminTextarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={T.note}
              rows={2}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <AdminBtn variant="ghost" onClick={() => setView(null)}>
                {T.close}
              </AdminBtn>
              <AdminBtn variant="red-ghost" disabled={busy} onClick={() => resolve(view.receipt, 'reject')}>
                {T.reject}
              </AdminBtn>
              <AdminBtn variant="emerald" disabled={busy} onClick={() => resolve(view.receipt, 'approve')}>
                {T.approve}
              </AdminBtn>
            </div>
          </div>
        )}
      </AdminModal>
    </div>
  );
}
