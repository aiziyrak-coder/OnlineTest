import React, { useEffect, useRef, useState } from 'react';

/* Matnni sahifa DOM'iga YOZMASDAN <canvas> ga chizadi.

   Nega: imtihon paytida sahifa matnini o'qiydigan brauzer kengaytmalari va
   AI yordamchilar savol va variantlarni DOM'dan olib, javobni bir necha
   soniyada qaytarardi. Canvas'dagi matn DOM'da yo'q — nusxa olinmaydi va
   kengaytma o'qiy olmaydi.

   Imtihon sahifasida faqat server `secure_text` yoqqan imtihonda ishlatiladi. */

interface Props {
  text: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  lineHeight?: number;
  className?: string;
}

const FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of String(text || '').split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        if (!line && ctx.measureText(word).width > maxWidth) {
          // Juda uzun so'z — harflab bo'linadi.
          let chunk = '';
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        } else {
          line = candidate;
        }
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function SecureText({
  text,
  fontSize = 15,
  fontWeight = 400,
  color = '#111827',
  lineHeight = 1.55,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect?.width || 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || width <= 0) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const font = `${fontWeight} ${fontSize}px ${FONT_FAMILY}`;
    ctx.font = font;
    const lines = wrapLines(ctx, text, width);
    const lh = Math.round(fontSize * lineHeight);
    const height = Math.max(lh, lines.length * lh);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    cv.width = Math.ceil(width * dpr);
    cv.height = Math.ceil(height * dpr);
    cv.style.width = width + 'px';
    cv.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    const pad = Math.max(0, Math.round((lh - fontSize) / 2));
    lines.forEach((ln, i) => ctx.fillText(ln, 0, i * lh + pad));
  }, [text, width, fontSize, fontWeight, color, lineHeight]);

  return (
    <span ref={wrapRef} className={'block w-full ' + className} aria-hidden="true">
      <canvas ref={canvasRef} className="block" />
    </span>
  );
}

export default SecureText;
