/** Conservative shared-room geometry. This detects a sustained nearby observer,
 * not intent to cheat. A missing frame or a passing person resets the timer. */
export type FacePoint = { x: number; y: number };
export const CENTER_OBSERVER_MS = 6000;
type Box = { x: number; y: number; w: number; h: number; frontal: boolean };
function eyesTowardScreen(face: FacePoint[]): boolean {
  // Require both visible irises: a head merely facing the camera is not enough.
  return [[468,33,133,159,145],[473,362,263,386,374]].every(([iris,a,b,t,d]) => {
    const p=face[iris], left=face[a], right=face[b], top=face[t], bottom=face[d];
    if (!p || !left || !right || !top || !bottom) return false;
    const w=Math.abs(right.x-left.x), h=Math.abs(bottom.y-top.y);
    if (w < .008 || h/w < .12) return false;
    const dx=(p.x-(left.x+right.x)/2)/w, dy=(p.y-(top.y+bottom.y)/2)/h;
    return Math.abs(dx) <= .22 && dy >= -.4 && dy <= 1;
  });
}
function box(face: FacePoint[]): Box | null {
  const l = face[234], r = face[454], t = face[10], b = face[152], n = face[1];
  if (!l || !r || !t || !b || !n) return null;
  const w = Math.abs(r.x - l.x), h = Math.abs(b.y - t.y);
  if (w < 0.02 || h < 0.02) return null;
  const x = (l.x + r.x) / 2, y = (t.y + b.y) / 2;
  return { x, y, w, h, frontal: eyesTowardScreen(face) && Math.abs(n.x - x) / w < 0.18 &&
    (n.y - Math.min(t.y, b.y)) / h > 0.28 && (n.y - Math.min(t.y, b.y)) / h < 0.78 };
}
export function primaryFaceIndex(faces: FacePoint[][]): number {
  let best = -1, score = 0;
  faces.forEach((f, i) => {
    const b = box(f);
    if (!b) return;
    const s = b.w * b.h / (1 + 3 * Math.abs(b.x - 0.5));
    if (s > score) { score = s; best = i; }
  });
  return best;
}
export class CenterObserverTracker {
  private anchor: Box | null = null;
  private since = 0;
  private last = 0;
  update(faces: FacePoint[][], now: number): number {
    const pi = primaryFaceIndex(faces);
    const primary = pi < 0 ? null : box(faces[pi]);
    const candidates = primary ? faces.map(box).filter((b, i): b is Box =>
      i !== pi && b !== null && b.frontal && b.h >= 0.18 &&
      b.h >= primary.h * 0.7 && Math.abs(b.x - primary.x) <= 0.48 &&
      Math.abs(b.y - primary.y) <= primary.h * 0.75) : [];
    // Multiple nearby observers are ambiguous: never merge their dwell times.
    if (candidates.length !== 1) { this.anchor = null; this.last = now; return 0; }
    const b = candidates[0];
    if (!this.anchor || now - this.last > 700 || now < this.last ||
        Math.hypot(b.x - this.anchor.x, b.y - this.anchor.y) > 0.045 ||
        Math.abs(b.h - this.anchor.h) > this.anchor.h * 0.2) {
      this.anchor = b; this.since = now;
    }
    this.last = now;
    return now - this.since;
  }
}
