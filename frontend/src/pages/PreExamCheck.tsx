import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { translations, Language, formatPreExamMediaAccessFailure } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { examAuthHeaders, setDeviceSessionToken } from '../lib/deviceFingerprint';
import { compressVideoFrameToJpeg } from '../lib/compressToJpeg';
import { FacePositionChecker, LivenessChallengeTracker, type FacePositionStatus } from '../lib/facePositionCheck';
import { type LivenessAction } from '../lib/livenessChallenge';
import { NoiseFloorEstimator } from '../lib/voiceActivity';
import { isScreenShareActive, requestScreenShare, stopScreenShare } from '../lib/screenShare';
import { getDesktop, type DesktopCheck } from '../lib/desktop';

/**
 * Mikrofon sinovining uch bosqichi.
 *
 * `MIC_TEST_RMS_MIN` — shu darajaga yetmasa mikrofon JIM hisoblanadi va
 * imtihon boshlanmaydi. Ataylab past qo'yilgan: maqsad kuchsiz
 * mikrofonli odamni chetlashtirish emas, O'CHIRILGAN mikrofonni
 * ushlash. Jim xona fon shovqini ~0.002-0.005.
 *
 * `MIC_TEST_RMS_GOOD` — shundan past bo'lsa mikrofon KUCHSIZ deb
 * belgilanadi: imtihon boshlanadi, lekin topshiruvchiga tovushni
 * oshirish tavsiya qilinadi va o'lchangan qiymat yozib qo'yiladi.
 */
const MIC_TEST_RMS_MIN = 0.012;
const MIC_TEST_RMS_GOOD = 0.03;
import {
  classifyImageQuality,
  eyeBaselineFrom,
  classifyNetwork,
  computeImageStats,
  grayscaleFromCanvas,
  type NetworkStatus,
  type QualityStatus,
} from '../lib/mediaQualityCheck';
import { IdentityVerifiedSuccess } from '../components/IdentityVerifiedSuccess';
import { AdminBtn, AdminAlert, AdminInput } from './admin/ui';
import { Check } from 'lucide-react';

/* Sahifa ichidagi qisqa matnlar (uz/ru/en) — katta i18n fayliga tegmasdan. */
const PRE_L: Record<Language, Record<string, string>> = {
  uz: {
    stepCamera: 'Kamera', stepIdentity: 'Shaxs', stepLiveness: 'Jonlilik',
    stepConsent: 'Rozilik',
    preExamConsentButton: 'Roziligimni tasdiqlayman',
    preExamConsentSaved: 'Rozilik qayd etildi',
    preExamConsentFailed: "Rozilikni saqlab bo'lmadi — qayta urinib ko'ring",
    preExamRulesChanged: "Qoidalar yangilandi — qaytadan o'qing va tasdiqlang",
    preExamRulesLoading: 'Qoidalar yuklanmoqda...',
    preExamRulesFailed: "Qoidalarni yuklab bo'lmadi. Internetni tekshirib, qayta urining.",
    preExamRulesRetry: 'Qayta urinish',
    stepScreen: 'Ekran',
    screenTitle: 'Butun ekranni ulashish',
    screenBody: "Bu imtihonda ekraningiz nazorat qilinadi: imtihon davomida ekran rasmi vaqti-vaqti bilan saqlanadi. Tugmani bosing, ochilgan oynada «Butun ekran» (Entire screen) ni tanlang va «Ulashish» ni bosing. Imtihon tugaguncha ulashishni to'xtatmang.",
    screenBtn: 'Butun ekranni ulashish',
    screenOk: 'Ekran ulashildi',
    screenErr_DENIED: "Ruxsat berilmadi. Tugmani qayta bosing, «Butun ekran» ni tanlang va «Ulashish» ni bosing.",
    screenErr_NOT_MONITOR: "Oyna yoki tab tanlandi. Faqat «Butun ekran» (Entire screen) qabul qilinadi.",
    screenErr_NOT_SUPPORTED: "Brauzeringiz ekranni ulashishni qo'llamaydi. Google Chrome yoki Microsoft Edge'ning yangi versiyasidan foydalaning.",
    screenErr_FAILED: "Ekranni ulashib bo'lmadi. Qayta urinib ko'ring.",
    preExamBlockedScreen: 'Butun ekran ulashilmagan',
    stepComputer: 'Kompyuter',
    computerTitle: 'Kompyuter tekshiruvi',
    computerChecking: 'Tekshirilmoqda…',
    computerRecheck: 'Qayta tekshirish',
    computerOk: "Kompyuter imtihonga tayyor: taqiqlangan dastur, virtual mashina va qo'shimcha monitor yo'q.",
    computerCloseAll: 'Hammasini yopish',
    stepRoom: 'Xona',
    roomTitle: "Xonani ko'rsatish",
    roomBody: "Tugmani bosing va 20 soniya davomida kamerani (yoki noutbukni) sekin aylantirib: butun xonani, stolingizni va stol ostini ko'rsating. Kadrlar saqlanadi va komissiya ko'rib chiqadi.",
    roomBtn: "Xonani ko'rsatishni boshlash (20 soniya)",
    roomNeedConsent: 'Avval qoidalarga rozilik bering',
    roomScanning: "Kamerani sekin aylantiring… {n} soniya",
    roomOk: "Xona ko'rsatildi",
    roomFailed: "Kadrlarni yuborib bo'lmadi. Qayta urinib ko'ring.",
    roomNoCamera: 'Kamera hali tayyor emas. Birozdan keyin qayta urinib ko\'ring.',
    preExamBlockedRoom: "Xona ko'rsatilmagan",
    preExamBlockedComputer: "Kompyuter tekshiruvidan o'tilmagan — ro'yxatdagi dasturlarni yoping",
  },
  ru: {
    stepCamera: 'Камера', stepIdentity: 'Личность', stepLiveness: 'Живость',
    stepConsent: 'Согласие',
    preExamConsentButton: 'Подтверждаю согласие',
    preExamConsentSaved: 'Согласие зафиксировано',
    preExamConsentFailed: 'Не удалось сохранить согласие — попробуйте снова',
    preExamRulesChanged: 'Правила обновлены — прочитайте и подтвердите заново',
    preExamRulesLoading: 'Правила загружаются...',
    preExamRulesFailed: 'Не удалось загрузить правила. Проверьте интернет и повторите.',
    preExamRulesRetry: 'Повторить',
    stepScreen: 'Экран',
    screenTitle: 'Демонстрация всего экрана',
    screenBody: 'На этом экзамене контролируется экран: во время экзамена периодически сохраняется снимок экрана. Нажмите кнопку, в открывшемся окне выберите «Весь экран» (Entire screen) и нажмите «Поделиться». Не останавливайте демонстрацию до конца экзамена.',
    screenBtn: 'Поделиться всем экраном',
    screenOk: 'Экран открыт',
    screenErr_DENIED: 'Доступ не предоставлен. Нажмите кнопку снова, выберите «Весь экран» и нажмите «Поделиться».',
    screenErr_NOT_MONITOR: 'Выбрано окно или вкладка. Принимается только «Весь экран» (Entire screen).',
    screenErr_NOT_SUPPORTED: 'Ваш браузер не поддерживает демонстрацию экрана. Используйте свежую версию Google Chrome или Microsoft Edge.',
    screenErr_FAILED: 'Не удалось начать демонстрацию экрана. Попробуйте ещё раз.',
    preExamBlockedScreen: 'Не открыт доступ ко всему экрану',
    stepComputer: 'Компьютер',
    computerTitle: 'Проверка компьютера',
    computerChecking: 'Проверка…',
    computerRecheck: 'Проверить снова',
    computerOk: 'Компьютер готов к экзамену: запрещённых программ, виртуальной машины и второго монитора нет.',
    computerCloseAll: 'Закрыть все',
    stepRoom: 'Комната',
    roomTitle: 'Показать помещение',
    roomBody: 'Нажмите кнопку и в течение 20 секунд медленно поворачивайте камеру (или ноутбук): покажите всю комнату, стол и пространство под столом. Кадры сохраняются и проверяются комиссией.',
    roomBtn: 'Начать показ помещения (20 секунд)',
    roomNeedConsent: 'Сначала подтвердите согласие с правилами',
    roomScanning: 'Медленно поворачивайте камеру… {n} с',
    roomOk: 'Помещение показано',
    roomFailed: 'Не удалось отправить кадры. Попробуйте ещё раз.',
    roomNoCamera: 'Камера ещё не готова. Попробуйте чуть позже.',
    preExamBlockedRoom: 'Помещение не показано',
    preExamBlockedComputer: 'Проверка компьютера не пройдена — закройте программы из списка',
  },
  en: {
    stepCamera: 'Camera', stepIdentity: 'Identity', stepLiveness: 'Liveness',
    stepConsent: 'Consent',
    preExamConsentButton: 'I accept the rules',
    preExamConsentSaved: 'Consent recorded',
    preExamConsentFailed: 'Could not save consent — please try again',
    preExamRulesChanged: 'Rules were updated — read and accept again',
    preExamRulesLoading: 'Loading the rules...',
    preExamRulesFailed: 'Could not load the rules. Check your connection and retry.',
    preExamRulesRetry: 'Retry',
    stepScreen: 'Screen',
    screenTitle: 'Share your entire screen',
    screenBody: 'Your screen is monitored in this exam: a screenshot is saved periodically during the exam. Click the button, choose "Entire screen" in the dialog and click "Share". Do not stop sharing until the exam ends.',
    screenBtn: 'Share entire screen',
    screenOk: 'Screen shared',
    screenErr_DENIED: 'Permission was not granted. Click the button again, choose "Entire screen" and click "Share".',
    screenErr_NOT_MONITOR: 'A window or tab was selected. Only "Entire screen" is accepted.',
    screenErr_NOT_SUPPORTED: 'Your browser does not support screen sharing. Use a recent Google Chrome or Microsoft Edge.',
    screenErr_FAILED: 'Could not start screen sharing. Please try again.',
    preExamBlockedScreen: 'Entire screen is not shared',
    stepComputer: 'Computer',
    computerTitle: 'Computer check',
    computerChecking: 'Checking…',
    computerRecheck: 'Check again',
    computerOk: 'Your computer is ready: no forbidden apps, virtual machine or extra monitor.',
    computerCloseAll: 'Close all',
    stepRoom: 'Room',
    roomTitle: 'Show your room',
    roomBody: 'Press the button and for 20 seconds slowly turn the camera (or laptop): show the whole room, your desk and under the desk. The frames are stored and reviewed by the commission.',
    roomBtn: 'Start room scan (20 seconds)',
    roomNeedConsent: 'Accept the rules first',
    roomScanning: 'Slowly turn the camera… {n} s',
    roomOk: 'Room shown',
    roomFailed: 'Could not send the frames. Please try again.',
    roomNoCamera: 'The camera is not ready yet. Try again in a moment.',
    preExamBlockedRoom: 'Room not shown',
    preExamBlockedComputer: 'Computer check not passed — close the listed apps',
  },
};
import {
  attachDefaultMicrophone,
  openCameraByTryingVideoInputs,
  openPreferredCameraStream,
  VIRTUAL_CAMERA_BLOCKED_MESSAGE,
} from '../lib/preferredCameraStream';
import { prewarmProctorStream, discardPrewarmedProctorStream } from '../lib/proctorStreamPrewarm';
import { noteServerDate, serverNow } from '../lib/serverClock';

const PASSIVE_LIVE_SAMPLES = 12;
const PASSIVE_LIVE_GAP_MS = 260;
const PASSIVE_LIVE_THRESHOLD = 400;
const LIVENESS_W = 80;
const LIVENESS_H = 60;

// Active liveness challenge (tabassum) — passiv piksel-farq tekshiruvidan keyin.
/** Harakat → talabaga ko'rsatiladigan ko'rsatma (i18n kaliti). */
const LIVENESS_PROMPT_KEY = {
  BLINK: 'preExamChallengeBlink',
  SMILE: 'preExamChallengeSmile',
  MOUTH_OPEN: 'preExamChallengeMouth',
  TURN_LEFT: 'preExamChallengeTurnLeft',
  TURN_RIGHT: 'preExamChallengeTurnRight',
} as const satisfies Record<LivenessAction, string>;

/** Kadr yoritilishi/piksel yig'indisi o'zgarishi — foydalanuvchi harakat yoki tabiiy harakat */
async function samplePassiveFrameMotion(captureFrame: () => number): Promise<boolean> {
  let maxDelta = 0;
  let prev = 0;
  for (let i = 0; i < PASSIVE_LIVE_SAMPLES; i++) {
    await new Promise((r) => setTimeout(r, PASSIVE_LIVE_GAP_MS));
    const cur = captureFrame();
    if (cur > 0 && prev > 0) {
      maxDelta = Math.max(maxDelta, Math.abs(cur - prev));
    }
    if (cur > 0) prev = cur;
  }
  return maxDelta >= PASSIVE_LIVE_THRESHOLD;
}

export function PreExamCheck({
  exam,
  token,
  user,
  lang,
  isRetake,
  onComplete,
  onCancel,
}: {
  exam: any;
  token: string;
  user: any;
  lang: Language;
  /** Qoidabuzarlik tufayli qayta topshirish uchun qaytadan kirilganmi — true bo'lsa pozitsiya gate talab qilinmaydi. */
  isRetake?: boolean;
  onComplete: (examData: any, seId: number) => void;
  onCancel: () => void;
}) {
  // Retake holatini faqat transient prop'dan emas, exam ma'lumotidan ham aniqlaymiz —
  // shunda retake PreExamCheck'da brauzer yangilansa ham (prop yo'qolsa) pozitsiya gate
  // qayta talab qilinmaydi. Shaxs (identity) va jonlilik har safar tekshiriladi.
  const isRetakeResolved = Boolean(
    isRetake ||
      exam?.session_phase === 'after_retake' ||
      (exam?.technical_retakes_used ?? 0) > 0 ||
      (exam?.identity_retakes_used ?? 0) > 0,
  );
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  /** Mikrofon HAQIQATAN eshitdimi (shunchaki ulangani emas). */
  const [micHeard, setMicHeard] = useState(false);
  /** Test markazi rejimi (tekshiruvchi PIN kiritgan): mikrofon talab qilinmaydi. */
  const [centerMode, setCenterMode] = useState(Boolean(exam?.test_center_mode));
  const centerRoom = Boolean(exam?.test_center_enabled || centerMode);
  const [centerPin, setCenterPin] = useState('');
  const [centerBusy, setCenterBusy] = useState(false);
  const [centerErr, setCenterErr] = useState('');
  /** Jonli daraja — ko'rsatkich chizig'i uchun (0..1). */
  const [micLevel, setMicLevel] = useState(0);
  /** Sinovda O'LCHANGAN eng yuqori daraja — rozilik bilan birga
   *  serverga yuboriladi va apellyatsiyada dalil bo'ladi. */
  const [micPeak, setMicPeak] = useState(0);

  // --- Nazorat qoidalari va rozilik ---
  type VacRuleSection = { title: string; note?: string; items: string[] };
  type VacRules = {
    title: string;
    intro: string;
    sections: VacRuleSection[];
    consent_label: string;
    version: string;
    already_accepted?: boolean;
    screen_share?: boolean;
    room_scan?: boolean;
  };
  const [vacRules, setVacRules] = useState<VacRules | null>(null);
  const [rulesChecked, setRulesChecked] = useState(false);
  const [consentSaved, setConsentSaved] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState('');
  /** Qoidalar yuklanmadi — ekranda sabab va "qayta urinish" ko'rsatiladi. */
  const [rulesError, setRulesError] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesReload, setRulesReload] = useState(0);
  /** To'liq qoidalar matni oynasi (sahifada ixcham ko'rinish). */
  const [rulesFullOpen, setRulesFullOpen] = useState(false);
  // --- Butun ekranni ulashish (faqat server talab qilgan imtihonda) ---
  const [screenShared, setScreenShared] = useState(() => isScreenShareActive());
  const [screenBusy, setScreenBusy] = useState(false);
  const [screenError, setScreenError] = useState('');
  const screenRequired = Boolean(vacRules?.screen_share) && !getDesktop();
  // --- FerMI Exam ilovasi: kompyuter tekshiruvi (taqiqlangan dasturlar, VM, RDP, monitorlar) ---
  const desktopApp = getDesktop();
  const [sysCheck, setSysCheck] = useState<DesktopCheck | null>(null);
  const [sysBusy, setSysBusy] = useState(false);
  const runSysCheck = useCallback(async (): Promise<DesktopCheck | null> => {
    const d = getDesktop();
    if (!d) return null;
    setSysBusy(true);
    try {
      const r = await d.systemCheck();
      setSysCheck(r);
      return r;
    } catch {
      const failed: DesktopCheck = {
        ok: false,
        problems: [{ code: 'CHECK_FAILED', title: "Kompyuterni tekshirib bo'lmadi", detail: '«Qayta tekshirish» tugmasini bosing.' }],
        apps: [],
        displays: 1,
        remote: false,
        vm: false,
      };
      setSysCheck(failed);
      return failed;
    } finally {
      setSysBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!getDesktop()) return;
    void runSysCheck();
    const id = window.setInterval(() => void runSysCheck(), 20_000);
    return () => window.clearInterval(id);
  }, [runSysCheck]);
  const closeForbiddenApps = async () => {
    const d = getDesktop();
    if (!d || !sysCheck?.apps?.length) return;
    setSysBusy(true);
    try {
      await d.closeApps(sysCheck.apps.map((a) => a.name));
      await new Promise((r) => setTimeout(r, 1500));
    } catch {
      /* ignore */
    } finally {
      setSysBusy(false);
    }
    void runSysCheck();
  };
  const sysOk = !desktopApp || Boolean(sysCheck?.ok);
  // --- Xonani ko'rsatish (imtihon oldidan 20 soniya, kadrlar serverga) ---
  const roomScanRequired = Boolean(vacRules?.room_scan);
  const [roomScanned, setRoomScanned] = useState(false);
  const [roomScanLeft, setRoomScanLeft] = useState(0);
  const [roomScanError, setRoomScanError] = useState('');
  const roomScanBusyRef = useRef(false);
  const runRoomScan = async () => {
    if (roomScanBusyRef.current) return;
    const v = videoRef.current;
    if (!v || v.readyState < 2 || !v.videoWidth) {
      setRoomScanError(PRE_L[lang].roomNoCamera);
      return;
    }
    roomScanBusyRef.current = true;
    setRoomScanError('');
    const frames: string[] = [];
    try {
      for (let left = 20; left > 0; left--) {
        setRoomScanLeft(left);
        if (left % 2 === 0) {
          const cur = videoRef.current;
          const f = cur ? compressVideoFrameToJpeg(cur, 0.6, 480) : '';
          if (f) frames.push(f);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      setRoomScanLeft(0);
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/room-scan`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...examAuthHeaders(token) },
        body: JSON.stringify({ images: frames }),
      });
      if (res.ok) setRoomScanned(true);
      else setRoomScanError(PRE_L[lang].roomFailed);
    } catch {
      setRoomScanError(PRE_L[lang].roomFailed);
    } finally {
      roomScanBusyRef.current = false;
      setRoomScanLeft(0);
    }
  };
  useEffect(() => {
    if (!screenRequired) return;
    const id = window.setInterval(() => setScreenShared(isScreenShareActive()), 1000);
    return () => window.clearInterval(id);
  }, [screenRequired]);
  // Imtihonga o'tmasdan chiqib ketilsa — ulashish to'xtatiladi.
  useEffect(
    () => () => {
      if (!proceededToExamRef.current) stopScreenShare();
    },
    [],
  );
  const shareScreen = async () => {
    setScreenBusy(true);
    setScreenError('');
    try {
      const r = await requestScreenShare();
      if (r.ok) {
        setScreenShared(true);
      } else {
        setScreenShared(false);
        setScreenError(PRE_L[lang]['screenErr_' + (r.error || 'FAILED')] || PRE_L[lang].screenErr_FAILED);
      }
    } finally {
      setScreenBusy(false);
    }
  };
  const [error, setError] = useState('');
  const [identityError, setIdentityError] = useState('');
  const [starting, setStarting] = useState(false);
  // Vakansiya nomzodiga savollar o'sha zahoti AI bilan yaratiladi —
  // bu 1-5 daqiqa davom etadi, shuning uchun kutish oynasi ko'rsatiladi.
  const [waitSec, setWaitSec] = useState(0);

  /**
   * Imtihon muddati tugadimi — sahifa QULFLANADI.
   *
   * Muammo: imtihon oldi tekshiruvi (kamera, shaxs tasdiqlash, jonlilik) bir
   * necha daqiqa oladi. Shu vaqtda imtihon tugab qolishi mumkin edi va talaba
   * hamma bosqichni o'tib, oxirida `/start` dan "Imtihon allaqachon tugagan"
   * xatosini olardi — kamera esa ochiq qolar, "Kirish" tugmasi bosilaverar,
   * har urinishda shaxs tasdiqlash (server + AI) qayta sarflanardi.
   *
   * Muddat `access_until` dan olinadi: umumiy tugash vaqti yoki faol retake
   * oynasining oxiri (qaysi kechroq). `end_time` ga qarab bo'lmaydi — retake
   * oynasi berilgan talaba umumiy vaqtdan keyin ham haqli ravishda kiradi.
   */
  const accessUntilMs = (() => {
    const raw = exam?.access_until || exam?.end_time;
    if (!raw) return null;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : null;
  })();
  const [examOver, setExamOver] = useState(
    () => accessUntilMs != null && serverNow() > accessUntilMs,
  );
  /** Server "tugagan" deb javob berdi — soat farqidan qat'i nazar qulflaymiz. */
  const [serverSaysOver, setServerSaysOver] = useState(false);
  const locked = examOver || serverSaysOver;
  /** Kamera bor, mikrofon ochilmagan — qizil xato emas, ogohlantirish */
  const [mediaHint, setMediaHint] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  /** `onComplete` chaqirilganmi — shunda unmount cleanup prewarm qilingan
   *  kamera oqimini YO'Q QILMASLIGI kerak (ExamRoom uni da'vo qiladi). */
  const proceededToExamRef = useRef(false);
  const [showVerifyCelebration, setShowVerifyCelebration] = useState(false);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [livenessChecking, setLivenessChecking] = useState(false);
  const [livenessRetryKey, setLivenessRetryKey] = useState(0);
  const [livenessFailed, setLivenessFailed] = useState(false);
  /** Passiv piksel-farq tekshiruvi o'tdi — active challenge (tabassum) boshlanadi. */
  const [passiveMotionOk, setPassiveMotionOk] = useState(false);
  const [challengeStep, setChallengeStep] = useState<{
    action: LivenessAction;
    step: number;
    total: number;
  } | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<
    'idle' | 'running' | 'passed' | 'failed'
  >('idle');
  const [challengeRetryKey, setChallengeRetryKey] = useState(0);
  /** Pre-exam yuz pozitsiyasi gate (kameraga yaqin + markaz + to'g'ri qaragan). */
  const [positionStatus, setPositionStatus] = useState<FacePositionStatus>('WAITING');
  /** Tasvir tiniqligi va yorug'ligi. */
  const [imageQuality, setImageQuality] = useState<QualityStatus>('OK');
  /** Internet barqarorligi (imtihon davomida har 15s rasm yuboriladi). */
  const [netStatus, setNetStatus] = useState<NetworkStatus | 'CHECKING'>('CHECKING');
  const [netDetail, setNetDetail] = useState('');
  const [netRetryKey, setNetRetryKey] = useState(0);
  /** Ko'z ochiqligi namunalari — imtihonga bazaviy qiymat sifatida uzatiladi. */
  const eyeSamplesRef = useRef<number[]>([]);
  const [positionOk, setPositionOk] = useState(false);
  /** Boshlash bosilganda ochiladigan qoidalar modali. */
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [modalRulesScrolledEnd, setModalRulesScrolledEnd] = useState(false);
  const modalRulesBoxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Identity snapshot (JPEG) — faqat verifyIdentity */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Liveness getImageData — alohida canvas (bir canvas da kontekst aralashmasin) */
  const livenessCanvasRef = useRef<HTMLCanvasElement>(null);
  const t = translations[lang];
  // Til faqat xato xabarlari uchun — ref orqali. Kamera effekti dependency'siga `lang`
  // qo'shilsa, til almashtirilganda kamera/getUserMedia qayta ishga tushadi (liveness uziladi).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Komponent ExamRoom'ga o'tmasdan unmount bo'lsa (masalan foydalanuvchi
  // "Kirish"ni bosgach sahifadan chiqsa) — prewarm qilingan kamera oqimi
  // fonda ochiq qolib ketmasin. `proceededToExamRef` true bo'lsa — ExamRoom
  // shu oqimni da'vo qilishi kerak, TEGMAYMIZ.
  useEffect(
    () => () => {
      if (!proceededToExamRef.current) discardPrewarmedProctorStream();
    },
    [],
  );

  useEffect(() => {
    if (!showRulesModal) return;
    const el = modalRulesBoxRef.current;
    if (!el) return;
    setModalRulesScrolledEnd(false);
    const measure = () => {
      const end =
        el.scrollHeight <= el.clientHeight + 12 ||
        el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
      if (end) setModalRulesScrolledEnd(true);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [showRulesModal, lang]);

  /**
   * Kamera kadridan piksel yig'indisini hisoblaydi.
   * Ko'z yumish yoki tabassum paytida yuz maydoni o'zgaradi — delta katta bo'ladi.
   */
  const captureFrame = (): number => {
    if (!videoRef.current || !livenessCanvasRef.current) return 0;
    const video = videoRef.current;
    const canvas = livenessCanvasRef.current;
    if (!video.videoWidth || !video.videoHeight) return 0;
    // O'lchamni faqat o'zgartirganda yangilaymiz — har kadrda width/height qayta yazilganda
    // canvas tozalanadi va Chromium willReadFrequently ogohlantirishini beradi.
    if (canvas.width !== LIVENESS_W) canvas.width = LIVENESS_W;
    if (canvas.height !== LIVENESS_H) canvas.height = LIVENESS_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    // Markaziy yuz zonasini olish
    const sw = video.videoWidth;
    const sh = video.videoHeight * 0.6;
    const sx = 0;
    const sy = 0;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Yorug'lik intensivligi (grayscale)
      sum += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
    return sum;
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    const checkDevices = async () => {
      const t = tRef.current; // joriy til (effekt qayta ishga tushmaydi)
      setError('');
      setMediaHint('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t.preExamMediaUnsupported);
        return;
      }
      const host = window.location.hostname;
      const isLocal =
        host === 'localhost' || host === '127.0.0.1' || host === '[::1]' ||
        // FerMI Exam ilovasi: interfeys xavfsiz fermi://app sxemasidan ochiladi.
        Boolean(getDesktop());
      // Brauzerlar kamera/mikrofonni oddiy http:// domen uchun bloklaydi (localhost bundan mustasno)
      if (!isLocal && window.location.protocol !== 'https:') {
        setError(t.preExamRequiresHttps);
        return;
      }
      if (!isLocal && !window.isSecureContext) {
        setError(t.preExamRequiresHttps);
        return;
      }

      try {
        const q = navigator.permissions?.query?.bind(navigator.permissions);
        if (q) {
          try {
            const st = await q({ name: 'camera' as PermissionName });
            if (st.state === 'denied') {
              setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
              return;
            }
          } catch {
            /* Chromium: ba'zi versiyalarda query qo'llab-quvvatlanmaydi */
          }
        }
      } catch {
        /* ignore */
      }

      const domName = (err: unknown) =>
        err instanceof DOMException ? err.name : err instanceof Error ? err.name : '';

      const attachStream = (s: MediaStream) => {
        stream = s;
        setCameraReady(s.getVideoTracks().length > 0);
        setMicReady(s.getAudioTracks().length > 0);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      };

      // 1) Avval faqat kamera, keyin mikrofon — Windows/Chrome da bir vaqtda olish ko'pincha yiqiladi.
      try {
        const v = await openPreferredCameraStream(false, true);
        const micOk = centerRoom || await attachDefaultMicrophone(v);
        attachStream(v);
        if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
        return;
      } catch (e0: unknown) {
        const n0 = domName(e0);
        if (n0 === 'NotAllowedError' || n0 === 'PermissionDeniedError') {
          if (e0 instanceof DOMException && e0.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
            setError(t.virtualCameraBlocked);
            return;
          }
          setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
          return;
        }
        if (n0 === 'SecurityError') {
          setError(t.preExamRequiresHttps);
          return;
        }
        if (n0 === 'NotFoundError' || n0 === 'DevicesNotFoundError') {
          setError(t.preExamMediaNotFound);
          return;
        }
        if (n0 === 'NotReadableError' || n0 === 'TrackStartError') {
          try {
            const rotated = await openCameraByTryingVideoInputs();
            attachStream(rotated);
            if (rotated.getAudioTracks().length === 0) {
              setMediaHint(t.preExamMicOnlyFailed);
            }
            setError('');
            return;
          } catch {
            /* keyingi getUserMedia yo'llariga o'tamiz */
          }
        }
      }

      try {
        const s = await openPreferredCameraStream(!centerRoom, true);
        attachStream(s);
        if (s.getAudioTracks().length === 0) setMediaHint(t.preExamMicOnlyFailed);
      } catch (e1: unknown) {
        const n1 = domName(e1);
        if (e1 instanceof DOMException && e1.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
          setError(t.virtualCameraBlocked);
        } else if (n1 === 'NotReadableError' || n1 === 'TrackStartError' || n1 === 'NotAllowedError') {
          let vOnly: MediaStream | null = null;
          try {
            vOnly = await openPreferredCameraStream(false, true);
            const micOk = centerRoom || await attachDefaultMicrophone(vOnly);
            attachStream(vOnly);
            if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
            setError('');
          } catch (innerErr: unknown) {
            if (vOnly) vOnly.getTracks().forEach((tr) => tr.stop());
            const ni = domName(innerErr);
            const ref = ni || n1;
            if (ref === 'NotAllowedError' || ref === 'PermissionDeniedError') {
              if (innerErr instanceof DOMException && innerErr.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
                setError(t.virtualCameraBlocked);
              } else {
                setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
              }
            } else if (ref === 'SecurityError') {
              setError(t.preExamRequiresHttps);
            } else if (ref === 'NotFoundError' || ref === 'DevicesNotFoundError') {
              setError(t.preExamMediaNotFound);
            } else {
              try {
                const rotated = await openCameraByTryingVideoInputs();
                attachStream(rotated);
                if (rotated.getAudioTracks().length === 0) {
                  setMediaHint(t.preExamMicOnlyFailed);
                }
                setError('');
              } catch {
                try {
                  const raw = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                  });
                  const micOk = centerRoom || await attachDefaultMicrophone(raw);
                  attachStream(raw);
                  if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
                  setError('');
                } catch (rawErr: unknown) {
                  setError(formatPreExamMediaAccessFailure(rawErr, lang));
                }
              }
            }
          }
        } else if (n1 === 'SecurityError') {
          setError(t.preExamRequiresHttps);
        } else if (n1 === 'NotFoundError' || n1 === 'DevicesNotFoundError') {
          setError(t.preExamMediaNotFound);
        } else if (n1 === 'NotAllowedError' || n1 === 'PermissionDeniedError') {
          if (e1 instanceof DOMException && e1.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
            setError(t.virtualCameraBlocked);
          } else {
            setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
          }
        } else {
          setError(t.preExamCameraError);
        }
      }

      if (!stream) {
        try {
          const rotated = await openCameraByTryingVideoInputs();
          attachStream(rotated);
          if (rotated.getAudioTracks().length === 0) {
            setMediaHint(t.preExamMicOnlyFailed);
          }
          setError('');
        } catch {
          try {
            const raw = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
            const micOk = centerRoom || await attachDefaultMicrophone(raw);
            attachStream(raw);
            if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
            setError('');
          } catch (finalErr: unknown) {
            setError((prev) =>
              prev && prev.length > 0 ? prev : formatPreExamMediaAccessFailure(finalErr, lang)
            );
          }
        }
      }
    };
    checkDevices();
    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
    // Kamera faqat bir marta ochiladi (mount). Til o'zgarishi kamerani qayta ishga tushirmaydi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pre-exam yuz pozitsiyasi gate (MediaPipe): yaqin + markaz + to'g'ri qaragan.
   *  Identity verify'dan OLDIN pozitsiyani ta'minlaymiz. */
  useEffect(() => {
    if (!cameraReady || verified) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    const checker = new FacePositionChecker(
      video,
      (status, okSustained) => {
        if (cancelled) return;
        setPositionStatus(status);
        setPositionOk(okSustained);
      },
      (ratio) => {
        if (cancelled) return;
        // DIQQAT: ko'z ko'rinishi imtihonga KIRISHNI BLOKLAMAYDI. Ilgari
        // "Ko'zlar aniqlanmadi" holati darvoza edi va talaba imtihonga umuman
        // kira olmay qolardi (signal bir kadr uchun yo'qolsa ham) — shu sabab
        // tekshiruv olib tashlandi.
        //
        // Namuna yig'ish esa QOLADI: talabaning TABIIY ko'z ochiqligi.
        // Imtihonda "ko'z toraydi" (pastga qarash) shu bazaviy qiymatga
        // NISBATAN aniqlanadi — mutlaq chegara odamlar orasida ishlamaydi.
        // Yetarli namuna bo'lmasa baseline saqlanmaydi va nigoh nazorati
        // mutlaq chegaraga qaytadi (`eyeBaselineFrom` null qaytaradi).
        if (typeof ratio === 'number' && ratio > 0) {
          const arr = eyeSamplesRef.current;
          arr.push(ratio);
          if (arr.length > 60) arr.shift();
        }
      },
      centerRoom,
    );
    void checker.init().then((ok) => {
      if (cancelled) {
        checker.dispose();
        return;
      }
      if (ok) {
        checker.start();
      } else {
        // Model yuklanmadi (CDN bloklangan / eski qurilma) — gate skip, imtihon bloklanmasin.
        setPositionStatus('OK');
        setPositionOk(true);
      }
    });
    return () => {
      cancelled = true;
      checker.dispose();
    };
  }, [cameraReady, verified, centerRoom]);

  /** Shaxs tasdiqlandi — tugmasiz: kamera kadrlarida yengil harakat qidiriladi
   *  (statik foto/video-replay'ga qarshi arzon birinchi qatlam). O'tsa, active
   *  bosh-burish challenge boshlanadi (keyingi effekt). */
  useEffect(() => {
    if (!verified || passiveMotionOk || !cameraReady) return;

    let cancelled = false;
    const run = async () => {
      setLivenessChecking(true);
      setLivenessFailed(false);
      setIdentityError('');
      await new Promise((r) => setTimeout(r, 450));
      for (let round = 0; round < 3; round++) {
        if (cancelled) return;
        const ok = await samplePassiveFrameMotion(() => captureFrame());
        if (ok) {
          if (!cancelled) {
            setPassiveMotionOk(true);
            setLivenessChecking(false);
            setLivenessFailed(false);
            setIdentityError('');
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) {
        setLivenessChecking(false);
        setLivenessFailed(true);
        setIdentityError(tRef.current.preExamLivenessFail);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, cameraReady, passiveMotionOk, livenessRetryKey]);

  /**
   * Tasvir sifati — tiniqlik va yorug'lik. Nigoh nazorati qorachiqni o'qishga
   * tayanadi: xira yoki qorong'i kadrda u ishlamaydi va talaba pastga qarab
   * telefondan javob ko'rishi mumkin. Shu sabab imtihon oldidan tekshiriladi.
   */
  useEffect(() => {
    if (!cameraReady) return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = livenessCanvasRef.current;
      if (!video || !canvas || !video.videoWidth) return;
      if (canvas.width !== LIVENESS_W) canvas.width = LIVENESS_W;
      if (canvas.height !== LIVENESS_H) canvas.height = LIVENESS_H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, LIVENESS_W, LIVENESS_H);
      const gray = grayscaleFromCanvas(ctx, LIVENESS_W, LIVENESS_H);
      if (!gray) return;
      setImageQuality(classifyImageQuality(computeImageStats(gray, LIVENESS_W, LIVENESS_H)));
    }, 1200);
    return () => clearInterval(id);
  }, [cameraReady]);

  /**
   * Internet barqarorligi. Imtihon davomida har 15s shaxs tekshiruvi va har 15s
   * kadr tahlili rasm yuboradi — beqaror ulanishda nazorat uzilib qoladi.
   * Shuning uchun boshlashdan oldin bir necha o'lchov olinadi.
   */
  useEffect(() => {
    let cancelled = false;
    setNetStatus('CHECKING');
    setNetDetail('');
    (async () => {
      const samples: { ms: number | null }[] = [];
      for (let i = 0; i < 6 && !cancelled; i += 1) {
        const t0 = performance.now();
        try {
          const res = await fetch(apiUrl(`/api/health?probe=${Date.now()}-${i}`), {
            cache: 'no-store',
          });
          noteServerDate(res);
          samples.push({ ms: res.ok ? Math.round(performance.now() - t0) : null });
        } catch {
          samples.push({ ms: null });
        }
        if (!cancelled && i < 5) await new Promise((r) => setTimeout(r, 250));
      }
      if (cancelled) return;
      const stats = classifyNetwork(samples);
      setNetStatus(stats.status);
      setNetDetail(
        stats.status === 'OK'
          ? `${stats.medianMs} ms`
          : `${stats.medianMs} ms · ±${stats.jitterMs} ms · ${stats.failures}/${stats.samples}`,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [netRetryKey]);

  /**
   * Passiv tekshiruvdan keyin — FAOL chaqiriq: TASODIFIY harakatlar ketma-ketligi.
   *
   * Ilgari har doim bitta xil harakat ("tabassum qiling") so'ralardi, shu sabab
   * bir marta yozib olingan video uni cheksiz o'tardi. Endi har urinishda
   * harakatlar tasodifiy tanlanadi va har biri SO'RALGANDAN KEYIN boshlanishi
   * shart (mantiq `lib/livenessChallenge.ts` da, testlar bilan qoplangan).
   */
  useEffect(() => {
    if (!verified || !passiveMotionOk || livenessPassed || !cameraReady) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    // Faqat TABASSUM so'raladi — talaba uchun eng sodda va tushunarli harakat.
    // (Modul ko'z qisish / og'iz ochish / bosh burishni ham qo'llab-quvvatlaydi
    //  — kerak bo'lsa shu ro'yxatga qo'shish yoki `pickLivenessActions()` ga
    //  qaytarish kifoya.)
    const actions: LivenessAction[] = ['SMILE'];
    setChallengeStep({ action: actions[0], step: 1, total: actions.length });
    setChallengeStatus('running');

    const tracker = new LivenessChallengeTracker(
      video,
      actions,
      {
        onProgress: (info) => {
          if (cancelled) return;
          setChallengeStep({ action: info.action, step: info.step, total: info.total });
        },
        onPassed: () => {
          if (!cancelled) setChallengeStatus('passed');
        },
        // DOIMIY tekshiruv — timeout Infinity, shu sabab onFailed hech qachon
        // chaqirilmaydi. Talaba tayyor bo'lganda jilmayadi, "qayta urinish"
        // tugmasi ko'rsatilmaydi.
        onFailed: () => {},
      },
      Infinity,
    );

    void tracker.init().then((ok) => {
      if (cancelled) {
        tracker.dispose();
        return;
      }
      if (ok) {
        tracker.start();
      } else {
        // Model yuklanmadi — chaqiriq o'tkazib yuboriladi (imtihon bloklanmasin);
        // passiv tekshiruv va serverdagi shaxs tasdiqlash allaqachon o'tgan.
        setChallengeStatus('passed');
      }
    });

    return () => {
      cancelled = true;
      tracker.dispose();
    };
  }, [verified, passiveMotionOk, livenessPassed, cameraReady, challengeRetryKey]);

  useEffect(() => {
    if (challengeStatus === 'passed') setLivenessPassed(true);
  }, [challengeStatus]);

  useEffect(() => {
    if (!verified) {
      setShowVerifyCelebration(false);
      return;
    }
    setShowVerifyCelebration(true);
    const timer = window.setTimeout(() => setShowVerifyCelebration(false), 2800);
    return () => window.clearTimeout(timer);
  }, [verified]);

  const verifyIdentity = async () => {
    if (!videoRef.current || !canvasRef.current || !user.profile_image) return;
    setVerifying(true);
    setIdentityError('');
    setError('');
    try {
      const video = videoRef.current;
      // 480px da yuz juda kichik chiqardi (48px dan kam) va server uni
      // umuman tanimasdi — o'qituvchilar sal uzoqroq o'tirsa "tasdiqlanmadi"
      // xatosi chiqardi. 1280px da yuz yetarlicha katta bo'ladi.
      const liveDataUrl = compressVideoFrameToJpeg(video, 0.78, 1280, true);
      if (!liveDataUrl) return;
      const capturedImageBase64 = liveDataUrl.split(',')[1];
      const profilePayload = String(user.profile_image).includes(',')
        ? user.profile_image
        : `data:image/jpeg;base64,${user.profile_image}`;

      const response = await fetch(apiUrl('/api/student/identity-compare'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({
          exam_id: exam.id,
          profile_image_base64: profilePayload,
          live_capture_base64: capturedImageBase64,
        }),
      });
      const data =
        (await readJsonSafe<{
          match?: boolean;
          skipped?: boolean;
          code?: string;
          error?: string;
          score?: number;
          method?: string;
        }>(response)) || {};
      if (response.status === 503) {
        const code = data?.code || '';
        setIdentityError(
          code === 'GEMINI_UNAVAILABLE' || code === 'FACE_ENGINE_UNAVAILABLE'
            ? t.identityVerifyServiceDown
            : code === 'GEMINI_MODEL_INVALID'
              ? t.identityVerifyGeminiModelInvalid
              : code === 'GEMINI_ERROR'
                ? t.identityVerifyGeminiError
                : t.identityVerifyError
        );
        return;
      }
      if (response.status === 403) {
        const code = data?.code || '';
        const sessionLocked =
          code === 'DEVICE_MISMATCH' ||
          code === 'DEVICE_TOKEN_REQUIRED' ||
          code === 'DEVICE_FINGERPRINT_REQUIRED' ||
          code === 'VAC_HMAC_SESSION_MISSING' ||
          code.startsWith('VAC_');
        setIdentityError(
          code === 'STUDENT_ONLY'
            ? t.identityVerify403StudentOnly
            : code === 'EXAM_NOT_ASSIGNED'
              ? t.identityVerify403ExamNotAssigned
              : sessionLocked
                ? t.identityVerify403SessionLocked
                : t.identityVerifyError,
        );
        return;
      }
      if (!response.ok) {
        setIdentityError(t.identityVerifyError);
        return;
      }
      if (data.match === true) {
        setVerified(true);
        setIdentityError('');
      } else {
        const code = data?.code || '';
        // IMAGE_TOO_SMALL — yuz kadrda juda kichik. Bu "mos kelmadi" emas,
        // "yaqinroq o'tiring" degani; identityVerifyFailed matni aynan shu
        // maslahat bilan boshlanadi.
        setIdentityError(
          code === 'FACE_NOT_DETECTED'
            ? t.identityVerifyFaceNotDetected
            : t.identityVerifyFailed,
        );
      }
    } catch {
      setIdentityError(t.identityVerifyError);
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    if (!starting) {
      setWaitSec(0);
      return;
    }
    const t0 = Date.now();
    const id = window.setInterval(() => {
      setWaitSec(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [starting]);

  const isVacancy = String((user as any)?.role || '').toLowerCase() === 'vacancy';

  /** Tekshiruvchi test markazi PIN'ini kiritadi — sessiya mikrofonsiz rejimga o'tadi. */
  const submitCenterPin = async () => {
    const pin = centerPin.replace(/\D/g, '');
    if (pin.length < 4 || pin.length > 8 || centerBusy) return;
    setCenterBusy(true);
    setCenterErr('');
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/test-center`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...examAuthHeaders(token) },
        body: JSON.stringify({ pin }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        setCenterErr(String(data?.error || 'PIN'));
        return;
      }
      const src = videoRef.current?.srcObject;
      if (src instanceof MediaStream) {
        for (const tr of src.getAudioTracks()) {
          tr.stop();
          src.removeTrack(tr);
        }
      }
      setCenterMode(true);
      setMicReady(true);
      setMicHeard(true);
      setCenterPin('');
      // Qoidalar matni test markazi rejimiga o'zgaradi — qayta olinadi va tasdiqlanadi.
      setConsentSaved(false);
      setRulesChecked(false);
      setRulesReload((n) => n + 1);
    } catch {
      setCenterErr(t.preExamNetworkError);
    } finally {
      setCenterBusy(false);
    }
  };

  const handleEnter = async () => {
    setError('');
    // Ilovada: boshlashdan oldin kompyuter yana bir bor tekshiriladi.
    if (getDesktop()) {
      const fresh = await runSysCheck();
      if (!fresh || !fresh.ok) {
        setError(PRE_L[lang].preExamBlockedComputer);
        return;
      }
    }
    setStarting(true);
    // ExamRoom kamera/mikrofonni ochishini KUTMASDAN, tarmoq so'rovi bilan
    // PARALLEL boshlab qo'yamiz — "Kamera tayyorlanmoqda" ekrani deyarli
    // darhol o'tishi uchun (bewaqt xato bo'lsa ExamRoom o'zi qayta so'raydi).
    prewarmProctorStream();
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/start`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Student-Lang': lang,
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({ student_lang: lang, client_features: ['question_lock'] }),
      });
      noteServerDate(res);
      const data = await readJsonSafe<{
        error?: string;
        code?: string;
        exam?: any;
        studentExamId?: number;
        startedAt?: string;
        sessionKey?: string;
        sessionSeqStart?: number;
        sessionChallenge?: string;
        deviceToken?: string;
      }>(res);
      if (!res.ok || !data?.exam || data.studentExamId == null) {
        setError(data?.error || t.preExamStartError);
        discardPrewarmedProctorStream();
        // 403 — imtihon oynasi yopilgan (tugagan yoki hali boshlanmagan).
        // Sahifani qulflaymiz: qayta-qayta urinish faqat server va AI'ni
        // bekorga yuklaydi, natija o'zgarmaydi.
        if (res.status === 403) {
          setServerSaysOver(true);
          setShowRulesModal(false);
        }
        return;
      }
      if (data.deviceToken) {
        setDeviceSessionToken(data.deviceToken, token);
      }
      // Ko'z ochiqligi bazaviy qiymati — imtihonda nigoh nazorati SHUNGA
      // nisbatan ishlaydi. Yetarli namuna yo'q bo'lsa saqlanmaydi va imtihon
      // mutlaq chegaraga qaytadi (soxta ogohlantirishdan xavfsizroq).
      const eyeBaseline = eyeBaselineFrom(eyeSamplesRef.current);
      try {
        if (eyeBaseline) {
          sessionStorage.setItem(`exam_eye_baseline_${exam?.id}`, String(eyeBaseline));
        } else {
          sessionStorage.removeItem(`exam_eye_baseline_${exam?.id}`);
        }
      } catch {
        /* sessionStorage o'chirilgan — nisbiy taqqoslash ishlamaydi, xato emas */
      }
      proceededToExamRef.current = true;
      onComplete(
        {
          ...data.exam,
          startedAt: data.startedAt,
          sessionKey: data.sessionKey,
          sessionSeqStart: data.sessionSeqStart,
          sessionChallenge: data.sessionChallenge,
        },
        data.studentExamId,
      );
    } catch {
      setError(t.preExamNetworkError);
      discardPrewarmedProctorStream();
    } finally {
      setStarting(false);
    }
  };

  // Muddat sahifada turganda ham o'tib ketishi mumkin — kuzatib boramiz.
  useEffect(() => {
    if (accessUntilMs == null || examOver) return;
    const tick = () => {
      if (serverNow() > accessUntilMs) setExamOver(true);
    };
    tick();
    const id = window.setInterval(tick, 5_000);
    return () => window.clearInterval(id);
  }, [accessUntilMs, examOver]);

  // Qulflangach kamera/mikrofonni DARHOL bo'shatamiz — imtihon tugagan bo'lsa
  // talabani kuzatib turishning ma'nosi yo'q va qurilma band qolmasin.
  useEffect(() => {
    if (!locked) return;
    const v = videoRef.current;
    const stream = v?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
    setCameraReady(false);
  }, [locked]);

  async function openRulesModal() {
    setError('');
    setModalRulesScrolledEnd(false);
    setShowRulesModal(true);
  }

  const vacRulesList = (
    <>
      <p className="text-[12.5px] text-gray-500">{t.preExamVacRulesIntroModal}</p>
      {t.preExamVacRulesItems.split('|||RULE|||').map((line, i) => (
        <div key={i} className="flex gap-2.5">
          <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 font-bold text-[11px] tabular-nums mt-0.5">
            {i + 1}
          </span>
          <p className="min-w-0 flex-1">{line.trim()}</p>
        </div>
      ))}
    </>
  );

  const positionLabel = (
    {
      WAITING: t.preExamPositionWaiting,
      NO_FACE: t.preExamPositionNoFace,
      MULTIPLE_FACES: t.preExamPositionMulti,
      TOO_FAR: t.preExamPositionTooFar,
      TOO_CLOSE: t.preExamPositionTooClose,
      OFF_CENTER: t.preExamPositionOffCenter,
      TURNED: t.preExamPositionTurned,
      OK: t.preExamPositionOk,
    } as Record<FacePositionStatus, string>
  )[positionStatus];

  // Qoidalarni serverdan olamiz. Matn JONLI sozlamalardan yaratiladi,
  // shuning uchun u tizim xatti-harakatidan hech qachon farq qilmaydi.
  useEffect(() => {
    let alive = true;
    setRulesLoading(true);
    setRulesError(false);
    void (async () => {
      // Tarmoq uzilishi imtihonni to'sib qo'ymasligi kerak — bir necha
      // marta urinamiz, keyin ekranda sabab ko'rsatamiz.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!alive) return;
        try {
          const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/vac-rules`), {
            headers: examAuthHeaders(token),
          });
          const data = await readJsonSafe<VacRules>(res);
          if (!alive) return;
          if (res.ok && data) {
            setVacRules(data);
            if (data.already_accepted) {
              setRulesChecked(true);
              setConsentSaved(true);
            }
            setRulesLoading(false);
            return;
          }
        } catch {
          /* keyingi urinish */
        }
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
      if (alive) {
        setRulesLoading(false);
        setRulesError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [exam.id, token, lang, rulesReload]);

  /** Rozilikni serverga yozadi — bu apellyatsiyadagi asosiy dalil. */
  const submitConsent = useCallback(async () => {
    if (!vacRules || !rulesChecked || consentBusy) return;
    setConsentBusy(true);
    setConsentError('');
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/vac-consent`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...examAuthHeaders(token) },
        body: JSON.stringify({
          accepted: true,
          version: vacRules.version,
          mic_level: micPeak,
        }),
      });
      if (res.ok) {
        setConsentSaved(true);
      } else if (res.status === 409) {
        // Qoidalar shu orada o'zgargan — yangisini ko'rsatamiz.
        setConsentError(PRE_L[lang].preExamRulesChanged);
        setRulesChecked(false);
        setConsentSaved(false);
        const fresh = await fetch(apiUrl(`/api/student/exams/${exam.id}/vac-rules`), {
          headers: examAuthHeaders(token),
        });
        const data = await readJsonSafe<VacRules>(fresh);
        if (data) setVacRules(data);
      } else {
        setConsentError(PRE_L[lang].preExamConsentFailed);
      }
    } catch {
      setConsentError(PRE_L[lang].preExamConsentFailed);
    } finally {
      setConsentBusy(false);
    }
  }, [vacRules, rulesChecked, consentBusy, exam.id, token, micPeak, lang]);

  // --- MIKROFON ESHITISH TESTI -------------------------------------------
  // Mikrofonning ULANGANI yetarli emas: tovushi nolga tushirilgan mikrofon
  // ham "ulangan" bo'lib ko'rinadi va butun imtihon davomida hech narsa
  // eshitilmaydi. Nomzod gapiradi — daraja fon shovqinidan sezilarli
  // baland bo'lishi shart.
  useEffect(() => {
    if (centerRoom || !micReady || micHeard) return;
    const src = videoRef.current?.srcObject;
    if (!(src instanceof MediaStream) || src.getAudioTracks().length === 0) return;

    let ctx: AudioContext | null = null;
    let raf = 0;
    let hits = 0;
    let ticks = 0;
    const floor = new NoiseFloorEstimator();
    try {
      ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(src).connect(analyser);
      void ctx.resume?.().catch(() => {});
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        ticks += 1;
        // XAVFSIZLIK DARVOZASI: audio dvigateli ishlamasa (kontekst
        // "running" bo'lmasa) o'lchash MUMKIN EMAS. Bunday holatda
        // nomzodni qulflab qo'yish noto'g'ri — sinov o'tkazib yuboriladi.
        if (ctx && ctx.state !== 'running' && ticks > 30) {
          console.warn('[mic-test] AudioContext', ctx.state, '— sinov o\'tkazib yuborildi');
          setMicHeard(true);
          return;
        }
        analyser.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        const fl = floor.push(rms);
        setMicLevel(Math.min(1, rms * 8));
        setMicPeak((p) => (rms > p ? rms : p));
        // Gapirish ovozi: mutlaq darajada ham, fon ustida ham baland.
        if (rms >= MIC_TEST_RMS_MIN && rms > fl * 3) hits += 1;
        else hits = 0;
        if (hits >= 3) {
          setMicHeard(true);
          return;
        }
        raf = window.setTimeout(tick, 100);
      };
      raf = window.setTimeout(tick, 100);
    } catch (err) {
      // AudioContext umuman ochilmadi — o'lchay olmaymiz. Bu nomzodning
      // aybi emas, shuning uchun sinov o'tkazib yuboriladi. Aks holda
      // butun oqim qulflanib qolardi.
      console.warn('[mic-test] AudioContext ochilmadi — sinov o\'tkazib yuborildi', err);
      setMicHeard(true);
      return;
    }
    return () => {
      window.clearTimeout(raf);
      void ctx?.close?.().catch(() => {});
    };
  }, [micReady, micHeard, centerRoom]);

  // Progress qadamlari — qoidalar oxirgi "Boshlash" modali orqali tasdiqlanadi.
  const steps = [
    { label: PRE_L[lang].stepCamera, done: cameraReady },
    { label: PRE_L[lang].stepIdentity, done: verified },
    { label: PRE_L[lang].stepLiveness, done: livenessPassed },
    ...(desktopApp ? [{ label: PRE_L[lang].stepComputer, done: sysOk }] : []),
    ...(screenRequired ? [{ label: PRE_L[lang].stepScreen, done: screenShared }] : []),
    { label: PRE_L[lang].stepConsent, done: consentSaved },
    ...(roomScanRequired ? [{ label: PRE_L[lang].stepRoom, done: roomScanned }] : []),
  ];
  const activeStepIdx = steps.findIndex((s) => !s.done);

  const blocked: string[] = [];
  if (exam?.test_center_enabled && !centerMode) {
    blocked.push(
      lang === 'ru'
        ? 'Сотрудник тестового центра должен ввести PIN-код'
        : lang === 'en'
          ? 'A test-centre staff member must enter the PIN'
          : 'Test markazi xodimi PIN kodni kiritishi kerak',
    );
  }
  if (!cameraReady) blocked.push(t.preExamBlockedCamera);
    if (!centerRoom && !micReady) blocked.push(t.preExamBlockedMic);
    if (!centerRoom && micReady && !micHeard) blocked.push(t.preExamBlockedMicHeard);
  if (!consentSaved) blocked.push(t.preExamBlockedConsent);
  if (screenRequired && !screenShared) blocked.push(PRE_L[lang].preExamBlockedScreen);
  if (!sysOk) blocked.push(PRE_L[lang].preExamBlockedComputer);
  if (roomScanRequired && !roomScanned) blocked.push(PRE_L[lang].preExamBlockedRoom);
  if (!user.profile_image) blocked.push(t.preExamBlockedPhoto);
  if (!verified) blocked.push(t.preExamBlockedIdentity);
  if (!livenessPassed || livenessChecking) blocked.push(t.preExamBlockedLiveness);
  if (imageQuality !== 'OK') blocked.push(t.preExamBlockedQuality);
  if (netStatus !== 'OK') blocked.push(t.preExamBlockedNetwork);
  const canStart = blocked.length === 0 && !locked;

  const studentDisplayName = (user.name || user.id || '').toString().trim();
  const nameParts = studentDisplayName.split(/\s+/).filter(Boolean);
  const studentFirstName = nameParts[0] || studentDisplayName;
  const studentLastName = nameParts.slice(1).join(' ');

  // Imtihon yopilgan — tekshiruv sahifasini KO'RSATMAYMIZ. Ilgari sahifa to'liq
  // ochiq qolar, kamera ishlab turar, "Kirish" bosilaverar va har urinishda
  // shaxs tasdiqlash (server + AI) bekorga sarflanardi.
  if (locked) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full min-h-[60dvh] flex items-center justify-center p-4"
      >
        <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-sm p-6 sm:p-8 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{t.preExamClosedTitle}</h2>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">{t.preExamClosedBody}</p>
          </div>
          {error && <AdminAlert type="error" compact>{error}</AdminAlert>}
          <AdminBtn variant="blue" size="lg" className="w-full" onClick={onCancel}>
            {t.cancel}
          </AdminBtn>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="w-full h-[calc(100dvh-62px)] sm:h-[calc(100dvh-66px)] flex flex-col bg-gray-50 overflow-hidden"
    >
      <div className="w-full px-3 sm:px-6 lg:px-8 py-3 sm:py-4 flex flex-col gap-3 flex-1 min-h-0">
        {/* ── Sub-header: title + stepper ── */}
        <div className="shrink-0 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <h1 className="text-[19px] sm:text-[22px] font-bold text-gray-900 tracking-tight leading-tight">
              {t.preExamTitle}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 max-w-full rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[12px] font-semibold text-indigo-800">
                <svg className="h-3.5 w-3.5 shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="truncate">{exam.title}</span>
              </span>
              {user.group_name && (
                <span className="inline-flex items-center gap-1.5 max-w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-medium text-gray-600">
                  <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="truncate">{user.group_name}</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 max-w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-medium text-gray-700">
                <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="truncate">
                  <span className="font-semibold text-gray-900">{studentFirstName}</span>
                  {studentLastName ? <span className="text-gray-500"> {studentLastName}</span> : null}
                </span>
              </span>
            </div>
          </div>
          {exam?.test_center_enabled ? (
            <div className={`rounded-xl border px-3.5 py-3 ${centerMode ? 'border-emerald-200 bg-emerald-50' : 'border-indigo-100 bg-indigo-50/60'}`}>
              {centerMode ? (
                <p className="text-[13px] font-semibold text-emerald-800">
                  ✓ {lang === 'ru' ? 'Режим тестового центра: микрофон не используется, камера контролируется полностью.' : lang === 'en' ? 'Test-centre mode: the microphone is not used; the camera is fully monitored.' : "Test markazi rejimi: mikrofon ishlatilmaydi, kamera to'liq nazorat qilinadi."}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="min-w-[200px] flex-1">
                    <p className="text-[13px] font-bold text-gray-900">{lang === 'ru' ? 'Тестовый центр' : lang === 'en' ? 'Test centre' : 'Test markazi'}</p>
                    <p className="text-[12px] text-gray-600">{lang === 'ru' ? 'Если вы сдаёте в тестовом центре, проверяющий вводит PIN-код.' : lang === 'en' ? 'Taking the exam at the test centre? The proctor enters the PIN.' : "Test markazida topshiryapsizmi? PIN kodni tekshiruvchi kiritadi."}</p>
                  </div>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={8}
                    value={centerPin}
                    onChange={(e) => setCenterPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submitCenterPin(); }}
                    placeholder="PIN"
                    aria-label="PIN"
                    className="h-10 w-24 rounded-lg border border-gray-300 bg-white px-3 text-center text-[16px] tracking-[0.4em] focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
                  />
                  <AdminBtn variant="blue" size="sm" loading={centerBusy} disabled={centerPin.length < 4 || centerPin.length > 8} onClick={() => void submitCenterPin()}>
                    {lang === 'ru' ? 'Подтвердить' : lang === 'en' ? 'Confirm' : 'Tasdiqlash'}
                  </AdminBtn>
                  {centerErr ? <p className="w-full text-[12.5px] font-medium text-red-600">{centerErr}</p> : null}
                </div>
              )}
            </div>
          ) : null}
          {/* Stepper */}
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto">
            {steps.map((s, i) => {
              const isActive = i === activeStepIdx;
              return (
                <React.Fragment key={s.label}>
                  {i > 0 && <span className={`h-px w-4 sm:w-6 shrink-0 ${steps[i - 1].done ? 'bg-emerald-300' : 'bg-gray-200'}`} />}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-colors ${
                        s.done
                          ? 'bg-emerald-500 text-white'
                          : isActive
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {s.done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : i + 1}
                    </span>
                    <span className={`text-[12px] font-semibold whitespace-nowrap ${isActive ? 'inline' : 'hidden sm:inline'} ${s.done ? 'text-emerald-700' : isActive ? 'text-gray-900' : 'text-gray-400'}`}>
                      {s.label}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {(error || mediaHint) && (
          <div className="shrink-0 space-y-2 max-h-[min(28dvh,140px)] overflow-y-auto overscroll-y-contain">
            {error && <AdminAlert type="error" compact>{error}</AdminAlert>}
            {mediaHint && !error && !centerMode && <AdminAlert type="warning" compact>{mediaHint}</AdminAlert>}
          </div>
        )}

        {/* ── Body (mobilda scroll, desktopda ikki ustun — ortada bo'sh joy qoldirmaydi) ── */}
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto overscroll-y-contain">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 items-start">
          {/* Kamera (chap ustun) — logo olib tashlandi. Shaxs/jonlik tekshiruvi
              endi ALOHIDA (o'ng) ustunda — ikkalasi ham video ostiga siqilib,
              qisqargan joy ichida qolib ketmasin (jonlik qismi ko'rinmay qolardi). */}
          <div className="flex flex-col gap-3">
            <div className="shrink-0">
              <div className="relative w-full rounded-xl overflow-hidden border border-gray-300 bg-slate-900 aspect-video max-h-[46dvh]">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)', filter: 'brightness(1.12) contrast(1.08) saturate(1.03)' }}
                />
                <canvas ref={canvasRef} className="hidden" aria-hidden />
                <canvas ref={livenessCanvasRef} className="hidden" aria-hidden />
                {!cameraReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs bg-slate-800 px-2 text-center">
                    <svg className="w-8 h-8 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    {t.preExamWaitCamera}
                  </div>
                )}
                {showVerifyCelebration && (
                  <IdentityVerifiedSuccess
                    title={t.identityVerifySuccessTitle}
                    subtitle={t.identityVerifySuccessSubtitle}
                  />
                )}
                <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/55 backdrop-blur-sm rounded-full px-2 py-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${cameraReady ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  <span className="text-white text-[10.5px] font-medium">{cameraReady ? t.preExamCameraActive : t.preExamWaitCamera}</span>
                </div>
                {!centerRoom && <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/55 backdrop-blur-sm rounded-full px-2 py-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${micHeard ? 'bg-emerald-400' : micReady ? 'bg-amber-400' : 'bg-red-400'}`} />
                  <span className="text-white text-[10.5px] font-medium">
                    {!micReady
                      ? t.preExamMicInactive
                      : micHeard
                        ? micPeak < MIC_TEST_RMS_GOOD
                          ? t.preExamMicTestWeak
                          : t.preExamMicTestOk
                        : t.preExamMicTestHint}
                  </span>
                  {micReady && !micHeard && (
                    <span className="ml-1 inline-block w-10 h-1 rounded bg-white/25 overflow-hidden align-middle">
                      <span
                        className="block h-full bg-amber-400 transition-all"
                        style={{ width: `${Math.round(micLevel * 100)}%` }}
                      />
                    </span>
                  )}
                </div>}
              </div>
            </div>

            {roomScanRequired && (
              <div className={`rounded-xl border p-3.5 ${roomScanned ? 'border-emerald-200 bg-emerald-50/40' : 'border-indigo-200 bg-white'}`}>
                <div className="text-[15px] font-semibold text-gray-900">{PRE_L[lang].roomTitle}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">{PRE_L[lang].roomBody}</p>
                {roomScanned ? (
                  <div className="mt-2 text-[12.5px] font-medium text-emerald-700">{PRE_L[lang].roomOk}</div>
                ) : roomScanLeft > 0 ? (
                  <div className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-center text-[13px] font-semibold text-white tabular-nums">
                    {PRE_L[lang].roomScanning.replace('{n}', String(roomScanLeft))}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!consentSaved}
                    onClick={() => void runRoomScan()}
                    className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white disabled:bg-gray-300"
                  >
                    {consentSaved ? PRE_L[lang].roomBtn : PRE_L[lang].roomNeedConsent}
                  </button>
                )}
                {roomScanError && (
                  <div className="mt-2 text-[12.5px] font-medium text-red-600">{roomScanError}</div>
                )}
              </div>
            )}
            {desktopApp && (
              <div className={`rounded-xl border p-3.5 ${sysOk ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[15px] font-semibold text-gray-900">{PRE_L[lang].computerTitle}</div>
                  <button
                    type="button"
                    disabled={sysBusy}
                    onClick={() => void runSysCheck()}
                    className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 disabled:opacity-50"
                  >
                    {sysBusy ? PRE_L[lang].computerChecking : PRE_L[lang].computerRecheck}
                  </button>
                </div>
                {!sysCheck ? (
                  <p className="mt-2 text-[12.5px] text-gray-500">{PRE_L[lang].computerChecking}</p>
                ) : sysCheck.ok ? (
                  <p className="mt-2 text-[12.5px] font-medium text-emerald-700">{PRE_L[lang].computerOk}</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {sysCheck.problems.map((p, i) => (
                      <div key={i} className="rounded-xl border border-rose-200 bg-white p-3">
                        <div className="text-[13px] font-semibold text-rose-700">{p.title}</div>
                        <div className="mt-0.5 text-[12px] leading-snug text-gray-600">{p.detail}</div>
                        {p.apps && p.apps.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {p.apps.map((a) => (
                              <span key={a.name} className="rounded-md bg-rose-50 px-2 py-0.5 text-[11.5px] font-medium text-rose-800">
                                {a.label}: {a.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {sysCheck.apps.length > 0 && (
                      <button
                        type="button"
                        disabled={sysBusy}
                        onClick={() => void closeForbiddenApps()}
                        className="w-full rounded-xl bg-rose-600 px-4 py-2 text-[13px] font-semibold text-white disabled:bg-gray-300"
                      >
                        {PRE_L[lang].computerCloseAll}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {screenRequired && (
              <div className={`rounded-xl border p-3.5 ${screenShared ? 'border-emerald-200 bg-emerald-50/40' : 'border-indigo-200 bg-white'}`}>
                <div className="text-[15px] font-semibold text-gray-900">{PRE_L[lang].screenTitle}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">{PRE_L[lang].screenBody}</p>
                {screenShared ? (
                  <div className="mt-2 text-[12.5px] font-medium text-emerald-700">{PRE_L[lang].screenOk}</div>
                ) : (
                  <button
                    type="button"
                    disabled={screenBusy}
                    onClick={() => void shareScreen()}
                    className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white disabled:bg-gray-300"
                  >
                    {PRE_L[lang].screenBtn}
                  </button>
                )}
                {screenError && (
                  <div className="mt-2 text-[12.5px] font-medium text-red-600">{screenError}</div>
                )}
              </div>
            )}
            {exam.custom_rules && (
              <div className="p-3 border border-gray-200 bg-gray-50 rounded-lg text-[12.5px] text-gray-600">
                <span className="font-semibold text-gray-900">{t.customRules}: </span>
                {exam.custom_rules}
              </div>
            )}
          </div>

          {/* Shaxs va jonlilik tekshiruvi — o'z ustuni. */}
          <section className="flex flex-col gap-3">
            {user.profile_image ? (
              <div className={`flex flex-col min-h-0 p-3.5 border rounded-xl space-y-2.5 transition-colors ${verified ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="relative shrink-0">
                    <img
                      src={user.profile_image}
                      alt={t.profilePhotoLabel}
                      className="w-11 h-11 rounded-lg object-cover ring-1 ring-gray-200"
                      referrerPolicy="no-referrer"
                    />
                    {verified && (
                      <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-white">
                        <Check className="h-3 w-3 stroke-[3]" aria-hidden />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-gray-900 text-[14px] leading-tight">{t.identityVerification}</h4>
                    <p className="text-[12px] text-gray-500 truncate mt-0.5">{user.name || user.id}</p>
                  </div>
                </div>

                {identityError && (
                  <AdminAlert type="error" compact>
                    {identityError}
                  </AdminAlert>
                )}

                {!verified && !isRetakeResolved && (
                  <div className={`shrink-0 rounded-lg px-3 py-2 border flex items-center gap-2 transition-colors ${positionOk ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${positionOk ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                    <p className={`text-[12.5px] font-medium leading-snug ${positionOk ? 'text-emerald-700' : 'text-amber-700'}`}>{positionLabel}</p>
                  </div>
                )}

                <AdminBtn
                  onClick={verifyIdentity}
                  disabled={!cameraReady || verifying || verified || (!positionOk && !isRetakeResolved)}
                  variant={verified ? 'emerald' : 'blue'}
                  size="md"
                  loading={verifying}
                  className="w-full shrink-0"
                >
                  {verified ? t.identityVerified : t.identityVerifyBtn}
                </AdminBtn>

                {(verified || livenessChecking || livenessPassed || livenessFailed || challengeStatus !== 'idle') && (
                  <div className="min-h-0 max-h-[min(40dvh,320px)] overflow-y-auto overscroll-y-contain text-[12.5px] text-gray-600 pr-0.5">
                    {verified && !passiveMotionOk && !livenessChecking && !livenessFailed && (
                      <p>{t.preExamLivenessSelfHint}</p>
                    )}
                    {livenessChecking && (
                      <p className="text-indigo-700 flex items-center gap-1.5">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                        {t.preExamLivenessWaiting}
                      </p>
                    )}
                    {!livenessPassed && livenessFailed && !livenessChecking && (
                      <AdminBtn
                        variant="ghost"
                        size="sm"
                        className="w-full mt-1"
                        onClick={() => {
                          setLivenessFailed(false);
                          setIdentityError('');
                          setLivenessRetryKey((k) => k + 1);
                        }}
                      >
                        {t.preExamLivenessRetryBtn}
                      </AdminBtn>
                    )}
                    {challengeStatus === 'running' && challengeStep && (
                      <div className="space-y-1">
                        <p className="font-semibold text-indigo-700 flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                          {LIVENESS_PROMPT_KEY[challengeStep.action]
                            ? t[LIVENESS_PROMPT_KEY[challengeStep.action]]
                            : ''}
                        </p>
                        {challengeStep.total > 1 && (
                          <p className="text-[11px] text-slate-400 tabular-nums">
                            {t.preExamChallengeProgress
                              .replace('{cur}', String(challengeStep.step))
                              .replace('{total}', String(challengeStep.total))}
                          </p>
                        )}
                      </div>
                    )}
                    {challengeStatus === 'failed' && (
                      <AdminBtn
                        variant="ghost"
                        size="sm"
                        className="w-full mt-1"
                        onClick={() => {
                          setChallengeStatus('idle');
                          setIdentityError('');
                          setChallengeRetryKey((k) => k + 1);
                        }}
                      >
                        {t.preExamChallengeRetryBtn}
                      </AdminBtn>
                    )}
                    {livenessPassed && (
                      <p className="font-semibold text-emerald-700 flex items-center gap-1.5">
                        <Check className="w-4 h-4 stroke-[3]" /> {t.preExamLivenessPassed}
                      </p>
                    )}
                  </div>
                )}

                {/* ── Nazorat sifati: ko'z / tasvir / internet ──
                    Nigoh nazorati qorachiqni o'qishga tayanadi, shaxs tekshiruvi
                    va kadr tahlili esa har 15s rasm yuboradi. Ikkisi ham imtihon
                    boshlangandan keyin tuzatilmaydi — shu sabab shart. */}
                <div className="mt-2 pt-2 border-t border-gray-100 space-y-1.5 text-[12.5px]">
                  {[
                    {
                      title: t.preExamQualityTitle,
                      ok: imageQuality === 'OK',
                      msg: {
                        OK: t.preExamQualityOk,
                        BLURRY: t.preExamQualityBlurry,
                        TOO_DARK: t.preExamQualityDark,
                        TOO_BRIGHT: t.preExamQualityBright,
                        LOW_CONTRAST: t.preExamQualityLowContrast,
                      }[imageQuality],
                      extra: '',
                    },
                    {
                      title: t.preExamNetworkTitle,
                      ok: netStatus === 'OK',
                      msg: {
                        CHECKING: t.preExamNetworkChecking,
                        OK: t.preExamNetworkOk,
                        SLOW: t.preExamNetworkSlow,
                        UNSTABLE: t.preExamNetworkUnstable,
                        OFFLINE: t.preExamNetworkOffline,
                      }[netStatus],
                      extra: netDetail,
                    },
                  ].map((row) => (
                    <div key={row.title} className="flex items-start gap-2">
                      <span
                        className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${
                          row.ok ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="text-gray-400">{row.title}: </span>
                        <span className={row.ok ? 'text-emerald-700 font-medium' : 'text-amber-800'}>
                          {row.msg}
                        </span>
                        {row.extra ? <span className="text-gray-400"> · {row.extra}</span> : null}
                      </span>
                    </div>
                  ))}
                  {netStatus !== 'OK' && netStatus !== 'CHECKING' && (
                    <AdminBtn
                      variant="ghost"
                      size="sm"
                      className="w-full mt-1"
                      onClick={() => setNetRetryKey((k) => k + 1)}
                    >
                      {t.preExamNetworkRetryBtn}
                    </AdminBtn>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-[12.5px] font-medium">
                {t.profilePhotoMissingExam}
              </div>
            )}
            {/* Nazorat qoidalari — ixcham, scrollsiz; to'liq matn alohida oynada. */}
            {!vacRules ? (
              <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                <div className="text-[14px] font-semibold text-gray-900">{PRE_L[lang].stepConsent}</div>
                {rulesLoading && !rulesError ? (
                  <p className="mt-1 text-[12px] text-gray-500">{PRE_L[lang].preExamRulesLoading}</p>
                ) : (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium text-red-600">{PRE_L[lang].preExamRulesFailed}</p>
                    <button
                      type="button"
                      onClick={() => setRulesReload((n) => n + 1)}
                      className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white"
                    >
                      {PRE_L[lang].preExamRulesRetry}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className={`rounded-xl border p-3.5 ${consentSaved ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[14px] font-semibold text-gray-900 truncate">{vacRules.title}</div>
                  <button
                    type="button"
                    onClick={() => setRulesFullOpen(true)}
                    className="shrink-0 text-[12px] font-semibold text-indigo-700 hover:underline"
                  >
                    {lang === 'ru' ? 'Полные правила' : lang === 'en' ? 'Full rules' : "To'liq qoidalar"}
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-1.5">
                  {vacRules.sections.map((sec, si) => (
                    <div key={si} className="min-w-0">
                      <div className="text-[11.5px] font-semibold text-gray-800 truncate">{sec.title}</div>
                      <p className="text-[11px] leading-snug text-gray-500 line-clamp-2">{sec.items.join(' · ')}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-start gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      checked={rulesChecked}
                      disabled={consentSaved}
                      onChange={(e) => setRulesChecked(e.target.checked)}
                    />
                    <span className="text-[12px] leading-snug text-gray-800">{vacRules.consent_label}</span>
                  </label>
                  {consentSaved ? (
                    <span className="shrink-0 text-[12px] font-semibold text-emerald-700">✓ {PRE_L[lang].preExamConsentSaved}</span>
                  ) : (
                    <button
                      type="button"
                      disabled={!rulesChecked || consentBusy}
                      onClick={() => void submitConsent()}
                      className="shrink-0 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:bg-gray-300"
                    >
                      {PRE_L[lang].preExamConsentButton}
                    </button>
                  )}
                </div>
                {consentError && <div className="mt-1.5 text-[12px] font-medium text-red-600">{consentError}</div>}
              </div>
            )}
          </section>
            </div>

        {/* ── Footer action bar (kontent ostida, ortada bo'sh joy yo'q) ── */}
        <div className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-3 space-y-2 shadow-[0_-4px_24px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
            <div className="flex gap-2 w-full sm:w-auto shrink-0">
              <AdminBtn variant="ghost" size="lg" onClick={onCancel} className="flex-1 sm:flex-none">
                {t.cancel}
              </AdminBtn>
              <AdminBtn
                variant="blue"
                size="lg"
                onClick={() => void openRulesModal()}
                disabled={!canStart || starting}
                loading={starting && showRulesModal}
                className="flex-1 sm:flex-none sm:px-8"
              >
                {starting && showRulesModal ? t.preExamStarting : t.preExamEnterExam}
              </AdminBtn>
            </div>
          </div>

          {/* Profil rasmi yo'q bo'lsa imtihonga KIRIB BO'LMAYDI va tekshiruv
              tugmasi ham ishlamaydi — boshi berk ko'cha edi. Endi shu yerda
              rasmni o'zi yuklaydigan sahifaga havola beriladi. */}
          {!user.profile_image && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <div className="text-[13px] font-semibold text-amber-900">
                {lang === 'ru'
                  ? 'В вашем профиле нет фотографии — без неё вход на экзамен невозможен.'
                  : lang === 'en'
                    ? 'Your profile has no photo — you cannot enter the exam without it.'
                    : "Profilingizda rasm yo'q — usiz imtihonga kirib bo'lmaydi."}
              </div>
              <div className="text-[12px] text-amber-800 mt-0.5">
                {lang === 'ru'
                  ? 'Откройте страницу ниже, загрузите фото паспорта и сделайте снимок на камеру — это займёт минуту.'
                  : lang === 'en'
                    ? 'Open the page below, upload your passport photo and take a camera snapshot — it takes a minute.'
                    : "Quyidagi sahifani oching, pasport rasmini yuklang va kamerada o'zingizni suratga oling — bir daqiqa vaqt oladi."}
              </div>
              <a
                href="/profil-rasm"
                className="inline-flex items-center gap-1.5 mt-2 px-3 py-2 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700"
              >
                {lang === 'ru' ? 'Загрузить фото' : lang === 'en' ? 'Upload photo' : 'Rasmni yuklash'}
              </a>
            </div>
          )}

          {!canStart && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11.5px] text-gray-500">
              <span className="font-semibold text-gray-600">{t.preExamStartChecklist}</span>
              {blocked.map((b) => (
                <span key={b} className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>

      {rulesFullOpen && vacRules && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setRulesFullOpen(false)}
        >
          <div
            className="flex w-full max-w-3xl max-h-[88dvh] flex-col rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="shrink-0 px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-900">{vacRules.title}</h2>
                <p className="mt-1 text-[12.5px] text-gray-500">{vacRules.intro}</p>
              </div>
              <button
                type="button"
                onClick={() => setRulesFullOpen(false)}
                className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
                aria-label="close"
              >
                ✕
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              {vacRules.sections.map((sec, si) => (
                <div key={si}>
                  <div className="text-[13px] font-semibold text-gray-800">{sec.title}</div>
                  {sec.note && <p className="mt-0.5 text-[12px] leading-snug text-gray-500">{sec.note}</p>}
                  <ul className="mt-1 list-disc pl-5 space-y-0.5">
                    {sec.items.map((it, ii) => (
                      <li key={ii} className="text-[12.5px] leading-snug text-gray-700">
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showRulesModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pre-exam-rules-modal-title"
        >
          <div className="flex w-full max-w-lg max-h-[min(88dvh,640px)] flex-col rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
            <header className="shrink-0 px-5 py-4 border-b border-gray-100">
              <h2 id="pre-exam-rules-modal-title" className="font-display text-lg text-gray-900">
                {t.preExamVacRulesTitle}
              </h2>
              <p className="mt-1 text-[12.5px] text-gray-500">{t.preExamRulesModalHint}</p>
            </header>
            <div
              ref={modalRulesBoxRef}
              data-testid="vac-rules-modal-box"
              className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-5 py-4 text-[13px] text-gray-700 leading-relaxed space-y-3"
            >
              {vacRulesList}
            </div>
            {!modalRulesScrolledEnd && (
              <p className="shrink-0 px-5 py-2 text-center text-[11px] font-medium text-gray-500 bg-gray-50 border-t border-gray-100">
                ↓ {t.preExamVacRulesScrollHint}
              </p>
            )}
            <div className="shrink-0 flex gap-2 border-t border-gray-100 p-4">
              <AdminBtn
                variant="ghost"
                size="lg"
                className="flex-1"
                disabled={starting}
                onClick={() => setShowRulesModal(false)}
              >
                {t.cancel}
              </AdminBtn>
              <AdminBtn
                variant="blue"
                size="lg"
                className="flex-1"
                disabled={!modalRulesScrolledEnd || starting}
                loading={starting}
                onClick={() => void handleEnter()}
              >
                {starting ? t.preExamStarting : t.preExamRulesModalConfirm}
              </AdminBtn>
            </div>

            {/* Vakansiya nomzodiga savollar shu paytda yaratiladi (AI, 1-5
                daqiqa). Kutish oynasisiz odam sahifa qotib qoldi deb o'ylaydi. */}
            {starting && (
              <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3.5">
                <div className="flex items-center gap-2.5">
                  <svg className="h-5 w-5 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                  </svg>
                  <div className="text-[14px] font-semibold text-indigo-900">
                    {!isVacancy
                      ? lang === 'ru'
                        ? 'Для вас создаются новые вопросы, подождите…'
                        : lang === 'en'
                          ? 'New questions are being generated for you, please wait…'
                          : 'Siz uchun yangi savollar yaratilmoqda, kuting…'
                      : lang === 'ru'
                      ? 'Тесты готовятся, подождите немного…'
                      : lang === 'en'
                        ? 'Your test is being prepared, please wait…'
                        : 'Testlar tayyorlanmoqda, bir oz kuting…'}
                  </div>
                </div>
                <div className="mt-1.5 text-[12.5px] text-indigo-800/80">
                  {lang === 'ru'
                    ? 'Обычно 1–5 минут. Не закрывайте страницу.'
                    : lang === 'en'
                      ? 'Usually 1-5 minutes. Do not close this page.'
                      : 'Odatda 1-5 daqiqa. Sahifani yopmang.'}
                  {waitSec > 0
                    ? ' · ' + Math.floor(waitSec / 60) + ':' + String(waitSec % 60).padStart(2, '0')
                    : ''}
                </div>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-indigo-200">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-indigo-500" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
