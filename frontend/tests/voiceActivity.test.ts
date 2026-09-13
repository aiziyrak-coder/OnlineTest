import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AmbientNoiseTracker,
  VoiceActivityTracker,
} from '../src/lib/voiceActivity.ts';
import type { VoiceFrame } from '../src/lib/voiceActivity.ts';
import { ContinuousSignalTracker } from '../src/lib/continuousSignal.ts';

/** Freym mezonlarining qolgan (bu testda ahamiyatsiz) maydonlari. */
const rest = { pitchHz: 0, harmonicCount: 0, activeBandRatio: 0 };

const quiet: VoiceFrame = {
  rms: 0.012,
  zcr: 0.01,
  humanVoice: false,
  speechRatio: 0.15,
  lowFreqRatio: 0.4,
  crestFactor: 2,
  harmonicity: 0.1,
  ...rest,
};

const speech: VoiceFrame = {
  rms: 0.09,
  zcr: 0.09,
  humanVoice: true,
  speechRatio: 0.64,
  lowFreqRatio: 0.2,
  crestFactor: 3.2,
  harmonicity: 0.45,
  ...rest,
};

const chairThud: VoiceFrame = {
  rms: 0.18,
  zcr: 0.28,
  humanVoice: false,
  speechRatio: 0.35,
  lowFreqRatio: 0.72,
  crestFactor: 9.5,
  harmonicity: 0.12,
  ...rest,
};

const ambientTv: VoiceFrame = {
  rms: 0.24, // AMBIENT_RMS_MIN (0.2) dan baland — haqiqiy baland shovqin
  zcr: 0.14,
  humanVoice: false,
  speechRatio: 0.28,
  lowFreqRatio: 0.48,
  crestFactor: 4.2,
  harmonicity: 0.18,
  ...rest,
};

describe('AmbientNoiseTracker', () => {
  it('ignores quiet background', () => {
    const tracker = new AmbientNoiseTracker();
    for (let i = 0; i < 60; i++) {
      assert.equal(tracker.push(quiet), false);
    }
  });

  it('ignores human speech (handled by VoiceActivityTracker)', () => {
    const tracker = new AmbientNoiseTracker();
    for (let i = 0; i < 50; i++) tracker.push(quiet);
    for (let i = 0; i < 20; i++) {
      assert.equal(tracker.push(speech), false);
    }
  });

  it('flags sustained loud non-speech as active', () => {
    const tracker = new AmbientNoiseTracker();
    for (let i = 0; i < 70; i++) tracker.push(quiet);
    // Birinchi kadr spike-filtr tufayli o'tkazilishi mumkin — bir necha kadr beramiz.
    let saw = false;
    for (let i = 0; i < 8; i++) {
      if (tracker.push(ambientTv)) saw = true;
    }
    assert.equal(saw, true);
  });
});

describe('VoiceActivityTracker', () => {
  it('ignores non-speech loud frames', () => {
    const tracker = new VoiceActivityTracker();
    for (let i = 0; i < 70; i++) tracker.push(quiet);
    for (let i = 0; i < 20; i++) {
      const active = tracker.push({
        rms: 0.2,
        zcr: 0.35,
        humanVoice: false,
        speechRatio: 0.2,
        lowFreqRatio: 0.5,
        crestFactor: 8,
        harmonicity: 0.15,
        ...rest,
      });
      assert.equal(active, false);
    }
  });

  it('ignores chair-like impulse noise', () => {
    const tracker = new VoiceActivityTracker();
    for (let i = 0; i < 70; i++) tracker.push(quiet);
    for (let i = 0; i < 15; i++) {
      assert.equal(tracker.push(chairThud), false);
    }
  });

  it('flags human voice as active', () => {
    const tracker = new VoiceActivityTracker();
    for (let i = 0; i < 70; i++) tracker.push(quiet);
    let saw = false;
    for (let i = 0; i < 8; i++) {
      if (tracker.push(speech)) saw = true;
    }
    assert.equal(saw, true);
  });

  it('isitish (warmup) paytida jim turadi, keyin ESHITADI', () => {
    // Ilgari bu yerda 60 freym (12 soniya) "kalibrlash" bor edi va o'sha
    // davrdagi eng baland ovoz umrbod shovqin sathi bo'lib qolardi — imtihon
    // boshida bir og'iz gapirilsa nazorat butun imtihon davomida kar
    // bo'lardi. Endi sath uzluksiz baholanadi, isitish esa atigi 8 freym.
    const tracker = new VoiceActivityTracker();
    for (let i = 0; i < 8; i++) {
      assert.equal(tracker.push(speech), false, "isitish paytida jim turishi kerak");
    }
    let saw = false;
    for (let i = 0; i < 10; i++) {
      if (tracker.push(speech)) saw = true;
    }
    assert.equal(saw, true, "isitishdan keyin nutq aniqlanishi kerak");
  });
});

describe('ContinuousSignalTracker (kichik->katta eskalatsiya qoidasi)', () => {
  it('returns 0 while inactive', () => {
    const t = new ContinuousSignalTracker(500);
    assert.equal(t.push(false, 0), 0);
    assert.equal(t.push(false, 1000), 0);
  });

  it('accumulates duration while continuously active', () => {
    const t = new ContinuousSignalTracker(500);
    assert.equal(t.push(true, 0), 0);
    assert.equal(t.push(true, 1000), 1000);
    assert.equal(t.push(true, 2000), 2000);
  });

  it('tolerates a short gap within the grace window', () => {
    const t = new ContinuousSignalTracker(500);
    t.push(true, 0);
    t.push(true, 1000);
    // 300ms uzilish — grace (500ms) ichida, hisoblagich uzilmaydi (davomiylik hisoblanaveradi).
    assert.equal(t.push(false, 1300), 1300);
    assert.equal(t.push(true, 1400), 1400);
  });

  it('resets after a gap longer than the grace window', () => {
    const t = new ContinuousSignalTracker(500);
    t.push(true, 0);
    t.push(true, 1000);
    assert.equal(t.push(false, 2000), 0);
    assert.equal(t.push(true, 2100), 0);
    assert.equal(t.push(true, 2600), 500);
  });

  it('reset() clears accumulated duration immediately', () => {
    const t = new ContinuousSignalTracker(500);
    t.push(true, 0);
    t.push(true, 1000);
    t.reset();
    assert.equal(t.push(true, 1050), 0);
  });
});
