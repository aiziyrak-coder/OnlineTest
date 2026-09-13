import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { apiUrl } from '../lib/apiUrl';
import { readJsonSafe } from '../lib/http';
import { InstituteLogo } from '../components/InstituteLogo';

/**
 * Vakansiya (ishga qabul) moduli — nomzod uchun ALOHIDA kirish nuqtasi.
 *
 * Talaba/o'qituvchi kabinetidan butunlay ajratilgan: o'z sahifasi, o'z
 * ro'yxatdan o'tishi, o'z logini. Ilova qobig'idan tashqarida ishlaydi —
 * token va foydalanuvchi brauzer xotirasiga yoziladi, keyin kabinetga
 * to'liq qayta yuklash bilan o'tiladi (App foydalanuvchini xotiradan o'qiydi).
 */

type View = 'landing' | 'register' | 'login';

interface Position {
  kafedra_id: number;
  /** iMentor yo'nalishi nomi — bazadagi kafedra nomidan farq qilsa. */
  dept_name?: string;
  kafedra_name: string;
  is_clinical: boolean;
}

interface Subject {
  subject_code: string;
  subject_name: string;
  topics_count: number;
}

const ERRORS: Record<string, string> = {
  FULL_NAME_REQUIRED: 'Familiya, ism va otasining ismini to‘liq yozing.',
  PASSPORT_INVALID: 'Pasport raqami noto‘g‘ri. Namuna: AC1234567 yoki 14 xonali ID raqam.',
  PHONE_INVALID: 'Telefon raqami noto‘g‘ri. Namuna: +998901234567',
  PASSWORD_SHORT: 'Parol kamida 6 belgidan iborat bo‘lsin.',
  KAFEDRA_REQUIRED: 'Ish o‘rnini tanlang.',
  KAFEDRA_INVALID: 'Bu ish o‘rni hozir ochiq emas.',
  SUBJECT_REQUIRED: 'Fanni tanlang — test aynan shu fandan bo‘ladi.',
  ALREADY_REGISTERED: 'Bu pasport raqami allaqachon ro‘yxatdan o‘tgan. «Kirish» orqali kiring.',
  PHOTO_REQUIRED: 'Pasport rasmi va kameradagi suratingiz kerak.',
  PHOTO_INVALID: 'Rasm hajmi juda katta yoki buzuq. Boshqa rasm yuklang.',
  NO_MATCH: 'Pasportdagi yuz kameradagi yuzga mos kelmadi. Yorug‘lik yuzingizga tushsin va to‘g‘ri qarang.',
  FACE_NOT_DETECTED: 'Pasport rasmida yuz topilmadi. Rasm aniqroq bo‘lsin.',
  FACE_ENGINE_UNAVAILABLE: 'Tekshiruv xizmati vaqtincha ishlamayapti. Birozdan so‘ng urinib ko‘ring.',
  COMPARE_FAILED: 'Tekshirib bo‘lmadi. Birozdan so‘ng urinib ko‘ring.',
};

function errorText(code: string): string {
  return ERRORS[code] || 'Xatolik yuz berdi. Qaytadan urinib ko‘ring.';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      resolve(s.includes(',') ? s.split(',')[1] : s);
    };
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(file);
  });
}

/* ─────────────────────────  umumiy qismlar  ───────────────────────── */

function TopBar({ compact }: { compact?: boolean }) {
  return (
    <div className={'flex items-center gap-3 ' + (compact ? 'text-slate-900' : 'text-white')}>
      <InstituteLogo className="w-10 h-10 shrink-0" />
      <div className="min-w-0">
        <div className={'text-[14px] font-semibold leading-tight ' + (compact ? 'text-slate-900' : 'text-white')}>
          Farg‘ona jamoat salomatligi tibbiyot instituti
        </div>
        <div className={'text-[12.5px] ' + (compact ? 'text-indigo-700' : 'text-indigo-200')}>
          Ishga qabul testi
        </div>
      </div>
    </div>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {children}
      <footer className="mt-auto py-6 text-center text-[12px] text-slate-400">
        © 2026 Farg‘ona jamoat salomatligi tibbiyot instituti
      </footer>
    </div>
  );
}

/** Ichki sahifalar (ro'yxat / kirish) uchun tor va tinch qobiq. */
function FormPage({ children }: { children: React.ReactNode }) {
  return (
    <Page>
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <a href="/vakansiya" className="hover:opacity-80">
            <TopBar compact />
          </a>
          <a
            href="/vakansiya"
            className="text-[13px] text-slate-500 hover:text-slate-800 whitespace-nowrap"
          >
            ← Bosh sahifa
          </a>
        </div>
      </div>
      <div className="max-w-3xl w-full mx-auto px-5 py-8">{children}</div>
    </Page>
  );
}

export function VacancyPage({ view }: { view: View }) {
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(apiUrl('/api/vacancy/positions'))
      .then((r) => readJsonSafe<{ positions?: Position[] }>(r))
      .then((j) => {
        if (alive) setPositions(Array.isArray(j?.positions) ? j!.positions : []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (view === 'register') {
    return <FormPage><RegisterForm positions={positions} /></FormPage>;
  }
  if (view === 'login') {
    return <FormPage><LoginForm /></FormPage>;
  }
  return <Landing />;
}

/* ─────────────────────────────  bosh sahifa  ───────────────────────────── */

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.06 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

/** Imtihon oynasining maketi — nomzod nimani ko'rishini darrov tushunadi. */
function ExamPreview() {
  const options = [
    ['A', 'Sistemali sklerodermiya', false],
    ['B', 'Revmatoid artrit', true],
    ['C', 'Dermatomiozit', false],
    ['D', 'Tizimli qizil yugurik', false],
  ] as Array<[string, string, boolean]>;

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[32px] blur-2xl"
        style={{
          background:
            'radial-gradient(closest-side, rgba(99,102,241,0.30), transparent 75%),' +
            'radial-gradient(closest-side at 80% 80%, rgba(20,184,166,0.25), transparent 75%)',
        }}
      />
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_70px_-30px_rgba(15,23,42,0.45)]">
        {/* Yuqori panel */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-[11px] font-bold text-white">
              7
            </span>
            <span className="text-[12.5px] font-medium text-slate-500">/ 20 savol</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Kamera yoqilgan
            </span>
            <span className="rounded-md bg-slate-900 px-2.5 py-1 font-mono text-[12.5px] font-semibold text-white">
              12:45
            </span>
          </div>
        </div>

        {/* Progress */}
        <div className="h-1 w-full bg-slate-100">
          <div className="h-1 w-[35%] rounded-r-full bg-gradient-to-r from-indigo-500 to-teal-400" />
        </div>

        {/* Savol */}
        <div className="p-5">
          <p className="text-[13.5px] leading-relaxed text-slate-800">
            45 yoshli bemorda 6 oydan beri nafas qisishi va qo‘l barmoqlarida
            qizarish kuzatiladi. Eng ehtimoliy tashxis qaysi?
          </p>

          <div className="mt-4 space-y-2">
            {options.map(([letter, text, active]) => (
              <div
                key={letter}
                className={
                  'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-[13px] transition ' +
                  (active
                    ? 'border-indigo-300 bg-indigo-50/70 text-slate-900'
                    : 'border-slate-200 bg-white text-slate-600')
                }
              >
                <span
                  className={
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11.5px] font-bold ' +
                    (active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')
                  }
                >
                  {letter}
                </span>
                {text}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Kamera oynasi */}
      <div className="absolute -bottom-5 -left-5 hidden w-32 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 shadow-xl sm:block">
        <div className="flex h-20 items-end justify-center bg-gradient-to-b from-slate-700 to-slate-900 pb-2">
          <svg className="h-10 w-10 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z" />
          </svg>
        </div>
        <div className="flex items-center gap-1.5 bg-slate-900 px-2 py-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          <span className="text-[10px] font-medium text-slate-300">Nazorat yozuvda</span>
        </div>
      </div>
    </div>
  );
}

function Landing() {
  const steps = [
    {
      title: 'Ro‘yxatdan o‘ting',
      text: 'Pasport raqami, telefon va ish o‘rnini tanlaysiz.',
      icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
      ring: 'bg-indigo-50 text-indigo-600',
    },
    {
      title: 'Shaxsingiz tasdiqlanadi',
      text: 'Pasportdagi rasm kameradagi suratingiz bilan solishtiriladi.',
      icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      ring: 'bg-sky-50 text-sky-600',
    },
    {
      title: 'Testni topshirasiz',
      text: 'Natija va shaxsiy tekshiruv kodi darrov chiqadi.',
      icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
      ring: 'bg-emerald-50 text-emerald-600',
    },
  ];

  const facts: Array<[string, string]> = [
    ['20', 'ta savol'],
    ['20', 'daqiqa'],
    ['1', 'urinish'],
    ['50%', 'o‘tish chegarasi'],
  ];

  const guards = [
    {
      title: 'Yuzni tanish',
      text: 'Imtihon davomida kameradagi yuz profil rasmi bilan solishtirib turiladi.',
      icon: 'M12 11a3 3 0 100-6 3 3 0 000 6zm0 2c-3 0-6 1.5-6 4v1h12v-1c0-2.5-3-4-6-4z',
    },
    {
      title: 'Ekran nazorati',
      text: 'Boshqa oynaga o‘tish yoki to‘liq ekrandan chiqish qayd etiladi.',
      icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    },
    {
      title: 'Begona buyumlar',
      text: 'Telefon yoki kitob kadrda ko‘rinsa tizim ogohlantiradi.',
      icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
    },
    {
      title: 'Bitta qurilma',
      text: 'Sinov boshlangan kompyuterdan boshqasiga o‘tib bo‘lmaydi.',
      icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
    },
  ];

  const needs = [
    'Kamerali kompyuter yoki noutbuk',
    'Barqaror internet',
    'Pasport (rasm bor sahifasi)',
    'Tinch, yorug‘ xona',
  ];

  const faq = [
    ['Test qancha vaqt davom etadi?', 'Har bir sinov 20 ta savoldan iborat va 20 daqiqa davom etadi. Vaqt tugaguncha yakunlash tugmasini bosishingiz kerak.'],
    ['Telefondan topshirsam bo‘ladimi?', 'Yo‘q. Sinov faqat kamerali kompyuter yoki noutbukda topshiriladi — nazorat tizimi shuni talab qiladi.'],
    ['Natijani qachon bilaman?', 'Testni yakunlagan zahoti ekranda ballingiz, foizingiz va shaxsiy tekshiruv kodingiz chiqadi.'],
    ['Qayta topshirish mumkinmi?', 'Har bir nomzodga bitta urinish beriladi. Texnik nosozlik yuz bergan bo‘lsa, institut xodimlari qayta imkon berishi mumkin.'],
    ['Parolimni unutsam-chi?', 'Institut kadrlar bo‘limiga murojaat qiling — hisobingiz pasport raqami bo‘yicha topiladi.'],
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      {/* Fon: yumshoq rangli dog'lar + nozik to'r */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[760px]"
        style={{
          background:
            'radial-gradient(900px 420px at 15% 0%, rgba(99,102,241,0.16), transparent 65%),' +
            'radial-gradient(760px 420px at 85% 8%, rgba(20,184,166,0.14), transparent 65%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[760px] opacity-[0.55]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(15,23,42,0.045) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(15,23,42,0.045) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(700px 380px at 50% 0%, black, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(700px 380px at 50% 0%, black, transparent 75%)',
        }}
      />

      {/* Sarlavha qatori */}
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <TopBar compact />
        <div className="flex items-center gap-2">
          <a
            href="/vakansiya/login"
            className="rounded-full px-4 py-2 text-[13.5px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Kirish
          </a>
          <a
            href="/vakansiya/register"
            className="hidden rounded-full bg-slate-900 px-4 py-2 text-[13.5px] font-semibold text-white transition hover:bg-slate-800 sm:inline-block"
          >
            Ro‘yxatdan o‘tish
          </a>
        </div>
      </header>

      {/* Hero: chapda matn, o'ngda imtihon maketi */}
      <section className="mx-auto max-w-6xl px-6 pt-8 pb-6 sm:pt-12">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <motion.div custom={0} variants={fadeUp} initial="hidden" animate="show">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3.5 py-1.5 text-[12.5px] font-medium text-slate-600 shadow-sm backdrop-blur">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Nomzodlar uchun ochiq sinov
              </span>
            </motion.div>

            <motion.h1
              custom={1}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mt-6 text-[36px] font-bold leading-[1.06] tracking-[-0.025em] text-slate-900 sm:text-[50px]"
            >
              Ishga qabul uchun{' '}
              <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-teal-500 bg-clip-text text-transparent">
                bilim sinovi
              </span>
            </motion.h1>

            <motion.p
              custom={2}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mt-5 max-w-lg text-[15.5px] leading-relaxed text-slate-500"
            >
              Ochiq ish o‘rinlariga nomzodlarning kasbiy bilimi masofadan, nazorat ostida
              sinovdan o‘tkaziladi. Ro‘yxatdan o‘tgach testni o‘sha zahoti topshirasiz.
            </motion.p>

            <motion.div
              custom={3}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <a
                href="/vakansiya/register"
                className="group inline-flex items-center gap-2 rounded-full bg-slate-900 px-7 py-3.5 text-[14.5px] font-semibold text-white shadow-[0_12px_30px_-10px_rgba(15,23,42,0.6)] transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                Ro‘yxatdan o‘tish
                <svg
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
              <a
                href="/vakansiya/login"
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-7 py-3.5 text-[14.5px] font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300"
              >
                Hisobim bor
              </a>
            </motion.div>

            <motion.div
              custom={4}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mt-10 grid max-w-lg grid-cols-4 divide-x divide-slate-200 rounded-2xl border border-slate-200 bg-white/70 py-4 shadow-sm backdrop-blur"
            >
              {facts.map(([big, small]) => (
                <div key={small} className="px-2 text-center">
                  <div className="text-[21px] font-bold leading-none text-slate-900">{big}</div>
                  <div className="mt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-slate-400">
                    {small}
                  </div>
                </div>
              ))}
            </motion.div>
          </div>

          <motion.div custom={3} variants={fadeUp} initial="hidden" animate="show" className="lg:pl-6">
            <ExamPreview />
          </motion.div>
        </div>
      </section>

      {/* Qadamlar */}
      <section className="mt-14 border-y border-slate-200/70 bg-slate-50/70">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="text-center">
            <h2 className="text-[24px] font-bold tracking-tight text-slate-900">Qanday o‘tadi</h2>
            <p className="mt-1.5 text-[14px] text-slate-500">Uch qadam — o‘n daqiqadan kam vaqt.</p>
          </div>

          <div className="mt-9 grid gap-5 sm:grid-cols-3">
            {steps.map((s, i) => (
              <motion.div
                key={s.title}
                custom={i}
                variants={fadeUp}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: '-60px' }}
                className="relative rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-[0_20px_45px_-25px_rgba(15,23,42,0.35)]"
              >
                <div className="flex items-center justify-between">
                  <div className={'flex h-11 w-11 items-center justify-center rounded-xl ' + s.ring}>
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d={s.icon} />
                    </svg>
                  </div>
                  <span className="text-[13px] font-semibold text-slate-300">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-[16px] font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">{s.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Nazorat + talablar */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <h2 className="text-[24px] font-bold tracking-tight text-slate-900">Sinov qanday nazorat qilinadi</h2>
            <p className="mt-1.5 max-w-lg text-[14px] text-slate-500">
              Natija adolatli bo‘lishi uchun sinov davomida bir necha nazorat qatlami ishlaydi.
            </p>
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              {guards.map((g, i) => (
                <motion.div
                  key={g.title}
                  custom={i}
                  variants={fadeUp}
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, margin: '-60px' }}
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
                    <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d={g.icon} />
                    </svg>
                  </div>
                  <div className="mt-3.5 text-[14.5px] font-semibold text-slate-900">{g.title}</div>
                  <div className="mt-1 text-[13px] leading-relaxed text-slate-500">{g.text}</div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6">
              <h3 className="text-[16px] font-semibold text-slate-900">Nima kerak bo‘ladi</h3>
              <ul className="mt-4 space-y-3">
                {needs.map((n) => (
                  <li key={n} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="text-[13.5px] leading-relaxed text-slate-600">{n}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 rounded-xl bg-amber-50 p-4 text-[12.5px] leading-relaxed text-amber-900 ring-1 ring-amber-200/70">
                Pasportingizni oldindan tayyorlab qo‘ying — ro‘yxatdan o‘tishda uning rasm bor
                sahifasi kerak bo‘ladi.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Savol-javob */}
      <section className="border-t border-slate-200/70 bg-slate-50/70">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-center text-[24px] font-bold tracking-tight text-slate-900">
            Ko‘p beriladigan savollar
          </h2>
          <div className="mt-8 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {faq.map(([q, a]) => (
              <details key={q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14.5px] font-semibold text-slate-800">
                  {q}
                  <svg
                    className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-slate-500">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Yakuniy chaqiriq */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="relative overflow-hidden rounded-3xl bg-slate-900 px-8 py-12 text-center">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(600px 240px at 20% 0%, rgba(99,102,241,0.45), transparent 65%),' +
                'radial-gradient(520px 240px at 85% 110%, rgba(20,184,166,0.35), transparent 65%)',
            }}
          />
          <div className="relative">
            <h2 className="text-[26px] font-bold tracking-tight text-white">Boshlashga tayyormisiz?</h2>
            <p className="mx-auto mt-2.5 max-w-md text-[14px] text-slate-300">
              Ro‘yxatdan o‘tish bir necha daqiqa vaqt oladi. Testni o‘sha zahoti topshirishingiz mumkin.
            </p>
            <a
              href="/vakansiya/register"
              className="group mt-7 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[14.5px] font-semibold text-slate-900 transition hover:-translate-y-0.5"
            >
              Ro‘yxatdan o‘tish
              <svg
                className="h-4 w-4 transition-transform group-hover:translate-x-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200/70 py-6 text-center text-[12px] text-slate-400">
        © 2026 Farg‘ona jamoat salomatligi tibbiyot instituti
      </footer>
    </div>
  );
}

/* ────────────────────────────  yordamchilar  ──────────────────────────── */

function saveSessionAndEnter(token: string, user: unknown): void {
  try {
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('user', JSON.stringify(user));
  } catch {
    /* ignore */
  }
  // To'liq qayta yuklash: App foydalanuvchini brauzer xotirasidan o'qiydi.
  window.location.href = '/';
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[13px] font-medium text-slate-700 mb-1.5">{label}</div>
      {children}
      {hint ? <div className="text-[12px] text-slate-400 mt-1">{hint}</div> : null}
    </div>
  );
}

const INPUT =
  'w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition';

function Alert({ text }: { text: string }) {
  return (
    <div className="flex gap-2.5 rounded-xl bg-red-50 ring-1 ring-red-200 px-4 py-3">
      <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01M12 21a9 9 0 110-18 9 9 0 010 18z" />
      </svg>
      <div className="text-[13.5px] text-red-800 leading-relaxed">{text}</div>
    </div>
  );
}

/* ───────────────────────────────  kirish  ─────────────────────────────── */

/** Kiritilgan matn telefon raqamiga o'xshaydimi? */
function looksLikePhone(v: string): boolean {
  const s = v.replace(/[\s\-()]/g, '');
  return /^\+?\d{9,15}$/.test(s) && (s.startsWith('+') || s.length >= 9);
}

/** Pasport (AC1234567) yoki ID-karta (9-14 raqam) formatimi? */
function looksLikePassport(v: string): boolean {
  const s = v.replace(/[\s\-]/g, '').toUpperCase();
  return /^[A-Z]{2}\d{7}$/.test(s) || /^\d{9,14}$/.test(s);
}

function LoginForm() {
  const [passport, setPassport] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const typedPhone = passport.trim().startsWith('+') && looksLikePhone(passport);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Telefon raqami login EMAS — serverga bormasdan aytamiz.
    if (typedPhone) {
      setMsg(
        'Bu telefon raqami. Login sifatida PASPORT raqamingizni kiriting ' +
          '(masalan AE1234567) — ro‘yxatdan o‘tishda ko‘rsatgan raqamingiz.',
      );
      return;
    }
    if (!looksLikePassport(passport)) {
      setMsg(
        'Pasport raqami noto‘g‘ri formatda. 2 harf va 7 raqam (AE1234567) ' +
          'yoki ID-karta raqami (9–14 raqam) bo‘lishi kerak.',
      );
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: passport.trim().toUpperCase(), password }),
      });
      const d = await readJsonSafe<any>(res);
      if (!res.ok || !d?.token) {
        setMsg(
          'Pasport raqami yoki parol noto‘g‘ri. Login — telefon emas, ' +
            'ro‘yxatdan o‘tgan PASPORT raqamingiz.',
        );
        return;
      }
      saveSessionAndEnter(d.token, d.user);
    } catch {
      setMsg('Ulanmadi. Internetni tekshiring.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <form
        onSubmit={submit}
        autoComplete="off"
        className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-6 space-y-4"
      >
        <div>
          <h1 className="text-[21px] font-bold text-slate-900">Kirish</h1>
          <p className="text-[13.5px] text-slate-500 mt-1">
            Ro‘yxatdan o‘tgan <b>pasport raqamingiz</b> va parolingiz bilan kiring.
            Telefon raqami login emas.
          </p>
        </div>
        {/* Brauzer avtoto'ldirishi pasport maydoniga telefon raqamini yozib
            qo'yardi. Ko'rinmas soxta maydonlar uni o'ziga tortadi. */}
        <input type="text" name="fakeuser" autoComplete="username" tabIndex={-1}
          aria-hidden className="hidden" />
        <input type="password" name="fakepass" autoComplete="current-password"
          tabIndex={-1} aria-hidden className="hidden" />
        <Field
          label="Pasport raqami"
          hint={typedPhone ? 'Bu telefon raqami — pasport raqamini kiriting' : undefined}
        >
          <input
            name="vacancy_passport"
            autoComplete="off"
            inputMode="text"
            className={
              INPUT +
              ' uppercase tracking-wide' +
              (typedPhone ? ' ring-2 ring-rose-300 border-rose-300' : '')
            }
            placeholder="AC1234567"
            value={passport}
            onChange={(e) => setPassport(e.target.value)}
            required
          />
        </Field>
        <Field label="Parol">
          <input
            type="password"
            name="vacancy_password"
            autoComplete="current-password"
            className={INPUT}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {msg ? <Alert text={msg} /> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full px-5 py-3 rounded-xl bg-indigo-600 text-white text-[14.5px] font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {busy ? 'Tekshirilmoqda…' : 'Kirish'}
        </button>
        <div className="text-center text-[13px] text-slate-500">
          Hisobingiz yo‘qmi?{' '}
          <a href="/vakansiya/register" className="text-indigo-700 font-semibold hover:underline">
            Ro‘yxatdan o‘tish
          </a>
        </div>
      </form>
    </div>
  );
}

/* ────────────────────────────  ro'yxatdan o'tish  ──────────────────────── */

function StepHead({
  n,
  title,
  done,
  hint,
}: {
  n: number;
  title: string;
  done: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={
          'w-7 h-7 rounded-full flex items-center justify-center text-[12.5px] font-bold shrink-0 ' +
          (done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600')
        }
      >
        {done ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          n
        )}
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-slate-900 text-[15px] leading-tight">{title}</div>
        {hint ? <div className="text-[12.5px] text-slate-500 mt-0.5">{hint}</div> : null}
      </div>
    </div>
  );
}

function RegisterForm({ positions }: { positions: Position[] }) {
  const [name, setName] = useState('');
  const [passport, setPassport] = useState('');
  const [phone, setPhone] = useState('+998');
  const [password, setPassword] = useState('');
  const [kafedraId, setKafedraId] = useState('');
  // Kafedra tanlanganda o'sha kafedraning fanlari iMentor sillabusidan keladi.
  const [subjects, setSubjects] = useState<Subject[]>([]);
  /* Bazadagi kafedra nomi nomzod izlayotgan nom bilan mos kelmasligi
     mumkin ("Pediatriya kafedrasi" — "Pediatriya 1"). Ikkalasini ham
     ko'rsatamiz, shunda ro'yxatdan topish oson bo'ladi. */
  const kafLabel = (p: Position) =>
    p.dept_name && p.dept_name !== p.kafedra_name
      ? p.kafedra_name + ' (' + p.dept_name + ')'
      : p.kafedra_name;
  const clinicalList = positions.filter((p) => p.is_clinical);
  const nonClinicalList = positions.filter((p) => !p.is_clinical);
  const [subjectCode, setSubjectCode] = useState('');
  const [subjLoading, setSubjLoading] = useState(false);
  const [passportB64, setPassportB64] = useState('');
  const [passportName, setPassportName] = useState('');
  const [shotB64, setShotB64] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    setSubjects([]);
    setSubjectCode('');
    if (!kafedraId) return;
    let alive = true;
    setSubjLoading(true);
    fetch(apiUrl('/api/vacancy/subjects?kafedra_id=' + encodeURIComponent(kafedraId)))
      .then((r) => readJsonSafe<{ subjects?: Subject[] }>(r))
      .then((j) => {
        if (alive) setSubjects(Array.isArray(j?.subjects) ? j!.subjects : []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setSubjLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [kafedraId]);

  const infoDone = Boolean(
    name.trim().split(/\s+/).length >= 2 && passport.trim() && phone.trim().length > 5 &&
      password.length >= 6 && kafedraId && subjectCode,
  );

  const stopCam = useCallback(() => {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }, []);

  useEffect(() => stopCam, [stopCam]);

  const startCam = async () => {
    setMsg('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      streamRef.current = s;
      setCamOn(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => undefined);
        }
      }, 50);
    } catch {
      setMsg('Kamera ochilmadi. Brauzerda kameraga ruxsat bering.');
    }
  };

  const takeShot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    setShotB64(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
    stopCam();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passportB64 || !shotB64) {
      setMsg('Pasport rasmini yuklang va kamerada suratga oling.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(apiUrl('/api/vacancy/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          passport: passport.trim().toUpperCase(),
          phone: phone.trim(),
          password,
          kafedra_id: Number(kafedraId),
          subject: subjects.find((x) => x.subject_code === subjectCode)?.subject_name || '',
          subject_code: subjectCode,
          passport_image_base64: passportB64,
          live_capture_base64: shotB64,
        }),
      });
      const d = await readJsonSafe<any>(res);
      if (res.status === 201 && d?.token) {
        saveSessionAndEnter(d.token, d.user);
        return;
      }
      setMsg(errorText(String(d?.error || '')));
    } catch {
      setMsg('Ulanmadi. Internetni tekshiring.');
    } finally {
      setBusy(false);
    }
  };

  const ready = infoDone && Boolean(passportB64) && Boolean(shotB64);

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-slate-900">Ro‘yxatdan o‘tish</h1>
        <p className="text-[13.5px] text-slate-500 mt-1">
          Uch qadam — ma’lumotlar, pasport rasmi va kameradagi surat.
        </p>
      </div>

      {/* 1 — ma'lumotlar */}
      <section className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-5 sm:p-6 space-y-4">
        <StepHead n={1} title="Shaxsiy ma’lumotlar" done={infoDone} hint="Pasportdagidek yozing" />
        <Field label="Familiya, ism, otasining ismi">
          <input
            className={INPUT}
            placeholder="ALIYEV VALI SOBIROVICH"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Pasport raqami" hint="Bu sizning loginingiz bo‘ladi">
            <input
              className={INPUT + ' uppercase tracking-wide'}
              placeholder="AC1234567"
              value={passport}
              onChange={(e) => setPassport(e.target.value)}
              required
            />
          </Field>
          <Field label="Telefon raqami" hint="HR shu raqam orqali bog‘lanadi">
            <input
              className={INPUT}
              placeholder="+998901234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label="Ish o‘rni (kafedra)"
            hint={
              positions.length === 0
                ? 'Ro‘yxat yuklanmadi — sahifani yangilang yoki administratorga murojaat qiling'
                : positions.length + ' ta kafedra'
            }
          >
            <select
              className={INPUT}
              value={kafedraId}
              onChange={(e) => setKafedraId(e.target.value)}
              required
            >
              <option value="">— tanlang —</option>
              {clinicalList.length > 0 && (
                <optgroup label="Klinik kafedralar">
                  {clinicalList.map((p) => (
                    <option key={p.kafedra_id} value={p.kafedra_id}>
                      {kafLabel(p)}
                    </option>
                  ))}
                </optgroup>
              )}
              {nonClinicalList.length > 0 && (
                <optgroup label="Noklinik kafedralar">
                  {nonClinicalList.map((p) => (
                    <option key={p.kafedra_id} value={p.kafedra_id}>
                      {kafLabel(p)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          <Field
            label="Fan"
            hint={
              subjLoading
                ? 'Fanlar yuklanmoqda…'
                : !kafedraId
                  ? 'Avval kafedrani tanlang'
                  : subjects.length === 0
                    ? 'Bu kafedra bo‘yicha fan topilmadi — boshqa kafedrani tanlang'
                    : 'Test aynan shu fan sillabusidan tuziladi'
            }
          >
            <select
              className={INPUT}
              value={subjectCode}
              onChange={(e) => setSubjectCode(e.target.value)}
              disabled={!kafedraId || subjLoading || subjects.length === 0}
              required
            >
              <option value="">— tanlang —</option>
              {subjects.map((x) => (
                <option key={x.subject_code} value={x.subject_code}>
                  {x.subject_name}
                  {x.topics_count ? ' (' + x.topics_count + ' mavzu)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Parol" hint="Kamida 6 belgi">
            <input
              type="password"
              className={INPUT}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        </div>
      </section>

      {/* 2 — pasport rasmi */}
      <section className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-5 sm:p-6 space-y-3">
        <StepHead
          n={2}
          title="Pasport rasmi"
          done={Boolean(passportB64)}
          hint="Rasm bor sahifasini suratga oling — yuz aniq ko‘rinsin"
        />
        <label
          htmlFor="vac-passport"
          className="flex items-center gap-3 w-full cursor-pointer rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/60 px-4 py-4 hover:bg-indigo-50 transition-colors"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6H16a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-indigo-700">Pasport rasmini tanlash</span>
            <span className="block text-[13px] text-slate-500 truncate">
              {passportName || 'Bosing yoki faylni shu yerga tashlang · JPG, PNG'}
            </span>
          </span>
        </label>
        <input
          id="vac-passport"
          type="file"
          className="sr-only"
          accept="image/*"
          onChange={async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            setPassportName(f.name);
            try {
              setPassportB64(await fileToBase64(f));
            } catch {
              setMsg('Rasmni o‘qib bo‘lmadi.');
            }
          }}
        />
        {passportB64 ? (
          <img
            src={'data:image/jpeg;base64,' + passportB64}
            alt=""
            className="h-32 rounded-xl ring-1 ring-slate-200"
          />
        ) : null}
      </section>

      {/* 3 — kameradagi surat */}
      <section className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-5 sm:p-6 space-y-3">
        <StepHead
          n={3}
          title="Kameradagi suratingiz"
          done={Boolean(shotB64)}
          hint="Yorug‘lik yuzingizga tushsin, to‘g‘ri qarang"
        />
        {shotB64 ? (
          <div className="flex items-start gap-3">
            <img
              src={'data:image/jpeg;base64,' + shotB64}
              alt=""
              className="h-40 rounded-xl ring-2 ring-emerald-300"
            />
            <button
              type="button"
              className="px-3.5 py-2 text-sm rounded-xl border border-slate-300 hover:bg-slate-50"
              onClick={() => {
                setShotB64('');
                startCam();
              }}
            >
              Qayta olish
            </button>
          </div>
        ) : camOn ? (
          <div>
            <video ref={videoRef} playsInline muted className="w-full max-w-sm rounded-xl bg-black" />
            <button
              type="button"
              className="mt-3 px-5 py-2.5 text-sm rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
              onClick={takeShot}
            >
              Suratga olish
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="px-4 py-2.5 text-sm rounded-xl border border-slate-300 hover:bg-slate-50 font-medium"
            onClick={startCam}
          >
            Kamerani yoqish
          </button>
        )}
      </section>

      {msg ? <Alert text={msg} /> : null}

      <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-5 sm:p-6 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy || !ready}
          className="px-6 py-3 rounded-xl bg-indigo-600 text-white text-[14.5px] font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Tekshirilmoqda…' : 'Ro‘yxatdan o‘tish va testga kirish'}
        </button>
        {!ready ? (
          <div className="text-[13px] text-slate-500">
            Uchala qadamni to‘ldiring — tugma shundan keyin faollashadi.
          </div>
        ) : null}
        <div className="ml-auto text-[13px] text-slate-500">
          Hisobingiz bormi?{' '}
          <a href="/vakansiya/login" className="text-indigo-700 font-semibold hover:underline">
            Kirish
          </a>
        </div>
      </div>
    </form>
  );
}
