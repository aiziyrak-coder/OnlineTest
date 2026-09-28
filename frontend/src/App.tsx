import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Login } from './pages/Login';
import { AdminDashboard } from './pages/AdminDashboard';
import { StaffDashboard } from './pages/StaffDashboard';
import { StudentDashboard } from './pages/StudentDashboard';
import { PublicVerifyResult } from './pages/PublicVerifyResult';
import { ProfilePhotoPage } from './pages/ProfilePhotoPage';
import { VacancyPage } from './pages/VacancyPage';
import { ExamResultSummary, type ExamResultPayload } from './components/ExamResultSummary';
import { PreExamCheck } from './pages/PreExamCheck';
import { ExamRoom } from './pages/ExamRoom';
import { Button } from './components/ui';
import { translations, Language } from './i18n';
import { InstituteLogo } from './components/InstituteLogo';
import { clearDeviceSessionToken, examAuthHeaders, setDeviceSessionToken } from './lib/deviceFingerprint';
import { apiUrl } from './lib/apiUrl';
import { authHeaders } from './lib/uiLangHeader';
import { pollExamResultAiUpgrade } from './lib/upgradeExamResultAi';
import { readJsonSafe } from './lib/http';
import { DesktopRequired } from './pages/DesktopRequired';
import { ExitGuard } from './components/ExitGuard';
import { fetchDesktopInfo, getDesktop, isDesktopApp, versionLess, type DesktopInfo } from './lib/desktop';

const SUPPORTED_LANGS: Language[] = ['uz', 'ru', 'en'];
const EXAM_FLOW_KEY = 'fjsti_exam_flow';

type ExamFlowPersist = {
  examStatus: 'checking' | 'taking';
  activeExam: any;
  studentExamId: number;
};

/** Imtihon topshiradigan rollar — `isExaminee` bilan bir xil ro'yxat.
 *  Imtihon oqimini saqlash/tiklash SHULARNING hammasi uchun ishlashi
 *  kerak: ilgari faqat 'student' tekshirilardi va nomzod sahifani
 *  yangilaganda oq ekran qolardi. */
const EXAMINEE_ROLES = [
  'student', 'faculty', 'ordinator', 'magistr', 'vacancy', 'entrant',
];

function isExamineeRole(role: unknown): boolean {
  return EXAMINEE_ROLES.includes(String(role || '').trim().toLowerCase());
}

function readExamFlow(): ExamFlowPersist | null {
  try {
    const raw = sessionStorage.getItem(EXAM_FLOW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExamFlowPersist;
    if (
      (parsed.examStatus === 'checking' || parsed.examStatus === 'taking') &&
      parsed.activeExam &&
      parsed.studentExamId != null
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeExamFlow(data: ExamFlowPersist): void {
  try {
    sessionStorage.setItem(EXAM_FLOW_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function clearExamFlow(): void {
  try {
    sessionStorage.removeItem(EXAM_FLOW_KEY);
  } catch {
    /* ignore */
  }
}

/** Admin fetch-larida 401/403 kelsa bu eventni dispatch qiling → App avtomatik logout qiladi */
export const AUTH_ERROR_EVENT = 'auth:error';

const SESSION_KEYS = new Set(['token', 'user']);

function storageFor(key: string): Storage {
  return SESSION_KEYS.has(key) ? sessionStorage : localStorage;
}

function safeStorageGet(key: string): string | null {
  try {
    return storageFor(key).getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    storageFor(key).setItem(key, value);
  } catch {
    /* ignore storage quota/private mode */
  }
}

function safeStorageRemove(key: string): void {
  try {
    storageFor(key).removeItem(key);
  } catch {
    /* ignore storage quota/private mode */
  }
}

function readStoredSession(): { token: string; user: any } {
  const token = (safeStorageGet('token') || '').trim();
  let user: any = null;
  try {
    const raw = safeStorageGet('user');
    user = raw ? JSON.parse(raw) : null;
  } catch {
    user = null;
  }
  if (user?.role === 'teacher') {
    safeStorageRemove('token');
    safeStorageRemove('user');
    return { token: '', user: null };
  }
  const valid = Boolean(token && user && typeof user === 'object' && user.id && user.role);
  if (token && !valid) {
    safeStorageRemove('token');
    safeStorageRemove('user');
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
  /** Qayta topshirish (retake) tufayli qaytadan kirilganmi — true bo'lsa PreExamCheck pozitsiya gate'ni bekor qiladi. */
  const [isRetakeCheck, setIsRetakeCheck] = useState(false);
  const [lastSubmitResult, setLastSubmitResult] = useState<ExamResultPayload | null>(null);
  const [lang, setLang] = useState<Language>(() => {
    const raw = (safeStorageGet('lang') || 'uz').trim() as Language;
    return SUPPORTED_LANGS.includes(raw) ? raw : 'uz';
  });
  const navigate = useNavigate();
  const location = useLocation();
  // FerMI Exam Platform ilovasi talabi (server sozlamasi DESKTOP_APP_REQUIRED): brauzerdan
  // kirgan test topshiruvchiga imtihon o'rniga "ilovani yuklab oling" sahifasi chiqadi.
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  // Brauzerda sozlama kelguncha kirish sahifasi ko'rsatilmaydi (miltillamasin).
  const [desktopInfoLoaded, setDesktopInfoLoaded] = useState(() => isDesktopApp());
  useEffect(() => {
    let alive = true;
    void fetchDesktopInfo(apiUrl).then((info) => {
      if (!alive) return;
      setDesktopInfo(info);
      setDesktopInfoLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [user?.id]);
  const { examId: routeExamIdRaw } = useParams<{ examId?: string }>();
  const routeExamId = routeExamIdRaw ? Number(routeExamIdRaw) : null;
  const routePhase = location.pathname.endsWith('/room')
    ? 'room'
    : location.pathname.endsWith('/check')
      ? 'check'
      : null;

  useEffect(() => {
    safeStorageSet('lang', lang);
  }, [lang]);

  useEffect(() => {
    if (user?.role === 'teacher') {
      setToken('');
      setUser(null);
      safeStorageRemove('token');
      safeStorageRemove('user');
      navigate('/login');
    }
  }, [user?.role, navigate]);

  const handleLogin = (newToken: string, userData: any) => {
    setToken(newToken);
    setUser(userData);
    safeStorageSet('token', newToken);
    safeStorageSet('user', JSON.stringify(userData));
    if (userData.role === 'admin') navigate('/admin');
    else if (userData.role === 'staff') navigate('/staff');
    else navigate('/');
  };

  const handleLogout = useCallback(() => {
    setToken('');
    setUser(null);
    setActiveExam(null);
    setExamStatus('pending');
    clearExamFlow();
    clearDeviceSessionToken();
    safeStorageRemove('token');
    safeStorageRemove('user');
    navigate('/login');
  }, [navigate]);

  // Global: har qanday admin fetch 401/403 qaytarsa → avtomatik logout
  useEffect(() => {
    const onAuthError = () => handleLogout();
    window.addEventListener(AUTH_ERROR_EVENT, onAuthError);
    return () => window.removeEventListener(AUTH_ERROR_EVENT, onAuthError);
  }, [handleLogout]);

  // Tokenni mount da bir marta backend bilan tekshirish (barcha rollar)
  const tokenCheckedRef = useRef(false);
  useEffect(() => {
    if (tokenCheckedRef.current || !token || !user?.role) return;
    const roleEndpoints: Record<string, string> = {
      admin: '/api/admin/groups',
      staff: '/api/staff/exams',
      student: '/api/student/exams',
    };
    const endpoint = roleEndpoints[user.role];
    if (!endpoint) return;
    tokenCheckedRef.current = true;
    fetch(apiUrl(endpoint), { headers: authHeaders(token, lang) })
      .then(r => { if (r.status === 401) handleLogout(); })
      .catch(() => {});
  }, [token, user?.role, handleLogout]);

  // Admin `/` → `/admin`; talaba exam flow sessionStorage dan tiklash
  const examFlowRestoredRef = useRef(false);
  useEffect(() => {
    if (user?.role === 'admin' && location.pathname === '/') {
      navigate('/admin', { replace: true });
    }
  }, [user?.role, location.pathname, navigate]);

  useEffect(() => {
    if (examFlowRestoredRef.current || !isExamineeRole(user?.role) || !token) return;
    examFlowRestoredRef.current = true;
    const saved = readExamFlow();
    if (!saved) return;
    if (saved.examStatus === 'checking') {
      setActiveExam(saved.activeExam);
      setStudentExamId(saved.studentExamId);
      setExamStatus('checking');
      if (saved.activeExam?.id) navigate(`/exam/${saved.activeExam.id}/check`, { replace: true });
      return;
    }
    if (saved.examStatus === 'taking') {
      fetch(apiUrl('/api/student/exams'), { headers: { ...authHeaders(token, lang), 'X-Student-Lang': lang } })
        .then(async (r) => {
          const list = await readJsonSafe<any[]>(r);
          const match = Array.isArray(list)
            ? list.find((e) => e.id === saved.activeExam?.id && e.in_progress)
            : null;
          if (match) {
            setActiveExam({ ...saved.activeExam, ...match });
            setStudentExamId(saved.studentExamId);
            setExamStatus('taking');
            navigate(`/exam/${saved.activeExam.id}/room`, { replace: true });
          } else {
            clearExamFlow();
            navigate('/', { replace: true });
          }
        })
        .catch(() => {
          clearExamFlow();
          navigate('/', { replace: true });
        });
    }
  }, [user?.role, token, navigate]);

  useEffect(() => {
    if (!isExamineeRole(user?.role)) return;
    if (
      (examStatus === 'checking' || examStatus === 'taking') &&
      activeExam &&
      studentExamId != null
    ) {
      writeExamFlow({ examStatus, activeExam, studentExamId });
    } else if (examStatus === 'pending' || examStatus === 'finished') {
      clearExamFlow();
    }
  }, [examStatus, activeExam, studentExamId, user?.role]);

  useEffect(() => {
    if (!isExamineeRole(user?.role) || !token || !routeExamId || Number.isNaN(routeExamId)) return;
    if (activeExam?.id === routeExamId) return;
    fetch(apiUrl('/api/student/exams'), { headers: { ...authHeaders(token, lang), 'X-Student-Lang': lang } })
      .then(async (r) => {
        const list = await readJsonSafe<any[]>(r);
        const match = Array.isArray(list) ? list.find((e) => e.id === routeExamId) : null;
        if (!match) {
          navigate('/', { replace: true });
          return;
        }
        // Saqlangan SESSIYA ma'lumotlarini (startedAt, sessionKey, sessionChallenge)
        // yo'qotmaymiz — `/api/student/exams` ro'yxati ularni qaytarmaydi.
        // Ilgari bu yerda `setActiveExam(match)` qilinardi va imtihon o'rtasida
        // refresh qilinganda o'sha maydonlar o'chib ketardi; `sessionStarted`
        // (= startedAt && sessionKey) false bo'lib, "Imtihonni boshlash" oynasi
        // qayta chiqardi. Yuqoridagi tiklash effekti bilan poyga bo'lgani uchun
        // muammo goh chiqib, goh chiqmasdi.
        const saved = readExamFlow();
        const resumable =
          saved?.examStatus === 'taking' &&
          saved.activeExam?.id === routeExamId &&
          Boolean(match.in_progress)
            ? saved.activeExam
            : null;
        // `/exam/:id/room` ga faqat HAQIQATAN ochiq sessiya bilan kiriladi.
        // Aks holda (ban/tugatilgan/retake'dan keyin URL orqali yoki brauzer
        // "Orqaga" tugmasi bilan qaytilganda) ExamRoom sessiyasiz ochilib,
        // eski "Imtihonni boshlash" lobbisi chiqib ketardi — talaba banlangan
        // bo'lsa ham nazorat noldan (1/3) qayta ishga tushardi.
        if (routePhase === 'room' && !resumable) {
          clearExamFlow();
          setExamStatus('pending');
          setActiveExam(null);
          setStudentExamId(null);
          navigate('/', { replace: true });
          return;
        }
        setActiveExam(resumable ? { ...resumable, ...match } : match);
        setStudentExamId(match.student_exam_id ?? saved?.studentExamId ?? 0);
        if (routePhase === 'check') setExamStatus('checking');
        else if (routePhase === 'room') setExamStatus('taking');
      })
      .catch(() => navigate('/', { replace: true }));
  }, [user?.role, token, routeExamId, routePhase, activeExam?.id, navigate]);

  const startExamCheck = (exam: any, seId: number) => {
    setActiveExam(exam);
    setStudentExamId(seId);
    setIsRetakeCheck(false);
    setExamStatus('checking');
    navigate(`/exam/${exam.id}/check`);
  };

  const beginExam = (examData: any, seId: number) => {
    setActiveExam(examData);
    setStudentExamId(seId);
    setExamStatus('taking');
    navigate(`/exam/${examData.id}/room`);
  };

  const retakeRestartExam = () => {
    if (!activeExam) return;
    clearExamFlow();
    setIsRetakeCheck(true);
    setExamStatus('checking');
    navigate(`/exam/${activeExam.id}/check`);
  };

  const resumeExam = async (exam: any, pin = '') => {
    if (!token) return;
    if (exam.identity_refresh_required || exam.session_phase === 'after_retake') {
      startExamCheck(exam, exam.student_exam_id ?? 0);
      if (exam.session_phase === 'after_retake') setIsRetakeCheck(true);
      return;
    }
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/start`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Student-Lang': lang,
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({ pin, student_lang: lang, client_features: ['question_lock'] }),
      });
      const data = await readJsonSafe<{
        error?: string;
        exam?: any;
        studentExamId?: number;
        startedAt?: string;
        sessionKey?: string;
        sessionSeqStart?: number;
        sessionChallenge?: string;
        deviceToken?: string;
      }>(res);
      if (!res.ok || !data?.exam || data.studentExamId == null) {
        window.alert(data?.error || translations[lang].preExamStartError);
        return;
      }
      if (data.deviceToken) {
        setDeviceSessionToken(data.deviceToken, token);
      }
      beginExam(
        {
          ...data.exam,
          startedAt: data.startedAt,
          sessionKey: data.sessionKey,
          sessionSeqStart: data.sessionSeqStart,
          sessionChallenge: data.sessionChallenge,
          preExamPin: pin,
        },
        data.studentExamId,
      );
    } catch {
      window.alert(translations[lang].preExamNetworkError);
    }
  };

  const finishExam = (submitPayload?: ExamResultPayload | null) => {
    if (submitPayload == null) {
      exitExamFlow();
      return;
    }
    clearExamFlow();
    setExamStatus('finished');
    setActiveExam(null);
    setStudentExamId(null);
    setLastSubmitResult(submitPayload);
    navigate('/');
  };

  // Submit darhol TEZKOR shablon bilan javob beradi. Haqiqiy AI tushuntirish
  // `/result-details` da hisoblanadi — shu yerda poll qilib UI yangilanadi.
  useEffect(() => {
    if (!lastSubmitResult?.exam_id || !token) return;
    if (!lastSubmitResult.ai_summary_pending) return;
    const ac = new AbortController();
    void pollExamResultAiUpgrade(
      lastSubmitResult.exam_id,
      token,
      lang,
      (data) => setLastSubmitResult((prev) => (prev ? { ...prev, ...data } : data)),
      ac.signal,
    );
    return () => ac.abort();
  }, [lastSubmitResult?.exam_id, lastSubmitResult?.ai_summary_pending, token, lang]);

  const exitExamFlow = () => {
    clearExamFlow();
    setExamStatus('pending');
    setActiveExam(null);
    setStudentExamId(null);
    navigate('/');
  };

  // Saytda (ilovadan tashqarida) test topshiruvchi uchun kirish yo'q — faqat ilovani
  // yuklab olish sahifasi. Administrator /admin/login orqali kiradi.
  const webDownloadOnly = !isDesktopApp() && Boolean(desktopInfo?.required);

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
          {!desktopInfoLoaded ? (
            <div className="min-h-screen flex items-center justify-center bg-[#f4f6fb]">
              <span className="h-8 w-8 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
            </div>
          ) : webDownloadOnly && desktopInfo ? (
            <Routes location={location}>
              <Route path="/admin/login" element={<Login onLogin={handleLogin} lang={lang} setLang={setLang} />} />
              <Route
                path="*"
                element={<DesktopRequired info={desktopInfo} lang={lang} setLang={setLang} adminLoginHref="/admin/login" />}
              />
            </Routes>
          ) : (
            <Routes location={location}>
              <Route path="/login" element={<Login onLogin={handleLogin} lang={lang} setLang={setLang} />} />
              <Route path="/admin/login" element={<Login onLogin={handleLogin} lang={lang} setLang={setLang} />} />
              <Route path="*" element={<Navigate to="/login" />} />
            </Routes>
          )}
        </motion.div>
      </AnimatePresence>
    );
  }

  const desktopOutdated = Boolean(
    desktopInfo?.min_version && isDesktopApp() && versionLess(getDesktop()?.version || '0', desktopInfo.min_version),
  );
  if (desktopInfo && desktopInfo.required && isExamineeRole(user?.role) && (!isDesktopApp() || desktopOutdated)) {
    return (
      <DesktopRequired
        info={desktopInfo}
        lang={lang}
        setLang={setLang}
        user={user}
        onLogout={handleLogout}
        updateOnly={isDesktopApp()}
      />
    );
  }

  const t = translations[lang];
  // Imtihon topshiruvchi rollar: talabadan tashqari o'qituvchi (faculty) va
  // ordinator ham kabinetga kiradi va imtihon topshiradi. Ilgari bu yerda
  // faqat 'student' tekshirilardi va o'qituvchi kirsa sahifa bo'm-bo'sh
  // ochilardi — hech qanday xato ham ko'rinmasdi.
  const isExaminee = isExamineeRole(user?.role);
  const examTaking = isExaminee && examStatus === 'taking';
  const preExamFullBleed = isExaminee && examStatus === 'checking';
  // Imtihon topshirish paytida sahifa to'liq ekran (kiosk): header yashiriladi,
  // hech qanday chetki bo'shliq/scroll qolmaydi.
  const fullBleed = preExamFullBleed || examTaking;
  const preExamLayout = preExamFullBleed;

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-clip">
      {!examTaking && (
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 h-[62px] sm:h-[66px]">
        <div
          className={`flex items-center justify-between h-full ${
            user.role === 'admin' ? 'px-4 sm:px-6' : 'px-4 sm:px-6 lg:px-8'
          }`}
        >
          {/* ── Left ── */}
          <div className="flex items-center gap-3 min-w-0">
            <InstituteLogo size="sm" className="shrink-0" />
            <div className="min-w-0 hidden xs:block sm:block">
              <h1 className="text-[16px] sm:text-[18px] font-semibold tracking-tight text-gray-900 truncate leading-tight">
                {isDesktopApp() ? 'FerMI Exam Platform' : t.appBrandTitle}
              </h1>
              <p className="text-[11px] font-medium leading-none mt-0.5 text-gray-400 truncate hidden sm:block">
                {user.role === 'admin' ? t.adminDash : user.role === 'staff' ? t.roleZoneStaff : t.roleZoneStudent}
              </p>
            </div>
          </div>

          {/* ── Right ── */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Lang — segmented */}
            <div className="flex items-center h-9 rounded-lg bg-gray-100 p-0.5">
              {(['uz', 'ru', 'en'] as Language[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  className={`h-full px-2.5 sm:px-3 rounded-md text-xs sm:text-[13px] font-semibold transition-colors ${
                    lang === l
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {l === 'uz' ? "O'z" : l === 'ru' ? 'Ру' : 'En'}
                </button>
              ))}
            </div>

            {/* User pill */}
            <div className="hidden sm:flex items-center gap-2.5 h-9 pl-1 pr-3 rounded-lg border border-gray-200 bg-white">
              <div className="w-7 h-7 rounded-md flex items-center justify-center text-[13px] font-semibold text-white shrink-0 bg-indigo-600">
                {(user.name || user.id || '?').toString().charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col leading-tight min-w-0">
                <span className="text-[13px] font-semibold text-gray-800 truncate max-w-[160px] lg:max-w-[220px]">
                  {user.name || user.id}
                </span>
                <span className="text-[10.5px] text-gray-400 capitalize leading-none">
                  {user.role}
                </span>
              </div>
            </div>

            {/* Logout */}
            <button
              type="button"
              onClick={handleLogout}
              className="h-9 px-3 sm:px-3.5 rounded-lg border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-gray-600 text-[13px] font-medium transition-colors inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">{t.logout}</span>
            </button>
          </div>
        </div>
      </header>
      )}

      <main
        className={`flex-1 min-h-0 w-full relative z-10 ${
          fullBleed
            ? preExamLayout
              ? 'max-w-none px-0 pt-[62px] sm:pt-[66px] overflow-hidden'
              : 'max-w-none px-0 pt-0'
            : user.role === 'admin'
              ? 'max-w-none px-0 pt-[62px] sm:pt-[66px]'
              : 'max-w-none px-4 sm:px-6 lg:px-8 pt-[78px] sm:pt-[84px] pb-6 sm:pb-8'
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={user.role + examStatus}
            initial={user.role === 'admin' ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={user.role === 'admin' ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={user.role === 'admin' ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {user.role === 'admin' && location.pathname.startsWith('/admin') && (
              <div className="min-h-[calc(100vh-62px)] sm:min-h-[calc(100vh-66px)] bg-[var(--admin-ground)] [--admin-header-h:62px] sm:[--admin-header-h:66px]">
                <AdminDashboard token={token} lang={lang} adminUserId={user?.id ? String(user.id) : undefined} />
              </div>
            )}
            {user.role === 'staff' && (location.pathname === '/' || location.pathname === '/staff') && (
              <StaffDashboard token={token} lang={lang} />
            )}
            {isExaminee && location.pathname === '/' && examStatus === 'pending' && (
              <div>
                <StudentDashboard token={token} user={user} onStartExam={startExamCheck} onResumeExam={resumeExam} lang={lang} />
              </div>
            )}
            {isExaminee && examStatus === 'checking' && activeExam && (
              <PreExamCheck
                exam={activeExam}
                token={token}
                lang={lang}
                user={user}
                isRetake={isRetakeCheck}
                onComplete={beginExam}
                onCancel={exitExamFlow}
              />
            )}
            {isExaminee && examStatus === 'taking' && activeExam && (
              <ExamRoom 
                exam={activeExam} 
                studentExamId={studentExamId ?? 0} 
                token={token} 
                user={user}
                lang={lang}
                onFinish={finishExam}
                onRetakeRestart={retakeRestartExam}
              />
            )}
            {isExaminee && location.pathname === '/' && examStatus === 'finished' && lastSubmitResult && (
              <ExamResultSummary
                data={lastSubmitResult}
                token={token}
                lang={lang}
                onBack={() => {
                  setLastSubmitResult(null);
                  setExamStatus('pending');
                  navigate('/');
                }}
              />
            )}
            {isExaminee && location.pathname === '/' && examStatus === 'finished' && !lastSubmitResult && (
              <div className="text-center py-32 glass-panel max-w-2xl mx-auto mt-12">
                <div className="w-24 h-24 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <h2 className="text-3xl font-bold mb-4 tracking-tight">{t.examFinishedTitle}</h2>
                <p className="text-gray-500 mb-8 text-lg">{t.examFinishedBody}</p>
                <Button onClick={() => { setExamStatus('pending'); navigate('/'); }} size="lg">{t.studentDash}</Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Kiosk (imtihonga kirish/topshirish) paytida footer yashiriladi — ekranga to'liq sig'sin, scroll bo'lmasin. */}
      {!fullBleed && !isDesktopApp() && (
      <footer className="w-full mt-auto py-2 px-4 border-t border-gray-200/40 bg-white/20">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 max-w-3xl mx-auto">
          <InstituteLogo size="xs" className="opacity-90" />
          <p className="text-[10px] leading-tight text-gray-400 font-normal tracking-wide text-center">
            © {new Date().getFullYear()} {isDesktopApp() ? 'FerMI Exam Platform' : 'Fjsti Online Exam'} · {t.instituteFullName}
          </p>
        </div>
      </footer>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Router>
      {/* FerMI Exam ilovasi: X bilan chiqishda kirish paroli so'raladi. */}
      <ExitGuard />
      <Routes>
        <Route path="/verify/result/:resultId" element={<PublicVerifyResult />} />
        {/* Profil rasmini o'zi yangilash. Ilova qobig'idan TASHQARIDA:
            sahifa token/user ni brauzer xotirasidan o'zi o'qiydi va
            kabinet holatiga bog'liq bo'lmaydi. */}
        <Route path="/profil-rasm" element={<ProfilePhotoPage />} />
        {/* Vakansiya (ishga qabul) — nomzod uchun alohida kirish nuqtasi,
            talaba/o'qituvchi kabinetidan butunlay ajratilgan. */}
        <Route path="/vakansiya" element={<VacancyPage view="landing" />} />
        <Route path="/vakansiya/register" element={<VacancyPage view="register" />} />
        <Route path="/vakansiya/login" element={<VacancyPage view="login" />} />
        <Route path="/exam/:examId/check" element={<AppContent />} />
        <Route path="/exam/:examId/room" element={<AppContent />} />
        <Route path="*" element={<AppContent />} />
      </Routes>
    </Router>
  );
}
