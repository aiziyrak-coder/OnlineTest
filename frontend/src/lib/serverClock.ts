/**
 * Server soati bilan kompyuter soati farqi.
 *
 * Talaba kompyuterida soat/vaqt zonasi noto'g'ri bo'lsa, `Date.now()` bilan
 * imtihon tugash vaqtini solishtirish xato natija beradi: "Imtihon yopilgan"
 * yoki taymer 0 dan boshlanib darhol topshirish. Har bir API javobidagi
 * `Date` sarlavhasidan farq olinadi va `serverNow()` shu farq bilan ishlaydi.
 */
const KEY = 'fermi_clock_skew_ms';
/** Tarmoq kechikishi va sarlavhaning 1 soniyalik aniqligi uchun e'tiborsiz farq. */
const IGNORE_MS = 2000;

let skewMs = (() => {
  try {
    const v = Number(sessionStorage.getItem(KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
})();

export function noteServerDate(res: Response | null | undefined): void {
  const hdr = res?.headers?.get('Date');
  if (!hdr) return;
  const serverMs = new Date(hdr).getTime();
  if (!Number.isFinite(serverMs)) return;
  const diff = serverMs - Date.now();
  skewMs = Math.abs(diff) < IGNORE_MS ? 0 : diff;
  try {
    sessionStorage.setItem(KEY, String(skewMs));
  } catch {
    /* saqlab bo'lmasa ham xotiradagi qiymat ishlaydi */
  }
}

export function clockSkewMs(): number {
  return skewMs;
}

/** Server vaqti bo'yicha hozirgi lahza (ms). */
export function serverNow(): number {
  return Date.now() + skewMs;
}
