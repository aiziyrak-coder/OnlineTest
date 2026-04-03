/**
 * Minimal CI test — integratsion oqim backend/apps/api/tests/test_integration.py da.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('frontend smoke', () => {
  it('runner ishlaydi', () => {
    assert.equal(1 + 1, 2);
  });
});
