const DEVICE_TOKEN_KEY = 'vac_device_token_v1';

function simpleHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function getDeviceFingerprint(): string {
  try {
    const key = 'vac_device_fp_v1';
    const existing = localStorage.getItem(key);
    if (existing && existing.trim()) return existing.trim();
    const parts = [
      navigator.userAgent || '',
      (navigator as any).platform || '',
      navigator.language || '',
      String((navigator as any).hardwareConcurrency || ''),
      String((navigator as any).deviceMemory || ''),
      String(screen?.width || ''),
      String(screen?.height || ''),
      String(screen?.colorDepth || ''),
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    ];
    const fp = `vac-${simpleHash(parts.join('|'))}`;
    localStorage.setItem(key, fp);
    return fp;
  } catch {
    return 'vac-fallback';
  }
}

/**
 * Server /start javobidagi deviceToken — localStorage'da saqlanadi (sessionStorage EMAS).
 * Sabab: sessionStorage tab yopilganda/qayta login qilinganda o'chib ketadi — talaba
 * imtihon "In Progress" holatda qolgan holda shunchaki tabni yopib qayta ochsa yoki
 * sessiyasi tugab qayta login qilsa, token yo'qolib "DEVICE_MISMATCH" bilan imtihondan
 * butunlay chetlatilib qolardi (xuddi shu qurilmada davom etsa ham). localStorage esa
 * brauzer/qurilma darajasida saqlanadi va bu holatlarda ham saqlanib qoladi.
 */
/**
 * 2026-09-04: qurilma tokeni domen bo'yicha BITTA kalitda saqlanardi. Kompyuter
 * sinfida bitta mashinadan ketma-ket kirgan ikkinchi o'qituvchi birinchisining
 * tokenini ustidan yozardi va birinchi sessiya 403 DEVICE_MISMATCH bilan
 * qulflanib qolardi — o'nlab kishi imtihon oxirida "Yakunlash" bosolmadi.
 * Endi kalit JWT egasiga bog'lanadi, ya'ni bir mashinadagi ikki hisob bir-biriga
 * tegmaydi. Eski yagona kalit fallback sifatida qoladi: hozir imtihon topshirib
 * turganlarning tokeni yo'qolib qolmasin.
 */
function jwtSubject(authToken?: string): string {
  if (!authToken) return '';
  try {
    const part = authToken.split('.')[1];
    if (!part) return '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return String(json?.id ?? json?.sub ?? json?.user_id ?? '').trim();
  } catch {
    return '';
  }
}

function deviceTokenKey(authToken?: string): string {
  const sub = jwtSubject(authToken);
  return sub ? `${DEVICE_TOKEN_KEY}:${sub}` : DEVICE_TOKEN_KEY;
}

export function setDeviceSessionToken(token: string, authToken?: string): void {
  try {
    if (token && token.trim()) {
      localStorage.setItem(deviceTokenKey(authToken), token.trim());
    }
  } catch {
    /* ignore */
  }
}

export function clearDeviceSessionToken(authToken?: string): void {
  try {
    localStorage.removeItem(deviceTokenKey(authToken));
    localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getDeviceSessionToken(authToken?: string): string {
  try {
    const key = deviceTokenKey(authToken);
    const own = (localStorage.getItem(key) || '').trim();
    if (own) return own;
    if (key === DEVICE_TOKEN_KEY) return '';
    // Eski yagona kalitdan bir marta ko'chirib olamiz, keyin u ishlatilmaydi.
    const legacy = (localStorage.getItem(DEVICE_TOKEN_KEY) || '').trim();
    if (legacy) localStorage.setItem(key, legacy);
    return legacy;
  } catch {
    return '';
  }
}

export function examAuthHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    // Yangi imtihon start uchun fingerprint kerak; davom etayotganda token ham yuboriladi.
    'X-Device-Fingerprint': getDeviceFingerprint(),
  };
  const deviceToken = getDeviceSessionToken(token);
  if (deviceToken) {
    headers['X-Device-Session-Token'] = deviceToken;
  }
  return headers;
}
