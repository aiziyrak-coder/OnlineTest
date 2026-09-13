import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { apiUrl } from '../lib/apiUrl';
import { getDesktop } from '../lib/desktop';

/* FerMI Exam ilovasi uchun global himoya:
 *  - chiqish (X, Alt+F4 yoki pastki burchakdagi tugma) — kirishdagi parol so'raladi;
 *    hech kim kirmagan bo'lsa parolsiz; imtihon paytida chiqishni ilovaning o'zi to'xtatadi;
 *  - ikkinchi monitor ulangan bo'lsa — butun ilova to'sib qo'yiladi. */

type Lang = 'uz' | 'ru' | 'en';

const TX: Record<Lang, Record<string, string>> = {
  uz: {
    title: 'Ilovadan chiqish',
    body: 'Chiqish uchun tizimga kirishdagi parolingizni kiriting.',
    user: 'Foydalanuvchi',
    placeholder: 'Parol',
    exit: 'Chiqish',
    cancel: 'Bekor qilish',
    wrong: "Parol noto'g'ri",
    network: "Serverga ulanib bo'lmadi. Internetni tekshiring.",
    exitBtn: 'Ilovadan chiqish',
    monTitle: 'Ikkinchi monitor ulangan',
    monBody: "FerMI Exam Platform faqat bitta ekran bilan ishlaydi. Qo'shimcha monitor, televizor yoki proyektorni uzing — ilova o'zi davom etadi.",
    monCount: 'Ulangan ekranlar: {n}',
  },
  ru: {
    title: 'Выход из приложения',
    body: 'Чтобы выйти, введите пароль, с которым вы входили в систему.',
    user: 'Пользователь',
    placeholder: 'Пароль',
    exit: 'Выйти',
    cancel: 'Отмена',
    wrong: 'Неверный пароль',
    network: 'Нет связи с сервером. Проверьте интернет.',
    exitBtn: 'Выйти из приложения',
    monTitle: 'Подключён второй монитор',
    monBody: 'FerMI Exam Platform работает только с одним экраном. Отключите дополнительный монитор, телевизор или проектор — приложение продолжит работу само.',
    monCount: 'Подключено экранов: {n}',
  },
  en: {
    title: 'Exit the app',
    body: 'Enter the password you signed in with to exit.',
    user: 'User',
    placeholder: 'Password',
    exit: 'Exit',
    cancel: 'Cancel',
    wrong: 'Incorrect password',
    network: 'Cannot reach the server. Check your internet.',
    exitBtn: 'Exit the app',
    monTitle: 'A second monitor is connected',
    monBody: 'FerMI Exam Platform works with a single screen only. Disconnect the extra monitor, TV or projector — the app will continue automatically.',
    monCount: 'Connected screens: {n}',
  },
};

function storedUser(): { id?: string | number; name?: string } | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        if (u && u.id) return u;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function storedLang(): Lang {
  try {
    const l = (localStorage.getItem('lang') || 'uz') as Lang;
    return l === 'ru' || l === 'en' ? l : 'uz';
  } catch {
    return 'uz';
  }
}

export function ExitGuard() {
  const desktop = getDesktop();
  const location = useLocation();
  const inExamRoom = location.pathname.endsWith('/room');
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ id?: string | number; name?: string } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState<Lang>(storedLang());
  const [displays, setDisplays] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const openExit = useCallback(() => {
    const d = getDesktop();
    if (!d) return;
    const u = storedUser();
    if (!u) {
      void d.confirmExit?.();
      return;
    }
    setUser(u);
    setLang(storedLang());
    setPassword('');
    setError('');
    setOpen(true);
  }, []);

  useEffect(() => {
    const d = getDesktop();
    if (!d?.onExitRequest) return;
    return d.onExitRequest(openExit);
  }, [openExit]);

  // Monitorlar soni: ilova ochilganda va har ulanish/uzilishda.
  useEffect(() => {
    const d = getDesktop();
    if (!d) return;
    void d.getDisplays?.().then((n) => setDisplays(Number(n) || 1)).catch(() => {});
    const off = d.onDisplays?.((n) => {
      setDisplays(n);
      setLang(storedLang());
    });
    const id = window.setInterval(() => {
      void d.getDisplays?.().then((n) => setDisplays(Number(n) || 1)).catch(() => {});
    }, 5000);
    return () => {
      off?.();
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  const T = TX[lang];

  const submit = useCallback(async () => {
    const d = getDesktop();
    if (!d || !user?.id || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: String(user.id), password }),
      });
      if (res.ok) {
        const ok = await d.confirmExit?.();
        if (ok === false) setOpen(false);
        return;
      }
      setError(res.status >= 500 ? T.network : T.wrong);
      setPassword('');
      inputRef.current?.focus();
    } catch {
      setError(T.network);
    } finally {
      setBusy(false);
    }
  }, [user, password, busy, T]);

  if (!desktop) return null;

  return (
    <>
      {/* Chiqish tugmasi — to'liq ekranda Windows'ning X tugmasi ko'rinmaydi. Imtihon paytida yo'q. */}
      {!inExamRoom && !open && (
        <button
          type="button"
          onClick={openExit}
          title={T.exitBtn}
          aria-label={T.exitBtn}
          className="fixed bottom-4 right-4 z-[9000] inline-flex h-10 items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-3.5 text-[12.5px] font-semibold text-gray-600 shadow-lg backdrop-blur hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v9m6.36-5.36a9 9 0 11-12.73 0" />
          </svg>
          {T.exitBtn}
        </button>
      )}

      {/* Ikkinchi monitor — butun ilova to'sib qo'yiladi. */}
      {displays > 1 && (
        <div className="fixed inset-0 z-[19000] flex items-center justify-center bg-slate-950/95 px-6" role="alertdialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-[20px] font-bold text-gray-900">{T.monTitle}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-gray-600">{T.monBody}</p>
            <p className="mt-4 inline-flex rounded-lg bg-rose-50 px-3 py-1.5 text-[13px] font-semibold text-rose-700 tabular-nums">
              {T.monCount.replace('{n}', String(displays))}
            </p>
          </div>
        </div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[20000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4"
            role="dialog"
            aria-modal="true"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          >
            <motion.form
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.16 }}
              className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </div>
              <h2 className="text-center text-[18px] font-bold text-gray-900">{T.title}</h2>
              <p className="mt-1.5 text-center text-[13px] leading-snug text-gray-500">{T.body}</p>
              <p className="mt-3 text-center text-[12px] text-gray-400">
                {T.user}: <span className="font-semibold text-gray-700">{user?.name || user?.id}</span>
              </p>
              <input
                ref={inputRef}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={T.placeholder}
                disabled={busy}
                className="mt-3 h-11 w-full rounded-xl border border-gray-200 bg-slate-50 px-3 text-[14.5px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
              />
              {error && <p className="mt-2 text-[12.5px] font-medium text-rose-600">{error}</p>}
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-11 flex-1 rounded-xl border border-gray-200 text-[13.5px] font-semibold text-gray-700 hover:bg-gray-50"
                >
                  {T.cancel}
                </button>
                <button
                  type="submit"
                  disabled={!password || busy}
                  className="h-11 flex-1 rounded-xl bg-rose-600 text-[13.5px] font-semibold text-white hover:bg-rose-700 disabled:bg-gray-300"
                >
                  {busy ? '…' : T.exit}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default ExitGuard;
