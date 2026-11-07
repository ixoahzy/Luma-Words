(() => {
  "use strict";
  const topics = [
    ["introduction", "自我介绍"], ["hobbies", "兴趣爱好"], ["weekend", "周末安排"],
    ["food", "点餐"], ["shopping", "购物"], ["directions", "问路"],
    ["hotel", "旅行入住"], ["school-work", "校园或工作交流"]
  ];
  function create({ container, getVoiceSettings = () => ({}), onEnter = () => {}, onExit = () => {}, onState = () => {} }) {
    const view = document.createElement("section");
    view.className = "ai-speaking";
    view.hidden = true;
    view.setAttribute("aria-label", "英语口语练习");
    view.innerHTML = `
      <div class="speaking-heading"><strong>英语口语练习</strong><button type="button" id="speaking-back">返回聊天</button></div>
      <div class="speaking-setup"><label for="speaking-topic">话题</label><select id="speaking-topic">${topics.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>
        <label for="speaking-level">难度</label><select id="speaking-level"><option value="beginner">初级</option><option value="intermediate">中级</option><option value="advanced">高级</option></select>
        <button type="button" id="speaking-call">☎ 开始语音通话</button><button type="button" id="speaking-start">按键练习</button><button type="button" id="speaking-end" disabled>结束练习</button></div>
      <p class="speaking-call-intro">☎ 点击开始通话后直接说英语。说完稍作停顿，AI 会自动接话；无需逐轮录音或发送。</p>
      <small id="speaking-backend"></small>
      <div class="speaking-call-controls"><span class="speaking-call-indicator" aria-hidden="true">🎙</span><span>自动听取 · 停顿后发送</span><button type="button" id="speaking-mute">静音麦克风</button><button type="button" id="speaking-text-toggle">文字补充</button><button type="button" id="speaking-call-replay">🔊 重播</button><button type="button" id="speaking-call-stop">停止语音</button><label><input type="checkbox" id="speaking-interrupt">允许说话打断 AI（建议戴耳机）</label></div>
      <div id="speaking-log" class="ai-messages" role="log" aria-live="polite" aria-label="口语对话记录"></div>
      <p id="speaking-status" class="ai-status" role="status">选择话题和难度，点击开始。</p>
      <p id="speaking-error" class="ai-error" role="alert" hidden></p>
      <div class="speaking-controls"><button type="button" id="speaking-mic">🎙 录音</button><button type="button" id="speaking-stop">停止朗读</button><button type="button" id="speaking-replay">重播</button>
        <label><input id="speaking-auto" type="checkbox" checked>识别后自动发送</label></div>
      <form id="speaking-form" class="ai-form"><label class="ai-sr" for="speaking-input">口语回答或识别结果（可修改）</label><textarea id="speaking-input" rows="2" maxlength="4000" placeholder="英语回答，也可使用设备听写…"></textarea><button id="speaking-send" type="submit">发送</button>
        <small>Enter 发送 · Shift + Enter 换行。关闭自动发送后可修改识别结果。沿用聊天声音设置；录音仅在点击后开启。</small></form>`;
    container.append(view);
    const $ = id => view.querySelector(`#speaking-${id}`);
    const topic = $("topic"), level = $("level"), input = $("input"), log = $("log"), status = $("status"), error = $("error");
    const auto = $("auto"); auto.checked = true;
    let visible = false, running = false, busy = false, speaking = false, recording = "idle";
    let calling = false, muted = false, callState = "off", showCallText = false, manual = false, audioPreparing = false;
    let history = [], lastReply = "", pendingRecognition = false, request = null, generation = 0, temporaryRate = null;
    const voice = window.DeskTalkVoice.create({
      onText(text) {
        if (!visible || !running) return;
        const clean = text.trim();
        if (!clean) return;
        input.value = clean.slice(0, 4000);
        pendingRecognition = true;
      },
      onState(state) {
        recording = state;
        render();
        // The shared recorder calls onText before releasing its upload state.
        // Wait for idle before asking Qwen or starting another audio operation.
        if (state === "idle" && pendingRecognition && visible && running) {
          pendingRecognition = false;
          if (auto.checked) void send(input.value);
          else { status.textContent = "识别完成，可修改文字后发送。"; input.focus(); }
        }
      },
      onSpeechState(value, phase) { if (!calling) { speaking = value; audioPreparing = value && phase === 'preparing'; } render(); },
      onError(message) { if (visible) { error.textContent = message; error.hidden = false; render(); } }
    });
    const call = window.DeskTalkCall?.create({
      onPlaybackState(active, phase) {
        audioPreparing = active && phase === "preparing";
        speaking = active && phase === "playing";
        render();
      },
      isBlocked: () => busy || audioPreparing || (speaking && !$("interrupt").checked),
      isInterrupting: () => speaking,
      onSpeechStart() {
        if (!visible || !running || !calling) return;
        error.hidden = true; stopOutput();
      },
      onText(text) {
        if (!visible || !running || !calling || muted) return;
        input.value = text;
        void send(text);
      },
      onState(state) {
        callState = state;
        if (calling) recording = ["requesting", "recording", "transcribing"].includes(state) ? state : "idle";
        render();
      },
      onError(message) { if (visible && calling) { error.textContent = message; error.hidden = false; render(); } },
      onFatal(message) { if (calling) { stopSession(); error.textContent = message; error.hidden = false; } },
    });
    function render() {
      const sound = getVoiceSettings();
      $("backend").textContent = sound.backend === 'qwen' ? `声音：本地 Qwen3-TTS · ${sound.speaker || 'Serena'}（生成语音需等待数秒）`
        : `声音：${calling || sound.backend === 'system' ? '服务端 macOS' : '当前设备'}系统声音`;
      const locked = busy || recording !== "idle" || audioPreparing;
      view.setAttribute("data-call", String(calling));
      view.setAttribute("data-manual", String(manual));
      view.setAttribute("data-call-state", callState);
      view.setAttribute("data-call-text", String(showCallText));
      $("call").disabled = running || !window.DeskTalkCall;
      $("call").textContent = calling ? "☎ 通话进行中" : "☎ 开始语音通话";
      $("mute").disabled = !calling || ["off", "requesting"].includes(callState);
      $("mute").textContent = muted ? "取消静音" : "静音麦克风";
      $("mute").setAttribute("aria-pressed", String(muted));
      $("call-replay").disabled = !calling || locked || !lastReply;
      $("call-stop").disabled = !calling || (!speaking && !audioPreparing);
      $("end").textContent = calling ? "挂断通话" : "结束练习";
      $("start").disabled = running;
      $("end").disabled = !running;
      topic.disabled = level.disabled = running;
      $("mic").disabled = !running || busy || !voice.canRecord || ["requesting", "transcribing"].includes(recording);
      $("mic").textContent = recording === "recording" ? "■ 结束录音" : "🎙 录音";
      $("mic").setAttribute("aria-pressed", String(recording === "recording"));
      $("stop").disabled = !speaking;
      $("replay").disabled = !running || locked || !lastReply || !voice.canSpeak;
      $("send").disabled = !running || locked;
      input.disabled = !running || locked;
      auto.disabled = recording !== "idle";
      log.setAttribute("aria-busy", String(busy));
      const labels = { requesting: "等待麦克风授权…", recording: "录音中，请用英语回答；点击结束录音（最长 60 秒）。", transcribing: "正在识别英语录音…" };
      status.textContent = labels[recording] || (busy ? "千问正在回应…" : audioPreparing ? "正在生成语音，可点击停止或录音。" : speaking ? "正在朗读，可点击录音开始回答。" : running ? "轮到你了：点击录音，或输入回答。" : "选择话题和难度，点击开始。");
      if (calling) status.textContent = callState === "requesting" ? "正在接通，请允许麦克风…" : recording === "transcribing" ? "正在识别你刚才说的话…" : audioPreparing ? "正在生成语音，马上播放…" : recording === "recording" ? "正在听你说，停顿约 1.3 秒后自动发送…" : busy ? "千问正在回应…" : speaking ? (muted ? "AI 正在说话 · 你的麦克风已静音" : "AI 正在说话…") : muted ? "麦克风已静音，点击取消静音继续。" : "通话中 · 直接说英语即可，不用按录音键。";
      if (running && !calling && !voice.canRecord) status.textContent += " 当前浏览器无法录音，请使用设备听写或文字输入。";
      if (running && !calling && !voice.canSpeak) status.textContent += " 当前浏览器不支持朗读，可阅读对话文字。";
      if (visible) onState({ busy: busy || audioPreparing || recording === "transcribing", waiting: ["requesting", "recording"].includes(recording), speaking, failed: !error.hidden });
    }
    function append(role, text) {
      const bubble = document.createElement("div");
      bubble.className = `ai-message ai-${role}`;
      bubble.textContent = text;
      log.append(bubble); log.scrollTop = log.scrollHeight;
      return bubble;
    }
    function configureVoice() {
      const settings = getVoiceSettings();
      voice.configure({ ...settings, rate: temporaryRate ?? settings.rate });
    }
    view.addEventListener('pointerdown', () => { void voice.unlockAudio?.().catch(() => {}); });
    function stopOutput() { call?.stopPlayback(); voice.stopSpeaking(); }
    function playReply() {
      error.hidden = true;
      if (calling) void call.speak(lastReply, { ...getVoiceSettings(), rate: temporaryRate ?? getVoiceSettings().rate });
      else { configureVoice(); voice.speak(lastReply); }
    }
    function stopSession() {
      running = false; pendingRecognition = false; generation++;
      const old = request; request = null; old?.abort(); busy = false;
      call?.stop(); calling = false; muted = false; callState = "off";
      voice.cancelRecording(); voice.stopSpeaking();
      recording = "idle"; speaking = false; render();
    }
    function open() {
      if (visible) return;
      visible = true; onEnter(); view.hidden = false;
      configureVoice(); render(); topic.focus();
    }
    function close() {
      if (!visible) return;
      stopSession(); visible = false; view.hidden = true; onExit();
    }
    async function send(raw, opening = false) {
      const text = raw.trim();
      if (!visible || !running || busy || recording !== "idle" || !text || text.length > 4000) return;
      error.hidden = true; busy = true; pendingRecognition = false;
      stopOutput();
      if (/\b(speak|talk)\s+(more\s+)?slow(?:ly|er)\b/i.test(text)) {
        temporaryRate = Math.max(0.8, (temporaryRate ?? getVoiceSettings().rate ?? 1) - 0.1);
      }
      let shown;
      if (!opening) { shown = append("user", text); input.value = ""; }
      const context = history.slice(-20);
      while (context.length && context.reduce((sum, item) => sum + item.content.length, 0) > 24000) context.splice(0, 2);
      const messages = [...context, { role: "user", content: text }];
      const ticket = ++generation, controller = new AbortController(); request = controller;
      const timer = setTimeout(() => controller.abort(), 130000); render();
      try {
        const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ kind: "speaking", speaking: { topic: topic.value, level: level.value }, messages }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `口语服务暂不可用（${response.status}）。`);
        if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("千问返回了空回复，请重试。");
        if (ticket !== generation || !running) return;
        history = [...messages, { role: "assistant", content: data.reply }];
        lastReply = data.reply; append("assistant", lastReply);
        busy = false; request = null; render();
        playReply();
      } catch (failure) {
        if (ticket !== generation) return;
        if (shown) shown.className += " ai-failed";
        if (!opening && !input.value) input.value = text;
        error.textContent = failure.name === "AbortError" ? "千问回复超时，请重试。" : failure instanceof TypeError ? "无法连接口语服务，请检查网络。" : failure.message;
        error.hidden = false;
        if (opening) { stopSession(); }
      } finally {
        clearTimeout(timer);
        if (ticket === generation) { busy = false; request = null; render(); }
      }
    }
    async function startCall() {
      if (!visible || running || !call) return;
      stopSession(); history = []; lastReply = ""; temporaryRate = null; showCallText = false; manual = false;
      input.value = ""; log.replaceChildren(); error.hidden = true;
      running = true; calling = true; muted = false;
      const ticket = generation;
      render();
      const ready = await call.start();
      if (ticket !== generation || !running) return;
      if (!ready) { stopSession(); return; }
      void send("Reply only in English. Start our English speaking practice. Please open the selected scenario naturally and ask me one short question.", true);
    }
    $("call").addEventListener("click", () => { void startCall(); });
    $("call-replay").addEventListener("click", () => { if (calling && !busy && recording === "idle" && lastReply) playReply(); });
    $("call-stop").addEventListener("click", stopOutput);
    $("mute").addEventListener("click", () => { if (calling) { muted = !muted; call.setMuted(muted); render(); } });
    $("text-toggle").addEventListener("click", () => { showCallText = !showCallText; render(); if (showCallText) input.focus(); });
    $("start").addEventListener("click", () => {
      if (running) return;
      stopSession(); history = []; lastReply = ""; temporaryRate = null; manual = true;
      input.value = ""; log.replaceChildren(); error.hidden = true; running = true;
      void send("Reply only in English. Start our English speaking practice. Please open the selected scenario naturally and ask me one short question.", true);
    });
    $("end").addEventListener("click", () => { stopSession(); status.textContent = "本次练习已结束，麦克风和播放已关闭。可重新选择话题开始。"; });
    $("back").addEventListener("click", close);
    $("mic").addEventListener("click", () => {
      if (!running || busy) return;
      error.hidden = true;
      if (recording === "recording") voice.stopRecording();
      else if (recording === "idle") {
        // Never overwrite a pending typed/edited answer silently.
        if (input.value.trim()) { error.textContent = "请先发送或清空输入框，再开始录音。"; error.hidden = false; return; }
        pendingRecognition = false; voice.stopSpeaking(); void voice.startRecording("en");
      }
    });
    $("stop").addEventListener("click", () => voice.stopSpeaking());
    $("replay").addEventListener("click", () => { if (running && !busy && recording === "idle" && lastReply) { configureVoice(); voice.speak(lastReply); } });
    $("form").addEventListener("submit", event => { event.preventDefault(); void send(input.value); });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(input.value); }
    });
    window.addEventListener("pagehide", close);
    window.addEventListener("hashchange", close);
    document.addEventListener("visibilitychange", () => { if (document.hidden && visible) { stopSession(); status.textContent = "页面已离开，练习暂停；点击开始重新练习。"; } });
    return { open, close, startCall, get isActive() { return visible; } };
  }
  window.DeskTalkSpeaking = { create };
})();
