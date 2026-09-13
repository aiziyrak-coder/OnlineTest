/* FerMI Exam Platform (Windows ilovasi) bilan ishlash.
 *
 * Ilova sahifaga `window.fermiDesktop` ko'prigini beradi (desktop/src/preload.js).
 * Oddiy brauzerda u yo'q — shuning uchun hamma chaqiruv shu yerdan o'tadi. */

export type DesktopApp = {
  name: string;
  cat: 'remote' | 'capture' | 'ai' | 'call' | 'vcam' | 'browser' | string;
  label: string;
};

export type DesktopProblem = {
  code: 'VIRTUAL_MACHINE' | 'REMOTE_SESSION' | 'MULTI_MONITOR' | 'FORBIDDEN_APPS' | string;
  title: string;
  detail: string;
  apps?: DesktopApp[];
};

export type DesktopCheck = {
  ok: boolean;
  problems: DesktopProblem[];
  apps: DesktopApp[];
  displays: number;
  remote: boolean;
  vm: boolean;
  bluetooth?: string[];
};

export type DesktopMonitor = {
  apps: DesktopApp[];
  displays: number;
  remote: boolean;
  /** Ulangan simsiz (Bluetooth) audio qurilmalar nomi. */
  bluetooth?: string[];
};

export type DesktopBridge = {
  isDesktop: true;
  version: string;
  platform: string;
  /** Server manzili (interfeys ilovaning ichidan fermi://app dan ochiladi). */
  serverOrigin?: string;
  systemCheck: () => Promise<DesktopCheck>;
  closeApps: (names: string[]) => Promise<number>;
  setExamMode: (on: boolean) => Promise<boolean>;
  captureScreens: () => Promise<string[]>;
  /** Server /downloads/ manzilini tizim brauzerida ochish. */
  openExternal?: (url: string) => Promise<boolean>;
  /** Oyna yopilmoqchi (X, Alt+F4) — parol oynasini ochish. */
  onExitRequest?: (cb: () => void) => () => void;
  /** Parol tasdiqlangach ilovani yopish. */
  confirmExit?: () => Promise<boolean>;
  /** Ulangan monitorlar soni. */
  getDisplays?: () => Promise<number>;
  /** Monitor ulanib/uzilganda. */
  onDisplays?: (cb: (count: number) => void) => () => void;
  /** Imtihon paytida oyna hodisasi (pastga tushirishga urinish). */
  onWindowEvent?: (cb: (e: { kind?: string; source?: string; at?: number }) => void) => () => void;
  onMonitor: (cb: (report: DesktopMonitor) => void) => () => void;
};

export type DesktopInfo = {
  required: boolean;
  version: string;
  min_version: string;
  download_url: string;
  size_mb: number;
};

export function getDesktop(): DesktopBridge | null {
  const d = (window as unknown as { fermiDesktop?: DesktopBridge }).fermiDesktop;
  return d && d.isDesktop ? d : null;
}

export function isDesktopApp(): boolean {
  return getDesktop() !== null;
}

/** "1.2.10" < "1.10.0" kabi to'g'ri taqqoslash. */
export function versionLess(a: string, b: string): boolean {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

export async function fetchDesktopInfo(apiUrl: (p: string) => string): Promise<DesktopInfo | null> {
  try {
    const res = await fetch(apiUrl('/api/public/desktop-info'), { cache: 'no-store' });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<DesktopInfo>;
    return {
      required: Boolean(j.required),
      version: String(j.version || ''),
      min_version: String(j.min_version || ''),
      download_url: String(j.download_url || ''),
      size_mb: Number(j.size_mb || 0),
    };
  } catch {
    return null;
  }
}

/** Ilovada serverning haqiqiy manzili; brauzerda bo'sh satr. */
export function desktopServerOrigin(): string {
  const d = getDesktop();
  return d && d.serverOrigin ? String(d.serverOrigin).replace(/\/+$/, '') : '';
}
