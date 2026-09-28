/**
 * Pre-exam yuz pozitsiyasi tekshiruvi (MediaPipe FaceLandmarker).
 *
 * Imtihon boshlanishidan oldin talaba:
 *  - yagona yuz bilan (kadrda yolg'iz),
 *  - kameraga yetarlicha yaqin (yuz kadrning katta qismini egallasin),
 *  - markazda va to'g'ridan-to'g'ri kameraga qaragan
 * holatda ekanini ta'minlaydi. Faqat shu shartlar bir necha freym barqaror
 * bo'lganda "OK" beriladi va Start tugmasi yonadi.
 *
 * Graceful degradation: model yuklanmasa init() false qaytaradi — chaqiruvchi
 * gate'ni o'tkazib yuborishi (skip) kerak, imtihon bloklanmasligi uchun.
 */

import { createWithDelegateFallback } from './mediapipeDelegate';
import { mediapipeAssetSources } from './mediapipeAssets';
import { primaryFaceIndex } from './testCenterFaces';
import {
  LivenessSequence,
  averageEar,
  eyesClosed,
  isMouthOpen,
  type LivenessAction,
  type StepPhase,
} from './livenessChallenge';

export type FacePositionStatus =
  | 'WAITING'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'TOO_FAR'
  | 'TOO_CLOSE'
  | 'OFF_CENTER'
  | 'TURNED'
  | 'OK';

const DETECT_INTERVAL_MS = 180; // ~5-6 fps
const OK_STREAK_NEEDED = 6; // ~1s barqaror OK

// Chegaralar (normalized landmark geometriyasi; kalibrlash mumkin).
const FACE_MIN_HEIGHT = 0.26; // bundan kichik = juda uzoq
const FACE_MAX_HEIGHT = 0.82; // bundan katta = juda yaqin
const CENTER_X_MIN = 0.30;
const CENTER_X_MAX = 0.70;
const CENTER_Y_MIN = 0.22;
const CENTER_Y_MAX = 0.80;
const YAW_MAX = 0.17; // burilish chegarasi

export type FacePositionUpdate = (status: FacePositionStatus, okSustained: boolean) => void;

/** Burun landmark (1) chap/o'ng yuz chetlaridan (234/454) nisbatan gorizontal
 * siljishi — manfiy/musbat belgi xom (mirrorlanmagan) kamera bufer koordinatasida.
 * Gate (classify) va active liveness challenge ikkalasi ham shu bitta hisob-kitobni
 * ishlatadi, shunda ikki joyda landmark indekslari mos kelmasligi xavfi yo'q. */
export function computeYaw(lm: any[]): number | null {
  const left = lm[234];
  const right = lm[454];
  const nose = lm[1];
  if (!left || !right || !nose) return null;
  const width = right.x - left.x || 1e-6;
  return (nose.x - left.x) / width - 0.5;
}

/** Active liveness challenge chegaralari (PreExamCheck bilan bir xil). */
export const CHALLENGE_YAW_MIN = 0.18;
export const CHALLENGE_CENTER_MAX = 0.17;

/**
 * Mirror preview ko'rsatmasiga mos burilish — realtimeProctor GAZE mapping bilan bir xil:
 * musbat yaw = talaba chapga, manfiy yaw = talaba o'ngga burgan.
 */
export function challengeYawMatches(
  direction: 'left' | 'right',
  yaw: number,
  minYaw = CHALLENGE_YAW_MIN,
): boolean {
  return direction === 'left' ? yaw >= minYaw : yaw <= -minYaw;
}

export function challengeYawCentered(
  yaw: number,
  maxAbs = CHALLENGE_CENTER_MAX,
): boolean {
  return Math.abs(yaw) <= maxAbs;
}

/** Og'iz kengligi / yuz kengligi — tabassumda oshadi. */
export function computeSmileRatio(lm: any[]): number | null {
  const faceL = lm[234];
  const faceR = lm[454];
  const mouthL = lm[61];
  const mouthR = lm[291];
  const upperLip = lm[13];
  if (!faceL || !faceR || !mouthL || !mouthR || !upperLip) return null;

  const faceWidth = faceR.x - faceL.x;
  if (Math.abs(faceWidth) <= 1e-6) return null;

  const mouthWidth = mouthR.x - mouthL.x;
  const widthRatio = mouthWidth / faceWidth;

  // Tabassumda og'iz burchaklari yuqoriga ko'tariladi (y kamayadi).
  const cornerAvgY = (mouthL.y + mouthR.y) / 2;
  const cornerLift = upperLip.y - cornerAvgY;

  return widthRatio + cornerLift * 0.55;
}

/** Active liveness challenge — tabassum chegarasi. */
// 0.46 -> 0.40: yengil jilmayish ham o'tadi. Tabiiy neytral yuz odatda
// 0.30-0.35 atrofida, shu sabab 0.40 soxta o'tkazishga olib kelmaydi,
// lekin "keng tirjayish" talab qilmaydi.
export const SMILE_RATIO_MIN = 0.40;

export function isSmiling(lm: any[], minRatio = SMILE_RATIO_MIN): boolean {
  const ratio = computeSmileRatio(lm);
  if (ratio === null) return false;
  return ratio >= minRatio;
}

async function createFaceLandmarker(numFaces = 1): Promise<any | null> {
  const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
  // Manbalar tartib bilan: avval o'z domenimiz, so'ng CDN zaxira — talabalar
  // tarmog'idan CDN ochilmasligi mumkin (`lib/mediapipeAssets.ts`).
  for (const src of mediapipeAssetSources()) {
    let fileset: any;
    try {
      fileset = await FilesetResolver.forVisionTasks(src.wasmBase);
    } catch {
      continue; // WASM olinmadi — keyingi manba
    }
    const res = await createWithDelegateFallback(FaceLandmarker, fileset, {
      baseOptions: { modelAssetPath: src.faceModel },
      runningMode: 'VIDEO' as const,
      numFaces,
    });
    if (res.task) return res.task;
  }
  return null;
}

export class FacePositionChecker {
  private video: HTMLVideoElement;
  private onUpdate: FacePositionUpdate;
  private landmarker: any = null;
  private rafId: number | null = null;
  private timer: number | null = null;
  private running = false;
  private disposed = false;
  private okStreak = 0;

  /** Ko'z ochiqligi (balandlik/kenglik) — nigoh nazorati shunga bog'liq.
   *  `null` = landmark o'qilmadi. Qo'shimcha detektor ishga tushirmaslik uchun
   *  shu bitta o'tishda hisoblanadi. */
  private onEyeRatio?: (ratio: number | null) => void;

  constructor(
    video: HTMLVideoElement,
    onUpdate: FacePositionUpdate,
    onEyeRatio?: (ratio: number | null) => void,
    private testCenter = false,
  ) {
    this.video = video;
    this.onUpdate = onUpdate;
    this.onEyeRatio = onEyeRatio;
  }

  async init(): Promise<boolean> {
    try {
      this.landmarker = await createFaceLandmarker(2);
      if (this.disposed || !this.landmarker) {
        this.dispose();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.running || !this.landmarker) return;
    this.running = true;
    // Og'ir MediaPipe inference'i rAF ichida BAJARILMAYDI — u joriy kadrni ushlab
    // qoladi va Chrome "[Violation] 'requestAnimationFrame' handler took <N>ms"
    // deb ogohlantiradi (ko'rinadigan qotish). rAF faqat "sahifa ko'rinyapti"
    // darvozasi; tahlil kadr chizilgandan keyin alohida makrotaskda ishlaydi.
    const analyse = () => {
      if (!this.running) return;
      this.evaluate();
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
      this.landmarker?.close?.();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
  }

  private classify(): FacePositionStatus {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return 'WAITING';

    let faces: any[] = [];
    try {
      const res = this.landmarker.detectForVideo(v, performance.now());
      faces = res?.faceLandmarks || [];
    } catch {
      return 'WAITING';
    }

    if (faces.length === 0) {
      this.onEyeRatio?.(null);
      return 'NO_FACE';
    }
    if (faces.length >= 2 && !this.testCenter) {
      this.onEyeRatio?.(null);
      return 'MULTIPLE_FACES';
    }

    const lm = faces[this.testCenter ? Math.max(0, primaryFaceIndex(faces)) : 0];
    this.onEyeRatio?.(averageEar(lm));
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
      nose.x < CENTER_X_MIN ||
      nose.x > CENTER_X_MAX ||
      nose.y < CENTER_Y_MIN ||
      nose.y > CENTER_Y_MAX
    ) {
      return 'OFF_CENTER';
    }

    const noseRelX = computeYaw(lm);
    if (noseRelX !== null && Math.abs(noseRelX) > YAW_MAX) return 'TURNED';

    return 'OK';
  }

  private evaluate(): void {
    const status = this.classify();
    if (status === 'OK') {
      this.okStreak = Math.min(OK_STREAK_NEEDED, this.okStreak + 1);
    } else {
      this.okStreak = 0;
    }
    this.onUpdate(status, this.okStreak >= OK_STREAK_NEEDED);
  }
}

export type YawUpdate = (yaw: number | null) => void;

const YAW_DETECT_INTERVAL_MS = 120;

/**
 * Active liveness challenge uchun yengil yaw-kuzatuvchi — FacePositionChecker'dan
 * mustaqil, o'z FaceLandmarker instansiyasini yaratadi (identity tasdiqlangandan
 * keyin, position-gate checker allaqachon dispose qilingan bo'ladi). Alohida
 * instansiya — position-gate lifecycle'ini o'zgartirmasdan, xavfsiz izolyatsiya.
 */
export class YawChallengeTracker {
  private video: HTMLVideoElement;
  private onYaw: YawUpdate;
  private landmarker: any = null;
  private rafId: number | null = null;
  private timer: number | null = null;
  private running = false;
  private disposed = false;

  constructor(video: HTMLVideoElement, onYaw: YawUpdate) {
    this.video = video;
    this.onYaw = onYaw;
  }

  async init(): Promise<boolean> {
    try {
      this.landmarker = await createFaceLandmarker();
      if (this.disposed || !this.landmarker) {
        this.dispose();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.running || !this.landmarker) return;
    this.running = true;
    // Og'ir MediaPipe inference'i rAF ichida BAJARILMAYDI — u joriy kadrni ushlab
    // qoladi va Chrome "[Violation] 'requestAnimationFrame' handler took <N>ms"
    // deb ogohlantiradi (ko'rinadigan qotish). rAF faqat "sahifa ko'rinyapti"
    // darvozasi; tahlil kadr chizilgandan keyin alohida makrotaskda ishlaydi.
    const analyse = () => {
      if (!this.running) return;
      this.tick();
      schedule();
    };
    const schedule = () => {
      this.timer = window.setTimeout(() => {
        this.rafId = window.requestAnimationFrame(() => {
          if (!this.running) return;
          this.timer = window.setTimeout(analyse, 0);
        });
      }, YAW_DETECT_INTERVAL_MS);
    };
    schedule();
  }

  private tick(): void {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) {
      this.onYaw(null);
      return;
    }
    try {
      const res = this.landmarker.detectForVideo(v, performance.now());
      const faces = res?.faceLandmarks || [];
      if (faces.length !== 1) {
        this.onYaw(null);
        return;
      }
      this.onYaw(computeYaw(faces[0]));
    } catch {
      this.onYaw(null);
    }
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
      this.landmarker?.close?.();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
  }
}


const SMILE_DETECT_INTERVAL_MS = 120;

/**
 * Active liveness challenge — tabassum aniqlash (MediaPipe og'iz landmarklari).
 * YawChallengeTracker o'rniga: talaba kameraga qarab jilmayganda tasdiqlanadi.
 */
export class LivenessChallengeTracker {
  private landmarker: any = null;
  private rafId: number | null = null;
  private timer: number | null = null;
  private running = false;
  private disposed = false;
  private sequence: LivenessSequence;

  constructor(
    private video: HTMLVideoElement,
    private actions: LivenessAction[],
    private cb: {
      /** Har kadrda: hozir qaysi harakat so'ralyapti, nechanchi bosqich, bajarilyaptimi. */
      onProgress: (info: {
        action: LivenessAction;
        step: number;
        total: number;
        phase: StepPhase;
      }) => void;
      onPassed: () => void;
      onFailed: () => void;
    },
    /** Har bosqich timeouti (ms). `Infinity` — doimiy tekshiruv (timeout yo'q,
     *  "qayta urinish" chiqmaydi). Berilmasa — modul standarti. */
    timeoutOverrideMs?: number,
  ) {
    this.sequence = new LivenessSequence(actions, timeoutOverrideMs);
  }

  async init(): Promise<boolean> {
    try {
      this.landmarker = await createFaceLandmarker();
      if (this.disposed || !this.landmarker) {
        this.dispose();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.running || !this.landmarker) return;
    this.running = true;
    const analyse = () => {
      if (!this.running) return;
      this.tick();
      schedule();
    };
    const schedule = () => {
      this.timer = window.setTimeout(() => {
        this.rafId = window.requestAnimationFrame(() => {
          if (!this.running) return;
          this.timer = window.setTimeout(analyse, 0);
        });
      }, SMILE_DETECT_INTERVAL_MS);
    };
    schedule();
  }

  /** Joriy harakat shu kadrda bajarilyaptimi. */
  private actionActive(action: LivenessAction, lm: any[]): boolean {
    switch (action) {
      case 'BLINK':
        return eyesClosed(lm);
      case 'SMILE':
        return isSmiling(lm);
      case 'MOUTH_OPEN':
        return isMouthOpen(lm);
      case 'TURN_LEFT':
      case 'TURN_RIGHT': {
        const yaw = computeYaw(lm);
        if (yaw === null) return false;
        return challengeYawMatches(action === 'TURN_LEFT' ? 'left' : 'right', yaw);
      }
    }
  }

  private tick(): void {
    const v = this.video;
    const now = Date.now();
    const action = this.sequence.currentAction;

    let faceOk = false;
    let active = false;
    if (v && v.readyState >= 2 && v.videoWidth > 0) {
      try {
        const res = this.landmarker.detectForVideo(v, performance.now());
        const faces = res?.faceLandmarks || [];
        // Kadrda AYNAN bitta yuz bo'lishi shart — ikkinchi odam "yordam" bera olmasin.
        if (faces.length === 1) {
          faceOk = true;
          active = this.actionActive(action, faces[0]);
        }
      } catch {
        faceOk = false;
      }
    }

    const status = this.sequence.push(active, now, faceOk);
    const { step, total } = this.sequence.progress;
    this.cb.onProgress({
      action: this.sequence.currentAction,
      step,
      total,
      phase: this.sequence.currentStep.currentPhase,
    });
    if (status === 'passed') {
      this.stop();
      this.cb.onPassed();
    } else if (status === 'failed') {
      this.stop();
      this.cb.onFailed();
    }
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
      this.landmarker?.close?.();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
  }
}
