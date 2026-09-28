import { useCallback, useEffect, useMemo, useState } from 'react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminAlert, AdminBtn, AdminEmpty, AdminInput, AdminModal, AdminPageMessage, AdminTextarea } from './ui';
import type { AdminPageMsg } from './ui';

/*
 * Yuqori natijani test markazida yuzma-yuz tasdiqlash navbati.
 * Tasdiqlanguncha sertifikat berilmaydi; rad etilsa ball bekor (asl ball saqlanadi).
 */

type State = 'pending' | 'confirmed' | 'rejected' | 'all';

interface Row {
  student_exam_id: number;
  student_id: string;
  student_name: string;
  exam_title: string;
  audience: string;
  kafedra_name: string;
  score: number | null;
  original_score: number | null;
  total: number;
  percent: number | null;
  completed_at: string | null;
  reason: string;
  state: string;
  note: string;
  decided_by: string;
  decided_at: string | null;
}

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

const TX = {
  uz: {
    pending: 'Kutilmoqda', confirmed: 'Tasdiqlangan', rejected: 'Rad etilgan', all: 'Hammasi',
    intro: "80% va undan yuqori natijalar test markazida yuzma-yuz tasdiqlanadi. Tasdiqlanguncha sertifikat berilmaydi.",
    search: "Ism, login yoki imtihon", name: 'F.I.Sh.', exam: 'Imtihon', score: 'Natija', reason: 'Nega tanlangan',
    date: 'Topshirgan', state: 'Holat', confirm: 'Tasdiqlash', reject: 'Rad etish', reopen: 'Qayta ko\'rish',
    note: 'Izoh', noteReq: "Rad etish sababini yozing (kamida 5 belgi)", noteOpt: "Izoh (ixtiyoriy): qaysi savollar so'raldi, natija",
    save: 'Saqlash', cancel: 'Bekor qilish', empty: "Navbat bo'sh.", refresh: 'Yangilash',
    confirmTitle: 'Natijani tasdiqlash', rejectTitle: 'Natijani rad etish', reopenTitle: 'Qayta navbatga qo\'yish',
    rejectWarn: "Ball bekor qilinadi (0), natija \"o'tmadi\" bo'ladi. Asl ball saqlanadi.",
    done: 'Saqlandi', orig: 'asl', by: 'qaror',
  },
  ru: {
    pending: 'Ожидает', confirmed: 'Подтверждён', rejected: 'Отклонён', all: 'Все',
    intro: 'Результаты от 80% подтверждаются очно в тестовом центре. До подтверждения сертификат не выдаётся.',
    search: 'Имя, логин или экзамен', name: 'Ф.И.О.', exam: 'Экзамен', score: 'Результат', reason: 'Причина отбора',
    date: 'Сдал', state: 'Статус', confirm: 'Подтвердить', reject: 'Отклонить', reopen: 'Пересмотреть',
    note: 'Комментарий', noteReq: 'Укажите причину отклонения (не менее 5 символов)', noteOpt: 'Комментарий (необязательно)',
    save: 'Сохранить', cancel: 'Отмена', empty: 'Очередь пуста.', refresh: 'Обновить',
    confirmTitle: 'Подтвердить результат', rejectTitle: 'Отклонить результат', reopenTitle: 'Вернуть в очередь',
    rejectWarn: 'Балл будет аннулирован (0), результат — «не сдал». Исходный балл сохраняется.',
    done: 'Сохранено', orig: 'исх.', by: 'решение',
  },
  en: {
    pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected', all: 'All',
    intro: 'Scores of 80% or higher are confirmed in person at the test centre. No certificate until confirmed.',
    search: 'Name, login or exam', name: 'Full name', exam: 'Exam', score: 'Score', reason: 'Why selected',
    date: 'Taken', state: 'Status', confirm: 'Confirm', reject: 'Reject', reopen: 'Reopen',
    note: 'Note', noteReq: 'Give the rejection reason (at least 5 characters)', noteOpt: 'Note (optional)',
    save: 'Save', cancel: 'Cancel', empty: 'The queue is empty.', refresh: 'Refresh',
    confirmTitle: 'Confirm result', rejectTitle: 'Reject result', reopenTitle: 'Return to queue',
    rejectWarn: 'The score is annulled (0) and the result becomes "failed". The original score is kept.',
    done: 'Saved', orig: 'orig.', by: 'decided',
  },
};

const pad = (n: number) => String(n).padStart(2, '0');
function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function VerificationPage({ token, lang, onCount }: { token: string; lang: Language; onCount?: (n: number) => void }) {
  const T = TX[lang] || TX.uz;
  const h = useMemo(() => authHeaders(token, lang), [token, lang]);
  const [state, setState] = useState<State>('pending');
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<AdminPageMsg | null>(null);
  const [act, setAct] = useState<{ row: Row; decision: 'confirm' | 'reject' | 'pending' } | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/verifications?state=${state}`), { headers: h });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<{ results?: Row[]; counts?: Record<string, number> }>(res);
      setRows(Array.isArray(j?.results) ? j!.results : []);
      setCounts(j?.counts || {});
      onCount?.(Number(j?.counts?.pending || 0));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, h]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => !n || `${r.student_name} ${r.student_id} ${r.exam_title}`.toLowerCase().includes(n));
  }, [rows, q]);

  const submit = async () => {
    if (!act) return;
    if (act.decision === 'reject' && note.trim().length < 5) { setErr(T.noteReq); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(apiUrl(`/api/admin/student_exams/${act.row.student_exam_id}/verification`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ decision: act.decision, note: note.trim() }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) { setErr(d?.error || 'error'); return; }
      setAct(null);
      setNote('');
      setMsg({ type: 'ok', text: T.done });
      void load();
    } finally {
      setBusy(false);
    }
  };

  const pill = (s: string) => {
    const cls = s === 'confirmed'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
      : s === 'rejected'
        ? 'bg-red-50 text-red-700 ring-red-600/15'
        : 'bg-amber-50 text-amber-800 ring-amber-600/20';
    return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${cls}`}>{(T as any)[s] || s}</span>;
  };

  const tabs: State[] = ['pending', 'confirmed', 'rejected', 'all'];
  const td = 'px-4 py-3 border-b border-gray-100 align-top';

  return (
    <div className="space-y-4">
      <AdminPageMessage message={msg} onDismiss={() => setMsg(null)} />
      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 px-3 sm:px-4">
          <div className="-mb-px flex overflow-x-auto" role="tablist">
            {tabs.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={state === k}
                onClick={() => setState(k)}
                className={`whitespace-nowrap border-b-2 px-3 py-3.5 text-[13.5px] font-semibold transition-colors ${
                  state === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {T[k]}
                {k !== 'all' && counts[k] != null ? (
                  <span className={`ml-1.5 rounded-full px-1.5 py-px text-[11.5px] tabular-nums ${
                    k === 'pending' && counts[k] ? 'bg-amber-100 text-amber-800' : state === k ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-500'
                  }`}>{counts[k]}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex w-full items-center gap-2 py-2 sm:w-auto">
            <AdminInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.search} className="h-9 sm:w-64" />
            <AdminBtn variant="ghost" size="sm" loading={loading} onClick={() => void load()}>{T.refresh}</AdminBtn>
          </div>
        </div>
        <p className="border-b border-gray-100 bg-gray-50/60 px-4 py-2.5 text-[12.5px] text-gray-600">{T.intro}</p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13.5px]">
            <thead className="bg-gray-50/80 text-[12px] text-gray-500">
              <tr className="border-b border-gray-200 text-left">
                <th className="px-4 py-2.5 font-semibold">{T.name}</th>
                <th className="px-4 py-2.5 font-semibold">{T.exam}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{T.score}</th>
                <th className="px-4 py-2.5 font-semibold">{T.reason}</th>
                <th className="px-4 py-2.5 font-semibold">{T.date}</th>
                <th className="px-4 py-2.5 font-semibold">{T.state}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.student_exam_id} className="hover:bg-gray-50/70">
                  <td className={td}>
                    <p className="font-semibold text-gray-900">{r.student_name}</p>
                    <p className="font-mono text-[11.5px] text-gray-400">{r.student_id}</p>
                  </td>
                  <td className={`${td} max-w-[280px]`}>
                    <p className="truncate text-gray-800" title={r.exam_title}>{r.exam_title}</p>
                    {r.kafedra_name ? <p className="truncate text-[12px] text-gray-500">{r.kafedra_name}</p> : null}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                    <b className="text-gray-900">{r.percent != null ? `${r.percent}%` : '—'}</b>
                    <p className="text-[12px] text-gray-500">
                      {r.score ?? '—'}/{r.total}
                      {r.original_score != null ? <span className="ml-1 text-gray-400">({T.orig} {r.original_score})</span> : null}
                    </p>
                  </td>
                  <td className={`${td} max-w-[280px] text-[12.5px] text-gray-600`}>{r.reason || '—'}</td>
                  <td className={`${td} whitespace-nowrap tabular-nums text-gray-600`}>{fmt(r.completed_at)}</td>
                  <td className={td}>
                    {pill(r.state)}
                    {r.decided_at ? (
                      <p className="mt-1 text-[11.5px] text-gray-400">{T.by}: {r.decided_by} · {fmt(r.decided_at)}</p>
                    ) : null}
                    {r.note ? <p className="mt-1 max-w-[220px] break-words text-[12px] text-gray-600">{r.note}</p> : null}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {r.state === 'pending' ? (
                      <span className="inline-flex gap-2">
                        <AdminBtn variant="emerald" size="sm" onClick={() => { setErr(''); setNote(''); setAct({ row: r, decision: 'confirm' }); }}>{T.confirm}</AdminBtn>
                        <AdminBtn variant="red-ghost" size="sm" onClick={() => { setErr(''); setNote(''); setAct({ row: r, decision: 'reject' }); }}>{T.reject}</AdminBtn>
                      </span>
                    ) : (
                      <AdminBtn variant="ghost" size="sm" onClick={() => { setErr(''); setNote(''); setAct({ row: r, decision: 'pending' }); }}>{T.reopen}</AdminBtn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && shown.length === 0 ? <AdminEmpty title={T.empty} /> : null}
        </div>
      </section>

      <AdminModal
        open={!!act}
        onClose={() => setAct(null)}
        title={act?.decision === 'confirm' ? T.confirmTitle : act?.decision === 'reject' ? T.rejectTitle : T.reopenTitle}
        subtitle={act ? `${act.row.student_name} · ${act.row.exam_title} · ${act.row.percent ?? '—'}%` : undefined}
      >
        {act ? (
          <div className="space-y-3">
            {act.decision === 'reject' ? <AdminAlert type="warning">{T.rejectWarn}</AdminAlert> : null}
            {err ? <AdminAlert type="error">{err}</AdminAlert> : null}
            <AdminTextarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={act.decision === 'reject' ? T.noteReq : T.noteOpt} />
            <div className="flex justify-end gap-2">
              <AdminBtn variant="ghost" onClick={() => setAct(null)}>{T.cancel}</AdminBtn>
              <AdminBtn variant={act.decision === 'reject' ? 'red' : 'blue'} loading={busy} onClick={() => void submit()}>
                {act.decision === 'confirm' ? T.confirm : act.decision === 'reject' ? T.reject : T.save}
              </AdminBtn>
            </div>
          </div>
        ) : null}
      </AdminModal>
    </div>
  );
}

export default VerificationPage;
