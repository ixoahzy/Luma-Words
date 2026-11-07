(() => {
  "use strict";
  function createDetector() {
    let pre = [], chunks = [], started = false, voiced = 0, quiet = 0, duration = 0, noise = 0.002;
    function reset() { pre = []; chunks = []; started = false; voiced = quiet = duration = 0; }
    function push(samples, rate, interrupting = false) {
      let energy = 0;
      for (const value of samples) energy += value * value;
      const rms = Math.sqrt(energy / samples.length), ms = samples.length / rate * 1000;
      const threshold = Math.max(interrupting ? 0.025 : 0.012, noise * (interrupting ? 5 : 3));
      const loud = rms > threshold;
      if (!started) {
        pre.push(samples); if (pre.length > 6) pre.shift();
        voiced = loud ? voiced + ms : 0;
        if (!loud && rms < threshold) noise = noise * 0.97 + Math.min(rms, 0.02) * 0.03;
        if (voiced < (interrupting ? 450 : 140)) return null;
        started = true; chunks = pre; pre = []; duration = chunks.reduce((sum, item) => sum + item.length / rate * 1000, 0);
        return { type: "start" };
      }
      chunks.push(samples); duration += ms;
      if (loud) { voiced += ms; quiet = 0; } else quiet += ms;
      if (quiet >= 1300 || duration >= 45000) {
        const result = voiced >= 140 ? { type: "end", chunks } : { type: "discard" };
        reset(); return result;
      }
      return null;
    }
    return { push, reset };
  }
  function encodeWav(chunks, inputRate) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0), samples = new Float32Array(length);
    let offset = 0; for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    const rate = 16000, count = Math.floor(length * rate / inputRate), buffer = new ArrayBuffer(44 + count * 2), data = new DataView(buffer);
    const label = (at, value) => { for (let i = 0; i < value.length; i++) data.setUint8(at + i, value.charCodeAt(i)); };
    label(0, "RIFF"); data.setUint32(4, 36 + count * 2, true); label(8, "WAVE"); label(12, "fmt ");
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
    data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
    label(36, "data"); data.setUint32(40, count * 2, true);
    // Average native-rate samples into 16 kHz bins; do not ask Firefox to change the microphone's native rate.
    for (let i = 0; i < count; i++) {
      const from = Math.floor(i * inputRate / rate), to = Math.max(from + 1, Math.floor((i + 1) * inputRate / rate));
      let sum = 0; for (let j = from; j < Math.min(to, length); j++) sum += samples[j];
      const sample = Math.max(-1, Math.min(1, sum / (to - from)));
      data.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }
  function create({ onText = () => {}, onState = () => {}, onSpeechStart = () => {}, onError = () => {}, onFatal = () => {}, onPlaybackState = () => {}, isBlocked = () => false, isInterrupting = () => false } = {}) {
    let session = null, state = "off";
    const setState = value => { state = value; onState(value); };
    function stopPlayback() {
      const playback = session?.playback;
      if (session) session.playback = null;
      if (playback) {
        playback.controller.abort(); clearTimeout(playback.timer);
        if (playback.source) {
          playback.source.onended = null;
          try { playback.source.stop(); } catch (_) { /* Already ended. */ }
          playback.source.disconnect();
        }
      }
      onPlaybackState(false, "idle");
    }
    async function speak(text, options = {}) {
      const current = session;
      if (!current?.context || !current.stream) { onError("通话尚未接通，无法播放声音。"); return; }
      stopPlayback();
      window.DeskTalkVoice.claimSpeech(stopPlayback);
      const playback = { controller: new AbortController() }; current.playback = playback;
      const valid = () => session === current && current.playback === playback;
      playback.timer = setTimeout(() => playback.controller.abort(), 100000);
      onPlaybackState(true, "preparing");
      try {
        const audio = await window.DeskTalkVoice.requestSpeech(text, options, playback.controller.signal);
        if (!valid()) return;
        const buffer = await current.context.decodeAudioData(audio);
        if (!valid()) return;
        if (current.context.state !== "running") throw new Error("浏览器暂停了声音播放，请重新接通通话。");
        playback.source = current.context.createBufferSource(); playback.source.buffer = buffer;
        playback.source.connect(current.context.destination);
        playback.source.onended = () => { if (valid()) { playback.source.disconnect(); current.playback = null; onPlaybackState(false, "idle"); } };
        playback.source.start(); clearTimeout(playback.timer);
        onPlaybackState(true, "playing");
      } catch (error) {
        if (valid()) { stopPlayback(); onError(error.name === "AbortError" ? "语音生成超时，请点击重播。" : error.message || "语音未能播放，请点击重播。"); }
      } finally { clearTimeout(playback.timer); }
    }
    function stop() {
      stopPlayback();
      const old = session; session = null;
      if (old) {
        old.request?.controller.abort(); clearTimeout(old.request?.timer);
        old.stream?.getTracks().forEach(track => track.stop());
        old.source?.disconnect(); old.node?.disconnect();
        if (old.node) { old.node.port.onmessage = null; old.node.port.close(); }
        if (old.context) { old.context.onstatechange = null; void old.context.close().catch(() => {}); }
      }
      setState("off");
    }
    async function transcribe(current, chunks) {
      setState("transcribing");
      const request = { controller: new AbortController() }; current.request = request;
      request.timer = setTimeout(() => request.controller.abort(), 120000);
      try {
        const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav", "X-Audio-Language": "en" },
          signal: request.controller.signal, body: encodeWav(chunks, current.context.sampleRate) });
        const data = await response.json();
        if (session !== current || current.muted || current.request !== request) return;
        if (!response.ok) throw new Error(data.error || "语音识别暂不可用，请再说一次。");
        const text = typeof data.text === "string" ? data.text.trim() : "";
        setState("listening");
        if (text) onText(text.slice(0, 4000)); else onError("没有识别到清晰语音，请再说一次。");
      } catch (error) {
        if (session === current && !current.muted && current.request === request) {
          setState("listening"); onError(error.name === "AbortError" ? "识别超时，请再说一次。" : error instanceof TypeError ? "无法连接识别服务，请检查网络。" : error.message);
        }
      } finally {
        clearTimeout(request.timer);
        if (current.request === request) {
          current.request = null;
          if (session === current && state === "transcribing") setState(current.muted ? "muted" : "listening");
        }
      }
    }
    async function start() {
      if (session) return false;
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio || !window.AudioWorkletNode || !navigator.mediaDevices?.getUserMedia) {
        onError("当前浏览器不支持连续通话。请通过 HTTPS 或本机地址打开，或使用按键练习。"); return false;
      }
      const current = { detector: createDetector(), muted: false, wasBlocked: false, grace: 0 };
      session = current; setState("requesting");
      try {
        current.context = new Audio();
        const resumed = current.context.resume().then(() => null, error => error);
        // Request access immediately during the initiating click, without waiting on module loading.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
        if (session !== current) { stream.getTracks().forEach(track => track.stop()); return false; }
        current.stream = stream;
        const resumeError = await resumed; if (resumeError) throw resumeError;
        if (session !== current) return false;
        if (!current.context.audioWorklet) throw new Error("此浏览器无法持续收音，请使用按键练习。");
        await current.context.audioWorklet.addModule("/ai-call-worklet.js");
        if (session !== current) return false;
        current.source = current.context.createMediaStreamSource(stream);
        current.node = new AudioWorkletNode(current.context, "desktalk-call-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        current.node.port.onmessage = ({ data }) => {
          if (session !== current || current.muted || state === "transcribing") return;
          const rate = current.context.sampleRate;
          if (isBlocked()) { current.detector.reset(); current.wasBlocked = true; if (state !== "listening") setState("listening"); return; }
          if (current.wasBlocked) { current.wasBlocked = false; current.grace = rate * 0.3; }
          if (current.grace > 0) { current.grace -= data.length; return; }
          const event = current.detector.push(data, rate, isInterrupting());
          if (event?.type === "start") { onSpeechStart(); setState("recording"); }
          if (event?.type === "discard") setState("listening");
          if (event?.type === "end") void transcribe(current, event.chunks);
        };
        current.node.onprocessorerror = () => { if (session === current) { stop(); onFatal("收音中断，请重新开始通话。"); } };
        current.source.connect(current.node); current.node.connect(current.context.destination);
        for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => { if (session === current) { stop(); onFatal("麦克风已断开，通话结束。"); } });
        current.context.onstatechange = () => {
          if (session === current && current.context.state === "suspended") { stop(); onFatal("浏览器暂停了音频，通话已结束，请重新开始。"); }
        };
        setState("listening"); return true;
      } catch (error) {
        if (session === current) {
          stop(); onError(error.name === "NotAllowedError" ? "请允许麦克风权限，再开始通话。" : error.name === "NotFoundError" ? "没有找到麦克风。" : error.message || "无法开始语音通话。");
        }
        return false;
      }
    }
    function setMuted(value) {
      if (!session?.stream) return;
      session.muted = Boolean(value); session.detector.reset();
      session.stream.getAudioTracks().forEach(track => { track.enabled = !session.muted; });
      session.request?.controller.abort(); clearTimeout(session.request?.timer); session.request = null;
      setState(session.muted ? "muted" : "listening");
    }
    return { start, stop, setMuted, speak, stopPlayback, get active() { return session !== null; }, get state() { return state; } };
  }
  window.DeskTalkCall = { create, createDetector, encodeWav };
})();
