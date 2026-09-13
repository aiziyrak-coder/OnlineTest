import { desktopServerOrigin } from './desktop';
export type RealtimeMessage = Record<string, unknown> & { type: string };

export type RealtimeSocket = {
  send: (msg: RealtimeMessage) => void;
  destroy: () => void;
};

export function createRealtimeSocket(
  url: string,
  onMessage: (msg: RealtimeMessage) => void,
  opts?: {
    onOpen?: () => void;
    onClose?: () => void;
    onFailed?: () => void;
    maxAttempts?: number;
  },
): RealtimeSocket {
  const maxAttempts = opts?.maxAttempts ?? 12;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function connect() {
    if (destroyed) return;
    ws = new WebSocket(url);

    ws.onopen = () => {
      attempt = 0;
      opts?.onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as RealtimeMessage;
        onMessage(msg);
      } catch {
        // Buzilgan frame — e'tiborsiz
      }
    };

    ws.onclose = (event) => {
      opts?.onClose?.();
      // 4001 = server tomonidan auth xatosi — qayta ulanmaslik
      if (destroyed || event.code === 4001) {
        opts?.onFailed?.();
        return;
      }
      if (attempt >= maxAttempts) {
        opts?.onFailed?.();
        return;
      }
      const delay = Math.min(3000 * 2 ** attempt, 20_000);
      attempt++;
      reconnectTimer = setTimeout(connect, delay);
    };

    ws.onerror = () => {};
  }

  connect();

  return {
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    destroy() {
      destroyed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}

/** Django Channels WebSocket URL ni qurish (dev/prod uchun avtomatik) */
export function buildRealtimeUrl(token: string): string {
  const envUrl = (import.meta.env.VITE_REALTIME_URL as string | undefined)?.trim();
  if (envUrl) {
    return `${envUrl}/ws/realtime/?token=${encodeURIComponent(token)}`;
  }
  // FerMI Exam ilovasi: interfeys fermi://app dan ochiladi — WebSocket to'g'ridan-to'g'ri serverga.
  const desktopOrigin = desktopServerOrigin();
  if (desktopOrigin) {
    return `${desktopOrigin.replace(/^http/, 'ws')}/ws/realtime/?token=${encodeURIComponent(token)}`;
  }
  if (import.meta.env.DEV) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws/realtime/?token=${encodeURIComponent(token)}`;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/realtime/?token=${encodeURIComponent(token)}`;
}
