import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

class Element {
  constructor() { this.hidden = false; this.value = ''; this.listeners = {}; this.children = []; this.classList = { add() {} }; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  emit(name, extra = {}) { for (const callback of this.listeners[name] || []) callback({ target: this, preventDefault() {}, ...extra }); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute() {}
  focus() {}
  contains() { return false; }
}

const quiz = { activity: 'quiz', id: 'quiz:1', title: '选择题', prompt: 'old-quiz', entries: [{ word: 'apple', meaning: '苹果' }] };
const study = { activity: 'study', scope: 'viewport', id: 'study:ielts:1', title: '雅思背词 · List 1', entries: [{ word: 'atmosphere', meaning: '大气' }, { word: 'oxygen', meaning: '氧气' }] };
const tick = () => new Promise(setImmediate);

function setup(hostname = '127.0.0.1') {
  let screen = quiz;
  const nodes = new Map();
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  node('.ai-panel').hidden = true;
  node('.ai-form').querySelector = () => node('send');
  const widget = new Element(); widget.querySelector = node;
  const requests = [], mutations = [], regions = [new Element(), new Element()];
  const events = new Element();
  let firstElement = true, stopped = 0;
  const document = new Element();
  document.body = new Element();
  document.querySelectorAll = () => regions;
  document.createElement = () => { if (firstElement) { firstElement = false; return widget; } return new Element(); };
  document.createTextNode = text => ({ textContent: text });
  const context = {
    window: events, document, location: { protocol: 'http:', hostname },
    localStorage: { getItem: () => null, setItem() {} },
    AbortController, setTimeout, clearTimeout,
    requestAnimationFrame: callback => { queueMicrotask(callback); return 1; },
    MutationObserver: class { constructor(callback) { mutations.push(callback); } observe() {} disconnect() {} },
    fetch: (url, options) => new Promise((resolve, reject) => {
      requests.push({ url, options, reject, resolve: reply => resolve({ ok: true, json: async () => ({ reply }) }) });
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
    }),
  };
  events.LumaWordTutor = { getContext: () => structuredClone(screen) };
  events.LumaVoice = { create: () => ({ canRecord: true, canSpeak: true, configure() {}, getVoices: () => [], stopSpeaking() { stopped++; }, dispose() {}, speak() {} }) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('ai-chat.js', 'utf8'), context);
  node('.ai-toggle').emit('click');
  return {
    node, requests, mutations, get stopped() { return stopped; },
    changeScreen(next = study) { screen = next; events.emit('luma:context'); },
    mutateScreen() { screen = study; for (const callback of mutations) callback([]); },
    send(text) { node('#ai-input').value = text; node('.ai-form').emit('submit'); },
    close() { node('.ai-close').emit('click'); },
    async cleanup() { for (const request of requests) request.reject(Object.assign(new Error(), { name: 'AbortError' })); await tick(); },
  };
}

test('public website shows local-only AI information without contacting a missing backend', async t => {
  const app = setup('ixoahzy.github.io');
  t.after(() => app.cleanup());
  assert.equal(app.node('.ai-panel').hidden, false);
  assert.match(app.node('.ai-messages').textContent, /仅.*本机|本机.*运行/);
  assert.match(app.node('.ai-toggle').textContent, /本机/);
  app.send('hello');
  await tick();
  assert.equal(app.requests.length, 0);
  app.close();
  assert.equal(app.node('.ai-panel').hidden, true);
});

test('switching screens cancels an old pending answer and allows a fresh question', async t => {
  const app = setup();
  t.after(() => app.cleanup());
  app.send('这些词是什么意思？');
  assert.equal(app.requests.length, 1);
  app.changeScreen();
  await tick();
  assert.equal(app.requests[0].options.signal.aborted, true);
  app.send('现在这些词呢？');
  assert.equal(app.requests.length, 2);
  const body = JSON.parse(app.requests[1].options.body);
  assert.equal(body.messages.at(-1).context.activity, 'study');
  assert.equal(body.messages.at(-1).context.entries[0].word, 'atmosphere');
  app.requests[1].resolve('新的背词资料。');
  await tick();
  app.close();
});

test('DOM navigation updates the visible context even without a custom page event', async t => {
  const app = setup();
  t.after(() => app.cleanup());
  assert.ok(app.mutations.length > 0, 'page regions must be observed');
  app.mutateScreen();
  await tick();
  assert.match(app.node('#ai-context-label').textContent, /雅思背词/);
  assert.ok(app.stopped > 0);
  app.close();
});

test('after a completed quiz conversation, the next request captures the new screen', async t => {
  const app = setup();
  t.after(() => app.cleanup());
  app.send('四个选项呢？');
  app.requests[0].resolve('A、B、C、D。');
  await tick();
  app.changeScreen();
  app.send('当前屏幕有什么词？');
  const body = JSON.parse(app.requests[1].options.body);
  assert.equal(body.messages.at(-1).context.activity, 'study');
  assert.deepEqual(body.messages.at(-1).context.entries.map(entry => entry.word), ['atmosphere', 'oxygen']);
  app.requests[1].resolve('atmosphere、oxygen。');
  await tick();
  app.close();
});

test('scrolling a foreground dialog invalidates its previous visible text', async t => {
  const app = setup();
  t.after(() => app.cleanup());
  const page = { activity: 'page', id: 'page:library', title: '单词库', prompt: 'apple 苹果', entries: [] };
  app.changeScreen(page);
  app.send('当前内容？');
  app.changeScreen({ ...page, prompt: 'oxygen 氧气' });
  await tick();
  assert.equal(app.requests[0].options.signal.aborted, true);
  app.close();
});
