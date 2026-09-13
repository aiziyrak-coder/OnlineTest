/**
 * Brauzer kengaytmasi va sahifaga begona kod qo'shilishini aniqlash.
 *
 * NIMA UCHUN: 12.09 da talabalar har biri uchun yangi yaratilgan klinik
 * savollarni savoliga 12-20 soniyada 80-90% aniqlik bilan yechdi. Bu sahifa
 * matnini o'qib javob beradigan AI kengaytma/yordamchidan foydalanishga ishora.
 *
 * FAQAT ISHONCHLI BELGILAR (soxta signal bermasligi uchun):
 *  1) sahifa `chrome-extension://` (moz-/safari-) resursini yuklagan —
 *     kengaytma o'z kodini/uslubini sahifaga joylagan;
 *  2) sahifaga AI yordamchi/test yechuvchi nomli maxsus element qo'shilgan.
 * Ilova o'zi bunday element yaratmaydi. Natija — faqat qayd va admin ko'rib
 * chiqadi (jazo emas); talabaga kengaytmani o'chirish so'raladi.
 */

const EXT_URL = /^(chrome|moz|safari-web|ms-browser)-extension:\/\//i;
const AI_NAME =
  /(grammarly|chatgpt|openai|gemini|copilot|monica|sider|merlin|maxai|harpa|perplexity|claude|quillbot|wiseone|glasp|superpower|deepseek|cluely|quizard|brainly|photomath|gauth|studyx|chegg|solvely|answerai|ai-helper|aitopia)/i;

function origin(url: string): string {
  return url.split('/').slice(0, 3).join('/');
}

/** Bitta element begona (kengaytma) belgisimi — sof funksiya, test qilinadi. */
export function describeSuspiciousElement(
  tag: string,
  attrs: Record<string, string>,
): string | null {
  const t = String(tag || '').toLowerCase();
  const src = String(attrs.src || attrs.href || '');
  if (EXT_URL.test(src)) return 'kengaytma elementi: <' + t + '> ' + origin(src);
  const ident = [t, attrs.id || '', attrs.class || '', Object.keys(attrs).join(' ')].join(' ');
  if (t.includes('-') || /\bdata-(gramm|chatgpt|monica|sider|maxai|merlin)/i.test(ident)) {
    const m = ident.match(AI_NAME);
    if (m) return 'begona element: <' + t + '> (' + m[1].toLowerCase() + ')';
  }
  return null;
}

export function startExtensionWatch(report: (detail: string) => void, intervalMs = 30000): () => void {
  const lastSent = new Map<string, number>();
  const emit = (sig: string) => {
    const now = Date.now();
    if (now - (lastSent.get(sig) || 0) < 5 * 60 * 1000) return;
    lastSent.set(sig, now);
    try {
      report(sig.slice(0, 300));
    } catch {
      /* ignore */
    }
  };

  const checkElement = (el: Element) => {
    try {
      const attrs: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
      const sig = describeSuspiciousElement(el.tagName, attrs);
      if (sig) emit(sig);
    } catch {
      /* ignore */
    }
  };

  const scanResources = () => {
    try {
      for (const e of performance.getEntriesByType('resource')) {
        const name = String((e as PerformanceResourceTiming).name || '');
        if (EXT_URL.test(name)) emit('kengaytma resursi: ' + origin(name));
      }
    } catch {
      /* ignore */
    }
  };

  let mo: MutationObserver | null = null;
  try {
    mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) checkElement(n as Element);
        });
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    mo = null;
  }
  try {
    document.querySelectorAll('html > *, body > *').forEach((el) => checkElement(el));
  } catch {
    /* ignore */
  }
  scanResources();
  const iv = window.setInterval(scanResources, intervalMs);
  return () => {
    try {
      mo?.disconnect();
    } catch {
      /* ignore */
    }
    window.clearInterval(iv);
  };
}
