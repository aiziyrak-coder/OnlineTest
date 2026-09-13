import React from 'react';
import { motion } from 'motion/react';
import { Language } from '../i18n';
import { desktopServerOrigin, getDesktop, type DesktopInfo } from '../lib/desktop';

/* test.fermi.uz saytining asosiy sahifasi: test topshiruvchi ilovani yuklab oladi.
 * `user` berilsa — brauzerdan kirib qolgan test topshiruvchi (chiqish tugmasi bilan);
 * berilmasa — ochiq sahifa (administrator kirishi havolasi bilan). */

const L: Record<Language, Record<string, string>> = {
  uz: {
    eyebrow: 'Xavfsiz imtihon muhiti',
    title: 'Test topshirish uchun FerMI Exam Platform ilovasini yuklab oling',
    lead: "Imtihonlar faqat kompyuterga o'rnatiladigan FerMI Exam Platform ilovasida topshiriladi. Ilovani yuklab oling, o'rnating va login-parolingiz bilan kiring.",
    updateTitle: 'Ilovani yangilang',
    updateLead: "Sizdagi FerMI Exam Platform versiyasi eskirgan. Imtihon topshirish uchun yangi versiyani yuklab o'rnating — hisobingiz va natijalaringiz saqlanadi.",
    download: 'Ilovani yuklab olish',
    notReady: "Ilova hozircha yuklab olish uchun tayyorlanmoqda. Birozdan keyin sahifani yangilang yoki administratorga murojaat qiling.",
    version: 'Versiya',
    size: 'Hajmi',
    windows: 'Windows 10 / 11 (64-bit)',
    stepsTitle: "O'rnatish tartibi",
    s1t: 'Yuklab oling',
    s1d: "«Ilovani yuklab olish» tugmasini bosing va o'rnatuvchi faylni saqlang.",
    s2t: "O'rnating",
    s2d: "Faylni ishga tushiring. «Windows kompyuteringizni himoya qildi» oynasi chiqsa: «Batafsil» (More info) → «Baribir ishga tushirish» (Run anyway) ni bosing.",
    s3t: 'Kiring',
    s3d: "Ish stolidagi «FerMI Exam» belgisidan ilovani oching va login-parolingiz bilan kiring.",
    reqTitle: 'Talablar',
    r1: 'Windows 10 yoki 11, 64-bit kompyuter (telefon yoki planshet emas)',
    r2: 'Ishlaydigan veb-kamera va mikrofon',
    r3: 'Barqaror internet aloqasi',
    r4: 'Bitta monitor; AnyDesk, Telegram, OBS, ChatGPT kabi dasturlar yopiq',
    logout: 'Chiqish',
    signedAs: 'Kirgansiz',
    admin: 'Administrator kirishi',
    note: "Login va parolni sizga institut beradi. Sayt orqali imtihon topshirilmaydi.",
  },
  ru: {
    eyebrow: 'Безопасная среда экзамена',
    title: 'Для сдачи теста скачайте приложение FerMI Exam Platform',
    lead: 'Экзамены сдаются только в приложении FerMI Exam Platform для компьютера. Скачайте и установите приложение, затем войдите со своим логином и паролем.',
    updateTitle: 'Обновите приложение',
    updateLead: 'Ваша версия FerMI Exam Platform устарела. Чтобы сдать экзамен, скачайте и установите новую версию — ваш аккаунт и результаты сохранятся.',
    download: 'Скачать приложение',
    notReady: 'Приложение готовится к загрузке. Обновите страницу чуть позже или обратитесь к администратору.',
    version: 'Версия',
    size: 'Размер',
    windows: 'Windows 10 / 11 (64-bit)',
    stepsTitle: 'Порядок установки',
    s1t: 'Скачайте',
    s1d: 'Нажмите «Скачать приложение» и сохраните установочный файл.',
    s2t: 'Установите',
    s2d: 'Запустите файл. Если появится окно «Windows защитила ваш компьютер»: нажмите «Подробнее» → «Выполнить в любом случае».',
    s3t: 'Войдите',
    s3d: 'Откройте приложение с ярлыка «FerMI Exam» на рабочем столе и войдите со своим логином и паролем.',
    reqTitle: 'Требования',
    r1: 'Компьютер с Windows 10 или 11, 64-bit (не телефон и не планшет)',
    r2: 'Рабочие веб-камера и микрофон',
    r3: 'Стабильное подключение к интернету',
    r4: 'Один монитор; AnyDesk, Telegram, OBS, ChatGPT и подобные программы закрыты',
    logout: 'Выйти',
    signedAs: 'Вы вошли как',
    admin: 'Вход для администратора',
    note: 'Логин и пароль выдаёт институт. Через сайт экзамен не сдаётся.',
  },
  en: {
    eyebrow: 'Secure exam environment',
    title: 'Download the FerMI Exam Platform app to take your test',
    lead: 'Exams are taken only in the FerMI Exam Platform desktop app. Download and install the app, then sign in with your login and password.',
    updateTitle: 'Update the app',
    updateLead: 'Your FerMI Exam Platform version is outdated. Download and install the new version to take the exam — your account and results are kept.',
    download: 'Download the app',
    notReady: 'The app is being prepared for download. Refresh this page a little later or contact the administrator.',
    version: 'Version',
    size: 'Size',
    windows: 'Windows 10 / 11 (64-bit)',
    stepsTitle: 'How to install',
    s1t: 'Download',
    s1d: 'Click "Download the app" and save the installer.',
    s2t: 'Install',
    s2d: 'Run the file. If "Windows protected your PC" appears, click "More info" → "Run anyway".',
    s3t: 'Sign in',
    s3d: 'Open the app from the "FerMI Exam" desktop shortcut and sign in with your login and password.',
    reqTitle: 'Requirements',
    r1: 'A Windows 10 or 11 64-bit computer (not a phone or tablet)',
    r2: 'A working webcam and microphone',
    r3: 'A stable internet connection',
    r4: 'One monitor; apps like AnyDesk, Telegram, OBS, ChatGPT closed',
    logout: 'Sign out',
    signedAs: 'Signed in as',
    admin: 'Administrator sign-in',
    note: 'Your login and password are issued by the institute. Exams cannot be taken on the website.',
  },
};

type Props = {
  info: DesktopInfo;
  lang: Language;
  setLang: (l: Language) => void;
  /** Brauzerdan kirib qolgan test topshiruvchi (berilmasa — ochiq sahifa). */
  user?: { name?: string; id?: string | number } | null;
  onLogout?: () => void;
  /** Ochiq sahifada administrator kirish manzili. */
  adminLoginHref?: string;
  /** Ilova ichidan, lekin versiya eskirgan. */
  updateOnly?: boolean;
};

const ICONS = {
  download: 'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3',
  install: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  login: 'M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1',
};

export function DesktopRequired({ info, lang, setLang, user, onLogout, adminLoginHref, updateOnly }: Props) {
  const T = L[lang] || L.uz;
  const steps = [
    { t: T.s1t, d: T.s1d, icon: ICONS.download },
    { t: T.s2t, d: T.s2d, icon: ICONS.install },
    { t: T.s3t, d: T.s3d, icon: ICONS.login },
  ];
  return (
    <div className="min-h-screen w-full bg-[#f4f6fb] flex flex-col">
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 text-white">
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
          aria-hidden
        />
        <motion.div
          className="absolute -top-24 -left-20 w-[26rem] h-[26rem] rounded-full bg-indigo-400/25 blur-3xl pointer-events-none"
          animate={{ x: [0, 24, 0], y: [0, 18, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden
        />
        <motion.div
          className="absolute -bottom-32 right-0 w-[24rem] h-[24rem] rounded-full bg-cyan-400/15 blur-3xl pointer-events-none"
          animate={{ x: [0, -20, 0], y: [0, -14, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden
        />
        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/institute-logo.png" alt="FJSTI" className="h-9 w-9 rounded-full bg-white object-contain p-0.5" />
            <span className="text-[15px] font-semibold truncate">FerMI Exam Platform</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center h-9 rounded-lg bg-white/10 p-0.5">
              {(['uz', 'ru', 'en'] as Language[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  className={`h-full px-2.5 rounded-md text-xs font-semibold transition-colors ${
                    lang === l ? 'bg-white text-indigo-800' : 'text-indigo-100 hover:text-white'
                  }`}
                >
                  {l === 'uz' ? "O'z" : l === 'ru' ? 'Ру' : 'En'}
                </button>
              ))}
            </div>
            {onLogout ? (
              <button
                type="button"
                onClick={onLogout}
                className="h-9 px-3.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/15 text-[13px] font-medium"
              >
                {T.logout}
              </button>
            ) : adminLoginHref ? (
              <a
                href={adminLoginHref}
                className="hidden sm:inline-flex h-9 items-center px-3.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/15 text-[13px] font-medium"
              >
                {T.admin}
              </a>
            ) : null}
          </div>
        </div>

        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-12 sm:py-16 grid gap-10 lg:grid-cols-[1.25fr_1fr] items-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-indigo-200/80">{T.eyebrow}</p>
            <h1 className="mt-3 text-3xl sm:text-[2.4rem] font-bold leading-[1.15] tracking-tight">
              {updateOnly ? T.updateTitle : T.title}
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-indigo-100/85">
              {updateOnly ? T.updateLead : T.lead}
            </p>
            {user ? (
              <p className="mt-5 text-[12.5px] text-indigo-200/70">
                {T.signedAs}: <span className="font-semibold text-white">{user.name || user.id}</span>
              </p>
            ) : (
              <p className="mt-5 text-[12.5px] text-indigo-200/70">{T.note}</p>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur p-6 sm:p-7 shadow-2xl"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-indigo-700 shadow-lg shadow-indigo-900/50 text-3xl font-black">
                F
              </div>
              <div>
                <div className="text-lg font-bold">FerMI Exam Platform</div>
                <div className="text-[12.5px] text-indigo-200/80">{T.windows}</div>
              </div>
            </div>
            {info.download_url ? (
              <>
                <a
                  href={info.download_url}
                  download
                  onClick={(ev) => {
                    // Ilova ichida: fayl tizim brauzerida yuklanadi (ilova o'z sahifasida qoladi).
                    const d = getDesktop();
                    if (d?.openExternal) {
                      ev.preventDefault();
                      void d.openExternal(`${desktopServerOrigin()}${info.download_url}`);
                    }
                  }}
                  className="group mt-6 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-white text-indigo-900 text-[15.5px] font-bold shadow-[0_18px_40px_-18px_rgba(255,255,255,0.7)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.download} />
                  </svg>
                  {T.download}
                </a>
                <div className="mt-3 flex justify-center gap-4 text-[12px] text-indigo-200/80">
                  {info.version && (
                    <span>
                      {T.version} {info.version}
                    </span>
                  )}
                  {info.size_mb > 0 && (
                    <span>
                      {T.size} {info.size_mb} MB
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-6 rounded-xl bg-amber-400/15 px-4 py-3 text-[13px] text-amber-100">{T.notReady}</p>
            )}
          </motion.div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto w-full px-5 sm:px-8 py-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <h2 className="text-[15px] font-bold text-gray-900">{T.stepsTitle}</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {steps.map((s, i) => (
              <motion.li
                key={s.t}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.07 }}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={s.icon} />
                    </svg>
                  </span>
                  <span className="text-[11px] font-bold text-indigo-400">0{i + 1}</span>
                </div>
                <div className="mt-3 text-[14px] font-semibold text-gray-900">{s.t}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">{s.d}</p>
              </motion.li>
            ))}
          </ol>
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm h-fit">
          <h2 className="text-[15px] font-bold text-gray-900">{T.reqTitle}</h2>
          <ul className="mt-3 space-y-2.5">
            {[T.r1, T.r2, T.r3, T.r4].map((r) => (
              <li key={r} className="flex gap-2.5 text-[13px] leading-snug text-gray-700">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                </svg>
                {r}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {!user && adminLoginHref && (
        <footer className="mt-auto py-5 text-center text-[12px] text-gray-400">
          © {new Date().getFullYear()} FJSTI ·{' '}
          <a href={adminLoginHref} className="text-gray-500 hover:text-indigo-700 underline-offset-2 hover:underline">
            {T.admin}
          </a>
        </footer>
      )}
    </div>
  );
}

export default DesktopRequired;
