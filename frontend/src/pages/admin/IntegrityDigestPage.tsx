import { useCallback, useEffect, useState } from 'react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminBtn, AdminEmpty } from './ui';

/*
 * Kunlik nazorat hisoboti: bugun (yoki oxirgi N kun) yakunlangan natijalar ichidan
 * ko'rib chiqilishi kerak bo'lganlari. Avtomatik jazo emas.
 */

interface Flag {
  code: string;
  label: string;
}
interface Row {
  student_exam_id: number;
  student_id: string;
  student_name: string;
  exam_title: string;
  audience: string;
  status: string;
  percent: number | null;
  total: number;
  completed_at: string | null;
  verify_state: string;
  test_center: boolean;
  flags: Flag[];
  violations: number;
}
interface Digest {
  generated_at: string;
  days: number;
  totals: Record<string, number>;
  rows: Row[];
}

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

const FLAG_TONE: Record<string, string> = {
  GAZE: 'bg-rose-50 text-rose-700 border-rose-200',
  FAST: 'bg-amber-50 text-amber-800 border-amber-200',
  VIOL: 'bg-orange-50 text-orange-800 border-orange-200',
};

const VERIFY_TONE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function IntegrityDigestPage({ token, lang }: { token: string; lang: Language }) {
  const L = (uz: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : uz);
  const [days, setDays] = useState(1);
  const [data, setData] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/integrity-digest?days=${days}`), { headers: authHeaders(token, lang) });
      if (!checkAdminAuthResponse(res)) return;
      const body = await readJsonSafe<Digest & { error?: string }>(res);
      if (!res.ok) {
        setError(body.error || L("Hisobotni yuklab bo'lmadi", 'Не удалось загрузить отчёт', 'Could not load report'));
        return;
      }
      setData(body);
    } catch {
      setError(L("Tarmoq xatosi — qayta urinib ko'ring", 'Ошибка сети — повторите', 'Network error — try again'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, token, lang]);

  useEffect(() => {
    void load();
  }, [load]);

  const t = data?.totals || {};
  const tiles: { label: string; value: number | undefined; tone?: string }[] = [
    { label: L('Yakunlagan', 'Завершили', 'Finished'), value: t.finished },
    { label: L("O'tgan (56%+)", 'Сдали (56%+)', 'Passed (56%+)'), value: t.passed },
    { label: L('Ko‘rib chiqish kerak', 'Требуют проверки', 'Needs review'), value: t.flagged, tone: 'text-rose-700' },
    { label: L('Chetlatilgan', 'Заблокированы', 'Banned'), value: t.banned },
    { label: L('Tasdiqlash navbatida (jami)', 'В очереди проверки (всего)', 'Verification queue (all)'), value: t.verify_pending_all, tone: 'text-amber-700' },
  ];
  const vLabel = (s: string) =>
    s === 'pending' ? L('Kutilmoqda', 'Ожидает', 'Pending') : s === 'confirmed' ? L('Tasdiqlangan', 'Подтверждён', 'Confirmed') : L('Rad etilgan', 'Отклонён', 'Rejected');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600 max-w-[65ch]">
          {L(
            "Ko'rib chiqilishi kerak bo'lgan natijalar: javobdan oldin chetga qarash, juda tez va yuqori natija, ko'p qoidabuzarlik, yuzma-yuz tasdiqlash holati. Bu avtomatik jazo emas.",
            'Результаты, требующие проверки: взгляд в сторону перед ответом, слишком быстрый высокий результат, много нарушений, очная проверка. Это не автоматическое наказание.',
            'Results that need review: side glances before answers, very fast high scores, many violations, in-person verification. Not an automatic penalty.',
          )}
        </p>
        <div className="flex items-center gap-2">
          {[1, 7, 30].map((d) => (
            <AdminBtn key={d} variant={days === d ? 'blue' : 'ghost'} onClick={() => setDays(d)}>
              {d === 1 ? L('Bugun', 'Сегодня', 'Today') : d === 7 ? L('7 kun', '7 дней', '7 days') : L('30 kun', '30 дней', '30 days')}
            </AdminBtn>
          ))}
          <AdminBtn variant="ghost" onClick={() => void load()} disabled={loading}>
            {L('Yangilash', 'Обновить', 'Refresh')}
          </AdminBtn>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        {tiles.map((x) => (
          <div key={x.label} className={`${CARD} px-4 py-3`}>
            <div className="text-xs text-gray-500">{x.label}</div>
            <div className={`text-2xl font-semibold tabular-nums ${x.tone || 'text-gray-900'}`}>{x.value ?? '—'}</div>
          </div>
        ))}
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className={`${CARD} overflow-x-auto`}>
        {data && data.rows.length === 0 ? (
          <AdminEmpty title={L("Bu davrda ko'rib chiqiladigan natija yo'q.", 'За этот период нет результатов для проверки.', 'Nothing to review for this period.')} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="px-4 py-3">{L('F.I.Sh.', 'Ф.И.О.', 'Name')}</th>
                <th className="px-4 py-3">{L('Imtihon', 'Экзамен', 'Exam')}</th>
                <th className="px-4 py-3 text-right">{L('Natija', 'Результат', 'Score')}</th>
                <th className="px-4 py-3">{L('Belgilar', 'Признаки', 'Signals')}</th>
                <th className="px-4 py-3">{L('Tasdiqlash', 'Проверка', 'Verification')}</th>
                <th className="px-4 py-3">{L('Vaqt', 'Время', 'Time')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((r) => (
                <tr key={r.student_exam_id} className="border-b border-gray-50 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.student_name || r.student_id}</div>
                    <div className="text-xs text-gray-500">
                      {r.student_id}
                      {r.test_center ? ` · ${L('test markazi', 'тест-центр', 'test centre')}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.exam_title}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.status === 'Banned' ? L('chetlatilgan', 'заблок.', 'banned') : r.percent != null ? `${r.percent}%` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <span key={f.code} className={`rounded-full border px-2 py-0.5 text-xs ${FLAG_TONE[f.code] || 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                          {f.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {r.verify_state ? (
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${VERIFY_TONE[r.verify_state] || ''}`}>{vLabel(r.verify_state)}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                    {r.completed_at ? new Date(r.completed_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'uz-UZ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
