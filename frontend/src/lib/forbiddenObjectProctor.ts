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

const WASM_BASE =
  (import.meta as any).env?.VITE_MEDIAPIPE_WASM_BASE ||
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

// lite0 → lite2: telefon kadrda kichik ob'ekt bo'lgani uchun lite0 uni ko'p
// freymda umuman topa olmasdi (detektsiya "miltillardi"). lite2 sezilarli
// aniqroq; GPU delegate bilan bitta freym ~30-50ms — 300ms interval uchun yetarli.
const OBJECT_MODEL =
  (import.meta as any).env?.VITE_MEDIAPIPE_OBJECT_MODEL ||
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite';

/** COCO label (kichik harf) → rasmiy violation. */
const LABEL_TO_VIOLATION: Record<string, string> = {
  'cell phone': 'FORBIDDEN_OBJECT_CELL_PHONE',
  cellphone: 'FORBIDDEN_OBJECT_CELL_PHONE',
  phone: 'FORBIDDEN_OBJECT_CELL_PHONE',
  mobile: 'FORBIDDEN_OBJECT_CELL_PHONE',
  book: 'FORBIDDEN_OBJECT_BOOK',
  laptop: 'FORBIDDEN_OBJECT_LAPTOP',
};

/** Detektorning o'zi qaytaradigan eng past ball — pastroq, filtr quyida. */
const DETECTOR_MIN_SCORE = 0.2;

/**
 * Har bir tur uchun alohida ostona. Telefon kadrda kichik ko'rinadi va ball
 * past chiqadi — unga pastroq ostona kerak. Kitob/noutbuk esa katta ob'ekt:
 * ularga yuqoriroq ostona qo'yamiz, aks holda stol yoki papka "kitob" deb
 * noto'g'ri aniqlanadi.
 */
const SCORE_THRESHOLD_BY_TYPE: Record<string, number> = {
  // 2026-09-13: sezgirlik oshirildi (telefon 0.25 -> 0.21, kitob/noutbuk 0.38 -> 0.33).
  FORBIDDEN_OBJECT_CELL_PHONE: 0.18,
  FORBIDDEN_OBJECT_BOOK: 0.30,
  FORBIDDEN_OBJECT_LAPTOP: 0.30,
};

/** Freym tahlili oralig'i. Qancha tez-tez bo'lsa, tasdiqlash shuncha tez. */
export const DETECT_INTERVAL_MS = 300;

/**
 * Uzilishga toqat oynasi. MUHIM: bu qiymat DETECT_INTERVAL_MS dan katta
 * bo'lishi SHART. Ilgari grace=500ms, interval=700ms edi — ya'ni detektor
 * bitta freymda telefonni topa olmasa (kichik ob'ektda bu doim bo'ladi),
 * keyingi tekshiruvgacha 700ms > 500ms o'tib, to'plangan vaqt NOLGA tushardi.
 * Natijada hisoblagich 2800ms ga deyarli hech qachon yetmasdi va telefon
 * "juda sekin" aniqlanardi. Endi ketma-ket 3 ta o'tkazib yuborishga toqat.
 */
export const OBJECT_GRACE_MS = DETECT_INTERVAL_MS * 3 + 100;

/** Kichik ogohlantirish — QONUN ISTISNOSI: darhol (0.4s).
 *  Telefonni bir zumga ko'tarib javobni ko'rish uchun 1.5s yetarli edi. */
export const OBJECT_CONFIRM_MS = 400;
/** Rasmiy */
export const OBJECT_ESCALATE_MS = 1000;

export type ForbiddenObjectHit = {
  violationType: string;
  label: string;
  score: number;
};

type DetectorApi = {
  detectForVideo: (video: HTMLVideoElement, ts: number) => {
    detections?: Array<{
      categories?: Array<{ categoryName?: string; score?: number }>;
    }>;
  };
  close?: () => void;
};

function mapLabel(raw: string): string | null {
  const key = raw.toLowerCase().trim();
  if (LABEL_TO_VIOLATION[key]) return LABEL_TO_VIOLATION[key];
  // Ba'zi modellarda "cell_phone"
  const norm = key.replace(/[_-]+/g, ' ');
  return LABEL_TO_VIOLATION[norm] || null;
}

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

  ready = false;

  constructor(
    private video: HTMLVideoElement,
    private opts: {
      onSmall: (violationType: string, label: string) => void;
      onClear: (violationType: string) => void;
      onFormal: (violationType: string) => void;
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
    if (this.opts.isFrozen()) return;
    const video = this.video;
    if (!video || video.readyState < 2 || video.videoWidth < 16) return;

    const detections: ForbiddenObjectHit[] = [];
    try {
      const res = this.detector.detectForVideo(video, performance.now());
      for (const d of res.detections || []) {
        // Faqat categories[0] emas, BARCHA nomzodlar. Telefon ko'pincha
        // ikkinchi-uchinchi nomzod bo'lib chiqadi (birinchisi "person" yoki
        // "remote") — ilgari aynan shu holatda umuman aniqlanmasdi.
        for (const cat of d.categories || []) {
          const name = String(cat?.categoryName || '');
          const violationType = mapLabel(name);
          if (!violationType) continue;
          const score = Number(cat?.score || 0);
          if (score < (SCORE_THRESHOLD_BY_TYPE[violationType] ?? 0.35)) continue;
          detections.push({ violationType, label: name, score });
        }
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
      if (ms >= OBJECT_CONFIRM_MS) {
        const hit = best.get(type);
        this.opts.onSmall(type, hit?.label || type);
      } else {
        this.opts.onClear(type);
      }
      if (ms >= OBJECT_ESCALATE_MS) {
        const last = this.lastFormalAt.get(type) || 0;
        if (now - last >= 6_000) {
          this.lastFormalAt.set(type, now);
          this.trackerFor(type).reset();
          this.opts.onFormal(type);
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
