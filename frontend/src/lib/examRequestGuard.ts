import { examAuthHeaders } from './deviceFingerprint';

function randomNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(sig);
}

async function sha256Hex(message: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return toHex(buf);
}

export async function buildGuardedExamHeaders(params: {
  token: string;
  examId: number;
  studentExamId: number;
  studentId: string;
  seq?: number;
  challengeSeed?: string;
  sessionKey?: string;
  method: string;
  path: string;
}): Promise<Record<string, string>> {
  const base = examAuthHeaders(params.token);
  if (!params.sessionKey) return base;
  if (typeof params.seq === 'number') {
    base['X-Exam-Seq'] = String(params.seq);
    if (params.challengeSeed) {
      base['X-Exam-Challenge'] = await sha256Hex(`${params.challengeSeed}:${params.seq}`);
    }
  }
  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomNonce();
  const msg = `${params.studentExamId}:${params.studentId}:${params.examId}:${ts}:${nonce}:${params.method.toUpperCase()}:${params.path}`;
  const sig = await hmacSha256Hex(params.sessionKey, msg);
  return {
    ...base,
    'X-Exam-Ts': String(ts),
    'X-Exam-Nonce': nonce,
    'X-Exam-Signature': sig,
  };
}
