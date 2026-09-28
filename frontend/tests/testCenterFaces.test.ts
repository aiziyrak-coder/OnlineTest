import test from 'node:test';
import assert from 'node:assert/strict';
import { CenterObserverTracker, primaryFaceIndex } from '../src/lib/testCenterFaces';
function face(x = 0.5, y = 0.5, h = 0.4, yaw = 0) {
  const f = Array.from({length: 478}, () => ({x, y}));
  f[234] = {x: x - h * 0.35, y}; f[454] = {x: x + h * 0.35, y};
  f[10] = {x, y: y - h / 2}; f[152] = {x, y: y + h / 2};
  f[1] = {x: x + yaw * h, y};
  for (const [iris,a,b,t,d,cx] of [[468,33,133,159,145,x-h*.15],[473,362,263,386,374,x+h*.15]]) {
    f[iris]={x:cx,y}; f[a]={x:cx-h*.08,y}; f[b]={x:cx+h*.08,y};
    f[t]={x:cx,y:y-h*.025}; f[d]={x:cx,y:y+h*.025};
  }
  return f;
}
test('distant classmates never accumulate dwell time', () => {
  const t = new CenterObserverTracker();
  for (let ms = 0; ms <= 12000; ms += 150) assert.equal(t.update([face(), face(.8,.3,.12)], ms), 0);
});
test('near stationary observer needs six continuous seconds', () => {
  const t = new CenterObserverTracker();
  let elapsed = 0;
  for (let ms = 0; ms < 6000; ms += 150) {
    elapsed = t.update([face(), face(.8,.5,.32)], ms);
    assert.ok(elapsed < 6000);
  }
  assert.equal(t.update([face(), face(.8,.5,.32)], 6000), 6000);
});
test('walking across the room does not accumulate stationary dwell time', () => {
  const t = new CenterObserverTracker();
  for (let ms = 0; ms <= 9000; ms += 150) {
    assert.ok(t.update([face(), face(.65 + .00003*ms,.5,.32)], ms) < 6000);
  }
});
test('absence, turned face and stalled camera reset the timer', () => {
  for (const interrupt of ['absence','turned','stall']) {
    const t = new CenterObserverTracker();
    for (let ms=0; ms<=5700; ms+=150) t.update([face(),face(.8,.5,.32)],ms);
    if (interrupt === 'absence') t.update([face()],5850);
    if (interrupt === 'turned') t.update([face(),face(.8,.5,.32,.3)],5850);
    assert.equal(t.update([face(),face(.8,.5,.32)],interrupt === 'stall' ? 7000 : 6000),0);
  }
});
test('detector order does not select a background face as the candidate', () => {
  assert.equal(primaryFaceIndex([face(.8,.2,.1),face()]),1);
});
test('nearby person looking sideways never counts as watching the screen', () => {
  const t = new CenterObserverTracker();
  const observer = face(.8,.5,.32);
  observer[468].x += .025; observer[473].x += .025;
  for (let ms=0; ms<10000; ms+=150) assert.equal(t.update([face(),observer],ms),0);
});
