/* Butun ekranni ulashish (imtihon davomida ekran rasmi — dalil).
 *
 * Brauzer getDisplayMedia() ni FAQAT foydalanuvchi tugma bosganda ruxsat
 * beradi. Shu sabab oqim imtihon oldi tekshiruvida bir marta olinadi va
 * modul darajasida saqlanadi — imtihon oynasi o'sha oqimdan foydalanadi.
 * Sahifa yangilansa oqim yo'qoladi va imtihon oynasi qayta so'raydi. */

export type ScreenShareError = 'NOT_SUPPORTED' | 'DENIED' | 'NOT_MONITOR' | 'FAILED';

let current: MediaStream | null = null;
const endedListeners = new Set<() => void>();
let grabVideo: HTMLVideoElement | null = null;

export function isScreenShareActive(): boolean {
  const t = current?.getVideoTracks()[0];
  return Boolean(t && t.readyState === 'live');
}

/** Talaba ulashishni o'zi to'xtatganda (brauzerning "To'xtatish" tugmasi) chaqiriladi. */
export function onScreenShareEnded(cb: () => void): () => void {
  endedListeners.add(cb);
  return () => {
    endedListeners.delete(cb);
  };
}

export async function requestScreenShare(): Promise<{ ok: boolean; error?: ScreenShareError }> {
  const md = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (c?: unknown) => Promise<MediaStream>;
  };
  if (!md || typeof md.getDisplayMedia !== 'function') return { ok: false, error: 'NOT_SUPPORTED' };
  let stream: MediaStream;
  try {
    stream = await md.getDisplayMedia({
      video: { displaySurface: 'monitor', frameRate: { ideal: 2, max: 5 } },
      audio: false,
      monitorTypeSurfaces: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
    });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    return { ok: false, error: name === 'NotAllowedError' ? 'DENIED' : 'FAILED' };
  }
  const track = stream.getVideoTracks()[0];
  const surface = (track?.getSettings?.() as { displaySurface?: string } | undefined)?.displaySurface;
  // Faqat BUTUN ekran qabul qilinadi: bitta oyna yoki tab ulashilsa, boshqa
  // oynada ochilgan narsa ko'rinmaydi. (displaySurface bermaydigan brauzerda
  // tekshira olmaymiz — rad etmaymiz.)
  if (!track || (surface && surface !== 'monitor')) {
    stream.getTracks().forEach((t) => t.stop());
    return { ok: false, error: 'NOT_MONITOR' };
  }
  stopScreenShare();
  current = stream;
  track.addEventListener('ended', () => {
    if (current !== stream) return;
    current = null;
    endedListeners.forEach((cb) => {
      try {
        cb();
      } catch {
        /* ignore */
      }
    });
  });
  return { ok: true };
}

export function stopScreenShare(): void {
  const s = current;
  current = null;
  s?.getTracks().forEach((t) => t.stop());
  if (grabVideo) grabVideo.srcObject = null;
}

/** Ulashilayotgan ekranning kichraytirilgan JPEG rasmi (data URL) yoki ''. */
export async function captureScreenJpeg(maxW = 1280, quality = 0.5): Promise<string> {
  const s = current;
  if (!s || !isScreenShareActive()) return '';
  if (!grabVideo) {
    grabVideo = document.createElement('video');
    grabVideo.muted = true;
    grabVideo.playsInline = true;
  }
  if (grabVideo.srcObject !== s) grabVideo.srcObject = s;
  try {
    await grabVideo.play();
  } catch {
    /* ignore */
  }
  if (grabVideo.readyState < 2) {
    await new Promise((r) => setTimeout(r, 500));
    if (grabVideo.readyState < 2) return '';
  }
  const vw = grabVideo.videoWidth;
  const vh = grabVideo.videoHeight;
  if (!vw || !vh) return '';
  const scale = Math.min(1, maxW / vw);
  const c = document.createElement('canvas');
  c.width = Math.round(vw * scale);
  c.height = Math.round(vh * scale);
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(grabVideo, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
