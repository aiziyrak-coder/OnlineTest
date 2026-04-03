/** Productionda alohida domen: VITE_API_BASE_URL=https://api.example.com */
const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}
