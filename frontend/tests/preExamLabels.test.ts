/**
 * PreExamCheck dagi HAR BIR matn kaliti uchta tilda ham mavjudmi.
 *
 * NEGA KERAK: `PRE_L` ning turi `Record<string, string>` — bo'sh tur.
 * Shuning uchun mavjud bo'lmagan kalitga murojaat qilinsa TypeScript
 * xato bermaydi, kod muvaffaqiyatli quriladi va matn o'rniga
 * `undefined` chiqadi.
 *
 * 2026-09-09 da aynan shu yuz berdi: rozilik TUGMASI matnsiz chiqdi,
 * nomzodlar uni tugma deb tanimadi va bir kun davomida hech kim
 * imtihonni boshlay olmadi. Bu sinov shu xatoni qurishdayoq ushlaydi.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const SRC = readFileSync(
  new URL('../src/pages/PreExamCheck.tsx', import.meta.url),
  'utf8',
);

/** `PRE_L` e'lonidagi til bloklarini ajratib oladi. */
function preLangKeys(): Record<string, Set<string>> {
  const start = SRC.indexOf('const PRE_L');
  assert.ok(start >= 0, 'PRE_L topilmadi');
  // E'lon `};` bilan tugaydi (birinchi ustundagi).
  const end = SRC.indexOf('\n};', start);
  assert.ok(end > start, 'PRE_L oxiri topilmadi');
  const body = SRC.slice(start, end);

  const out: Record<string, Set<string>> = {};
  for (const lang of ['uz', 'ru', 'en']) {
    const m = new RegExp(`\\b${lang}:\\s*\\{`).exec(body);
    assert.ok(m, `PRE_L da '${lang}' bloki yo'q`);
    // Mos qavsni topamiz.
    let depth = 0;
    let i = m.index + m[0].length - 1;
    let close = -1;
    for (; i < body.length; i++) {
      if (body[i] === '{') depth += 1;
      else if (body[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    assert.ok(close > 0, `${lang} bloki yopilmagan`);
    const block = body.slice(m.index, close);
    // Kalitlarni sanashdan oldin MATNLAR olib tashlanadi: tarjima ichidagi
    // "Diqqat:" yoki "https:" kabi ikki nuqtalar kalit deb sanalmasin.
    const noText = block
      .replace(/"(?:[^"\\]|\\.)*"/g, '')
      .replace(/`(?:[^`\\]|\\.)*`/g, '')
      .replace(/'(?:[^'\\]|\\.)*'/g, '');
    out[lang] = new Set(
      [...noText.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)]
        .map((x) => x[1])
        .filter((k) => k !== lang),
    );
  }
  return out;
}

/** Kodda ishlatilgan `PRE_L[...].kalit` larni yig'adi. */
function usedKeys(): Set<string> {
  return new Set(
    [...SRC.matchAll(/PRE_L\[[^\]]+\]\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  );
}

describe('PreExamCheck matn kalitlari', () => {
  const langs = preLangKeys();
  const used = usedKeys();

  test('kamida bitta kalit ishlatilgan (sinovning o\'zi ishlayapti)', () => {
    assert.ok(used.size > 0, 'PRE_L ishlatilishi topilmadi — sinov buzuq');
  });

  for (const lang of ['uz', 'ru', 'en']) {
    test(`${lang}: ishlatilgan HAR BIR kalit mavjud`, () => {
      const missing = [...used].filter((k) => !langs[lang].has(k)).sort();
      assert.deepEqual(
        missing,
        [],
        `${lang} tilida yo'q kalitlar (ekranda "undefined" chiqadi): ${missing.join(', ')}`,
      );
    });
  }

  test('uchala til bir xil kalitlarga ega', () => {
    const uz = [...langs.uz].sort();
    for (const lang of ['ru', 'en']) {
      const other = [...langs[lang]].sort();
      assert.deepEqual(
        other,
        uz,
        `${lang} va uz kalitlari farq qiladi`,
      );
    }
  });
});
