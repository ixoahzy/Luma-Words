import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const scope = { window: {} };
vm.createContext(scope);
vm.runInContext(fs.readFileSync('ai-pet.js', 'utf8'), scope);
const pet = scope.window.LumaPet;
const plain = value => JSON.parse(JSON.stringify(value));

test('atlas playback uses actual frame counts and finishes one-shot gestures', () => {
  assert.deepEqual(plain(pet.frameAt('idle', 0)), { row: 0, column: 0, done: false });
  assert.equal(pet.frameAt('idle', 280).column, 1);
  assert.equal(pet.frameAt('idle', 1100).column, 0);
  assert.equal(pet.frameAt('waving', 900).done, true);
  assert.equal(pet.frameAt('jumping', 2000).column, 4);
  assert.equal(pet.frameAt('running-left', 720).column, 0);
});

test('gaze maps all cardinal directions and ignores the central dead zone', () => {
  assert.equal(pet.lookAt(10, 10), null);
  assert.deepEqual(plain(pet.lookAt(0, -100)), { row: 9, column: 0 });
  assert.deepEqual(plain(pet.lookAt(100, 0)), { row: 9, column: 4 });
  assert.deepEqual(plain(pet.lookAt(0, 100)), { row: 10, column: 0 });
  assert.deepEqual(plain(pet.lookAt(-100, 0)), { row: 10, column: 4 });
});

test('drag positions and chat panels stay in the viewport after resizing', () => {
  assert.deepEqual(plain(pet.clampPosition(-20, 900, 120, 150, 800, 600)), { x: 8, y: 442 });
  for (const [width, height, x, y] of [[1200, 800, 1050, 630], [375, 667, 240, 500], [375, 667, 10, 30]]) {
    const result = pet.placePanel({ x, y, width: 112, height: 146 }, { width: Math.min(380, width - 24), height: Math.min(650, height - 110) }, { width, height });
    assert.ok(result.left >= 8 && result.top >= 8);
    assert.ok(result.left + Math.min(380, width - 24) <= width - 8);
    assert.ok(result.top + result.maxHeight <= height - 8);
  }
});

test('real AI states select matching animations while movement remains interactive', () => {
  assert.equal(pet.resolveState({ busy: true }), 'running');
  assert.equal(pet.resolveState({ failed: true }), 'failed');
  assert.equal(pet.resolveState({ unread: true }), 'review');
  assert.equal(pet.resolveState({ waiting: true, failed: true }), 'waiting');
  assert.equal(pet.resolveState({ busy: true }, 'running-left'), 'running-left');
  assert.equal(pet.resolveState({}, null, 'jumping'), 'jumping');
  assert.equal(pet.resolveState({}), 'idle');
});
