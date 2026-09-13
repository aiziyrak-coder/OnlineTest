/**
 * Silero VAD — neyron tarmoqli nutq detektori (odam ovozi vs maishiy shovqin).
 *
 * NEGA NEYRON TARMOQ KERAK BO'LDI
 * --------------------------------
 * Ilgari bu vazifani qo'lda yozilgan DSP mezonlari bajarardi (RMS, ZCR, spektral
 * ulush, autokorrelyatsiya davriyligi). Ular sintetik signalda mukammal ishlardi,
 * lekin REAL audioda qulaydi. 80 ta real nutq (LibriSpeech, 40 so'zlovchi) va
 * 124 ta real maishiy shovqin (ESC-50) ustida o'lchangan (`docs/VAD_BENCHMARK.md`):
 *
 *   |                          | Qo'lda yozilgan DSP | Silero VAD |
 *   |--------------------------|--------------------:|-----------:|
 *   | Ovoz, normal balandlik   |               96.3% |     100.0% |
 *   | Ovoz, uzoqroq            |               92.5% |     100.0% |
 *   | Ovoz, juda jim/uzoq      |            **7.5%** |     100.0% |
 *   | Ovoz + shovqin (SNR 0dB) |               60.0% |     100.0% |
 *   | SOXTA ijobiy (shovqin)   |           **13.7%** |   **0.0%** |
 *
 * Sabab oddiy: real nutqning ~40% kadri OVOZSIZ (s, sh, f, t, k) — ularda
 * davriylik umuman yo'q, ya'ni autokorrelyatsiya mezoni ularni ko'rmaydi. Aksincha,
 * ko'p maishiy shovqin DAVRIY (ventilyator parragi, signal, eshik g'ijirlashi,
 * bola yig'isi) — mezon ularni "ovoz" deb belgilaydi. 5-6 o'lchamli qo'lda
 * sozlangan fazoda bu ikki sinf ORASIDA chegara umuman mavjud emas. Silero esa
 * minglab soatlik, 6000+ tilli ma'lumotda o'rgatilgan — chegarani o'zi topgan.
 *
 * TEXNIK
 * ------
 * - Model: `public/models/silero_vad.onnx` (2.3MB; gzip ~1.9MB), o'zimizda hosted.
 * - Runtime: onnxruntime-web (WASM), `public/ort/` dan — CDN'ga bog'liq emas.
 * - Kirish: 16 kHz, 512 sample (32ms) + oldingi kadrdan 64 sample kontekst.
 *   Kontekst MAJBURIY — v5 modeli busiz doim ~0.00 qaytaradi (shu xato benchmark
 *   paytida topilgan: kontekstsiz toza nutqda ham max ehtimollik 0.046 edi).
 * - Holat (state): [2,1,128] RNN xotirasi, har kadrda yangilanadi.
 * - Tezlik: ~1ms/kadr, 31 kadr/sek → bitta yadroning ~3% i.
 *
 * Model yuklanmasa (tarmoq, eski qurilma) — `ready` false bo'lib qoladi va
 * chaqiruvchi tomon eski DSP mantig'iga qaytadi (graceful degradation, xuddi
 * MediaPipe kabi: proctoring hech qachon imtihonni buzmaydi).
 */

// Faqat WASM backend — webgpu/webgl variantlari bu model uchun keraksiz va
// bundle'ni bir necha o'n MB ga kattalashtiradi.
import * as ort from 'onnxruntime-web/wasm';

const MODEL_URL = '/models/silero_vad.onnx';
const WORKLET_URL = '/vad/pcm-frame-worklet.js';
const SAMPLE_RATE = 16000;
const FRAME = 512;
const CONTEXT = 64;

/**
 * Gisterezis: nutq "boshlandi" deb hisoblash uchun yuqori chegara, "tugadi" deb
 * hisoblash uchun pastroq. Bitta chegara bo'lsa, chegara atrofidagi ehtimollik
 * signalni tinimsiz yoqib-o'chirardi.
 *
 * Asos: Silero v5 public default = threshold 0.5, neg_threshold = threshold−0.15.
 *
 * 2026-08-03: bitta so'zni ham, past ovozni ham ushlab qolish uchun yana
 * pasaytirildi (0.33/0.24 → 0.25/0.18). Sabab: real to'siq bu chegara emas,
 * balki ExamRoom'dagi TALK_SIGNAL_CONFIRM_MS (800ms) edi — bitta so'z odatda
 * 300-700ms, ya'ni hech qachon 800ms'ga yetmasdi. `verify_chain.py`da
 * o'lchangan (80 nutq + 124 maishiy shovqin, custom bitta-so'z simulyatsiyasi
 * bilan): (0.25/0.18, mf=3, confirm=300ms) — chip 98.8%→100%, rasmiy
 * 50-62%→91-92.5%, maishiy shovqin FP chip 0%→3.2% (rasmiy FP 0% qoldi).
 *
 * OLDINGI, UZOQ SINALGAN BARQAROR QIYMAT — 0.55 / 0.40. Sezgirlik muammo
 * tug'dirsa (soxta signal ko'paysa) avval SHU juftlikka qaytariladi.
 * Batafsil: `docs/VAD_BENCHMARK.md`.
 */
const SPEECH_START_PROB = 0.55;
const SPEECH_STOP_PROB = 0.40;

/**
 * SEZGIRLIK KALITI — nutq shuncha kadr UZLUKSIZ davom etsagina tasdiqlanadi
 * (1 kadr = 32ms, 3 kadr ≈ 96ms).
 *
 * 2026-08-03: 8 → 3 (256ms → 96ms) — bitta qisqa so'zni ushlab qolish uchun.
 * `verify_chain.py` bilan tekshirilgan: maishiy shovqin FP 0% → 3.2% (chip,
 * arzon xato — jazosiz yorliq), rasmiy FP hamon 0%.
 */
const SPEECH_MIN_FRAMES = 8;

/**
 * Navbat cho'zilib ketsa (sekin qurilma) eng eski kadrlarni tashlaymiz — real-time
 * bo'lish eskirgan kadrni qayta ishlashdan muhimroq.
 */
const MAX_QUEUE = 6;

export class SileroVad {
  private session: ort.InferenceSession | null = null;
  private audioCtx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  private state = new Float32Array(2 * 1 * 128);
  private context = new Float32Array(CONTEXT);
  private inputBuf = new Float32Array(CONTEXT + FRAME);

  private queue: Float32Array[] = [];
  private draining = false;
  private disposed = false;

  private prob = 0;
  /** Xom gisterezis holati (bitta kadr darajasida). */
  private speaking = false;
  /** Ketma-ket nechta kadr nutq deb topildi. */
  private speakingRun = 0;
  /** TASDIQLANGAN nutq — `SPEECH_MIN_FRAMES` uzluksiz kadrdan keyin yoqiladi. */
  private confirmed = false;
  /** Oxirgi natija qachon yangilangani — eskirgan qiymatga tayanmaslik uchun. */
  private lastAt = 0;

  /** Model va audio grafi tayyor bo'ldimi. */
  ready = false;

  /**
   * Modelni yuklaydi va mikrofon oqimini ulaydi.
   * @returns muvaffaqiyatli bo'lsa `true`; `false` bo'lsa chaqiruvchi eski
   *          DSP mantig'iga qaytishi kerak.
   */
  async init(stream: MediaStream): Promise<boolean> {
    if (stream.getAudioTracks().length === 0) return false;
    try {
      // WASM fayllarini o'zimizdan (CDN'siz) — imtihon tarmog'i cheklangan bo'lishi mumkin.
      ort.env.wasm.wasmPaths = '/ort/';
      // Bitta ip yetarli (model juda kichik) va SharedArrayBuffer talab qilmaydi —
      // ko'p ip uchun cross-origin isolation kerak bo'lardi.
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = 'error';

      this.session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      if (this.disposed) return false;

      // Kontekstni 16 kHz da ochamiz — brauzer mikrofonni o'zi qayta namunalaydi,
      // ya'ni qo'lda resampling yozish shart emas.
      this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await this.audioCtx.audioWorklet.addModule(WORKLET_URL);
      if (this.disposed) return false;

      this.source = this.audioCtx.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(this.audioCtx, 'pcm-frame');
      this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        this.queue.push(e.data);
        void this.drain();
      };
      this.source.connect(this.node);
      // Chiqishga ULAMAYMIZ — aks holda talabaning o'z ovozi karnaydan qaytadi.

      this.ready = true;
      return true;
    } catch (err) {
      console.warn('[silero-vad] yuklab bo\'lmadi, DSP zaxirasiga qaytamiz:', err);
      this.dispose();
      return false;
    }
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.session) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        if (this.queue.length > MAX_QUEUE) {
          this.queue.splice(0, this.queue.length - MAX_QUEUE);
        }
        const frame = this.queue.shift()!;
        await this.infer(frame);
      }
    } catch (err) {
      console.warn('[silero-vad] inference xatosi:', err);
      this.ready = false;
    } finally {
      this.draining = false;
    }
  }

  private async infer(frame: Float32Array): Promise<void> {
    const session = this.session;
    if (!session) return;

    // Kirish = oldingi kadrdan 64 sample kontekst + joriy 512 sample.
    this.inputBuf.set(this.context, 0);
    this.inputBuf.set(frame, CONTEXT);

    const outputs = await session.run({
      input: new ort.Tensor('float32', this.inputBuf, [1, CONTEXT + FRAME]),
      state: new ort.Tensor('float32', this.state, [2, 1, 128]),
      sr: new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []),
    });

    this.context.set(frame.subarray(FRAME - CONTEXT));
    this.state = outputs.stateN.data as Float32Array;

    const p = (outputs.output.data as Float32Array)[0];
    this.prob = p;
    this.lastAt = Date.now();
    // Gisterezis — chegara atrofida tinimsiz yoqilib-o'chmasin.
    this.speaking = this.speaking ? p >= SPEECH_STOP_PROB : p >= SPEECH_START_PROB;
    // Tasdiqlash: nutq uzluksiz SPEECH_MIN_FRAMES kadr davom etsagina "gapiryapti"
    // deb hisoblanadi — bitta tasodifiy kadr signal bermaydi.
    if (this.speaking) {
      this.speakingRun += 1;
      if (this.speakingRun >= SPEECH_MIN_FRAMES) this.confirmed = true;
    } else {
      this.speakingRun = 0;
      this.confirmed = false;
    }
  }

  /** Oxirgi kadrdagi nutq ehtimoli (0..1) — diagnostika uchun. */
  get probability(): number {
    return this.prob;
  }

  /**
   * Hozir odam gapiryaptimi.
   * @param maxAgeMs shu vaqtdan eski natija ishonchsiz (audio oqim uzilgan) deb
   *                 hisoblanadi va `false` qaytadi.
   */
  isSpeaking(maxAgeMs = 1000): boolean {
    if (!this.ready) return false;
    if (!this.isReceivingAudio(maxAgeMs)) return false;
    return this.confirmed;
  }

  /** Worklet kadrlar kelayaptimi (AudioContext suspended bo'lsa false). */
  isReceivingAudio(maxAgeMs = 1500): boolean {
    if (!this.ready || this.lastAt <= 0) return false;
    return Date.now() - this.lastAt <= maxAgeMs;
  }

  /** Brauzer avtoplay siyosati — foydalanuvchi gesture'da chaqiriladi. */
  async resume(): Promise<void> {
    if (this.audioCtx?.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.speaking = false;
    this.speakingRun = 0;
    this.confirmed = false;
    this.queue.length = 0;
    try {
      this.node?.port.close();
      this.node?.disconnect();
      this.source?.disconnect();
      void this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.node = null;
    this.source = null;
    this.audioCtx = null;
    void this.session?.release?.().catch(() => {});
    this.session = null;
  }
}
