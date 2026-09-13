/**
 * Pichirlash aniqlanishi va SHOVQIN ANIQLANMASLIGI.
 *
 * Nega kerak: yonidagi odam kameraga ko'rinmay, pichirlab javob aytishi
 * mumkin edi — `humanVoice` ohangga (pitch) tayanadi, pichirlashda esa
 * ohang yo'q. Endi alohida `WhisperTracker` bor: u bo'g'inli
 * to'lqinlanishga qaraydi.
 *
 * Eng muhimi — SOXTA signal bo'lmasligi: ventilyator, klaviatura, qog'oz,
 * ko'cha shovqini pichirlash deb hisoblanmasligi kerak, aks holda halol
 * topshiruvchi imtihondan chiqarib yuboriladi.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as F from './audioFixtures';
import {
  AmbientNoiseTracker,
  NoiseFloorEstimator,
  VoiceActivityTracker,
  WhisperTracker,
  analyzeVoiceFrame,
} from '../src/lib/voiceActivity';

/** Bo'g'inli konvert: pichirlash "bo'g'in-pauza-bo'g'in" bo'lib keladi. */
function syllabic(base: (rms: number) => Float32Array, rms: number, i: number) {
  // ~5 Hz bo'g'in tezligi (200 ms freymda navbatma-navbat baland/past)
  const env = i % 2 === 0 ? 1.0 : 0.25;
  return base(rms * env);
}

/** N ta freymni tracker'ga beradi va oxirgi 6 tasida signal bo'lganini qaytaradi. */
function feed(
  tracker: WhisperTracker,
  make: (i: number) => Float32Array,
  n = 26,
): number {
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const on = tracker.push(analyzeVoiceFrame(F.analyserFor(make(i))));
    if (i >= n - 6 && on) hits += 1;
  }
  return hits;
}

describe('shovqin sathi (noise floor) endi muzlab qolmaydi', () => {
  test('boshida baland ovoz bo\'lsa ham sath nutq darajasiga chiqmaydi', () => {
    const est = new NoiseFloorEstimator();
    // Imtihon boshida 12 soniya gapirildi (eski kod aynan shunda kar bo'lardi)
    for (let i = 0; i < 60; i++) est.push(0.25);
    assert.ok(
      est.value <= 0.05,
      `sath ${est.value} — nutq darajasida qolib ketdi, nazorat kar bo'ladi`,
    );
  });

  test('jimlik topilganda sath pastga tushadi', () => {
    const est = new NoiseFloorEstimator();
    for (let i = 0; i < 60; i++) est.push(0.2);
    for (let i = 0; i < 80; i++) est.push(0.004);
    assert.ok(est.value < 0.01, `sath ${est.value} pastga tushmadi`);
  });

  test('boshida gapirilgan bo\'lsa ham keyin ovoz ANIQLANADI', () => {
    const t = new VoiceActivityTracker();
    // 12 s baland nutq — eski kodda shundan keyin hech narsa aniqlanmasdi
    for (let i = 0; i < 60; i++) t.push(analyzeVoiceFrame(F.analyserFor(F.voicedSpeech(0.25))));
    // keyin jimlik
    for (let i = 0; i < 40; i++) t.push(analyzeVoiceFrame(F.analyserFor(F.whiteNoise(0.003))));
    // endi odam gapiradi
    let hits = 0;
    for (let i = 0; i < 10; i++) {
      if (t.push(analyzeVoiceFrame(F.analyserFor(F.voicedSpeech(0.08))))) hits += 1;
    }
    assert.ok(hits >= 5, `nutq aniqlanmadi (${hits}/10) — tracker kar`);
  });
});

describe('PICHIRLASH aniqlanadi', () => {
  test('bo\'g\'inli pichirlash ushlanadi', () => {
    const t = new WhisperTracker();
    const hits = feed(t, (i) => syllabic(F.whisper, 0.05, i));
    assert.ok(hits >= 3, `pichirlash aniqlanmadi (${hits}/6)`);
  });

  test('jimroq pichirlash ham ushlanadi', () => {
    const t = new WhisperTracker();
    const hits = feed(t, (i) => syllabic(F.whisper, 0.03, i));
    assert.ok(hits >= 2, `jim pichirlash aniqlanmadi (${hits}/6)`);
  });
});

describe('MAISHIY SHOVQIN pichirlash deb hisoblanMAYDI (soxta signal bo\'lmasin)', () => {
  const steady: Array<[string, (rms: number) => Float32Array, number]> = [
    ['ventilyator', F.fanHum, 0.05],
    ['oq shovqin', F.whiteNoise, 0.05],
    ['ko\'cha gurillashi', F.trafficRumble, 0.05],
    ['qog\'oz shitirlashi', F.paperRustle, 0.05],
  ];
  for (const [name, gen, rms] of steady) {
    test(`${name} — pichirlash EMAS`, () => {
      const t = new WhisperTracker();
      const hits = feed(t, () => gen(rms));
      assert.equal(hits, 0, `${name} pichirlash deb belgilandi (${hits}/6)`);
    });
  }

  test('klaviatura — pichirlash EMAS', () => {
    const t = new WhisperTracker();
    const hits = feed(t, (i) => (i % 3 === 0 ? F.keyboardTyping(0.08) : F.whiteNoise(0.004)));
    assert.equal(hits, 0, `klaviatura pichirlash deb belgilandi (${hits}/6)`);
  });

  test('jimlik — pichirlash EMAS', () => {
    const t = new WhisperTracker();
    const hits = feed(t, () => F.whiteNoise(0.002));
    assert.equal(hits, 0, `jimlik pichirlash deb belgilandi (${hits}/6)`);
  });
});

describe('tashqi shovqin chegarasi endi haqiqiy', () => {
  test('baland davomiy shovqin aniqlanadi', () => {
    // Ko'cha/olomon gurillashi: nutq diapazonidan tashqarida va baland —
    // `AmbientNoiseTracker` aynan shunga mo'ljallangan.
    const t = new AmbientNoiseTracker();
    let hits = 0;
    for (let i = 0; i < 30; i++) {
      const on = t.push(analyzeVoiceFrame(F.analyserFor(F.trafficRumble(0.12))), false);
      if (i >= 24 && on) hits += 1;
    }
    assert.ok(hits >= 1, `baland tashqi shovqin aniqlanmadi (${hits}/6)`);
  });

  test('oddiy xona shovqini aniqlanMAYDI', () => {
    const t = new AmbientNoiseTracker();
    let hits = 0;
    for (let i = 0; i < 30; i++) {
      const on = t.push(analyzeVoiceFrame(F.analyserFor(F.fanHum(0.02))), false);
      if (i >= 24 && on) hits += 1;
    }
    assert.equal(hits, 0, `ventilyator shovqin deb belgilandi (${hits}/6)`);
  });
});
