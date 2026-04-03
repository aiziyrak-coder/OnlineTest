/** Avoid SyntaxError when the server returns HTML (e.g. SPA fallback) instead of JSON. */
export async function readJsonSafe<T = unknown>(res: Response): Promise<T | null> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
