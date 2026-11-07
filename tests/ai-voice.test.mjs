import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function setup(getStream) {
  const streams = [], uploads = [], spoken = [], errors = [], texts = [], states = [], timers = new Map();
  let timerId = 0;
  class Recorder {
    static isTypeSupported(type) { return type.startsWith('audio/webm'); }
    constructor(stream, options) { this.state = 'inactive'; this.mimeType = options.mimeType; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob(['recording'], { type: this.mimeType }) });
      this.onstop();
    }
  }
  const context = {
    window: {}, Blob, AbortController,
    navigator: { mediaDevices: { getUserMedia: getStream || (async () => {
      const track = { stopped: false, stop() { this.stopped = true; } };
      const stream = { getTracks: () => [track] }; streams.push(stream); return stream;
    }) } },
    MediaRecorder: Recorder,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { cancel() {}, getVoices: () => [], speak(utterance) { spoken.push(utterance); } },
    fetch: async (url, options) => { uploads.push({ url, options }); return { ok: true, json: async () => ({ text: 'Hello tutor.' }) }; },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('ai-voice.js', 'utf8'), context);
  const voice = context.DeskTalkVoice.create({ onText: text => texts.push(text), onError: message => errors.push(message), onState: state => states.push(state) });
  return { context, voice, streams, uploads, spoken, errors, texts, states, timers };
}

test('Qwen narration uses the selected role and discards audio returned after stop', async () => {
  const data = setup(); let respond, sent, starts = 0;
  data.context.AudioContext = class {
    constructor() { this.state = 'running'; }
    async resume() {} async decodeAudioData() { return {}; }
    createBufferSource() { return { connect() {}, disconnect() {}, start() { starts++; }, stop() {} }; }
  };
  data.context.fetch = (url, options) => new Promise(resolve => { sent = { url, options }; respond = resolve; });
  data.voice.configure({ backend: 'qwen', speaker: 'Serena', rate: 1.1 });
  const pending = data.voice.speak('Hello. 你好。');
  await new Promise(setImmediate);
  assert.equal(sent.url, '/api/speak');
  const body = JSON.parse(sent.options.body);
  assert.equal(body.backend, 'qwen'); assert.equal(body.speaker, 'Serena'); assert.equal(body.rate, 1.1);
  data.voice.stopSpeaking(); assert.equal(sent.options.signal.aborted, true);
  respond({ ok: true, arrayBuffer: async () => new ArrayBuffer(48) }); await pending;
  assert.equal(starts, 0); assert.equal(data.spoken.length, 0);
});

test('a new narration stops the old audio source; microphone start also stops playback', async () => {
  const data = setup(); let stops = 0, starts = 0;
  data.context.AudioContext = class {
    constructor() { this.state = 'running'; }
    async resume() {} async decodeAudioData() { return {}; }
    createBufferSource() { return { connect() {}, disconnect() {}, start() { starts++; }, stop() { stops++; } }; }
  };
  data.context.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(48) });
  data.voice.configure({ backend: 'qwen', speaker: 'Serena' });
  await data.voice.speak('First.'); await data.voice.speak('Second.');
  assert.equal(starts, 2); assert.equal(stops, 1);
  await data.voice.startRecording('en'); assert.equal(stops, 2);
  data.voice.cancelRecording();
});

test('busy Qwen slot is retried briefly; cancelling that wait prevents a stale retry', async () => {
  const data = setup(); let count = 0;
  data.context.fetch = async () => { count++; return { ok: false, status: 429, json: async () => ({ error: 'busy' }) }; };
  const controller = new AbortController();
  const pending = data.context.DeskTalkVoice.requestSpeech('Hello', { backend: 'qwen' }, controller.signal);
  await new Promise(setImmediate);
  assert.equal(count, 1);
  const [, timer] = [...data.timers.entries()].at(-1); timer.callback();
  await new Promise(setImmediate); assert.equal(count, 2);
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(count, 2);
});

test('recording stops microphone tracks and uploads real audio without sending chat', async () => {
  const data = setup();
  await data.voice.startRecording('en');
  data.voice.stopRecording();
  await new Promise(setImmediate);
  assert.equal(data.streams[0].getTracks()[0].stopped, true);
  assert.deepEqual(data.texts, ['Hello tutor.']);
  assert.equal(data.uploads.length, 1);
  assert.equal(data.uploads[0].url, '/api/transcribe');
  assert.equal(data.uploads[0].options.headers['X-Audio-Language'], 'en');
  assert.equal(data.voice.state, 'idle');
});

test('closing while microphone permission is pending releases the late stream', async () => {
  let resolve;
  const track = { stopped: false, stop() { this.stopped = true; } };
  const data = setup(() => new Promise(done => { resolve = done; }));
  const pending = data.voice.startRecording('auto');
  data.voice.cancelRecording();
  resolve({ getTracks: () => [track] });
  await pending;
  assert.equal(track.stopped, true);
  assert.equal(data.uploads.length, 0);
});

test('microphone denial is surfaced without breaking text chat', async () => {
  const data = setup(async () => { throw { name: 'NotAllowedError' }; });
  await data.voice.startRecording('auto');
  assert.match(data.errors[0], /麦克风/);
  assert.equal(data.voice.state, 'idle');
});

test('mixed-language replies use corresponding voices and cancel old playback', () => {
  const data = setup();
  data.voice.configure({ pause: 0 });
  data.voice.speak('Hello. 你好。');
  const first = data.spoken[0];
  assert.equal(first.lang, 'en-US');
  first.onend();
  assert.equal(data.spoken[1].lang, 'zh-CN');
  data.voice.stopSpeaking();
  const count = data.spoken.length;
  data.spoken[1].onend();
  assert.equal(data.spoken.length, count);
});

test('short embedded acronyms stay with Chinese and long English words are not cut', () => {
  const data = setup();
  const parts = data.context.DeskTalkVoice.splitSpeech('你好，我是 AI 助手。');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, '你好，我是 AI 助手。');
  const long = data.context.DeskTalkVoice.splitSpeech('Learn vocabulary '.repeat(25));
  assert.ok(long.length > 1);
  for (const part of long) assert.match(part.text, /^(Learn|vocabulary)( (Learn|vocabulary))*$/);
});

test('chosen local voices and speed apply to each language with safe fallback', () => {
  const data = setup();
  const voices = [
    { voiceURI: 'novelty', name: 'Bad News', lang: 'en-US', localService: true },
    { voiceURI: 'character', name: 'Eddy (Chinese (China mainland))', lang: 'zh-CN', localService: true },
    { voiceURI: 'en-natural', name: 'Samantha', lang: 'en-US', localService: true },
    { voiceURI: 'zh-natural', name: 'Tingting', lang: 'zh-CN', localService: true },
    { voiceURI: 'remote', name: 'Online', lang: 'en-US', localService: false },
  ];
  data.context.speechSynthesis.getVoices = () => voices;
  data.voice.configure({ enVoice: 'en-natural', zhVoice: 'zh-natural', rate: 1.1, pause: 0 });
  data.voice.speak('Hello. 你好。');
  assert.equal(data.spoken[0].voice.voiceURI, 'en-natural');
  assert.equal(data.spoken[0].rate, 1.1);
  data.spoken[0].onend();
  assert.equal(data.spoken[1].voice.voiceURI, 'zh-natural');
  data.voice.configure({ enVoice: 'removed-voice', rate: 100 });
  data.voice.speak('Hello again.');
  assert.equal(data.spoken.at(-1).voice.voiceURI, 'en-natural');
  assert.equal(data.spoken.at(-1).rate, 1.2);
  data.voice.configure({ zhVoice: 'removed-voice' });
  data.voice.speak('你好。');
  assert.equal(data.spoken.at(-1).voice.voiceURI, 'zh-natural');
  assert.ok(data.voice.getVoices().every(voice => voice.localService));
});

test('sentence pauses can be adjusted and stopping cancels queued speech', () => {
  const data = setup();
  data.voice.configure({ pause: 250 });
  data.voice.speak('Hello. 你好。');
  data.spoken[0].onend();
  assert.equal(data.spoken.length, 1);
  const timer = [...data.timers.values()].find(timer => timer.delay === 250);
  assert.ok(timer);
  data.voice.stopSpeaking();
  assert.equal(data.timers.size, 0);
  timer.callback();
  assert.equal(data.spoken.length, 1);
});
