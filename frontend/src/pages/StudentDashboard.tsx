import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language, banReasonLabel } from '../i18n';
import { ExamResultSummary, type ExamResultPayload } from '../components/ExamResultSummary';
import { readJsonSafe, checkStudentAuthResponse } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { authHeaders } from '../lib/uiLangHeader';
import { pollExamResultAiUpgrade } from '../lib/upgradeExamResultAi';
import { examAuthHeaders } from '../lib/deviceFingerprint';
import { formatCountdown, formatExamDateTime, msUntil } from '../lib/datetimeLocal';
import { AdminBtn, AdminAlert, AdminInput, AdminSelect } from './admin/ui';
import { ExamFacts, ExamReadiness, StartExamConfirm } from '../components/ExamReadiness';

/* Ordinator/magistr uchun to'lov matnlari — imtihon to'lovdan keyin ochiladi. */
const PAY: Record<Language, Record<string, string>> = {
  uz: {
    required: "Imtihon to'lovdan keyin ochiladi",
    requiredHint: "To'lovni amalga oshirib, kvitansiyani rasmga oling va shu yerga yuklang. Buxgalteriya tasdiqlagach imtihon ochiladi.",
    used: 'Imkoniyat ishlatilgan',
    usedHint: "Yangi urinish uchun to'lov qilinadi. Kvitansiyani yuklang — tasdiqlangach imtihon qaytadan ochiladi va savollar boshqacha bo'ladi.",
    upload: 'Kvitansiya yuklash',
    pending: 'Kvitansiya tekshirilmoqda',
    pendingHint: 'Admin tasdiqlashini kuting.',
    rejected: 'Kvitansiya rad etildi',
    freeLeft: 'Tizim nosozligi uchun bepul qayta urinish',
    paid: 'Berilgan pullik urinish',
    modalTitle: 'Kvitansiyani yuklash',
    pick: 'Rasm yoki PDF tanlang',
    note: 'Izoh (ixtiyoriy)',
    send: 'Yuborish',
    cancel: 'Bekor qilish',
    sent: 'Kvitansiya yuborildi. Admin tasdiqlashini kuting.',
    tooBig: 'Fayl juda katta (8 MB dan oshmasin)',
    already: 'Sizda tekshirilayotgan kvitansiya bor.',
    debt: 'Fandan qarzdorligingiz mavjud',
    debtHint: "Shu sababli test topshira olmaysiz. Qarzdorlik masalasi bo'yicha administratorga murojaat qiling.",
    debtCall: 'Administrator',
    notAllowed: 'Sizga bu imtihonga ruxsat berilmagan',
    notAllowedHint: "Ruxsat attestatsiya grafigi bo'yicha ma'muriyat tomonidan beriladi. Savollar bo'lsa, ma'muriyatga murojaat qiling.",
    oneUsedHint: "Bu imtihon bir martalik — urinishingiz ishlatilgan. Qayta topshirish berilmaydi; istisno faqat ma'muriyat qarori bilan.",
  },
  ru: {
    required: 'Ekzamen otkryvayetsya posle oplaty',
    requiredHint: 'Oplatite, sfotografiruyte kvitantsiyu i zagruzite eyo zdes. Posle podtverzhdeniya buhgalteriyey ekzamen otkroyetsya.',
    used: 'Popytka ispolzovana',
    usedHint: 'Novaya popytka — platnaya. Zagruzite kvitantsiyu; posle podtverzhdeniya ekzamen otkroyetsya s drugimi voprosami.',
    upload: 'Zagruzit kvitantsiyu',
    pending: 'Kvitantsiya na proverke',
    pendingHint: 'Ozhidayte podtverzhdeniya administratora.',
    rejected: 'Kvitantsiya otklonena',
    freeLeft: 'Besplatnyh popytok pri sboye',
    paid: 'Vydano platnyh popytok',
    modalTitle: 'Zagruzka kvitantsii',
    pick: 'Vyberite foto ili PDF',
    note: 'Kommentariy',
    send: 'Otpravit',
    cancel: 'Otmena',
    sent: 'Kvitantsiya otpravlena. Ozhidayte podtverzhdeniya.',
    tooBig: 'Fayl slishkom bolshoy (do 8 MB)',
    already: 'U vas uzhe yest kvitantsiya na proverke.',
    debt: 'U vas yest zadolzhennost po predmetu',
    debtHint: 'Poetomu vy ne mozhete sdavat test. Obratites k administratoru.',
    debtCall: 'Administrator',
    notAllowed: 'Dostup k etomu ekzamenu ne predostavlen',
    notAllowedHint: 'Dostup vydayetsya administratsiyey po grafiku attestatsii. Po voprosam obrashchaytes v administratsiyu.',
    oneUsedHint: 'Etot ekzamen odnorazovyy — vasha popytka ispolzovana. Peresdacha ne predostavlyayetsya; isklyucheniye — tolko resheniyem administratsii.',
  },
  en: {
    required: 'The exam opens after payment',
    requiredHint: 'Make the payment, photograph the receipt and upload it here. The exam opens once accounting confirms it.',
    used: 'Attempt used',
    usedHint: 'A new attempt is paid. Upload the receipt; once approved the exam reopens with different questions.',
    upload: 'Upload receipt',
    pending: 'Receipt under review',
    pendingHint: 'Please wait for the administrator.',
    rejected: 'Receipt rejected',
    freeLeft: 'Free retries after a technical fault',
    paid: 'Paid attempts granted',
    modalTitle: 'Upload receipt',
    pick: 'Choose a photo or PDF',
    note: 'Note (optional)',
    send: 'Send',
    cancel: 'Cancel',
    sent: 'Receipt sent. Please wait for approval.',
    tooBig: 'File too large (max 8 MB)',
    already: 'You already have a receipt under review.',
    debt: 'You have an outstanding subject debt',
    debtHint: 'You therefore cannot take the test. Please contact the administrator.',
    debtCall: 'Administrator',
    notAllowed: 'You have not been granted access to this exam',
    notAllowedHint: 'Access is granted by the administration according to the attestation schedule. Contact the administration with any questions.',
    oneUsedHint: 'This is a one-time exam — your attempt has been used. No retake is granted; exceptions only by administration decision.',
  },
};

const REFRESH_INTERVAL_MS = 30_000;
const REFRESH_BANNED_WAIT_MS = 8_000;

/* Sahifa ichidagi qo'shimcha matnlar (uz/ru/en) — katta i18n fayliga tegmasdan. */
const LOCAL: Record<Language, Record<string, string>> = {
  uz: {
    greeting: 'Xush kelibsiz',
    subtitleActive: 'ta imtihon topshirishga tayyor',
    subtitleNone: 'Hozircha ochiq imtihon yo‘q',
    statActive: 'Faol imtihonlar',
    statCompleted: 'Yakunlangan',
    statAvg: 'O‘rtacha natija',
    pillLive: 'Faol',
    scoreLabel: 'Natija',
    pendingEval: 'Baholanmoqda',
    questionsWord: 'savol',
    filterByStatus: 'Holat bo‘yicha',
    filterEmpty: 'Bu holatda natija topilmadi',
    attemptHistory: 'Urinish tarixi',
    failedScore: 'Ball yetarli emas',
    restartExam: 'Qayta boshlash',
    absentStatus: 'Kelmagan',
    absentHint: 'Imtihonga umuman kirmadingiz',
    retakeAvailable: 'Oldingi urinish yiqildi. Imtihon vaqti tugamaguncha qayta boshlashingiz mumkin.',
    facultyPickHint: 'Jadvaldagi fanlardan faqat BIRINI tanlang: 20 daqiqa, 20 ta qiyin USMLE savol.',
    facultyKafedra: 'Kafedra',
    questionsPreparing: 'Savollar tayyorlanmoqda…',
    facultyUsmleBadge: 'USMLE 20',
  },
  ru: {
    greeting: 'Добро пожаловать',
    subtitleActive: 'экзамен(ов) готов(ы) к сдаче',
    subtitleNone: 'Пока нет открытых экзаменов',
    statActive: 'Активные экзамены',
    statCompleted: 'Завершено',
    statAvg: 'Средний балл',
    pillLive: 'Идёт',
    scoreLabel: 'Результат',
    pendingEval: 'На проверке',
    questionsWord: 'вопр.',
    filterByStatus: 'По статусу',
    filterEmpty: 'Нет результатов с этим статусом',
    attemptHistory: 'История попыток',
    failedScore: 'Недостаточный балл',
    restartExam: 'Начать заново',
    absentStatus: 'Не явился',
    absentHint: 'Вы не заходили на экзамен',
    retakeAvailable: 'Прошлая попытка провалена. Пока экзамен открыт, можно начать заново.',
    facultyPickHint: 'Выберите только ОДИН предмет из таблицы: 20 минут, 20 сложных вопросов USMLE.',
    facultyKafedra: 'Кафедра',
    questionsPreparing: 'Вопросы готовятся…',
    facultyUsmleBadge: 'USMLE 20',
  },
  en: {
    greeting: 'Welcome',
    subtitleActive: 'exam(s) ready to take',
    subtitleNone: 'No open exams right now',
    statActive: 'Active exams',
    statCompleted: 'Completed',
    statAvg: 'Average score',
    pillLive: 'Live',
    scoreLabel: 'Score',
    pendingEval: 'Under review',
    questionsWord: 'questions',
    filterByStatus: 'Filter by status',
    filterEmpty: 'No results for this status',
    attemptHistory: 'Attempt history',
    failedScore: 'Insufficient score',
    restartExam: 'Restart',
    absentStatus: 'Absent',
    absentHint: 'You did not enter the exam',
    retakeAvailable: 'Previous attempt failed. You can restart while the exam is open.',
    facultyPickHint: 'Pick only ONE subject from the schedule: 20 minutes, 20 hard USMLE questions.',
    facultyKafedra: 'Department',
    questionsPreparing: 'Questions are being prepared…',
    facultyUsmleBadge: 'USMLE 20',
  },
};

/* Ball rangi — 50%+ yashil, 40–49 amber, past qizil. */
function scoreTone(pct: number): { text: string; bar: string } {
  if (pct >= 50) return { text: 'text-emerald-600', bar: 'bg-emerald-500' };
  if (pct >= 40) return { text: 'text-amber-600', bar: 'bg-amber-500' };
  return { text: 'text-red-600', bar: 'bg-red-500' };
}

type ResultStatusFilter = 'all' | 'Completed' | 'Banned' | 'Failed';

function resultSortTime(r: { completed_at?: string | null; id?: number }): number {
  if (r.completed_at) {
    const t = new Date(r.completed_at).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function sortResultsNewestFirst<T extends { completed_at?: string | null; id?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const diff = resultSortTime(b) - resultSortTime(a);
    if (diff !== 0) return diff;
    return (b.id ?? 0) - (a.id ?? 0);
  });
}

/** Qayta topshirish imkoniyatlarini dumaloq nuqtalar bilan ko'rsatadi — sarflangani to'ldirilgan, qolgani bo'sh. */
function RetakeDots({ used, remaining }: { used: number; remaining: number }) {
  const total = Math.max(1, used + remaining);
  const dots = Array.from({ length: total }, (_, i) => i < used);
  return (
    <div className="flex items-center gap-1">
      {dots.map((spent, i) => (
        <span
          key={i}
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            spent ? 'bg-amber-400' : 'bg-white border-2 border-amber-400'
          }`}
        />
      ))}
    </div>
  );
}

/** "Urinish tarixi (N)" tugmasi — bosilganda modal ochadi (kartochkani to'ldirmaydi). */
function AttemptHistoryButton({
  items,
  label,
  onOpen,
}: {
  items: any[];
  label: string;
  onOpen: () => void;
}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 w-full inline-flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left hover:bg-gray-100 hover:border-gray-300 transition-colors"
    >
      <span className="inline-flex items-center gap-2 text-[12px] font-medium text-gray-700">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {label}
        <span className="text-[11px] font-bold text-gray-400 tabular-nums">{items.length}</span>
      </span>
      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

/* Kichik statistika plitkasi. */
function StatTile({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 sm:px-4 py-3 sm:py-3.5 flex items-center gap-2.5 sm:gap-3">
      <div
        className={`hidden sm:flex w-9 h-9 rounded-lg items-center justify-center shrink-0 ${
          accent ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[18px] sm:text-[19px] font-bold text-gray-900 leading-none tabular-nums">{value}</div>
        <div className="text-[11px] sm:text-[11.5px] text-gray-500 mt-1 leading-tight">{label}</div>
      </div>
    </div>
  );
}

export function StudentDashboard({
  token,
  user,
  onStartExam,
  onResumeExam,
  lang,
}: {
  token: string;
  user?: { name?: string | null; group_id?: number | null; group_name?: string | null };
  onStartExam: (exam: any, studentExamId: number) => void;
  onResumeExam: (exam: any, pin?: string) => void | Promise<void>;
  lang: Language;
}) {
  const [exams, setExams] = useState<any[]>([]);
  const [resumePins, setResumePins] = useState<Record<number, string>>({});
  const [resumeBusyId, setResumeBusyId] = useState<number | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'available' | 'results'>('available');
  const [resultStatusFilter, setResultStatusFilter] = useState<ResultStatusFilter>('all');
  const [isBanned, setIsBanned] = useState(false);
  const [detailPayload, setDetailPayload] = useState<ExamResultPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pdfDownloadingId, setPdfDownloadingId] = useState<number | null>(null);
  const [clockSkewMs, setClockSkewMs] = useState(0);
  const [tick, setTick] = useState(0);
  const [banAppeals, setBanAppeals] = useState<any[]>([]);
  const [appealDrafts, setAppealDrafts] = useState<Record<number, string>>({});
  const [appealBusyExam, setAppealBusyExam] = useState<number | null>(null);
  const [appealMsgByExam, setAppealMsgByExam] = useState<Record<number, string>>({});
  /** Urinish tarixi modali — kartochkani to'ldirmasin deb alohida oynada. */
  const [historyModal, setHistoryModal] = useState<{ title: string; items: any[] } | null>(null);
  /** Boshlashdan oldin tasdiqlash oynasi va tayyorlik tekshiruvi natijasi. */
  const [confirmExam, setConfirmExam] = useState<any | null>(null);
  const [readinessIssues, setReadinessIssues] = useState(0);
  const onReadiness = useCallback((r: { issues: number }) => setReadinessIssues(r.issues), []);
  /** Kvitansiya yuklash oynasi (ordinator/magistr). */
  const [payExam, setPayExam] = useState<any | null>(null);
  const [payFile, setPayFile] = useState<File | null>(null);
  const [payNote, setPayNote] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState('');
  const P = PAY[lang];
  const t = translations[lang];
  const L = LOCAL[lang];
  const cancelledRef = useRef(false);

  const nowMs = () => Date.now() + clockSkewMs;

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const looksLikeBannedMessage = (err: string) => {
    const low = err.toLowerCase();
    return low.includes('banned') || low.includes('blocked') || low.includes('заблок') || low.includes('bloklangan');
  };

  const fetchData = useCallback(async (isManual = false) => {
    const tr = translations[lang];
    if (isManual) setRefreshing(true);

    const examsRes = await fetch(apiUrl('/api/student/exams'), {
      headers: { ...authHeaders(token, lang), 'X-Student-Lang': lang },
    });

    const dateHdr = examsRes.headers.get('Date');
    if (dateHdr) {
      const serverMs = new Date(dateHdr).getTime();
      if (!Number.isNaN(serverMs)) setClockSkewMs(serverMs - Date.now());
    }

    if (cancelledRef.current) return;
    if (!checkStudentAuthResponse(examsRes)) { setLoading(false); setRefreshing(false); return; }
    if (examsRes.status === 403) {
      const j = await readJsonSafe<{ error?: string }>(examsRes);
      const err = String(j?.error || '');
      if (looksLikeBannedMessage(err)) { setIsBanned(true); setLoading(false); setRefreshing(false); return; }
      setError(tr.studentDashboardApi403Body);
      setLoading(false); setRefreshing(false); return;
    }
    if (examsRes.ok) {
      const j = await readJsonSafe<any[]>(examsRes);
      if (!cancelledRef.current) setExams(Array.isArray(j) ? j : []);
    }

    if (cancelledRef.current) return;
    const resultsRes = await fetch(apiUrl('/api/student/results'), {
      headers: { ...authHeaders(token, lang), 'X-Student-Lang': lang },
    });
    if (!checkStudentAuthResponse(resultsRes)) { setLoading(false); setRefreshing(false); return; }
    if (resultsRes.ok) {
      const j = await readJsonSafe<any[]>(resultsRes);
      if (!cancelledRef.current) setResults(Array.isArray(j) ? j : []);
    }

    if (cancelledRef.current) return;
    const appealsRes = await fetch(apiUrl('/api/student/ban-appeals'), {
      headers: { ...authHeaders(token, lang), 'X-Student-Lang': lang, ...examAuthHeaders(token) },
    });
    if (!checkStudentAuthResponse(appealsRes)) { setLoading(false); setRefreshing(false); return; }
    if (appealsRes.ok) {
      const appeals = await readJsonSafe<any[]>(appealsRes);
      if (!cancelledRef.current) setBanAppeals(Array.isArray(appeals) ? appeals : []);
    }

    if (!cancelledRef.current) {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, lang]);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setError('');
    void fetchData();
    return () => { cancelledRef.current = true; };
  }, [fetchData]);

  const hasBannedResult = results.some((r: any) => r.status === 'Banned');
  /** Kvitansiyani base64 ga o'girib serverga yuboradi. */
  const sendReceipt = useCallback(async () => {
    if (!payFile || !payExam) return;
    if (payFile.size > 8 * 1024 * 1024) {
      setPayMsg(P.tooBig);
      return;
    }
    setPayBusy(true);
    setPayMsg('');
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('read'));
        fr.onload = () => {
          const raw = String(fr.result || '');
          resolve(raw.includes(',') ? raw.split(',')[1] : raw);
        };
        fr.readAsDataURL(payFile);
      });
      const res = await fetch(apiUrl('/api/student/payment-receipts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({
          file_base64: b64,
          file_name: payFile.name.slice(0, 200),
          file_mime: payFile.type || 'image/jpeg',
          note: payNote.slice(0, 1000),
          exam_id: payExam.id,
        }),
      });
      const j = await readJsonSafe<Record<string, unknown>>(res);
      if (res.status === 409) {
        setPayMsg(P.already);
        return;
      }
      if (!res.ok) {
        setPayMsg(String(j?.error ?? 'Xatolik'));
        return;
      }
      setPayExam(null);
      setPayFile(null);
      setPayNote('');
      setPayMsg('');
      window.alert(P.sent);
      fetchData(true);
    } catch {
      setPayMsg('Xatolik');
    } finally {
      setPayBusy(false);
    }
  }, [payFile, payExam, payNote, token, lang, P, fetchData]);

  const refreshMs = hasBannedResult ? REFRESH_BANNED_WAIT_MS : REFRESH_INTERVAL_MS;

  useEffect(() => {
    const id = window.setInterval(() => void fetchData(), refreshMs);
    return () => clearInterval(id);
  }, [fetchData, refreshMs]);

  const handleManualReload = () => {
    if (refreshing) return;
    void fetchData(true);
  };

  const openResultDetail = async (examId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${examId}/result-details`), {
        headers: { Authorization: `Bearer ${token}`, 'X-Student-Lang': lang },
      });
      if (!res.ok) return;
      const j = await readJsonSafe<ExamResultPayload>(res);
      if (!j?.result_public_id) return;
      const base: ExamResultPayload = {
        exam_id: examId,
        result_public_id: j.result_public_id,
        verify_url: j.verify_url,
        overview: j.overview,
        ai_summary_source: j.ai_summary_source,
        ai_summary_pending: j.ai_summary_pending,
        questions: j.questions,
        score: j.score,
        total: j.total,
        integrity_code: j.integrity_code,
        percentage: j.percentage,
        completed_at: j.completed_at,
        exam_title: j.exam_title,
        student_name: j.student_name,
        student_group: j.student_group,
      };
      setDetailPayload(base);
      if (j.ai_summary_pending) {
        void pollExamResultAiUpgrade(
          examId,
          token,
          lang,
          (data) => setDetailPayload((prev) => (prev ? { ...prev, ...data, exam_id: examId } : { ...data, exam_id: examId })),
        );
      }
    } finally {
      setDetailLoading(false);
    }
  };

  /** "Batafsil" oynasini ochmasdan to'g'ridan-to'g'ri sertifikat PDF yuklab olish. */
  const downloadCertificate = async (examId: number, resultId: string) => {
    setPdfDownloadingId(examId);
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${examId}/certificate.pdf`), {
        headers: { Authorization: `Bearer ${token}`, 'X-Student-Lang': lang },
      });
      if (!res.ok) throw new Error('PDF');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${resultId}.pdf`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      console.error(e);
      alert(t.resultPdfError);
    } finally {
      setPdfDownloadingId(null);
    }
  };

  if (isBanned) {
    return (
      <div className="px-3 sm:px-6 py-8 max-w-lg mx-auto">
        <div className="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className="text-[18px] font-bold text-gray-900 mb-1.5">{t.studentAccountBannedTitle}</h2>
          <p className="text-[14px] text-gray-500 leading-relaxed">{t.studentAccountBannedBody}</p>
        </div>
      </div>
    );
  }

  void tick;
  const now = nowMs();

  /**
   * Talaba UCHUN haqiqiy oxirgi muddat.
   *
   * `end_time` ga qarab bo'lmaydi: qayta topshirish oynasi berilgan talaba
   * imtihonning umumiy vaqti tugagach ham haqli ravishda kiradi. Ilgari shu
   * sabab imtihon uning ro'yxatidan butunlay yo'qolib qolardi va u berilgan
   * imkoniyatdan foydalana olmasdi. Backend `access_until` da ikkalasining
   * kechrog'ini beradi.
   */
  const accessUntilMs = (e: any) => {
    const raw = e?.access_until || e?.end_time;
    const ms = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(ms) ? ms : 0;
  };

  // Hali tugamagan imtihonlar yoki yarim qolgan sessiya (in_progress).
  const visibleExams = exams.filter((e: any) => now <= accessUntilMs(e) || e.in_progress);

  const completedResults = results.filter((r: any) => r.status === 'Completed');
  const gradedPcts = completedResults
    .map((r: any) => r.percentage)
    .filter((p: any) => typeof p === 'number');
  const avgPct = gradedPcts.length
    ? Math.round(gradedPcts.reduce((a: number, b: number) => a + b, 0) / gradedPcts.length)
    : null;

  const displayedResults = useMemo(() => {
    const filtered = resultStatusFilter === 'all'
      ? results
      : results.filter((r: any) => r.status === resultStatusFilter);
    return sortResultsNewestFirst(filtered);
  }, [results, resultStatusFilter]);

  const firstName = (user?.name || '').toString().trim().split(/\s+/)[0] || '';
  const groupName = (user?.group_name || '').toString().trim();
  const greetingName = [firstName, groupName ? `(${groupName})` : ''].filter(Boolean).join(' ');

  const Tab = ({ id, label, count }: { id: 'available' | 'results'; label: string; count: number }) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => setActiveTab(id)}
        className={`h-9 px-3 sm:px-4 rounded-lg text-[12.5px] sm:text-[13px] font-semibold transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap flex-1 sm:flex-none ${
          active ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        {label}
        <span
          className={`text-[11px] font-bold tabular-nums px-1.5 h-[18px] min-w-[18px] inline-flex items-center justify-center rounded-full ${
            active ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-200/70 text-gray-500'
          }`}
        >
          {count}
        </span>
      </button>
    );
  };

  return (
    <div className="w-full py-2 sm:py-3 relative">
      <StartExamConfirm
        exam={confirmExam}
        lang={lang}
        readinessIssues={readinessIssues}
        onCancel={() => setConfirmExam(null)}
        onConfirm={() => {
          const ex = confirmExam;
          setConfirmExam(null);
          if (ex) onStartExam(ex, 0);
        }}
      />
      {/* Result detail overlay — createPortal orqali document.body ga chiqariladi. */}
      {detailPayload && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm">
          <div className="h-full overflow-y-auto overscroll-y-contain">
            <div className="sticky top-0 z-20 flex justify-end px-3 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-gradient-to-b from-slate-900/80 via-slate-900/40 to-transparent pointer-events-none">
              <button
                type="button"
                onClick={() => setDetailPayload(null)}
                aria-label={t.studentDash}
                className="pointer-events-auto w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-3 sm:px-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-w-6xl mx-auto -mt-2">
              <ExamResultSummary
                data={detailPayload}
                token={token}
                lang={lang}
                onBack={() => setDetailPayload(null)}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-[26px] font-bold tracking-tight text-gray-900 leading-tight">
            {L.greeting}{greetingName ? `, ${greetingName}` : ''}
          </h1>
          <p className="text-[13.5px] text-gray-500 mt-1">
            {visibleExams.length > 0
              ? <>
                  <span className="font-semibold text-gray-700">{visibleExams.length}</span> {L.subtitleActive}
                </>
              : L.subtitleNone}
          </p>
          {String((user as any)?.role || '').toLowerCase() === 'faculty' && visibleExams.some((e: any) => e.exam_mode === 'faculty_ai_books') && (
            <p className="text-[12.5px] text-indigo-700 mt-1.5 max-w-xl leading-relaxed">{L.facultyPickHint}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12px] text-gray-500 tabular-nums">
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatExamDateTime(new Date(now).toISOString(), lang)}
          </div>
          {/* Profil rasmini yangilash: kichik HR kadrlari sabab imtihonga
              kirishda yuz tanilmasdi — shu yerdan pasport rasmini yuklaydi. */}
          <a
            href="/profil-rasm"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="hidden sm:inline">
              {lang === 'ru' ? 'Обновить фото' : lang === 'en' ? 'Update photo' : 'Rasmni yangilash'}
            </span>
          </a>
          <AdminBtn
            variant="ghost"
            size="md"
            loading={refreshing}
            onClick={handleManualReload}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          >
            <span className="hidden sm:inline">{t.reload ?? 'Yangilash'}</span>
          </AdminBtn>
        </div>
      </div>

      {/* ── Stat tiles ── */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3 mb-5">
        <StatTile
          label={L.statActive}
          value={visibleExams.length}
          accent
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          }
        />
        <StatTile
          label={L.statCompleted}
          value={completedResults.length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatTile
          label={L.statAvg}
          value={avgPct != null ? `${avgPct}%` : '—'}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
      </div>

      {/* ── Imtihonga tayyorlik va yordam ── */}
      <ExamReadiness lang={lang} hasPhoto={Boolean((user as any)?.profile_image)} onSummary={onReadiness} />

      {/* ── Tabs + natija filtri (bir qator) ── */}
      <div className="flex items-center justify-between gap-2 sm:gap-3 mb-5 min-w-0">
        <div className="flex items-center gap-1 h-11 rounded-xl bg-gray-100 p-1 border border-gray-200 min-w-0 shrink">
          <Tab id="available" label={t.tabAvailableExams} count={visibleExams.length} />
          <Tab id="results" label={t.tabMyResults} count={results.length} />
        </div>
        {activeTab === 'results' && results.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="student-result-status-filter" className="text-[12px] text-gray-500 shrink-0 hidden sm:inline">
              {L.filterByStatus}
            </label>
            <AdminSelect
              id="student-result-status-filter"
              value={resultStatusFilter}
              onChange={(e) => setResultStatusFilter(e.target.value as ResultStatusFilter)}
              className="h-9 text-[13px] w-[130px] sm:w-[170px]"
            >
              <option value="all">{t.examStatusAll}</option>
              <option value="Completed">{t.resultStatusCompleted}</option>
              <option value="Failed">{t.resultStatusFailed}</option>
              <option value="Banned">{t.resultStatusBanned}</option>
            </AdminSelect>
          </div>
        )}
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div key="err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-4">
            <AdminAlert type="error">{error}</AdminAlert>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
              <div className="h-10 bg-gray-100 rounded-lg mt-4" />
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {!loading && (
        <AnimatePresence mode="wait">
          {activeTab === 'available' ? (
            <motion.div
              key="available"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4"
            >
              {exams.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  }
                  title={t.emptyStudentExams}
                  hint={!user?.group_id ? t.studentNoGroupHint : t.studentNoExamsForGroupHint.replace('{group}', user.group_name || String(user.group_id))}
                />
              ) : visibleExams.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  }
                  title={t.studentNoOpenExamsTitle}
                  hint={t.studentNoOpenExamsHint}
                />
              ) : (
                visibleExams.map((e: any, i) => {
                  const startMs = new Date(e.start_time).getTime();
                  const endMs = accessUntilMs(e);
                  const isOngoing = now >= startMs && now <= endMs;
                  const isUpcoming = now < startMs;
                  const untilStart = msUntil(e.start_time, now);
                  const retakesBlocked = Boolean(e.exam_retakes_blocked);
                  // Retake-pending: oldingi urinishda yiqilgan, lekin retake qolgan va
                  // sessiya hali "In Progress" emas (Pending). Talaba imtihon oynasi ochiq
                  // ekan panelidan "Qayta boshlash" orqali qaytadan kiradi (majburiy emas).
                  const retakePending = Boolean(
                    e.student_exam_id &&
                      !e.in_progress &&
                      !retakesBlocked &&
                      isOngoing &&
                      (e.session_phase === 'after_retake' ||
                        (e.violation_retakes_used ?? 0) > 0 ||
                        (e.identity_retakes_used ?? 0) > 0),
                  );
                  const showLive = (isOngoing || e.in_progress) && !retakesBlocked;

                  return (
                    <motion.div
                      key={e.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className={`group flex flex-col rounded-xl border bg-white overflow-hidden transition-all ${
                        showLive ? 'border-gray-200 hover:border-indigo-300 hover:shadow-md' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {/* Status strip */}
                      <div className="px-5 pt-4 flex items-center justify-between gap-2">
                        {showLive ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                            {L.pillLive}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 px-2 py-1 rounded-md">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            {t.examStateUpcoming}
                          </span>
                        )}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {e.session_phase === 'after_retake' && (
                            <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">
                              {t.sessionPhaseAfterRetake}
                            </span>
                          )}
                          <span
                            className="text-[10px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-md uppercase tracking-wide"
                            title={e.language === 'auto' ? t.studentExamLangAutoHint : undefined}
                          >
                            {e.language === 'auto' ? t.langAuto : e.language}
                          </span>
                          {(e.exam_mode === 'bank_mixed' || e.exam_mode === 'imentor_mixed' || e.exam_mode === 'faculty_ai_books') && (
                            <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md">
                              {e.exam_mode === 'imentor_mixed'
                                ? t.imentorExamBadge
                                : e.exam_mode === 'faculty_ai_books'
                                  ? L.facultyUsmleBadge
                                  : t.bankExamBadge}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="px-5 pt-2.5 pb-4 flex-1">
                        <h3 className="text-[15.5px] font-semibold text-gray-900 leading-snug mb-3.5">{e.title}</h3>
                        {e.faculty_subject ? (
                          <div className="mb-3 -mt-2">
                            <p className="text-[12px] text-indigo-700 font-medium">{e.faculty_subject}</p>
                            {e.kafedra_name ? (
                              <p className="text-[11px] text-gray-500 mt-0.5">
                                {L.facultyKafedra}: {e.kafedra_name}
                              </p>
                            ) : null}
                            {e.exam_mode === 'faculty_ai_books' && e.questions_ready === false ? (
                              <p className="text-[11px] text-amber-700 mt-1 font-medium">{L.questionsPreparing}</p>
                            ) : null}
                          </div>
                        ) : null}

                        <dl className="space-y-2.5 text-[13px]">
                          <MetaRow
                            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
                            label={t.startTime}
                            value={formatExamDateTime(e.start_time, lang)}
                          />
                          <MetaRow
                            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
                            label={t.endTime}
                            value={formatExamDateTime(e.access_until || e.end_time, lang)}
                          />
                          <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-gray-100">
                            <span className="text-gray-500 inline-flex items-center gap-2">
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                              {t.duration}
                            </span>
                            <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md text-[12px] tabular-nums">
                              {e.duration_minutes} {t.minutesShort}
                            </span>
                          </div>
                          {(e.exam_mode === 'bank_mixed' || e.exam_mode === 'imentor_mixed') && (
                            <MetaRow
                              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />}
                              label={t.examBankQuestionCount}
                              value={
                                e.bank_question_count
                                  ? String(e.bank_question_count)
                                  : t.examQuestionsAll
                              }
                            />
                          )}
                        </dl>

                        <ExamFacts exam={e} lang={lang} now={now} />

                        {((e.violation_retakes_used ?? 0) > 0 || (e.identity_retakes_used ?? 0) > 0) && (() => {
                          const isViolation = (e.violation_retakes_used ?? 0) > 0;
                          const used = isViolation ? (e.violation_retakes_used ?? 0) : (e.identity_retakes_used ?? 0);
                          const remaining = isViolation
                            ? (e.violation_retakes_remaining ?? 0)
                            : (e.identity_retakes_remaining ?? 0);
                          return (
                            <div className="mt-3.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[12px] font-semibold text-amber-800">
                                  {t.examCardRetakeCount
                                    .replace('{used}', String(used))
                                    .replace('{remaining}', String(remaining))}
                                </span>
                                <RetakeDots used={used} remaining={remaining} />
                              </div>
                            </div>
                          );
                        })()}

                        <AttemptHistoryButton
                          items={e.attempt_history}
                          label={L.attemptHistory}
                          onOpen={() => setHistoryModal({ title: e.title, items: e.attempt_history })}
                        />

                        {(isUpcoming && untilStart > 0) || e.has_pin ? (
                          <div className="mt-3.5 flex flex-wrap gap-1.5">
                            {isUpcoming && untilStart > 0 && (
                              <span className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1">
                                {t.examStartsIn}: <strong className="tabular-nums">{formatCountdown(untilStart, lang)}</strong>
                              </span>
                            )}
                            {e.has_pin && (
                              <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
                                <svg className="w-3.5 h-3.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                {t.examPinRequiredBadge}
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className="px-5 pb-5">
                        {e.access?.locked ? (
                          /* Ordinator/magistr: imtihon TO'LOVDAN keyin ochiladi.
                             Bu yerda urinishlar soni ham ko'rinib turadi. */
                          (() => {
                            const acc = e.access || {};
                            const rc = acc.receipt || null;
                            const waiting = rc && rc.status === 'Pending';
                            const attemptUsed = acc.code === 'ATTEMPT_USED';
                            const debtHold = acc.code === 'DEBT_HOLD';
                            if (acc.one_attempt) {
                              /* Bir martalik imtihon (1-kurs grant attestatsiyasi):
                                 to'lov/kvitansiya yo'q — faqat holat ko'rsatiladi. */
                              return (
                                <div className="rounded-lg border px-3 py-2.5 border-rose-200 bg-rose-50">
                                  <p className="text-[13px] font-bold text-rose-800">
                                    {attemptUsed ? P.used : debtHold ? P.debt : P.notAllowed}
                                  </p>
                                  <p className="text-[12px] mt-1 leading-snug text-gray-600">
                                    {attemptUsed ? P.oneUsedHint : debtHold ? P.debtHint : P.notAllowedHint}
                                  </p>
                                  {debtHold && acc.contact && (
                                    <a
                                      href={`tel:${String(acc.contact).replace(/[^\d+]/g, '')}`}
                                      className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white border border-rose-200 px-2.5 py-1.5 text-[13px] font-bold text-rose-800"
                                    >
                                      {P.debtCall}: {acc.contact}
                                    </a>
                                  )}
                                </div>
                              );
                            }
                            return (
                              <div className="space-y-2.5">
                                <div
                                  className={`rounded-lg border px-3 py-2.5 ${
                                    waiting
                                      ? 'border-amber-200 bg-amber-50'
                                      : 'border-rose-200 bg-rose-50'
                                  }`}
                                >
                                  <p
                                    className={`text-[13px] font-bold ${
                                      waiting ? 'text-amber-800' : 'text-rose-800'
                                    }`}
                                  >
                                    {waiting ? P.pending : attemptUsed ? P.used : P.required}
                                  </p>
                                  <p className="text-[12px] mt-1 leading-snug text-gray-600">
                                    {waiting
                                      ? P.pendingHint
                                      : attemptUsed
                                        ? P.usedHint
                                        : P.requiredHint}
                                  </p>
                                  {rc && rc.status === 'Rejected' && (
                                    <p className="text-[12px] mt-1.5 font-semibold text-rose-700">
                                      {P.rejected}
                                      {rc.admin_note ? `: ${rc.admin_note}` : ''}
                                    </p>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1.5 text-[11.5px]">
                                  <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-600 font-medium">
                                    {P.freeLeft}: {acc.tech_retries_left ?? acc.free_tech_retries ?? 3}/
                                    {acc.free_tech_retries ?? 3}
                                  </span>
                                  <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-600 font-medium">
                                    {P.paid}: {acc.paid_attempts ?? 0}
                                  </span>
                                </div>
                                <AdminBtn
                                  variant={waiting ? 'ghost' : 'amber'}
                                  size="lg"
                                  className="w-full"
                                  disabled={!!waiting}
                                  onClick={() => {
                                    setPayExam(e);
                                    setPayFile(null);
                                    setPayNote('');
                                    setPayMsg('');
                                  }}
                                >
                                  {waiting ? P.pending : P.upload}
                                </AdminBtn>
                              </div>
                            );
                          })()
                        ) : e.in_progress && !retakesBlocked ? (
                          <div className="space-y-2.5">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md">
                              {t.examInProgressBadge}
                            </span>
                            {e.has_pin && (
                              <AdminInput
                                type="password"
                                value={resumePins[e.id] || ''}
                                onChange={(ev) => setResumePins((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                                placeholder={t.enterPin}
                                className="text-center tracking-widest h-10"
                                autoComplete="off"
                              />
                            )}
                            <AdminBtn
                              variant="emerald"
                              size="lg"
                              className="w-full"
                              loading={resumeBusyId === e.id}
                              disabled={e.has_pin && !(resumePins[e.id] || '').trim()}
                              onClick={async () => {
                                setResumeBusyId(e.id);
                                try {
                                  if (e.identity_refresh_required || e.session_phase === 'after_retake') {
                                    onStartExam(e, e.student_exam_id ?? 0);
                                  } else {
                                    await onResumeExam(e, resumePins[e.id] || '');
                                  }
                                } finally {
                                  setResumeBusyId(null);
                                }
                              }}
                            >
                              {t.resumeExam}
                            </AdminBtn>
                          </div>
                        ) : retakesBlocked ? (
                          <AdminBtn variant="ghost" size="lg" className="w-full" disabled>
                            {t.examCardRetakesBlocked}
                          </AdminBtn>
                        ) : retakePending ? (
                          <div className="space-y-2">
                            <p className="text-[12px] text-amber-700 leading-snug">{L.retakeAvailable}</p>
                            <AdminBtn
                              variant="amber"
                              size="lg"
                              className="w-full"
                              onClick={() => onStartExam(e, e.student_exam_id ?? 0)}
                              iconRight={
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              }
                            >
                              {L.restartExam}
                            </AdminBtn>
                          </div>
                        ) : isOngoing ? (
                          e.exam_mode === 'faculty_ai_books' && e.questions_ready === false ? (
                            <AdminBtn variant="ghost" size="lg" className="w-full" disabled>
                              {L.questionsPreparing}
                            </AdminBtn>
                          ) : (
                          <AdminBtn variant="blue" size="lg" className="w-full" onClick={() => setConfirmExam(e)} iconRight={
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5l7 7-7 7" /></svg>
                          }>
                            {t.takeExam}
                          </AdminBtn>
                          )
                        ) : (
                          <AdminBtn variant="ghost" size="lg" className="w-full" disabled>
                            {t.examStateUpcoming}{untilStart > 0 ? ` · ${formatCountdown(untilStart, lang)}` : ''}
                          </AdminBtn>
                        )}
                      </div>
                    </motion.div>
                  );
                })
              )}
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {results.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  }
                  title={t.emptyStudentResults}
                />
              ) : displayedResults.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                  }
                  title={L.filterEmpty}
                />
              ) : (
                displayedResults.map((r: any, i) => {
                  const isCompleted = r.status === 'Completed';
                  const isBannedRes = r.status === 'Banned';
                  const isFailedRes = r.status === 'Failed';
                  const isAbsent = Boolean(r.absent); // umuman kirmagan (Failed + started_at yo'q)
                  const pct = typeof r.percentage === 'number' ? r.percentage : null;
                  const tone = pct != null ? scoreTone(pct) : null;
                  const examAppeals = banAppeals.filter((a) => a.exam_id === r.exam_id);
                  const hasPendingAppeal = examAppeals.some((a) => a.status === 'Pending');

                  return (
                    <motion.div
                      key={r.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden hover:border-gray-300 transition-colors"
                    >
                      {/* Header: title + status pill */}
                      <div className="px-5 py-4 flex items-start justify-between gap-3 border-b border-gray-100">
                        <h3 className="text-[14.5px] font-semibold text-gray-900 leading-snug min-w-0">{r.title}</h3>
                        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md ${
                          isCompleted ? 'bg-emerald-50 text-emerald-700' :
                          isBannedRes ? 'bg-red-50 text-red-700' :
                          isAbsent ? 'bg-gray-100 text-gray-600' :
                          isFailedRes ? 'bg-orange-50 text-orange-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {isCompleted ? t.resultStatusCompleted : isBannedRes ? t.resultStatusBanned : isAbsent ? L.absentStatus : isFailedRes ? t.resultStatusFailed : t.resultStatusOther}
                        </span>
                      </div>

                      {/* Body: score focal.
                          `justify-start` ATAYLAB: kartochkalar `grid` ichida eng
                          balandiga cho'ziladi (banlangan kartochkada murojaat
                          maydoni bor). Ilgari bu yerda `justify-center` turardi va
                          yakunlangan kartochkalarda mazmun o'rtada suzib, tepasida
                          katta bo'sh joy qolardi. Endi mazmun yuqorida, tugmalar
                          esa pastda (`mt-auto`) — barcha kartochkalar bir xil
                          o'qiladi. */}
                      <div className="px-5 py-4 flex-1 flex flex-col justify-start">
                        {isCompleted && pct != null ? (
                          <>
                            <div className="flex items-baseline justify-between mb-2">
                              <span className="text-[12px] text-gray-500 font-medium">{L.scoreLabel}</span>
                              <span className={`text-[26px] font-bold leading-none tabular-nums ${tone!.text}`}>{pct}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                              <div className={`h-full rounded-full ${tone!.bar}`} style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} />
                            </div>
                            <div className="flex items-center justify-between mt-2.5 text-[11.5px] text-gray-400">
                              <span className="tabular-nums">{r.score}/{r.total_questions} {L.questionsWord}</span>
                              {r.completed_at && <span className="tabular-nums">{new Date(r.completed_at).toLocaleDateString()}</span>}
                            </div>
                          </>
                        ) : isAbsent ? (
                          <div className="flex items-center gap-3 py-1">
                            <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center shrink-0">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636L5.636 18.364m0-12.728l12.728 12.728M12 21a9 9 0 100-18 9 9 0 000 18z" /></svg>
                            </div>
                            <div>
                              <div className="text-[14px] font-semibold text-gray-900">{L.absentStatus}</div>
                              <div className="text-[12px] text-gray-500">{L.absentHint}</div>
                            </div>
                          </div>
                        ) : isFailedRes ? (
                          <div className="flex items-center gap-3 py-1">
                            <div className="w-10 h-10 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </div>
                            <div>
                              <div className="text-[14px] font-semibold text-gray-900">{t.resultStatusFailed}</div>
                              <div className="text-[12px] text-gray-500">{L.failedScore}</div>
                              {pct != null && (
                                <div className="text-[12px] text-gray-400 tabular-nums mt-0.5">{r.score}/{r.total_questions} · {pct}%</div>
                              )}
                            </div>
                          </div>
                        ) : isBannedRes ? (
                          <div className="flex items-center gap-3 py-1">
                            <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                            </div>
                            <div>
                              <div className="text-[14px] font-semibold text-gray-900">{t.resultStatusBanned}</div>
                              {banReasonLabel(lang, r.ban_reason) ? (
                                <div className="text-[12px] text-red-700 mt-0.5">{banReasonLabel(lang, r.ban_reason)}</div>
                              ) : null}
                              <div className="text-[12px] text-gray-400">{L.scoreLabel}: —</div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 py-1">
                            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <div>
                              <div className="text-[14px] font-semibold text-gray-900">{L.pendingEval}</div>
                              <div className="text-[12px] text-gray-400">{t.resultPending}</div>
                            </div>
                          </div>
                        )}

                        {typeof r.attempts_count === 'number' && r.attempts_count > 1 && (
                          Array.isArray(r.attempt_history) && r.attempt_history.length > 0 ? (
                            <AttemptHistoryButton
                              items={r.attempt_history}
                              label={`${L.attemptHistory} · ${r.attempts_count}`}
                              onOpen={() => setHistoryModal({ title: r.title, items: r.attempt_history })}
                            />
                          ) : (
                            <p className="mt-3 text-[12px] text-gray-400">{L.attemptHistory} · {r.attempts_count}</p>
                          )
                        )}
                      </div>

                      {/* Footer: actions (only completed with public id) */}
                      {isBannedRes && (
                        <div className="px-5 pb-4 pt-3 space-y-2 border-t border-gray-100 mt-auto">
                          {examAppeals.length > 0 && (
                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
                              <p className="font-semibold text-gray-700 mb-1">{t.banAppealHistoryTitle}</p>
                              {examAppeals.slice(0, 2).map((a) => (
                                <p key={a.id} className="line-clamp-2">
                                  <span className="font-medium">{a.status}</span> — {a.reason}
                                </p>
                              ))}
                            </div>
                          )}
                          {!hasPendingAppeal && (
                            <>
                              <textarea
                                value={appealDrafts[r.exam_id] || ''}
                                onChange={(ev) => setAppealDrafts((prev) => ({ ...prev, [r.exam_id]: ev.target.value }))}
                                placeholder={t.banAppealPlaceholder}
                                className="w-full min-h-[72px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500"
                              />
                              {appealMsgByExam[r.exam_id] && (
                                <AdminAlert type={appealMsgByExam[r.exam_id].startsWith('ok:') ? 'success' : 'error'}>
                                  {appealMsgByExam[r.exam_id].startsWith('ok:') ? appealMsgByExam[r.exam_id].slice(3) : appealMsgByExam[r.exam_id]}
                                </AdminAlert>
                              )}
                              <AdminBtn
                                variant="ghost"
                                size="md"
                                className="w-full"
                                loading={appealBusyExam === r.exam_id}
                                disabled={(appealDrafts[r.exam_id] || '').trim().length < 12}
                                onClick={async () => {
                                  setAppealBusyExam(r.exam_id);
                                  try {
                                    const res = await fetch(apiUrl('/api/student/ban-appeals'), {
                                      method: 'POST',
                                      headers: {
                                        'Content-Type': 'application/json',
                                        Authorization: `Bearer ${token}`,
                                        ...examAuthHeaders(token),
                                      },
                                      body: JSON.stringify({
                                        exam_id: r.exam_id,
                                        reason: (appealDrafts[r.exam_id] || '').trim(),
                                      }),
                                    });
                                    const data = await readJsonSafe<{ error?: string }>(res);
                                    if (!res.ok) {
                                      setAppealMsgByExam((prev) => ({ ...prev, [r.exam_id]: data?.error || t.banAppealSubmitError }));
                                      return;
                                    }
                                    setAppealMsgByExam((prev) => ({ ...prev, [r.exam_id]: `ok:${t.banAppealSubmitOk}` }));
                                    setAppealDrafts((prev) => ({ ...prev, [r.exam_id]: '' }));
                                    void fetchData();
                                  } finally {
                                    setAppealBusyExam(null);
                                  }
                                }}
                              >
                                {appealBusyExam === r.exam_id ? t.banAppealSending : t.banAppealSubmitBtn}
                              </AdminBtn>
                            </>
                          )}
                        </div>
                      )}

                      {isCompleted && r.result_public_id && (
                        <div className="px-5 pb-4 pt-0 flex gap-2 mt-auto">
                          <AdminBtn
                            variant="ghost"
                            size="md"
                            className="flex-1"
                            loading={detailLoading}
                            onClick={() => openResultDetail(r.exam_id)}
                            icon={
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            }
                          >
                            {t.studentResultCertificateBtn}
                          </AdminBtn>
                          <AdminBtn
                            variant="blue"
                            size="md"
                            className="shrink-0 px-3"
                            loading={pdfDownloadingId === r.exam_id}
                            onClick={() => downloadCertificate(r.exam_id, r.result_public_id)}
                            aria-label={t.resultDownloadPdf}
                            icon={
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                              </svg>
                            }
                          >
                            PDF
                          </AdminBtn>
                        </div>
                      )}
                    </motion.div>
                  );
                })
              )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Urinish tarixi modali */}
      {historyModal && createPortal(
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 py-8"
          role="dialog"
          aria-modal="true"
          onClick={() => setHistoryModal(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-md max-h-[80vh] flex flex-col rounded-xl bg-white shadow-2xl overflow-hidden"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{L.attemptHistory}</p>
                <h3 className="text-[15px] font-bold text-gray-900 truncate">{historyModal.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModal(null)}
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                aria-label={t.liveMonitorClose}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <ol className="flex-1 overflow-y-auto overscroll-y-contain divide-y divide-gray-100">
              {historyModal.items.map((item: any, idx: number) => (
                <li key={`${item.at || idx}-${item.violation_type || idx}`} className="flex gap-3 px-5 py-3">
                  <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-gray-800 leading-snug break-words">{item.reason || item.violation_type}</p>
                    <p className="text-[11.5px] text-gray-400 tabular-nums mt-0.5">
                      {item.at ? new Date(item.at).toLocaleString() : '—'}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </motion.div>
        </div>,
        document.body,
      )}

      {/* Kvitansiya yuklash — ordinator/magistr */}
      {payExam && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 py-8"
          role="dialog"
          aria-modal="true"
          onClick={() => !payBusy && setPayExam(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-md rounded-xl bg-white shadow-2xl overflow-hidden"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-[15px] font-bold text-gray-900">{P.modalTitle}</h3>
              <p className="text-[12.5px] text-gray-500 mt-0.5 truncate">{payExam.title}</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-[12.5px] text-gray-600 leading-snug">{P.requiredHint}</p>
              <label className="block">
                <span className="text-[12px] font-semibold text-gray-600">{P.pick}</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(ev) => setPayFile(ev.target.files?.[0] ?? null)}
                  className="mt-1.5 block w-full text-[13px] text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-indigo-700 file:font-semibold"
                />
              </label>
              <AdminInput
                value={payNote}
                onChange={(ev) => setPayNote(ev.target.value)}
                placeholder={P.note}
              />
              {payMsg && <AdminAlert type="error">{payMsg}</AdminAlert>}
              <div className="flex justify-end gap-2 pt-1">
                <AdminBtn variant="ghost" onClick={() => setPayExam(null)} disabled={payBusy}>
                  {P.cancel}
                </AdminBtn>
                <AdminBtn variant="emerald" onClick={sendReceipt} loading={payBusy} disabled={!payFile}>
                  {P.send}
                </AdminBtn>
              </div>
            </div>
          </motion.div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ── Meta row (icon + label + value) ─────────────────────────────────────── */
function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500 inline-flex items-center gap-2">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
        {label}
      </span>
      <span className="font-medium text-gray-900 tabular-nums text-right">{value}</span>
    </div>
  );
}

/* ── Empty state (full-width, centered) ──────────────────────────────────── */
function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="col-span-full">
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 px-6 text-center">
        <div className="w-14 h-14 bg-gray-50 border border-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-gray-400">
          {icon}
        </div>
        <p className="text-[15px] font-semibold text-gray-700 mb-1">{title}</p>
        {hint && (
          <p className="text-[13px] text-gray-500 max-w-md mx-auto mt-2">{hint}</p>
        )}
      </div>
    </div>
  );
}
