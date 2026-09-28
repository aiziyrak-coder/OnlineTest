import { useCallback, useEffect, useRef, useState } from 'react';
import { Language } from '../i18n';
import { apiUrl } from '../lib/apiUrl';
import { readJsonSafe } from '../lib/http';
import { getDesktop } from '../lib/desktop';

/*
 * Yuz orqali kirish (o'qituvchilar). Kamera 2 ta kadr oladi (~0.7 s oraliqda),
 * server ularni cam.fermi.uz / iMentor yuz bazasi bilan solishtiradi.
 * Yuz tanilmasa — cam.fermi.uz da ro'yxatdan o'tish havolasi va parol bilan kirish.
 */

export const FACE_REGISTER_URL = 'https://cam.fermi.uz/royxatdan-otish?kod=3K9CSX';

const TX = {
  uz: {
    title: 'Yuz orqali kirish',
    hint: "Kameraga to'g'ri qarang — yuzingiz ramka ichida bo'lsin.",
    start: 'Yuzni skanerlash',
    scanning: 'Tekshirilmoqda…',
    retry: 'Qayta urinish',
    camOff: "Kamerani ochib bo'lmadi. Ruxsat bering yoki boshqa dastur kamerani band qilmaganini tekshiring.",
    notFoundTitle: "Yuzingiz bazada yo'qmi?",
    notFoundText: "cam.fermi.uz saytida ro'yxatdan o'ting — taxminan bir soatdan keyin shu yerda yuz orqali kira olasiz.",
    register: "cam.fermi.uz — ro'yxatdan o'tish",
    password: 'Login va parol bilan kirish',
    netErr: "Server bilan bog'lanib bo'lmadi. Internetni tekshiring.",
  },
  ru: {
    title: 'Вход по лицу',
    hint: 'Смотрите прямо в камеру — лицо должно быть в рамке.',
    start: 'Сканировать лицо',
    scanning: 'Проверка…',
    retry: 'Повторить',
    camOff: 'Не удалось открыть камеру. Разрешите доступ или закройте другие программы, использующие камеру.',
    notFoundTitle: 'Вашего лица нет в базе?',
    notFoundText: 'Зарегистрируйтесь на cam.fermi.uz — примерно через час вы сможете входить здесь по лицу.',
    register: 'cam.fermi.uz — регистрация',
    password: 'Войти по логину и паролю',
    netErr: 'Нет связи с сервером. Проверьте интернет.',
  },
  en: {
    title: 'Sign in with your face',
    hint: 'Look straight at the camera — keep your face inside the frame.',
    start: 'Scan my face',
    scanning: 'Checking…',
    retry: 'Try again',
    camOff: 'Could not open the camera. Allow access or close other apps using it.',
    notFoundTitle: 'Your face is not registered?',
    notFoundText: 'Register at cam.fermi.uz — in about an hour you can sign in here with your face.',
    register: 'cam.fermi.uz — register',
    password: 'Sign in with login and password',
    netErr: 'Cannot reach the server. Check your internet connection.',
  },
};

/** Serverdan kelgan kodga mos foydalanuvchi matni (uz matnni server beradi). */
const CODE_TEXT: Record<string, Record<string, string>> = {
  ru: {
    FACE_NO_FACE: 'Лицо не видно чётко. Смотрите прямо в камеру при хорошем освещении и повторите.',
    FACE_UNKNOWN: 'Лицо не распознано. Повторите, глядя прямо в камеру, или зарегистрируйтесь на cam.fermi.uz.',
    FACE_UNLINKED: 'Лицо распознано, но ещё не привязано к вашему ПИНФЛ. Войдите по логину и паролю.',
    FACE_NO_ACCOUNT: 'Лицо распознано, но учётная запись на платформе не найдена. Обратитесь к администратору.',
    FACE_ROLE: 'Для этой учётной записи вход по лицу недоступен. Войдите по логину и паролю.',
    FACE_UNAVAILABLE: 'Вход по лицу сейчас недоступен. Войдите по логину и паролю.',
  },
  en: {
    FACE_NO_FACE: 'Your face is not clearly visible. Look straight at the camera in good light and try again.',
    FACE_UNKNOWN: 'Face not recognised. Try again looking straight at the camera, or register at cam.fermi.uz.',
    FACE_UNLINKED: 'Face recognised but not yet linked to your PINFL. Sign in with login and password.',
    FACE_NO_ACCOUNT: 'Face recognised but no account was found on this platform. Contact the administrator.',
    FACE_ROLE: 'Face sign-in is not available for this account. Use login and password.',
    FACE_UNAVAILABLE: 'Face sign-in is unavailable right now. Use login and password.',
  },
};

const SHOW_REGISTER = new Set(['FACE_UNKNOWN', 'FACE_UNLINKED', 'FACE_NO_ACCOUNT']);

function grabFrame(video: HTMLVideoElement): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, 720 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export function FaceLoginPanel({
  lang,
  onLogin,
  onUsePassword,
}: {
  lang: Language;
  onLogin: (token: string, user: any) => void;
  onUsePassword: () => void;
}) {
  const T = TX[lang] || TX.uz;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCamReady(true);
      } catch {
        if (!cancelled) setCamError(true);
      }
    })();
    // Kamera imtihon oldi tekshiruvida kerak bo'ladi — oynadan chiqishda albatta bo'shatiladi.
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera]);

  const scan = async () => {
    const v = videoRef.current;
    if (!v || busy) return;
    setBusy(true);
    setError('');
    setCode('');
    try {
      const f1 = grabFrame(v);
      await sleep(700);
      const f2 = grabFrame(v);
      if (!f1 || !f2) {
        setCode('FACE_NO_FACE');
        setError(CODE_TEXT[lang]?.FACE_NO_FACE || "Kadrda yuz aniq ko'rinmadi.");
        return;
      }
      const res = await fetch(apiUrl('/api/auth/face-login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames: [f1, f2] }),
      });
      const data = await readJsonSafe<{ token?: string; user?: any; error?: string; code?: string }>(res);
      if (res.ok && data?.token && data?.user) {
        stopCamera();
        onLogin(data.token, data.user);
        return;
      }
      const c = String(data?.code || '');
      setCode(c);
      setError(CODE_TEXT[lang]?.[c] || data?.error || T.netErr);
    } catch {
      setError(T.netErr);
    } finally {
      setBusy(false);
    }
  };

  const openRegister = async () => {
    const d = getDesktop();
    if (d?.openExternal) {
      const ok = await d.openExternal(FACE_REGISTER_URL).catch(() => false);
      if (ok) return;
    }
    window.open(FACE_REGISTER_URL, '_blank', 'noopener');
  };

  const usePassword = () => {
    stopCamera();
    onUsePassword();
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h3 className="text-[16px] font-bold text-gray-900">{T.title}</h3>
        <p className="mt-1 text-[13px] text-gray-500">{T.hint}</p>
      </div>

      <div className="relative mx-auto aspect-[4/3] w-full max-w-[340px] overflow-hidden rounded-2xl bg-slate-900">
        <video ref={videoRef} muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
        {/* Yuz ramkasi */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <div
            className={`h-[72%] w-[52%] rounded-[50%] border-[3px] ${
              busy ? 'border-indigo-400 animate-pulse' : error ? 'border-rose-400' : 'border-white/80'
            }`}
          />
        </div>
        {!camReady && !camError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        ) : null}
        {camError ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[13px] text-white/90">{T.camOff}</div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">{error}</div>
      ) : null}

      <button
        type="button"
        onClick={() => void scan()}
        disabled={!camReady || busy}
        className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[15px] font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? T.scanning : error ? T.retry : T.start}
      </button>

      {(camError || SHOW_REGISTER.has(code) || !code) ? (
        <div className="rounded-xl border border-gray-200 bg-slate-50 px-3.5 py-3 text-[12.5px] text-gray-600">
          <p className="font-semibold text-gray-800">{T.notFoundTitle}</p>
          <p className="mt-0.5">{T.notFoundText}</p>
          <button type="button" onClick={() => void openRegister()} className="mt-2 font-semibold text-indigo-700 hover:underline">
            {T.register} →
          </button>
        </div>
      ) : null}

      <button type="button" onClick={usePassword} className="w-full text-center text-[13px] font-semibold text-gray-500 hover:text-gray-800">
        {T.password}
      </button>
    </div>
  );
}
