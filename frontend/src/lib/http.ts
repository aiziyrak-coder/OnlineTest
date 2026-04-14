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

/** GET /api/admin/users — { results, total } yoki eski massiv. */
export function parseAdminUsersList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}
