/**
 * Real-time brauzer proctoring (MediaPipe FaceLandmarker + HandLandmarker).
 *
 * Gibrid dizayn: bu modul yuqori chastotali (~6 fps) real-time signal beradi
 * (gaze/bosh burilishi, ortiqcha qimirlash, qo'l/imo-ishora, ko'p yuz, yuz yo'q).
 * Server tarafi (proctor-frame, har ~20-30s) bularni tasdiqlaydi va avtoritativ
 * jazo (warning/ban) ni `student_violations` orqali beradi.
 *
 * Graceful degradation: model yuklanmasa (CDN bloklangan, eski qurilma) engine
 * jim o'chadi — server proctoring ishlayveradi. Hech qachon imtihonni buzmaydi.
 *
 * Modellar avval O'Z domenimizdan (`public/mediapipe/`, build paytida
 * `scripts/sync-mediapipe-assets.mjs` tayyorlaydi), u ochilmasa CDN zaxirasidan
 * lazy-load qilinadi — `lib/mediapipeAssets.ts` ga qarang.
 */

import { createWithDelegateFallback, formatDelegateErrors } from './mediapipeDelegate';
import { mediapipeAssetSources } from './mediapipeAssets';
import { CenterObserverTracker, CENTER_OBSERVER_MS, primaryFaceIndex } from './testCenterFaces';
import { CENTER_IGNORED } from './testCenterPolicy';
import { rhythmicSpeech } from './speechMotion';

export type RealtimeViolation =
  | 'FACE_NOT_VISIBLE'
  | 'MULTIPLE_FACES'
  | 'GAZE_AWAY_LEFT'
  | 'GAZE_AWAY_RIGHT'
  | 'GAZE_AWAY_UP'
  | 'GAZE_AWAY_DOWN'
  | 'FACE_TURNED_AWAY'
  | 'EXCESSIVE_MOVEMENT'
  | 'HAND_GESTURE_SUSPECTED'
  | 'MOUTH_MOVEMENT_TALKING'
  | 'SIDE_CONVERSATION_SUSPECTED'
  | 'FACE_TOO_FAR'
  | 'FACE_TOO_CLOSE'
  | 'FACE_OFF_CENTER'
  | 'GAZE_DOWN_TOTAL'
  | 'GAZE_SIDE_TOTAL'
  | 'HAND_NEAR_EAR';

/** Real-time kamera overlay uchun — violation emas, faqat vizual holat. */
export type FaceStatusLive =
  | 'WAITING'
  | 'OK'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'TOO_FAR'
  | 'TOO_CLOSE'
  | 'OFF_CENTER'
  | 'TURNED'
  | 'GAZE_AWAY';

/**
 * "Davomiy" tabiatga ega signallar (gapirish, boshning burilishi, pozitsiya) uchun
 * ikki bosqichli qoida (README.md "Proctoring eskalatsiya qoidasi"):
 *   1) LIVE_SIGNAL_CONFIRM_MS (1.5s) uzluksiz davom etsa — kamera panelida kichik
 *      vizual ogohlantirish chiqadi (hali rasmiy emas, backendga yuborilmaydi).
 *   2) Signal shundan keyin ham davom etib, jami LIVE_SIGNAL_ESCALATE_MS (4s) ga
 *      yetsa — haqiqiy (backendga yuboriladigan) rasmiy ogohlantirishga aylanadi
 *      (ya'ni kichikdan keyin yana ~2.5s tuzatishga vaqt beriladi).
 * Yuz yo'q (NO_FACE) va ko'p yuz (MULTI_FACE) ham shu qonunga bo'ysunadi — lekin
 * identity xavfsizligi uchun "recheck" darhol ishlaydi (rasmiy violation esa 4s da).
 */
export type LiveSignalType =
  | 'TALKING'
  | 'HEAD_AWAY'
  | 'TOO_FAR'
  | 'TOO_CLOSE'
  | 'OFF_CENTER'
  | 'MOVEMENT'
  | 'HAND'
  | 'NO_FACE'
  | 'MULTI_FACE';
export const LIVE_SIGNAL_CONFIRM_MS = 1500;
export const LIVE_SIGNAL_ESCALATE_MS = 4000;
/**
 * YONGA (chap/o'ng) qarash uchun qisqaroq chegara.
 *
 * Nega alohida: umumiy 4 soniya yuz masofasi/markazdan siljish kabi
 * soxta signalga moyil turlar uchun mo'ljallangan. Yonga qarash esa
 * boshqacha — kamera monitor tepasida turgani ekranga qarashni "pastga"
 * ko'rsatadi, "yonga" emas. Uzoq yonga qarash yonidagi odamdan yoki
 * qog'ozdan o'qishni bildiradi, shuning uchun tezroq javob beramiz.
 *
 * INSON OMILI: ekranda kichik ogohlantirish 1.5 soniyada chiqadi.
 * Chegara 2.5 soniya bo'lganda topshiruvchiga o'zini to'g'rilash uchun
 * atigi 1 soniya qolardi — odam uchun bu kam. 3.5 soniya 2 soniya
 * imkon beradi. Bir zum yonga qarash, charchab qimirlash, o'rindiqda
 * joylashish — hech biri jazolanmaydi; faqat DAVOMLI qarash.
 */
export const GAZE_SIDE_ESCALATE_MS = 2000;
// JIDDIY, aniq qoidabuzarliklar (yuz umuman yo'q = turib ketdi/chiqib ketdi; kadrda
// ko'p yuz = kimdir keldi) uchun TEZ eskalatsiya — bularni "tuzatishga vaqt berish"
// mantig'i shart emas, darhol ushlash kerak.
export const LIVE_SIGNAL_ESCALATE_FAST_MS = 1200;

// GAPIRISH uchun MAXSUS (tezroq) qoida — README.md "Gapirish uchun maxsus qoida".
// Mikrofon Silero VAD (ExamRoom):
//   ~0.3s uzluksiz → kichik ogohlantirish, ~1.8s → rasmiy.
//
// 2026-08-03: 800/2500 → 300/1800. Sabab: 800ms bitta so'zni deyarli hech
// qachon ushlamasdi (haqiqiy so'z ~300-700ms) — talaba faqat 2+ so'z aytsa
// (pauza SPEECH_MIN_FRAMES/GRACE bilan ko'prik bo'lib) chip chiqardi.
// `verify_chain.py`da o'lchangan (LibriSpeech 80 nutq + ESC-50 124 shovqin,
// custom bitta-so'z simulyatsiyasi): chip 98.8%→100%, rasmiy 50-62%→91-92.5%,
// shovqin FP chip 0%→3.2% (arzon — jazosiz yorliq), rasmiy FP hamon 0%.
// Shovqin (SUSPICIOUS_AUDIO) bunga KIRMAYDI — undagi LIVE_SIGNAL_* o'zgarmadi.
export const TALK_SIGNAL_CONFIRM_MS = 300;
export const TALK_SIGNAL_ESCALATE_MS = 1800;

/** QONUN ISTISNOSI — darhol yorliq beriladigan turlar (0.4s).
 *  Sabab: gapirish va nigohni chetga olish bir zumda bo'ladi. 1.5s kutish
 *  talabaga javobni ko'rib olishga yetarli vaqt berardi. */
export const INSTANT_SIGNAL_CONFIRM_MS = 400;

/** Shu signal turi uchun "kichik ogohlantirish" chegarasi. */
export function confirmMsFor(type: LiveSignalType): number {
  if (type === 'TALKING' || type === 'HEAD_AWAY') return INSTANT_SIGNAL_CONFIRM_MS;
  return LIVE_SIGNAL_CONFIRM_MS;
}

/**
 * Kichik ogohlantirish (live signal) qaysi RASMIY violation turiga aylanadi.
 * "3 kichik → 4-si rasmiy" qonunida kerak: limit to'lganda ExamRoom shu turni
 * darhol backendga yuboradi.
 */
const LIVE_SIGNAL_TO_VIOLATION: Record<LiveSignalType, RealtimeViolation> = {
  TALKING: 'MOUTH_MOVEMENT_TALKING',
  HEAD_AWAY: 'FACE_TURNED_AWAY',
  TOO_FAR: 'FACE_TOO_FAR',
  TOO_CLOSE: 'FACE_TOO_CLOSE',
  OFF_CENTER: 'FACE_OFF_CENTER',
  MOVEMENT: 'EXCESSIVE_MOVEMENT',
  HAND: 'HAND_GESTURE_SUSPECTED',
  NO_FACE: 'FACE_NOT_VISIBLE',
  MULTI_FACE: 'MULTIPLE_FACES',
};

export function liveSignalViolationType(type: LiveSignalType): RealtimeViolation {
  return LIVE_SIGNAL_TO_VIOLATION[type];
}

/** Video manbadan kelishi mumkin bo'lgan barcha violation turlari (ledger'ni tozalash uchun). */
export const ALL_LIVE_SIGNAL_VIOLATIONS: RealtimeViolation[] =
  Object.values(LIVE_SIGNAL_TO_VIOLATION);

// Kichik chip (kamera panelidagi sariq qator) shu turlar uchun chiqadi. Pozitsiya/gaze
// (uzoq/yaqin/markaz/burilish) kamera badge'ida ko'rsatiladi — takror bo'lmasin. Lekin
// yuz yo'q / ko'p yuz — jiddiy, shu sabab ular ham chip bilan aniq ko'rsatiladi.
const CHIP_SIGNAL_TYPES = new Set<LiveSignalType>([
  // TALKING chip/modal YO'Q — gapirish faqat Silero mikrofon VAD orqali (ExamRoom).
  'MOVEMENT',
  'HAND',
  'NO_FACE',
  'MULTI_FACE',
]);


// Detection tezligi va bardoshlilik. Tez aniqlash uchun streak/cooldown kichik.
const DETECT_INTERVAL_MS = 150; // ~6.5 fps (yuk/tezlik balansi — proctoring uchun yetarli)
// Qo'l modeli har necha kadrda ishlasin (performance). 3 = ~2.5 fps qo'l uchun —
// qo'l ko'tarish sekin (3-4s eskalatsiya), shu sabab yetarli; MediaPipe yuki kamayadi.
const HAND_DETECT_EVERY = 3;
const PER_TYPE_COOLDOWN_MS = 3500; // bir tur uchun emit oralig'i (server ham dedup qiladi)
/** Imtihon davomida JAMI pastga qarash (telefon tizzada) — birinchi signal chegarasi.
 *  Bir martalik pastga qarash jazolanmaydi; faqat yig'indi katta bo'lsa. */
const GAZE_DOWN_TOTAL_FIRST_MS = 120_000;
/** Keyingi har bir signal oralig'i (jami vaqt bo'yicha). */
const GAZE_DOWN_TOTAL_STEP_MS = 90_000;
/** Jami CHETGA (yon) qarash — birinchi signal chegarasi (yonidagi kishi/qog'ozni o'qish). */
const GAZE_SIDE_TOTAL_FIRST_MS = 60_000;
const GAZE_SIDE_TOTAL_STEP_MS = 60_000;
/** Qo'l quloq yonida uzluksiz shuncha vaqt (telefonda gaplashish / quloqchin). */
const HAND_EAR_ESCALATE_MS = 4000;

/**
 * Qo'l barmoqlari quloq sohasidami — SOF funksiya. Yuzning chap/o'ng chekkasidan tashqarida,
 * ko'z-quloq balandligida. Iyakni qo'lga tirab o'tirish (pastroq) va yuz oldidagi qo'l sanalmaydi.
 */
export function handNearEar(
  face: Array<{ x: number; y: number }>,
  hands: Array<Array<{ x: number; y: number }>>,
): boolean {
  const left = face?.[234];
  const right = face?.[454];
  const top = face?.[10];
  const chin = face?.[152];
  if (!left || !right || !top || !chin || !hands?.length) return false;
  const minX = Math.min(left.x, right.x);
  const maxX = Math.max(left.x, right.x);
  const faceW = maxX - minX;
  const faceH = Math.abs(chin.y - top.y);
  if (faceW < 0.03 || faceH < 0.03) return false;
  const earY = (left.y + right.y) / 2;
  const yMin = earY - 0.25 * faceH;
  const yMax = earY + 0.2 * faceH;
  const TIPS = [4, 8, 12, 16, 20];
  for (const hand of hands) {
    let inZone = 0;
    for (const i of TIPS) {
      const p = hand?.[i];
      if (!p || p.y < yMin || p.y > yMax) continue;
      const leftZone = p.x >= minX - 0.6 * faceW && p.x <= minX + 0.12 * faceW;
      const rightZone = p.x >= maxX - 0.12 * faceW && p.x <= maxX + 0.6 * faceW;
      if (leftZone || rightZone) inZone += 1;
    }
    if (inZone >= 2) return true;
  }
  return false;
}

// BARCHA real-time signal turi (yuz yo'q/ko'p yuz, gaze, pozitsiya, qimirlash,
// qo'l, og'iz) kichik→katta eskalatsiya qoidasiga o'tkazilgan (trackContinuous +
// LIVE_SIGNAL_ESCALATE_MS). Bu yerda alohida streak konstantalar shart emas.

// Yuz o'lchami va pozitsiya chegaralari (normalized; facePositionCheck.ts bilan moslangan).
const FACE_MIN_HEIGHT = 0.26;
const FACE_MAX_HEIGHT = 0.82;
const FACE_CTR_X_MIN = 0.28;
const FACE_CTR_X_MAX = 0.72;
const FACE_CTR_Y_MIN = 0.20;
const FACE_CTR_Y_MAX = 0.82;

// Bosh poza / gaze chegaralari (normalized landmark geometriyasi; kalibrlash mumkin).
const YAW_TURN = 0.18; // markazdan gorizontal og'ish ulushi
const YAW_HARD = 0.30; // kuchli yuz burilishi
const PITCH_UP = 0.30;
const PITCH_DOWN = 0.72;
// Burun nuqtasining frame'lararo o'rtacha siljishi. Uzoq imtihon davomida talaba
// charchab, oddiy o'tirishda ham biroz qimirlaydi — bu tabiiy, jazolanmasin.
// Faqat HADDAN TASHQARI (doimiy) qimirlash uchun (qonun: 1.5s kichik, 3s rasmiy).
const MOVE_THRESHOLD = 0.085;

// --- Qorachiq (iris) asosidagi ko'z yo'nalishi ---
// MediaPipe 478 nuqta beradi: 468 = chap iris markazi, 473 = o'ng iris markazi.
// Bosh to'g'ri turgan holda ham ko'z chetga qarasa (yonidagi qog'oz/telefon) shu aniqlaydi.
const IRIS_L = 468;
const IRIS_R = 473;
// Ko'z burchaklari va qovoqlari (chap: 33/133 burchak, 159/145 tepa/past;
// o'ng: 362/263 burchak, 386/374 tepa/past).
const EYE_L = { out: 33, in: 133, top: 159, bot: 145 };
const EYE_R = { out: 263, in: 362, top: 386, bot: 374 };
/** Qorachiq ko'z kengligining shuncha ulushiga siljisa — chetga qaragan hisoblanadi. */
const IRIS_GAZE_X = 0.16;
/** Pastga qarash (qog'oz/telefon tizzada) — ko'z balandligiga nisbatan. */
const IRIS_GAZE_DOWN = 0.32;
/** Ko'z ochiqligi (balandlik/kenglik). Bundan past — ko'z yumuq, iris ishonchsiz. */
const EYE_OPEN_MIN_RATIO = 0.15;
/** Bazaviy qiymatning shu ulushidan past — qovoq tushgan (pastga qaragan). */
const EYE_NARROW_BASELINE_RATIO = 0.62;

interface Pt {
  x: number;
  y: number;
}

/**
 * Qorachiq (iris) asosida ko'z yo'nalishi — SOF funksiya (test qilinadi).
 *
 * Bosh to'g'ri turgan holda ham ko'z chetga/pastga qarasa aniqlaydi (yonidagi
 * qog'oz, telefon, ikkinchi ekran). Qaytaradi: `{ dx, dy }` — qorachiqning ko'z
 * markazidan siljishi (ko'z o'lchamiga nisbatan; dx>0 → tasvirda o'ngga,
 * dy>0 → pastga). `null` = ishonchsiz (ko'z yumuq yoki iris nuqtalari yo'q).
 */
export function computeIrisGaze(lm: Pt[]): { dx: number; dy: number } | null {
  // Iris nuqtalari faqat 478-nuqtali modelda bor — bo'lmasa jim o'tkazamiz.
  if (!lm || lm.length <= IRIS_R) return null;

  const eyeOffset = (
    iris: Pt | undefined,
    c1: Pt | undefined,
    c2: Pt | undefined,
    top: Pt | undefined,
    bot: Pt | undefined,
  ): { dx: number; dy: number } | null => {
    if (!iris || !c1 || !c2 || !top || !bot) return null;
    const w = Math.abs(c2.x - c1.x);
    const h = Math.abs(bot.y - top.y);
    if (w < 1e-4) return null;
    // Ko'z yumuq bo'lsa iris pozitsiyasi ishonchsiz — o'tkazib yuboramiz.
    if (h / w < EYE_OPEN_MIN_RATIO) return null;
    const cx = (c1.x + c2.x) / 2;
    const cy = (top.y + bot.y) / 2;
    return { dx: (iris.x - cx) / w, dy: (iris.y - cy) / h };
  };

  const l = eyeOffset(lm[IRIS_L], lm[EYE_L.out], lm[EYE_L.in], lm[EYE_L.top], lm[EYE_L.bot]);
  const r = eyeOffset(lm[IRIS_R], lm[EYE_R.out], lm[EYE_R.in], lm[EYE_R.top], lm[EYE_R.bot]);
  if (l && r) return { dx: (l.dx + r.dx) / 2, dy: (l.dy + r.dy) / 2 };
  return l ?? r;
}

/**
 * Ko'z shunchalik toraymi/yumuqmi ki, qorachiq o'qib bo'lmaydi.
 *
 * MUHIM: aynan shu holat nazoratdagi eng katta teshik edi. Talaba PASTGA
 * (tizzadagi telefonga) qaraganda qovoq tushadi, ko'z torayadi va
 * `computeIrisGaze` `null` qaytaradi — natijada nigoh nazorati JIM bo'lib
 * qolardi. Ya'ni telefonga qarash aniqlanmasdi.
 *
 * Endi bu holat o'zi "nigoh chetda" signali sifatida hisoblanadi. Ko'z
 * pirillashi (~200ms) uzluksiz vaqt talabidan (0.4s) qisqa, shuning uchun
 * jazolanmaydi.
 */
export function eyesTooNarrowForGaze(lm: Pt[], baseline?: number | null): boolean {
  if (!lm || lm.length <= IRIS_R) return false;
  const ratio = (c1?: Pt, c2?: Pt, top?: Pt, bot?: Pt): number | null => {
    if (!c1 || !c2 || !top || !bot) return null;
    const w = Math.abs(c2.x - c1.x);
    if (w < 1e-4) return null;
    return Math.abs(bot.y - top.y) / w;
  };
  const l = ratio(lm[EYE_L.out], lm[EYE_L.in], lm[EYE_L.top], lm[EYE_L.bot]);
  const r = ratio(lm[EYE_R.out], lm[EYE_R.in], lm[EYE_R.top], lm[EYE_R.bot]);
  const vals = [l, r].filter((v): v is number => v != null);
  if (vals.length === 0) return false;   // landmark yo'q — jim o'tamiz
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  // Bazaviy qiymat bo'lsa — NISBIY taqqoslash. Ko'z ochiqligi odamlar orasida
  // keskin farq qiladi (kimningki 0.30, kimningki 0.14 — ikkalasi normal), shu
  // sabab mutlaq chegara soxta ogohlantirish beradi. Imtihon oldi tekshiruvida
  // o'lchangan SHU talabaning tabiiy qiymatining 62% dan pastga tushishi —
  // qovoq tushgani, ya'ni pastga qaragani.
  if (typeof baseline === 'number' && baseline > 0) {
    return avg < baseline * EYE_NARROW_BASELINE_RATIO;
  }
  return avg < EYE_OPEN_MIN_RATIO;
}

/** Ko'z chetga/pastga qaraganmi (chegaralar bilan). */
export function isIrisGazeAway(iris: { dx: number; dy: number } | null): boolean {
  if (iris == null) return false;
  return Math.abs(iris.dx) >= IRIS_GAZE_X || iris.dy >= IRIS_GAZE_DOWN;
}

export interface RealtimeProctorCallbacks {
  onViolation: (type: RealtimeViolation, detail?: string) => void;
  /** Yuz almashishi shubhasi (yo'qolib qayta paydo bo'ldi yoki ko'p yuz) —
   *  ExamRoom darhol server identity-compare ishga tushiradi (person-swap'ni tez ushlash). */
  onRecheckIdentity?: () => void;
  /** Har kadrda real-time yuz holati — kamera overlay uchun, violation emas. */
  onFaceStatus?: (status: FaceStatusLive) => void;
  /** Davomiy signal (gapirish/bosh burilishi/pozitsiya) hozir faolmi va necha ms'dan
   *  beri uzluksiz davom etyapti. Faol signal yo'q bo'lsa `type=null` bilan chaqiriladi. */
  onLiveSignal?: (type: LiveSignalType | null, elapsedMs: number) => void;
  /** Talaba og'zi qimirlayaptimi (Silero nutqini o'zi/boshqa deb ajratish uchun).
   *  Bu o'zi ogohlantirish bermaydi — faqat audio VAD bilan birga ishlatiladi. */
  onMouthActivity?: (active: boolean) => void;
  /** Har kadrda: hozir chetga (chap/o'ng) qarayaptimi yoki bosh burilganmi. Ogohlantirish
   *  emas — javobdan oldin chetga qarash naqshini (tashqi yordam) hisoblash uchun. */
  onSideGaze?: (dir: 'L' | 'R' | null) => void;
  /** Hozir "kichik ogohlantirish" bosqichidagi BARCHA signallar (chipsizlari ham).
   *  `SmallWarningLedger` shular asosida "3 kichik → 4-si rasmiy" qonunini qo'llaydi. */
  onSmallWarningStage?: (types: LiveSignalType[]) => void;
  /** Engine ishga tushdimi. `detail` — yiqilgan bo'lsa xato matni (server logiga
   *  yuboriladi: prod build `console.*` ni olib tashlaydi, ya'ni sabab boshqa
   *  hech qayerda ko'rinmaydi). */
  onReady?: (ok: boolean, detail?: string) => void;
  onStatus?: (msg: string) => void;
}

interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

export class RealtimeProctor {
  private video: HTMLVideoElement;
  private cb: RealtimeProctorCallbacks;
  private faceLandmarker: any = null;
  private handLandmarker: any = null;
  private rafId: number | null = null;
  private timer: number | null = null;
  private running = false;
  private disposed = false;
  // Performance: qo'l modelini har kadrda emas, har HAND_DETECT_EVERY kadrda ishlatamiz
  // (qo'l ko'tarish sekin harakat — 7fps shart emas). Bu MediaPipe yukini kamaytiradi.
  private frameCount = 0;
  private lastHandsPresent = false;
  private lastHandLms: Array<Array<{ x: number; y: number }>> = [];

  private lastEmit: Record<string, number> = {};
  private gazeDownTotalMs = 0;
  private gazeDownLastTs = 0;
  private gazeDownNextAlertMs = GAZE_DOWN_TOTAL_FIRST_MS;
  private gazeSideTotalMs = 0;
  private gazeSideLastTs = 0;
  private gazeSideNextAlertMs = GAZE_SIDE_TOTAL_FIRST_MS;
  // Davomiy signal (kichik→katta eskalatsiya) uchun — necha vaqtdan beri uzluksiz faol.
  private activeSince: Record<string, number> = {};
  private lastActiveAt: Record<string, number> = {};
  private prevNose: { x: number; y: number } | null = null;
  private moveEma = 0;
  // Yuz almashishi (person-swap) triggeri uchun
  private faceWasAbsent = false;
  private lastRecheck = 0;
  // Og'iz qimirlashi (gapirish) aniqlash
  private mouthHistory: number[] = [];
  private jawOpenHistory: number[] = [];
  // Shu freym uchun davomiy signallarning uzluksiz davomiyligi (ms) — kadr oxirida
  // eng "shoshilinch"i tanlanib onLiveSignal orqali xabar qilinadi.
  private liveMs: Record<LiveSignalType, number> = {
    TALKING: 0,
    HEAD_AWAY: 0,
    TOO_FAR: 0,
    TOO_CLOSE: 0,
    OFF_CENTER: 0,
    MOVEMENT: 0,
    HAND: 0,
    NO_FACE: 0,
    MULTI_FACE: 0,
  };

  /** Imtihon oldi tekshiruvida o'lchangan TABIIY ko'z ochiqligi.
   *  Nigoh ("pastga qaradi") nazorati shunga NISBATAN ishlaydi — mutlaq
   *  chegara odamlar orasida soxta ogohlantirish berardi. */
  private eyeBaseline: number | null = null;
  private centerObserver = new CenterObserverTracker();
  private lastCenterVideoTime = -1;

  constructor(
    video: HTMLVideoElement,
    cb: RealtimeProctorCallbacks,
    eyeBaseline?: number | null,
    private testCenter = false,
  ) {
    this.video = video;
    this.cb = cb;
    this.eyeBaseline = typeof eyeBaseline === 'number' && eyeBaseline > 0 ? eyeBaseline : null;
  }

  async init(): Promise<boolean> {
    // Manbalar tartib bilan sinaladi: avval o'z domenimiz, so'ng CDN zaxira
    // (`lib/mediapipeAssets.ts`). Talabalar tarmog'idan CDN ochilmasligi
    // mumkin — o'shanda lokal nusxa nazoratni saqlab qoladi.
    let lastErr: unknown = null;
    for (const src of mediapipeAssetSources()) {
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const { FilesetResolver, FaceLandmarker, HandLandmarker } = vision;
        const fileset = await FilesetResolver.forVisionTasks(src.wasmBase);

        // GPU → CPU zaxirasi SHART: GPU-only chaqiruv apparat tezlashtirish
        // o'chiq mashinada model olishdan OLDIN yiqiladi va butun real-time
        // nazorat jimgina o'chib qolardi.
        const faceRes = await createWithDelegateFallback(FaceLandmarker, fileset, {
          baseOptions: { modelAssetPath: src.faceModel },
          runningMode: 'VIDEO',
          // Performance: 2 ta yuz yetarli (ko'p yuz = >=2 ni aniqlash uchun). 3 ta yuz
          // izlash har kadrda ortiqcha yuk edi.
          numFaces: this.testCenter ? 4 : 2,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
        });
        this.faceLandmarker = faceRes.task;
        if (!this.faceLandmarker) {
          // Asl sabab SHU YERDA — umumiy xabar uni yashirib qo'yardi.
          throw new Error(
            `face landmarker (${src.origin}): ${formatDelegateErrors(faceRes.errors) || 'noma\'lum'}`,
          );
        }

        // Qo'l/imo-ishora — yuklanmasa ham face detection ishlayveradi.
        const handRes = await createWithDelegateFallback(HandLandmarker, fileset, {
          baseOptions: { modelAssetPath: src.handModel },
          runningMode: 'VIDEO',
          // Performance: bitta qo'l yetarli (qo'l bor/yo'qligini bilish uchun).
          numHands: 1,
        });
        this.handLandmarker = handRes.task;

        if (this.disposed) {
          this.dispose();
          return false;
        }
        this.cb.onStatus?.(`Realtime proctor tayyor (manba: ${src.origin}).`);
        this.cb.onReady?.(true);
        return true;
      } catch (err) {
        lastErr = err;
        this.faceLandmarker = null;
        this.handLandmarker = null;
      }
    }

    const detail = String((lastErr as Error)?.message || lastErr || 'unknown').slice(0, 500);
    console.error('[realtime-proctor] barcha manbalar qulaydi:', lastErr);
    this.cb.onStatus?.('Realtime proctor modeli yuklanmadi (server proctoring ishlaydi).');
    this.cb.onReady?.(false, detail);
    return false;
  }

  start(): void {
    if (this.running || !this.faceLandmarker) return;
    this.running = true;

    // MUHIM: og'ir MediaPipe inference'i requestAnimationFrame ichida BAJARILMAYDI.
    // Ilgari shunday edi va Chrome ochiq-oydin shikoyat qilardi:
    //   [Violation] 'requestAnimationFrame' handler took <N>ms
    // rAF ishlovchisi joriy kadrni ushlab turadi — brauzer u tugamaguncha ekranga
    // hech narsa chiza olmaydi, natijada ko'rinadigan qotishlar bo'ladi.
    //
    // Endi rAF faqat "sahifa ko'rinyapti va chizilyapti" darvozasi sifatida
    // ishlatiladi (fon tabda rAF chaqirilmaydi — bekorga CPU yemaymiz), tahlil esa
    // kadr chizilgandan KEYIN, alohida makrotaskda ishlaydi.
    const analyse = () => {
      if (!this.running) return;
      this.detectOnce();
      schedule();
    };

    const schedule = () => {
      this.timer = window.setTimeout(() => {
        this.rafId = window.requestAnimationFrame(() => {
          if (!this.running) return;
          this.timer = window.setTimeout(analyse, 0);
        });
      }, DETECT_INTERVAL_MS);
    };

    schedule();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.timer !== null) clearTimeout(this.timer);
    this.rafId = null;
    this.timer = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    try {
      this.faceLandmarker?.close?.();
      this.handLandmarker?.close?.();
    } catch {
      /* ignore */
    }
    this.faceLandmarker = null;
    this.handLandmarker = null;
  }

  private emit(type: RealtimeViolation, detail?: string): void {
    if (this.testCenter && CENTER_IGNORED.has(type)) return;
    const now = Date.now();
    const cooldown =
      type === 'MOUTH_MOVEMENT_TALKING' ? 2200 : PER_TYPE_COOLDOWN_MS;
    if (now - (this.lastEmit[type] || 0) < cooldown) return;
    this.lastEmit[type] = now;
    this.cb.onViolation(type, detail);
  }

  /** Identity qayta-tekshiruv so'rovi (person-swap), ortiqcha chaqirmaslik uchun cooldown. */
  private requestRecheck(): void {
    const now = Date.now();
    if (now - this.lastRecheck < 8000) return;
    this.lastRecheck = now;
    this.cb.onRecheckIdentity?.();
  }

  /**
   * Xom signal necha ms'dan beri uzluksiz faolligini qaytaradi (0 = faol emas).
   * Freym-flicker (bitta kadr o'tkazib yuborilishi) hisoblagichni buzmasin deb,
   * qisqa uzilishga (graceMs) toqat qilinadi.
   */
  private trackContinuous(key: string, rawActive: boolean, graceMs = 500): number {
    const now = Date.now();
    if (rawActive) {
      if (!this.activeSince[key]) this.activeSince[key] = now;
      this.lastActiveAt[key] = now;
      return now - this.activeSince[key];
    }
    const last = this.lastActiveAt[key];
    if (last && now - last <= graceMs) {
      return this.activeSince[key] ? now - this.activeSince[key] : 0;
    }
    delete this.activeSince[key];
    delete this.lastActiveAt[key];
    return 0;
  }

  private detectOnce(): void {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return;
    const ts = performance.now();
    if (this.testCenter && v.currentTime === this.lastCenterVideoTime) {
      this.centerObserver.update([], ts);
      this.trackContinuous('sideConversation', false, 0);
      return;
    }
    this.lastCenterVideoTime = v.currentTime;

    // 0) Qo'l/imo-ishora — YUZDAN OLDIN tekshiramiz: qo'l yuzga yaqin/ustida bo'lsa,
    // FaceLandmarker og'iz nuqtalarini noto'g'ri o'qib, soxta "gapiryapti" signali
    // berishi mumkin (occlusion) — shu holatni og'iz tekshiruviga xabar beramiz.
    // Performance: qo'l modeli har HAND_DETECT_EVERY kadrda ishlaydi (oradagi kadrlarda
    // oxirgi natija ishlatiladi — qo'l holati 260ms da keskin o'zgarmaydi).
    this.frameCount += 1;
    let handsPresent = this.lastHandsPresent;
    if (this.handLandmarker && this.frameCount % HAND_DETECT_EVERY === 0) {
      try {
        const hres = this.handLandmarker.detectForVideo(v, ts + 0.001);
        handsPresent = (hres?.landmarks?.length || 0) > 0;
        this.lastHandsPresent = handsPresent;
        this.lastHandLms = handsPresent ? hres.landmarks : [];
      } catch {
        /* ignore */
      }
    }
    // Qo'l ko'tarish — endi ham kichik→katta eskalatsiya qoidasiga bo'ysunadi
    // (README.md "Proctoring eskalatsiya qoidasi"): 1.5s kichik, 3s rasmiy.
    // Oldin darhol (~0.4s) rasmiy ogohlantirish berardi — qo'lni bir zum ko'tarish
    // ham darhol blokka olib kelardi, bu qonunga zid edi.
    this.liveMs.HAND = this.trackContinuous('hand', handsPresent && !this.testCenter);
    if (this.liveMs.HAND >= LIVE_SIGNAL_ESCALATE_MS) this.emit('HAND_GESTURE_SUSPECTED');

    let faces: FaceLandmark[][] = [];
    let faceBlendshapes: Array<{ categoryName: string; score: number }> | undefined;
    try {
      const res = this.faceLandmarker.detectForVideo(v, ts);
      faces = res?.faceLandmarks || [];
      const primary = this.testCenter ? primaryFaceIndex(faces) : 0;
      faceBlendshapes = res?.faceBlendshapes?.[Math.max(0, primary)]?.categories;
      if (primary > 0) faces = [faces[primary], ...faces.filter((_, i) => i !== primary)];
    } catch {
      return;
    }

    const faceCount = faces.length;

    // 1) Yuz yo'q / ko'p yuz — JIDDIY, TEZ eskalatsiya (~1.6s). Yuz umuman yo'q =
    // talaba turib/chiqib ketdi; ko'p yuz = kimdir keldi. Bularni "tuzatishga vaqt"
    // berish mantig'i shart emas — darhol ushlash kerak. "recheck" ham darhol ishlaydi.
    this.liveMs.NO_FACE = this.trackContinuous('noFace', faceCount === 0);
    if (this.liveMs.NO_FACE >= LIVE_SIGNAL_ESCALATE_FAST_MS) this.emit('FACE_NOT_VISIBLE');
    const observerMs = this.testCenter ? this.centerObserver.update(faces, ts) : 0;
    // Do not feed short shared-room appearances to the small-warning ledger.
    this.liveMs.MULTI_FACE = this.testCenter ? 0 : this.trackContinuous('multiFace', faceCount >= 2);
    if (this.testCenter && observerMs >= CENTER_OBSERVER_MS) {
      this.emit('MULTIPLE_FACES', JSON.stringify({ policy: 'center_observer_v1', continuous_ms: Math.floor(observerMs) }));
    } else if (!this.testCenter && this.liveMs.MULTI_FACE >= LIVE_SIGNAL_ESCALATE_FAST_MS) {
      this.emit('MULTIPLE_FACES');
    }

    // Person-swap: yuz yo'qolib qayta paydo bo'lsa — kim qaytganini tekshir (darhol).
    if (faceCount === 0) {
      this.faceWasAbsent = true;
      this.cb.onFaceStatus?.('NO_FACE');
    } else if (this.faceWasAbsent) {
      this.faceWasAbsent = false;
      this.requestRecheck();
    }

    if (faceCount >= 2 && !this.testCenter) {
      this.cb.onFaceStatus?.('MULTIPLE_FACES');
      this.requestRecheck(); // ko'p yuz — kim o'tirganini darhol tekshir
    }

    if (faceCount >= 1) {
      let posStatus = this.checkFacePosition(faces[0]);
      // Qorachiq (iris) — bosh to'g'ri turgan bo'lsa ham ko'z chetga/pastga qarasa,
      // badge'da "Kameraga qarang" ko'rsatamiz (aks holda talaba hech qanday
      // fikr-mulohaza olmasdi: bosh pozitsiyasi "OK" bo'lardi).
      const iris = this.irisGaze(faces[0]);
      if (posStatus === 'OK' && isIrisGazeAway(iris)) posStatus = 'GAZE_AWAY';
      this.cb.onFaceStatus?.(posStatus);

      // Pozitsiya — kichik→katta eskalatsiya: uzluksiz LIVE_SIGNAL_ESCALATE_MS
      // davom etsagina rasmiy violation yuboriladi.
      this.liveMs.TOO_FAR = this.trackContinuous('tooFar', posStatus === 'TOO_FAR');
      this.liveMs.TOO_CLOSE = this.trackContinuous('tooClose', posStatus === 'TOO_CLOSE');
      this.liveMs.OFF_CENTER = this.trackContinuous('offCenter', posStatus === 'OFF_CENTER');
      if (this.liveMs.TOO_FAR >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_TOO_FAR');
      if (this.liveMs.TOO_CLOSE >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_TOO_CLOSE');
      if (this.liveMs.OFF_CENTER >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_OFF_CENTER');

      this.analyzeHeadAndMovement(faces[0], faceBlendshapes, handsPresent, iris);

      const nearEar = handsPresent && handNearEar(faces[0], this.lastHandLms);
      if (this.trackContinuous('handEar', nearEar, 700) >= HAND_EAR_ESCALATE_MS) this.emit('HAND_NEAR_EAR');
    } else {
      this.trackContinuous('handEar', false);
      // Yuz yo'q — barcha yuzga bog'liq davomiy signallarni so'ndiramiz. MOVEMENT/HAND
      // ham reset qilinmasa, yuz yo'qolganda eskirgan qiymat kamera panelida noto'g'ri
      // chip ko'rsatishi mumkin edi (masalan "qimirlash" — yuz yo'q bo'lsa ham).
      this.liveMs.TOO_FAR = this.trackContinuous('tooFar', false);
      this.liveMs.TOO_CLOSE = this.trackContinuous('tooClose', false);
      this.liveMs.OFF_CENTER = this.trackContinuous('offCenter', false);
      this.liveMs.HEAD_AWAY = 0;
      this.liveMs.TALKING = this.trackContinuous('mouth', false);
      this.liveMs.MOVEMENT = this.trackContinuous('move', false);
      this.moveEma = 0;
      this.prevNose = null;
      this.mouthHistory = [];
      this.jawOpenHistory = [];
      this.cb.onMouthActivity?.(false);
      this.trackContinuous('sideConversation', false, 0);
    }

    // Kichik chip (onLiveSignal) — FAQAT badge'siz signallar uchun. Pozitsiya/gaze/yuz
    // (NO_FACE, MULTI_FACE, TOO_FAR/CLOSE, OFF_CENTER, HEAD_AWAY) allaqachon kamera
    // badge'ida (fsCfg) ko'rsatiladi — chip ularni takrorlamasin. Gapirish, qimirlash,
    // qo'l ko'tarishning badge'i yo'q, shu sabab ular uchun chip kerak.
    const atConfirmStage = (Object.entries(this.liveMs) as Array<[LiveSignalType, number]>).filter(
      ([type, ms]) => ms > 0 && ms >= confirmMsFor(type),
    );

    // Gapirish (TALKING) video ledger'ga KIRMAYDI — Silero audio oqimi hisoblaydi.
    const stageForLedger = atConfirmStage.filter(([type]) => type !== 'TALKING');
    this.cb.onSmallWarningStage?.(stageForLedger.map(([type]) => type));

    const best = atConfirmStage
      .filter(([type]) => CHIP_SIGNAL_TYPES.has(type))
      .sort((a, b) => b[1] - a[1])[0];
    this.cb.onLiveSignal?.(best ? best[0] : null, best ? best[1] : 0);
  }

  private irisGaze(lm: FaceLandmark[]): { dx: number; dy: number } | null {
    return computeIrisGaze(lm);
  }

  /** Yuzning kadr ichidagi holati — overlay uchun tez javob. */
  private checkFacePosition(lm: FaceLandmark[]): FaceStatusLive {
    const nose = lm[1];
    const left = lm[234];
    const right = lm[454];
    const top = lm[10];
    const chin = lm[152];
    if (!nose || !left || !right || !top || !chin) return 'WAITING';

    const faceHeight = chin.y - top.y;
    if (faceHeight < FACE_MIN_HEIGHT) return 'TOO_FAR';
    if (faceHeight > FACE_MAX_HEIGHT) return 'TOO_CLOSE';

    if (
      nose.x < FACE_CTR_X_MIN ||
      nose.x > FACE_CTR_X_MAX ||
      nose.y < FACE_CTR_Y_MIN ||
      nose.y > FACE_CTR_Y_MAX
    ) return 'OFF_CENTER';

    const width = right.x - left.x || 1e-6;
    const noseRelX = (nose.x - left.x) / width - 0.5;
    if (Math.abs(noseRelX) >= YAW_HARD) return 'TURNED';
    if (Math.abs(noseRelX) >= YAW_TURN) return 'GAZE_AWAY';

    return 'OK';
  }

  private analyzeHeadAndMovement(
    lm: FaceLandmark[],
    blendshapes?: Array<{ categoryName: string; score: number }>,
    handsPresent = false,
    iris: { dx: number; dy: number } | null = null,
  ): void {
    // MediaPipe FaceMesh indekslari: burun=1, chap yuz cheti=234, o'ng=454, manglay=10, iyak=152
    const nose = lm[1];
    const left = lm[234];
    const right = lm[454];
    const top = lm[10];
    const chin = lm[152];
    if (!nose || !left || !right || !top || !chin) return;

    // Yaw (chap/o'ng burilish): burun gorizontal pozitsiyasi yuz kengligida.
    const width = right.x - left.x || 1e-6;
    const noseRelX = (nose.x - left.x) / width - 0.5; // ~0 markaz
    // Pitch (tepa/past): burun vertikal pozitsiyasi manglay-iyak orasida.
    const height = chin.y - top.y || 1e-6;
    const noseRelY = (nose.y - top.y) / height; // ~0.5 markaz

    // Bosh burilishi/gaze — kichik→katta eskalatsiya: yo'nalish qaysi bo'lishidan
    // qat'iy nazar, kamera panelida umumiy "HEAD_AWAY" sifatida ko'rsatiladi;
    // rasmiy violation esa aniq yo'nalish bo'yicha alohida hisoblanadi.
    const absYaw = Math.abs(noseRelX);
    const turnMs = this.trackContinuous('turn', absYaw >= YAW_HARD);
    if (turnMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_TURNED_AWAY');

    // Qorachiq (iris) — bosh to'g'ri turgan bo'lsa ham ko'z chetga qarasa aniqlanadi.
    // Bosh-poza signali bilan BIRLASHTIRILADI (yo bosh burilgan, yo ko'z chetda).
    // Ko'z yumuq / iris yo'q bo'lsa `iris` = null → faqat bosh-poza ishlaydi.
    const irisLeft = iris != null && iris.dx >= IRIS_GAZE_X;
    const irisRight = iris != null && iris.dx <= -IRIS_GAZE_X;
    // Ko'z torayib qorachiq o'qilmasa ham "pastga qaragan" deb hisoblanadi —
    // aks holda pastdagi telefonga qarash umuman aniqlanmasdi (qovoq tushadi,
    // iris `null` bo'ladi va nazorat jim qolardi).
    const eyesNarrow = eyesTooNarrowForGaze(lm, this.eyeBaseline);
    const irisDown = (iris != null && iris.dy >= IRIS_GAZE_DOWN) || eyesNarrow;

    const headGazeL = absYaw >= YAW_TURN && absYaw < YAW_HARD && noseRelX >= 0;
    const headGazeR = absYaw >= YAW_TURN && absYaw < YAW_HARD && noseRelX < 0;
    const gazeLActive = (headGazeL || irisLeft) && absYaw < YAW_HARD;
    const gazeRActive = (headGazeR || irisRight) && absYaw < YAW_HARD;
    const gazeLMs = this.trackContinuous('gazeL', gazeLActive);
    const gazeRMs = this.trackContinuous('gazeR', gazeRActive);
    this.cb.onSideGaze?.(
      gazeLActive || (absYaw >= YAW_HARD && noseRelX >= 0)
        ? 'L'
        : gazeRActive || (absYaw >= YAW_HARD && noseRelX < 0)
          ? 'R'
          : null,
    );
    if (gazeLMs >= GAZE_SIDE_ESCALATE_MS) this.emit('GAZE_AWAY_LEFT');
    if (gazeRMs >= GAZE_SIDE_ESCALATE_MS) this.emit('GAZE_AWAY_RIGHT');
    // Jami yon qarash vaqti (qisqa, ko'p takrorlangan qarashlar ham qo'shiladi).
    const sideNow = Date.now();
    const sideDt = this.gazeSideLastTs ? Math.min(1000, Math.max(0, sideNow - this.gazeSideLastTs)) : 0;
    this.gazeSideLastTs = sideNow;
    if (gazeLActive || gazeRActive) this.gazeSideTotalMs += sideDt;
    if (this.gazeSideTotalMs >= this.gazeSideNextAlertMs) {
      this.gazeSideNextAlertMs = this.gazeSideTotalMs + GAZE_SIDE_TOTAL_STEP_MS;
      this.emit('GAZE_SIDE_TOTAL');
    }

    const gazeUpMs = this.trackContinuous('gazeUp', noseRelY <= PITCH_UP);
    const gazeDownMs = this.trackContinuous('gazeDown', noseRelY >= PITCH_DOWN || irisDown);
    // Jami pastga qarash vaqti (kadrlar orasidagi uzilish 1 soniyadan ortiq hisoblanmaydi).
    const downNow = Date.now();
    const downDt = this.gazeDownLastTs ? Math.min(1000, Math.max(0, downNow - this.gazeDownLastTs)) : 0;
    this.gazeDownLastTs = downNow;
    if (noseRelY >= PITCH_DOWN || irisDown) this.gazeDownTotalMs += downDt;
    if (this.gazeDownTotalMs >= this.gazeDownNextAlertMs) {
      this.gazeDownNextAlertMs = this.gazeDownTotalMs + GAZE_DOWN_TOTAL_STEP_MS;
      this.emit('GAZE_DOWN_TOTAL');
    }
    if (gazeUpMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_UP');
    if (gazeDownMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_DOWN');

    this.liveMs.HEAD_AWAY = Math.max(turnMs, gazeLMs, gazeRMs, gazeUpMs, gazeDownMs);

    // 3) Ortiqcha qimirlash: burun nuqtasining frame'lararo siljishi (EMA bilan tekislash).
    // Oddiy o'tirishdagi mayda harakat (charchoq, holatni to'g'irlash) jazolanmasin —
    // kichik→katta eskalatsiya (qonun): 1.5s kichik, 3s rasmiy.
    if (this.prevNose) {
      const dx = nose.x - this.prevNose.x;
      const dy = nose.y - this.prevNose.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      this.moveEma = this.moveEma * 0.7 + d * 0.3;
      this.liveMs.MOVEMENT = this.trackContinuous('move', this.moveEma >= MOVE_THRESHOLD);
      if (this.liveMs.MOVEMENT >= LIVE_SIGNAL_ESCALATE_MS) this.emit('EXCESSIVE_MOVEMENT');
    }
    this.prevNose = { x: nose.x, y: nose.y };

    // 4) Og'iz qimirlashi (gapirish): blendshape jawOpen + lab landmark tebranishi.
    const visibleSpeech = this.detectMouthMovement(lm, blendshapes, handsPresent);
    const sideConversationMs = this.trackContinuous('sideConversation',
      this.testCenter && absYaw >= YAW_TURN && visibleSpeech, 350);
    if (sideConversationMs >= 6000) this.emit('SIDE_CONVERSATION_SUSPECTED',
      JSON.stringify({policy:'side_conversation_v1',continuous_ms:Math.floor(sideConversationMs)}));
  }

  private detectMouthMovement(
    lm: FaceLandmark[],
    blendshapes?: Array<{ categoryName: string; score: number }>,
    handsPresent = false,
  ): boolean {
    let talking = false;

    // MediaPipe blendshape — eng ishonchli yo'l. Tarix oynasi ATAYLAB qisqa (8 kadr
    // ~1s): talaba og'zini to'xtatgach, harakat namunalari tez "eskiradi" va `talking`
    // darhol o'chadi. Aks holda (uzun oyna) to'xtagandan keyin ham bir necha soniya
    // "gapiryapti" deb sanalib, kichik ogohlantirishda to'xtasa ham rasmiy kelardi.
    const jaw = blendshapes?.find((b) => b.categoryName === 'jawOpen');
    if (jaw) {
      const jawHist = this.jawOpenHistory;
      jawHist.push(jaw.score);
      if (jawHist.length > 8) jawHist.shift();
      // Joriy kadr og'iz ANIQ yopiq bo'lsa (juda past jawOpen), harakat tugagan —
      // tez bo'shatamiz. Chegara past — sekin/yumshoq gapirishni o'tkazib
      // yubormasin (yumshoq nutqda jaw kichik ochiladi, lekin harakat bor).
      // Sezgirlik 30% oshirildi: 0.08 → 0.056 (oldingi barqaror qiymat 0.08).
      const jawClosedNow = jaw.score < 0.056;
      if (!jawClosedNow && jawHist.length >= 4) {
        const mean = jawHist.reduce((a, b) => a + b, 0) / jawHist.length;
        const amp = Math.max(...jawHist) - Math.min(...jawHist);
        let crossings = 0;
        for (let i = 1; i < jawHist.length; i++) {
          if ((jawHist[i - 1] - mean) * (jawHist[i] - mean) < 0) crossings++;
        }
        // Chegaralar 30% sezgirroq — yumshoq/sekin/past gapirish ham aniqlansin.
        // Oldingi barqaror qiymatlar: amp 0.04 / jaw 0.18 + amp 0.03 / jaw 0.12.
        talking =
          (crossings >= 3 && amp >= 0.028) ||
          (jaw.score >= 0.126 && amp >= 0.021) ||
          jawHist.filter((s) => s >= 0.084).length >= 3;
      }
    }

    // Landmark zaxira: og'iz kengligi (MAR) tebranishi.
    if (!talking) {
      const upper = lm[13];
      const lower = lm[14];
      const left = lm[61];
      const right = lm[291];
      if (upper && lower && left && right) {
        const vertical = Math.abs(lower.y - upper.y);
        const horizontal = Math.abs(right.x - left.x) || 1e-6;
        const mar = vertical / horizontal;
        const hist = this.mouthHistory;
        hist.push(mar);
        if (hist.length > 8) hist.shift();
        if (hist.length >= 5) {
          const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
          const amp = Math.max(...hist) - Math.min(...hist);
          let crossings = 0;
          for (let i = 1; i < hist.length; i++) {
            if ((hist[i - 1] - mean) * (hist[i] - mean) < 0) crossings++;
          }
          // 30% sezgirroq (oldingi barqaror qiymat: 0.013).
          talking = crossings >= 3 && amp >= 0.0091;
        }
      }
    }

    // Qo'l yuz/og'iz ustida yoki yaqinida bo'lsa — landmark occlusion soxta
    // "gapiryapti" signali berishi mumkin, shu sabab bu freymda hisobga olinmaydi.
    const talking2 = talking && !handsPresent;

    // Gapirish — faqat holat (og'iz qimirlayaptimi). Rasmiy/kichik ogohlantirish
    // MIKROFON orqali Silero VAD bilan chiqadi (ExamRoom) — video og'iz yolg'iz
    // o'tirganda soxta signal berardi.
    const talkMs = this.trackContinuous('mouth', talking2, 350);
    this.liveMs.TALKING = talkMs;
    this.cb.onMouthActivity?.(talkMs >= TALK_SIGNAL_CONFIRM_MS);
    return talking2 && (rhythmicSpeech(this.jawOpenHistory) || rhythmicSpeech(this.mouthHistory,.025));
  }
}
