/** Kamera kadrini OpenAI / API uchun kichik JPEG ga aylantiradi. */
export function compressVideoFrameToJpeg(
  video: HTMLVideoElement,
  quality = 0.55,
  maxW = 320,
  mirror = false,
): string {
  const scale = maxW / (video.videoWidth || maxW);
  const w = Math.round((video.videoWidth || maxW) * Math.min(scale, 1));
  const h = Math.round((video.videoHeight || 240) * Math.min(scale, 1));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}
