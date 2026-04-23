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

export function examAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-Device-Fingerprint': getDeviceFingerprint(),
  };
}
