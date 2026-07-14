import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clamp, seededNoise } from '../src/math.js';

describe('math utilities', () => {
  it('clamps values to an inclusive range', () => {
    assert.equal(clamp(-5, 0, 10), 0);
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(15, 0, 10), 10);
  });

  it('generates deterministic normalized seeded noise', () => {
    const first = seededNoise(42);
    const second = seededNoise(42);

    assert.equal(first, second);
    assert.ok(first >= 0, 'noise should not be negative');
    assert.ok(first < 1, 'noise should stay below 1');
    assert.notEqual(first, seededNoise(43), 'different seeds should usually produce different values');
  });
});
