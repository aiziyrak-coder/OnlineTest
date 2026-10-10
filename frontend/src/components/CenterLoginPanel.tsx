import React, { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/apiUrl';
import { readJsonSafe } from '../lib/http';
import type { Language } from '../i18n';

/**
 * Test markazida kirish: PASPORT RAQAMI + PIN kod.
 *
 * Ilgari topshiruvchi 12 xonali talaba ID sini va alohida parolni yozardi —
 * markazda eng ko'p vaqt ketadigan va eng ko'p xato chiqadigan qadam shu edi.
 * Endi ikkita qisqa maydon: pasport (o'zida turadi) va nazoratchi aytadigan PIN.
 */

const TX = {
  uz: {
    title: 'Imtihonga kirish',
    lead: 'Pasport raqamingizni yozing va nazoratchi aytgan PIN kodni kiriting.',
    passport: 'Pasport raqami',
    passportHint: 'Namuna: AB1234567',
    pin: 'PIN kod',
    pinHint: 'Nazoratchi aytadi',
    enter: 'Kirish',
    busy: 'Tekshirilmoqda…',
    needPassport: 'Pasport raqamini yozing (2 harf va 7 raqam).',
    needPin: 'PIN kodni kiriting.',
    failed: 'Kirib bo‘lmadi. Nazoratchiga murojaat qiling.',
    other: 'Login va parol bilan kirish',
  },
  ru: {
    title: 'Вход на экзамен',
    lead: 'Введите номер паспорта и PIN-код, который назовёт наблюдатель.',
    passport: 'Номер паспорта',
    passportHint: 'Пример: AB1234567',
    pin: 'PIN-код',
    pinHint: 'Назовёт наблюдатель',
    enter: 'Войти',
    busy: 'Проверяем…',
    needPassport: 'Введите номер паспорта (2 буквы и 7 цифр).',
    needPin: 'Введите PIN-код.',
    failed: 'Не удалось войти. Обратитесь к наблюдателю.',
    other: 'Войти по логину и паролю',
  },
  en: {
    title: 'Exam sign-in',
    lead: 'Type your passport number and the PIN the proctor gives you.',
    passport: 'Passport number',
    passportHint: 'Example: AB1234567',
    pin: 'PIN code',
    pinHint: 'The proctor will tell you',
    enter: 'Sign in',
    busy: 'Checking…',
    needPassport: 'Type the passport number (2 letters and 7 digits).',
    needPin: 'Enter the PIN code.',
    failed: 'Could not sign in. Ask the proctor.',
    other: 'Sign in with login and password',
  },
} as const;

const PASSPORT_RE = /^[A-Z]{2}\d{7}$/;

export function CenterLoginPanel({
  lang,
  onLogin,
  onUsePassword,
}: {
  lang: Language;
  onLogin: (token: string, user: any) => void;
  onUsePassword?: () => void;
}) {
  const t = TX[lang] || TX.uz;
  const [passport, setPassport] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passportRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tm = window.setTimeout(() => passportRef.current?.focus(), 150);
    return () => window.clearTimeout(tm);
  }, []);

  const cleanPassport = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 9);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!PASSPORT_RE.test(passport)) {
      setError(t.needPassport);
      passportRef.current?.focus();
      return;
    }
    if (!pin.trim()) {
      setError(t.needPin);
      pinRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(apiUrl('/api/auth/center-login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passport, pin }),
      });
      const data = await readJsonSafe<{ token?: string; user?: any; error?: string }>(res);
      if (!res.ok || !data?.token || !data?.user) throw new Error(data?.error || t.failed);
      onLogin(data.token, data.user);
    } catch (err: any) {
      setError(err?.message || t.failed);
      setPin('');
      pinRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const field =
    'w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-4 text-2xl font-semibold ' +
    'tracking-wider text-slate-900 outline-none transition focus:border-sky-500 ' +
    'focus:ring-4 focus:ring-sky-100 disabled:bg-slate-100';

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h2 className="text-xl font-bold text-slate-900">{t.title}</h2>
        <p className="mt-1 text-sm text-slate-600">{t.lead}</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-slate-700">{t.passport}</span>
        <input
          ref={passportRef}
          className={field}
          value={passport}
          onChange={(e) => setPassport(cleanPassport(e.target.value))}
          placeholder="AB1234567"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          disabled={busy}
          aria-label={t.passport}
        />
        <span className="mt-1 block text-xs text-slate-500">{t.passportHint}</span>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-slate-700">{t.pin}</span>
        <input
          ref={pinRef}
          className={field}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          placeholder="••••"
          autoComplete="off"
          inputMode="numeric"
          disabled={busy}
          aria-label={t.pin}
        />
        <span className="mt-1 block text-xs text-slate-500">{t.pinHint}</span>
      </label>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-sky-600 px-4 py-4 text-lg font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {busy ? t.busy : t.enter}
      </button>

      {onUsePassword ? (
        <button
          type="button"
          onClick={onUsePassword}
          className="w-full text-sm font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
        >
          {t.other}
        </button>
      ) : null}
    </form>
  );
}
