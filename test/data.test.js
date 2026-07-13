import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { missions, moodPalettes } from '../src/data.js';

const requiredPaletteKeys = ['skyTop', 'skyMid', 'skyBottom', 'glow', 'far', 'mid', 'memory', 'particle', 'leaf'];

describe('game data', () => {
  it('defines playable delivery missions with valid targets and palette hints', () => {
    assert.ok(missions.length >= 4, 'expected several mission variants');

    for (const mission of missions) {
      assert.equal(typeof mission.title, 'string');
      assert.ok(mission.title.length > 0, 'mission title is required');
      assert.equal(typeof mission.message, 'string');
      assert.ok(mission.message.length > 20, 'mission should include briefing flavor text');
      assert.equal(typeof mission.hazard, 'string');
      assert.ok(mission.hazard.length > 0, 'mission hazard hint is required');
      assert.equal(typeof mission.targetDistance, 'number');
      assert.ok(mission.targetDistance > 0, 'mission target distance must be positive');
      assert.ok(mission.paletteHint in moodPalettes, `${mission.title} references a missing palette`);
    }
  });

  it('defines complete mood palettes for rendering', () => {
    assert.ok(Object.keys(moodPalettes).length >= 5, 'expected multiple mood palettes');

    for (const [name, palette] of Object.entries(moodPalettes)) {
      for (const key of requiredPaletteKeys) {
        assert.equal(typeof palette[key], 'string', `${name}.${key} must be a color string`);
        assert.ok(palette[key].length > 0, `${name}.${key} must not be empty`);
      }
    }
  });
});
