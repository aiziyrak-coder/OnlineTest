import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AdminBtn, AdminAlert } from './admin/ui';
import { useServerProctoring } from '../lib/useServerProctoring';
import { useRealtimeProctoring } from '../lib/useRealtimeProctoring';
import type { FaceStatusLive, LiveSignalType } from '../lib/realtimeProctor';
import {
  ALL_LIVE_SIGNAL_VIOLATIONS,
  LIVE_SIGNAL_CONFIRM_MS,
  LIVE_SIGNAL_ESCALATE_MS,
  TALK_SIGNAL_ESCALATE_MS,
  TALK_SIGNAL_CONFIRM_MS,
  liveSignalViolationType,
} from '../lib/realtimeProctor';
import { SmallWarningLedger, SMALL_WARNINGS_BEFORE_FORMAL } from '../lib/smallWarningLedger';
import { SileroVad } from '../lib/sileroVad';
import { ForbiddenObjectProctor } from '../lib/forbiddenObjectProctor';
import {
  analyzeVoiceFrame,
  AmbientNoiseTracker,
  VoiceActivityTracker,
  WhisperTracker,
} from '../lib/voiceActivity';
import { ContinuousSignalTracker } from '../lib/continuousSignal';
import { OwnSpeechGate } from '../lib/ownSpeechGate';
import { ViolationGate } from '../lib/violationGate';
import { TabSwitchGuard } from '../lib/tabSwitchGuard';
import { ConsoleProbeDevtoolsDetector, WindowSizeDevtoolsHeuristic } from '../lib/devtoolsDetect';
import { motion, AnimatePresence } from 'motion/react';
import { Calculator } from '../components/Calculator';
import { createRealtimeSocket, buildRealtimeUrl, type RealtimeSocket } from '../lib/realtimeSocket';
import { translations, Language, banReasonLabel, formatPreExamMediaAccessFailure } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { examAuthHeaders, setDeviceSessionToken } from '../lib/deviceFingerprint';
import { buildGuardedExamHeaders, syncVacFromResponse } from '../lib/examRequestGuard';
import type { ExamResultPayload } from '../components/ExamResultSummary';
import {
  openPreferredProctorStream,
  VIRTUAL_CAMERA_BLOCKED_MESSAGE,
} from '../lib/preferredCameraStream';
import { claimPrewarmedProctorStream } from '../lib/proctorStreamPrewarm';
import { compressVideoFrameToJpeg } from '../lib/compressToJpeg';
import { SecureText } from '../components/SecureText';
import { startExtensionWatch } from '../lib/extensionDetect';
import { captureScreenJpeg, isScreenShareActive, onScreenShareEnded, requestScreenShare, stopScreenShare } from '../lib/screenShare';
import { getDesktop } from '../lib/desktop';
import { cleanQuestionPrompt, normalizeQuestionOptions, optionLetter } from '../lib/examQuestionUtils';

// Savol panjarasi izohi (uz/ru/en) — katta i18n fayliga tegmasdan.
const EXAM_L: Record<Language, { answered: string; flagged: string; empty: string; faceOk: string; faceWaiting: string; faceNoFace: string; faceMulti: string; faceTooFar: string; faceTooClose: string; liveTalking: string; liveHeadAway: string; liveTooFar: string; liveTooClose: string; liveOffCenter: string; liveMovement: string; liveAmbientNoise: string; liveHand: string; liveNoFace: string; liveMultiFace: string; liveScreenshot: string; liveClipboard: string; liveDevtools: string; liveTabSwitch: string; livePhone: string; liveBook: string; liveLaptop: string; engineLoading: string; engineReady: string }> = {
  uz: {
    answered: 'Javob berilgan',
    flagged: 'Belgilangan',
    empty: 'Bo‘sh',
    faceOk: 'Yuz aniq',
    faceWaiting: 'Kamera tayyor...',
    faceNoFace: "Yuz ko'rinmayapti",
    faceMulti: 'Bir nechta yuz!',
    faceTooFar: "Yaqinroq o'ting",
    faceTooClose: "Uzoqroq toring",
    liveTalking: "Gapirish aniqlandi — jim bo'ling",
    liveHeadAway: "Kameraga qarang",
    liveTooFar: "Kameradan uzoqsiz",
    liveTooClose: "Kameraga yaqinsiz",
    liveOffCenter: "Kadr markaziga o'ting",
    liveMovement: "Haddan tashqari qimirlash — tinch o'tiring",
    liveAmbientNoise: "Tashqi shovqin bor — jimlikni saqlang",
    liveHand: "Qo'l ko'tarilgan — qo'llaringizni stolda ushlang",
    liveNoFace: "Yuzingiz ko'rinmayapti — kameraga qarang",
    liveMultiFace: "Kadrda bir nechta shaxs — yolg'iz qoling",
    liveScreenshot: "Ekran surati urinishi — to'xtating",
    liveClipboard: "Nusxa ko'chirish urinishi — to'xtating",
    liveDevtools: "Developer tools urinishi — to'xtating",
    liveTabSwitch: "Boshqa oynaga o'tildi — imtihonga qayting",
    livePhone: "Telefon aniqlandi — telefon ishlatmang",
    liveBook: "Kitob/daftar aniqlandi — olib qo'ying",
    liveLaptop: "Noutbuk aniqlandi — olib qo'ying",
    engineLoading: "Nazorat tizimi yuklanmoqda",
    engineReady: "Nazorat tizimi tayyor",
  },
  ru: {
    answered: 'Отвечено',
    flagged: 'Отмечено',
    empty: 'Пусто',
    faceOk: 'Лицо видно',
    faceWaiting: 'Камера...',
    faceNoFace: 'Лицо не видно',
    faceMulti: 'Несколько лиц!',
    faceTooFar: 'Ближе к камере',
    faceTooClose: 'Дальше от камеры',
    liveTalking: 'Обнаружен разговор — соблюдайте тишину',
    liveHeadAway: 'Смотрите в камеру',
    liveTooFar: 'Вы далеко от камеры',
    liveTooClose: 'Вы слишком близко к камере',
    liveOffCenter: 'Встаньте по центру кадра',
    liveMovement: 'Слишком много движений — сидите спокойно',
    liveAmbientNoise: 'Посторонний шум — соблюдайте тишину',
    liveHand: 'Рука поднята — держите руки на столе',
    liveNoFace: 'Лицо не видно — смотрите в камеру',
    liveMultiFace: 'В кадре несколько лиц — будьте одни',
    liveScreenshot: 'Попытка снимка экрана — прекратите',
    liveClipboard: 'Попытка копирования — прекратите',
    liveDevtools: 'Попытка открыть Developer tools — прекратите',
    liveTabSwitch: 'Переход в другое окно — вернитесь к экзамену',
    livePhone: 'Обнаружен телефон — не пользуйтесь телефоном',
    liveBook: 'Обнаружена книга/тетрадь — уберите',
    liveLaptop: 'Обнаружен ноутбук — уберите',
    engineLoading: 'Система наблюдения загружается',
    engineReady: 'Система наблюдения готова',
  },
  en: {
    answered: 'Answered',
    flagged: 'Flagged',
    empty: 'Empty',
    faceOk: 'Face OK',
    faceWaiting: 'Camera...',
    faceNoFace: 'No face',
    faceMulti: 'Multiple faces!',
    faceTooFar: 'Move closer',
    faceTooClose: 'Move back',
    liveTalking: 'Talking detected — please stay silent',
    liveHeadAway: 'Look at the camera',
    liveTooFar: 'You are too far from the camera',
    liveTooClose: 'You are too close to the camera',
    liveOffCenter: 'Move to the center of the frame',
    liveMovement: 'Excessive movement — please stay still',
    liveAmbientNoise: 'Background noise detected — please stay quiet',
    liveHand: 'Hand raised — keep your hands on the desk',
    liveNoFace: 'Face not visible — look at the camera',
    liveMultiFace: 'Multiple people in frame — stay alone',
    liveScreenshot: 'Screenshot attempt — please stop',
    liveClipboard: 'Copy attempt — please stop',
    liveDevtools: 'Developer tools attempt — please stop',
    liveTabSwitch: 'Switched to another window — return to the exam',
    livePhone: 'Phone detected — do not use a phone',
    liveBook: 'Book/notebook detected — put it away',
    liveLaptop: 'Laptop detected — put it away',
    engineLoading: 'Monitoring system loading',
    engineReady: 'Monitoring system ready',
  },
};

// Identity check: har 3 soniyada (OpenCV SFace lokal, tez ~100ms; throttle 60/min)
// 90s -> 15s: yuz almashtirish oynasi qisqartirildi (server throttle 25/min,
// 15s = 4/min — chegaraga yetmaydi).
const IDENTITY_CHECK_MS = 15_000;

/** Tab/oynadan shuncha vaqtdan ko'p ketilsa — RASMIY qoidabuzarlik (TAB_SWITCH_HARD).
 *  Qisqa tasodifiy fokus yo'qolishi (brauzer UI, OS bildirishnomasi) hisoblanmaydi.
 *  "Kichik ogohlantirish" bosqichi YO'Q — talaba boshqa tabda uni ko'ra olmaydi. */
const TAB_AWAY_VIOLATION_MS = 1200;

/** Fullscreen'dan chiqilgandan keyin shuncha vaqt ichida qaytilmasa — RASMIY
 *  qoidabuzarlik (FULLSCREEN_EXIT_HARD). Qoplama ekranni to'sib turgani uchun
 *  bu vaqt ichida boshqa nazorat signallari yozilmaydi; shu sabab "qoplama
 *  ostida cheksiz o'tirib nazoratni to'xtatib turish" yo'li yopiladi. */
const FULLSCREEN_GRACE_MS = 10_000;
/** Butun ekran rasmi (dalil) yuborish oralig'i. */
const SCREEN_SNAPSHOT_MS = 45_000;
/** Ulashish to'xtab turgan bo'lsa, qoidabuzarlik shu oraliqda takror yoziladi. */
const SCREEN_SHARE_RELOG_MS = 60_000;
/** Kamera kadri (dalil) yuborish oralig'i. */
const WEBCAM_SNAPSHOT_MS = 30_000;

/* Savolga vaqt rejimi matnlari (uz/ru/en). */
const LOCK_L: Record<string, Record<string, string>> = {
  uz: { locked: "Orqaga qaytib bo'lmaydi", time: 'Savol vaqti', read: "Savolni o'qing", early: "Savolni o'qib chiqing — {n} soniyadan keyin o'tish mumkin" },
  ru: { locked: 'Возврат назад невозможен', time: 'Время на вопрос', read: 'Прочитайте вопрос', early: 'Прочитайте вопрос — перейти можно через {n} с' },
  en: { locked: 'You cannot go back', time: 'Question time', read: 'Read the question', early: 'Read the question — you can continue in {n} s' },
};

/** Talaba ID si va ismi yozilgan takroriy suv belgisi: ekrandan olingan rasm
 *  tarqalsa, kim tarqatgani aniqlanadi. */
function watermarkBackground(text: string): string {
  const safe = String(text || '').replace(/[<>&"']/g, '');
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='380' height='190'>` +
    `<text x='20' y='120' transform='rotate(-22 190 95)' fill='rgba(15,23,42,0.075)' ` +
    `font-family='Segoe UI, Arial, sans-serif' font-size='17' font-weight='600'>${safe}</text></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

/* Ekranni ulashish qoplamasi matnlari (uz/ru/en). */
const SCREEN_L: Record<string, Record<string, string>> = {
  uz: {
    title: "Ekranni ulashish to'xtadi",
    body: "Imtihonni davom ettirish uchun butun ekraningizni qayta ulashing: oynada «Butun ekran» (Entire screen) ni tanlab «Ulashish» ni bosing. Ulashishni ataylab to'xtatish qoidabuzarlik sifatida qayd etiladi.",
    btn: 'Butun ekranni ulashish',
    DENIED: "Ruxsat berilmadi. Tugmani qayta bosing, «Butun ekran» ni tanlang va «Ulashish» ni bosing.",
    NOT_MONITOR: "Oyna yoki tab tanlandi. Faqat «Butun ekran» (Entire screen) qabul qilinadi.",
    NOT_SUPPORTED: "Brauzeringiz ekranni ulashishni qo'llamaydi. Google Chrome yoki Microsoft Edge'ning yangi versiyasidan foydalaning.",
    FAILED: "Ekranni ulashib bo'lmadi. Qayta urinib ko'ring.",
  },
  ru: {
    title: 'Демонстрация экрана остановлена',
    body: 'Чтобы продолжить экзамен, снова откройте доступ ко всему экрану: выберите «Весь экран» (Entire screen) и нажмите «Поделиться». Намеренная остановка фиксируется как нарушение.',
    btn: 'Поделиться всем экраном',
    DENIED: 'Доступ не предоставлен. Нажмите кнопку снова, выберите «Весь экран» и нажмите «Поделиться».',
    NOT_MONITOR: 'Выбрано окно или вкладка. Принимается только «Весь экран» (Entire screen).',
    NOT_SUPPORTED: 'Ваш браузер не поддерживает демонстрацию экрана. Используйте свежую версию Google Chrome или Microsoft Edge.',
    FAILED: 'Не удалось начать демонстрацию экрана. Попробуйте ещё раз.',
  },
  en: {
    title: 'Screen sharing stopped',
    body: 'To continue the exam, share your entire screen again: choose "Entire screen" and click "Share". Deliberately stopping sharing is recorded as a violation.',
    btn: 'Share entire screen',
    DENIED: 'Permission was not granted. Click the button again, choose "Entire screen" and click "Share".',
    NOT_MONITOR: 'A window or tab was selected. Only "Entire screen" is accepted.',
    NOT_SUPPORTED: 'Your browser does not support screen sharing. Use a recent Google Chrome or Microsoft Edge.',
    FAILED: 'Could not start screen sharing. Please try again.',
  },
};
/** Kamera/mikrofon shuncha vaqt uzluksiz uzilsa savollar qayta yopiladi.
 *  Qisqa qotishlar uchun darvoza miltillamasin. */
const MEDIA_LOSS_RELOCK_MS = 2500;

/** Javob o'zgargandan keyin serverga saqlashgacha kutish (tinch pauza). */
const AUTOSAVE_DEBOUNCE_MS = 8000;
/** Oxirgi muvaffaqiyatli saqlashdan keyingi MAKSIMAL kutish — debounce'dan
 *  qat'i nazar shu vaqt o'tsa darhol saqlanadi. Talaba to'xtovsiz javob
 *  belgilab tursa ham qoralama eskirib qolmaydi. */
const AUTOSAVE_MAX_WAIT_MS = 30_000;

/** Fullscreen'ga kirgandan keyin tab-nazorati shuncha vaqt BARQAROR turgach
 *  yoqiladi. Fullscreen o'tishida brauzer beradigan blur/visibility to'lqini
 *  shu oyna ichida tugaydi — shu sababli u qoidabuzarlik deb yozilmaydi. */
const TAB_GUARD_ARM_MS = 3000;

/** Kichik ogohlantirish modali yopilgach — o'sha signal shuncha vaqt qayta ochmaydi. */
const SMALL_WARN_GRACE_MS = 3000;
/** Talaba "Tushundim" bosmasa ham modal shuncha vaqtdan keyin o'zi yopiladi.
 *  Bu MAJBURIY xavfsizlik chegarasi: aks holda talaba modalni ochiq qoldirib,
 *  nazorat muzlab turganda bemalol ko'chirishi mumkin bo'lardi. */
const SMALL_WARN_AUTOCLOSE_MS = 6000;
/** Rasmiy ogohlantirish modali ham cheksiz ochiq qolmasin — 10s da avto-yopiladi.
 *  Modal ochiqligida nazorat muzlaydi (warningModalShowingRef), shu sabab talaba
 *  uni ochiq qoldirib ko'chira olmasligi uchun majburiy chegara. */
const FORMAL_WARN_AUTOCLOSE_MS = 10000;

/**
 * Audio "gapirish" uchun kichik-ogohlantirish hisobi kaliti. Rasmiy tur talabaning
 * o'z og'zi qimirlayotganiga qarab o'zgaradi (MOUTH_MOVEMENT_TALKING / WHISPER...),
 * lekin HISOB bitta bo'lishi kerak — shu sabab kalit doim shu.
 */
const SPEECH_LEDGER_KEY = 'WHISPER_OR_CONVERSATION_SUSPECTED';

type QTiming = { ms: number; first: number | null; changes: number };

/** Savollarga sarflangan vaqt — joriy ko'rsatilayotgan savolning jonli vaqti ham qo'shiladi. */
function buildTimings(acc: Record<string, QTiming>, shown: { id: string; at: number } | null): Record<string, QTiming> {
  const out: Record<string, QTiming> = {};
  for (const [k, v] of Object.entries(acc)) out[k] = { ...v };
  if (shown) {
    const r = out[shown.id] || { ms: 0, first: null, changes: 0 };
    r.ms += Math.max(0, Date.now() - shown.at);
    out[shown.id] = r;
  }
  return out;
}

interface ExamRoomProps {
  exam: any;
  studentExamId: number;
  token: string;
  user: any;
  lang: Language;
  onFinish: (submitPayload?: ExamResultPayload | null) => void;
  onRetakeRestart?: () => void;
}

function extractQuestionImages(text: string): { cleanText: string; images: string[] } {
  const src = text || '';
  const images: string[] = [];
  const mdRe = /!\[[^\]]*\]\((https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp))\)/gi;
  let clean = src.replace(mdRe, (_, url: string) => {
    images.push(url);
    return '';
  });
  const rawRe = /(https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp))/gi;
  clean = clean.replace(rawRe, (url: string) => {
    if (!images.includes(url)) images.push(url);
    return '';
  });
  return { cleanText: clean.trim(), images };
}

function sanitizeExamAnswers(
  questions: Array<{ id: number | string; options?: string[] }>,
  raw: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const optionMap = new Map<string, Set<string>>();
  for (const q of questions || []) {
    const qKey = String(q?.id ?? '');
    if (!qKey) continue;
    const opts = Array.isArray(q?.options) ? q.options.filter((x): x is string => typeof x === 'string') : [];
    optionMap.set(qKey, new Set(opts));
  }
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const qKey = String(key);
    const answer = typeof value === 'string' ? value : '';
    const allowed = optionMap.get(qKey);
    if (!allowed || !answer || !allowed.has(answer)) continue;
    clean[qKey] = answer;
  }
  return clean;
}

function parseAnswersJson(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safeLocalGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota/private mode */
  }
}

function safeLocalRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore quota/private mode */
  }
}

/** Print Screen / skrinshot tugmalari (brauzer va OS farqlari). */
function isPrintScreenKeyboardEvent(e: KeyboardEvent): boolean {
  const code = (e.code || '').toLowerCase();
  const key = (e.key || '').toLowerCase();
  if (code === 'printscreen' || key === 'printscreen' || key === 'snapshot') return true;
  // Windows: Win+Shift+S (Snipping Tool) — Chrome ba'zan metaKey sifatida beradi
  if (e.shiftKey && (e.metaKey || e.ctrlKey) && key === 's') return true;
  // macOS: Cmd+Shift+3/4/5
  if (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(key)) return true;
  return false;
}

function reportPrintScreenViolation(log: (type: string) => void): void {
  void log('PRINT_SCREEN');
}

function initialSecondsLeft(exam: ExamRoomProps['exam']) {
  if (exam.submission_deadline) {
    const end = new Date(exam.submission_deadline).getTime();
    const s = Math.floor((end - Date.now()) / 1000);
    if (!Number.isNaN(end) && s > 0) return s;
  }
  if (!exam.startedAt) return exam.duration_minutes * 60;
  const startedAtTime = new Date(exam.startedAt).getTime();
  const elapsedSeconds = Math.floor((Date.now() - startedAtTime) / 1000);
  const totalDurationSeconds = exam.duration_minutes * 60;
  const remaining = totalDurationSeconds - elapsedSeconds;
  return remaining > 0 ? remaining : 0;
}

// Ogohlantirish modal uchun state turi
interface ViolationWarning {
  reason: string;
  warningNumber: number;
  isFinalWarning: boolean;
}

interface WarningHistoryItem {
  number: number;
  reason: string;
}

function WarningStepRow({
  warningCount,
  maxWarnings,
  banReached,
  isFinalPending,
  t,
}: {
  warningCount: number;
  maxWarnings: number;
  banReached: boolean;
  isFinalPending?: boolean;
  t: (typeof translations)['uz'];
}) {
  // maxWarnings — ban beriladigan qoidabuzarlik tartib raqami (4): 3 ta ogohlantirish, keyin BAN.
  const steps = Array.from({ length: Math.max(1, maxWarnings - 1) }, (_, i) => i + 1);
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide font-medium">
        {t.violationProgressTitle}
      </p>
      <div className="flex justify-center items-center gap-1.5 sm:gap-2">
        {steps.map((n) => {
          const done = warningCount >= n;
          return (
            <div
              key={n}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-all ${
                done
                  ? banReached
                    ? 'bg-red-600 text-white border-red-700'
                    : 'bg-orange-100 text-orange-700 border-orange-400'
                  : 'bg-gray-100 text-gray-400 border-gray-200'
              }`}
            >
              {done ? (banReached ? '✓' : '!') : n}
            </div>
          );
        })}
        <div
          className={`min-w-[2.75rem] h-9 sm:h-10 px-2 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-extrabold border-2 transition-all ${
            banReached
              ? 'bg-red-700 text-white border-red-800 shadow-md'
              : isFinalPending
                ? 'bg-red-600 text-white border-red-700 shadow-md'
                : 'bg-gray-50 text-gray-400 border-dashed border-gray-300'
          }`}
        >
          {t.violationStepBan}
        </div>
      </div>
    </div>
  );
}

/** Shu urinishdagi barcha qoidabuzarliklar ro'yxati — ogohlantirish/retake/ban modallarida bir xil ko'rinishda. */
function ViolationHistoryList({
  history,
  label,
}: {
  history: WarningHistoryItem[];
  label: string;
}) {
  if (history.length === 0) return null;
  return (
    <div className="mb-4 text-left">
      <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">{label}</p>
      <ul className="space-y-1.5 text-[13px] text-gray-700 max-h-40 overflow-y-auto pr-1">
        {history.map((w) => (
          <li key={w.number} className="flex gap-2">
            <span className="shrink-0 font-bold text-orange-700">{w.number}.</span>
            <span className="break-words">{w.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExamRoom({ exam: initialExam, studentExamId: initialStudentExamId, token, user, lang, onFinish, onRetakeRestart }: ExamRoomProps) {
  const t = translations[lang];
  const [maxOfficialWarnings, setMaxOfficialWarnings] = useState(3);
  const [exam, setExam] = useState(initialExam);
  const [studentExamId, setStudentExamId] = useState(initialStudentExamId);
  const examQuestions = React.useMemo(
    () => (Array.isArray(exam.questions) ? exam.questions : []),
    [exam.questions],
  );
  const sessionStarted = Boolean(exam.startedAt && exam.sessionKey);
  const sessionStartedRef = useRef(sessionStarted);
  const [startingSession, setStartingSession] = useState(false);
  const [startError, setStartError] = useState('');
  // Sessiya serverda faol bo'lmay qolsa (server ban qildi / vaqt tugab
  // yakunlandi / admin qayta ochdi) — ogohlantirish oynasini osiltirib
  // qo'ymasdan to'g'ri holatga o'tamiz. Pastda logViolation yonida to'ldiriladi.
  const sessionGoneRef = useRef<(status: string, banReason?: string) => void>(() => {});
  // Har bir savolga sarflangan vaqt (ko'chirish tahlili uchun serverga yuboriladi).
  const qTimingRef = useRef<Record<string, QTiming>>({});
  const qShownRef = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    sessionStartedRef.current = sessionStarted;
  }, [sessionStarted]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flaggedQuestions, setFlaggedQuestions] = useState<number[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  /** Internet bor, lekin Socket.io (proktor/realtime) ulanmagan yoki uzilgan. */
  const [realtimeSyncOffline, setRealtimeSyncOffline] = useState(false);
  const [realtimeBannerDismissed, setRealtimeBannerDismissed] = useState(false);
  const [banned, setBanned] = useState(false);
  const [timeLeft, setTimeLeft] = useState(() =>
    initialExam.startedAt && initialExam.sessionKey
      ? initialSecondsLeft(initialExam)
      : initialExam.duration_minutes * 60,
  );
  const [showTimeWarning, setShowTimeWarning] = useState(false);
  /** Ogohlantirish bosqichi 1–3 (serverdagi warn_types soni; ban 4-chi hodisada). */
  const [strikeLevel, setStrikeLevel] = useState(0);
  // Umumiy ogohlantirish/xato xabarlari — navbat (queue) bilan.
  // Rasmiy ogohlantirish yoki ban modali ochiq bo'lsa, bu xabarlar orqada yashiringan
  // bo'lardi (ikkalasi ham ekran markazida) va taymer ular ko'rinmasdan turib
  // tugab, xabar yo'qolib ketardi. Shu sabab: navbatdagi birinchi xabar faqat
  // boshqa bloklovchi modal yo'q paytda "faol" hisoblanadi va o'shanda taymer boshlanadi.
  const [warningQueue, setWarningQueue] = useState<{ id: number; text: string; duration: number }[]>([]);
  const warningIdRef = useRef(0);
  const showWarningMsg = useCallback((text: string, duration = 5000) => {
    const id = ++warningIdRef.current;
    setWarningQueue((q) => [...q, { id, text, duration }]);
  }, []);
  const dismissWarningMsg = useCallback((id: number) => {
    setWarningQueue((q) => q.filter((m) => m.id !== id));
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [hardBlocked, setHardBlocked] = useState(false);
  const [banPdfBusy, setBanPdfBusy] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealMsg, setAppealMsg] = useState('');
  const [myAppeals, setMyAppeals] = useState<Array<{
    id: number;
    exam_id?: number;
    status: string;
    reason: string;
    created_at?: string | null;
    review_note?: string | null;
  }>>([]);
  /** Admin ban yechganda — "Davom etish" tugmasi chiqadi (WebSocket yoki polling). */
  const [unblockReady, setUnblockReady] = useState(false);
  /** Qoidabuzarlik limiti — avtomatik qayta topshirish (ban emas). */
  const [examRetakeNotice, setExamRetakeNotice] = useState<{
    remaining: number;
    used: number;
    reason: string;
    identityRetake?: boolean;
  } | null>(null);
  /** BAN paytida serverdagi jami violation yozuvlari (3 ta "!" o'rniga) */
  const [banViolationsCount, setBanViolationsCount] = useState<number | null>(null);
  const [banLastReason, setBanLastReason] = useState<string | null>(null);
  const [banReasonCode, setBanReasonCode] = useState<string | null>(null);
  const [warningHistory, setWarningHistory] = useState<WarningHistoryItem[]>([]);

  /**
   * Ogohlantirishlar ro'yxatiga yozuv qo'shish — YAGONA joy.
   *
   * Ilgari uchta chaqiruv joyi bor edi va HAR BIRIDA boshqacha dublikat
   * tekshiruvi yozilgandi. Retake yo'lidagi shart (`reason === ... && number ===
   * prev.length`) noto'g'ri edi: bir xil turdagi qoidabuzarlik takrorlansa
   * (masalan ikki marta "yuzingizni burmang") yangi yozuv umuman qo'shilmasdi,
   * ustiga raqam `prev.length + 1` bilan berilib boshqa oqim qo'ygan raqamlar
   * bilan to'qnashardi.
   *
   * Endi qoida bitta: raqam bo'yicha dublikat tekshiriladi, tartib saqlanadi.
   * Raqam berilmasa — ro'yxatdagi eng kattasidan keyingisi olinadi.
   */
  const pushWarningHistory = useCallback((reason: string, number?: number) => {
    const text = String(reason || '').trim();
    if (!text) return;
    setWarningHistory((prev) => {
      const num = typeof number === 'number' && number > 0
        ? number
        : prev.reduce((mx, w) => Math.max(mx, w.number), 0) + 1;
      if (prev.some((w) => w.number === num)) return prev;
      return [...prev, { number: num, reason: text }].sort((a, b) => a.number - b.number);
    });
  }, []);
  // Ogohlantirish modal
  const [violationWarning, setViolationWarning] = useState<ViolationWarning | null>(null);
  // Modal ochiqligida yangi violationlar serverga yuborilmasin
  const warningModalShowingRef = useRef(false);
  // Modal yopilgandan keyingi qisqa "nafas olish" oynasi — davom etayotgan real muammo
  // (masalan xonadagi shovqin, kamera burchagi) talaba modalni yopgan zahoti yana
  // darhol yangi ogohlantirish/strike bermasin, tuzatishga vaqt bersin.
  const postWarningGraceUntilRef = useRef(0);
  /** Kamera oqimi video elementga ulangach +1 (async setup va ref vaqti sinxroni). */
  const [proctorStreamRevision, setProctorStreamRevision] = useState(0);
  const [faceStatus, setFaceStatus] = useState<FaceStatusLive>('WAITING');
  const faceStatusRef = useRef<FaceStatusLive>('WAITING');
  /** Kamera panelida ko'rsatiladigan kichik ogohlantirish yorlig'i — signal faol bo'lgan
   *  davrda ko'rinib turadi, signal to'xtasa yashiriladi. 5s uzluksiz davom etsa mavjud
   *  logViolation oqimi rasmiy ogohlantirish modalini ochadi. */
  const [liveSignalLabel, setLiveSignalLabel] = useState<string | null>(null);
  /** Event/tab-manba qoidabuzarliklari (print-screen, clipboard, devtools, tab) uchun
   *  kichik yorliq — video/audio dan alohida qatorda. */
  const [eventLiveLabel, setEventLiveLabel] = useState<string | null>(null);

  // --- Kichik ogohlantirish MODALI ---
  // Chip (jonli holat) o'z holicha qoladi; ustiga talaba tasdiqlashi uchun TO'LIQ
  // BLOKLOVCHI modal chiqadi (rasmiy ogohlantirish bilan bir xil dizayn/xulq —
  // orqada imtihonni davom ettirib bo'lmaydi, faqat "Tushundim" bosgandan keyin).
  // Modal OCHIQ turganda nazorat "muzlaydi": o'sha vaqtda qilingan qoidabuzarliklar
  // hisoblanmaydi (strike/sanoq/rasmiy — hech biri). Talaba "Tushundim" bossa yoki
  // SMALL_WARN_AUTOCLOSE_MS o'tsa — davom etadi.
  const [smallWarn, setSmallWarn] = useState<{ text: string; count: number } | null>(null);
  /** Nazorat muzlaganmi (modal ochiqmi) — loop/callbacklar bir zumda o'qishi uchun ref. */
  const smallWarnOpenRef = useRef(false);
  /** Oxirgi ko'rsatilgan signal kaliti — o'sha signal grace ichida qayta ochmasin. */
  const smallWarnKeyRef = useRef<string | null>(null);
  const smallWarnGraceRef = useRef(0);
  const smallWarnAutoCloseRef = useRef<number | null>(null);

  const dismissSmallWarn = useCallback(() => {
    if (smallWarnAutoCloseRef.current !== null) {
      clearTimeout(smallWarnAutoCloseRef.current);
      smallWarnAutoCloseRef.current = null;
    }
    smallWarnOpenRef.current = false;
    smallWarnGraceRef.current = Date.now() + SMALL_WARN_GRACE_MS;
    // Muzlatilgan vaqtda to'plangan davomiylik dismissdan keyin darrov rasmiyga
    // aylanmasligi uchun audio trackerlarni yangidan boshlaymiz (video engine va
    // event gate grace-oynasi bilan o'zi tiklanadi).
    speechContinuousRef.current?.reset();
    ambientContinuousRef.current?.reset();
    micDownContinuousRef.current?.reset();
    setSmallWarn(null);
  }, []);

  /**
   * Kichik ogohlantirish modalini ochadi (bitta modal + grace bilan spam oldini oladi).
   * @param graceKey shovqin manbasi + tur bo'yicha kalit (masalan `v:TALKING`) — spam nazorati uchun.
   * @param violationType rasmiy violation turi (SmallWarningLedger kaliti bilan bir xil) — hisob shu bo'yicha.
   */
  const showSmallWarn = useCallback(
    (graceKey: string, violationType: string, text: string) => {
      if (smallWarnOpenRef.current) return; // bitta modal — biri ochiq bo'lsa yangisi kutadi
      if (graceKey === smallWarnKeyRef.current && Date.now() < smallWarnGraceRef.current) return;
      smallWarnKeyRef.current = graceKey;
      smallWarnOpenRef.current = true;
      const count = smallWarningLedgerRef.current.count(violationType);
      setSmallWarn({ text, count });
      // Suiiste'molga qarshi: talaba bosmasa ham o'zi yopiladi (nazorat davom etsin).
      smallWarnAutoCloseRef.current = window.setTimeout(dismissSmallWarn, SMALL_WARN_AUTOCLOSE_MS);
    },
    [dismissSmallWarn],
  );
  /** Loop/callbacklar eng yangi funksiyani ishlatishi uchun ref. */
  const showSmallWarnRef = useRef(showSmallWarn);
  showSmallWarnRef.current = showSmallWarn;

  // Rasmiy ogohlantirish yoki ban chiqsa — kichik modalni yopamiz (ular ustunroq
  // va o'zi bloklaydi; kichik modal ostida qolib ketmasin, muzlash ham tugasin).
  useEffect(() => {
    if ((violationWarning || banned) && smallWarnOpenRef.current) dismissSmallWarn();
  }, [violationWarning, banned, dismissSmallWarn]);
  // Unmount'da avto-yopilish taymerini tozalash.
  useEffect(() => () => {
    if (smallWarnAutoCloseRef.current !== null) clearTimeout(smallWarnAutoCloseRef.current);
  }, []);
  /** Barcha event/tab-manba qoidabuzarliklarini yagona 1.5s→4s qonuni bilan boshqaradi. */
  const eventGateRef = useRef<ViolationGate | null>(null);
  const [identityStatus, setIdentityStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const identityStatusTimerRef = useRef<number | null>(null);
  const [proctorRetryNonce, setProctorRetryNonce] = useState(0);
  const [cameraPreviewOk, setCameraPreviewOk] = useState(false);
  const [micReady, setMicReady] = useState(false);
  /** Bir marta ochilgach, mid-exam media qayta urinishida savollarni yashirmaymiz. */
  const [startMediaGateDone, setStartMediaGateDone] = useState(false);
  const [cameraErrorHint, setCameraErrorHint] = useState('');
  const vacStateRef = useRef({
    seq: Number(exam.sessionSeqStart || 1),
    challengeSeed: exam.sessionChallenge as string | undefined,
  });

  const proctorMediaReady = cameraPreviewOk && micReady && !cameraErrorHint;

  /**
   * Kamera/mikrofon imtihon O'RTASIDA uzilib qolsa savollar QAYTA yopiladi.
   *
   * Ilgari `startMediaGateDone` bir tomonlama latch edi: bir marta ochilgach
   * media butunlay uzilsa ham savollar ochiq qolaverardi — ya'ni talaba
   * kamerasiz imtihon topshirishda davom eta olardi va proktorlik ko'r bo'lib
   * qolardi.
   *
   * Qisqa uzilish (kamera bir zumga qotdi, qurilma qayta ulandi) darvozani
   * yopmasin deb kechikish bor — faqat uzluksiz uzilish hisoblanadi.
   */
  const [mediaLostSustained, setMediaLostSustained] = useState(false);

  useEffect(() => {
    if (!sessionStarted || banned || !startMediaGateDone) return;
    if (proctorMediaReady) {
      setMediaLostSustained(false);
      return;
    }
    const id = window.setTimeout(() => setMediaLostSustained(true), MEDIA_LOSS_RELOCK_MS);
    return () => window.clearTimeout(id);
  }, [sessionStarted, banned, startMediaGateDone, proctorMediaReady]);

  /**
   * Real-time engine (MediaPipe) yuklandimi. `onReady` dan keladi.
   * Imtihon SHU tayyor bo'lmaguncha ochilmaydi — aks holda talaba nazoratsiz
   * javob bera boshlardi va buni hech kim sezmasdi.
   */
  const [realtimeEngineReady, setRealtimeEngineReady] = useState(false);

  /** Engine talab qilinsinmi. Xavfsizlik klapani: `VITE_REQUIRE_REALTIME_ENGINE=0`
   *  bo'lsa eski xulq (engine kutilmaydi) — engine hech qachon yuklanmaydigan
   *  qurilma imtihonni butunlay bloklab qo'ymasin. Default: TALAB QILINADI. */
  const requireRealtimeEngine =
    String((import.meta as any).env?.VITE_REQUIRE_REALTIME_ENGINE || '') !== '0';
  const engineRequirementMet = !requireRealtimeEngine || realtimeEngineReady;

  const questionsUnlocked =
    engineRequirementMet && (proctorMediaReady || (startMediaGateDone && !mediaLostSustained));
  const showExamMediaGate = Boolean(sessionStarted && !banned && !questionsUnlocked);

  useEffect(() => {
    if (!sessionStarted || banned) return;
    if (proctorMediaReady) setStartMediaGateDone(true);
  }, [sessionStarted, banned, proctorMediaReady]);

  /** Kamera/mikrofon kutish ekrani cho'zilib ketdi — qo'lda "Qayta urinish" beriladi. */
  const [mediaGateSlow, setMediaGateSlow] = useState(false);

  // getUserMedia osilib qolsa — cheksiz spinner o'rniga qayta urinish.
  // Ikki bosqich: 6s — talabaning O'ZI qayta urinishi mumkin (kamera band bo'lib
  // qolgan, USB kamera ulanmagan — bularni faqat talaba hal qiladi); 20s — to'liq
  // xato ekrani (ilgari 45s edi: imtihon vaqti ketaverardi va talaba nima
  // qilishni bilmay o'tirardi).
  useEffect(() => {
    if (!showExamMediaGate || cameraErrorHint) {
      setMediaGateSlow(false);
      return;
    }
    const slowId = window.setTimeout(() => setMediaGateSlow(true), 6_000);
    const failId = window.setTimeout(() => {
      setCameraErrorHint(translations[lang].preExamMediaInUse);
    }, 20_000);
    return () => {
      window.clearTimeout(slowId);
      window.clearTimeout(failId);
    };
  }, [showExamMediaGate, cameraErrorHint, lang]);

  const syncMicReadyFromStream = useCallback((stream: MediaStream | null | undefined) => {
    const tracks = stream?.getAudioTracks?.() ?? [];
    const live = tracks.some((t) => t.readyState === 'live' && t.enabled);
    setMicReady(live);
    return live;
  }, []);
  useEffect(() => {
    vacStateRef.current = {
      seq: Number(exam.sessionSeqStart || 1),
      challengeSeed: exam.sessionChallenge,
    };
  }, [exam.sessionSeqStart, exam.sessionChallenge, exam.id]);

  const syncVacIfOk = (res: Response) => {
    syncVacFromResponse(res.headers, vacStateRef.current);
  };

  const nextGuardHeaders = useCallback(
    async (method: string, path: string, body?: string) =>
      buildGuardedExamHeaders({
        body,
        token,
        examId: exam.id,
        studentExamId,
        studentId: String(user.id),
        sessionKey: exam.sessionKey,
        challengeSeed: vacStateRef.current.challengeSeed,
        seq: vacStateRef.current.seq,
        method,
        path,
        lang,
      }),
    [token, exam.id, exam.sessionKey, studentExamId, user.id, lang],
  );

  /**
   * Brauzerdagi proctoring engine holatini SERVER LOGIGA yuboradi.
   *
   * Nega kerak: engine yiqilsa xato faqat talaba brauzerining konsolida qolardi,
   * ustiga production build `console.warn/info` ni butunlay olib tashlaydi
   * (`vite.config.ts` `pure_funcs`) — ya'ni sabab hech qayerda ko'rinmasdi.
   * Endi u `docker compose logs` da chiqadi: [PROCTOR-DIAG].
   *
   * Yuborish o'zi hech qachon imtihonni buzmasin — xatolari yutiladi.
   */
  const sentDiagRef = useRef(new Set<string>());
  const reportProctorDiag = useCallback(
    async (stage: string, ok: boolean, detail?: string) => {
      const key = `${stage}:${ok}:${detail || ''}`;
      if (sentDiagRef.current.has(key)) return; // takror yubormaymiz
      sentDiagRef.current.add(key);
      const path = '/api/student/proctor-diagnostics';
      try {
        // Muhit surati — nosozlik faqat ayrim mashinalarda uchraydi va bu
        // ma'lumotsiz sababni topib bo'lmaydi (qaysi brauzer, SIMD bormi,
        // qancha xotira). Shaxsiy ma'lumot yo'q.
        const nav = navigator as any;
        let simd = 'unknown';
        try {
          // WebAssembly SIMD qo'llab-quvvatlanadimi — MediaPipe shunga qarab
          // `vision_wasm_internal` yoki `nosimd` variantini tanlaydi.
          simd = String(
            WebAssembly.validate(
              new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
            ),
          );
        } catch {
          simd = 'error';
        }
        const env = [
          `ua=${(navigator.userAgent || '').slice(0, 120)}`,
          `simd=${simd}`,
          `cores=${nav.hardwareConcurrency ?? '?'}`,
          `mem=${nav.deviceMemory ?? '?'}`,
          `isolated=${typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : '?'}`,
        ].join(' ');
        const diagBody = JSON.stringify({
          stage, ok, detail: detail || '', env, exam_id: exam.id,
        });
        await fetch(apiUrl(path), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await nextGuardHeaders('POST', path, diagBody)),
          },
          body: diagBody,
        });
      } catch {
        /* diagnostika imtihonga xalaqit bermasin */
      }
    },
    [nextGuardHeaders, exam.id],
  );


  /**
   * Barcha VAC-imzoli imtihon so'rovlari SHU navbat orqali serializatsiya qilinadi.
   * Server bitta monoton `session_request_seq`ni talab qiladi (prod'da VAC_SEQ_GUARD
   * default yoqilgan) — parallel timerlar (identity 3s, proctor 20s, autosave, clock,
   * submit) bir vaqtda so'rov yuborsa, ular bitta seq bilan to'qnashib 403 VAC_SEQ_RACE
   * oladi. Promise-zanjir mutex har bir guarded so'rovni ketma-ket (seq tartibida)
   * o'tkazadi: header qurish → fetch → javob seq/challenge sinxronlash — atomik.
   * Har so'rov qisqa; poll'lar orasidagi kutishlar navbatdan tashqarida, HOL blok yo'q.
   * AbortController timeout osilib qolgan so'rov butun imtihonni bloklamasligi uchun.
   */
  const vacChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const guardedFetch = useCallback(
    (method: string, path: string, init?: RequestInit): Promise<Response> => {
      const run = async (): Promise<Response> => {
        const ac = new AbortController();
        const timeoutMs = method.toUpperCase() === 'POST' ? 30_000 : 20_000;
        const timer = window.setTimeout(() => ac.abort(), timeoutMs);
        try {
          const rawBody = typeof init?.body === 'string' ? init.body : '';
          const headers = {
            ...((init?.headers as Record<string, string> | undefined) || {}),
            ...(await nextGuardHeaders(method, path, rawBody)),
          };
          const res = await fetch(apiUrl(path), { ...init, method, headers, signal: ac.signal });
          syncVacFromResponse(res.headers, vacStateRef.current);
          return res;
        } finally {
          window.clearTimeout(timer);
        }
      };
      const p = vacChainRef.current.then(run, run);
      // Zanjir xato bo'lsa ham uzilmasin (keyingi so'rovlar davom etsin).
      vacChainRef.current = p.then(
        () => undefined,
        () => undefined,
      );
      return p;
    },
    [nextGuardHeaders],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/student/proctor-config'), { headers: examAuthHeaders(token) })
      .then(async (res) => {
        const data = await readJsonSafe<{ max_warnings_before_ban?: number }>(res);
        if (!cancelled && res.ok && typeof data?.max_warnings_before_ban === 'number') {
          setMaxOfficialWarnings(Math.max(1, data.max_warnings_before_ban));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!sessionStarted) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/draft`), {
          headers: await nextGuardHeaders('GET', `/api/student/exams/${exam.id}/draft`),
        });
        syncVacIfOk(res);
        const data = await readJsonSafe<{
          answers?: Record<string, string>;
          flaggedQuestions?: number[];
          updated_at?: string | null;
        }>(res);
        if (!res.ok || cancelled) return;
        const localRaw = safeLocalGet(`exam_answers_${exam.id}`);
        const localAns = sanitizeExamAnswers(examQuestions, parseAnswersJson(localRaw));
        const srv = sanitizeExamAnswers(
          examQuestions,
          (data.answers && typeof data.answers === 'object' ? data.answers : {}) as Record<string, string>,
        );
        const merged = { ...srv, ...localAns };
        if (Object.keys(merged).length > 0) setAnswers(merged);
        if (Array.isArray(data.flaggedQuestions) && data.flaggedQuestions.length > 0) {
          setFlaggedQuestions(data.flaggedQuestions);
        }
      } catch {
        const saved = safeLocalGet(`exam_answers_${exam.id}`);
        if (saved && !cancelled) {
          setAnswers(sanitizeExamAnswers(examQuestions, parseAnswersJson(saved)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exam.id, token, nextGuardHeaders, examQuestions, sessionStarted]);

  useEffect(() => {
    safeLocalSet(`exam_answers_${exam.id}`, JSON.stringify(answers));
    safeLocalSet(`exam_answers_ts_${exam.id}`, String(Date.now()));
  }, [answers, exam.id]);

  /** Serverga oxirgi muvaffaqiyatli saqlash vaqti — maksimal kutish uchun. */
  const lastSavedAtRef = useRef(Date.now());

  const saveProgressNow = useCallback(
    async (ans: Record<string, string>, fl: number[]) => {
      const body = JSON.stringify({
        answers: ans,
        flaggedQuestions: fl,
        timings: buildTimings(qTimingRef.current, qShownRef.current),
      });
      const attempt = async (n: number): Promise<void> => {
        try {
          const r = await fetch(apiUrl(`/api/student/exams/${exam.id}/save-progress`), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(await nextGuardHeaders(
                'POST', `/api/student/exams/${exam.id}/save-progress`, body,
              )),
            },
            body,
          });
          syncVacIfOk(r);
          if (r.ok) {
            lastSavedAtRef.current = Date.now();
            return;
          }
          if (n < 2 && (r.status >= 500 || r.status === 429)) {
            await new Promise((res) => setTimeout(res, 800 * (n + 1)));
            return attempt(n + 1);
          }
        } catch {
          if (n < 2) {
            await new Promise((res) => setTimeout(res, 800 * (n + 1)));
            return attempt(n + 1);
          }
        }
      };
      await attempt(0);
    },
    [exam.id, nextGuardHeaders],
  );

  // Qoralamani serverga saqlash.
  //
  // MUHIM: ilgari bu SOF debounce edi (har javobda taymer bekor qilinardi).
  // Talaba har 20 soniyada javob belgilab tursa, serverga HECH QACHON
  // saqlanmasdi — faqat u 22 soniya to'xtaganda. Brauzer qulasa yoki qurilma
  // almashsa, server qoralamasi juda eski bo'lib, avto-yakunlashda ball
  // yo'qolardi. Endi MAKSIMAL KUTISH chegarasi bor: oxirgi saqlashdan
  // AUTOSAVE_MAX_WAIT_MS o'tgan bo'lsa, debounce kutilmaydi.
  useEffect(() => {
    if (banned || !sessionStarted) return;
    const overdue = Date.now() - lastSavedAtRef.current >= AUTOSAVE_MAX_WAIT_MS;
    const delay = overdue ? 0 : AUTOSAVE_DEBOUNCE_MS;
    const id = window.setTimeout(() => {
      void saveProgressNow(answersRef.current, flaggedRef.current);
    }, delay);
    return () => clearTimeout(id);
  }, [answers, flaggedQuestions, banned, sessionStarted, saveProgressNow]);

  // Talaba javob bermay uzoq o'tirsa ham (o'qib turibdi) qoralama eskirmasin.
  useEffect(() => {
    if (banned || !sessionStarted) return;
    const id = window.setInterval(() => {
      if (Date.now() - lastSavedAtRef.current < AUTOSAVE_MAX_WAIT_MS) return;
      void saveProgressNow(answersRef.current, flaggedRef.current);
    }, 10_000);
    return () => clearInterval(id);
  }, [banned, sessionStarted, saveProgressNow]);

  // Sahifa yopilishi/yashirilishi — oxirgi holatni ulgurgancha jo'natamiz.
  useEffect(() => {
    if (banned || !sessionStarted) return;
    const flush = () => {
      if (submittingRef.current) return;
      void saveProgressNow(answersRef.current, flaggedRef.current);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
    };
  }, [banned, sessionStarted, saveProgressNow]);

  useEffect(() => {
    if (banned) return;
    const sync = async () => {
      try {
        const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/clock`), {
          headers: await nextGuardHeaders('GET', `/api/student/exams/${exam.id}/clock`),
        });
        syncVacIfOk(res);
        const data = await readJsonSafe<{
          seconds_remaining?: number;
          proctorFeedLost?: boolean;
          code?: string;
          sessionStatus?: string;
          banReason?: string;
        }>(res);
        if (!res.ok && data.code === 'NO_ACTIVE_SESSION' && data.sessionStatus) {
          sessionGoneRef.current(data.sessionStatus, data.banReason);
          return;
        }
        if (res.ok && typeof data.seconds_remaining === 'number') {
          setTimeLeft((prev) => {
            const srv = data.seconds_remaining ?? 0;
            // Server — YAGONA haqiqat manbai. Ilgari faqat 120s'dan katta farq
            // tuzatilardi: talaba brauzer taymerini sekinlashtirib (fon tab,
            // devtools throttling, tizim soatini o'zgartirish) deyarli 2
            // daqiqa qo'shimcha vaqt yutishi mumkin edi. Endi tolerans 5s —
            // faqat tarmoq kechikishi/yaxlitlash uchun.
            if (Math.abs(srv - prev) > 5) return srv;
            return prev;
          });
        }
        // Liveness: server nazorat kadrlari to'xtaganini aniqladi.
        if (res.ok && data.proctorFeedLost) {
          void logViolationRef.current('PROCTOR_FEED_LOST');
        }
      } catch {
        /* ignore */
      }
    };
    sync();
    // 45s → 20s: taymer serverga tez-tez tekshirilsin (klient taymerini
    // sekinlashtirish orqali vaqt yutish oynasi qisqarsin).
    const iv = window.setInterval(sync, 20000);
    return () => clearInterval(iv);
  }, [exam.id, token, banned, nextGuardHeaders]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t.leaveExamWarning;
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [t.leaveExamWarning]);

  // Fullscreen kirish vaqtini kuzatish (blur/fullscreenchange false positive oldini olish)
  const fullscreenRequestedRef = useRef(false);
  const blurIgnoreUntilRef = useRef(0); // timestamp: shu vaqtgacha blur ignore qilinadi
  /** Modal/ogohlantirish fullscreen'dan chiqarishi — buni qoidabuzarlik deb hisoblamaymiz */
  const fullscreenSuppressRef = useRef(false);
  const needsFullscreenRef = useRef(false);
  /** Bloklovchi qoplama ko'rsatilsinmi (render uchun). */
  const [needsFullscreen, setNeedsFullscreen] = useState(false);

  /**
   * Nazorat MOTORLARI ishga tushishi mumkinmi.
   *
   * `!needsFullscreen` SHART: ilgari motorlar sessiya boshlanishi bilan
   * ishga tushardi va talaba hali to'liq ekranga o'tmagan bo'lsa ham ovoz/nigoh
   * ogohlantirishlari to'liq-ekran qoplamasi USTIGA chiqib kelardi. Endi
   * nazorat faqat talaba haqiqatan to'liq ekranga o'tgach boshlanadi.
   */
  const proctorEnginesArmed = Boolean(
    sessionStarted && !banned && !needsFullscreen && proctorMediaReady,
  );


  /** Imtihon HAQIQATAN boshlandi: fullscreen'da, media tayyor, engine yuklangan. */
  const examArmed = Boolean(proctorEnginesArmed && engineRequirementMet);

  /** Bu sessiyada fullscreen'ga kamida bir marta kirilganmi — qoplama matnini
   *  tanlaydi (birinchi kirish "boshlash", keyingilari "qayting"). */
  const [fullscreenEverEntered, setFullscreenEverEntered] = useState(false);
  const fullscreenEverEnteredRef = useRef(false);
  /** Fullscreen'dan chiqilgan payt — uzoq turib qolsa rasmiy qoidabuzarlik. */
  const fullscreenLeftAtRef = useRef<number | null>(null);
  /** Qoplamada ko'rinadigan sanoq (soniya). */
  const [fullscreenGraceLeft, setFullscreenGraceLeft] = useState(FULLSCREEN_GRACE_MS / 1000);


  // ── Tab/oyna almashtirish nazorati: "qurollangan" holat ──────────────────
  // MUAMMO: fullscreen'ga kirish/chiqishda brauzer (ayniqsa Linux oyna
  // menejerlarida) blur → visibilitychange → fullscreenchange → focus
  // hodisalarini TURLI TARTIBDA yuboradi. Ilgari har bir hodisa alohida
  // tekshiruvlar bilan filtrlanardi va bitta tartib kombinatsiyasi baribir
  // o'tib ketardi: "Butun ekran talab qilinadi" modali chiqishi bilan bir
  // vaqtda "Boshqa oynaga o'tildi" ogohlantirishi ham chiqardi.
  //
  // YECHIM: hodisalarni birma-bir filtrlash o'rniga bitta invariant —
  // TAB nazorati faqat imtihon BARQAROR holatda (sessiya ochiq + fullscreen
  // ichida + gate yopiq + modal yo'q + oyna fokusda) uzluksiz
  // TAB_GUARD_ARM_MS turgandan keyin yoqiladi. Fullscreen yo'qolishi bilan
  // darhol o'chadi. Shuning uchun o'tish paytidagi hodisalar tartibi qanday
  // bo'lishidan qat'i nazar qoidabuzarlik yozilmaydi.
  // Mantiq `lib/tabSwitchGuard.ts` da — u yerda unit testlar bilan qoplangan.
  const tabGuardRef = useRef<TabSwitchGuard>(new TabSwitchGuard(TAB_GUARD_ARM_MS));

  /** Nazoratni darhol o'chiradi va to'plangan "ketgan vaqt" hisobini tozalaydi. */
  const disarmTabGuard = useCallback(() => {
    tabGuardRef.current.disarm();
    eventGateRef.current?.reset('TAB_SWITCH_HARD');
  }, []);

  const getFullscreenElement = useCallback((): Element | null => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      msFullscreenElement?: Element | null;
    };
    return doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement || null;
  }, []);

  const fullscreenSupportedRef = useRef(
    typeof document !== 'undefined' &&
      !!(
        document.documentElement.requestFullscreen ||
        (document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> })
          .webkitRequestFullscreen
      ),
  );

  const requestExamFullscreen = useCallback(() => {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
      msRequestFullscreen?: () => Promise<void> | void;
    };
    if (getFullscreenElement()) return;
    const req =
      el.requestFullscreen?.bind(el) ||
      el.webkitRequestFullscreen?.bind(el) ||
      el.msRequestFullscreen?.bind(el);
    if (!req) return;
    fullscreenRequestedRef.current = true;
    fullscreenSuppressRef.current = true;
    // FS so'rovi/kirishida brauzer blur/focus beradi — TAB_SWITCH false positive.
    disarmTabGuard();
    blurIgnoreUntilRef.current = Date.now() + 8000;
    Promise.resolve(req())
      .then(() => {
        fullscreenRequestedRef.current = false;
        fullscreenSuppressRef.current = false;
        needsFullscreenRef.current = false;
        setNeedsFullscreen(false);
        fullscreenLeftAtRef.current = null;
        // Kirdik — lekin nazorat darhol yoqilmaydi: barqarorlik hisoblagichi
        // (TAB_GUARD_ARM_MS) o'tgach o'zi yoqiladi.
        disarmTabGuard();
        blurIgnoreUntilRef.current = Date.now() + 8000;
      })
      .catch(() => {
        fullscreenRequestedRef.current = false;
        fullscreenSuppressRef.current = false;
        disarmTabGuard();
        blurIgnoreUntilRef.current = Date.now() + 8000;
        // Sessiya boshlangan bo'lsa — tugma orqali qayta urinish uchun gate.
        if (sessionStartedRef.current) {
          needsFullscreenRef.current = true;
          setNeedsFullscreen(true);
          if (fullscreenLeftAtRef.current == null) fullscreenLeftAtRef.current = Date.now();
        }
      });
  }, [getFullscreenElement]);

  useEffect(() => {
    if (!fullscreenSupportedRef.current) return;

    const onFullscreenChange = () => {
      // Har qanday fullscreen o'zgarishi — nazorat darhol o'chadi va faqat
      // barqarorlik oynasidan keyin qayta yoqiladi. Hodisalar tartibi
      // (blur/visibility/fullscreenchange) brauzerga bog'liq bo'lgani uchun
      // bu yagona ishonchli himoya.
      disarmTabGuard();
      if (getFullscreenElement()) {
        // Kirishdan keyin ham blur/focus kelishi mumkin — TAB deb yozilmasin.
        blurIgnoreUntilRef.current = Date.now() + 8000;
        fullscreenRequestedRef.current = false;
        fullscreenSuppressRef.current = false;
        needsFullscreenRef.current = false;
        setNeedsFullscreen(false);
        fullscreenLeftAtRef.current = null;
        fullscreenEverEnteredRef.current = true;
        setFullscreenEverEntered(true);
        return;
      }

      // Sessiya boshlanmagan — gate kerak emas.
      if (!sessionStartedRef.current || bannedRef.current) return;

      // Ogohlantirish modallari ba'zan FS dan chiqaradi — buni jazalamaymiz,
      // lekin watchdog keyinroq qayta gate ochadi.
      if (fullscreenSuppressRef.current || warningModalShowingRef.current) {
        return;
      }

      // Chiqish → faqat majburiy gate (rasmiy ogohlantirish/strike YO'Q).
      // Aks holda "Butun ekran talab qilinadi" bilan birga "1-ogohlantirish" chiqardi.
      // Brauzer FS chiqishida blur/visibility ham beradi — TAB_SWITCH yozilmasin.
      // Muhim: blur ba'zan fullscreenchange DAN OLDIN keladi — nazorat
      // yuqorida allaqachon o'chirilgan, shu sabab tartib ahamiyatsiz.
      blurIgnoreUntilRef.current = Date.now() + 8000;
      needsFullscreenRef.current = true;
      setNeedsFullscreen(true);
      if (fullscreenLeftAtRef.current == null) fullscreenLeftAtRef.current = Date.now();
    };

    onFullscreenChange();
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
    };
  }, [getFullscreenElement]);

  // Watchdog: sessiya ochiq, lekin fullscreen yo'q → gate (brauzer gesture'siz
  // requestFullscreen qilolmaydi — shu sabab faqat UI bloklanadi).
  useEffect(() => {
    if (!sessionStarted || banned || !fullscreenSupportedRef.current) return;
    const tick = () => {
      if (bannedRef.current || !sessionStartedRef.current) return;
      if (fullscreenSuppressRef.current || warningModalShowingRef.current) return;
      if (getFullscreenElement()) {
        if (needsFullscreenRef.current) {
          needsFullscreenRef.current = false;
          setNeedsFullscreen(false);
          fullscreenLeftAtRef.current = null;
        }
        return;
      }
      if (!needsFullscreenRef.current) {
        disarmTabGuard();
        blurIgnoreUntilRef.current = Date.now() + 8000;
        needsFullscreenRef.current = true;
        setNeedsFullscreen(true);
        if (fullscreenLeftAtRef.current == null) fullscreenLeftAtRef.current = Date.now();
      }
    };
    tick();
    const id = window.setInterval(tick, 1200);
    return () => clearInterval(id);
  }, [sessionStarted, banned, getFullscreenElement, disarmTabGuard]);

  // Tab-nazoratini qurollash: imtihon barqaror holatda uzluksiz TAB_GUARD_ARM_MS
  // turgandagina yoqiladi. Har qanday chetlanish (fullscreen yo'q, gate ochiq,
  // modal ochiq, fokus yo'q) hisoblagichni noldan boshlatadi.
  //
  // MUHIM: "ko'rinmayapti" (visibilityState === 'hidden') holati bu yerda
  // BARQARORLIKNI buzmaydi — aynan o'sha holat aniqlanadigan signal. Qurollash
  // esa faqat talaba ekran oldida (visible + fokusda) bo'lganda boshlanadi.
  useEffect(() => {
    if (!sessionStarted || banned) {
      disarmTabGuard();
      return;
    }
    const evaluate = () => {
      const wasArmed = tabGuardRef.current.armed;
      const nowArmed = tabGuardRef.current.evaluate(
        {
          sessionStarted: sessionStartedRef.current,
          banned: bannedRef.current,
          fullscreenSuppressed: fullscreenSuppressRef.current,
          fullscreenRequestInFlight: fullscreenRequestedRef.current,
          warningModalOpen: warningModalShowingRef.current,
          smallWarnOpen: smallWarnOpenRef.current,
          present: document.visibilityState === 'visible' && document.hasFocus(),
        },
        Date.now(),
      );
      // Qurol o'chgan bo'lsa — event gate hisobini ham tozalaymiz, aks holda
      // o'chgunga qadar to'plangan davomiylik qayta yoqilganda darhol rasmiyga aylanardi.
      if (wasArmed && !nowArmed) disarmTabGuard();
    };
    evaluate();
    const id = window.setInterval(evaluate, 250);
    return () => {
      clearInterval(id);
      disarmTabGuard();
    };
  }, [sessionStarted, banned, getFullscreenElement, disarmTabGuard]);

  // Fullscreen qoplamasi kuzatuvchisi.
  //
  // Qoplama ochiq turganda boshqa nazorat signallari muzlatiladi (talaba
  // ekranni ko'rmaydi). Bu "bepul to'xtatish" bo'lib qolmasligi uchun:
  // FULLSCREEN_GRACE_MS ichida qaytilmasa RASMIY qoidabuzarlik yoziladi va
  // hisoblagich qayta boshlanadi — ya'ni qoplama ostida o'tirish jazolanadi.
  // Birinchi kirishda (hali fullscreen'ga umuman kirilmagan) jazolanmaydi.
  useEffect(() => {
    if (!sessionStarted || banned) {
      setFullscreenGraceLeft(FULLSCREEN_GRACE_MS / 1000);
      return;
    }
    const tick = () => {
      const leftAt = fullscreenLeftAtRef.current;
      if (!needsFullscreenRef.current || leftAt == null) {
        setFullscreenGraceLeft(FULLSCREEN_GRACE_MS / 1000);
        return;
      }
      const elapsed = Date.now() - leftAt;
      setFullscreenGraceLeft(Math.max(0, Math.ceil((FULLSCREEN_GRACE_MS - elapsed) / 1000)));
      if (elapsed < FULLSCREEN_GRACE_MS) return;
      // Hisoblagichni qayta boshlaymiz — uzoq turib qolsa takror yoziladi.
      fullscreenLeftAtRef.current = Date.now();
      if (!fullscreenEverEnteredRef.current) return; // imtihon boshi — jazo yo'q
      void logViolationRef.current('FULLSCREEN_EXIT_HARD');
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => clearInterval(id);
  }, [sessionStarted, banned]);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    if (/anydesk|teamviewer|rustdesk|splashtop/i.test(ua)) {
      void logViolationRef.current('REMOTE_CONTROL_SUSPECTED');
    }
    if ((navigator as any).webdriver) {
      void logViolationRef.current('REMOTE_CONTROL_SUSPECTED');
    }
    // Eslatma: maxTouchPoints + tor brauzer oynasi (masalan 900px) "mobil" deb noto'g'ri
    // REMOTE_CONTROL yuborardi — Windows sensorli noutbuklar tez-tez ban. Alohida yuborilmaydi.

    // --- Tab almashtirish / alt-tab (boshqa dastur) — HODISA asosida aniqlash ---
    // MUHIM: brauzer fon tabda setInterval/setTimeout'ni muzlatadi, shu sabab faqat
    // polling'ga tayanib bo'lmaydi (talaba boshqa tabga o'tib AI ishlatsa sezilmasdi).
    // Shuning uchun: ketgan vaqtni `visibilitychange`/`blur` da yozamiz, QAYTGANDA
    // (`visible`/`focus`) qancha vaqt ketganini o'lchaymiz. Hodisalar taymer muzlaganda
    // ham ishonchli ishlaydi. Qaytishda darhol rasmiy TAB_SWITCH_HARD yoziladi —
    // "kichik ogohlantirish" bermaymiz, chunki talaba boshqa tabda uni ko'rmaydi.
    // Yagona shart: nazorat qurollanganmi. Barcha holat tekshiruvlari
    // (sessiya/ban/fullscreen/gate/modal/barqarorlik) TabSwitchGuard ichida
    // markazlashgan — shu sabab hodisalar tartibiga bog'liq teshik qolmaydi.
    const markAwayStart = () => tabGuardRef.current.markAway(Date.now());

    const markAwayEnd = () => {
      if (tabGuardRef.current.endAway(Date.now(), TAB_AWAY_VIOLATION_MS)) {
        void logViolationRef.current('TAB_SWITCH_HARD');
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') markAwayStart();
      else markAwayEnd();
    };
    const onWindowBlur = () => markAwayStart();
    const onWindowFocus = () => markAwayEnd();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, []);

  const [qIndex, setQIndex] = useState(0);
  /** "Yakunlash" tugmalari (oxirgi savol + o'ng panel) — tasdiqlash modali. */
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const totalQuestions = examQuestions.length;
  /** Faqat joriy sessiya savollari + bo'sh bo'lmagan javob. Aks holda
   *  localStorage'dagi eski kalitlar answeredCount ni sun'iy oshirib,
   *  Yakunlash erta chiqardi. */
  const answeredCount = examQuestions.reduce((n, q) => {
    const v = answers[String(q.id)];
    return n + (typeof v === 'string' && v.trim() ? 1 : 0);
  }, 0);
  const allAnswered = totalQuestions > 0 && answeredCount >= totalQuestions;
  const progress = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;
  const currentQ = examQuestions[qIndex];
  const currentOptions = React.useMemo(
    () => normalizeQuestionOptions(currentQ?.options),
    [currentQ],
  );
  const currentQParsed = extractQuestionImages(cleanQuestionPrompt(currentQ?.text || ''));
  useEffect(() => {
    const now = Date.now();
    const prev = qShownRef.current;
    if (prev) {
      const r = qTimingRef.current[prev.id] || { ms: 0, first: null, changes: 0 };
      r.ms += Math.max(0, now - prev.at);
      qTimingRef.current[prev.id] = r;
    }
    qShownRef.current = currentQ && sessionStarted ? { id: String(currentQ.id), at: now } : null;
  }, [currentQ?.id, sessionStarted]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const bannedRef = useRef(banned);
  const tokenRef = useRef(token);
  const examIdRef = useRef(exam.id);
  const answersRef = useRef(answers);
  const flaggedRef = useRef(flaggedQuestions);
  const submittingRef = useRef(false);

  /** Bir martalik hodisa (print-screen, clipboard, devtools) — endi darhol rasmiy
   *  YUBORMAYMIZ. Yagona darvozaga (eventGateRef) belgilaymiz: qonun bo'yicha 1.5s
   *  kichik yorliq, 4s uzluksiz takrorlansa rasmiy (tick loop hal qiladi). */
  const markGateEvent = useCallback((type: string) => {
    if (bannedRef.current || !sessionStartedRef.current) return;
    if (!eventGateRef.current) {
      eventGateRef.current = new ViolationGate(LIVE_SIGNAL_CONFIRM_MS, LIVE_SIGNAL_ESCALATE_MS);
    }
    eventGateRef.current.markEvent(type);
  }, []);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  useEffect(() => {
    flaggedRef.current = flaggedQuestions;
  }, [flaggedQuestions]);

  useEffect(() => {
    bannedRef.current = banned;
  }, [banned]);
  useEffect(() => {
    faceStatusRef.current = faceStatus;
  }, [faceStatus]);

  // Ban ekranida WebSocket ishlamasa ham admin yechganda "Davom etish" chiqishi uchun polling.
  useEffect(() => {
    if (!banned || unblockReady) return;
    const pollUnblock = async () => {
      try {
        const res = await fetch(apiUrl('/api/student/exams'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const list = await readJsonSafe<Array<{ id: number; in_progress?: boolean }>>(res);
        const row = Array.isArray(list) ? list.find((e) => e.id === exam.id) : null;
        if (row?.in_progress) setUnblockReady(true);
      } catch {
        /* ignore */
      }
    };
    void pollUnblock();
    const id = window.setInterval(() => void pollUnblock(), 5000);
    return () => clearInterval(id);
  }, [banned, unblockReady, exam.id, token]);

  useEffect(() => {
    if (!banned || !token) return;
    let cancelled = false;
    fetch(apiUrl('/api/student/ban-appeals'), { headers: examAuthHeaders(token) })
      .then(async (res) => {
        const data = await readJsonSafe<typeof myAppeals>(res);
        if (!cancelled && Array.isArray(data)) {
          setMyAppeals(data.filter((a) => a.exam_id === exam.id));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [banned, token, exam.id]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    examIdRef.current = exam.id;
  }, [exam.id]);
  // Til faqat xato xabarlari uchun kerak — ref orqali (effekt dependency'siga qo'shilsa,
  // til almashtirilganda kamera/WebSocket/WebRTC butunlay qayta quriladi → proctoring uziladi).
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** Silero VAD — odam ovozini maishiy shovqindan ajratuvchi asosiy detektor. */
  const sileroRef = useRef<SileroVad | null>(null);
  /** MediaPipe ObjectDetector — telefon/kitob/noutbuk (brauzerda, real-time). */
  const objectProctorRef = useRef<ForbiddenObjectProctor | null>(null);
  const [objectLiveLabel, setObjectLiveLabel] = useState<string | null>(null);
  
  const identityCheckBusyRef = useRef(false);
  const logViolationRef = useRef<(type: string, note?: string) => Promise<void>>(async () => {});
  /** DevTools/clipboard/varaq — bir "urinish"da yuboriladigan bir nechta signal; bittasini yuborish. */
  const focusBurstLockUntilRef = useRef(0);
  const FOCUS_BURST_TYPES = new Set([
    'DEVTOOLS_OPEN',
    'CLIPBOARD_ATTEMPT',
    'TAB_SWITCH_HARD',
    'TAB_SWITCH_SOFT',
  ]);
  /**
   * "3 kichik ogohlantirish → 4-marta rasmiy" qonuni (README.md).
   * Kalit = rasmiy violation turi, shu sabab video/audio/event manbalari bitta
   * hisobga qo'shiladi va turlar aralashib ketmaydi.
   */
  const smallWarningLedgerRef = useRef(new SmallWarningLedger());

  /** Rasmiy ogohlantirish berilgach — shu tur bo'yicha kichik-ogohlantirish hisobi nolga qaytadi. */
  const formalIssuedFor = (violationType: string) => {
    smallWarningLedgerRef.current.formalIssued(violationType);
  };

  /**
   * Kichik ogohlantirish epizodini qayd etadi. Limit to'lgan bo'lsa — darhol rasmiy.
   * @returns shu tur bo'yicha nechanchi kichik ogohlantirish (chip yorlig'ida ko'rsatiladi)
   */
  const noteSmallWarningRef = useRef((violationType: string): number => {
    const ledger = smallWarningLedgerRef.current;
    if (ledger.noteActive(violationType)) {
      formalIssuedFor(violationType);
      void logViolationRef.current(violationType);
      return 0;
    }
    return ledger.count(violationType);
  });

  /**
   * Kichik yorliqqa hisobni qo'shadi: "Gapirmang · 2/3". Talaba nechta kichik
   * ogohlantirish qolganini ko'rib tursin — 3 tadan keyin rasmiy bo'ladi.
   */
  const withSmallCount = (msg: string, violationType: string): string => {
    const n = smallWarningLedgerRef.current.count(violationType);
    return n > 0 ? `${msg} · ${n}/${SMALL_WARNINGS_BEFORE_FORMAL}` : msg;
  };

  const socketRef = useRef<RealtimeSocket | null>(null);
  const peerConnectionsRef = useRef<{ [id: string]: RTCPeerConnection }>({});

  // Kamera/mikrofonni TO'LIQ bo'shatish. Avval faqat track.stop() chaqirilardi —
  // bu haqiqiy uskunani o'chirsa ham, AudioContext ochiq qolgani sababli ba'zi
  // brauzerlarda kamera/mikrofon "band" indikatori yonib turishda davom etardi.
  const releaseCameraAndMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    sileroRef.current?.dispose();
    sileroRef.current = null;
    objectProctorRef.current?.dispose();
    objectProctorRef.current = null;
    setObjectLiveLabel(null);
    stopScreenShare();
  }, []);

  // Imtihon TO'LIQ tugaganda (submit muvaffaqiyatli) — kamera/mikrofondan tashqari
  // WebRTC peer connection va WebSocket'ni ham darhol yopamiz (asosiy effekt cleanup'i
  // faqat komponent unmount bo'lganda yoki `banned` o'zgarganda ishlaydi — muvaffaqiyatli
  // submitdan keyin komponent AnimatePresence exit animatsiyasi davomida bir muddat
  // mount holida qolishi mumkin, shuning uchun bu yerda darhol tozalaymiz).
  // Ban holatida socket ATAYLAB yopilmaydi — admin "unblock" xabari shu orqali kelishi mumkin;
  // uni `banned` o'zgarganda asosiy effekt cleanup'i o'z vaqtida tozalaydi.
  const releaseAllExamResources = useCallback(() => {
    releaseCameraAndMic();
    Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
    peerConnectionsRef.current = {};
    socketRef.current?.destroy();
    socketRef.current = null;
  }, [releaseCameraAndMic]);

  const recoverCameraPreview = useCallback(() => {
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) {
      setProctorRetryNonce((n) => n + 1);
      return;
    }
    if (v.srcObject !== s) v.srcObject = s;
    const vt = s.getVideoTracks()[0];
    if (!vt || vt.readyState !== 'live') {
      setProctorRetryNonce((n) => n + 1);
      return;
    }
    void v
      .play()
      .then(() => {
        setCameraPreviewOk(true);
        if (syncMicReadyFromStream(s)) setCameraErrorHint('');
      })
      .catch(() => {
        setProctorRetryNonce((n) => n + 1);
      });
  }, [syncMicReadyFromStream]);

  const resumeAfterViolationAck = useCallback(() => {
    warningModalShowingRef.current = false;
    blurIgnoreUntilRef.current = Date.now() + 2000;
    postWarningGraceUntilRef.current = Date.now() + 8000;
    setWarningQueue([]);
    setViolationWarning(null);
    recoverCameraPreview();
    fullscreenSuppressRef.current = true;
    needsFullscreenRef.current = false;
    setNeedsFullscreen(false);
    void requestExamFullscreen();
  }, [recoverCameraPreview]);

  // Rasmiy ogohlantirish modali ochilsa — 10s da avto-yopiladi (talaba bosmasa ham).
  // Aks holda modal ochiq turganda nazorat muzlab, talaba bemalol ko'chirishi mumkin.
  useEffect(() => {
    if (!violationWarning || banned || hardBlocked) return;
    const id = window.setTimeout(() => resumeAfterViolationAck(), FORMAL_WARN_AUTOCLOSE_MS);
    return () => clearTimeout(id);
  }, [violationWarning, banned, hardBlocked, resumeAfterViolationAck]);

  const continueAfterUnblock = useCallback(() => {
    setUnblockReady(false);
    setBanned(false);
    setStrikeLevel(0);
    setViolationWarning(null);
    setBanViolationsCount(null);
    warningModalShowingRef.current = false;
    postWarningGraceUntilRef.current = Date.now() + 8000;
    fullscreenSuppressRef.current = true;
    needsFullscreenRef.current = false;
    setProctorRetryNonce((n) => n + 1);
    recoverCameraPreview();
    void requestExamFullscreen();
  }, [recoverCameraPreview]);

  useEffect(() => {
    if (banned) return;
    const id = window.setInterval(() => {
      if (bannedRef.current) return;
      const v = videoRef.current;
      const s = streamRef.current;
      const vt = s?.getVideoTracks?.()?.[0];
      syncMicReadyFromStream(s);
      if (!v || !s || !vt) return;
      if (vt.readyState !== 'live') {
        setCameraPreviewOk(false);
        setCameraErrorHint(translations[langRef.current].examCameraPlayBlocked);
        setProctorRetryNonce((n) => n + 1);
        return;
      }
      if (v.srcObject !== s) v.srcObject = s;
      if (v.readyState >= 2 && !v.paused) {
        if (!cameraPreviewOk) {
          setCameraPreviewOk(true);
          if (syncMicReadyFromStream(s)) setCameraErrorHint('');
        }
      }
    }, 2500);
    return () => window.clearInterval(id);
  }, [banned, cameraPreviewOk, syncMicReadyFromStream]);

  useEffect(() => {
    if (banned) return;
    const s = streamRef.current;
    const v = videoRef.current;
      if (!s || !v) return;
    const tz = translations[langRef.current];
    if (v.srcObject !== s) v.srcObject = s;
    const tryPlay = () => {
      void v
        .play()
        .then(() => {
          setCameraPreviewOk(true);
          if (syncMicReadyFromStream(s)) setCameraErrorHint('');
        })
        .catch(() => {
          setCameraPreviewOk(false);
          setCameraErrorHint(tz.examCameraPlayBlocked);
        });
    };
    tryPlay();
    v.addEventListener('loadeddata', tryPlay, { once: true });
    const t1 = window.setTimeout(tryPlay, 350);
    const t2 = window.setTimeout(tryPlay, 900);
    return () => {
      v.removeEventListener('loadeddata', tryPlay);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [proctorStreamRevision, banned, syncMicReadyFromStream]);

  // --- AI Proctoring Setup & Security ---
  useEffect(() => {
    if (banned) return;

    // Security: Disable right click, copy/paste, and keyboard shortcuts.
    // Qonun bo'yicha: darhol rasmiy YUBORMAYMIZ — darvozaga belgilaymiz (1.5s kichik,
    // 4s uzluksiz takror → rasmiy). Bir marta tasodifiy bosish jazolanmaydi.
    const handleContextMenu = (e: Event) => {
      e.preventDefault();
      markGateEvent('CLIPBOARD_ATTEMPT');
    };
    const handleCopyPaste = (e: Event) => {
      e.preventDefault();
      markGateEvent('CLIPBOARD_ATTEMPT');
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || '').toLowerCase();
      if (isPrintScreenKeyboardEvent(e)) {
        e.preventDefault();
        reportPrintScreenViolation((t) => markGateEvent(t));
        return;
      }
      const isClipboardCombo = (e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a'].includes(key);
      const isDevtoolsCombo =
        key === 'f12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j'].includes(key));
      if (isDevtoolsCombo) {
        e.preventDefault();
        if (document.hasFocus() && Boolean(getFullscreenElement())) {
          markGateEvent('DEVTOOLS_OPEN');
        }
        return;
      }
      if (isClipboardCombo) {
        e.preventDefault();
        markGateEvent('CLIPBOARD_ATTEMPT');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
      }
    };

    // Zoom bloklash: Ctrl+g'ildirak (trackpad/mishka) va Safari pinch gesture.
    // Ctrl+'+'/'-'/'0' allaqachon handleKeyDown ichida preventDefault qilinadi.
    const blockZoomWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const blockGesture = (e: Event) => e.preventDefault();

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isPrintScreenKeyboardEvent(e)) {
        e.preventDefault();
        reportPrintScreenViolation((t) => markGateEvent(t));
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('paste', handleCopyPaste);
    document.addEventListener('cut', handleCopyPaste);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('wheel', blockZoomWheel, { passive: false });
    document.addEventListener('gesturestart', blockGesture);
    document.addEventListener('gesturechange', blockGesture);

    // DevTools o'lcham-evristikasi: ochiq panel — DAVOMIY holat. Tez (500ms) poll qilib
    // darvozaga belgilaymiz; panel ochiq turgan har lahzada marklanadi → 4s uzluksiz
    // bo'lsa qonun bo'yicha rasmiyga o'tadi (bir zumlik o'lcham o'zgarishi jazolanmaydi).
    // --- DevTools aniqlash (endi STANDART HOLDA YOQILGAN) ---
    // Ilgari faqat o'lcham evristikasi bor edi va u hech qayerda o'rnatilmagan
    // `VITE_DEVTOOLS_SIZE_HEURISTIC` bayrog'i ortida turardi — ya'ni devtools
    // AMALDA UMUMAN ANIQLANMASDI. Endi ikki signal: konsol getter-zondi
    // (o'lchamga bog'liq emas, doklangan panelda ham ishlaydi) va bazaviy
    // qiymatga nisbatan o'lcham o'sishi. Ikkalasi ham darvozaga belgilanadi —
    // rasmiy ogohlantirish faqat 4s uzluksiz davom etsa chiqadi.
    let devtoolsTick: number | null = null;
    {
      const probe = new ConsoleProbeDevtoolsDetector();
      const sizeHeuristic = new WindowSizeDevtoolsHeuristic();
      let consecutiveHits = 0;
      devtoolsTick = window.setInterval(() => {
        if (bannedRef.current || !sessionStartedRef.current) return;
        // Fokus yo'q / fullscreen yo'q — o'lcham o'lchovi ishonchsiz, baza
        // qaytadan olinadi. Zond esa fokusdan qat'i nazar ishlaydi.
        const measurable = Boolean(getFullscreenElement()) && document.hasFocus();
        if (!measurable) sizeHeuristic.reset();

        const probeHit = probe.check();
        const sizeHit = measurable
          ? sizeHeuristic.push(
              Math.abs((window.outerWidth || 0) - (window.innerWidth || 0)),
              Math.abs((window.outerHeight || 0) - (window.innerHeight || 0)),
            )
          : false;

        // O'lcham evristikasi soxta signalga moyilroq — u uchun ketma-ket
        // ikkita o'lchov talab qilinadi; zond esa darhol ishonchli.
        if (probeHit) {
          markGateEvent('DEVTOOLS_OPEN');
          consecutiveHits = 0;
          return;
        }
        consecutiveHits = sizeHit ? consecutiveHits + 1 : 0;
        if (consecutiveHits >= 2) markGateEvent('DEVTOOLS_OPEN');
      }, 1000);
    }

    // Har bir foydalanuvchi harakati — fullscreen'ni AVTOMATIK tiklaydi.
    // Bloklovchi modal yo'q: brauzer `requestFullscreen()` ni faqat foydalanuvchi
    // harakati (gesture) ichida ruxsat beradi, shuning uchun tiklash imtihonda
    // baribir bo'ladigan birinchi klik/tugma bosishga ulanadi.
    const ensureFullscreenOnGesture = () => {
      // Safety net: AudioContext "suspended" bo'lsa (brauzer avtoplay siyosati) —
      // har foydalanuvchi harakatida tiklaymiz. Aks holda mikrofon jimlik beradi va
      // OVOZ ANIQLANMAYDI (analyser 0 qaytaradi). Bu ovoz-aniqlash muammosining
      // eng ehtimoliy sababi edi.
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
      void sileroRef.current?.resume();
      if (bannedRef.current) return;
      if (getFullscreenElement()) return;
      requestExamFullscreen();
    };
    // pointerdown + keydown: sichqoncha ham, klaviatura ham gesture beradi —
    // talaba javob tanlashi bilan fullscreen o'zi tiklanadi.
    window.addEventListener('pointerdown', ensureFullscreenOnGesture, { capture: true });
    window.addEventListener('keydown', ensureFullscreenOnGesture, { capture: true });

    const setupAI = async () => {
      try {
        setCameraErrorHint('');
        setCameraPreviewOk(false);
        setMicReady(false);
        // PreExamCheck "Kirish" bosilganda kamerani OLDINDAN so'ragan bo'lishi
        // mumkin (proctorStreamPrewarm.ts) — bo'lsa, shuni ishlatamiz (yangi
        // getUserMedia so'rovisiz, tezroq). Muvaffaqiyatsiz/yo'q bo'lsa —
        // odatdagidek o'zimiz so'raymiz.
        const prewarmed = claimPrewarmedProctorStream();
        let stream: MediaStream;
        if (prewarmed) {
          try {
            stream = await prewarmed;
          } catch {
            stream = await openPreferredProctorStream();
          }
        } else {
          stream = await openPreferredProctorStream();
        }
        streamRef.current = stream;
        setProctorStreamRevision((n) => n + 1);

        const micOk = syncMicReadyFromStream(stream);
        if (!micOk) {
          // Kamera ochilgan bo'lishi mumkin, lekin savollar mikrofon siz ochilmasin.
          setCameraErrorHint(translations[langRef.current].examMediaMicRequired);
        }

        // Django Channels WebSocket (Node.js Socket.IO o'rniga)
        const wsUrl = buildRealtimeUrl(token);
        const wsInstance = createRealtimeSocket(
          wsUrl,
          async (msg) => {
            if (msg.type === 'connected') {
              wsInstance.send({ type: 'join_exam', exam_id: exam.id, role: 'student' });
              setRealtimeSyncOffline(false);
            } else if (msg.type === 'student_unblocked') {
              const md = msg as any;
              if (String(md.student_id) === String(user.id)) {
                if (md.can_retake) {
                  setUnblockReady(true);
                  showWarningMsg(translations[langRef.current].unblockAllowedMsg || 'Admin imtihonni davom ettirishingizga ruxsat berdi!', 6000);
                } else {
                  showWarningMsg(translations[langRef.current].unblockDeniedMsg || 'Admin imtihonni tugatdi. Topshira olmaysiz.', 8000);
                }
              }
            } else if (msg.type === 'exam_retake' || msg.type === 'technical_retake') {
              const md = msg as any;
              if (String(md.student_id) === String(user.id)) {
                const remaining =
                  typeof md.retakes_remaining === 'number'
                    ? md.retakes_remaining
                    : typeof md.technical_retakes_remaining === 'number'
                      ? md.technical_retakes_remaining
                      : 0;
                const reason = String(md.reason || '').trim();
                const identityRetake = Boolean(md.identity_retake);
                if (remaining <= 0 && !identityRetake) {
                  setBanned(true);
                  setBanLastReason(reason);
                  setBanReasonCode('RETAKE_EXHAUSTED');
                  setUnblockReady(false);
                  releaseCameraAndMic();
                  return;
                }
                setBanned(false);
                setUnblockReady(false);
                pushWarningHistory(reason);
                setExamRetakeNotice({
                  remaining,
                  used: typeof md.retakes_used === 'number' ? md.retakes_used : 0,
                  reason,
                  identityRetake,
                });
                releaseCameraAndMic();
              }
            } else if (msg.type === 'offer') {
              const fromId = msg.from as string;
              const offer = msg.offer as RTCSessionDescriptionInit;
              const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
              });
              peerConnectionsRef.current[fromId] = pc;
              stream.getTracks().forEach((track) => pc.addTrack(track, stream));
              pc.onicecandidate = (ev) => {
                if (ev.candidate) {
                  wsInstance.send({
                    type: 'ice_candidate',
                    to: fromId,
                    candidate: ev.candidate.toJSON(),
                  });
                }
              };
              await pc.setRemoteDescription(new RTCSessionDescription(offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              wsInstance.send({ type: 'answer', to: fromId, answer });
            } else if (msg.type === 'ice_candidate') {
              const fromId = msg.from as string;
              const pc = peerConnectionsRef.current[fromId];
              if (pc) {
                await pc.addIceCandidate(
                  new RTCIceCandidate(msg.candidate as RTCIceCandidateInit),
                );
              }
            }
          },
          {
            onOpen: () => {
              setRealtimeSyncOffline(false);
              setRealtimeBannerDismissed(false);
            },
            onFailed: () => setRealtimeSyncOffline(true),
          },
        );
        socketRef.current = wsInstance;

        // 2. Setup Audio Analysis (mikrofon izlari bo'lmasa — ovoz tahlilini o'tkazib yuboramiz)
        if (stream.getAudioTracks().length > 0) {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const analyser = audioCtx.createAnalyser();
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
          // 2048: har bir o'qishda ~46ms (44.1kHz da) audio oynasi — kichikroq buferda (256 = ~5.8ms)
          // tez-tez so'rov qilinganda ham nutqning ko'p qismi "sample" oralig'idan chetda qolib ketardi.
          analyser.fftSize = 2048;
          audioContextRef.current = audioCtx;
          analyserRef.current = analyser;
          const onMicLost = () => {
            if (!sessionStartedRef.current || bannedRef.current) return;
            void logViolationRef.current('CAMERA_MIC_ACCESS_FAILED');
          };
          for (const tr of stream.getAudioTracks()) {
            tr.addEventListener('ended', onMicLost);
            tr.addEventListener('mute', onMicLost);
          }

          // Ovoz kanali holati SERVERGA yozilsin. Ilgari bu hech qayerda
          // ko'rinmasdi va ovoz nazorati jimgina o'lik bo'lib turgani
          // oylab sezilmagan (butun tarixda 0 ta signal).
          const aTrack = stream.getAudioTracks()[0];
          void reportProctorDiag(
            'audio-input',
            true,
            `tracks=${stream.getAudioTracks().length} state=${aTrack?.readyState}`
              + ` muted=${aTrack?.muted} enabled=${aTrack?.enabled}`
              + ` label=${(aTrack?.label || '').slice(0, 40)}`
              + ` ctx=${audioCtx.state} sr=${audioCtx.sampleRate}`,
          );

          // Silero VAD ni fon rejimida yuklaymiz — imtihon boshlanishini
          // KUTTIRMAYDI. Tayyor bo'lguncha eski DSP mantig'i ishlab turadi.
          sileroRef.current?.dispose();
          const vad = new SileroVad();
          sileroRef.current = vad;
          void vad.init(stream).then((ok) => {
            console.info('[silero-vad]', ok ? 'tayyor' : 'yo\'q — DSP zaxirasi');
            if (ok) void vad.resume();
            void reportProctorDiag(
              'silero-vad', ok, ok ? '-' : 'model yuklanmadi, DSP zaxirasi',
            );
          });
        } else {
          audioContextRef.current = null;
          analyserRef.current = null;
          sileroRef.current?.dispose();
          sileroRef.current = null;
        }

      } catch (err) {
        setCameraPreviewOk(false);
        setMicReady(false);
        if (err instanceof DOMException && err.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
          setCameraErrorHint(translations[langRef.current].virtualCameraBlocked);
          // Alohida mahalliy xabar YO'Q — bu haqiqiy qoidabuzarlik, logViolation
          // o'zi rasmiy ogohlantirish modalini (bir xil dizayn) ochadi.
          void logViolationRef.current('VIRTUAL_WEBCAM_SUSPECTED');
        } else {
          console.error('Failed to setup AI proctoring:', err);
          setCameraErrorHint(formatPreExamMediaAccessFailure(err, langRef.current));
          void logViolationRef.current('CAMERA_MIC_ACCESS_FAILED');
        }
      }
    };

    setupAI();

    // Cleanup
    return () => {
      window.removeEventListener('pointerdown', ensureFullscreenOnGesture, true);
      window.removeEventListener('keydown', ensureFullscreenOnGesture, true);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('paste', handleCopyPaste);
      document.removeEventListener('cut', handleCopyPaste);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('wheel', blockZoomWheel);
      document.removeEventListener('gesturestart', blockGesture);
      document.removeEventListener('gesturechange', blockGesture);
      if (devtoolsTick !== null) clearInterval(devtoolsTick);

      // MUHIM: bu yerda ILGARI `exitFullscreen()` ham chaqirilardi. Bu effekt
      // `proctorRetryNonce` o'zgarganda ham (masalan "Живая синхронизация"
      // banneridagi "Переподключиться" tugmasi, yoki kamera preview tiklash)
      // QAYTA ishga tushadi — ya'ni HAQIQIY unmountda emas, oddiy qayta
      // urinishda ham talaba fullscreendan chiqarib yuborilardi. Fullscreendan
      // chiqish endi FAQAT haqiqiy unmountda ishlaydigan alohida effektda
      // (pastda, bo'sh dependency bilan).
      socketRef.current?.destroy();
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [banned, exam.id, token, user.id, proctorRetryNonce, requestExamFullscreen, syncMicReadyFromStream]);

  // Fullscreendan chiqish — FAQAT komponent HAQIQIY unmount bo'lganda (imtihon
  // tugadi/banned/sahifadan chiqildi). Bo'sh dependency: `proctorRetryNonce`
  // kabi qayta-urinish signallariga BOG'LIQ EMAS, shuning uchun "Живая
  // синхронизация" banneridagi qayta ulanish yoki kamera tiklanishi talabani
  // endi fullscreendan chiqarib yubormaydi.
  useEffect(() => {
    return () => {
      if (!getFullscreenElement()) return;
      const doc = document as Document & {
        webkitExitFullscreen?: () => Promise<void> | void;
        msExitFullscreen?: () => Promise<void> | void;
      };
      const exit =
        doc.exitFullscreen?.bind(doc) ||
        doc.webkitExitFullscreen?.bind(doc) ||
        doc.msExitFullscreen?.bind(doc);
      void Promise.resolve(exit?.()).catch(() => {});
    };
  }, [getFullscreenElement]);

  // --- Real-time ovoz: faqat inson nutqi (spektr + RMS), ~200ms freym.
  // Qonun (README.md "Proctoring eskalatsiya qoidasi") bilan bir xil ikki bosqich:
  // 1.5s uzluksiz — kamera panelida kichik yorliq, 4s — rasmiy ogohlantirish.
  /** Tashqi shovqin (SUSPICIOUS_AUDIO) nazorati shu imtihonda yoqilganmi.
   *  Server bermasa — YOQILGAN (xavfsiz standart). */
  const ambientEnabledRef = useRef(true);
  useEffect(() => {
    ambientEnabledRef.current = exam.ambient_audio_enabled !== false;
  }, [exam.ambient_audio_enabled]);

  /** Tashqi shovqin o'chirilganda "o'zi gapiryaptimi" qarori (og'iz harakati oynasi). */
  const ownSpeechGateRef = useRef<OwnSpeechGate | null>(null);

  const voiceTrackerRef = useRef<VoiceActivityTracker | null>(null);
  const ambientTrackerRef = useRef<AmbientNoiseTracker | null>(null);
  const speechContinuousRef = useRef<ContinuousSignalTracker | null>(null);
  /** Pichirlash (ovozsiz nutq) — ohangga tayanmaydigan alohida yo'l. */
  const whisperTrackerRef = useRef<WhisperTracker | null>(null);
  const whisperContinuousRef = useRef<ContinuousSignalTracker | null>(null);
  /** Mikrofon raqamli JIM (o'chirilgan) turgan vaqt — ms. */
  const silentMicMsRef = useRef(0);
  const silentMicReportedRef = useRef(false);
  const ambientContinuousRef = useRef<ContinuousSignalTracker | null>(null);
  /** Video (og'iz harakati) hozir "gapiryapti" deb hisoblanadimi — ovoz eskalatsiyasida
   *  WHISPER_OR_CONVERSATION_SUSPECTED (boshqa odam) vs MOUTH_MOVEMENT_TALKING (o'zi)
   *  ni ajratish uchun. */
  const mouthActiveRef = useRef(false);
  /** Ovoz manbali kichik yorliq — kamera panelida video signalidan ALOHIDA qatorda
   *  ko'rsatiladi (shovqin va gapirish matni farqlanishi uchun). */
  const [audioLiveLabel, setAudioLiveLabel] = useState<string | null>(null);

  useEffect(() => {
    // `examArmed`: fullscreen'da + media tayyor + engine yuklangan. Ilgari bu
    // sikl sessiya boshlanishi bilan ishlardi va ovoz ogohlantirishlari
    // to'liq-ekran qoplamasi ustiga chiqib kelardi.
    if (!examArmed) return;
    // analyserRef dependency sifatida ishlamaydi — micReady state orqali qayta ulanamiz.
    if (!micReady) return;
    const analyser = analyserRef.current;
    if (!analyser) return;
    if (!voiceTrackerRef.current) voiceTrackerRef.current = new VoiceActivityTracker();
    if (!ambientTrackerRef.current) ambientTrackerRef.current = new AmbientNoiseTracker();
    // Ovoz (gapirish): grace 600ms — so'zlar/qisqa pauzalarni ko'prik qiladi
    if (!speechContinuousRef.current) speechContinuousRef.current = new ContinuousSignalTracker(600);
    // Shovqin: grace QISQA (250ms)
    if (!ambientContinuousRef.current) ambientContinuousRef.current = new ContinuousSignalTracker(250);
    if (!whisperTrackerRef.current) whisperTrackerRef.current = new WhisperTracker();
    // Pichirlash uchun grace uzunroq (900ms): bo'g'inlar orasidagi pauzalar
    // signalni uzmasin.
    if (!whisperContinuousRef.current) whisperContinuousRef.current = new ContinuousSignalTracker(900);

    // AudioContext suspended bo'lishi mumkin — birinchi tickda tiklashga urinamiz.
    void audioContextRef.current?.resume?.().catch(() => {});
    void sileroRef.current?.resume();

    const id = window.setInterval(() => {
      if (bannedRef.current || !analyserRef.current) return;
      const frame = analyzeVoiceFrame(analyserRef.current);
      const now = Date.now();

      // Silero ready LEKIN kadr kelmasa (suspended AudioContext) — DSP zaxira.
      // Aks holda ready=true bo'lib tinimsiz false qaytarardi va ovoz "o'lik" edi.
      const silero = sileroRef.current;
      const sileroLive = Boolean(silero?.ready && silero.isReceivingAudio());
      const speechRaw = sileroLive
        ? silero!.isSpeaking()
        : voiceTrackerRef.current!.push(frame);

      const ambientRaw = ambientTrackerRef.current!.push(frame, speechRaw);
      const ambientMs = ambientContinuousRef.current!.push(ambientRaw, now);

      // «Tashqi shovqin nazorati» O'CHIRILGAN bo'lsa: mikrofonga tushgan NUTQ ham
      // faqat talabaning O'ZI gapirganda hisoblanadi. Silero VAD kimning ovozi
      // ekanini ajratmaydi — yonidagi odam / koridordagi gap ham "gapirish" bo'lib
      // chip + kichik modal + rasmiy ogohlantirish berardi. Sozlama esa aynan shu
      // holat (institut binosida o'tkaziladigan imtihon) uchun qo'yilgan.
      //
      // Qaror OXIRGI ~2s og'iz harakati oynasi bo'yicha — `OwnSpeechGate`.
      const ambientOn = ambientEnabledRef.current;
      if (!ownSpeechGateRef.current) ownSpeechGateRef.current = new OwnSpeechGate();
      const ownSpeech = ownSpeechGateRef.current.push(mouthActiveRef.current);
      const speechCounted = speechRaw && (ambientOn || ownSpeech);
      const speechMs = speechContinuousRef.current!.push(speechCounted, now);

      const speechConfirmMs = sileroLive
        ? TALK_SIGNAL_CONFIRM_MS
        : Math.max(TALK_SIGNAL_CONFIRM_MS, 1400);
      const speechEscalateMs = sileroLive
        ? TALK_SIGNAL_ESCALATE_MS
        : Math.max(TALK_SIGNAL_ESCALATE_MS, 3000);
      const ambientConfirmMs = Math.max(LIVE_SIGNAL_CONFIRM_MS, 2000);
      const ambientEscalateMs = Math.max(LIVE_SIGNAL_ESCALATE_MS, 5000);

      const speechSmall = speechMs >= speechConfirmMs;
      // TASHQI shovqin nazorati imtihon sozlamasida o'chirilgan bo'lishi
      // mumkin (institut binosida tabiiy shovqin soxta ogohlantirish beradi).
      // DIQQAT: bu FAQAT tashqi shovqinga tegishli — talabaning o'zi gapirishi
      // (og'iz harakati + nutq) sozlamadan qat'i nazar HAR DOIM aniqlanadi.
      const ambientSmall = ambientEnabledRef.current && ambientMs >= ambientConfirmMs;

      // Modal ochiq — yangi kichik modal OCHILMAYDI, lekin hisob DAVOM ETADI
      // (object-proctor telefon ogohlantirishi ovozni "o'ldirmasin").
      const frozenUi = smallWarnOpenRef.current;

      if (!frozenUi) {
        if (speechSmall) noteSmallWarningRef.current(SPEECH_LEDGER_KEY);
        else smallWarningLedgerRef.current.noteCleared(SPEECH_LEDGER_KEY);
        if (ambientSmall) noteSmallWarningRef.current('SUSPICIOUS_AUDIO');
        else smallWarningLedgerRef.current.noteCleared('SUSPICIOUS_AUDIO');

        if (speechSmall) {
          const label = withSmallCount(EXAM_L[langRef.current].liveTalking, SPEECH_LEDGER_KEY);
          setAudioLiveLabel(label);
          showSmallWarnRef.current('a:speech', SPEECH_LEDGER_KEY, label);
        } else if (ambientSmall) {
          const label = withSmallCount(
            EXAM_L[langRef.current].liveAmbientNoise,
            'SUSPICIOUS_AUDIO',
          );
          setAudioLiveLabel(label);
          showSmallWarnRef.current('a:ambient', 'SUSPICIOUS_AUDIO', label);
        } else {
          setAudioLiveLabel(null);
        }
      }

      if (ambientEnabledRef.current && ambientMs >= ambientEscalateMs) {
        ambientContinuousRef.current!.reset();
        formalIssuedFor('SUSPICIOUS_AUDIO');
        void logViolationRef.current('SUSPICIOUS_AUDIO');
      }
      // --- JIM MIKROFON ---
      // Haqiqiy mikrofon jim xonada ham nolinchi emas (fon shovqini bor).
      // Raqamli nol = mikrofon o'chirilgan yoki tovushi nolga tushirilgan.
      const SILENT_RMS = 0.0006;
      const SILENT_LIMIT_MS = 60_000;
      if (frame.rms < SILENT_RMS) {
        silentMicMsRef.current += 200;
        if (
          silentMicMsRef.current >= SILENT_LIMIT_MS &&
          !silentMicReportedRef.current
        ) {
          silentMicReportedRef.current = true;
          void reportProctorDiag(
            'audio-silent',
            false,
            `mikrofon ${Math.round(silentMicMsRef.current / 1000)}s raqamli jim`
              + ` — o'chirilgan yoki tovushi nolda`,
          );
          // Texnik nosozlik EMAS: imtihon oldida mikrofon eshitishi
          // tekshirilgan. Demak u keyin ataylab o'chirilgan.
          void logViolationRef.current('MICROPHONE_MUTED');
        }
      } else {
        silentMicMsRef.current = 0;
      }

      // --- PICHIRLASH ---
      // Ovozli nutq allaqachon aniqlangan bo'lsa qayta hisoblamaymiz.
      const whisperRaw = speechRaw
        ? false
        : whisperTrackerRef.current!.push(frame);
      const whisperMs = whisperContinuousRef.current!.push(whisperRaw, now);
      // 4 soniya — oddiy nutqdagidan (1.8 s) uzunroq. Pichirlash mezoni
      // tabiatan noaniqroq, shuning uchun tasodifiy shovqin rasmiy
      // ogohlantirishga aylanib qolmasligi kerak.
      const WHISPER_ESCALATE_MS = 2000;
      if (!frozenUi && whisperMs >= 1500) {
        noteSmallWarningRef.current(SPEECH_LEDGER_KEY);
        const wl = withSmallCount(EXAM_L[langRef.current].liveTalking, SPEECH_LEDGER_KEY);
        setAudioLiveLabel(wl);
        showSmallWarnRef.current('a:whisper', SPEECH_LEDGER_KEY, wl);
      }
      if (whisperMs >= WHISPER_ESCALATE_MS) {
        whisperContinuousRef.current!.reset();
        formalIssuedFor(SPEECH_LEDGER_KEY);
        // Pichirlash deyarli har doim YONIDAGI odamdan keladi.
        void logViolationRef.current('WHISPER_OR_CONVERSATION_SUSPECTED');
      }

      if (speechMs >= speechEscalateMs) {
        speechContinuousRef.current!.reset();
        formalIssuedFor(SPEECH_LEDGER_KEY);
        // Tashqi shovqin o'chirilgan bo'lsa bu yerga FAQAT o'z nutqi yetib keladi
        // (yuqoridagi og'iz oynasi) — turi ham shunga mos bo'lsin.
        void logViolationRef.current(
          !ambientOn || mouthActiveRef.current
            ? 'MOUTH_MOVEMENT_TALKING'
            : 'WHISPER_OR_CONVERSATION_SUSPECTED',
        );
      }
    }, 200);
    return () => clearInterval(id);
  }, [examArmed, micReady]);

  // Mikrofon o'chgan yoki tahlil yo'q — gapirish nazorati ishlamaydi. Davomiy holat
  // (mikrofon tuzatilmaguncha davom etadi) — qonun bo'yicha uzluksiz kuzatiladi,
  // har tekshiruvda emas, faqat eskalatsiya bosqichida (4s) va undan keyin resetdan
  // so'ng yana to'liq muddatdan keyin qayta yuboriladi (tinimsiz spam bo'lmasin).
  const micDownContinuousRef = useRef<ContinuousSignalTracker | null>(null);
  useEffect(() => {
    if (!examArmed) return;
    const graceUntil = Date.now() + 12_000;
    if (!micDownContinuousRef.current) micDownContinuousRef.current = new ContinuousSignalTracker(1000);
    const id = window.setInterval(() => {
      if (bannedRef.current || !sessionStartedRef.current) return;
      if (Date.now() < graceUntil) return;
      const tracks = streamRef.current?.getAudioTracks() ?? [];
      const audioLive = tracks.some((t) => t.readyState === 'live' && t.enabled && !t.muted);
      const micDown = !analyserRef.current || !audioLive;
      const ms = micDownContinuousRef.current!.push(micDown);
      if (ms >= LIVE_SIGNAL_ESCALATE_MS) {
        micDownContinuousRef.current!.reset();
        formalIssuedFor('CAMERA_MIC_ACCESS_FAILED');
        void logViolationRef.current('CAMERA_MIC_ACCESS_FAILED');
      } else if (ms >= LIVE_SIGNAL_CONFIRM_MS) {
        noteSmallWarningRef.current('CAMERA_MIC_ACCESS_FAILED');
      } else {
        smallWarningLedgerRef.current.noteCleared('CAMERA_MIC_ACCESS_FAILED');
      }
    }, 2000);
    return () => clearInterval(id);
  }, [banned, sessionStarted]);

  // --- Yagona darvoza tick loop (event/tab-manba qoidabuzarliklari) ---
  // Qonun (README.md): har bir tur uchun 1.5s uzluksiz → kamera panelida kichik yorliq,
  // 4s → rasmiy (logViolation), so'ng reset (tinimsiz takrorlanmasin).
  useEffect(() => {
    if (!examArmed) return;
    if (!eventGateRef.current) {
      eventGateRef.current = new ViolationGate(LIVE_SIGNAL_CONFIRM_MS, LIVE_SIGNAL_ESCALATE_MS);
    }
    const gate = eventGateRef.current;
    // Faqat event-manba (markEvent orqali marklanadigan) turlar bu ro'yxatda.
    const EVENT_TYPES = ['PRINT_SCREEN', 'CLIPBOARD_ATTEMPT', 'DEVTOOLS_OPEN'];
    const LABEL: Record<string, keyof (typeof EXAM_L)['uz']> = {
      PRINT_SCREEN: 'liveScreenshot',
      CLIPBOARD_ATTEMPT: 'liveClipboard',
      DEVTOOLS_OPEN: 'liveDevtools',
      TAB_SWITCH_HARD: 'liveTabSwitch',
    };
    const id = window.setInterval(() => {
      if (bannedRef.current || !sessionStartedRef.current) return;
      // Modal ochiq — nazorat muzlagan: event/tab hisobini to'xtatamiz.
      if (smallWarnOpenRef.current) return;
      const now = Date.now();
      let best: { type: string; ms: number } | null = null;

      const consider = (type: string, activeState: boolean) => {
        const ms = gate.push(type, activeState, now);
        if (ms >= LIVE_SIGNAL_ESCALATE_MS) {
          gate.reset(type);
          formalIssuedFor(type);
          void logViolationRef.current(type);
          return;
        }
        // Kichik ogohlantirish bosqichi — epizod sanaladi ("3 kichik → 4-si rasmiy").
        if (ms >= LIVE_SIGNAL_CONFIRM_MS) {
          noteSmallWarningRef.current(type);
          if (!best || ms > best.ms) best = { type, ms };
        } else {
          smallWarningLedgerRef.current.noteCleared(type);
        }
      };

      for (const type of EVENT_TYPES) consider(type, false);
      // Tab yashiringan — davomiy holat (poll). Nazorat qurollangan bo'lsagina
      // hisoblanadi (fullscreen gate / FS o'tish paytida qurol o'chirilgan).
      const tabArmed = tabGuardRef.current.armed;
      const tabHidden = tabArmed && document.visibilityState === 'hidden';
      if (!tabArmed) gate.reset('TAB_SWITCH_HARD');
      consider('TAB_SWITCH_HARD', tabHidden);

      const bestType = best ? (best as { type: string }).type : null;
      if (bestType) {
        const label = withSmallCount(EXAM_L[langRef.current][LABEL[bestType]], bestType);
        setEventLiveLabel(label);
        showSmallWarnRef.current(`e:${bestType}`, bestType, label);
      } else {
        setEventLiveLabel(null);
      }
    }, 250);
    return () => clearInterval(id);
  }, [examArmed]);

  const [identityTerminated, setIdentityTerminated] = useState(false);

  // --- Violation logging ---
  /**
   * Matn tarjima qilinmagan xom kodmi (`MOUTH_MOVEMENT_TALKING`, `NO_ACTIVE_SESSION`)?
   * Bunday matn talabaga ko'rsatilmaydi — u faqat ichki identifikator.
   */
  const isRawCode = (s: string) => /^[A-Z][A-Z0-9_]{3,}$/.test(s.trim());

  const logViolation = async (type: string, note?: string) => {
    if (bannedRef.current) return;
    if (!sessionStartedRef.current) return;

    // Server strict VAC da shu turlarni DARHOL to'xtatadi (ogohlantirishsiz).
    // Ro'yxat backend'dagi PROCTOR_INSTANT_BAN_VIOLATIONS bilan bir xil bo'lishi
    // kerak: bu yerda yo'q tur quyidagi "muzlatish" filtrlariga ilinib serverga
    // umuman yetib bormaydi — ya'ni ogohlantirish oynasini ochiq qoldirib
    // telefonga qarab o'tirish mumkin bo'lib qolardi.
    const INSTANT_BAN_TYPES = new Set([
      'IDENTITY_SUBSTITUTION',
      'FORBIDDEN_OBJECT_CELL_PHONE',
      'FORBIDDEN_OBJECT_LAPTOP',
      'FORBIDDEN_OBJECT_BOOK',
      'REMOTE_CONTROL_SUSPECTED',
      'VIRTUAL_WEBCAM_SUSPECTED',
      // Mikrofon imtihon oldida eshitishi tasdiqlangan edi — keyin
      // o'chirilgan bo'lsa bu ataylab qilingan.
      'MICROPHONE_MUTED',
    ]);

    // Kichik ogohlantirish modali ochiq — nazorat MUZLAGAN: talaba "Tushundim"
    // bosguncha (yoki avto-yopilishgacha) qilingan qoidabuzarliklar yutiladi
    // (strike/rasmiy hisoblanmaydi). Yagona istisno — yuz almashtirish (identity):
    // bu jiddiy xavfsizlik hodisasi, muzlatib bo'lmaydi.
    if (smallWarnOpenRef.current && !INSTANT_BAN_TYPES.has(type)) return;

    // Fullscreen qoplamasi ekranni to'sib turibdi: talaba savollarni ko'rmaydi
    // va faqat bitta tugmani bosa oladi — shu holat uchun yuz/nigoh/ovoz
    // signallari bo'yicha jazolash adolatsiz. Shuning uchun ular muzlatiladi.
    //
    // MUHIM (ilgari shu yerda jiddiy xato bo'lgan): bu muzlatish CHEKSIZ EMAS.
    // Fullscreen'dan chiqib qoplama ostida o'tirib nazoratni to'xtatib turish
    // mumkin bo'lmasligi uchun FULLSCREEN_GRACE_MS dan keyin rasmiy
    // FULLSCREEN_EXIT_HARD yoziladi (pastdagi kuzatuvchi effekt), va u shu
    // filtrdan o'tkaziladi.
    if (
      needsFullscreenRef.current &&
      type !== 'FULLSCREEN_EXIT_HARD' &&
      !INSTANT_BAN_TYPES.has(type)
    ) {
      return;
    }

    // Modal ochiqligida yangi violationlar (IDENTITY_SUBSTITUTION dan tashqari) bloklansn —
    // talaba ogohlantirishni o'qib javob bergandan keyin davom etsin.
    const BYPASS_MODAL_BLOCK = new Set([...INSTANT_BAN_TYPES, 'PRINT_SCREEN']);
    if (warningModalShowingRef.current && !BYPASS_MODAL_BLOCK.has(type)) return;

    // Modal yopilgandan keyingi qisqa grace oynasi — davom etayotgan sabab (masalan
    // xonadagi shovqin) darhol ketma-ket yana strike bermasin, tuzatishga vaqt bersin.
    if (Date.now() < postWarningGraceUntilRef.current && !INSTANT_BAN_TYPES.has(type)) return;

    // Dedup: bir xil tur uchun qisqa interval (server 60s ichida bitta rasmiy ogohlantirishni birlashtiradi)
    const now = Date.now();
    if (FOCUS_BURST_TYPES.has(type) && now < focusBurstLockUntilRef.current) {
      return;
    }
    const dedupeKey = `viol_last_${type}`;
    const lastSent = parseInt(sessionStorage.getItem(dedupeKey) || '0', 10);
    const MIN_INTERVAL = INSTANT_BAN_TYPES.has(type) ? 0 : 5_000;
    if (MIN_INTERVAL > 0 && now - lastSent < MIN_INTERVAL) {
      return;
    }
    if (FOCUS_BURST_TYPES.has(type)) {
      focusBurstLockUntilRef.current = now + 4500;
    }
    sessionStorage.setItem(dedupeKey, String(now));

    // DALIL: qoidabuzarlik paytidagi kamera kadri (kichik JPEG) — admin
    // "shubhali"ni ko'rib chiqishi va apellyatsiya uchun. Texnik uzilishda kadr yo'q.
    let evidence = '';
    try {
      const v = videoRef.current;
      if (v && v.readyState >= 2 && type !== 'PROCTOR_FEED_LOST') {
        evidence = compressVideoFrameToJpeg(v, 0.6, 320) || '';
      }
    } catch {
      evidence = '';
    }
    const violationBody = JSON.stringify({
      exam_id: examIdRef.current,
      violation_type: type,
      // Kadr (dalil) va aniq fakt (qaysi dastur, nechta monitor...) ALOHIDA yuboriladi.
      ...(evidence ? { screenshot_url: evidence } : {}),
      ...(note ? { detail: note.slice(0, 900) } : {}),
    });
    try {
      const res = await fetch(apiUrl('/api/student/violations'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await nextGuardHeaders('POST', '/api/student/violations', violationBody)),
        },
        body: violationBody,
      });
      syncVacIfOk(res);
      const data = (await readJsonSafe<{
        error?: string;
        code?: string;
        violationsCount?: number;
        banned?: boolean;
        warningNumber?: number;
        violationReason?: string;
        isFinalWarning?: boolean;
        warningSuppressed?: boolean;
        startupGrace?: boolean;
        officialWarnings?: number;
        mergeWindowSeconds?: number;
        // Ban/retake javob maydonlari (backend: student_violations, proctor_exam_retake).
        banReason?: string;
        sessionStatus?: string;
        technicalRetake?: boolean;
        examRetake?: boolean;
        identityRetake?: boolean;
        retakesRemaining?: number;
        retakesUsed?: number;
        technicalRetakesRemaining?: number;
        technicalRetakesUsed?: number;
      }>(res)) || {};

      if (!res.ok) {
        // Sessiya endi faol emas — "Faol sessiya yo'q" oynasini ko'rsatmaymiz
        // (tugmasi hech narsa qilmasdi), to'g'ri ekranga o'tamiz.
        if (res.status === 409 && data.sessionStatus) {
          sessionGoneRef.current(data.sessionStatus, data.banReason);
          return;
        }
        // Faqat O'QILADIGAN sabab ko'rsatiladi. Xom kod (MOUTH_MOVEMENT_TALKING,
        // NO_ACTIVE_SESSION...) talabaga hech narsa anglatmaydi — u holda jim
        // o'tkazamiz: kamera panelidagi kichik chip allaqachon signal bergan.
        const hint = String(data.violationReason || data.error || '').trim();
        if (hint && !isRawCode(hint)) showWarningMsg(hint, 5000);
        return;
      }

      // Ixtiyoriy startup grace (PROCTOR_STARTUP_GRACE_SECONDS) — strike hisoblanmaydi.
      if (data.startupGrace) {
        const detail = String(data.violationReason || '').trim();
        if (detail && !isRawCode(detail)) showWarningMsg(detail, 5000);
        return;
      }

      if (data.banned) {
        if (INSTANT_BAN_TYPES.has(type)) setIdentityTerminated(true);
        setViolationWarning(null);
        setStrikeLevel(maxOfficialWarnings);
        const reasonText = data.violationReason || t.violationReasonFallback;
        setBanLastReason(reasonText);
        setBanReasonCode(typeof data.banReason === 'string' ? data.banReason : null);
        const warnNum =
          typeof data.warningNumber === 'number' && data.warningNumber > 0
            ? data.warningNumber
            : typeof data.officialWarnings === 'number' && data.officialWarnings > 0
              ? data.officialWarnings
              : maxOfficialWarnings;
        pushWarningHistory(reasonText, warnNum);
        if (typeof data.violationsCount === 'number') {
          setBanViolationsCount(data.violationsCount);
        } else {
          setBanViolationsCount(null);
        }
        setBanned(true);
        releaseCameraAndMic();
        return;
      }

      if (data.technicalRetake || data.examRetake) {
        setViolationWarning(null);
        const remaining =
          typeof data.retakesRemaining === 'number'
            ? data.retakesRemaining
            : typeof data.technicalRetakesRemaining === 'number'
              ? data.technicalRetakesRemaining
              : 0;
        const used =
          typeof data.retakesUsed === 'number'
            ? data.retakesUsed
            : typeof data.technicalRetakesUsed === 'number'
              ? data.technicalRetakesUsed
              : 0;
        const reasonText = String(data.violationReason || '').trim();
        const identityRetake = Boolean(data.identityRetake);
        if (remaining <= 0 && !identityRetake) {
          setBanLastReason(reasonText);
          setBanReasonCode(
            typeof data.banReason === 'string' ? data.banReason : 'RETAKE_EXHAUSTED',
          );
          if (typeof data.violationsCount === 'number') {
            setBanViolationsCount(data.violationsCount);
          }
          setBanned(true);
          releaseCameraAndMic();
          return;
        }
        pushWarningHistory(reasonText);
        setExamRetakeNotice({
          remaining,
          used,
          reason: reasonText,
          identityRetake,
        });
        releaseCameraAndMic();
        return;
      }

      // Barcha boshqa qoidabuzarliklar — DOIM modal ko'rsatamiz (suppressed/merged bo'lsa ham).
      const official = typeof data.officialWarnings === 'number' ? data.officialWarnings : 0;
      const shownNumber =
        typeof data.warningNumber === 'number' && data.warningNumber > 0
          ? data.warningNumber
          : Math.max(1, official);
      const reasonText = data.violationReason || t.violationReasonFallback;
      pushWarningHistory(reasonText, shownNumber);
      setStrikeLevel(official > 0 ? official : shownNumber);
      fullscreenSuppressRef.current = true;
      warningModalShowingRef.current = true;
      setViolationWarning({
        reason: reasonText,
        warningNumber: shownNumber,
        isFinalWarning: data.isFinalWarning === true,
      });
    } catch {
      // Tarmoq xatosi — talabaga xom violation kodini ko'rsatish foydasiz va
      // chalkash (u "kichik ogohlantirish" deb tushunadi). Jim o'tkazamiz:
      // signal kamera panelidagi chipda ko'rinib turibdi, rasmiy ogohlantirish
      // esa faqat server javobidan keyin chiqadi.
    }
  };

  logViolationRef.current = logViolation;
  sessionGoneRef.current = (status: string, banReason?: string) => {
    if (status === 'In Progress') return;
    setViolationWarning(null);
    if (status === 'Banned') {
      setStrikeLevel(maxOfficialWarnings);
      setBanLastReason(t.violationReasonFallback);
      setBanReasonCode(banReason ? banReason : null);
      setBanned(true);
      releaseCameraAndMic();
      return;
    }
    // Yakunlangan yoki qayta ochilgan — kabinetga qaytamiz (natija / qayta boshlash).
    releaseCameraAndMic();
    onFinish(null);
  };

  // Brauzer kengaytmasi / sahifaga begona kod qo'shilishini kuzatish (faqat qayd,
  // admin ko'rib chiqadi). Har qanday xato imtihonga ta'sir qilmasligi kerak.
  useEffect(() => {
    if (!sessionStarted || banned) return;
    let stop: (() => void) | null = null;
    try {
      stop = startExtensionWatch((detail) => {
        void logViolationRef.current('BROWSER_EXTENSION_SUSPECTED', detail);
      });
    } catch {
      stop = null;
    }
    return () => {
      try {
        stop?.();
      } catch {
        /* ignore */
      }
    };
  }, [sessionStarted, banned]);

  // --- Butun ekranni ulashish (server `screen_share` yoqqan imtihonda) ---
  // Oqim imtihon oldi tekshiruvida olinadi. Talaba ulashishni o'zi to'xtatsa —
  // savollar yopiladi va DARHOL qoidabuzarlik yoziladi. Sahifa yangilanganda
  // (texnik uzilish) oqim yo'qoladi: bunda avval qayta ulashishga vaqt beriladi,
  // qoidabuzarlik faqat SCREEN_SHARE_RELOG_MS ichida ulashilmasa yoziladi.
  const desktopBridge = getDesktop();
  // Ilovada ekran rasmi ilovaning o'zida olinadi — brauzerning ulashish oynasi kerak emas.
  const screenShareRequired = Boolean(exam.screen_share) && !desktopBridge;
  const [needsScreenShare, setNeedsScreenShare] = useState(false);
  const [screenShareBusy, setScreenShareBusy] = useState(false);
  const [screenShareError, setScreenShareError] = useState('');
  const screenLostAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!screenShareRequired || !sessionStarted || banned) return;
    const lost = (logNow: boolean) => {
      setNeedsScreenShare(true);
      if (screenLostAtRef.current != null) return;
      screenLostAtRef.current = Date.now();
      if (logNow) void logViolationRef.current('SCREEN_SHARE_STOPPED');
    };
    if (!isScreenShareActive()) lost(false);
    const off = onScreenShareEnded(() => lost(true));
    const id = window.setInterval(() => {
      if (bannedRef.current) return;
      if (isScreenShareActive()) return;
      setNeedsScreenShare(true);
      const at = screenLostAtRef.current;
      if (at == null) {
        lost(false);
        return;
      }
      if (Date.now() - at >= SCREEN_SHARE_RELOG_MS) {
        screenLostAtRef.current = Date.now();
        void logViolationRef.current('SCREEN_SHARE_STOPPED');
      }
    }, 2000);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [screenShareRequired, sessionStarted, banned]);

  const reshareScreen = async () => {
    setScreenShareBusy(true);
    setScreenShareError('');
    try {
      const r = await requestScreenShare();
      if (r.ok) {
        setNeedsScreenShare(false);
        screenLostAtRef.current = null;
      } else {
        setScreenShareError((SCREEN_L[lang] || SCREEN_L.uz)[r.error || 'FAILED'] || (SCREEN_L[lang] || SCREEN_L.uz).FAILED);
      }
    } finally {
      setScreenShareBusy(false);
    }
  };

  // Ekran rasmi — faqat saqlanadi (admin "Dalillar"da ko'radi), jazo bermaydi.
  useEffect(() => {
    if (!screenShareRequired || !sessionStarted || banned) return;
    let alive = true;
    const send = async () => {
      if (!alive || bannedRef.current || !isScreenShareActive()) return;
      try {
        const image = await captureScreenJpeg(1280, 0.5);
        if (!image || !alive) return;
        const path = `/api/student/exams/${examIdRef.current}/screen-snapshot`;
        const body = JSON.stringify({ image });
        await fetch(apiUrl(path), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await nextGuardHeaders('POST', path, body)),
          },
          body,
        });
      } catch {
        /* dalil yuborilmadi — imtihonga ta'sir qilmaydi */
      }
    };
    const first = window.setTimeout(() => void send(), 5000);
    const id = window.setInterval(() => void send(), SCREEN_SNAPSHOT_MS);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [screenShareRequired, sessionStarted, banned, nextGuardHeaders]);

  // --- Kamera kadri (dalil) har 30 soniyada — komissiya butun imtihonni ko'rib chiqa oladi ---
  useEffect(() => {
    if (!exam.webcam_snapshots || !sessionStarted || banned) return;
    let alive = true;
    const send = async () => {
      if (!alive || bannedRef.current) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      try {
        const image = compressVideoFrameToJpeg(v, 0.6, 480);
        if (!image || !alive) return;
        const path = `/api/student/exams/${examIdRef.current}/screen-snapshot`;
        const body = JSON.stringify({ image, kind: 'webcam' });
        await fetch(apiUrl(path), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await nextGuardHeaders('POST', path, body)),
          },
          body,
        });
      } catch {
        /* dalil yuborilmadi — imtihonga ta'sir qilmaydi */
      }
    };
    const first = window.setTimeout(() => void send(), 12_000);
    const id = window.setInterval(() => void send(), WEBCAM_SNAPSHOT_MS);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [exam.webcam_snapshots, sessionStarted, banned, nextGuardHeaders]);

  // --- FerMI Exam Platform ilovasi: imtihon rejimi, kompyuter kuzatuvi, ekran rasmi ---
  // Imtihon rejimida ilova butun ekranni egallaydi, yopilmaydi va boshqa dasturlar
  // imtihon oynasini suratga ololmaydi. Sessiya tugashi yoki chetlatilganda o'chadi.
  useEffect(() => {
    const d = desktopBridge;
    if (!d || !sessionStarted || banned) return;
    void d.setExamMode(true).catch(() => {});
    return () => {
      void d.setExamMode(false).catch(() => {});
    };
  }, [desktopBridge, sessionStarted, banned]);

  // Ilova har 10 soniyada kompyuterni tekshiradi. Bir xil holat uchun qoidabuzarlik
  // daqiqasiga ko'pi bilan bir marta yuboriladi (qolganini server birlashtiradi).
  const desktopReportedAtRef = useRef<Record<string, number>>({});
  /** Dastur ketma-ket nechta tekshiruvda ko'rindi (yopilganiga qaramay). */
  const desktopSeenRef = useRef<Record<string, number>>({});
  /** Shu imtihonda bir marta ko'ringan dasturlar — qayta ochilsa darhol qayd. */
  const desktopEverSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const d = desktopBridge;
    if (!d || !sessionStarted || banned) return;
    const report = (type: string, note?: string) => {
      const now = Date.now();
      if (now - (desktopReportedAtRef.current[type] || 0) < 60_000) return;
      desktopReportedAtRef.current[type] = now;
      void logViolationRef.current(type, note);
    };
    const offWindow = d.onWindowEvent?.((e) => {
      if (!e || bannedRef.current) return;
      if (e.kind === 'minimize') {
        report(
          'FULLSCREEN_EXIT_HARD',
          'Imtihon paytida ilovani pastga tushirishga urinildi (Win+D / Win+M) — ilova darhol qaytarildi',
        );
      } else if (e.kind === 'blur') {
        // Har bir chiqish alohida (server 5 s ichidagi takrorni birlashtiradi).
        void logViolationRef.current(
          'TAB_SWITCH_HARD',
          'Imtihon oynasidan chiqildi (Alt+Tab, Win tugmasi yoki boshqa dastur oynasi) — ilova oynani qaytardi',
        );
      }
    });
    const offMonitor = d.onMonitor((r) => {
      if (!r || bannedRef.current) return;
      const apps = Array.isArray(r.apps) ? r.apps : [];
      // Avtomatik ishga tushgan dastur (Telegram, Teams va h.k.) jazo sababi bo'lmasin:
      // ilova uni darhol yopadi va talabaga aytadi. Qoidabuzarlik faqat dastur
      // yopilganiga qaramay 3 ta ketma-ket tekshiruvda (~30 s) qayta ochilsa yoziladi.
      const seen = desktopSeenRef.current;
      const present = new Set(apps.map((a) => a.name));
      for (const key of Object.keys(seen)) if (!present.has(key)) delete seen[key];
      const fresh: string[] = [];
      for (const a of apps) {
        seen[a.name] = (seen[a.name] || 0) + 1;
        if (seen[a.name] === 1) fresh.push(`${a.label}: ${a.name}`);
      }
      if (apps.length) void d.closeApps(apps.map((a) => a.name)).catch(() => {});
      if (fresh.length) {
        showWarningMsg(
          `Imtihon vaqtida taqiqlangan dastur yopildi (${fresh.join('; ')}). Uni qayta ochmang — takrorlansa qoidabuzarlik yoziladi.`,
          6000,
        );
      }
      // Yopilganiga qaramay keyingi tekshiruvda ham ochiq (~6 s) YOKI shu imtihonda qayta ochilgan.
      const ever = desktopEverSeenRef.current;
      const persistent = apps.filter(
        (a) => (seen[a.name] || 0) >= 2 || ((seen[a.name] || 0) === 1 && ever.has(a.name)),
      );
      for (const a of apps) ever.add(a.name);
      const remote = persistent.filter((a) => a.cat === 'remote');
      const others = persistent.filter((a) => a.cat !== 'remote');
      if (r.remote) {
        report('REMOTE_CONTROL_SUSPECTED', 'RDP');
      } else if (remote.length) {
        report('REMOTE_CONTROL_SUSPECTED', remote.map((a) => a.name).join(', '));
      }
      const bt = Array.isArray(r.bluetooth) ? r.bluetooth : [];
      if (bt.length) {
        showWarningMsg(
          `Simsiz quloqchin ulangan (${bt.join(', ')}). Uni darhol uzing — imtihonda Bluetooth quloqchin taqiqlangan.`,
          5000,
        );
        report('BLUETOOTH_AUDIO_DEVICE', `Ulangan simsiz audio qurilma: ${bt.join(', ')}`);
      }
      if ((Number(r.displays) || 1) > 1) {
        report('MULTI_MONITOR_DETECTED', `Kompyuterga ${Number(r.displays)} ta ekran ulangan (ruxsat: 1 ta)`);
      }
      if (others.length) {
        report('DESKTOP_FORBIDDEN_APP', others.map((a) => `${a.label}: ${a.name}`).join('; '));
      }
    });
    return () => {
      offWindow?.();
      offMonitor?.();
    };
  }, [desktopBridge, sessionStarted, banned]);

  // Butun ekran rasmi (dalil) — foydalanuvchidan ruxsat so'ralmaydi, jazo bermaydi.
  useEffect(() => {
    const d = desktopBridge;
    if (!d || !sessionStarted || banned) return;
    let alive = true;
    const send = async () => {
      if (!alive || bannedRef.current) return;
      try {
        const shots = await d.captureScreens();
        const image = Array.isArray(shots) ? shots[0] : '';
        if (!image || !alive) return;
        const path = `/api/student/exams/${examIdRef.current}/screen-snapshot`;
        const body = JSON.stringify({ image });
        await fetch(apiUrl(path), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await nextGuardHeaders('POST', path, body)),
          },
          body,
        });
      } catch {
        /* dalil yuborilmadi — imtihonga ta'sir qilmaydi */
      }
    };
    const first = window.setTimeout(() => void send(), 8000);
    const id = window.setInterval(() => void send(), SCREEN_SNAPSHOT_MS);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [desktopBridge, sessionStarted, banned, nextGuardHeaders]);

  // --- Taqiqlangan ob'ektlar (telefon/kitob/noutbuk) — brauzer MediaPipe ObjectDetector ---
  useEffect(() => {
    // Motor: fullscreen + media yetarli (o'zi ham engine, tayyorligini kutmaydi).
    if (!proctorEnginesArmed) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let activeType: string | null = null;
    const OBJECT_LABEL: Record<string, 'livePhone' | 'liveBook' | 'liveLaptop'> = {
      FORBIDDEN_OBJECT_CELL_PHONE: 'livePhone',
      FORBIDDEN_OBJECT_BOOK: 'liveBook',
      FORBIDDEN_OBJECT_LAPTOP: 'liveLaptop',
    };

    const proctor = new ForbiddenObjectProctor(video, {
      isFrozen: () =>
        Boolean(smallWarnOpenRef.current || warningModalShowingRef.current || bannedRef.current),
      onSmall: (violationType) => {
        activeType = violationType;
        const key = OBJECT_LABEL[violationType] || 'livePhone';
        const label = withSmallCount(EXAM_L[langRef.current][key], violationType);
        setObjectLiveLabel(label);
        noteSmallWarningRef.current(violationType);
        showSmallWarnRef.current(`o:${violationType}`, violationType, label);
      },
      onClear: (violationType) => {
        smallWarningLedgerRef.current.noteCleared(violationType);
        if (activeType === violationType) {
          activeType = null;
          setObjectLiveLabel(null);
        }
      },
      onFormal: (violationType) => {
        formalIssuedFor(violationType);
        void logViolationRef.current(violationType);
      },
    });
    objectProctorRef.current = proctor;

    void proctor.init().then((ok) => {
      void reportProctorDiag('object-proctor', ok, ok ? undefined : proctor.lastError());
      if (cancelled || !ok) return;
      proctor.start();
    });

    return () => {
      cancelled = true;
      proctor.dispose();
      if (objectProctorRef.current === proctor) objectProctorRef.current = null;
      setObjectLiveLabel(null);
    };
  }, [proctorEnginesArmed, proctorStreamRevision]);

  // --- Server-side kadr tahlili (har 15s): yuz + telefon/kitob/noutbuk (Vision) ---
  useServerProctoring({
    examId: exam.id,
    videoRef,
    guardHeadersFn: nextGuardHeaders,
    onViolations: (types) => {
      for (const t of types) void logViolationRef.current(t);
    },
    intervalMs: 15_000,
    // Savol ko'rinmayotgan paytda (lobbi, to'liq-ekran kutuvi, engine yuklanishi)
    // ogohlantirish/strike berilmasligi kerak.
    disabled: !examArmed,
  });

  // --- Real-time brauzer proctoring (MediaPipe): gaze/bosh burilishi, qimirlash,
  //     qo'l/imo-ishora, ko'p yuz, yuz yo'q, pozitsiya. Server proctoring bilan gibrid ishlaydi. ---
  /** Imtihon oldi tekshiruvida o'lchangan tabiiy ko'z ochiqligi.
   *  Nigoh ("pastga qaradi") nazorati shunga NISBATAN ishlaydi — mutlaq
   *  chegara turli ko'z shakllarida soxta ogohlantirish berardi. */
  const eyeBaseline = React.useMemo(() => {
    try {
      const raw = sessionStorage.getItem(`exam_eye_baseline_${exam.id}`);
      const v = raw ? Number(raw) : NaN;
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  }, [exam.id]);

  useRealtimeProctoring({
    videoRef,
    streamRevision: proctorStreamRevision,
    eyeBaseline,
    // Motor: fullscreen + media yetarli. Uning tayyorligi `examArmed` ni ochadi.
    disabled: !proctorEnginesArmed,
    onReady: (ok, detail) => {
      setRealtimeEngineReady(ok);
      void reportProctorDiag('realtime-proctor', ok, detail);
    },
    onViolation: (type) => {
      // Uzluksiz eskalatsiya bo'yicha rasmiy berildi — shu tur hisobi nolga qaytadi.
      formalIssuedFor(type);
      void logViolationRef.current(type);
    },
    onRecheckIdentity: () => triggerIdentityCheckRef.current(),
    onFaceStatus: setFaceStatus,
    onMouthActivity: (active) => {
      mouthActiveRef.current = active;
    },
    onSmallWarningStage: (types) => {
      // Modal ochiq — nazorat muzlagan: bu kadrda hech narsa sanamaymiz.
      if (smallWarnOpenRef.current) return;
      // Har kadrda: hozir kichik-ogohlantirish bosqichidagi turlarni sanaymiz,
      // qolganlarini "epizod tugadi" deb yopamiz (keyingi safar yangi epizod).
      const active = new Set<string>(types.map(liveSignalViolationType));
      for (const key of ALL_LIVE_SIGNAL_VIOLATIONS) {
        // Gapirish video orqali hisoblanMAYDI (Silero audio).
        if (key === 'MOUTH_MOVEMENT_TALKING') continue;
        if (active.has(key)) noteSmallWarningRef.current(key);
        else smallWarningLedgerRef.current.noteCleared(key);
      }
    },
    onLiveSignal: (type) => {
      // Modal ochiq — nazorat muzlagan: chip va modalni yangilamaymiz.
      if (smallWarnOpenRef.current) return;
      if (!type) {
        setLiveSignalLabel(null);
        return;
      }
      const msg = {
        TALKING: EXAM_L[langRef.current].liveTalking,
        HEAD_AWAY: EXAM_L[langRef.current].liveHeadAway,
        TOO_FAR: EXAM_L[langRef.current].liveTooFar,
        TOO_CLOSE: EXAM_L[langRef.current].liveTooClose,
        OFF_CENTER: EXAM_L[langRef.current].liveOffCenter,
        MOVEMENT: EXAM_L[langRef.current].liveMovement,
        HAND: EXAM_L[langRef.current].liveHand,
        NO_FACE: EXAM_L[langRef.current].liveNoFace,
        MULTI_FACE: EXAM_L[langRef.current].liveMultiFace,
      }[type];
      // Gapirish chip/modal — faqat Silero audio (pastdagi interval).
      if (type === 'TALKING') return;
      const violationType = liveSignalViolationType(type);
      const label = withSmallCount(msg, violationType);
      setLiveSignalLabel(label);
      showSmallWarnRef.current(`v:${type}`, violationType, label);
    },
  });

  // --- Periodic identity match (Gemini serverda) ---
  // 90 soniyada bir marta; faqat yuz aniqlanganida.
  const identityFailCountRef = useRef(0);
  /** Tarmoq xatosidan keyin bir martalik qayta urinish belgisi (cheksiz sikl bo'lmasin). */
  const retriedRef = useRef(false);
  // Real-time engine person-swap shubhasida darhol identity tekshiruvini ishga tushiradi.
  const triggerIdentityCheckRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (banned || !user.profile_image || !sessionStarted) return;

    const setIdStatus = (s: 'idle' | 'checking' | 'ok' | 'fail') => {
      if (identityStatusTimerRef.current !== null) {
        clearTimeout(identityStatusTimerRef.current);
        identityStatusTimerRef.current = null;
      }
      setIdentityStatus(s);
      // 'ok'/'fail' ko'rsatilgach 2.5s da 'idle' ga qaytadi
      if (s === 'ok' || s === 'fail') {
        identityStatusTimerRef.current = window.setTimeout(() => {
          setIdentityStatus('idle');
          identityStatusTimerRef.current = null;
        }, 2500);
      }
    };

    const runCheck = async () => {
      if (bannedRef.current || identityCheckBusyRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      identityCheckBusyRef.current = true;
      setIdStatus('checking');
      try {
        const liveDataUrl = compressVideoFrameToJpeg(video, 0.55, 280);
        if (!liveDataUrl) { setIdStatus('idle'); return; }
        const liveB64 = liveDataUrl.split(',')[1];
        const prof = String(user.profile_image);

        const identityBody = JSON.stringify({
          exam_id: examIdRef.current,
          profile_image_base64: prof,
          live_capture_base64: liveB64,
        });
        const res = await fetch(apiUrl('/api/student/identity-compare'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await nextGuardHeaders(
              'POST', '/api/student/identity-compare', identityBody,
            )),
          },
          body: identityBody,
        });
        syncVacIfOk(res);

        if (res.status === 503 || res.status === 429) {
          identityFailCountRef.current = 0;
          setIdStatus('idle');
          return;
        }
        if (!res.ok) { setIdStatus('idle'); return; }

        const data = (await readJsonSafe<{ match?: boolean }>(res)) || {};
        if (!data.match) {
          identityFailCountRef.current += 1;
          setIdStatus('fail');
          if (identityFailCountRef.current >= 3) {
            await logViolationRef.current('IDENTITY_SUBSTITUTION');
          }
        } else {
          identityFailCountRef.current = 0;
          setIdStatus('ok');
        }
      } catch {
        // Tarmoq uzilishi (net::ERR_NETWORK_CHANGED — Wi-Fi almashdi, VPN, IP
        // yangilandi). Bu TALABANING aybi emas: qoidabuzarlik yozilmaydi va
        // identityFailCount ham oshmaydi. Lekin keyingi tekshiruvgacha
        // IDENTITY_CHECK_MS (90s) proctoring bo'shlig'i qolmasin — bir marta
        // tez qayta urinamiz.
        setIdStatus('idle');
        if (!retriedRef.current) {
          retriedRef.current = true;
          identityCheckBusyRef.current = false;
          window.setTimeout(() => {
            if (!bannedRef.current && sessionStartedRef.current) void runCheck();
          }, 4000);
          return;
        }
      } finally {
        identityCheckBusyRef.current = false;
      }
      retriedRef.current = false;
    };

    triggerIdentityCheckRef.current = () => { void runCheck(); };
    const id = window.setInterval(runCheck, IDENTITY_CHECK_MS);
    void runCheck();
    return () => {
      clearInterval(id);
      if (identityStatusTimerRef.current !== null) clearTimeout(identityStatusTimerRef.current);
    };
  }, [banned, user.profile_image, nextGuardHeaders, sessionStarted]);

  // --- Tab / visibility (masofaviy nazorat) ---
  // Oyna yashiringan holati (document.visibilityState === 'hidden') — DAVOMIY holat,
  // shu sabab u ham yagona darvoza (eventGateRef) orqali qonunga bo'ysunadi: 4s uzluksiz
  // boshqa oynada qolsa rasmiy (TAB_SWITCH_HARD). Poll markazlashgan gate tick loopida.
  // Bu yerda faqat pagehide (sahifadan chiqib ketish) — bu terminal hodisa, kutib
  // bo'lmaydi, shu sabab darhol yozib qoldiramiz (eng oxirgi signal).
  useEffect(() => {
    const onPageHide = () => {
      if (!tabGuardRef.current.armed) return;
      void logViolationRef.current('TAB_SWITCH_SOFT');
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  const runSubmitCore = useCallback(
    async (ans: Record<string, string>, fl: number[]) => {
      if (submittingRef.current || bannedRef.current) return;
      if (isOffline) {
        showWarningMsg(t.offlineSubmit, 4000);
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
      try {
        // Imzo AYNAN yuboriladigan tana bo'yicha hisoblanadi — shuning uchun
        // tana bir marta tuziladi va ikkalasida ham o'sha ishlatiladi.
        const submitBody = JSON.stringify({
          answers: ans,
          flaggedQuestions: fl,
          student_lang: langRef.current,
          timings: buildTimings(qTimingRef.current, qShownRef.current),
        });
        const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/submit`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // TIL MAJBURIY: `auto` tilli imtihonda savollar talabaning UI tilida
            // beriladi (/start `X-Student-Lang` bilan), lekin submit'da bu sarlavha
            // yuborilmasdi va server "uz" ga qaytardi — talaba ru/en da yechgan
            // bo'lsa javoblari boshqa tildagi variantlar bilan solishtirilardi.
            'X-Student-Lang': langRef.current,
            ...(await nextGuardHeaders(
              'POST', `/api/student/exams/${exam.id}/submit`, submitBody,
            )),
          },
          body: submitBody,
        });
        syncVacIfOk(res);
        const json = await readJsonSafe<ExamResultPayload & { error?: string }>(res);
        if (!res.ok) {
          showWarningMsg(String(json?.error || t.submitError), 5000);
          submittingRef.current = false;
          setSubmitting(false);
          return;
        }
        if (!json?.result_public_id || !Array.isArray(json.questions)) {
          showWarningMsg(t.submitError, 5000);
          submittingRef.current = false;
          setSubmitting(false);
          return;
        }
        safeLocalRemove(`exam_answers_${exam.id}`);
        safeLocalRemove(`exam_answers_ts_${exam.id}`);
        releaseAllExamResources();
        const payload: ExamResultPayload = {
          exam_id: json.exam_id,
          result_public_id: json.result_public_id,
          verify_url: json.verify_url,
          overview: json.overview ?? '',
          ai_summary_source: json.ai_summary_source,
          ai_summary_pending: json.ai_summary_pending,
          questions: json.questions,
          score: json.score,
          total: json.total,
          integrity_code: json.integrity_code,
          percentage: json.percentage,
          completed_at: json.completed_at,
          exam_title: exam.title,
          student_name: user.name || user.id,
          student_group: user.group_name || '',
        };
        onFinish(payload);
      } catch (err) {
        console.error('Failed to submit', err);
        showWarningMsg(t.submitError, 5000);
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [exam.id, exam.title, token, user.name, user.id, onFinish, isOffline, t.offlineSubmit, t.submitError, nextGuardHeaders, releaseAllExamResources]
  );

  // --- Savolga vaqt va orqaga qaytmaslik (server `question_lock` bergan bo'lsa) ---
  // Joriy savol javobi "Keyingi" bosilganda yoki vaqt tugaganda SERVERDA qulflanadi.
  type QLockState = {
    enabled: boolean;
    index: number;
    total: number;
    per_question_seconds: number;
    remaining_seconds: number;
    min_read_seconds?: number;
  };
  const qLock = (exam.question_lock || null) as QLockState | null;
  const lockOn = Boolean(qLock?.enabled);
  const [lockIdx, setLockIdx] = useState<number>(() => Number(qLock?.index || 0));
  const [qRemain, setQRemain] = useState<number>(() => Number(qLock?.remaining_seconds || 0));
  const lockIdxRef = useRef(lockIdx);
  const lockBusyRef = useRef(false);
  const lockArmedRef = useRef(false);
  const lockRetryRef = useRef(0);
  /** Joriy savol tugash vaqti (server qaytargan qolgan soniyadan). */
  const lockDeadlineRef = useRef(0);
  /** Savolni o'qish uchun eng kam vaqt: undan oldin 'Keyingi' ishlamaydi (server ham qabul qilmaydi). */
  const lockSecsRef = useRef(0);
  const lockMinReadRef = useRef(0);
  const [readLeft, setReadLeft] = useState(0);
  const readLeftRef = useRef(0);
  const watermarkBg = React.useMemo(
    () => watermarkBackground(`${user?.id ?? ''} · ${user?.name ?? ''}`),
    [user?.id, user?.name],
  );
  const applyLockState = useCallback((st?: Partial<QLockState> | null) => {
    if (!st || typeof st.index !== 'number') return;
    lockIdxRef.current = st.index;
    setLockIdx(st.index);
    const rem = Math.max(0, Number(st.remaining_seconds || 0));
    lockDeadlineRef.current = Date.now() + rem * 1000;
    if (typeof st.per_question_seconds === 'number') lockSecsRef.current = st.per_question_seconds;
    if (typeof st.min_read_seconds === 'number') lockMinReadRef.current = st.min_read_seconds;
    setQRemain(rem);
  }, []);
  useEffect(() => {
    if (qLock?.enabled) applyLockState(qLock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLock?.enabled, qLock?.index, qLock?.remaining_seconds, applyLockState]);
  useEffect(() => {
    if (!lockOn) return;
    const target = Math.min(lockIdx, Math.max(0, totalQuestions - 1));
    if (qIndex !== target) setQIndex(target);
  }, [lockOn, lockIdx, qIndex, totalQuestions]);

  const postLock = useCallback(
    async (payload: Record<string, unknown>) => {
      const path = `/api/student/exams/${exam.id}/question-advance`;
      const body = JSON.stringify({ ...payload, student_lang: langRef.current });
      // Osilib qolgan so'rov qulfni to'xtatib qo'ymasin: 10 s dan keyin bekor qilinadi.
      const ctrl = new AbortController();
      const abortTimer = window.setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(apiUrl(path), {
        signal: ctrl.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Student-Lang': langRef.current,
          ...(await nextGuardHeaders('POST', path, body)),
        },
        body,
      }).finally(() => window.clearTimeout(abortTimer));
      syncVacIfOk(res);
      const data =
        (await readJsonSafe<{ state?: QLockState; sessionStatus?: string; banReason?: string }>(res)) || {};
      return { res, data };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exam.id, nextGuardHeaders],
  );

  const advanceQuestion = useCallback(async () => {
    if (!lockOn || lockBusyRef.current || bannedRef.current || submittingRef.current) return;
    const idx = lockIdxRef.current;
    if (idx >= totalQuestions) {
      void runSubmitCore(answersRef.current, flaggedRef.current);
      return;
    }
    const q = examQuestions[idx];
    if (!q) return;
    lockBusyRef.current = true;
    let retry = false;
    try {
      const qid = String(q.id);
      const { res, data } = await postLock({ action: 'advance', qid, answer: answersRef.current[qid] || '' });
      if (!res.ok && data.sessionStatus) {
        sessionGoneRef.current(data.sessionStatus, data.banReason);
        return;
      }
      if ((data as { code?: string }).code === 'TOO_EARLY') {
        const w = Number((data as { wait?: number }).wait || 1);
        showWarningMsg((LOCK_L[langRef.current] || LOCK_L.uz).early.replace('{n}', String(w)), 2500);
        if (data.state) applyLockState(data.state);
        return;
      }
      if (data.state) {
        lockRetryRef.current = 0;
        applyLockState(data.state);
        if (data.state.index >= totalQuestions) {
          void runSubmitCore(answersRef.current, flaggedRef.current);
        }
      } else {
        retry = true;
      }
    } catch {
      retry = true;
    } finally {
      lockBusyRef.current = false;
    }
    if (retry && lockRetryRef.current < 8) {
      lockRetryRef.current += 1;
      // Faqat hali o'sha savolda turgan bo'lsak — aks holda keyingi savol javobsiz qulflanardi.
      const expected = idx;
      window.setTimeout(() => {
        if (lockIdxRef.current === expected) void advanceRef.current();
      }, 2500);
    }
  }, [lockOn, totalQuestions, examQuestions, postLock, applyLockState, runSubmitCore]);
  const advanceRef = useRef(advanceQuestion);
  advanceRef.current = advanceQuestion;

  // Imtihon oynasi har safar tayyor holatga kelganda (boshlanish, to'liq ekranga qaytish,
  // ilova qayta ochilishi) serverdan joriy savol va qolgan vaqt olinadi. Birinchi marta
  // birinchi savol soatini boshlaydi; keyingi chaqiruvlar soatni yangilamaydi.
  useEffect(() => {
    if (!lockOn || !sessionStarted || banned || !examArmed) return;
    let alive = true;
    let timer = 0;
    const arm = () => {
      void postLock({ action: 'arm' })
        .then(({ data }) => {
          if (!alive) return;
          if (data.state) {
            lockArmedRef.current = true;
            applyLockState(data.state);
          } else {
            timer = window.setTimeout(arm, 3000);
          }
        })
        .catch(() => {
          if (alive) timer = window.setTimeout(arm, 3000);
        });
    };
    arm();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [lockOn, sessionStarted, banned, examArmed, postLock, applyLockState]);

  useEffect(() => {
    if (!lockOn || !sessionStarted || banned || !examArmed) return;
    const tick = () => {
      const rem = Math.max(0, Math.ceil((lockDeadlineRef.current - Date.now()) / 1000));
      setQRemain(rem);
      const elapsed = Math.max(0, lockSecsRef.current - rem);
      const left = Math.max(0, Math.ceil(lockMinReadRef.current - elapsed));
      readLeftRef.current = left;
      setReadLeft(left);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [lockOn, sessionStarted, banned, examArmed]);

  useEffect(() => {
    if (!lockOn || !sessionStarted || banned || !examArmed || !lockArmedRef.current) return;
    if (qRemain <= 0) void advanceRef.current();
  }, [lockOn, sessionStarted, banned, examArmed, qRemain, lockIdx]);

  // --- Klaviatura: A–E javobni tanlaydi, Enter — keyingi savol ---
  useEffect(() => {
    if (!sessionStarted || banned) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.repeat) return;
      const tgt = ev.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
      if (submitConfirm || warningModalShowingRef.current || smallWarnOpenRef.current || submittingRef.current) return;
      // Qoplamalar (to'liq ekran, ekran ulashish, bloklash) ochiq bo'lsa yoki tugma (kalkulyator) fokusda — ishlamaydi.
      if (!examArmed || needsFullscreenRef.current || needsScreenShare || hardBlocked || examRetakeNotice != null) return;
      if (tgt && typeof tgt.closest === 'function' && tgt.closest('button,[role="dialog"]')) return;
      const q = currentQ;
      if (!q) return;
      const k = String(ev.key || '').toLowerCase();
      let idx = -1;
      // Faqat harflar: raqamlar kalkulyatorda yozilganda javob tasodifan o'zgarmasin.
      if (/^[a-i]$/.test(k)) idx = k.charCodeAt(0) - 97;
      if (idx >= 0 && idx < currentOptions.length) {
        ev.preventDefault();
        const qid = String(q.id);
        const opt = currentOptions[idx];
        const shown = qShownRef.current;
        const r = qTimingRef.current[qid] || { ms: 0, first: null, changes: 0 };
        if (r.first == null) {
          r.first = r.ms + (shown && shown.id === qid ? Math.max(0, Date.now() - shown.at) : 0);
        }
        r.changes += 1;
        qTimingRef.current[qid] = r;
        setAnswers((prev) => ({ ...prev, [qid]: opt }));
        return;
      }
      if (ev.key === 'Enter' && qIndex < totalQuestions - 1) {
        ev.preventDefault();
        if (lockOn) void advanceRef.current();
        else setQIndex((i) => Math.min(totalQuestions - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionStarted, banned, submitConfirm, currentQ, currentOptions, qIndex, totalQuestions, lockOn, examArmed, needsScreenShare, hardBlocked, examRetakeNotice]);

  const handleSubmit = () => runSubmitCore(answersRef.current, flaggedRef.current);

  const startExamSession = useCallback(async () => {
    if (startingSession || sessionStartedRef.current) return;
    setStartingSession(true);
    setStartError('');
    try {
      if (fullscreenSupportedRef.current && !getFullscreenElement()) {
        requestExamFullscreen();
      }
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume().catch(() => {});
      }
      await sileroRef.current?.resume();
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/start`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Student-Lang': langRef.current,
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({ pin: exam.preExamPin || '', student_lang: langRef.current, client_features: ['question_lock'] }),
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
        setStartError(data?.error || t.preExamStartError);
        return;
      }
      if (data.deviceToken) {
        setDeviceSessionToken(data.deviceToken, token);
      }
      const merged = {
        ...data.exam,
        startedAt: data.startedAt,
        sessionKey: data.sessionKey,
        sessionSeqStart: data.sessionSeqStart,
        sessionChallenge: data.sessionChallenge,
        preExamPin: exam.preExamPin,
      };
      setExam(merged);
      setStudentExamId(data.studentExamId);
      vacStateRef.current = {
        seq: Number(data.sessionSeqStart || 1),
        challengeSeed: data.sessionChallenge,
      };
      // MUHIM: `duration_minutes` emas, SERVER bergan `submission_deadline`.
      // Server chegarasi = min(exam.end_time, boshlangan_vaqt + davomiylik).
      // Talaba imtihon oynasi tugashiga 10 daqiqa qolganda kirsa, unga 10
      // daqiqa qoladi — ilgari bu yerda 60:00 ko'rsatilib, keyin taymer
      // serverga sinxronlanganda keskin sakrab tushardi.
      setTimeLeft(initialSecondsLeft(merged));
      // Fullscreen ochilmagan / rad etilgan — darhol gate (imtihon blok).
      if (fullscreenSupportedRef.current && !getFullscreenElement()) {
        needsFullscreenRef.current = true;
        setNeedsFullscreen(true);
        if (fullscreenLeftAtRef.current == null) fullscreenLeftAtRef.current = Date.now();
      }
    } catch {
      setStartError(t.preExamNetworkError);
    } finally {
      setStartingSession(false);
    }
  }, [
    exam.id,
    exam.preExamPin,
    startingSession,
    t.preExamNetworkError,
    t.preExamStartError,
    token,
    requestExamFullscreen,
    getFullscreenElement,
  ]);

  // Vaqt tugaganda darhol topshirish (sahifa yuklanganda ham)
  useEffect(() => {
    if (banned || submittingRef.current || !sessionStarted) return;
    if (timeLeft <= 0) {
      void runSubmitCore(answersRef.current, flaggedRef.current);
    }
  }, [banned, timeLeft, runSubmitCore, sessionStarted]);

  // --- Countdown (oxirgi javoblar ref orqali) ---
  useEffect(() => {
    if (banned || !sessionStarted) return;
    const timer = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === 300) {
          setShowTimeWarning(true);
          window.setTimeout(() => setShowTimeWarning(false), 5000);
        }
        if (prev <= 1) {
          window.clearInterval(timer);
          void runSubmitCore(answersRef.current, flaggedRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [banned, runSubmitCore, sessionStarted]);

  // Bloklovchi modal (rasmiy ogohlantirish yoki ban) ochiq bo'lsa, navbatdagi xabar
  // ekranda ko'rinmaydi (ikkalasi ham markazda, balandroq z-index yopib qo'yadi) —
  // shuning uchun taymer FAQAT bloklovchi modal yo'qolgach boshlanadi. Aks holda xabar
  // hech qachon ko'rinmasdan turib taymer bilan sukut saqlab yo'qolib ketardi.
  const warningBlocked = Boolean(violationWarning) || banned || hardBlocked;
  useEffect(() => {
    if (warningBlocked) return;
    const current = warningQueue[0];
    if (!current) return;
    const timer = window.setTimeout(() => dismissWarningMsg(current.id), current.duration);
    return () => window.clearTimeout(timer);
  }, [warningBlocked, warningQueue, dismissWarningMsg]);

  // Har uch overlay holatida ham (ogohlantirish/ban/umumiy) ko'rinishi kerak —
  // pastdagi ikkita early-return asosiy JSX daraxtini almashtirib yuboradi,
  // shuning uchun bu modalni alohida hisoblab, har bir branchga qo'shib chiqamiz.
  const activeWarningMsg = warningBlocked ? undefined : warningQueue[0];
  const warningMsgModal = activeWarningMsg
    ? createPortal(
        <div
          className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/50 overflow-y-auto overscroll-y-contain px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="warning-msg-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-md rounded-lg sm:rounded-xl border-2 border-red-400 bg-red-50 shadow-2xl p-5 sm:p-7 text-center"
          >
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 sm:w-9 sm:h-9 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h2 id="warning-msg-title" className="text-lg sm:text-xl font-bold text-red-700 mb-2">{t.proctorWarningTitle}</h2>
            <p className="text-sm sm:text-base font-medium text-gray-800 break-words mb-5">{activeWarningMsg.text}</p>
            <button
              type="button"
              onClick={() => {
                blurIgnoreUntilRef.current = Date.now() + 2000;
                postWarningGraceUntilRef.current = Date.now() + 8000;
                setWarningQueue([]);
                fullscreenSuppressRef.current = true;
                needsFullscreenRef.current = false;
                requestExamFullscreen();
              }}
              className="w-full py-3 rounded-xl sm:rounded-lg font-semibold text-sm sm:text-base bg-red-600 hover:bg-red-700 text-white transition-all active:scale-[0.98]"
            >
              {t.violationContinueExam}
            </button>
          </motion.div>
        </div>,
        document.body,
      )
    : null;

  // --- Ogohlantirish modal (ban emas, davom etish mumkin) ---
  if (violationWarning && !banned && !hardBlocked) {
    const isFinal = violationWarning.isFinalWarning;
    const warnNum = violationWarning.warningNumber;
    const remaining = Math.max(0, maxOfficialWarnings - 1 - warnNum);

    const warnTitle = t.violationWarningTitle.replace('{n}', String(warnNum));
    const warnContinue = t.violationContinueExam;
    const reasonLabel = t.violationReasonLabel;
    const bannerText = isFinal
      ? t.violationFinalBanner
      : t.violationRemainingBanner.replace('{n}', String(remaining));

    return <>{createPortal(
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 overflow-y-auto overscroll-y-contain px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="violation-warn-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className={`w-full max-w-lg max-h-[min(90dvh,calc(100dvh-2rem))] flex flex-col min-h-0 rounded-lg sm:rounded-xl border-2 shadow-2xl ${
            isFinal ? 'border-red-400 bg-red-50' : 'border-orange-400 bg-orange-50'
          }`}
        >
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-5 sm:p-7">
            <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-5 ${isFinal ? 'bg-red-100' : 'bg-orange-100'}`}>
              <svg className={`w-7 h-7 sm:w-9 sm:h-9 ${isFinal ? 'text-red-600' : 'text-orange-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>

            <h2 id="violation-warn-title" className={`text-lg sm:text-xl font-bold text-center mb-2 leading-snug ${isFinal ? 'text-red-700' : 'text-orange-700'}`}>
              {warnTitle}
            </h2>

            <div className={`rounded-lg px-3 py-2.5 mb-4 text-center text-sm font-semibold leading-snug ${
              isFinal
                ? 'bg-red-600 text-white'
                : 'bg-orange-100 text-orange-900 border border-orange-300'
            }`}>
              {isFinal ? `⛔ ${bannerText}` : `⚠ ${bannerText}`}
            </div>

            <div className="bg-white rounded-xl sm:rounded-lg px-4 py-3 sm:px-5 sm:py-4 mb-4 text-center border border-gray-200">
              <p className="text-[10px] sm:text-xs text-gray-500 mb-1 uppercase tracking-wide font-medium">{reasonLabel}</p>
              <p className="text-sm sm:text-base font-semibold text-gray-800 break-words">{violationWarning.reason}</p>
            </div>

            <div className="mb-4">
              <WarningStepRow
                warningCount={warnNum}
                maxWarnings={maxOfficialWarnings}
                banReached={false}
                isFinalPending={isFinal}
                t={t}
              />
            </div>

            <ViolationHistoryList history={warningHistory} label={t.banWarningHistoryLabel} />

            {isFinal ? (
              <p className="text-[11px] sm:text-xs text-red-800/90 text-center mb-4 font-medium leading-relaxed">
                {t.violationFinalNotice}
              </p>
            ) : null}

            <p className="text-[11px] sm:text-xs text-gray-500 text-center mb-4 sm:mb-5 leading-relaxed">{t.violationFooterHonest}</p>
          </div>

          <div className="shrink-0 border-t border-black/5 p-4 sm:p-5 pt-3 sm:pt-4 bg-white rounded-b-2xl sm:rounded-b-3xl">
            <button
              type="button"
              onClick={resumeAfterViolationAck}
              className={`w-full py-3 sm:py-3.5 rounded-xl sm:rounded-lg font-semibold text-sm sm:text-base transition-all active:scale-[0.98] text-white ${
                isFinal ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600'
              }`}
            >
              {warnContinue}
            </button>
          </div>
        </motion.div>
      </div>,
      document.body,
    )}{warningMsgModal}</>;
  }

  // --- Qoidabuzarlik qayta topshirish ekrani ---
  if (examRetakeNotice != null) {
    const reasonText = examRetakeNotice.reason || t.violationReasonLabel;
    return <>{createPortal(
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 overflow-y-auto px-4 py-8"
        role="dialog"
        aria-modal="true"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-lg my-auto"
        >
          <div className="w-full text-center p-6 sm:p-8 rounded-lg border border-amber-200 bg-amber-50/95 shadow-2xl">
            <div className="w-20 h-20 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-amber-800 mb-4">{t.technicalRetakeTitle}</h2>
            <div className="text-left rounded-lg border border-amber-200 bg-white/80 px-4 py-3 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1.5">
                {t.technicalRetakeViolationLabel}
              </p>
              <p className="text-[14px] font-semibold text-gray-900 leading-relaxed">{reasonText}</p>
            </div>
            {/* Ikki xil hisob ATAYLAB ajratilgan. Ilgari ular yonma-yon turardi va
                talaba "2 marta sarflandi" ni ogohlantirishlar soni deb o'qirdi —
                aslida u QAYTA TOPSHIRISH hisobi. Ogohlantirishlar esa har yangi
                urinishda noldan boshlanadi (backend `proctor_official_warnings=0`
                qiladi), shuning uchun sarlavha "shu urinishdagi" deb aniqlashtirildi. */}
            <ViolationHistoryList
              history={warningHistory}
              label={t.technicalRetakeWarningsLabel}
            />
            <p className="text-gray-800 mb-2 leading-relaxed text-sm font-semibold">
              {t.technicalRetakeUsedRemaining
                .replace('{used}', String(examRetakeNotice.used))
                .replace('{remaining}', String(examRetakeNotice.remaining))}
            </p>
            <p className="text-gray-600 mb-6 leading-relaxed text-sm">{t.technicalRetakeBody}</p>
            {/* Yiqilganda majburiy qayta boshlash YO'Q — asosiy tugma bosh sahifaga
                qaytaradi; talaba imtihon vaqti tugamaguncha panelidan istalgan vaqtda
                qayta boshlaydi. Xohlasa, shu yerdan darhol ham boshlashi mumkin. */}
            <AdminBtn variant="blue" size="lg" className="w-full" onClick={() => onFinish(null)}>
              {t.technicalRetakeBackBtn}
            </AdminBtn>
            {onRetakeRestart ? (
              <button
                type="button"
                onClick={() => onRetakeRestart()}
                className="w-full mt-2.5 text-[13px] font-medium text-amber-700 hover:text-amber-800 underline underline-offset-2"
              >
                {t.technicalRetakeRestartNow}
              </button>
            ) : null}
          </div>
        </motion.div>
      </div>,
      document.body,
    )}</>;
  }

  // --- Ban ekrani (to'liq bloklash) ---
  if (banned || hardBlocked) {
    const banTitle = t.examEndedTitle;
    const banMsg = identityTerminated ? t.examTerminatedIdentity : t.examTerminatedWarnings;
    const banPdfLabel = t.banReportDownload;
    const backLabel = t.banBackToDashboard;

    return <>{createPortal(
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 overflow-y-auto overscroll-y-contain px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ban-ended-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-lg my-auto"
        >
          <div className="w-full text-center p-6 sm:p-8 max-h-[min(92dvh,100dvh-1rem)] overflow-y-auto overscroll-y-contain rounded-lg border border-red-200 bg-red-50/95 shadow-2xl shadow-red-500/10">
          <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 id="ban-ended-title" className="text-2xl font-bold text-red-600 mb-3 tracking-tight">{banTitle}</h2>
          <p className="text-gray-700 mb-4 leading-relaxed text-sm">{banMsg}</p>

          {banReasonLabel(lang, banReasonCode) ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-white px-4 py-3 text-left">
              <p className="text-[10px] uppercase tracking-wide text-red-700/80 font-semibold mb-1">
                {t.banReasonTitle}
              </p>
              <p className="text-sm font-semibold text-gray-900">{banReasonLabel(lang, banReasonCode)}</p>
            </div>
          ) : null}

          <div className="mb-5 rounded-xl border border-red-200 bg-white px-4 py-4 text-left space-y-4">
            <p className="text-sm font-bold text-red-800">{t.banProgressTitle}</p>
            <p className="text-[13px] text-gray-700 leading-relaxed">{t.banStepsExplainer}</p>
            <WarningStepRow
              warningCount={maxOfficialWarnings}
              maxWarnings={maxOfficialWarnings}
              banReached
              t={t}
            />
            {banLastReason ? (
              <div className="rounded-lg border border-red-100 bg-red-50/80 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-red-700/80 font-semibold mb-1">
                  {t.banLastViolationLabel}
                </p>
                <p className="text-sm font-semibold text-gray-900 break-words">{banLastReason}</p>
              </div>
            ) : null}
            {warningHistory.length > 0 ? (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
                  {t.banWarningHistoryLabel}
                </p>
                <ul className="space-y-1.5 text-[13px] text-gray-700">
                  {warningHistory.map((w) => (
                    <li key={w.number} className="flex gap-2">
                      <span className="shrink-0 font-bold text-orange-700">{w.number}.</span>
                      <span className="break-words">{w.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {banViolationsCount != null && (
            <p className="text-sm text-red-800/90 font-medium mb-5">
              {t.banRecordCountHint.replace('{n}', String(banViolationsCount))}
            </p>
          )}

          {unblockReady && (
            <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-left space-y-3">
              <p className="text-sm text-emerald-800 font-medium">{t.unblockAllowedMsg}</p>
              <AdminBtn variant="emerald" size="lg" className="w-full" onClick={continueAfterUnblock}>
                {t.resumeExam}
              </AdminBtn>
            </div>
          )}

          <div className="space-y-2.5">
            <AdminBtn
              variant="red"
              size="lg"
              className="w-full"
              loading={banPdfBusy}
              onClick={async () => {
                try {
                  setBanPdfBusy(true);
                  const res = await fetch(apiUrl(`/api/student/ban-report.pdf?exam_id=${exam.id}`), {
                    headers: { ...examAuthHeaders(token), 'X-Student-Lang': langRef.current },
                  });
                  if (!res.ok) throw new Error(t.pdfDownloadFailed);
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `BAN_REPORT_${user.id}.pdf`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                } catch (e) {
                  console.error(e);
                } finally {
                  setBanPdfBusy(false);
                }
              }}
            >
              {banPdfBusy ? t.downloading : banPdfLabel}
            </AdminBtn>
            <AdminBtn variant="ghost" size="lg" className="w-full" onClick={() => onFinish(null)}>
              {backLabel}
            </AdminBtn>
          </div>
          <div className="mt-5 border-t border-red-200/70 pt-5 text-left space-y-3">
            <p className="text-[13px] font-semibold text-gray-800">{t.banAppealTitle}</p>
            {myAppeals.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 space-y-2">
                <p className="text-[12px] font-semibold text-gray-700">{t.banAppealHistoryTitle}</p>
                {myAppeals.map((a) => (
                  <div key={a.id} className="text-[12px] text-gray-600 border-t border-gray-200/80 pt-2 first:border-0 first:pt-0">
                    <span className={`font-semibold ${
                      a.status === 'Approved' ? 'text-emerald-700' :
                      a.status === 'Rejected' ? 'text-red-700' : 'text-amber-700'
                    }`}>
                      {a.status === 'Approved' ? t.banAppealStatusApproved :
                        a.status === 'Rejected' ? t.banAppealStatusRejected : t.banAppealStatusPending}
                    </span>
                    {a.created_at && (
                      <span className="text-gray-400 ml-2">{new Date(a.created_at).toLocaleString()}</span>
                    )}
                    <p className="mt-1 text-gray-700 line-clamp-3">{a.reason}</p>
                    {a.review_note && <p className="mt-1 text-gray-500 italic">{a.review_note}</p>}
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder={t.banAppealPlaceholder}
              className="w-full min-h-[80px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors"
            />
            <p className={`text-[11px] text-right ${appealReason.trim().length >= 12 ? 'text-emerald-600' : 'text-gray-400'}`}>
              {appealReason.trim().length}/12 {t.banAppealMinChars}
            </p>
            {appealMsg ? (
              <AdminAlert type={appealMsg.startsWith('ok:') ? 'success' : 'error'}>
                {appealMsg.startsWith('ok:') ? appealMsg.slice(3) : appealMsg}
              </AdminAlert>
            ) : null}
            <AdminBtn
              variant="ghost"
              size="lg"
              className="w-full"
              loading={appealBusy}
              disabled={appealReason.trim().length < 12}
              onClick={async () => {
                try {
                  setAppealBusy(true);
                  setAppealMsg('');
                  const res = await fetch(apiUrl('/api/student/ban-appeals'), {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...examAuthHeaders(token),
                    },
                    body: JSON.stringify({
                      exam_id: exam.id,
                      reason: appealReason.trim(),
                    }),
                  });
                  const data = await readJsonSafe<{ error?: string }>(res);
                  if (!res.ok) {
                    setAppealMsg(data?.error || t.banAppealSubmitError);
                    return;
                  }
                  setAppealMsg(`ok:${t.banAppealSubmitOk}`);
                  setAppealReason('');
                  const listRes = await fetch(apiUrl('/api/student/ban-appeals'), { headers: examAuthHeaders(token) });
                  const listData = await readJsonSafe<typeof myAppeals>(listRes);
                  if (Array.isArray(listData)) {
                    setMyAppeals(listData.filter((a) => a.exam_id === exam.id));
                  }
                } finally {
                  setAppealBusy(false);
                }
              }}
            >
              {appealBusy ? t.banAppealSending : t.banAppealSubmitBtn}
            </AdminBtn>
          </div>
        </div>
        </motion.div>
      </div>,
      document.body,
    )}{warningMsgModal}</>;
  }

  // --- Yuz holati overlay konfiguratsiyasi ---
  const FACE_STATUS_CFG: Record<FaceStatusLive, { label: string; border: string; bg: string; text: string; icon: string }> = {
    OK:             { label: EXAM_L[lang].faceOk,       border: 'border-green-400',  bg: 'bg-green-500/90',  text: 'text-white', icon: '✓' },
    WAITING:        { label: EXAM_L[lang].faceWaiting, border: 'border-gray-300',   bg: 'bg-gray-700/80',   text: 'text-white', icon: '⋯' },
    NO_FACE:        { label: EXAM_L[lang].faceNoFace,  border: 'border-red-500',    bg: 'bg-red-600/90',    text: 'text-white', icon: '⚠' },
    MULTIPLE_FACES: { label: EXAM_L[lang].faceMulti,   border: 'border-red-500',    bg: 'bg-red-600/90',    text: 'text-white', icon: '⚠' },
    TOO_FAR:        { label: EXAM_L[lang].faceTooFar,  border: 'border-amber-400',  bg: 'bg-amber-500/90',  text: 'text-white', icon: '↔' },
    TOO_CLOSE:      { label: EXAM_L[lang].faceTooClose, border: 'border-amber-400', bg: 'bg-amber-500/90',  text: 'text-white', icon: '↔' },
    OFF_CENTER:     { label: EXAM_L[lang].liveOffCenter, border: 'border-amber-400',  bg: 'bg-amber-500/90',  text: 'text-white', icon: '⊕' },
    TURNED:         { label: EXAM_L[lang].liveHeadAway,  border: 'border-orange-400', bg: 'bg-orange-500/90', text: 'text-white', icon: '↻' },
    GAZE_AWAY:      { label: EXAM_L[lang].liveHeadAway,  border: 'border-orange-400', bg: 'bg-orange-500/90', text: 'text-white', icon: '👁' },
  };

  const toggleFlag = (qId: number) => {
    setFlaggedQuestions(prev => 
      prev.includes(qId) ? prev.filter(id => id !== qId) : [...prev, qId]
    );
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-50 overflow-hidden select-none">
      {/* ── Majburiy fullscreen qoplamasi ──
          Savollarni to'sib turadi: fullscreen'siz imtihon davom etmaydi.
          Matn ikki xil: birinchi kirishda neytral ("boshlash"), keyin esa
          "qayting" + sanoq. Bu qoplama chiqishining O'ZI qoidabuzarlik
          EMAS — jazо faqat FULLSCREEN_GRACE_MS ichida qaytilmasa yoziladi. */}
      <AnimatePresence>
        {needsFullscreen && !banned && sessionStarted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10060] flex items-center justify-center bg-slate-900/95 backdrop-blur-sm px-5"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="w-full max-w-md text-center rounded-2xl bg-white p-7 sm:p-9 shadow-2xl"
            >
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              </div>
              <h2 className="text-xl font-bold text-slate-900">
                {fullscreenEverEntered ? t.examFullscreenBackTitle : t.examFullscreenStartTitle}
              </h2>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                {fullscreenEverEntered ? t.examFullscreenBackBody : t.examFullscreenStartBody}
              </p>
              {fullscreenEverEntered && (
                <p className="mt-3 text-xs font-semibold text-amber-600 tabular-nums">
                  {t.examFullscreenCountdown.replace('{n}', String(fullscreenGraceLeft))}
                </p>
              )}
              <button
                type="button"
                onClick={requestExamFullscreen}
                className="mt-6 w-full rounded-xl bg-indigo-600 py-3.5 font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:bg-indigo-700 active:scale-[0.98]"
              >
                {fullscreenEverEntered ? t.examFullscreenBackBtn : t.examFullscreenStartBtn}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Ekranni ulashish qoplamasi: ulashilmaguncha savollar yopiq ── */}
      <AnimatePresence>
        {screenShareRequired && needsScreenShare && !banned && sessionStarted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10055] flex items-center justify-center bg-slate-900/95 backdrop-blur-sm px-5"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-md text-center rounded-2xl bg-white p-7 sm:p-9 shadow-2xl">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              </div>
              <h2 className="text-xl font-bold text-slate-900">{(SCREEN_L[lang] || SCREEN_L.uz).title}</h2>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{(SCREEN_L[lang] || SCREEN_L.uz).body}</p>
              {screenShareError && (
                <p className="mt-3 text-xs font-semibold text-red-600">{screenShareError}</p>
              )}
              <button
                type="button"
                disabled={screenShareBusy}
                onClick={() => void reshareScreen()}
                className="mt-6 w-full rounded-xl bg-indigo-600 py-3.5 font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:bg-gray-300"
              >
                {(SCREEN_L[lang] || SCREEN_L.uz).btn}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Yuqori panel: sarlavha + progress + taymer + topshirish ── */}
      <header className="shrink-0 bg-white border-b border-gray-200 shadow-sm">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-4 sm:py-[1.125rem] grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5 min-h-[4.25rem]">
          <div className="min-w-0 sm:justify-self-start">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-gray-900 truncate leading-tight">{exam.title}</h1>
            <p className="text-[11px] sm:text-xs text-gray-400 truncate mt-0.5">
              {user.name}
              {user.group_name ? ` · ${user.group_name}` : ''}
            </p>
            {sessionStarted && (
              <div className="flex items-center gap-2 mt-1.5">
                <div className="hidden sm:block flex-1 h-2 bg-gray-200 rounded-full overflow-hidden max-w-[220px]">
                  <div className="h-full bg-indigo-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                  {t.questionProgress
                    .replace('{cur}', String(qIndex + 1))
                    .replace('{total}', String(totalQuestions))
                    .replace('{answered}', String(answeredCount))}
                </span>
              </div>
            )}
          </div>
          <div className={`flex flex-col items-center justify-center leading-none sm:justify-self-center ${timeLeft < 300 && sessionStarted ? 'text-red-600' : 'text-gray-700'}`}>
            <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70 mb-1">{t.timeRemaining}</span>
            <span className="font-mono text-2xl sm:text-[1.75rem] font-bold tabular-nums leading-none">
              {sessionStarted ? formatTime(timeLeft) : formatTime(exam.duration_minutes * 60)}
            </span>
          </div>
          <div className="hidden sm:block sm:justify-self-end" aria-hidden />
        </div>
      </header>

      {/* ── Asosiy tana: chapda savol, o'ngda proctoring paneli ── */}
      <div className="flex-1 min-h-0 w-full flex flex-col gap-2.5 p-3 sm:p-4 lg:px-6 overflow-y-auto lg:overflow-hidden">
        {sessionStarted && !banned && (
          <div className="shrink-0 flex flex-col gap-2.5">
            <AnimatePresence>
              {timeLeft <= 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="shrink-0 bg-red-500/10 border border-red-400/30 text-red-800 px-4 py-2.5 rounded-lg shadow-sm text-sm font-medium"
                >
                  {t.examTimeExpiredHint}
                </motion.div>
              )}
              {showTimeWarning && (
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="shrink-0 bg-orange-500/10 border border-orange-500/20 text-orange-700 px-4 py-2.5 rounded-lg relative flex items-center gap-3 shadow-sm"
                >
                  <svg className="w-5 h-5 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <div>
                    <strong className="font-semibold block text-sm">{t.timeWarningTitle}</strong>
                    {t.timeWarningBody.trim() ? <span className="text-xs">{t.timeWarningBody}</span> : null}
                  </div>
                </motion.div>
              )}
              {isOffline && (
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="shrink-0 bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 px-4 py-2.5 rounded-lg relative flex items-center gap-3 shadow-sm"
                >
                  <svg className="w-5 h-5 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <div>
                    <strong className="font-semibold block text-sm">{t.connectionLostTitle}</strong>
                    {t.connectionLostBody.trim() ? <span className="text-xs">{t.connectionLostBody}</span> : null}
                  </div>
                </motion.div>
              )}
              {!isOffline && realtimeSyncOffline && !realtimeBannerDismissed && (
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="shrink-0 bg-amber-50 border border-amber-200 text-amber-950 px-4 py-3 rounded-lg shadow-sm flex items-start gap-3"
                >
                  <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <div className="flex-1 min-w-0">
                    <strong className="font-semibold block text-sm">{t.realtimeSyncOfflineTitle}</strong>
                    <span className="text-xs text-amber-900/90">{t.realtimeSyncOfflineBodyShort}</span>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        type="button"
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition"
                        onClick={() => {
                          setRealtimeBannerDismissed(false);
                          setProctorRetryNonce((n) => n + 1);
                        }}
                      >
                        {t.realtimeSyncRetry}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-300 text-amber-900 hover:bg-amber-100 transition"
                        onClick={() => setRealtimeBannerDismissed(true)}
                      >
                        {t.realtimeSyncDismiss}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:flex-1 lg:min-h-0">
        {/* Chap ustun: lobby yoki savollar */}
        <div className={`flex flex-col gap-2.5 lg:flex-1 lg:min-h-0 min-w-0 ${!sessionStarted && !banned ? 'lg:justify-center' : 'lg:justify-start'}`}>
          {!sessionStarted && !banned ? (
            <div className="flex-1 flex flex-col items-center justify-center py-6 lg:py-10">
              <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-sm p-6 sm:p-8 text-center space-y-4">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                  <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{t.examLobbyTitle}</h2>
                  <p className="mt-2 text-sm text-gray-500 leading-relaxed">{t.examLobbyHint}</p>
                  <p className="mt-3 text-sm font-medium text-indigo-700 tabular-nums">
                    {exam.duration_minutes} {t.minutesShort} · {t.examLobbyQuestionCount.replace('{n}', String(totalQuestions))}
                  </p>
                </div>
                {startError && (
                  <AdminAlert type="error">{startError}</AdminAlert>
                )}
                <AdminBtn
                  variant="blue"
                  size="lg"
                  loading={startingSession}
                  onClick={() => void startExamSession()}
                  className="w-full sm:px-10"
                >
                  {startingSession ? t.preExamStarting : t.takeExam}
                </AdminBtn>
              </div>
            </div>
          ) : showExamMediaGate ? (
            <div className="flex-1 flex flex-col items-center justify-center py-6 lg:py-10">
              <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-sm p-6 sm:p-8 text-center space-y-4">
                {cameraErrorHint ? (
                  <>
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600">
                      <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    </div>
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{t.examMediaGateTitle}</h2>
                      <p className="mt-3 text-sm text-red-700 leading-relaxed whitespace-pre-line text-left">{cameraErrorHint}</p>
                      <p className="mt-2 text-xs text-gray-500 leading-relaxed">{t.preExamSiteSettingsHint}</p>
                    </div>
                    <AdminBtn
                      variant="blue"
                      size="lg"
                      onClick={() => {
                        setStartMediaGateDone(false);
                        setCameraErrorHint('');
                        setCameraPreviewOk(false);
                        setMicReady(false);
                        setProctorRetryNonce((n) => n + 1);
                      }}
                      className="w-full sm:px-10"
                    >
                      {t.examMediaGateRetry}
                    </AdminBtn>
                  </>
                ) : (
                  <>
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                      <svg className="h-7 w-7 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{t.examMediaGateTitle}</h2>
                      <p className="mt-2 text-sm text-gray-500 leading-relaxed">{t.examMediaGateBody}</p>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs font-medium text-gray-600">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${cameraPreviewOk ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cameraPreviewOk ? 'bg-emerald-500' : 'bg-gray-400 animate-pulse'}`} />
                          {cameraPreviewOk ? t.preExamCameraActive : t.examCameraLoadingPreview}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${micReady ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${micReady ? 'bg-emerald-500' : 'bg-gray-400 animate-pulse'}`} />
                          {micReady ? t.preExamMicActive : t.preExamMicInactive}
                        </span>
                        {/* Nazorat tizimi (MediaPipe) — imtihon shu tayyor bo'lguncha
                            ochilmaydi. Talaba nima kutilayotganini ko'rib tursin. */}
                        {requireRealtimeEngine && (
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${realtimeEngineReady ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${realtimeEngineReady ? 'bg-emerald-500' : 'bg-gray-400 animate-pulse'}`} />
                            {realtimeEngineReady ? EXAM_L[lang].engineReady : EXAM_L[lang].engineLoading}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Kamera darrov barqarorlashmasa — talaba kutib qolmasin. */}
                    {mediaGateSlow && (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-500 leading-relaxed">
                          {t.preExamSiteSettingsHint}
                        </p>
                        <AdminBtn
                          variant="blue"
                          size="lg"
                          onClick={() => {
                            setMediaGateSlow(false);
                            setStartMediaGateDone(false);
                            setCameraErrorHint('');
                            setCameraPreviewOk(false);
                            setMicReady(false);
                            setProctorRetryNonce((n) => n + 1);
                          }}
                          className="w-full sm:px-10"
                        >
                          {t.examMediaGateRetry}
                        </AdminBtn>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
          <>
          {warningMsgModal}

          {/* Savol kartasi — faqat variantlar ro'yxati ichida scroll bo'ladi */}
          {currentQ && (
            <motion.div
              key={currentQ.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              id={`question-${currentQ.id}`}
              className={`relative flex flex-col rounded-xl border bg-white overflow-hidden shadow-sm transition-all lg:flex-1 lg:min-h-0 ${flaggedQuestions.includes(currentQ.id) ? 'border-amber-300 ring-2 ring-amber-200' : 'border-gray-200'}`}
            >
              {/* Suv belgisi: talaba ID si va ismi (ekrandan olingan rasm tarqalsa — kimligi aniqlanadi) */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-10 select-none"
                style={{ backgroundImage: watermarkBg, backgroundRepeat: 'repeat' }}
              />
              <div className="shrink-0 bg-gray-50/80 border-b border-gray-100 px-4 sm:px-5 py-3 flex items-start justify-between gap-3">
                <p className="text-[15px] xl:text-[17px] font-medium leading-relaxed text-gray-900 flex-1">
                  <span className="text-indigo-600 font-bold mr-2">{qIndex + 1}.</span>
                  {exam.secure_text ? (
                    <SecureText text={currentQParsed.cleanText || currentQ.text} fontSize={15} fontWeight={500} color="#111827" />
                  ) : (
                    currentQParsed.cleanText || currentQ.text
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => toggleFlag(currentQ.id)}
                  className={`shrink-0 ml-3 p-2 rounded-lg transition-colors ${flaggedQuestions.includes(currentQ.id) ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                  title={t.flagQuestion}
                >
                  <svg className="w-4.5 h-4.5" fill={flaggedQuestions.includes(currentQ.id) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>
                </button>
              </div>
              <div className="p-3 sm:p-4 space-y-2.5 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain">
                {currentQParsed.images.map((img, idx) => (
                  <div key={`${currentQ.id}-img-${idx}`} className="mb-3">
                    <img
                      src={img}
                      alt={`Question ${qIndex + 1} image ${idx + 1}`}
                      className="max-h-60 w-auto rounded-xl border border-slate-200"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ))}
                {currentOptions.map((opt: string, optIndex: number) => (
                  <label
                    key={`${currentQ.id}-opt-${optIndex}`}
                    className={`flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-lg cursor-pointer transition-all duration-200 border ${
                      answers[String(currentQ.id)] === opt
                        ? 'bg-indigo-50 border-indigo-300 shadow-sm ring-1 ring-indigo-200'
                        : 'bg-white border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/40'
                    }`}
                  >
                    <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold transition-colors ${
                      answers[String(currentQ.id)] === opt
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      {optionLetter(optIndex)}
                    </div>
                    <input
                      type="radio"
                      name={`q-${currentQ.id}`}
                      value={exam.secure_text ? String(optIndex) : opt}
                      checked={answers[String(currentQ.id)] === opt}
                      onChange={() => {
                        const qid = String(currentQ.id);
                        const shown = qShownRef.current;
                        const r = qTimingRef.current[qid] || { ms: 0, first: null, changes: 0 };
                        if (r.first == null) {
                          r.first = r.ms + (shown && shown.id === qid ? Math.max(0, Date.now() - shown.at) : 0);
                        }
                        r.changes += 1;
                        qTimingRef.current[qid] = r;
                        setAnswers((prev) => ({
                          ...prev,
                          [qid]: opt,
                        }));
                      }}
                      className="sr-only"
                    />
                    <span className={`text-[15px] xl:text-base leading-snug flex-1 ${answers[String(currentQ.id)] === opt ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                      {exam.secure_text ? (
                        <SecureText
                          text={opt}
                          fontSize={15}
                          fontWeight={answers[String(currentQ.id)] === opt ? 600 : 400}
                          color={answers[String(currentQ.id)] === opt ? '#0f172a' : '#334155'}
                          lineHeight={1.4}
                        />
                      ) : (
                        opt
                      )}
                    </span>
                  </label>
                ))}
                {currentOptions.length === 0 && (
                  <AdminAlert type="error">{t.examOptionsMissing}</AdminAlert>
                )}
              </div>

              {/* Navigatsiya — savol kartasi ichida, doim ko'rinib turadi */}
              <div className="shrink-0 flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 border-t border-gray-100 bg-gray-50/60">
                {lockOn ? (
                  <span className="text-[11px] sm:text-[12px] font-medium text-gray-400">{(LOCK_L[lang] || LOCK_L.uz).locked}</span>
                ) : (
                <AdminBtn
                  variant="ghost"
                  size="md"
                  disabled={qIndex <= 0}
                  onClick={() => setQIndex((i) => Math.max(0, i - 1))}
                  icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>}
                >
                  {t.examNavPrev}
                </AdminBtn>
                )}
                <span className="inline-flex items-center gap-2 shrink-0">
                  <span className="text-[12px] font-medium text-gray-400 tabular-nums">{qIndex + 1} / {totalQuestions}</span>
                  <span className="hidden xl:inline text-[11px] text-gray-400">
                    {lang === 'ru' ? 'Клавиши: A–E — ответ, Enter — далее' : lang === 'en' ? 'Keys: A–E answer, Enter next' : 'Klaviatura: A–E — javob, Enter — keyingi'}
                  </span>
                  {lockOn && (
                    <span
                      title={(LOCK_L[lang] || LOCK_L.uz).time}
                      className={`rounded-md px-2 py-0.5 text-[12px] font-bold tabular-nums ${qRemain <= 10 ? 'bg-red-100 text-red-700' : 'bg-indigo-50 text-indigo-700'}`}
                    >
                      ⏱ {formatTime(qRemain)}
                    </span>
                  )}
                </span>
                {/* Yakunlash FAQAT barcha savollar yechilganda. Oxirgi savolda
                    hali javobsizlar bo'lsa — oldinga yo'l yo'q, orqaga qaytish mumkin. */}
                {qIndex >= totalQuestions - 1 ? (
                  allAnswered || lockOn ? (
                    <AdminBtn
                      variant="blue"
                      size="md"
                      loading={submitting}
                      onClick={() => setSubmitConfirm(true)}
                      iconRight={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                    >
                      {submitting ? t.submitting : t.submitExam}
                    </AdminBtn>
                  ) : (
                    <span className="text-[11px] sm:text-[12px] font-medium text-amber-700 max-w-[9.5rem] sm:max-w-[11rem] text-right leading-snug">
                      {t.submitConfirmUnanswered
                        .replace('{n}', String(Math.max(0, totalQuestions - answeredCount)))
                        .replace('{total}', String(totalQuestions))}
                    </span>
                  )
                ) : (
                  <AdminBtn
                    variant="blue"
                    size="md"
                    disabled={lockOn && readLeft > 0}
                    onClick={() => {
                      if (lockOn) void advanceRef.current();
                      else setQIndex((i) => Math.min(totalQuestions - 1, i + 1));
                    }}
                    iconRight={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>}
                  >
                    {lockOn && readLeft > 0 ? `${(LOCK_L[lang] || LOCK_L.uz).read} · ${readLeft} s` : t.examNavNext}
                  </AdminBtn>
                )}
              </div>
            </motion.div>
          )}
          </>
          )}
        </div>

        {/* O'ng panel: kamera + (faqat boshlangandan keyin) savollar */}
        <aside className="w-full lg:w-[17.5rem] xl:w-72 2xl:w-80 shrink-0 flex flex-col gap-2 lg:sticky lg:top-3">
          {(() => {
            const fsCfg = FACE_STATUS_CFG[faceStatus] ?? FACE_STATUS_CFG.WAITING;
            const isOk = faceStatus === 'OK';
            // Indikator KAMERA/MIKROFON holatini ko'rsatadi, yuz aniqlashni emas.
            // Ilgari u `faceStatus` ga bog'langan edi: real-time engine (MediaPipe)
            // ishga tushmagan mashinada `WAITING` da qotib qolar, nuqta abadiy
            // qizil turar va yozuv `!isWaiting` sharti bilan YASHIRILARDI — ya'ni
            // talaba "qizil, lekin nima muammo ekani noma'lum" holatni ko'rardi.
            // Endi rang haqiqiy media holatidan keladi va yozuv HAR DOIM bo'ladi.
            const mediaLabel = !cameraPreviewOk
              ? t.examCameraLoadingPreview
              : !micReady
                ? t.preExamMicInactive
                : null;
            return (
              <div className="shrink-0 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        !proctorMediaReady
                          ? 'bg-red-500 animate-pulse'
                          : isOk
                            ? 'bg-green-500'
                            : 'bg-amber-500'
                      }`}
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 truncate">{t.examPanelCamera}</span>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0 ${
                      !proctorMediaReady
                        ? 'bg-red-50 text-red-700'
                        : isOk
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {mediaLabel ?? fsCfg.label}
                  </span>
                </div>
                {liveSignalLabel && (
                  <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-100 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                    <span className="text-[11px] font-medium text-amber-800 truncate">{liveSignalLabel}</span>
                  </div>
                )}
                {audioLiveLabel && (
                  <div className="px-3 py-1.5 bg-sky-50 border-b border-sky-100 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse shrink-0" />
                    <span className="text-[11px] font-medium text-sky-800 truncate">{audioLiveLabel}</span>
                  </div>
                )}
                {objectLiveLabel && (
                  <div className="px-3 py-1.5 bg-violet-50 border-b border-violet-100 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse shrink-0" />
                    <span className="text-[11px] font-medium text-violet-800 truncate">{objectLiveLabel}</span>
                  </div>
                )}
                {eventLiveLabel && (
                  <div className="px-3 py-1.5 bg-rose-50 border-b border-rose-100 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                    <span className="text-[11px] font-medium text-rose-800 truncate">{eventLiveLabel}</span>
                  </div>
                )}
                <div className="p-2 pb-2">
                  <div className={`rounded-lg overflow-hidden bg-black/5 border-2 relative aspect-[4/3] max-h-[200px] mx-auto transition-colors duration-300 ${fsCfg.border}`}>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      onLoadedMetadata={() => {
                        if (videoRef.current && videoRef.current.videoWidth > 0) {
                          setCameraPreviewOk(true);
                          if (syncMicReadyFromStream(streamRef.current)) setCameraErrorHint('');
                        }
                      }}
                      onPlaying={() => {
                        setCameraPreviewOk(true);
                        if (syncMicReadyFromStream(streamRef.current)) setCameraErrorHint('');
                      }}
                      className="w-full h-full object-cover"
                      style={{ transform: 'scaleX(-1)' }}
                    />
                    {/* Real-time yuz pozitsiyasi + identity overlay */}
                    {!cameraErrorHint && cameraPreviewOk && identityStatus !== 'idle' && (
                      <div className="absolute top-2 right-2">
                        <div className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-bold ${
                          identityStatus === 'checking' ? 'bg-blue-600/90 text-white' :
                          identityStatus === 'ok'       ? 'bg-emerald-600/90 text-white' :
                                                          'bg-red-600/90 text-white'
                        }`}>
                          {identityStatus === 'checking' ? 'ID…' : identityStatus === 'ok' ? 'ID ✓' : 'ID ✗'}
                        </div>
                      </div>
                    )}
                    {(cameraErrorHint || !cameraPreviewOk) && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center bg-white/75 text-[11px] sm:text-xs text-gray-800">
                        {cameraErrorHint ? (
                          <>
                            <span className="font-semibold text-red-700 leading-snug">{cameraErrorHint}</span>
                            <AdminBtn
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setCameraErrorHint('');
                                setCameraPreviewOk(false);
                                setMicReady(false);
                                setProctorRetryNonce((n) => n + 1);
                              }}
                            >
                              {t.examCameraReload}
                            </AdminBtn>
                          </>
                        ) : (
                          <span className="font-medium text-gray-600">{t.examCameraLoadingPreview}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {sessionStarted && !showExamMediaGate && (
          <>
          <div className="flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="shrink-0 px-3 py-2 border-b border-gray-100 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t.examPanelQuestions}</span>
              <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{answeredCount}/{totalQuestions}</span>
            </div>
            <div className="p-2.5">
              <div className="grid grid-cols-5 gap-1.5">
                {examQuestions.map((q: any, i: number) => {
                  const isAnswered = !!answers[q.id];
                  const isFlagged = flaggedQuestions.includes(q.id);
                  const isCurrent = i === qIndex;
                  return (
                    <button
                      type="button"
                      key={q.id}
                      disabled={lockOn && i !== qIndex}
                      onClick={() => {
                        if (!lockOn) setQIndex(i);
                      }}
                      className={`h-9 w-full rounded-md flex items-center justify-center text-xs font-semibold transition-all ${
                        isCurrent ? 'ring-2 ring-offset-1 ring-indigo-500' : ''
                      } ${
                        isFlagged ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-400' :
                        isAnswered ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20' :
                        'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-gray-500">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded bg-indigo-500" />{EXAM_L[lang].answered}</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded bg-yellow-100 border border-yellow-400" />{EXAM_L[lang].flagged}</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded bg-white border border-gray-300" />{EXAM_L[lang].empty}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-3 py-2 flex items-center justify-between border-b border-gray-100">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t.examPanelWarnings}</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3].map(num => (
                  <div
                    key={num}
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${
                      strikeLevel >= num ? 'bg-red-500' : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
            </div>
            {allAnswered || (lockOn && qIndex >= totalQuestions - 1) ? (
              <div className="p-2.5">
                <AdminBtn
                  variant="blue"
                  size="md"
                  loading={submitting}
                  onClick={() => setSubmitConfirm(true)}
                  className="w-full"
                >
                  {submitting ? t.submitting : t.submitExam}
                </AdminBtn>
              </div>
            ) : null}
          </div>
          </>
          )}
        </aside>
        </div>
      </div>
      <Calculator lang={lang} />

      {/* Kichik ogohlantirish (3 tadan) — RASMIY modaldan atayin KICHIK va FARQLI
          ko'rinishda (chalkashmasin: kattasi jiddiyroq). QO'SHIMCHA qatlam
          sifatida (early return EMAS!). MUHIM: bu modal tez-tez (har
          gapirish/harakat episodida) chiqadi — agar early return qilsak,
          pastdagi <video> elementi unmount/remount bo'lib, real-time MediaPipe
          nazorat dvigateli eski (endi ekrandan chiqib ketgan) video elementini
          tahlil qilishda davom etib, "ko'r" bo'lib qolardi (aynan shu xato bir
          marta qilingan va tuzatilgan). Video/kamera/WebSocket har doim mount
          holida qoladi — modal faqat ustidan bosib turadi. */}
      {smallWarn && !violationWarning && !banned && !hardBlocked && createPortal(
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="small-warn-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className="w-full max-w-xs rounded-xl border border-orange-300 bg-orange-50 shadow-xl p-4"
          >
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center bg-orange-100">
                <svg className="w-4.5 h-4.5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                    d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <h2 id="small-warn-title" className="text-sm font-bold leading-snug text-orange-700">
                {t.violationWarningTitle.replace('{n}', String(smallWarn.count))}
              </h2>
            </div>

            <p className="text-[13px] font-medium text-gray-800 break-words mb-2.5 leading-snug">
              {smallWarn.text}
            </p>

            <div className="flex items-center justify-center gap-1.5 mb-3">
              {Array.from({ length: SMALL_WARNINGS_BEFORE_FORMAL }, (_, i) => i + 1).map((n) => (
                <span
                  key={n}
                  className={`w-2 h-2 rounded-full ${
                    smallWarn.count >= n ? 'bg-orange-500' : 'bg-orange-200'
                  }`}
                />
              ))}
              <span className="text-[10px] text-orange-700/80 font-medium ml-1">
                {smallWarn.count}/{SMALL_WARNINGS_BEFORE_FORMAL}
              </span>
            </div>

            <button
              type="button"
              onClick={dismissSmallWarn}
              className="w-full py-2 rounded-lg font-semibold text-[13px] transition-all active:scale-[0.98] text-white bg-orange-500 hover:bg-orange-600"
            >
              {t.violationContinueExam}
            </button>
          </motion.div>
        </div>,
        document.body,
      )}

      {/* Yakunlashni tasdiqlash — faqat barcha savollar yechilganda */}
      {submitConfirm && allAnswered && createPortal(
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 overflow-y-auto px-4 py-8"
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md my-auto"
          >
            <div className="w-full p-6 rounded-xl border border-gray-200 bg-white shadow-2xl">
              <h2 className="text-lg font-bold text-gray-900 mb-3">{t.submitConfirmTitle}</h2>
              <p className="text-sm font-semibold mb-1.5 text-green-700">
                {t.submitConfirmAllAnswered.replace('{total}', String(totalQuestions))}
              </p>
              <p className="text-sm text-gray-600 mb-5">{t.submitConfirmWarning}</p>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <AdminBtn
                  variant="ghost"
                  size="md"
                  className="sm:flex-1"
                  onClick={() => setSubmitConfirm(false)}
                >
                  {t.submitConfirmNo}
                </AdminBtn>
                <AdminBtn
                  variant="blue"
                  size="md"
                  className="sm:flex-1"
                  loading={submitting}
                  onClick={() => {
                    setSubmitConfirm(false);
                    handleSubmit();
                  }}
                >
                  {t.submitConfirmYes}
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
