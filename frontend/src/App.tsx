import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Login } from './pages/Login';
import { AdminDashboard } from './pages/AdminDashboard';
import { StudentDashboard } from './pages/StudentDashboard';
import { PublicVerifyResult } from './pages/PublicVerifyResult';
import { ExamResultSummary, type ExamResultPayload } from './components/ExamResultSummary';
import { PreExamCheck } from './PreExamCheck';
import { ExamRoom } from './ExamRoom';
import { Button } from './components/ui';
import { translations, Language } from './i18n';
import { InstituteLogo } from './components/InstituteLogo';

function readStoredSession(): { token: string; user: any } {
  const token = localStorage.getItem('token') || '';
  let user: any = null;
  try {
    const raw = localStorage.getItem('user');
    user = raw ? JSON.parse(raw) : null;
  } catch {
    user = null;
  }
  if (user?.role === 'teacher') {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    return { token: '', user: null };
  }
  const valid = Boolean(token && user && typeof user === 'object' && user.id && user.role);
  if (token && !valid) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    return { token: '', user: null };
  }
  return { token: valid ? token : '', user: valid ? user : null };
}

function AppContent() {
  const initial = readStoredSession();
  const [token, setToken] = useState(initial.token);
  const [user, setUser] = useState<any>(initial.user);
  const [activeExam, setActiveExam] = useState<any>(null);
  const [studentExamId, setStudentExamId] = useState<number | null>(null);
  const [examStatus, setExamStatus] = useState<'pending' | 'checking' | 'taking' | 'finished'>('pending');
  const [lastSubmitResult, setLastSubmitResult] = useState<ExamResultPayload | null>(null);
  const [lang, setLang] = useState<Language>((localStorage.getItem('lang') as Language) || 'uz');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    localStorage.setItem('lang', lang);
  }, [lang]);

  useEffect(() => {
    if (user?.role === 'teacher') {
      setToken('');
      setUser(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      navigate('/login');
    }
  }, [user?.role, navigate]);

  const handleLogin = (newToken: string, userData: any) => {
    setToken(newToken);
    setUser(userData);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(userData));
    navigate('/');
  };

  const handleLogout = () => {
    setToken('');
    setUser(null);
    setActiveExam(null);
    setExamStatus('pending');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const startExamCheck = (exam: any, seId: number) => {
    setActiveExam(exam);
    setStudentExamId(seId);
    setExamStatus('checking');
  };

  const beginExam = (examData: any, seId: number) => {
    setActiveExam(examData);
    setStudentExamId(seId);
    setExamStatus('taking');
  };

  const finishExam = (submitPayload?: ExamResultPayload | null) => {
    setExamStatus('finished');
    setActiveExam(null);
    setStudentExamId(null);
    setLastSubmitResult(submitPayload ?? null);
  };

  if (!token || !user) {
    return (
      <AnimatePresence mode="wait">
        <motion.div 
          key={location.pathname}
          initial={{ opacity: 0, scale: 0.95 }} 
          animate={{ opacity: 1, scale: 1 }} 
          exit={{ opacity: 0, scale: 1.05 }} 
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} 
          className="min-h-screen w-full"
        >
          <Routes location={location}>
            <Route path="/login" element={<Login onLogin={handleLogin} lang={lang} setLang={setLang} />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    );
  }

  const t = translations[lang];

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/40 backdrop-blur-3xl border-b border-white/40 shadow-[0_4px_30px_rgb(0,0,0,0.03)] px-6 py-4 flex justify-between items-center transition-all duration-500">
        <div className="flex items-center gap-3">
          <InstituteLogo size="sm" className="shrink-0" />
          <h1 className="text-xl font-semibold tracking-tight text-gray-900 hidden sm:block">Fjsti Online Exam</h1>
        </div>
        <div className="flex items-center gap-4">
          <select 
            value={lang} 
            onChange={(e) => setLang(e.target.value as Language)}
            className="bg-white/50 backdrop-blur-md border border-white/50 rounded-full px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-black/10 transition-all cursor-pointer"
          >
            <option value="uz">O'zbekcha</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
          <div className="hidden sm:flex items-center gap-2 bg-white/50 backdrop-blur-md border border-white/50 rounded-full px-4 py-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-gray-200 to-gray-300 flex items-center justify-center text-xs font-bold text-gray-600">
              {(user.name || user.id || '?').toString().charAt(0)}
            </div>
            <span className="text-sm font-medium text-gray-800">
              {user.name || user.id}{' '}
              <span className="text-gray-500 font-normal capitalize">({user.role})</span>
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout} className="rounded-full">{t.logout}</Button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto pt-28 pb-4 px-4 sm:px-6 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={user.role + examStatus}
            initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            {user.role === 'admin' && <AdminDashboard token={token} lang={lang} />}
            {user.role === 'student' && examStatus === 'pending' && (
              <StudentDashboard token={token} onStartExam={startExamCheck} lang={lang} />
            )}
            {user.role === 'student' && examStatus === 'checking' && activeExam && (
              <PreExamCheck 
                exam={activeExam} 
                token={token} 
                lang={lang}
                user={user}
                onComplete={beginExam} 
                onCancel={() => setExamStatus('pending')} 
              />
            )}
            {user.role === 'student' && examStatus === 'taking' && activeExam && (
              <ExamRoom 
                exam={activeExam} 
                studentExamId={studentExamId!} 
                token={token} 
                user={user}
                lang={lang}
                onFinish={finishExam} 
              />
            )}
            {user.role === 'student' && examStatus === 'finished' && lastSubmitResult && (
              <ExamResultSummary
                data={lastSubmitResult}
                token={token}
                onBack={() => {
                  setLastSubmitResult(null);
                  setExamStatus('pending');
                }}
              />
            )}
            {user.role === 'student' && examStatus === 'finished' && !lastSubmitResult && (
              <div className="text-center py-32 glass-panel max-w-2xl mx-auto mt-12">
                <div className="w-24 h-24 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <h2 className="text-3xl font-bold mb-4 tracking-tight">Imtihon yakunlandi</h2>
                <p className="text-gray-500 mb-8 text-lg">Javoblaringiz qabul qilindi.</p>
                <Button onClick={() => setExamStatus('pending')} size="lg">Dashboard</Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="w-full mt-auto py-2 px-4 border-t border-gray-200/40 bg-white/20">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 max-w-3xl mx-auto">
          <InstituteLogo size="xs" className="opacity-90" />
          <p className="text-[10px] leading-tight text-gray-400 font-normal tracking-wide text-center">
            © {new Date().getFullYear()} Fjsti Online Exam · Farg‘ona jamoat salomatligi tibbiyot instituti
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/verify/result/:resultId" element={<PublicVerifyResult />} />
        <Route path="*" element={<AppContent />} />
      </Routes>
    </Router>
  );
}
