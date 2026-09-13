/**
 * Real-time ovoz faolligi (VAD) — faqat inson nutqi.
 *
 * Stul, klaviatura, eshik qarshiligi kabi qisqa impuls shovqinlarni filtrlash:
 * - past chastota ulushi (thud/scrape)
 * - yuqori crest factor (impuls)
 * - harmonik struktura (nutqda bor, shovqinda yo'q)
 *
 * Ikki holat:
 * 1) Talaba gapirsa — mikrofonda nutq + kamerada og'iz harakati.
 * 2) Orqada/yonda boshqa odam gapirsa — mikrofonda nutq, lekin talaba og'izi jim.
 */

export interface VoiceFrame {
  rms: number;
  zcr: number;
  /** Inson nutqiga o'xshash freym (impuls shovqin emas). */
  humanVoice: boolean;
  speechRatio: number;
  lowFreqRatio: number;
  crestFactor: number;
  /** Davriylik (normallashgan autokorrelyatsiya cho'qqisi, 0..1). */
  harmonicity: number;
  /** Baholangan asosiy ton f0 (Hz). 0 = topilmadi. */
  pitchHz: number;
  /** f0 ning nechta ohangi (harmonikasi) spektrda ko'rinadi. */
  harmonicCount: number;
  /** Nutq bandidagi "faol" binlar ulushi — keng polosali shovqinda yuqori. */
  activeBandRatio: number;
}

/*
 * DIZAYN QAYDI — nega mezonlar aynan shunday.
 *
 * Ilgari `flatness <= 0.6` mezoni bor edi. U SOXTA edi: `getByteFrequencyData`
 * qiymatlari **desibel** shkalasida (logarifmik) keladi, chiziqli emas. dB
 * qiymatlarida spektral tekislik deyarli hamma signal uchun 1 ga yaqin chiqadi —
 * natijada real erkak ovozi (f0≈130 Hz) HAM rad etilardi. Bu offline test
 * (`tests/voiceDetection.test.ts` + haqiqiy FFT bilan `tests/audioFixtures.ts`)
 * orqali aniqlandi.
 *
 * Yangi asosiy mezon — DAVRIYLIK (`harmonicity`, autokorrelyatsiya cho'qqisi).
 * O'lchangan qiymatlar (sintetik, halol FFT bilan):
 *   odam ovozi ........................ 0.99  (shovqin ustida, SNR 3dB da ham 0.62)
 *   ventilyator/konditsioner .......... 0.45
 *   musiqa (akkord) ................... 0.44
 *   idish-tovoq ....................... 0.35
 *   transport / klaviatura / eshik .... 0.13–0.17
 *   oq shovqin / qog'oz ............... 0.07–0.10
 * Ya'ni 0.60 chegarasi maishiy shovqinni TOZA ajratadi.
 *
 * Yagona istisno — SOF TON (mikrovolnovka "pip", telefon signali): u ham mukammal
 * davriy (1.0). Uni `harmonicCount` rad etadi: sof tonda 1–2 ta ohang, nutqda
 * (vokal trakt + formantlar) 4–12 ta.
 */
/** Minimal RMS — nafas/jim mikrofon shovqinidan biroz yuqoriroq.
 *  Past ovozda gapirish aniqlanmay qolgani uchun sezgirlik ~40% oshirildi
 *  (0.024 → 0.0144). Oldingi barqaror qiymat: 0.024. */
const RMS_VOICE = 0.0144;
/** Nutq f0 diapazoni (chuqur erkak ovozidan baland ayol ovozigacha). */
const PITCH_MIN_HZ = 75;
const PITCH_MAX_HZ = 350;
/** Asosiy mezon: davriylik. Maishiy shovqinning eng yuqorisi ~0.45. */
const PERIODICITY_MIN = 0.6;
/** Sof ton/signalni rad etish: nutqda ohanglar ko'p. */
const HARMONIC_COUNT_MIN = 4;
/** Keng polosali shovqin (klaviatura, transport, oq shovqin) uchun xavfsizlik to'ri. */
const ACTIVE_BAND_RATIO_MAX = 0.45;
/** Nutq bandidagi energiya ulushi — shovqin ustidagi ovoz uchun ataylab bo'sh. */
const SPEECH_BAND_RATIO_MIN = 0.25;
const ZCR_MAX = 0.35;
const LOW_FREQ_RATIO_MAX = 0.55;
const CREST_IMPULSE_MIN = 7.5;

interface SpectrumMetrics {
  speechRatio: number;
  lowFreqRatio: number;
  activeBandRatio: number;
  harmonicCount: number;
}

/**
 * Spektr mezonlari. `pitchHz` berilsa, uning ohanglari (f0, 2f0, 3f0...) spektrda
 * bor-yo'qligi sanaladi — bu nutqni sof tondan ajratadi.
 */
function spectrumMetrics(analyser: AnalyserNode, pitchHz: number): SpectrumMetrics {
  const n = analyser.frequencyBinCount;
  const freq = new Uint8Array(n);
  analyser.getByteFrequencyData(freq);
  const binHz = analyser.context.sampleRate / analyser.fftSize;

  let total = 0;
  let speech = 0;
  let low = 0;
  let maxByte = 0;
  for (let i = 2; i < n; i++) {
    const b = freq[i] || 0;
    if (b > maxByte) maxByte = b;
    const e = b / 255;
    if (e < 0.008) continue;
    total += e;
    const hz = i * binHz;
    if (hz < 180) low += e;
    if (hz >= 180 && hz <= 3600) speech += e;
  }

  // "Faol" bin = cho'qqidan ~12 dB pastgacha. Nutq spektri taroqsimon (ohanglar
  // orasida chuqur pastliklar) → ulush kichik; keng polosali shovqinda katta.
  let active = 0;
  let band = 0;
  for (let i = 2; i < n; i++) {
    const hz = i * binHz;
    if (hz < 180 || hz > 3600) continue;
    band += 1;
    if ((freq[i] || 0) >= maxByte - 45) active += 1;
  }

  let harmonicCount = 0;
  if (pitchHz >= PITCH_MIN_HZ) {
    for (let k = 1; k <= 12; k++) {
      const hz = pitchHz * k;
      if (hz > 4000) break;
      const idx = Math.round(hz / binHz);
      let local = 0;
      for (let d = -1; d <= 1; d++) local = Math.max(local, freq[idx + d] || 0);
      if (local >= maxByte - 55) harmonicCount += 1;
    }
  }

  return {
    speechRatio: total > 0 ? speech / total : 0,
    lowFreqRatio: total > 0 ? low / total : 0,
    activeBandRatio: band > 0 ? active / band : 0,
    harmonicCount,
  };
}

/**
 * Autokorrelyatsiya bilan davriylik va f0. Nutqning eng ishonchli belgisi —
 * tovush to'lqinining o'zini takrorlashi; maishiy shovqinda bunday takror yo'q.
 */
function estimatePitch(
  samples: Float32Array,
  sampleRate: number,
): { periodicity: number; pitchHz: number } {
  const minLag = Math.floor(sampleRate / PITCH_MAX_HZ);
  const maxLag = Math.floor(sampleRate / PITCH_MIN_HZ);
  if (maxLag <= minLag + 2 || maxLag >= samples.length - 1) {
    return { periodicity: 0, pitchHz: 0 };
  }

  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  if (energy < 1e-6) return { periodicity: 0, pitchHz: 0 };
  const meanPower = energy / samples.length;

  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const len = samples.length - lag;
    for (let i = 0; i < len; i++) corr += samples[i] * samples[i + lag];
    const norm = corr / len / (meanPower + 1e-12);
    if (norm > best) {
      best = norm;
      bestLag = lag;
    }
  }
  return {
    periodicity: Math.max(0, Math.min(1, best)),
    pitchHz: bestLag > 0 ? sampleRate / bestLag : 0,
  };
}

export function analyzeVoiceFrame(analyser: AnalyserNode): VoiceFrame {
  const n = analyser.fftSize;
  const buf = new Uint8Array(n);
  analyser.getByteTimeDomainData(buf);

  const floats = new Float32Array(n);
  let sumSq = 0;
  let peak = 0;
  let crossings = 0;
  let prevSign = 0;
  for (let i = 0; i < n; i++) {
    const v = (buf[i] - 128) / 128;
    floats[i] = v;
    sumSq += v * v;
    peak = Math.max(peak, Math.abs(v));
    const sign = v >= 0 ? 1 : -1;
    if (prevSign !== 0 && sign !== prevSign) crossings++;
    prevSign = sign;
  }
  const rms = Math.sqrt(sumSq / n);
  const zcr = crossings / n;
  const crestFactor = peak / (rms + 1e-7);

  const { periodicity, pitchHz } = estimatePitch(floats, analyser.context.sampleRate);
  const { speechRatio, lowFreqRatio, activeBandRatio, harmonicCount } = spectrumMetrics(
    analyser,
    pitchHz,
  );

  const notImpulse =
    lowFreqRatio <= LOW_FREQ_RATIO_MAX && !(crestFactor >= CREST_IMPULSE_MIN && rms < 0.2);

  const humanVoice =
    rms >= RMS_VOICE &&
    periodicity >= PERIODICITY_MIN &&
    pitchHz >= PITCH_MIN_HZ &&
    pitchHz <= PITCH_MAX_HZ &&
    harmonicCount >= HARMONIC_COUNT_MIN &&
    activeBandRatio <= ACTIVE_BAND_RATIO_MAX &&
    speechRatio >= SPEECH_BAND_RATIO_MIN &&
    zcr <= ZCR_MAX &&
    notImpulse;

  return {
    rms,
    zcr,
    humanVoice,
    speechRatio,
    lowFreqRatio,
    crestFactor,
    harmonicity: periodicity,
    pitchHz,
    harmonicCount,
    activeBandRatio,
  };
}

/**
 * Faqat barqaror inson nutqi uchun xom holat (stul/klaviatura impulslari emas).
 * Davomiylik (kichik→katta eskalatsiya) endi tashqarida `ContinuousSignalTracker`
 * bilan hisoblanadi — bu klass faqat shu freymda nutq bor-yo'qligini aytadi.
 */
export class VoiceActivityTracker {
  // DIQQAT — bu yerda jiddiy xato bor edi. Ilgari shovqin sathi birinchi 60
  // freymdagi ENG BALAND RMS deb olinardi (`Math.max`) va keyin umuman
  // yangilanmasdi. Imtihon boshida bir og'iz gapirilsa sath nutq darajasiga
  // chiqib qolardi va `rms > floor * 1.51` sharti boshqa hech qachon
  // bajarilmasdi — nazorat butun imtihon davomida kar bo'lib qolardi.
  // Platforma tarixida MOUTH_MOVEMENT_TALKING nolga teng bo'lganining sababi
  // aynan shu.
  private floor = new NoiseFloorEstimator();
  private prevRms = 0;
  private warmup = 8;   // ~1.6 s — mikrofon ochilishidagi tebranish o'tsin

  push(frame: VoiceFrame): boolean {
    const floor = this.floor.push(frame.rms);
    if (this.warmup > 0) {
      this.warmup -= 1;
      return false;
    }

    const spike = this.prevRms > 0.015 && frame.rms > this.prevRms * 3.2;
    this.prevRms = frame.rms * 0.65 + this.prevRms * 0.35;
    if (spike) return false;

    const aboveFloor = frame.rms > floor * 1.51;
    return frame.humanVoice && aboveFloor;
  }
}

// Tashqi shovqin — davomiy va sezilarli (musiqa/TV/yonidagi suhbat).
// Ilgari bu chegara 0.2 edi — bu ~-14 dBFS, ya'ni deyarli baqiriq darajasi.
// Shu sabab SUSPICIOUS_AUDIO platforma tarixida BIRONTA ham yozilmagan.
// Oddiy xona shovqini (ventilyator, kuler) baribir o'tmaydi, chunki
// `AMBIENT_FLOOR_MULT` fon sathidan ustunlikni ham talab qiladi.
const AMBIENT_RMS_MIN = 0.06;
const AMBIENT_FLOOR_MULT = 3.8;

/**
 * Shovqin sathini (noise floor) baholovchi.
 *
 * NEGA ALOHIDA KLASS: ilgari sath "birinchi 12 soniyadagi eng baland RMS"
 * deb olinardi va keyin hech qachon o'zgarmasdi. Imtihon boshida bir
 * marta gapirilsa sath nutq darajasiga chiqib, nazorat butun imtihon
 * davomida kar bo'lib qolardi.
 *
 * To'g'ri usul — MINIMUMGA ergashish: jimlik topilganda sath tez pastga
 * tushadi, shovqin ortsa sekin ko'tariladi va HECH QACHON `FLOOR_CEIL` dan
 * oshmaydi (nutq darajasi shovqin deb qabul qilinmasin).
 */
const FLOOR_CEIL = 0.045;
const FLOOR_INIT = 0.012;

export class NoiseFloorEstimator {
  private floor = FLOOR_INIT;

  push(rms: number): number {
    if (rms < this.floor) {
      this.floor = this.floor * 0.88 + rms * 0.12;   // pastga TEZ
    } else {
      this.floor = this.floor * 0.997 + rms * 0.003; // tepaga SEKIN
    }
    if (this.floor > FLOOR_CEIL) this.floor = FLOOR_CEIL;
    if (this.floor < 0.0015) this.floor = 0.0015;
    return this.floor;
  }

  get value(): number {
    return this.floor;
  }
}

// --- PICHIRLASH (ovozsiz nutq) mezonlari -----------------------------------
// Pichirlashda ohang (f0) va garmonikalar YO'Q, shuning uchun `humanVoice`
// uni hech qachon ushlay olmaydi. Ajratuvchi belgi — BO'G'INLI tuzilish:
// ovoz balandligi 3-8 Hz da to'lqinlanadi. Barqaror shovqin (ventilyator,
// oq shovqin, ko'cha gurillashi) bunday to'lqinlanmaydi.
const WHISPER_WINDOW = 12;              // ~2.4 s (200 ms freym)
const WHISPER_FLOOR_MULT = 1.7;         // fon sathidan ustunlik
const WHISPER_RMS_MAX = 0.30;           // baqiriq emas
const WHISPER_LOW_FREQ_MAX = 0.45;      // past gurillash emas
const WHISPER_SPEECH_RATIO_MIN = 0.08;  // energiyasining bir qismi nutq bandida
const WHISPER_ZCR_MIN = 0.35;           // ovozsiz ("sh") tovush belgisi
const WHISPER_PERIODICITY_MAX = 0.35;   // ohangsiz
const WHISPER_MODULATION_MIN = 0.35;    // bo'g'inlilik darajasi
// ASOSIY AJRATUVCHI — spektr shakli. Pichirlash oq shovqin (0.69) bilan
// qog'oz shitirlashi (0.00) orasida, ~0.25 da turadi.
const WHISPER_ACTIVE_MIN = 0.10;
const WHISPER_ACTIVE_MAX = 0.45;

/** Oynadagi RMS larning o'zgaruvchanligi: barqaror shovqinda kichik,
 *  bo'g'inli nutqda katta. */
function modulationDepth(hist: number[]): number {
  if (hist.length < 4) return 0;
  let sum = 0;
  for (const v of hist) sum += v;
  const mean = sum / hist.length;
  if (mean <= 1e-6) return 0;
  let varSum = 0;
  for (const v of hist) varSum += (v - mean) * (v - mean);
  return Math.sqrt(varSum / hist.length) / mean;
}

/**
 * Pichirlash / ovozsiz nutqni aniqlaydi — `VoiceActivityTracker` dan
 * ALOHIDA, chunki u ohangga tayanadi va pichirlashda ohang yo'q.
 */
export class WhisperTracker {
  private floor = new NoiseFloorEstimator();
  private hist: number[] = [];

  push(frame: VoiceFrame): boolean {
    const floor = this.floor.push(frame.rms);
    this.hist.push(frame.rms);
    if (this.hist.length > WHISPER_WINDOW) this.hist.shift();
    if (this.hist.length < WHISPER_WINDOW) return false;

    // 1) fon sathidan yuqori, lekin baqiriq emas
    if (frame.rms <= floor * WHISPER_FLOOR_MULT) return false;
    if (frame.rms > WHISPER_RMS_MAX) return false;
    // 2) OHANGSIZ — ovozli nutqni `VoiceActivityTracker` ushlaydi
    if (frame.harmonicity >= WHISPER_PERIODICITY_MAX) return false;
    // 3) ovozsiz "sh" tovushi — nol kesishuvlar zich
    if (frame.zcr < WHISPER_ZCR_MIN) return false;
    // 4) past chastotali gurillash (ventilyator, transport) emas
    if (frame.lowFreqRatio > WHISPER_LOW_FREQ_MAX) return false;
    // 5) energiyasining bir qismi nutq diapazonida bo'lsin
    if (frame.speechRatio < WHISPER_SPEECH_RATIO_MIN) return false;
    // 6) SPEKTR SHAKLI — oq shovqin (tekis, 0.69) ham, qog'oz shitirlashi
    //    (juda tor, 0.00) ham emas
    if (frame.activeBandRatio < WHISPER_ACTIVE_MIN) return false;
    if (frame.activeBandRatio > WHISPER_ACTIVE_MAX) return false;
    // 7) impuls emas (klaviatura, eshik, idish)
    if (frame.crestFactor >= CREST_IMPULSE_MIN) return false;
    // 8) BO'G'INLILIK: barqaror shovqin emas, nutq ritmi
    return modulationDepth(this.hist) >= WHISPER_MODULATION_MIN;
  }
}

/**
 * Baland tashqi shovqin (musiqa, televizor, eshik — inson nutqi emas) — xom holat.
 */
export class AmbientNoiseTracker {
  // `VoiceActivityTracker` dagi bilan bir xil xato edi: sath birinchi 12
  // soniyadagi eng baland qiymat bo'yicha muzlatilardi.
  private floor = new NoiseFloorEstimator();
  private prevRms = 0;
  private warmup = 8;

  /**
   * @param isSpeech nutq qarori. Berilsa — Silero VAD dan keladi (ishonchliroq),
   *                 berilmasa freymning o'z DSP bahosi ishlatiladi. Nutq bir vaqtda
   *                 "shovqin" deb ham yozilmasligi uchun kerak.
   */
  push(frame: VoiceFrame, isSpeech?: boolean): boolean {
    const floor = this.floor.push(frame.rms);
    if (this.warmup > 0) {
      this.warmup -= 1;
      return false;
    }

    const spike = this.prevRms > 0.015 && frame.rms > this.prevRms * 3.2;
    this.prevRms = frame.rms * 0.65 + this.prevRms * 0.35;
    if (spike) return false;

    const speech = isSpeech ?? frame.humanVoice;
    return (
      !speech &&
      frame.rms >= AMBIENT_RMS_MIN &&
      frame.rms > floor * AMBIENT_FLOOR_MULT &&
      (frame.lowFreqRatio > 0.4 || frame.speechRatio < 0.4)
    );
  }
}

/** Og'iz/gapirish uchun yuz ko'rinadimi (WAITING va NO_FACE dan tashqari). */
export function isFaceVisibleForTalk(status: string): boolean {
  return status !== 'NO_FACE' && status !== 'MULTIPLE_FACES' && status !== 'WAITING';
}
