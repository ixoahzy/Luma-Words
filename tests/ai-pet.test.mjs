import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const scope = { window: {} };
vm.createContext(scope);
vm.runInContext(fs.readFileSync('ai-pet.js', 'utf8'), scope);
const pet = scope.window.DeskTalkPet;
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

test('head and cheek gestures do not replace the body chat target', () => {
  assert.equal(pet.interactionAt(.5, .16), 'pat');
  assert.equal(pet.interactionAt(.5, .4), 'poke');
  assert.equal(pet.interactionAt(.5, .8), 'chat');
  assert.equal(pet.interactionAt(0, .3), 'chat');
});

test('HD expressions match real learning and voice states', () => {
  assert.equal(pet.expressionFor({ busy: true }), 'thinking');
  assert.equal(pet.expressionFor({ speaking: true }), 'wave');
  assert.equal(pet.expressionFor({ failed: true }), 'comfort');
  assert.equal(pet.expressionFor({}, 'pat'), 'pat');
  assert.equal(pet.expressionFor({}, 'celebrate'), 'celebrate');
  assert.equal(pet.expressionFor({}, null, true), 'sleepy');
});

test('larger avatar stays inside short mobile screens and never has a negative position', () => {
  const size = pet.avatarSize(1.6, 320, 420);
  assert.ok(size.width <= 280 && size.height <= 420 * .46);
  const p = pet.clampPosition(900, 900, size.width, size.height, 320, 420);
  assert.ok(p.x + size.width <= 312 && p.y + size.height <= 412);
  assert.equal(pet.avatarSize(1, 1400, 1000).width, 176);
});

test('gestures retain original multi-frame actions instead of freezing on HD portraits', () => {
  assert.equal(pet.animationFor({}, null, 'wave'), 'waving');
  assert.equal(pet.animationFor({}, null, 'celebrate'), 'jumping');
  assert.equal(pet.animationFor({}, null, 'pat'), 'waiting');
  assert.equal(pet.animationFor({}, 'running-left', 'pat'), 'running-left');
  for (const gesture of ['wave', 'celebrate', 'pat', 'poke', 'comfort', 'thinking']) {
    const state = pet.animationFor({}, null, gesture);
    assert.notEqual(pet.frameAt(state, 0).column, pet.frameAt(state, 360).column);
  }
});

test('actual directional atlas frames survive HD loading and idle blinking still plays', () => {
  const up = pet.lookAt(0,-200), right = pet.lookAt(200,0);
  assert.deepEqual(plain(pet.liveFrame('idle', 500, up)), plain(up));
  assert.deepEqual(plain(pet.liveFrame('idle', 500, right)), plain(right));
  assert.equal(pet.liveFrame('idle', 80, right).row, 0);
  assert.equal(pet.liveFrame('running-left', 200, right).row, 2);
  assert.equal(pet.liveFrame('waving', 200, right).row, 3);
});

test('clarity processing cleans low-alpha noise and green fringes without changing animation geometry', () => {
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 3, 120, 225, 100, 140, 230, 185, 90, 255,
    100, 90, 80, 255, 180, 160, 140, 255, 100, 90, 80, 255,
    100, 90, 80, 255, 100, 90, 80, 255, 100, 90, 80, 255
  ]);
  const result = pet.clarifyFrame(pixels, 3, 3);
  assert.equal(result.length, pixels.length);
  assert.equal(result[3], 0);
  assert.ok(result[5] <= Math.max(result[4], result[6]) + 1);
  assert.equal(result[11], 255);
  assert.equal(result[8], 230); // amber eye palette survives
  assert.equal(result[19], 255);
  const opaque = new Uint8ClampedArray(Array.from({ length: 9 }, () => [100, 90, 80, 255]).flat());
  opaque[16] = 180;
  assert.ok(pet.clarifyFrame(opaque, 3, 3)[16] > 180); // opaque interiors only
  assert.equal(pixels[3], 3); // source atlas remains untouched
});

test('HD sheets keep every existing action frame and all sixteen gaze positions addressable', () => {
  const counts = [6,8,8,4,5,8,6,6,6,8,8];
  let total = 0;
  for (let row = 0; row < counts.length; row++) {
    for (let column = 0; column < counts[row]; column++) {
      const descriptor = pet.hdFrameDescriptor({row,column});
      assert.equal(descriptor.index, column);
      assert.equal(descriptor.columns, 2);
      assert.equal(descriptor.rows, Math.ceil(counts[row] / 2));
      assert.match(descriptor.file, /^assets\/lion\/motion-hd\/[a-z0-9-]+\.png$/);
      total++;
    }
  }
  assert.equal(total, 73);
  assert.equal(pet.hdFrameDescriptor({row:0,column:7}), null);
});

test('standing frame alignment ignores faint alpha noise and leaves jumping trajectories free', () => {
  const rgba = new Uint8ClampedArray(10 * 10 * 4);
  for (const x of [3,4,5]) rgba[(7 * 10 + x) * 4 + 3] = 255;
  rgba[(9 * 10 + 4) * 4 + 3] = 2;
  assert.equal(pet.footBaseline(rgba,10,10), .75);
  assert.equal(pet.hdFrameDescriptor({row:4,column:2}).alignFeet, false);
  assert.equal(pet.hdFrameDescriptor({row:9,column:4}).alignFeet, true);
});
