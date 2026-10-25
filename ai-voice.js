(() => {
  "use strict";
  function splitSpeech(text) {
    const clean = text.replace(/```[\s\S]*?```/g, " ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/[*_`~]/g, "");
    const parts = [];
    let buffer = "", language = "en-US";
    function flush() {
      if (/[A-Za-z\u3400-\u9fff]/.test(buffer)) parts.push({ text: buffer.trim(), lang: language });
      buffer = "";
    }
    const tokens = clean.match(/[A-Za-z\u00c0-\u024f]+(?:['’-][A-Za-z\u00c0-\u024f]+)*|[\u3400-\u9fff]+|[^A-Za-z\u00c0-\u024f\u3400-\u9fff]+/g) || [];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const nearby = direction => {
        for (let i = index + direction; i >= 0 && i < tokens.length; i += direction) {
          if (/^\s+$/.test(tokens[i])) continue;
          return /^[\u3400-\u9fff]/.test(tokens[i]);
        }
        return false;
      };
      const embeddedAcronym = /^[A-Z]{1,4}$/.test(token) && nearby(-1) && nearby(1);
      const next = /^[\u3400-\u9fff]/.test(token) || embeddedAcronym ? "zh-CN" : /^[A-Za-z\u00c0-\u024f]/.test(token) ? "en-US" : language;
      if (next !== language) { flush(); language = next; }
      // Split English only between tokens; punctuation stays with the preceding phrase.
      if (buffer.length >= 180 && /^[A-Za-z\u00c0-\u024f]/.test(token)) flush();
      for (const char of token) {
        buffer += char;
        if (/[。！？!?;；\n]/.test(char) || (buffer.length >= 180 && /[\s，、]/.test(char))) flush();
      }
    }
    flush();
    return parts;
  }

  function create({ onText = () => {}, onState = () => {}, onError = () => {}, onSpeechState = () => {} } = {}) {
    let state = "idle", recording = null, speechTicket = 0, utterance = null, speechTimer;
    let speechOptions = { zhVoice: "", enVoice: "", rate: 1, pause: 120 };
    const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    const canSpeak = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
    function setState(value) { state = value; onState(value); }
    function stopTracks(stream) { stream?.getTracks().forEach(track => track.stop()); }
    function stopSpeaking() {
      speechTicket++;
      clearTimeout(speechTimer);
      if (canSpeak) speechSynthesis.cancel();
      utterance = null;
      onSpeechState(false);
    }
    function configure(options = {}) {
      stopSpeaking();
      const numeric = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
      speechOptions = {
        zhVoice: typeof options.zhVoice === "string" ? options.zhVoice : speechOptions.zhVoice,
        enVoice: typeof options.enVoice === "string" ? options.enVoice : speechOptions.enVoice,
        rate: numeric(options.rate, speechOptions.rate, 0.8, 1.2),
        pause: numeric(options.pause, speechOptions.pause, 0, 400),
      };
    }
    function getVoices() {
      if (!canSpeak) return [];
      const novelty = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Junior|Organ|Trinoids|Whisper|Wobble|Zarvox)(?:$| \()/i;
      return speechSynthesis.getVoices().filter(item => item.localService && /^(zh|en)[-_]/i.test(item.lang) && !novelty.test(item.name))
        .sort((a, b) => {
          const rank = item => {
            if (/^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Fred|Kathy|Ralph|Superstar)(?:$| \()/i.test(item.name)) return -1;
            return /premium|enhanced|siri|高质量|增强|优质/i.test(item.name) ? 2 : item.default ? 1 : 0;
          };
          return rank(b) - rank(a) || a.name.localeCompare(b.name);
        });
    }
    function cancelRecording() {
      const session = recording;
      recording = null;
      if (session) {
        clearTimeout(session.timer);
        clearTimeout(session.requestTimer);
        session.controller?.abort();
        if (session.recorder?.state === "recording") session.recorder.stop();
        stopTracks(session.stream);
      }
      setState("idle");
    }
    async function upload(session) {
      stopTracks(session.stream);
      clearTimeout(session.timer);
      if (recording !== session) return;
      setState("transcribing");
      try {
        const audio = new Blob(session.chunks, { type: session.recorder.mimeType || "audio/webm" });
        if (!audio.size) throw new Error("没有收到录音，请重新录制。");
        session.controller = new AbortController();
        session.requestTimer = setTimeout(() => session.controller.abort(), 120000);
        const response = await fetch("/api/transcribe", {
          method: "POST", headers: { "Content-Type": audio.type, "X-Audio-Language": session.language },
          body: audio, signal: session.controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "本地语音识别服务不可用。");
        if (typeof data.text !== "string" || !data.text.trim()) throw new Error("没有识别到清晰的语音，请重试。");
        if (recording === session) onText(data.text.trim());
      } catch (error) {
        if (recording === session) onError(error.name === "AbortError" ? "语音识别超时，请重试。" : error instanceof TypeError ? "无法连接本地语音服务，请检查服务是否运行。" : error.message);
      } finally {
        clearTimeout(session.requestTimer);
        if (recording === session) { recording = null; setState("idle"); }
      }
    }
    async function startRecording(language = "auto") {
      if (state !== "idle") return;
      if (!canRecord) { onError("此浏览器无法录音，请允许麦克风并通过本地网站地址打开页面。"); return; }
      stopSpeaking();
      const session = { language, chunks: [] };
      recording = session;
      setState("requesting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        if (recording !== session) { stopTracks(stream); return; }
        session.stream = stream;
        const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
        session.recorder = recorder;
        recorder.ondataavailable = event => { if (recording === session && event.data.size) session.chunks.push(event.data); };
        recorder.onstop = () => { void upload(session); };
        recorder.onerror = () => { if (recording === session) { cancelRecording(); onError("录音中断，请检查麦克风后重试。"); } };
        recorder.start();
        setState("recording");
        session.timer = setTimeout(stopRecording, 60000);
      } catch (error) {
        if (recording !== session) return;
        cancelRecording();
        const messages = {
          NotAllowedError: "麦克风权限未开启，请在 Zen 地址栏和 macOS 隐私设置中允许麦克风。",
          NotFoundError: "没有找到麦克风，请连接或启用麦克风。",
          NotReadableError: "麦克风无法使用，可能正被其他程序占用。"
        };
        onError(messages[error.name] || "无法开始录音，请检查麦克风权限。");
      }
    }
    function stopRecording() {
      if (recording?.recorder?.state === "recording") recording.recorder.stop();
    }
    function speak(text) {
      if (!canSpeak) { onError("此浏览器暂时无法朗读，文字回复仍可使用。"); return; }
      if (state !== "idle") { onError("请先结束录音并等待识别完成，再播放声音。"); return; }
      stopSpeaking();
      const ticket = speechTicket, parts = splitSpeech(text);
      let index = 0;
      function next() {
        if (ticket !== speechTicket) return;
        if (index >= parts.length) { utterance = null; onSpeechState(false); return; }
        const part = parts[index++];
        utterance = new SpeechSynthesisUtterance(part.text);
        utterance.lang = part.lang;
        utterance.rate = speechOptions.rate;
        const voices = getVoices();
        const prefix = part.lang.slice(0, 2);
        const preferred = prefix === "zh" ? speechOptions.zhVoice : speechOptions.enVoice;
        const compatible = voices.filter(item => item.lang.startsWith(prefix));
        const voice = compatible.find(item => item.voiceURI === preferred)
          || compatible.find(item => item.lang.replace("_", "-") === part.lang)
          || compatible[0];
        if (voice) { utterance.voice = voice; utterance.lang = voice.lang.replace("_", "-"); }
        utterance.onend = () => {
          if (ticket !== speechTicket) return;
          if (index < parts.length && speechOptions.pause && /[。！？.!?;；]\s*$/.test(part.text)) {
            speechTimer = setTimeout(next, speechOptions.pause);
          } else next();
        };
        utterance.onerror = event => {
          if (ticket !== speechTicket) return;
          stopSpeaking();
          if (!["canceled", "interrupted"].includes(event.error)) onError("朗读未能播放，请点击回复下方的‘朗读’按钮重试。");
        };
        try { onSpeechState(true); speechSynthesis.speak(utterance); }
        catch (_) { stopSpeaking(); onError("声音播放失败，请点击‘朗读’重试。"); }
      }
      next();
    }
    return { canRecord, canSpeak, get state() { return state; }, configure, getVoices, startRecording, stopRecording, cancelRecording, speak, stopSpeaking,
      dispose() { cancelRecording(); stopSpeaking(); } };
  }
  window.LumaVoice = { create, splitSpeech };
})();
