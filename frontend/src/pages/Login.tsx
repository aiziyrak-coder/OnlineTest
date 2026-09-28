import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { translations, Language } from '../i18n';
import { InstituteLogo } from '../components/InstituteLogo';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { AdminAlert } from './admin/ui';
import { isDesktopApp } from '../lib/desktop';
import { FaceLoginPanel } from '../components/FaceLoginPanel';

interface LoginProps {
  onLogin: (token: string, user: any) => void;
  lang: Language;
  setLang: (l: Language) => void;
}

const LS_REMEMBER = 'fjsti_login_remember';
const LS_ID = 'fjsti_login_saved_id';
const LS_PW_LEGACY = 'fjsti_login_saved_password';
const LANGS: Language[] = ['uz', 'ru', 'en'];
const FOCUS =
  'focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500';

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    );
  }
  return (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  );
}

/* FerMI Exam Platform ilovasida ko'rsatiladigan nom va matn (brauzerda eski matn qoladi). */
const DESKTOP_BRAND: Record<Language, { eyebrow: string; lead: string }> = {
  uz: {
    eyebrow: 'FJSTI · Xavfsiz imtihon ilovasi',
    lead: "Imtihonlar uchun maxsus himoyalangan ilova. Yuzingiz yoki login va parolingiz bilan kiring — imtihon oldidan kompyuteringiz, kamera va mikrofon avtomatik tekshiriladi.",
  },
  ru: {
    eyebrow: 'FJSTI · Защищённое приложение для экзаменов',
    lead: 'Специально защищённое приложение для экзаменов. Войдите по лицу или с логином и паролем — перед экзаменом компьютер, камера и микрофон проверяются автоматически.',
  },
  en: {
    eyebrow: 'FJSTI · Secure exam app',
    lead: 'A specially secured app for exams. Sign in with your face or your login and password — your computer, camera and microphone are checked automatically before the exam.',
  },
};

export function Login({ onLogin, lang, setLang }: LoginProps) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const idRef = useRef<HTMLInputElement>(null);
  const t = translations[lang];
  const desktop = isDesktopApp();
  /** Ilovada kirish yuz skaneridan boshlanadi; brauzerda (admin) — login va parol. */
  const [mode, setMode] = useState<'face' | 'password'>(() => (isDesktopApp() ? 'face' : 'password'));
  const brandTitle = desktop ? 'FerMI Exam Platform' : t.appBrandTitle;
  const brandEyebrow = desktop ? (DESKTOP_BRAND[lang] || DESKTOP_BRAND.uz).eyebrow : t.loginBrandEyebrow;
  const brandLead = desktop ? (DESKTOP_BRAND[lang] || DESKTOP_BRAND.uz).lead : t.loginPanelLead;

  useEffect(() => {
    try {
      localStorage.removeItem(LS_PW_LEGACY);
      if (localStorage.getItem(LS_REMEMBER) === '1') {
        setRememberMe(true);
        const sid = localStorage.getItem(LS_ID);
        if (sid) setId(sid);
      }
    } catch {
      /* ignore */
    }
    const tmr = window.setTimeout(() => idRef.current?.focus(), 180);
    return () => window.clearTimeout(tmr);
  }, []);

  const persistRemember = (loginId: string, remember: boolean) => {
    try {
      if (remember) {
        localStorage.setItem(LS_REMEMBER, '1');
        localStorage.setItem(LS_ID, loginId);
      } else {
        localStorage.removeItem(LS_REMEMBER);
        localStorage.removeItem(LS_ID);
      }
    } catch {
      /* ignore */
    }
  };

  const onPasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState?.('CapsLock') ?? false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password }),
      });
      const data = await readJsonSafe<{ token?: string; user?: any; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || t.loginFailed);
      if (!data?.token || !data?.user) throw new Error(t.loginInvalidServerResponse);
      persistRemember(id, rememberMe);
      onLogin(data.token, data.user);
    } catch (err: any) {
      setError(err.message || t.loginFailed);
      setShakeKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  };

  const bullets = [
    {
      title: t.loginBulletSecure,
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      ),
    },
    {
      title: t.loginBulletRealtime,
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      ),
    },
    {
      title: t.loginBulletProctor,
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      ),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row relative overflow-hidden bg-[#f4f6fb]">
      {/* Chap branding */}
      <div className="hidden lg:flex lg:w-[46%] xl:w-[44%] relative flex-col justify-between p-10 xl:p-14 text-white overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800">
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute inset-0 opacity-[0.07]" style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }} />
          <motion.div
            className="absolute -top-28 -left-20 w-[28rem] h-[28rem] rounded-full bg-indigo-400/25 blur-3xl"
            animate={{ x: [0, 24, 0], y: [0, 18, 0] }}
            transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute -bottom-24 -right-16 w-[26rem] h-[26rem] rounded-full bg-cyan-400/15 blur-3xl"
            animate={{ x: [0, -20, 0], y: [0, -14, 0] }}
            transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <div className="relative z-10">
          <InstituteLogo size="md" className={desktop ? 'bg-white p-1 ring-2 ring-white/30' : 'brightness-0 invert opacity-95'} />
        </div>

        <div className="relative z-10 space-y-7 max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-indigo-200/80 mb-3">
              {brandEyebrow}
            </p>
            <h1 className="text-3xl xl:text-[2.6rem] font-bold tracking-tight leading-[1.15]">
              {brandTitle}
            </h1>
            <p className="mt-4 text-indigo-100/85 text-[15px] leading-relaxed">
              {brandLead}
            </p>
          </motion.div>

          <ul className="space-y-3">
            {bullets.map((b, i) => (
              <motion.li
                key={b.title}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.18 + i * 0.08, duration: 0.4 }}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm px-3.5 py-3"
              >
                <span className="w-9 h-9 rounded-lg bg-white/12 flex items-center justify-center shrink-0">
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {b.icon}
                  </svg>
                </span>
                <span className="text-[13.5px] font-medium text-indigo-50/95">{b.title}</span>
              </motion.li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-[11px] text-indigo-200/65">
          © {new Date().getFullYear()} {t.instituteCopyright}
        </p>
      </div>

      {/* O‘ng forma */}
      <div className="flex-1 flex flex-col min-h-screen lg:min-h-0 relative">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.45]"
          aria-hidden
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(99,102,241,0.12) 1px, transparent 0)',
            backgroundSize: '22px 22px',
          }}
        />

        <div className="relative z-10 flex items-center justify-between px-4 sm:px-8 pt-5 sm:pt-6">
          <div className="lg:hidden flex items-center gap-2.5 min-w-0">
            <InstituteLogo size="sm" />
            <span className="text-[15px] font-bold text-gray-900 truncate max-w-[200px]">{brandTitle}</span>
          </div>
          <div className="flex items-center h-9 rounded-xl border border-gray-200/90 bg-white/90 backdrop-blur overflow-hidden shadow-sm ml-auto">
            {LANGS.map((l, i) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`h-full px-3 sm:px-3.5 text-xs sm:text-[13px] font-semibold transition-all ${
                  i > 0 ? 'border-l border-gray-200' : ''
                } ${lang === l ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}
              >
                {l === 'uz' ? "O'z" : l === 'ru' ? 'Ру' : 'En'}
              </button>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-8 py-8 sm:py-12">
          <motion.div
            key={shakeKey}
            initial={{ opacity: 0, y: 18 }}
            animate={
              shakeKey > 0
                ? { opacity: 1, y: 0, x: [0, -8, 8, -6, 6, -3, 0] }
                : { opacity: 1, y: 0 }
            }
            transition={{ duration: shakeKey > 0 ? 0.45 : 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[440px]"
          >
            <div className="mb-7 lg:mb-9 text-center lg:text-left">
              <h2 className="text-2xl sm:text-[28px] font-bold tracking-tight text-gray-900">{t.login}</h2>
              <p className="text-gray-500 mt-2 text-[15px]">{t.loginSubtitle}</p>
            </div>

            <div className="bg-white/95 backdrop-blur rounded-2xl border border-gray-200/90 shadow-[0_18px_50px_-28px_rgba(49,46,129,0.35)] p-6 sm:p-8">
              {mode === 'face' ? (
                <FaceLoginPanel lang={lang} onLogin={onLogin} onUsePassword={() => setMode('password')} />
              ) : (
              <form onSubmit={handleLogin} className="space-y-5" noValidate>
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-semibold text-gray-700">
                    {t.userId} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </span>
                    <input
                      ref={idRef}
                      value={id}
                      onChange={(e) => setId(e.target.value)}
                      required
                      placeholder={t.loginUserIdPlaceholder}
                      autoComplete="username"
                      disabled={loading}
                      className={`h-12 w-full rounded-xl border border-gray-200 bg-slate-50/80 pl-10 pr-3 text-[14.5px] text-gray-900 placeholder:text-gray-400 transition-colors disabled:opacity-50 ${FOCUS}`}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[13px] font-semibold text-gray-700">
                    {t.password} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={onPasswordKey}
                      onKeyUp={onPasswordKey}
                      required
                      placeholder="••••••••••••"
                      autoComplete="current-password"
                      disabled={loading}
                      className={`h-12 w-full rounded-xl border border-gray-200 bg-slate-50/80 pl-10 pr-12 text-[14.5px] text-gray-900 placeholder:text-gray-400 transition-colors disabled:opacity-50 ${FOCUS}`}
                    />
                    <button
                      type="button"
                      tabIndex={0}
                      disabled={loading}
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? t.hidePassword : t.showPassword}
                      title={showPassword ? t.hidePassword : t.showPassword}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                  <AnimatePresence>
                    {capsLock && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="text-[12px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5"
                      >
                        {t.capsLockOn}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                <label className="flex items-start gap-3 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={loading}
                    className="mt-0.5 rounded-md border-gray-300 w-4 h-4 text-indigo-600 focus:ring-indigo-400/40 accent-indigo-600"
                  />
                  <span className="text-[13px] text-gray-600 leading-snug group-hover:text-gray-800 transition-colors">
                    {t.rememberLogin}
                  </span>
                </label>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                    >
                      <AdminAlert type="error">{error}</AdminAlert>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={loading}
                  className="group relative w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-[15px] font-semibold shadow-[0_10px_24px_-12px_rgba(79,70,229,0.8)] transition-all disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden"
                >
                  <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[linear-gradient(110deg,transparent,rgba(255,255,255,.18),transparent)] translate-x-[-100%] group-hover:translate-x-[100%] duration-700" />
                  <span className="relative inline-flex items-center justify-center gap-2">
                    {loading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        {t.loginBtn}
                      </>
                    ) : (
                      <>
                        {t.loginBtn}
                        <svg className="w-4 h-4 opacity-90 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </>
                    )}
                  </span>
                </button>

                {desktop ? (
                  <button
                    type="button"
                    onClick={() => { setError(''); setMode('face'); }}
                    className="w-full h-11 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-[14px] font-semibold hover:bg-indigo-100 transition-colors"
                  >
                    {lang === 'ru' ? 'Войти по лицу' : lang === 'en' ? 'Sign in with face' : 'Yuz orqali kirish'}
                  </button>
                ) : null}

                <p className="text-center text-[11.5px] text-gray-400 leading-relaxed pt-1">
                  {t.loginSecureHint}
                </p>
              </form>
              )}
            </div>

            <p className="text-center lg:hidden text-[11px] text-gray-400 mt-8 leading-relaxed px-2">
              © {new Date().getFullYear()} {t.instituteCopyright}
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
