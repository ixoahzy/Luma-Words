import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
class Element {
  constructor() { this.listeners = {}; this.children = []; this.value = ''; this.checked = false; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, data = {}) { for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, ...data }); }
  append(node) { this.children.push(node); }
  replaceChildren() { this.children = []; }
  setAttribute() {}
  focus() {}
}
const tick = () => new Promise(setImmediate);
function setup(withCall = false) {
  const nodes = new Map(), requests = [], spoken = [], settings = [], ownership = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const view = new Element(); view.querySelector = node;
  const events = new Element(), document = new Element(); document.createElement = () => view;
  let callbacks, stopped = 0, cancelled = 0;
  const voice = { canRecord: true, canSpeak: true, configure: value => settings.push(value),
    stopSpeaking() { stopped++; callbacks.onSpeechState(false); },
    speak(text) { spoken.push(text); callbacks.onSpeechState(true); },
    cancelRecording() { cancelled++; callbacks.onState('idle'); },
    startRecording(language) { assert.equal(language, 'en'); callbacks.onState('recording'); },
    stopRecording() { callbacks.onState('transcribing'); } };
  events.DeskTalkVoice = { create(options) { callbacks = options; return voice; } };
  const context = { window: events, document, AbortController, setTimeout, clearTimeout,
    fetch(url, options) { return new Promise((resolve, reject) => {
      requests.push({ options, resolve: reply => resolve({ ok: true, json: async () => ({ reply }) }) });
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
    }); } };
  let callCallbacks, callStops = 0, callMuted = false;
  if (withCall) events.DeskTalkCall = { create(options) {
    callCallbacks = options;
    return { async start() { options.onState('requesting'); options.onState('listening'); return true; },
      speak(text, settings) { spoken.push(text); options.onPlaybackState(true, 'playing'); }, stopPlayback() { options.onPlaybackState(false, 'idle'); },
      stop() { callStops++; options.onState('off'); options.onPlaybackState(false, 'idle'); }, setMuted(value) { callMuted=value; options.onState(value ? 'muted' : 'listening'); } };
  } };
  vm.createContext(context); vm.runInContext(fs.readFileSync('ai-speaking.js', 'utf8'), context);
  const app = events.DeskTalkSpeaking.create({ container: new Element(), getVoiceSettings: () => ({ rate: 1.1, enVoice: 'saved' }),
    onEnter: () => ownership.push(true), onExit: () => ownership.push(false) });
  node('#speaking-topic').value = 'introduction'; node('#speaking-level').value = 'beginner';
  app.open();
  return { app, node, requests, spoken, settings, ownership, callbacks, callCallbacks, get callStops() { return callStops; }, get callMuted() { return callMuted; }, get stopped() { return stopped; }, get cancelled() { return cancelled; } };
}
test('independent speaking request and two ASR turns wait for microphone release', async t => {
  const a = setup(); t.after(() => a.app.close());
  a.node('#speaking-start').emit('click');
  let body = JSON.parse(a.requests[0].options.body);
  assert.equal(body.kind, 'speaking'); assert.equal(body.speaking.topic, 'introduction');
  assert.equal(body.messages.length, 1); assert.equal(body.messages[0].context, undefined);
  a.requests[0].resolve('Hi! What do you enjoy doing?'); await tick();
  assert.equal(a.spoken.length, 1);
  for (const text of ['I like reading.', 'I read every weekend.']) {
    a.node('#speaking-mic').emit('click'); a.node('#speaking-mic').emit('click');
    const before = a.requests.length;
    a.callbacks.onText(text); assert.equal(a.requests.length, before);
    a.callbacks.onState('idle'); assert.equal(a.requests.length, before + 1);
    a.requests.at(-1).resolve('That sounds fun! What do you read?'); await tick();
  }
  body = JSON.parse(a.requests.at(-1).options.body);
  assert.equal(body.messages.length, 5); assert.equal(a.spoken.length, 3);
  assert.ok(a.stopped >= 2);
});
test('manual confirmation permits edits, empty text and duplicate sends are blocked', async t => {
  const a = setup(); t.after(() => a.app.close());
  a.node('#speaking-start').emit('click'); a.requests[0].resolve('Hello!'); await tick();
  a.node('#speaking-auto').checked = false;
  a.node('#speaking-mic').emit('click'); a.node('#speaking-mic').emit('click');
  a.callbacks.onText('I like read.'); a.callbacks.onState('idle');
  assert.equal(a.requests.length, 1); assert.equal(a.node('#speaking-input').value, 'I like read.');
  a.node('#speaking-input').value = 'I like reading.'; a.node('#speaking-form').emit('submit');
  a.node('#speaking-form').emit('submit'); assert.equal(a.requests.length, 2);
  assert.equal(JSON.parse(a.requests[1].options.body).messages.at(-1).content, 'I like reading.');
  a.requests[1].resolve('What books do you like?'); await tick();
  a.node('#speaking-input').value = ' '; a.node('#speaking-form').emit('submit');
  assert.equal(a.requests.length, 2);
});
test('end cancels pending reply, releases recording, and ignores late recognition', async () => {
  const a = setup(); a.node('#speaking-start').emit('click');
  a.node('#speaking-end').emit('click');
  assert.equal(a.requests[0].options.signal.aborted, true);
  a.callbacks.onText('late text'); a.callbacks.onState('idle'); await tick();
  assert.equal(a.requests.length, 1); assert.equal(a.spoken.length, 0);
  assert.ok(a.cancelled > 0); a.app.close(); assert.deepEqual(a.ownership, [true, false]);
});
test('empty recognition does not send, slower speech is temporary, replay and stop stay separate', async t => {
  const a = setup(); t.after(() => a.app.close());
  a.node('#speaking-start').emit('click'); a.requests[0].resolve('What do you enjoy?'); await tick();
  a.node('#speaking-mic').emit('click'); a.node('#speaking-mic').emit('click');
  a.callbacks.onText('  '); a.callbacks.onState('idle'); assert.equal(a.requests.length, 1);
  a.node('#speaking-input').value = 'Please speak more slowly.'; a.node('#speaking-form').emit('submit');
  a.requests[1].resolve('Of course. What do you like reading?'); await tick();
  assert.equal(a.settings.at(-1).rate, 1);
  assert.equal(a.settings.at(-1).enVoice, 'saved');
  const count = a.spoken.length;
  a.node('#speaking-stop').emit('click'); a.node('#speaking-replay').emit('click');
  assert.equal(a.spoken.length, count + 1); assert.equal(a.requests.length, 2);
});

test('one call button opens real speaking flow; recognized turns auto-send without record buttons', async t => {
  const a = setup(true); t.after(() => a.app.close());
  a.node('#speaking-auto').checked=false;
  a.node('#speaking-call').emit('click'); await tick();
  assert.equal(a.requests.length,1);
  a.requests[0].resolve('What do you like?'); await tick();
  assert.equal(a.callCallbacks.isBlocked(),true,'speaker output cannot be recorded by default');
  a.callCallbacks.onPlaybackState(false, 'idle');
  a.callCallbacks.onState('recording'); a.callCallbacks.onSpeechStart();
  a.callCallbacks.onState('listening'); a.callCallbacks.onText('I like reading.');
  assert.equal(a.requests.length,2,'call mode always sends recognized speech without a second button');
  a.requests[1].resolve('What do you read?'); await tick();
  a.node('#speaking-mute').emit('click'); assert.equal(a.callMuted,true);
  a.node('#speaking-end').emit('click'); assert.ok(a.callStops>0);
  a.callCallbacks.onText('late'); assert.equal(a.requests.length,2);
});
