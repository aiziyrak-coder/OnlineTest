import { useCallback, useEffect, useRef, useState } from 'react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminBtn, AdminEmpty, AdminInput, AdminModal, AdminTextarea } from './ui';
import { EvidenceModal } from './AudienceReport';

/*
 * Test markazi — jonli nazorat.
 * Hozir imtihon topshirayotganlar, ularning ekrani va kamera kadri;
 * imtihonni o'sha zahoti yakunlash va texnik muammoda qayta ruxsat berish.
 * Ro'yxat har 10 soniyada, ochilgan ekran har 8 soniyada yangilanadi.
 */

interface Row {
  student_exam_id: number;
  student_id: string;
  student_name: string;
  exam_id: number;
  exam_title: string;
  subject: string;
  course: number;
  audience: string;
  test_center: boolean;
  started_at: string | null;
  elapsed_min: number | null;
  seconds_left: number | null;
  answered: number;
  total: number;
  warnings: number;
  last_violation: string;
  last_violation_at: string | null;
  violations: number;
  screen_at: string | null;
  webcam_at: string | null;
}

interface Frames {
  student_name: string;
  exam_title: string;
  screen: { at: string; image: string } | null;
  webcam: { at: string; image: string } | null;
}

const CARD =
  'rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]';

const TX = {
  uz: {
    lead: "Hozir imtihon topshirayotganlar. Ro'yxat 10 soniyada bir yangilanadi. Ekran va kamera kadri imtihon davomida har 20 soniyada saqlanadi.",
    onlyCenter: 'Faqat test markazi', all: 'Hammasi', refresh: 'Yangilash', live: 'Hozir imtihonda',
    person: 'F.I.Sh.', exam: 'Imtihon', progress: 'Javob', time: 'Vaqt', warn: 'Ogohlantirish', act: 'Amal',
    screen: 'Ekran', stop: "To'xtatish", retake: 'Qayta ruxsat', evidence: 'Dalillar',
    empty: 'Hozir imtihon topshirayotgan odam yo‘q.',
    left: 'qoldi', min: 'daq', stopTitle: 'Imtihonni to‘xtatish',
    stopText: 'Imtihon shu zahoti yakunlanadi. Belgilangan javoblar hisobga olinadi, javobsiz savollar noto‘g‘ri sanaladi.',
    stopNote: 'Izoh (ixtiyoriy): nega to‘xtatildi',
    retakeTitle: 'Qayta ruxsat berish',
    retakeText: 'Joriy natija bekor qilinadi, imtihon boshidan boshlanadi. Texnik muammo bo‘lganda ishlatiladi.',
    cancel: 'Bekor qilish', confirm: 'Tasdiqlash', done: 'Bajarildi', err: 'Xatolik',
    noScreen: 'Ekran surati hali yo‘q', noCam: 'Kamera kadri hali yo‘q', camera: 'Kamera', close: 'Yopish',
    search: 'F.I.Sh. yoki login',
  },
  ru: {
    lead: 'Кто сейчас сдаёт экзамен. Список обновляется каждые 10 секунд. Снимки экрана и камеры сохраняются каждые 20 секунд.',
    onlyCenter: 'Только тест-центр', all: 'Все', refresh: 'Обновить', live: 'Сейчас на экзамене',
    person: 'Ф.И.О.', exam: 'Экзамен', progress: 'Ответы', time: 'Время', warn: 'Предупр.', act: 'Действие',
    screen: 'Экран', stop: 'Остановить', retake: 'Пересдача', evidence: 'Доказательства',
    empty: 'Сейчас никто не сдаёт экзамен.',
    left: 'осталось', min: 'мин', stopTitle: 'Остановить экзамен',
    stopText: 'Экзамен будет завершён сразу. Отмеченные ответы засчитываются, неотвеченные считаются неверными.',
    stopNote: 'Комментарий (необязательно): причина',
    retakeTitle: 'Разрешить пересдачу',
    retakeText: 'Текущий результат аннулируется, экзамен начинается заново. Для технических проблем.',
    cancel: 'Отмена', confirm: 'Подтвердить', done: 'Готово', err: 'Ошибка',
    noScreen: 'Снимка экрана пока нет', noCam: 'Кадра камеры пока нет', camera: 'Камера', close: 'Закрыть',
    search: 'Ф.И.О. или логин',
  },
  en: {
    lead: 'Who is taking an exam right now. The list refreshes every 10 seconds. Screen and camera frames are stored every 20 seconds.',
    onlyCenter: 'Test centre only', all: 'All', refresh: 'Refresh', live: 'In exam now',
    person: 'Full name', exam: 'Exam', progress: 'Answers', time: 'Time', warn: 'Warnings', act: 'Action',
    screen: 'Screen', stop: 'Stop', retake: 'Retake', evidence: 'Evidence',
    empty: 'Nobody is taking an exam right now.',
    left: 'left', min: 'min', stopTitle: 'Stop the exam',
    stopText: 'The exam is finished immediately. Marked answers count, unanswered questions count as wrong.',
    stopNote: 'Note (optional): why it was stopped',
    retakeTitle: 'Allow a retake',
    retakeText: 'The current result is cancelled and the exam starts over. For technical problems.',
    cancel: 'Cancel', confirm: 'Confirm', done: 'Done', err: 'Error',
    noScreen: 'No screen capture yet', noCam: 'No camera frame yet', camera: 'Camera', close: 'Close',
    search: 'Name or login',
  },
};

const fmtLeft = (sec: number | null) => {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export function TestCenterPage({ token, lang }: { token: string; lang: Language }) {
  const T = TX[lang as 'uz' | 'ru' | 'en'] || TX.uz;
  const [rows, setRows] = useState<Row[]>([]);
  const [onlyCenter, setOnlyCenter] = useState(true);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [watch, setWatch] = useState<Row | null>(null);
  const [frames, setFrames] = useState<Frames | null>(null);
  const [stopFor, setStopFor] = useState<Row | null>(null);
  const [stopNote, setStopNote] = useState('');
  const [retakeFor, setRetakeFor] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [evSe, setEvSe] = useState<number | null>(null);
  const watchRef = useRef<Row | null>(null);
  watchRef.current = watch;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/test-center/live${onlyCenter ? '' : '?all=1'}`), {
        headers: authHeaders(token, lang),
      });
      if (!checkAdminAuthResponse(res)) return;
      const body = await readJsonSafe<{ results?: Row[]; error?: string }>(res);
      if (!res.ok) {
        setError(body?.error || T.err);
        return;
      }
      setError('');
      setRows(body?.results || []);
    } catch {
      setError(T.err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyCenter, token, lang]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [load]);

  const loadFrames = useCallback(async () => {
    const w = watchRef.current;
    if (!w) return;
    try {
      const res = await fetch(apiUrl(`/api/admin/test-center/${w.student_exam_id}/frames`), {
        headers: authHeaders(token, lang),
      });
      if (!checkAdminAuthResponse(res) || !res.ok) return;
      setFrames(await readJsonSafe<Frames>(res));
    } catch {
      /* keyingi urinishda yangilanadi */
    }
  }, [token, lang]);

  useEffect(() => {
    if (!watch) {
      setFrames(null);
      return;
    }
    void loadFrames();
    const id = window.setInterval(() => void loadFrames(), 8_000);
    return () => window.clearInterval(id);
  }, [watch, loadFrames]);

  const doStop = async () => {
    if (!stopFor) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/test-center/${stopFor.student_exam_id}/finish`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({ note: stopNote }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<any>(res);
      if (!res.ok) {
        setMsg(String(d?.error || T.err));
      } else {
        setMsg(`${stopFor.student_name}: ${T.done} — ${d?.score}/${stopFor.total}`);
        setWatch(null);
      }
      setStopFor(null);
      setStopNote('');
      void load();
    } finally {
      setBusy(false);
    }
  };

  const doRetake = async () => {
    if (!retakeFor) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/student_exams/${retakeFor.student_exam_id}/retake`), {
        method: 'POST',
        headers: authHeaders(token, lang),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<any>(res);
      setMsg(res.ok ? `${retakeFor.student_name}: ${T.done}` : String(d?.error || T.err));
      setRetakeFor(null);
      setWatch(null);
      void load();
    } finally {
      setBusy(false);
    }
  };

  const needle = q.trim().toLowerCase();
  const list = rows.filter(
    (r) => !needle || r.student_name.toLowerCase().includes(needle) || r.student_id.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-[13.5px] text-gray-600">{T.lead}</p>
        <div className="flex items-center gap-2">
          <AdminInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.search} />
          <AdminBtn variant={onlyCenter ? 'blue' : 'ghost'} onClick={() => setOnlyCenter(true)}>{T.onlyCenter}</AdminBtn>
          <AdminBtn variant={onlyCenter ? 'ghost' : 'blue'} onClick={() => setOnlyCenter(false)}>{T.all}</AdminBtn>
          <AdminBtn variant="ghost" onClick={() => void load()} disabled={loading}>{T.refresh}</AdminBtn>
        </div>
      </div>

      <div className={`${CARD} flex items-center gap-3 px-4 py-3`}>
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-[13.5px] text-gray-600">{T.live}:</span>
        <span className="text-2xl font-semibold tabular-nums text-gray-900">{list.length}</span>
      </div>

      {msg ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13.5px] text-emerald-800">{msg}</div> : null}
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13.5px] text-rose-700">{error}</div> : null}

      <div className={`${CARD} overflow-x-auto`}>
        {list.length === 0 ? (
          <AdminEmpty title={T.empty} />
        ) : (
          <table className="w-full min-w-[900px] text-[13.5px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-[12px] text-gray-500">
                <th className="px-4 py-2.5 font-semibold">{T.person}</th>
                <th className="px-4 py-2.5 font-semibold">{T.exam}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{T.progress}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{T.time}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{T.warn}</th>
                <th className="px-4 py-2.5 font-semibold">{T.act}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.student_exam_id} className="border-b border-gray-50 hover:bg-gray-50/70">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-gray-900">{r.student_name || r.student_id}</div>
                    <div className="font-mono text-[11.5px] text-gray-400">
                      {r.student_id}
                      {r.test_center ? ' · test markazi' : ''}
                    </div>
                  </td>
                  <td className="max-w-[260px] px-4 py-2.5 text-gray-600">
                    <div className="truncate" title={r.exam_title}>{r.subject || r.exam_title}</div>
                    {r.last_violation ? (
                      <div className="truncate text-[11.5px] text-rose-600" title={r.last_violation}>{r.last_violation}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.answered}/{r.total}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <div className={r.seconds_left != null && r.seconds_left < 300 ? 'font-semibold text-rose-600' : 'text-gray-700'}>
                      {fmtLeft(r.seconds_left)} {T.left}
                    </div>
                    <div className="text-[11.5px] text-gray-400">{r.elapsed_min ?? 0} {T.min}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className={r.warnings ? 'font-semibold text-amber-700' : 'text-gray-400'}>{r.warnings}</span>
                    {r.violations ? <span className="ml-1 text-[11.5px] text-gray-400">({r.violations})</span> : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      <AdminBtn variant="blue" size="sm" onClick={() => setWatch(r)}>{T.screen}</AdminBtn>
                      <AdminBtn variant="red" size="sm" onClick={() => { setStopFor(r); setStopNote(''); }}>{T.stop}</AdminBtn>
                      <AdminBtn variant="ghost" size="sm" onClick={() => setRetakeFor(r)}>{T.retake}</AdminBtn>
                      <AdminBtn variant="ghost" size="sm" onClick={() => setEvSe(r.student_exam_id)}>🔍 {T.evidence}</AdminBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Ekran + kamera */}
      <AdminModal
        open={!!watch}
        onClose={() => setWatch(null)}
        title={watch ? `${watch.student_name} — ${watch.subject || watch.exam_title}` : ''}
        subtitle={watch ? `${watch.answered}/${watch.total} · ${fmtLeft(watch.seconds_left)} ${T.left}` : undefined}
        maxWidth="max-w-5xl"
        scroll
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            {frames?.screen ? (
              <>
                <img src={frames.screen.image} alt="screen" className="w-full rounded-xl border border-gray-200" />
                <div className="mt-1 text-right text-[11.5px] text-gray-400">{new Date(frames.screen.at).toLocaleTimeString()}</div>
              </>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-xl bg-gray-50 text-[13px] text-gray-400">{T.noScreen}</div>
            )}
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold text-gray-600">{T.camera}</div>
            {frames?.webcam ? (
              <>
                <img src={frames.webcam.image} alt="webcam" className="w-full rounded-xl border border-gray-200" />
                <div className="mt-1 text-right text-[11.5px] text-gray-400">{new Date(frames.webcam.at).toLocaleTimeString()}</div>
              </>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-xl bg-gray-50 text-[13px] text-gray-400">{T.noCam}</div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <AdminBtn variant="red" size="sm" onClick={() => { if (watch) { setStopFor(watch); setStopNote(''); } }}>{T.stop}</AdminBtn>
              <AdminBtn variant="ghost" size="sm" onClick={() => watch && setRetakeFor(watch)}>{T.retake}</AdminBtn>
              <AdminBtn variant="ghost" size="sm" onClick={() => watch && setEvSe(watch.student_exam_id)}>🔍 {T.evidence}</AdminBtn>
            </div>
          </div>
        </div>
      </AdminModal>

      {/* To'xtatish */}
      <AdminModal open={!!stopFor} onClose={() => setStopFor(null)} title={T.stopTitle} subtitle={stopFor?.student_name}>
        <p className="text-[13.5px] text-gray-600">{T.stopText}</p>
        <p className="mt-2 text-[13.5px] text-gray-800">
          {stopFor ? `${stopFor.answered}/${stopFor.total}` : ''}
        </p>
        <div className="mt-3">
          <AdminTextarea value={stopNote} onChange={(e: any) => setStopNote(e.target.value)} placeholder={T.stopNote} rows={2} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <AdminBtn variant="ghost" onClick={() => setStopFor(null)} disabled={busy}>{T.cancel}</AdminBtn>
          <AdminBtn variant="red" onClick={() => void doStop()} loading={busy}>{T.confirm}</AdminBtn>
        </div>
      </AdminModal>

      {/* Qayta ruxsat */}
      <AdminModal open={!!retakeFor} onClose={() => setRetakeFor(null)} title={T.retakeTitle} subtitle={retakeFor?.student_name}>
        <p className="text-[13.5px] text-gray-600">{T.retakeText}</p>
        <div className="mt-4 flex justify-end gap-2">
          <AdminBtn variant="ghost" onClick={() => setRetakeFor(null)} disabled={busy}>{T.cancel}</AdminBtn>
          <AdminBtn variant="blue" onClick={() => void doRetake()} loading={busy}>{T.confirm}</AdminBtn>
        </div>
      </AdminModal>

      <EvidenceModal token={token} lang={lang} seId={evSe} onClose={() => setEvSe(null)} />
    </div>
  );
}
