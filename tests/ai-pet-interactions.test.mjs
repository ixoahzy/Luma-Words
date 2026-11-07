import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function mountPet({ reduced = false, rendering = false, failFirstHd = false } = {}) {
  let now = 10000, id = 0, chats = 0;
  const timers = new Map(), frames = new Map(), nodes = new Map(), images = [];
  class Element {
    constructor() {
      this.listeners = {}; this.hidden = false; this.textContent = ''; this.style = { setProperty() {} };
      this.dataset = {}; this.scrollHeight = 320;
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    emit(type, data = {}) {
      const event = { type, target: this, preventDefault() {}, stopImmediatePropagation() {}, ...data };
      for (const listener of this.listeners[type] || []) listener(event);
    }
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }
    querySelectorAll() { return []; }
    append() {}
    setAttribute() {}
    contains() { return false; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 176, height: 176 }; }
    setPointerCapture() {}
    hasPointerCapture() { return false; }
    getContext() {
      if (!rendering) return null;
      return { clearRect() {}, drawImage() {}, putImageData() {},
        getImageData(x,y,w,h) { return { data: new Uint8ClampedArray(w*h*4) }; } };
    }
  }
  const root = new Element(), document = new Element(), window = new Element();
  root.querySelector('.ai-panel').hidden = true;
  root.querySelector('.ai-tip').hidden = true;
  root.querySelector('.ai-pet-menu').hidden = true;
  document.hidden = false; document.baseURI = 'https://lesson.test/';
  document.createElement = () => new Element();
  const context = { window, document, innerWidth: 1200, innerHeight: 900, URL,
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    performance: { now: () => now },
    setTimeout(callback, delay) { const key = ++id; timers.set(key, { callback, at: now + delay }); return key; },
    clearTimeout(key) { timers.delete(key); },
    requestAnimationFrame(callback) { const key = ++id; frames.set(key, callback); return key; },
    cancelAnimationFrame(key) { frames.delete(key); },
    MutationObserver: class { observe() {} },
    Image: class {
      constructor() { this.naturalWidth = 0; images.push(this); }
      set src(value) {
        this.url = value;
        if (value.includes('expressions-hd')) { this.onload?.(); return; }
        if (!rendering) return;
        const original = value.includes('spritesheet.webp');
        context.setTimeout(() => {
          if (failFirstHd && value.endsWith('/waiting.png')) { this.onerror?.(); return; }
          this.naturalWidth = original ? 1536 : 1024;
          this.naturalHeight = original ? 2288 : /look-|running-(left|right)|failed/.test(value) ? 2048 : 1536;
          this.onload?.();
        }, original ? 5000 : 1000);
      }
    },
  };
  vm.createContext(context); vm.runInContext(fs.readFileSync('ai-pet.js', 'utf8'), context);
  const api = window.DeskTalkPet.mount(root, { onChatToggle: () => { chats++; } });
  function advance(ms) {
    const end = now + ms;
    for (let safety = 0; safety < 10000; safety++) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].callback();
    }
    now = end;
  }
  const toggle = root.querySelector('.ai-toggle');
  return { root, document, window, api, frames, images, advance, node: key => root.querySelector(key), get chats() { return chats; },
    click(y, detail = 1) { toggle.emit('click', { clientX: 88, clientY: y * 176, detail }); },
    move(x, y) { document.emit('pointermove', { clientX: x, clientY: y, pointerType: 'mouse' }); for (const [key, callback] of [...frames]) { frames.delete(key); callback(now); } },
    drag() { toggle.emit('pointerdown', { button: 0, pointerId: 1, clientX: 80, clientY: 80 }); toggle.emit('pointermove', { pointerId: 1, clientX: 130, clientY: 100 }); toggle.emit('pointerup', { pointerId: 1 }); },
  };
}

test('headpat and cheek poke animate without opening chat; body and keyboard path remain separate', () => {
  const p = mountPet();
  p.click(.16); p.advance(600);
  assert.equal(p.root.dataset.petExpression, 'pat'); assert.equal(p.chats, 0);
  p.click(.4); p.advance(600);
  assert.equal(p.root.dataset.petExpression, 'poke'); assert.equal(p.chats, 0);
  p.click(.8); p.advance(600); assert.equal(p.chats, 1);
});

test('loading the HD menu art does not override live frames or real mouse direction', () => {
  const p = mountPet();
  const initial = p.root.dataset.petFrame;
  p.advance(360); assert.notEqual(p.root.dataset.petFrame, initial);
  p.move(500,88); assert.equal(p.root.dataset.petFrame, '9:4');
  p.move(88,-300); assert.equal(p.root.dataset.petFrame, '9:0');
  p.node('.ai-pet-gaze').checked = false; p.node('.ai-pet-gaze').emit('change');
  p.move(500,88); assert.match(p.root.dataset.petFrame, /^0:/);
  p.click(.16); p.advance(600); const pat = p.root.dataset.petFrame;
  p.advance(360); assert.notEqual(p.root.dataset.petFrame, pat);
});

test('double click cancels a pending body chat and responds; dragging suppresses the following click', () => {
  const p = mountPet();
  p.click(.8); p.advance(350); p.click(.8, 2); p.advance(600);
  assert.equal(p.chats, 0); assert.equal(p.root.dataset.petExpression, 'celebrate');
  p.drag(); p.click(.8); p.advance(600); assert.equal(p.chats, 0);
});

test('real answer events react while chat is closed, and reactions can be disabled independently', () => {
  const p = mountPet();
  p.window.emit('desktalk:answer', { detail: { correct: true } }); p.advance(1);
  assert.equal(p.root.dataset.petExpression, 'celebrate'); assert.equal(p.chats, 0);
  p.window.emit('desktalk:answer', { detail: { correct: false } }); p.advance(1);
  assert.equal(p.root.dataset.petExpression, 'comfort');
  p.node('.ai-pet-reactions').checked = false; p.node('.ai-pet-reactions').emit('change');
  p.advance(3500); p.window.emit('desktalk:answer', { detail: { correct: true } }); p.advance(1);
  assert.notEqual(p.root.dataset.petExpression, 'celebrate');
});

test('wandering defaults off and reduced-motion users never start autonomous movement', () => {
  for (const reduced of [false, true]) {
    const p = mountPet({ reduced }); p.advance(26000); assert.equal(p.frames.size, 0);
    if (reduced) {
      p.node('.ai-pet-wander').checked = true; p.node('.ai-pet-wander').emit('change');
      p.advance(26000); assert.equal(p.frames.size, 0);
      p.click(.16); p.advance(600); assert.equal(p.root.dataset.petMotion, 'still');
    }
  }
});

test('returning from the browser page cache never leaves a cancelled reaction stuck forever', () => {
  const p = mountPet(); p.click(.16); p.advance(600);
  assert.equal(p.root.dataset.petExpression, 'pat');
  p.window.emit('pagehide'); p.window.emit('pageshow'); p.advance(3500);
  assert.notEqual(p.root.dataset.petExpression, 'pat');
});

test('hiding a page cancels pending chat clicks and all walking frames', () => {
  const p = mountPet(); p.click(.8);
  p.document.hidden = true; p.document.emit('visibilitychange'); p.advance(300);
  assert.equal(p.chats, 0); assert.equal(p.frames.size, 0);
});

test('first interaction waits for real HD frames even while the original atlas is still loading', async () => {
  const p = mountPet({ rendering: true });
  p.click(.16); p.advance(200);
  assert.notEqual(p.root.dataset.petExpression, 'pat');
  assert.match(p.node('.ai-pet-label').textContent, /马上动起来/);
  p.advance(1000);
  await new Promise(setImmediate);
  assert.equal(p.images.find(image => image.url.endsWith('spritesheet.webp')).naturalWidth, 0);
  assert.equal(p.root.dataset.petExpression, 'pat');
  assert.equal(p.root.dataset.petQuality, 'hd');
  assert.match(p.root.dataset.petFrame, /^6:/);
});

test('a transient HD image failure retries once and still plays the requested high-resolution action', async () => {
  const p = mountPet({ rendering: true, failFirstHd: true });
  p.click(.16); p.advance(2300);
  await new Promise(setImmediate);
  assert.equal(p.root.dataset.petExpression, 'pat');
  assert.equal(p.root.dataset.petQuality, 'hd');
  assert.ok(p.images.some(image => image.url.includes('/waiting.png?retry=2')));
});
