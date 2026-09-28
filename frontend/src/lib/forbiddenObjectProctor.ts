/**
 * Taqiqlangan ob'ektlar — brauzerda MediaPipe ObjectDetector (EfficientDet/COCO).
 *
 * Nega kerak: server Vision har ~15s va PROCTOR_OPENAI_OBJECTS/API ga bog'liq edi —
 * telefon kadrda aniq ko'rinsa ham "indamay" turardi. Bu detektor ~1s da ishlaydi,
 * CDN model + mavjud @mediapipe/tasks-vision.
 *
 * COCO sinflari: cell phone, book, laptop.
 */

import { ContinuousSignalTracker } from './continuousSignal';
import { createWithDelegateFallback, formatDelegateErrors } from './mediapipeDelegate';
import { mediapipeAssetSources } from './mediapipeAssets';
import { visibleObject, type ObjectDetection } from './objectEvidence';

/** Low-confidence candidates are never actionable; objectEvidence applies 0.8. */
const DETECTOR_MIN_SCORE = 0.5;

/** Freym tahlili oralig'i. Qancha tez-tez bo'lsa, tasdiqlash shuncha tez. */
export const DETECT_INTERVAL_MS = 300;

/** Only a short gap is tolerated; sustained fresh-frame evidence is required. */
export const OBJECT_GRACE_MS = DETECT_INTERVAL_MS + 50;

/** Neutral checking indicator, not an official warning. */
export const OBJECT_CONFIRM_MS = 900;
/** Rasmiy */
export const OBJECT_ESCALATE_MS = 1800;

export type ForbiddenObjectHit = {
  violationType: string;
  label: string;
  score: number;
};

type DetectorApi = {
  detectForVideo: (video: HTMLVideoElement, ts: number) => {
    detections?: ObjectDetection[];
  };
  close?: () => void;
};

/**
 * Video oqimidan taqiqlangan ob'ektlarni kuzatadi.
 * `onSmall` / `onFormal` — ExamRoom small-warn + logViolation uchun.
 */
export class ForbiddenObjectProctor {
  private detector: DetectorApi | null = null;
  private timer: number | null = null;
  private disposed = false;
  /** Oxirgi init xatosi — server logiga yuborish uchun (prod'da console yo'q). */
  private initError = '';
  private trackers = new Map<string, ContinuousSignalTracker>();
  private lastFormalAt = new Map<string, number>();
  private hitCounts = new Map<string, number>();
  private lastVideoTime = -1;
  private lastDetectionAt = 0;

  ready = false;

  constructor(
    private video: HTMLVideoElement,
    private opts: {
      onSmall: (violationType: string, label: string) => void;
      onClear: (violationType: string) => void;
      onFormal: (violationType: string, detail?: string) => void;
      /** Modal ochiq bo'lsa true — hisoblamaymiz */
      isFrozen: () => boolean;
    },
  ) {}

  async init(): Promise<boolean> {
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const { FilesetResolver, ObjectDetector } = vision as any;
      if (!ObjectDetector?.createFromOptions) {
        console.warn('[object-proctor] ObjectDetector mavjud emas');
        return false;
      }
      const src = mediapipeAssetSources()[0];
      const fileset = await FilesetResolver.forVisionTasks(src.wasmBase);
      // GPU → CPU zaxirasi (realtimeProctor bilan bir xil sabab).
      const objRes = await createWithDelegateFallback(ObjectDetector, fileset, {
        baseOptions: {
          modelAssetPath: src.objectModel,
        },
        scoreThreshold: DETECTOR_MIN_SCORE,
        runningMode: 'VIDEO',
        // Kadrda ko'p ob'ekt bo'lsa (stol, monitor, odam) telefon ro'yxatdan
        // tushib qolmasin — chegara kengaytirildi.
        maxResults: 16,
      });
      this.detector = objRes.task;
      if (!this.detector) {
        throw new Error(`object detector: ${formatDelegateErrors(objRes.errors) || 'noma\'lum'}`);
      }
      if (this.disposed) {
        this.dispose();
        return false;
      }
      this.ready = true;
      console.info('[object-proctor] tayyor (cell phone / book / laptop)');
      return true;
    } catch (err) {
      // Sabab server logiga yuboriladi — prod build console.* ni olib tashlaydi.
      this.initError = String((err as Error)?.message || err || '').slice(0, 400);
      console.error('[object-proctor] yuklanmadi:', err);
      this.ready = false;
      return false;
    }
  }

  /** Init nima uchun yiqilgani (bo'sh = xato yo'q). */
  lastError(): string {
    return this.initError;
  }

  start(): void {
    if (!this.detector || this.timer != null) return;
    this.timer = window.setInterval(() => this.tick(), DETECT_INTERVAL_MS);
  }

  private trackerFor(type: string): ContinuousSignalTracker {
    let t = this.trackers.get(type);
    if (!t) {
      t = new ContinuousSignalTracker(OBJECT_GRACE_MS);
      this.trackers.set(type, t);
    }
    return t;
  }

  private tick(): void {
    if (this.disposed || !this.detector) return;
    if (this.opts.isFrozen()) {
      this.trackers.clear(); this.hitCounts.clear();
      return;
    }
    const video = this.video;
    if (!video || video.readyState < 2 || video.videoWidth < 16) return;
    if (video.currentTime === this.lastVideoTime) {
      this.trackers.clear(); this.hitCounts.clear();
      return;
    }
    this.lastVideoTime = video.currentTime;
    const frameTime=Date.now();
    if (this.lastDetectionAt && frameTime-this.lastDetectionAt>900) {
      this.trackers.clear(); this.hitCounts.clear();
    }
    this.lastDetectionAt=frameTime;

    const detections: ForbiddenObjectHit[] = [];
    try {
      const res = this.detector.detectForVideo(video, performance.now());
      for (const d of res.detections || []) {
        const hit = visibleObject(d, video.videoWidth, video.videoHeight);
        if (hit) detections.push(hit);
      }
    } catch {
      return;
    }

    // Bir xil tur uchun eng yuqori score
    const best = new Map<string, ForbiddenObjectHit>();
    for (const hit of detections) {
      const prev = best.get(hit.violationType);
      if (!prev || hit.score > prev.score) best.set(hit.violationType, hit);
    }

    const now = Date.now();
    const activeTypes = new Set(best.keys());
    for (const type of ['FORBIDDEN_OBJECT_CELL_PHONE', 'FORBIDDEN_OBJECT_BOOK', 'FORBIDDEN_OBJECT_LAPTOP']) {
      const ms = this.trackerFor(type).push(activeTypes.has(type), now);
      const count = activeTypes.has(type) ? (this.hitCounts.get(type) || 0) + 1 : 0;
      this.hitCounts.set(type, count);
      if (ms >= OBJECT_CONFIRM_MS) {
        const hit = best.get(type);
        this.opts.onSmall(type, hit?.label || type);
      } else {
        this.opts.onClear(type);
      }
      if (ms >= OBJECT_ESCALATE_MS && count >= 4 && best.has(type)) {
        const last = this.lastFormalAt.get(type) || 0;
        if (now - last >= 6_000) {
          this.lastFormalAt.set(type, now);
          this.trackerFor(type).reset();
          this.hitCounts.set(type, 0);
          this.opts.onFormal(type, JSON.stringify({policy:'visible_object_v2',
            continuous_ms:ms, frames:count, score:best.get(type)!.score}));
        }
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.detector?.close?.();
    } catch {
      /* ignore */
    }
    this.detector = null;
    this.trackers.clear();
  }
}
