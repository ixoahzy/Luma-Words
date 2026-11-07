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

function setup(hostname = '127.0.0.1', { open = true, remote = false, speakingMode = false } = {}) {
  let screen = quiz;
  const nodes = new Map();
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  node('.ai-panel').hidden = true;
  node('.ai-error').hidden = true;
  node('#ai-tip').hidden = true;
  node('.ai-form').querySelector = () => node('send');
  const widget = new Element(); widget.querySelector = node;
  const requests = [], mutations = [], spoken = [], regions = [new Element(), new Element()];
  const events = new Element();
  let firstElement = true, stopped = 0;
  const document = new Element();
  document.body = new Element();
  document.querySelectorAll = () => regions;
  document.createElement = () => { if (firstElement) { firstElement = false; return widget; } return new Element(); };
  document.createTextNode = text => ({ textContent: text });
  const context = {
    window: events, document, location: { protocol: remote ? 'https:' : 'http:', hostname },
    localStorage: { getItem: () => null, setItem() {} },
    AbortController, setTimeout, clearTimeout,
    requestAnimationFrame: callback => { queueMicrotask(callback); return 1; },
    MutationObserver: class { constructor(callback) { mutations.push(callback); } observe() {} disconnect() {} },
    fetch: (url, options) => url === '/api/voices' ? Promise.resolve({ ok: true, json: async () => ({ defaultBackend: 'qwen', qwenAvailable: true, systemVoices: [] }) }) : new Promise((resolve, reject) => {
      requests.push({ url, options, reject, resolve: reply => resolve({ ok: true, json: async () => ({ reply }) }) });
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
    }),
  };
  events.DeskTalkTutor = { getContext: () => structuredClone(screen) };
  if (remote) events.DeskTalkRemote = { enabled: true };
  events.DeskTalkVoice = { create: () => ({ canRecord: true, canSpeak: true, configure() {}, getVoices: () => [], cancelRecording() {}, stopSpeaking() { stopped++; }, dispose() {}, speak(text) { spoken.push(text); } }) };
  let speakingOptions;
  if (speakingMode) events.DeskTalkSpeaking = { create(options) {
    speakingOptions = options;
    return { isActive: false, open() { this.isActive = true; options.onEnter(); }, close() { this.isActive = false; options.onExit(); } };
  } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('ai-chat.js', 'utf8'), context);
  if (open) node('.ai-toggle').emit('click');
  return {
    node, requests, mutations, spoken, get speakingOptions() { return speakingOptions; }, get stopped() { return stopped; },
    changeScreen(next = study) { screen = next; events.emit('desktalk:context'); },
    mutateScreen() { screen = study; for (const callback of mutations) callback([]); },
    send(text) { node('#ai-input').value = text; node('.ai-form').emit('submit'); },
    close() { node('.ai-close').emit('click'); },
    open() { node('.ai-toggle').emit('click'); },
    answer(correct = false, context = quiz) { events.emit('desktalk:answer', { detail: { correct, context } }); },
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

test('authenticated remote runtime enables real chat routes on a public hostname', async t => {
  const app = setup('lesson.trycloudflare.com', { remote: true });
  t.after(() => app.cleanup());
  app.send('Hello from another computer.');
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, '/api/chat');
  app.requests[0].resolve('Remote response.');
  await tick();
  assert.ok(app.node('.ai-messages').children.length > 0);
});

test('a wrong answer generates a compact spoken tip without ever opening chat', async t => {
  const app = setup('127.0.0.1', { open: false });
  t.after(() => app.cleanup());
  app.answer(true);
  assert.equal(app.requests.length, 0);
  app.answer(false);
  assert.equal(app.requests.length, 1);
  assert.equal(JSON.parse(app.requests[0].options.body).kind, 'tip');
  app.answer(false);
  assert.equal(app.requests.length, 1, 'the same mistake is not requested twice');
  app.requests[0].resolve('apple 是苹果。记住 an apple a day。');
  await tick();
  assert.equal(app.node('.ai-panel').hidden, true);
  assert.equal(app.node('#ai-tip').hidden, false);
  assert.match(app.node('#ai-tip-text').textContent, /apple 是苹果/);
  assert.match(app.node('#ai-tip-source').textContent, /old-quiz/);
  assert.deepEqual(app.spoken, ['apple 是苹果。记住 an apple a day。']);
  app.open();
  assert.equal(app.node('#ai-tip').hidden, true);
  assert.ok(app.node('.ai-messages').children.length > 0, 'full explanation remains in chat history');
});

test('closing the panel does not cancel an automatic explanation', async t => {
  const app = setup();
  t.after(() => app.cleanup());
  app.answer(false);
  assert.equal(app.requests.length, 1);
  app.close();
  assert.equal(app.requests[0].options.signal.aborted, false);
  app.requests[0].resolve('刚才那题的小技巧。');
  await tick();
  assert.equal(app.node('.ai-panel').hidden, true);
  assert.equal(app.node('#ai-tip-text').textContent, '刚才那题的小技巧。');
});

test('pausing proactive tips stops requests and re-enabling restores them', async t => {
  const app = setup('127.0.0.1', { open: false });
  t.after(() => app.cleanup());
  app.answer(false);
  assert.equal(app.requests.length, 1);
  app.node('#ai-tip-pause').emit('click');
  await tick();
  assert.equal(app.requests[0].options.signal.aborted, true);
  app.answer(false, { ...quiz, id: 'quiz:2' });
  assert.equal(app.requests.length, 1);
  app.node('#ai-proactive').checked = true;
  app.node('#ai-proactive').emit('change');
  app.answer(false, { ...quiz, id: 'quiz:3' });
  assert.equal(app.requests.length, 2);
});

test('a muted automatic explanation remains readable without playing audio', async t => {
  const app = setup('127.0.0.1', { open: false });
  t.after(() => app.cleanup());
  app.node('#ai-auto-speak').checked = false;
  app.node('#ai-auto-speak').emit('change');
  app.answer(false);
  app.requests[0].resolve('不朗读时仍可查看的解释。');
  await tick();
  assert.equal(app.node('#ai-tip-text').textContent, '不朗读时仍可查看的解释。');
  assert.deepEqual(app.spoken, []);
});

test('queued mistakes continue sequentially while chat stays closed', async t => {
  const app = setup('127.0.0.1', { open: false });
  t.after(() => app.cleanup());
  app.answer(false);
  app.answer(false, { ...quiz, id: 'quiz:queued', prompt: 'second-mistake' });
  assert.equal(app.requests.length, 1);
  app.requests[0].resolve('第一题的解释。');
  await tick();
  assert.equal(app.requests.length, 2);
  assert.equal(JSON.parse(app.requests[1].options.body).messages.at(-1).context.prompt, 'second-mistake');
  app.requests[1].resolve('第二题的解释。');
  await tick();
  assert.equal(app.node('.ai-panel').hidden, true);
  assert.equal(app.node('#ai-tip-text').textContent, '第二题的解释。');
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


test('speaking view suppresses page tips and cancels chat without changing proactive preferences', async t => {
  const app = setup('127.0.0.1', { speakingMode: true }); t.after(() => app.cleanup());
  app.send('Help me.');
  app.node('#ai-speaking-entry').emit('click'); await tick();
  assert.equal(app.requests[0].options.signal.aborted, true);
  const stopped = app.stopped;
  app.changeScreen(); app.answer(false);
  assert.equal(app.requests.length, 1);
  assert.equal(app.stopped, stopped, 'page recognition must not interrupt speaking audio');
  assert.equal(app.node('#ai-proactive').checked, true);
  app.close(); app.answer(false);
  assert.equal(app.requests.length, 2, 'proactive tips resume after leaving speaking');
});
