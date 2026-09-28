import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CENTER_IGNORED } from '../src/lib/testCenterPolicy';

test('staffed room ignores ambiguous behaviour but retains physical device and identity protection', () => {
  for (const kind of ['MULTIPLE_FACES', 'GAZE_AWAY_LEFT', 'GAZE_SIDE_TOTAL', 'SIDE_CONVERSATION_SUSPECTED', 'EXCESSIVE_MOVEMENT']) {
    assert.equal(CENTER_IGNORED.has(kind), true);
  }
  for (const kind of ['IDENTITY_SUBSTITUTION', 'FORBIDDEN_OBJECT_CELL_PHONE', 'FACE_NOT_VISIBLE', 'REMOTE_CONTROL_SUSPECTED']) {
    assert.equal(CENTER_IGNORED.has(kind), false);
  }
});

test('browser and server centre policies match exactly', () => {
  const source = readFileSync(new URL('../../backend/apps/api/test_center_policy.py', import.meta.url), 'utf8');
  const block = source.split('CENTER_IGNORED = frozenset({')[1].split('})')[0];
  const names = [...block.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]).sort();
  assert.deepEqual([...CENTER_IGNORED].sort(), names);
});
