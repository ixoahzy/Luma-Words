import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
function setup(getStream) {
  const nodes = [], uploads = [], texts = [], states = [], tracks = [];
  const context = { window: {}, navigator: { mediaDevices: { getUserMedia: getStream || (async () => {
    const track = { enabled: true, stop() { this.stopped = true; }, addEventListener() {} }; tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  }) } }, Blob, AbortController, Float32Array, DataView, ArrayBuffer, setTimeout, clearTimeout,
  AudioContext: class { constructor() { this.state = 'running'; this.sampleRate = 16000; this.audioWorklet = { addModule: async () => {} }; }
    async resume() {} async close() { this.closed = true; } createMediaStreamSource() { return { connect() {}, disconnect() {} }; } },
  AudioWorkletNode: class { constructor() { this.port = { close() {} }; nodes.push(this); } connect() {} disconnect() {} },
  fetch: async (url, options) => { uploads.push({ url, options }); return { ok: true, json: async () => ({ text: 'I enjoy reading.' }) }; } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('ai-voice.js','utf8'), context);
  vm.runInContext(fs.readFileSync('ai-call.js','utf8'), context);
  let blocked = false;
  const call = context.DeskTalkCall.create({ onText: text => texts.push(text), onState: state => states.push(state), isBlocked: () => blocked });
  return { context, call, uploads, texts, states, tracks, nodes, block(value) { blocked = value; },
    feed(amplitude, count) { for (let i = 0; i < count; i++) nodes.at(-1).port.onmessage({ data: new Float32Array(1600).fill(amplitude) }); } };
}
const tick = () => new Promise(setImmediate);
test('hands-free speech ends on silence, uploads real WAV once and listens again without another permission', async t => {
  const a = setup(); t.after(() => a.call.stop()); await a.call.start();
  a.feed(0, 30); assert.equal(a.uploads.length, 0);
  a.feed(.06, 10); a.feed(0, 14); await tick();
  assert.equal(a.uploads.length, 1); assert.equal(a.uploads[0].options.headers['X-Audio-Language'], 'en');
  assert.equal(a.uploads[0].options.headers['Content-Type'], 'audio/wav');
  const bytes = new Uint8Array(await a.uploads[0].options.body.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)), 'RIFF');
  assert.deepEqual(a.texts, ['I enjoy reading.']);
  a.feed(.06,10); a.feed(0,14); await tick();
  assert.equal(a.uploads.length, 2); assert.equal(a.tracks.length, 1);
});
test('AI output is ignored, mute discards partial speech, and hangup releases microphone', async () => {
  const a=setup(); await a.call.start(); a.block(true);
  a.feed(.1,20); a.feed(0,14); await tick(); assert.equal(a.uploads.length,0);
  a.block(false); a.feed(0,5); a.feed(.08,4); a.call.setMuted(true);
  a.feed(0,20); await tick(); assert.equal(a.uploads.length,0); assert.equal(a.tracks[0].enabled,false);
  a.call.setMuted(false); assert.equal(a.tracks[0].enabled,true);
  a.call.stop(); assert.equal(a.tracks[0].stopped,true); assert.equal(a.call.active,false);
});
test('hangup during permission request releases a late microphone stream', async () => {
  let resolve; const a=setup(() => new Promise(done => {resolve=done;}));
  const pending=a.call.start(); a.call.stop(); const track={ stop(){this.stopped=true;} };
  resolve({getTracks:()=>[track],getAudioTracks:()=>[track]}); await pending;
  assert.equal(track.stopped,true); assert.equal(a.call.active,false);
});
test('hangup aborts recognition and suppresses its late result', async () => {
  const a=setup(); let resolve;
  a.context.fetch=(url,options)=>new Promise(done=>{a.uploads.push({options});resolve=done;});
  await a.call.start(); a.feed(.06,10); a.feed(0,14); a.call.stop();
  assert.equal(a.uploads[0].options.signal.aborted,true);
  resolve({ok:true,json:async()=>({text:'late'})}); await tick(); assert.equal(a.texts.length,0);
});
test('mute invalidates recognition even when immediately unmuted', async () => {
  const a=setup(); let resolve;
  a.context.fetch=(url,options)=>new Promise(done=>{a.uploads.push({options});resolve=done;});
  await a.call.start(); a.feed(.06,10); a.feed(0,14);
  a.call.setMuted(true); a.call.setMuted(false);
  resolve({ok:true,json:async()=>({text:'discard muted recording'})}); await tick();
  assert.equal(a.texts.length,0); a.call.stop();
});
test('short yes/no replies survive real 48 kHz worklet frame sizes', () => {
  const a=setup(), detector=a.context.DeskTalkCall.createDetector(), events=[];
  for(let i=0;i<2;i++) { const event=detector.push(new Float32Array(4096).fill(.06),48000); if(event) events.push(event.type); }
  for(let i=0;i<17;i++) { const event=detector.push(new Float32Array(4096),48000); if(event) events.push(event.type); }
  assert.deepEqual(events,['start','end']);
});
test('call speech downloads real audio, decodes it and plays through the unlocked call context', async () => {
  const a=setup(), playback=[]; let ended;
  a.context.AudioContext.prototype.decodeAudioData=async () => ({duration:1});
  a.context.AudioContext.prototype.createBufferSource=()=>({connect(){},disconnect(){},start(){playback.push('start');ended=this.onended;},stop(){playback.push('stop');}});
  a.context.fetch=async (url,options)=>{assert.equal(url,'/api/speak');return {ok:true,arrayBuffer:async()=>new ArrayBuffer(48)};};
  const call=a.context.DeskTalkCall.create({onPlaybackState:(active,phase)=>playback.push(phase)});
  await call.start(); await call.speak('Hello.');
  assert.ok(playback.includes('playing')); assert.ok(playback.includes('start'));
  ended(); assert.equal(playback.at(-1),'idle'); call.stop();
});
test('hangup cancels pending speech synthesis and never plays a late audio response', async () => {
  const a=setup(); let resolve, options;
  a.context.fetch=(url,input)=>new Promise(done=>{resolve=done;options=input;});
  await a.call.start(); const pending=a.call.speak('Hello.'); a.call.stop();
  assert.equal(options.signal.aborted,true);
  resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(48)}); await pending;
});
