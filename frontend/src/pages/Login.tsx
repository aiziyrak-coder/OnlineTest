import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { translations, Language } from '../i18n';
import { InstituteLogo } from '../components/InstituteLogo';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';

interface LoginProps {
  onLogin: (token: string, user: any) => void;
  lang: Language;
  setLang: (l: Language) => void;
}

const LS_REMEMBER = 'fjsti_login_remember';
const LS_ID = 'fjsti_login_saved_id';
/** @deprecated Parol hech qachon localStorage da saqlanmaydi (XSS / umumiy kompyuter xavfi). */
const LS_PW_LEGACY = 'fjsti_login_saved_password';

export function Login({ onLogin, lang, setLang }: LoginProps) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const t = translations[lang];

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
  }, []);

  /** Faqat foydalanuvchi ID; parol brauzerda saqlanmaydi. */
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password }),
      });
      const data = await readJsonSafe<{ token?: string; user?: any; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || 'Login failed');
      if (!data?.token || !data?.user) throw new Error('Server did not return JSON (wrong URL or proxy?)');
      persistRemember(id, rememberMe);
      onLogin(data.token, data.user);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-400/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-400/20 blur-[120px] pointer-events-none" />

      <div className="absolute top-6 right-6 flex gap-2 z-10 bg-white/30 backdrop-blur-xl p-1.5 rounded-full border border-white/40 shadow-sm">
        <Button size="sm" variant={lang === 'uz' ? 'default' : 'ghost'} onClick={() => setLang('uz')} className={lang === 'uz' ? '' : 'hover:bg-white/40'}>
          UZ
        </Button>
        <Button size="sm" variant={lang === 'ru' ? 'default' : 'ghost'} onClick={() => setLang('ru')} className={lang === 'ru' ? '' : 'hover:bg-white/40'}>
          RU
        </Button>
        <Button size="sm" variant={lang === 'en' ? 'default' : 'ghost'} onClick={() => setLang('en')} className={lang === 'en' ? '' : 'hover:bg-white/40'}>
          EN
        </Button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md px-4 relative z-10"
      >
        <div className="flex flex-col items-center mb-8">
          <InstituteLogo size="lg" className="mb-4 shadow-xl" />
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Fjsti Online Exam</h1>
          <p className="text-gray-500 mt-2 font-medium">Sign in to continue</p>
        </div>

        <Card className="w-full">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl text-center font-semibold">{t.login}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 ml-1">{t.userId}</label>
                <Input value={id} onChange={(e) => setId(e.target.value)} required placeholder="ID" autoComplete="username" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 ml-1">{t.password}</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-gray-300 w-4 h-4"
                />
                {t.rememberLogin}
              </label>
              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="text-red-500 text-sm font-medium text-center bg-red-50/50 py-2 rounded-xl border border-red-100"
                >
                  {error}
                </motion.p>
              )}
              <Button type="submit" className="w-full mt-2 shadow-lg shadow-black/5">
                {t.loginBtn}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <footer className="absolute bottom-6 left-0 right-0 text-center pointer-events-none flex flex-col items-center gap-2">
        <InstituteLogo size="xs" className="opacity-80" />
        <p className="text-[10px] text-gray-500 font-normal max-w-md px-4 leading-snug">
          © {new Date().getFullYear()} Fjsti Online Exam · Farg‘ona jamoat salomatligi tibbiyot instituti
        </p>
      </footer>
    </div>
  );
}
