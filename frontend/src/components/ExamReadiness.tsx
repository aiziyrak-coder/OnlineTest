import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Language } from '../i18n';
import { apiUrl } from '../lib/apiUrl';
import { fetchDesktopInfo, getDesktop, isDesktopApp, versionLess, type DesktopCheck } from '../lib/desktop';

/* Kabinet uchun: imtihon kunidan OLDIN muammolarni aniqlash (tayyorlik), yordam,
 * imtihon kartasidagi asosiy shartlar va boshlashdan oldingi tasdiqlash oynasi. */

const SUPPORT_PHONE = '+998 90 786 38 88';
const SUPPORT_TEL = '+998907863888';

type Status = 'idle' | 'checking' | 'ok' | 'warn' | 'fail';

const TX: Record<Language, Record<string, string>> = {
  uz: {
    title: 'Imtihonga tayyorlik',
    subtitle: "Imtihon kunidan oldin tekshirib qo'ying — muammo imtihon paytida chiqmasin.",
    allOk: 'Hammasi tayyor',
    issues: '{n} ta muammo',
    checkAll: 'Hammasini tekshirish',
    check: 'Tekshirish',
    net: 'Internet va server',
    netOk: 'Aloqa yaxshi ({ms} ms)',
    netSlow: 'Aloqa sekin ({ms} ms) — imtihonni barqaror internetda topshiring',
    netFail: "Serverga ulanib bo'lmadi — internetni tekshiring",
    photo: 'Profil rasmi',
    photoOk: 'Rasm bor — shaxsni tasdiqlash ishlaydi',
    photoFail: "Rasm yo'q — imtihonga kira olmaysiz. Rasm yuklang",
    photoBtn: 'Rasm yuklash',
    cam: 'Kamera va mikrofon',
    camIdle: 'Sinab ko\'ring: kamera tasviri va ovoz darajasi ko\'rinadi',
    camOk: 'Kamera va mikrofon ishlayapti',
    camMicLow: "Kamera ishlayapti, lekin ovoz eshitilmadi — mikrofonni yoqing va biror narsa gapiring",
    camDenied: "Kamera/mikrofonga ruxsat berilmagan",
    camNone: 'Kamera yoki mikrofon topilmadi — ulang',
    camBusy: "Kamera boshqa dasturda band (Zoom, Telegram va h.k.) — uni yoping",
    camSpeak: 'Biror narsa gapiring…',
    pc: 'Kompyuter',
    pcOk: "Taqiqlangan dastur, virtual mashina va qo'shimcha monitor yo'q",
    pcCloseAll: 'Hammasini yopish',
    pcWeb: 'Faqat FerMI Exam ilovasida tekshiriladi',
    app: 'Ilova versiyasi',
    appOk: 'Eng yangi versiya ({v})',
    appOld: "Yangi versiya {v} chiqdi — ilovani yopib qayta oching, o'zi yangilanadi",
    helpTitle: "Muammo bo'lsa",
    helpCall: 'Administrator',
    help1: "Internet yoki elektr uzilsa — ilovani qayta oching va imtihonni «Davom ettirish» bilan davom ettiring. Javoblaringiz saqlanadi, taymer to'xtamaydi.",
    help2: "Kamera ishlamasa — boshqa dasturlarni (Zoom, Telegram, OBS) yoping va «Tekshirish» ni bosing.",
    help3: "Shaxs tasdiqlanmasa — yuzingiz yorug' joyda, kameraga to'g'ri qarab o'tiring. Kerak bo'lsa rasmingizni yangilang.",
    help4: "Imtihon ro'yxatda ko'rinmasa yoki «Ruxsat berilmagan» chiqsa — administratorga qo'ng'iroq qiling.",
    fQuestions: '{n} ta savol',
    fPerQ: 'Savolga ~{s} soniya',
    fNoBack: "Orqaga qaytish yo'q",
    fOneAttempt: 'Bir martalik',
    fRoom: "Boshida xonani ko'rsatish",
    fClosesIn: 'Yopilishiga',
    fPersonal: 'Sizga ochiq',
    cTitle: 'Imtihonni boshlashdan oldin',
    cLead: "Quyidagilarni tasdiqlang. Imtihon boshlangach to'xtatib bo'lmaydi.",
    c1: "Xonada yolg'izman, eshik yopiq, atrof tinch",
    c2: "Telefon, kitob, daftar va qog'ozlar stolda ham, yonimda ham yo'q",
    c3: 'Kompyuter quvvatga ulangan, internet barqaror',
    c4: "Imtihon {min} daqiqa davom etadi; har savolga vaqt beriladi va oldingi savolga qaytib bo'lmaydi",
    c5: "Bu imtihon bir martalik — qayta topshirish berilmaydi",
    cReadyWarn: "Tayyorlik tekshiruvida {n} ta muammo bor. Avval ularni hal qilish tavsiya etiladi.",
    cStart: 'Tasdiqlayman, boshlash',
    cCancel: 'Bekor qilish',
  },
  ru: {
    title: 'Готовность к экзамену',
    subtitle: 'Проверьте заранее — чтобы проблема не возникла во время экзамена.',
    allOk: 'Всё готово',
    issues: 'Проблем: {n}',
    checkAll: 'Проверить всё',
    check: 'Проверить',
    net: 'Интернет и сервер',
    netOk: 'Связь хорошая ({ms} мс)',
    netSlow: 'Связь медленная ({ms} мс) — сдавайте при стабильном интернете',
    netFail: 'Нет связи с сервером — проверьте интернет',
    photo: 'Фото профиля',
    photoOk: 'Фото есть — проверка личности работает',
    photoFail: 'Нет фото — вход на экзамен невозможен. Загрузите фото',
    photoBtn: 'Загрузить фото',
    cam: 'Камера и микрофон',
    camIdle: 'Проверьте: будет видно изображение и уровень звука',
    camOk: 'Камера и микрофон работают',
    camMicLow: 'Камера работает, но звук не слышен — включите микрофон и скажите что-нибудь',
    camDenied: 'Нет разрешения на камеру/микрофон',
    camNone: 'Камера или микрофон не найдены — подключите',
    camBusy: 'Камера занята другой программой (Zoom, Telegram и т.п.) — закройте её',
    camSpeak: 'Скажите что-нибудь…',
    pc: 'Компьютер',
    pcOk: 'Нет запрещённых программ, виртуальной машины и второго монитора',
    pcCloseAll: 'Закрыть все',
    pcWeb: 'Проверяется только в приложении FerMI Exam',
    app: 'Версия приложения',
    appOk: 'Последняя версия ({v})',
    appOld: 'Вышла версия {v} — закройте и снова откройте приложение, оно обновится',
    helpTitle: 'Если возникла проблема',
    helpCall: 'Администратор',
    help1: 'Пропал интернет или свет — откройте приложение снова и нажмите «Продолжить». Ответы сохраняются, таймер не останавливается.',
    help2: 'Не работает камера — закройте другие программы (Zoom, Telegram, OBS) и нажмите «Проверить».',
    help3: 'Личность не подтверждается — сядьте в светлом месте прямо перед камерой. При необходимости обновите фото.',
    help4: 'Экзамена нет в списке или «Доступ не предоставлен» — позвоните администратору.',
    fQuestions: '{n} вопр.',
    fPerQ: '~{s} с на вопрос',
    fNoBack: 'Без возврата назад',
    fOneAttempt: 'Одна попытка',
    fRoom: 'Показ комнаты в начале',
    fClosesIn: 'Закроется через',
    fPersonal: 'Открыт для вас до',
    cTitle: 'Перед началом экзамена',
    cLead: 'Подтвердите следующее. Начатый экзамен остановить нельзя.',
    c1: 'Я один в комнате, дверь закрыта, вокруг тихо',
    c2: 'Телефона, книг, тетрадей и бумаг нет ни на столе, ни рядом',
    c3: 'Компьютер подключён к питанию, интернет стабильный',
    c4: 'Экзамен длится {min} мин; на каждый вопрос даётся время, вернуться назад нельзя',
    c5: 'Этот экзамен одноразовый — пересдача не предоставляется',
    cReadyWarn: 'В проверке готовности есть проблемы: {n}. Рекомендуется сначала их устранить.',
    cStart: 'Подтверждаю, начать',
    cCancel: 'Отмена',
  },
  en: {
    title: 'Exam readiness',
    subtitle: 'Check in advance so problems do not appear during the exam.',
    allOk: 'All set',
    issues: '{n} issue(s)',
    checkAll: 'Check everything',
    check: 'Check',
    net: 'Internet and server',
    netOk: 'Good connection ({ms} ms)',
    netSlow: 'Slow connection ({ms} ms) — use a stable internet connection',
    netFail: 'Cannot reach the server — check your internet',
    photo: 'Profile photo',
    photoOk: 'Photo present — identity check will work',
    photoFail: 'No photo — you cannot enter the exam. Upload a photo',
    photoBtn: 'Upload photo',
    cam: 'Camera and microphone',
    camIdle: 'Test it: you will see the camera image and sound level',
    camOk: 'Camera and microphone work',
    camMicLow: 'Camera works but no sound was heard — enable the microphone and say something',
    camDenied: 'Camera/microphone permission denied',
    camNone: 'No camera or microphone found — connect one',
    camBusy: 'The camera is used by another app (Zoom, Telegram, etc.) — close it',
    camSpeak: 'Say something…',
    pc: 'Computer',
    pcOk: 'No forbidden apps, virtual machine or extra monitor',
    pcCloseAll: 'Close all',
    pcWeb: 'Checked only in the FerMI Exam app',
    app: 'App version',
    appOk: 'Latest version ({v})',
    appOld: 'Version {v} is available — close and reopen the app to update',
    helpTitle: 'If something goes wrong',
    helpCall: 'Administrator',
    help1: 'Internet or power lost — reopen the app and press "Resume". Your answers are saved; the timer does not stop.',
    help2: 'Camera not working — close other apps (Zoom, Telegram, OBS) and press "Check".',
    help3: 'Identity not confirmed — sit in good light facing the camera. Update your photo if needed.',
    help4: 'Exam not listed or "Access not granted" — call the administrator.',
    fQuestions: '{n} questions',
    fPerQ: '~{s} s per question',
    fNoBack: 'No going back',
    fOneAttempt: 'One attempt',
    fRoom: 'Room scan at start',
    fClosesIn: 'Closes in',
    fPersonal: 'Open for you until',
    cTitle: 'Before you start',
    cLead: 'Please confirm the following. A started exam cannot be paused.',
    c1: 'I am alone in the room, the door is closed, it is quiet',
    c2: 'No phone, books, notebooks or papers on the desk or near me',
    c3: 'The computer is plugged in and the internet is stable',
    c4: 'The exam lasts {min} min; each question is timed and you cannot go back',
    c5: 'This is a one-time exam — no retake is granted',
    cReadyWarn: 'The readiness check found {n} issue(s). Fixing them first is recommended.',
    cStart: 'I confirm, start',
    cCancel: 'Cancel',
  },
};

function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);
}

function dot(st: Status): string {
  return st === 'ok'
    ? 'bg-emerald-500'
    : st === 'warn'
      ? 'bg-amber-500'
      : st === 'fail'
        ? 'bg-rose-500'
        : st === 'checking'
          ? 'bg-indigo-400 animate-pulse'
          : 'bg-gray-300';
}

function ring(st: Status): string {
  return st === 'ok'
    ? 'border-emerald-200 bg-emerald-50/40'
    : st === 'warn'
      ? 'border-amber-200 bg-amber-50/50'
      : st === 'fail'
        ? 'border-rose-200 bg-rose-50/50'
        : 'border-gray-200 bg-white';
}

function Tile({
  title,
  status,
  text,
  children,
  action,
}: {
  title: string;
  status: Status;
  text: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-3.5 flex flex-col gap-2 min-w-0 transition-colors ${ring(status)}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-gray-900 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot(status)}`} />
          <span className="truncate">{title}</span>
        </span>
        {action}
      </div>
      <p className="text-[12px] leading-snug text-gray-600">{text}</p>
      {children}
    </div>
  );
}

export type ReadinessSummary = { issues: number };

export function ExamReadiness({
  lang,
  hasPhoto,
  onSummary,
}: {
  lang: Language;
  hasPhoto: boolean;
  onSummary?: (s: ReadinessSummary) => void;
}) {
  const T = TX[lang] || TX.uz;
  const desktop = isDesktopApp();

  const [net, setNet] = useState<{ st: Status; ms: number }>({ st: 'idle', ms: 0 });
  const [cam, setCam] = useState<{ st: Status; text: string }>({ st: 'idle', text: T.camIdle });
  const [camLive, setCamLive] = useState(false);
  const [level, setLevel] = useState(0);
  const [pc, setPc] = useState<{ st: Status; data: DesktopCheck | null }>({ st: 'idle', data: null });
  const [appv, setAppv] = useState<{ st: Status; text: string }>({ st: 'idle', text: '' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const camTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopCam = useCallback(() => {
    if (camTimerRef.current != null) window.clearTimeout(camTimerRef.current);
    camTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    void audioRef.current?.close().catch(() => {});
    audioRef.current = null;
    setCamLive(false);
    setLevel(0);
  }, []);
  useEffect(() => stopCam, [stopCam]);

  const checkNet = useCallback(async () => {
    setNet({ st: 'checking', ms: 0 });
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(apiUrl('/api/health'), { cache: 'no-store', signal: ctrl.signal });
      const ms = Math.round(performance.now() - t0);
      setNet({ st: res.ok ? (ms > 1500 ? 'warn' : 'ok') : 'fail', ms });
    } catch {
      setNet({ st: 'fail', ms: 0 });
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  const checkPc = useCallback(async () => {
    const d = getDesktop();
    if (!d) return;
    setPc((p) => ({ st: 'checking', data: p.data }));
    try {
      const r = await d.systemCheck();
      setPc({ st: r.ok ? 'ok' : 'fail', data: r });
    } catch {
      setPc({ st: 'fail', data: null });
    }
  }, []);

  const closeApps = useCallback(async () => {
    const d = getDesktop();
    const names = (pc.data?.apps || []).map((a) => a.name);
    if (!d || !names.length) return;
    setPc((p) => ({ st: 'checking', data: p.data }));
    try {
      await d.closeApps(names);
      await new Promise((r) => setTimeout(r, 1500));
    } catch {
      /* ignore */
    }
    void checkPc();
  }, [pc.data, checkPc]);

  const checkApp = useCallback(async () => {
    const d = getDesktop();
    if (!d) return;
    const info = await fetchDesktopInfo(apiUrl);
    if (!info || !info.version) {
      setAppv({ st: 'ok', text: fill(T.appOk, { v: d.version }) });
      return;
    }
    setAppv(
      versionLess(d.version, info.version)
        ? { st: 'warn', text: fill(T.appOld, { v: info.version }) }
        : { st: 'ok', text: fill(T.appOk, { v: d.version }) },
    );
  }, [T]);

  const testCam = useCallback(async () => {
    stopCam();
    setCam({ st: 'checking', text: T.camSpeak });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name || '';
      setCam({
        st: 'fail',
        text: name === 'NotAllowedError' ? T.camDenied : name === 'NotReadableError' ? T.camBusy : T.camNone,
      });
      return;
    }
    if (!mountedRef.current) {
      // Sahifadan chiqib ketilgan — kamera band bo'lib qolmasin.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    setCamLive(true);
    window.setTimeout(() => {
      if (videoRef.current && streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        void videoRef.current.play().catch(() => {});
      }
    }, 30);
    let peak = 0;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioRef.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      void ctx.resume?.().catch(() => {});
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        if (audioRef.current !== ctx) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        if (rms > peak) peak = rms;
        setLevel(Math.min(1, rms * 8));
        requestAnimationFrame(loop);
      };
      loop();
    } catch {
      peak = 1;
    }
    camTimerRef.current = window.setTimeout(() => {
      const hasVideo = stream.getVideoTracks().some((t) => t.readyState === 'live');
      const hasAudio = stream.getAudioTracks().length > 0;
      if (!hasVideo) setCam({ st: 'fail', text: T.camNone });
      else if (!hasAudio || peak < 0.012) setCam({ st: 'warn', text: T.camMicLow });
      else setCam({ st: 'ok', text: T.camOk });
      stopCam();
    }, 6000);
  }, [T, stopCam]);

  const checkAll = useCallback(() => {
    void checkNet();
    void checkPc();
    void checkApp();
  }, [checkNet, checkPc, checkApp]);

  useEffect(() => {
    checkAll();
    const id = window.setInterval(() => {
      void checkNet();
      void checkPc();
    }, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const photoSt: Status = hasPhoto ? 'ok' : 'fail';
  const statuses: Status[] = [net.st, photoSt, cam.st, ...(desktop ? [pc.st, appv.st] : [])];
  const issues = statuses.filter((s) => s === 'fail' || s === 'warn').length;
  useEffect(() => {
    onSummary?.({ issues });
  }, [issues, onSummary]);

  const netText =
    net.st === 'ok'
      ? fill(T.netOk, { ms: net.ms })
      : net.st === 'warn'
        ? fill(T.netSlow, { ms: net.ms })
        : net.st === 'fail'
          ? T.netFail
          : '…';

  const pcText = !desktop
    ? T.pcWeb
    : pc.st === 'ok'
      ? T.pcOk
      : pc.data?.problems?.length
        ? pc.data.problems.map((p) => p.title).join(' · ')
        : '…';

  const btn = 'shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50';

  return (
    <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3.5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-gray-900 inline-flex items-center gap-2">
              {T.title}
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                  issues === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                }`}
              >
                {issues === 0 ? T.allOk : fill(T.issues, { n: issues })}
              </span>
            </h2>
            <p className="text-[12.5px] text-gray-500 mt-0.5">{T.subtitle}</p>
          </div>
          <button type="button" onClick={checkAll} className="rounded-lg bg-indigo-600 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-700">
            {T.checkAll}
          </button>
        </div>
        <div className={`grid gap-3 sm:grid-cols-2 ${desktop ? 'lg:grid-cols-3 2xl:grid-cols-5' : 'lg:grid-cols-4'}`}>
          <Tile
            title={T.net}
            status={net.st}
            text={netText}
            action={
              <button type="button" className={btn} disabled={net.st === 'checking'} onClick={() => void checkNet()}>
                {T.check}
              </button>
            }
          />
          <Tile
            title={T.photo}
            status={photoSt}
            text={hasPhoto ? T.photoOk : T.photoFail}
            action={
              !hasPhoto ? (
                <a href="/profil-rasm" className="shrink-0 rounded-lg bg-rose-600 px-2.5 py-1 text-[11.5px] font-semibold text-white">
                  {T.photoBtn}
                </a>
              ) : undefined
            }
          />
          <Tile
            title={T.cam}
            status={cam.st}
            text={cam.text}
            action={
              <button type="button" className={btn} disabled={cam.st === 'checking'} onClick={() => void testCam()}>
                {T.check}
              </button>
            }
          >
            {camLive && (
              <div className="flex items-center gap-2">
                <video ref={videoRef} muted playsInline className="h-16 w-24 rounded-md bg-black object-cover" style={{ transform: 'scaleX(-1)' }} />
                <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
              </div>
            )}
          </Tile>
          <Tile
            title={T.pc}
            status={desktop ? pc.st : 'idle'}
            text={pcText}
            action={
              desktop ? (
                pc.data?.apps?.length ? (
                  <button type="button" className="shrink-0 rounded-lg bg-rose-600 px-2.5 py-1 text-[11.5px] font-semibold text-white" onClick={() => void closeApps()}>
                    {T.pcCloseAll}
                  </button>
                ) : (
                  <button type="button" className={btn} disabled={pc.st === 'checking'} onClick={() => void checkPc()}>
                    {T.check}
                  </button>
                )
              ) : undefined
            }
          >
            {desktop && pc.data?.apps?.length ? (
              <div className="flex flex-wrap gap-1">
                {pc.data.apps.map((a) => (
                  <span key={a.name} className="rounded-md bg-white border border-rose-200 px-1.5 py-0.5 text-[11px] font-medium text-rose-800">
                    {a.name}
                  </span>
                ))}
              </div>
            ) : null}
          </Tile>
          {desktop && <Tile title={T.app} status={appv.st} text={appv.text || '…'} />}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <h2 className="text-[15px] font-bold text-gray-900">{T.helpTitle}</h2>
          <a
            href={`tel:${SUPPORT_TEL}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[12.5px] font-bold text-indigo-700"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            {T.helpCall}: {SUPPORT_PHONE}
          </a>
        </div>
        <ul className="space-y-2">
          {[T.help1, T.help2, T.help3, T.help4].map((h, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-gray-700">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500">
                {i + 1}
              </span>
              {h}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function perQuestionSeconds(exam: any): number {
  const n = Math.max(1, Number(exam?.bank_question_count || 0));
  const dur = Number(exam?.duration_minutes || 0) * 60;
  return dur > 0 ? Math.max(40, Math.floor(dur / n)) : 90;
}

function countdown(ms: number, lang: Language): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const u = lang === 'ru' ? { d: 'д', h: 'ч', m: 'мин' } : lang === 'en' ? { d: 'd', h: 'h', m: 'min' } : { d: 'kun', h: 'soat', m: 'daq' };
  if (d > 0) return `${d} ${u.d} ${h} ${u.h}`;
  if (h > 0) return `${h} ${u.h} ${mm} ${u.m}`;
  return `${mm} ${u.m}`;
}

/** Imtihon kartasidagi asosiy shartlar (savollar soni, savolga vaqt, bir martalik, yopilishigacha). */
export function ExamFacts({ exam, lang, now }: { exam: any; lang: Language; now: number }) {
  const T = TX[lang] || TX.uz;
  const desktop = isDesktopApp();
  const until = exam?.access_until ? new Date(exam.access_until).getTime() : NaN;
  const end = exam?.end_time ? new Date(exam.end_time).getTime() : NaN;
  const start = exam?.start_time ? new Date(exam.start_time).getTime() : NaN;
  const open = Number.isFinite(until) && Number.isFinite(start) && now >= start && now <= until;
  const personal = Number.isFinite(until) && Number.isFinite(end) && until > end + 60_000;
  const chips: string[] = [];
  if (exam?.bank_question_count) chips.push(fill(T.fQuestions, { n: exam.bank_question_count }));
  if (desktop && exam?.bank_question_count) {
    chips.push(fill(T.fPerQ, { s: perQuestionSeconds(exam) }));
    chips.push(T.fNoBack);
  }
  if (exam?.access?.one_attempt) chips.push(T.fOneAttempt);
  return (
    <div className="mt-3.5 space-y-2">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
              {c}
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className={`rounded-lg px-3 py-2 text-[12px] flex items-center justify-between gap-2 ${until - now < 3600_000 ? 'bg-rose-50 text-rose-800' : 'bg-indigo-50 text-indigo-800'}`}>
          <span className="font-medium">
            {personal
              ? `${T.fPersonal}: ${new Date(until).toLocaleString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
              : T.fClosesIn}
          </span>
          <span className="font-bold tabular-nums">{countdown(until - now, lang)}</span>
        </div>
      )}
    </div>
  );
}

/** Boshlashdan oldin tasdiqlash: talaba shartlarni belgilamaguncha imtihon boshlanmaydi. */
export function StartExamConfirm({
  exam,
  lang,
  readinessIssues,
  onCancel,
  onConfirm,
}: {
  exam: any | null;
  lang: Language;
  readinessIssues: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const T = TX[lang] || TX.uz;
  const items = exam
    ? [
        T.c1,
        T.c2,
        T.c3,
        fill(T.c4, { min: exam.duration_minutes || 0 }),
        ...(exam?.access?.one_attempt ? [T.c5] : []),
      ]
    : [];
  const [checked, setChecked] = useState<boolean[]>([]);
  useEffect(() => {
    setChecked(items.map(() => false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.id]);
  const all = items.length > 0 && checked.length === items.length && checked.every(Boolean);
  return (
    <AnimatePresence>
      {exam && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/55 backdrop-blur-sm px-4"
          role="dialog"
          aria-modal="true"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-3">
              <h3 className="text-[18px] font-bold text-gray-900">{T.cTitle}</h3>
              <p className="text-[13px] text-gray-500 mt-1">{exam.title}</p>
              <p className="text-[12.5px] text-gray-600 mt-2">{T.cLead}</p>
            </div>
            <div className="px-6 space-y-2">
              {items.map((it, i) => (
                <label
                  key={i}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${checked[i] ? 'border-emerald-300 bg-emerald-50/60' : 'border-gray-200 hover:bg-gray-50'}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-emerald-600"
                    checked={Boolean(checked[i])}
                    onChange={(e) => setChecked((prev) => items.map((_, j) => (j === i ? e.target.checked : Boolean(prev[j]))))}
                  />
                  <span className="text-[13px] leading-snug text-gray-800">{it}</span>
                </label>
              ))}
              {readinessIssues > 0 && (
                <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] font-medium text-amber-900">
                  {fill(T.cReadyWarn, { n: readinessIssues })}
                </p>
              )}
            </div>
            <div className="px-6 py-5 flex gap-2.5 justify-end">
              <button type="button" onClick={onCancel} className="rounded-xl border border-gray-200 px-4 py-2.5 text-[13.5px] font-semibold text-gray-700 hover:bg-gray-50">
                {T.cCancel}
              </button>
              <button
                type="button"
                disabled={!all}
                onClick={onConfirm}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300"
              >
                {T.cStart}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
