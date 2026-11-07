(() => {
  "use strict";
  const SETTINGS_KEY = "lumaWords.aiTutor.settings.v1";
  const presets = {
    gentle: "你是一位温柔耐心的英语学习伙伴。先用一句自然的话回应用户，再给简明讲解。默认用简体中文解释，配一两个短英文例句；纠错时具体指出区别并给记忆技巧，不责备、不机械夸奖，不反复自我介绍。",
    lively: "你是一位开朗、有活力的英语陪练。用自然亲切的语气鼓励用户，适度幽默。默认中文讲解配短英文例句，重点清楚，少说套话，避免连续使用表情符号。",
    focused: "你是一位亲切、清晰而高效的英语老师。先讲结论，再解释词义或拼写差别，最后给一个实用英文例句。默认中文，回答精简，避免寒暄和过度夸奖。"
  };
  let preferences = { style: "gentle", personality: presets.gentle };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (saved && typeof saved.personality === "string" && saved.personality.length <= 2000) {
      preferences = { style: Object.hasOwn(presets, saved.style) ? saved.style : "custom", personality: saved.personality };
    }
  } catch (_) { /* Browser storage may be unavailable. Keep usable defaults. */ }
  const widget = document.createElement("div");
  widget.id = "desktalk-ai";
  const localBackend = (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) && /^https?:$/.test(location.protocol)) || window.DeskTalkRemote?.enabled === true;
  if (!localBackend) {
    widget.innerHTML = `
      <section class="ai-panel" id="ai-panel" role="dialog" aria-labelledby="ai-title" hidden>
        <header class="ai-header"><div><strong id="ai-title">lion · AI 助手 · 本机功能</strong><small>DeskTalk 公开学习版</small></div><button class="ai-close" type="button" aria-label="关闭 AI 助手">×</button></header>
        <div class="ai-messages ai-local-only" role="status"></div>
      </section>
      <button class="ai-toggle" type="button" aria-expanded="false" aria-controls="ai-panel"></button>`;
    document.body.append(widget);
    const panel = widget.querySelector(".ai-panel"), toggle = widget.querySelector(".ai-toggle"), close = widget.querySelector(".ai-close");
    toggle.textContent = "✦ AI 助手 · 本机功能";
    widget.querySelector(".ai-messages").textContent = "AI 助手目前仅在站长本机运行，公开版暂未启用在线聊天。\n\n你可以正常使用选择题、分类背单词、默写和错题本，无需安装任何软件。学习记录保存在你自己的浏览器中。";
    function setOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      (open ? close : toggle).focus();
    }
    toggle.addEventListener("click", () => setOpen(panel.hidden));
    close.addEventListener("click", () => setOpen(false));
    widget.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") setOpen(false); });
    window.DeskTalkPet?.mount(widget, { onChatToggle: () => setOpen(panel.hidden) });
    return;
  }
  widget.innerHTML = `
    <section class="ai-panel" id="ai-panel" role="dialog" aria-labelledby="ai-title" hidden>
      <header class="ai-header"><div><strong id="ai-title">lion · AI 助手</strong><small>DeskTalk · 认识你正在学的内容</small></div><button class="ai-close" type="button" aria-label="关闭 AI 助手">×</button></header>
      <div class="ai-speaking-entries"><button type="button" id="ai-speaking-entry">🎙 英语口语练习</button><button type="button" id="ai-call-entry">☎ 语音通话</button></div>
      <details class="ai-settings"><summary>个性设置</summary>
        <label for="ai-style">陪练风格</label><select id="ai-style"><option value="gentle">温柔陪伴</option><option value="lively">活力伙伴</option><option value="focused">简洁老师</option><option value="custom">自定义</option></select>
        <label for="ai-personality">个性提示词（可自由编辑）</label><textarea id="ai-personality" rows="4" maxlength="2000"></textarea>
        <div class="ai-settings-actions"><button type="button" id="ai-save">保存设置</button><button type="button" id="ai-reset">恢复默认</button></div><small id="ai-settings-note" role="status">仅保存在当前浏览器，保存后下次回复生效。</small>
      </details>
      <div class="ai-context" aria-live="polite"><span id="ai-context-label"></span><button type="button" id="ai-explain">讲解当前题</button></div>
      <div class="ai-messages" role="log" aria-live="polite" aria-label="聊天记录"><div class="ai-message ai-assistant">Hi! 可以直接问我“这些词是什么意思”。选择题按选项讲解，背词页按当前屏幕可见的全部单词顺序讲解。答错后即使收起窗口，lion也会给出小提示；点击蓝色单词可以单独讲解。</div></div>
      <p class="ai-status" role="status" hidden>千问正在思考…</p>
      <p class="ai-error" role="alert" hidden></p>
      <div class="ai-voice-controls">
        <button type="button" id="ai-mic">🎙 语音输入</button>
        <label class="ai-sr" for="ai-voice-language">语音识别语言</label><select id="ai-voice-language" title="语音识别语言"><option value="auto">自动识别</option><option value="zh">中文</option><option value="en">English</option></select>
        <label class="ai-voice-auto"><input type="checkbox" id="ai-auto-speak" checked>自动朗读</label>
        <label class="ai-voice-auto"><input type="checkbox" id="ai-proactive" checked>主动讲解</label>
        <button type="button" id="ai-stop-speaking" disabled>停止朗读</button>
      </div>
      <details class="ai-settings ai-speech-settings"><summary>声音设置 · 音色与试听</summary>
        <label for="ai-speech-backend">语音后端</label><select id="ai-speech-backend"><option value="qwen">本地 Qwen3-TTS · 角色音色</option><option value="system">系统声音 · 服务端 macOS</option><option value="browser">系统声音 · 当前设备</option></select>
        <label for="ai-qwen-speaker">角色音色（中英文共用）</label><select id="ai-qwen-speaker">${['Serena', 'Vivian', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'].map(name => `<option value="${name}">${name}</option>`).join('')}</select>
        <small id="ai-backend-status" role="status"></small>
        <div class="ai-voice-picker"><button type="button" id="ai-preview-zh">试听中文</button><button type="button" id="ai-preview-en">试听英文</button></div>
        <div id="ai-system-voices"><label for="ai-zh-voice">中文声音</label><select id="ai-zh-voice"></select>
        <label for="ai-en-voice">English voice</label><select id="ai-en-voice"></select></div>
        <label for="ai-speech-rate">语速 <output id="ai-speech-rate-value">1.00×</output></label><input id="ai-speech-rate" type="range" min="0.8" max="1.2" step="0.05" value="1">
        <label for="ai-speech-pause">句间停顿</label><select id="ai-speech-pause"><option value="0">连贯 · 不额外停顿</option><option value="120">自然 · 轻微停顿</option><option value="300">舒缓 · 较长停顿</option></select>
        <small>自动保存。Qwen 角色音色中英文一致，停顿由模型自然生成；下方中英文系统音色与句间停顿仅在系统声音模式使用。Qwen 实测短句约需 4–9 秒，通话仍有等待。</small>
      </details>
      <p id="ai-voice-status" role="status" hidden></p>
      <form class="ai-form"><label class="ai-sr" for="ai-input">输入消息</label><textarea id="ai-input" rows="2" maxlength="4000" placeholder="问问这道题，或和我练习英语…"></textarea><button type="submit">发送</button><small>Enter 发送 · Shift + Enter 换行 · 收起窗口仍可主动讲解</small></form>
    </section>
    <aside class="ai-tip" id="ai-tip" aria-label="lion学习提示" hidden>
      <button type="button" id="ai-tip-close" aria-label="关闭学习提示">×</button><small id="ai-tip-source"></small>
      <p id="ai-tip-text" role="status"></p><div class="ai-tip-actions"><button type="button" id="ai-tip-open">查看完整讲解</button><button type="button" id="ai-tip-pause">暂停主动提示</button></div>
    </aside>
    <button class="ai-toggle" type="button" aria-expanded="false" aria-controls="ai-panel">✦ AI 助手</button>`;
  document.body.append(widget);
  const panel = widget.querySelector(".ai-panel");
  const toggle = widget.querySelector(".ai-toggle");
  const input = widget.querySelector("#ai-input");
  const form = widget.querySelector(".ai-form");
  const send = form.querySelector("button");
  const log = widget.querySelector(".ai-messages");
  const status = widget.querySelector(".ai-status");
  const error = widget.querySelector(".ai-error");
  const explain = widget.querySelector("#ai-explain");
  const style = widget.querySelector("#ai-style");
  const personality = widget.querySelector("#ai-personality");
  const settingsNote = widget.querySelector("#ai-settings-note");
  const proactiveToggle = widget.querySelector("#ai-proactive");
  const tip = widget.querySelector("#ai-tip"), tipText = widget.querySelector("#ai-tip-text"), tipSource = widget.querySelector("#ai-tip-source");
  const PROACTIVE_KEY = "lumaWords.aiTutor.proactive.v1";
  let proactiveEnabled = true;
  try { proactiveEnabled = localStorage.getItem(PROACTIVE_KEY) !== "false"; } catch (_) { /* Use defaults. */ }
  proactiveToggle.checked = proactiveEnabled;
  const pet = window.DeskTalkPet?.mount(widget, { proactiveEnabled, onProactiveChange: setProactiveEnabled, onChatToggle: () => setOpen(panel.hidden) });
  let history = [], active = null, sequence = 0, pendingTip = null, lastScreenKey = null;
  let studyTimer;
  let speakingPractice = null;
  const mic = widget.querySelector("#ai-mic");
  const voiceLanguage = widget.querySelector("#ai-voice-language");
  const autoSpeak = widget.querySelector("#ai-auto-speak");
  const stopSpeaking = widget.querySelector("#ai-stop-speaking");
  const voiceStatus = widget.querySelector("#ai-voice-status");
  const zhVoice = widget.querySelector("#ai-zh-voice"), enVoice = widget.querySelector("#ai-en-voice");
  const speechRate = widget.querySelector("#ai-speech-rate"), speechPause = widget.querySelector("#ai-speech-pause");
  const rateValue = widget.querySelector("#ai-speech-rate-value");
  const previewZh = widget.querySelector("#ai-preview-zh"), previewEn = widget.querySelector("#ai-preview-en");
  const VOICE_KEY = "lumaWords.aiVoice.v1";
  const backendSelect = widget.querySelector('#ai-speech-backend'), speakerSelect = widget.querySelector('#ai-qwen-speaker');
  const backendStatus = widget.querySelector('#ai-backend-status');
  let savedBackend = false, capabilities = null;
  let voiceSettings = { language: "auto", autoSpeak: true, zhVoice: "", enVoice: "", rate: 1, pause: 120, backend: 'qwen', speaker: 'Serena' };
  let recordingState = "idle", speaking = false, speechPhase = 'idle', voiceNotice = "";
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_KEY));
    savedBackend = ['qwen', 'system', 'browser'].includes(saved?.backend);
    if (saved) voiceSettings = {
      language: ["auto", "zh", "en"].includes(saved.language) ? saved.language : "auto", autoSpeak: saved.autoSpeak !== false,
      zhVoice: typeof saved.zhVoice === "string" ? saved.zhVoice : "", enVoice: typeof saved.enVoice === "string" ? saved.enVoice : "",
      rate: typeof saved.rate === "number" && Number.isFinite(saved.rate) ? Math.min(1.2, Math.max(0.8, saved.rate)) : 1,
      pause: [0, 120, 300].includes(saved.pause) ? saved.pause : 120,
      backend: savedBackend ? saved.backend : 'qwen',
      speaker: ['Serena', 'Vivian', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'].includes(saved.speaker) ? saved.speaker : 'Serena',
    };
  } catch (_) { /* Use defaults when storage is unavailable. */ }
  const voice = window.DeskTalkVoice.create({
    onText(text) {
      input.value = [input.value.trimEnd(), text].filter(Boolean).join("\n").slice(0, 4000);
      voiceNotice = "识别结果已填入，可修改后点击发送。";
      if (!panel.hidden && [mic, input].includes(document.activeElement)) input.focus();
    },
    onState(state) { recordingState = state; renderVoiceState(); updateContext(); },
    onSpeechState(value, phase) { speaking = value; speechPhase = phase || 'playing'; renderVoiceState(); },
    onError(message) { error.textContent = message; error.hidden = false; renderVoiceState(); }
  });
  function renderVoiceState() {
    const labels = { requesting: "等待麦克风授权…", recording: "录音中，再次点击结束（最长 60 秒）…", transcribing: window.DeskTalkRemote?.enabled ? "正在站长电脑识别语音，首次加载可能稍慢…" : "正在本机识别语音，首次加载可能稍慢…" };
    mic.textContent = recordingState === "recording" ? "■ 结束录音" : recordingState === "transcribing" ? "识别中…" : recordingState === "requesting" ? "授权中…" : "🎙 语音输入";
    mic.setAttribute("aria-pressed", String(recordingState === "recording"));
    mic.disabled = !voice.canRecord || ["requesting", "transcribing"].includes(recordingState) || Boolean(active && !active.automatic);
    voiceLanguage.disabled = recordingState !== "idle";
    autoSpeak.disabled = !voice.canSpeak;
    previewZh.disabled = previewEn.disabled = !voice.canSpeak || recordingState !== "idle";
    stopSpeaking.disabled = !speaking;
    send.disabled = recordingState !== "idle" || Boolean(active && !active.automatic);
    voiceStatus.textContent = labels[recordingState] || (speaking ? speechPhase === 'preparing' ? '正在生成语音…可点击停止' : "正在朗读回复…" : voiceNotice);
    voiceStatus.hidden = !voiceStatus.textContent;
    if (!speakingPractice?.isActive) pet?.updateState({ busy: Boolean(active) || recordingState === "transcribing", waiting: ["requesting", "recording"].includes(recordingState), speaking, failed: !error.hidden });
  }
  function saveVoiceSettings() {
    voiceSettings = { ...voiceSettings, language: voiceLanguage.value, autoSpeak: autoSpeak.checked,
      rate: Number(speechRate.value), pause: Number(speechPause.value), backend: backendSelect.value, speaker: speakerSelect.value };
    rateValue.textContent = `${voiceSettings.rate.toFixed(2)}×`;
    voice.configure(voiceSettings);
    updateBackendLabel(); refreshVoices();
    try { localStorage.setItem(VOICE_KEY, JSON.stringify(voiceSettings)); } catch (_) { /* Current page still works. */ }
  }
  voiceLanguage.value = voiceSettings.language;
  autoSpeak.checked = voiceSettings.autoSpeak;
  speechRate.value = String(voiceSettings.rate);
  speechPause.value = String(voiceSettings.pause);
  rateValue.textContent = `${voiceSettings.rate.toFixed(2)}×`;
  voice.configure(voiceSettings);
  backendSelect.value = voiceSettings.backend; speakerSelect.value = voiceSettings.speaker;
  function updateBackendLabel() {
    const qwen = voiceSettings.backend === 'qwen';
    speakerSelect.disabled = !qwen; speechPause.disabled = qwen;
    widget.querySelector('#ai-system-voices').hidden = qwen;
    backendStatus.textContent = qwen ? `当前：本地 Qwen3-TTS · ${voiceSettings.speaker}${capabilities?.qwenAvailable === false ? '（模型未安装，请切换系统声音）' : ''}`
      : voiceSettings.backend === 'system' ? '当前：服务端 macOS 系统声音' : '当前：设备系统声音；语音通话使用服务端系统声音';
  }
  updateBackendLabel();
  function refreshVoices() {
    const voices = voice.getVoices();
    for (const [select, prefix, key] of [[zhVoice, "zh", "zhVoice"], [enVoice, "en", "enVoice"]]) {
      const available = voices.filter(item => item.lang.toLowerCase().startsWith(prefix));
      const automatic = document.createElement("option");
      automatic.value = "";
      automatic.textContent = available.length ? "自动选择本机声音" : "系统默认（暂无可选音色）";
      select.replaceChildren(automatic);
      for (const item of available) {
        const option = document.createElement("option");
        option.value = item.voiceURI;
        option.textContent = `${item.name} · ${item.lang}`;
        select.append(option);
      }
      if (voiceSettings[key] && !available.some(item => item.voiceURI === voiceSettings[key])) {
        const missing = document.createElement("option");
        missing.value = voiceSettings[key];
        missing.textContent = "已选音色暂不可用 · 使用自动声音";
        select.append(missing);
      }
      select.value = voiceSettings[key];
      select.disabled = !voice.canSpeak || voiceSettings.backend === 'qwen';
    }
  }
  refreshVoices();
  const capabilitiesController = new AbortController();
  const capabilitiesTimer = setTimeout(() => capabilitiesController.abort(), 5000);
  fetch('/api/voices', { signal: capabilitiesController.signal }).then(response => {
    if (!response.ok) throw new Error('unavailable');
    return response.json();
  }).then(data => {
    capabilities = data;
    voice.setServerVoices?.(data.systemVoices);
    if (!savedBackend && ['qwen', 'system'].includes(data.defaultBackend)) {
      voiceSettings.backend = data.defaultBackend; backendSelect.value = data.defaultBackend; voice.configure(voiceSettings);
    }
    updateBackendLabel(); refreshVoices();
  }).catch(() => { backendStatus.textContent = '语音后端未连接；可选择当前设备系统声音，或启动本机服务。'; })
    .finally(() => clearTimeout(capabilitiesTimer));
  window.addEventListener('pagehide', () => { capabilitiesController.abort(); clearTimeout(capabilitiesTimer); });
  backendSelect.addEventListener('change', () => { savedBackend = true; saveVoiceSettings(); });
  speakerSelect.addEventListener('change', saveVoiceSettings);
  widget.addEventListener('pointerdown', () => { void voice.unlockAudio?.().catch(() => {}); });
  window.speechSynthesis?.addEventListener("voiceschanged", refreshVoices);
  window.addEventListener("pagehide", () => window.speechSynthesis?.removeEventListener("voiceschanged", refreshVoices));
  widget.querySelector(".ai-speech-settings").addEventListener("toggle", refreshVoices);
  zhVoice.addEventListener("change", () => { voiceSettings.zhVoice = zhVoice.value; saveVoiceSettings(); });
  enVoice.addEventListener("change", () => { voiceSettings.enVoice = enVoice.value; saveVoiceSettings(); });
  speechRate.addEventListener("input", saveVoiceSettings);
  speechPause.addEventListener("change", saveVoiceSettings);
  previewZh.addEventListener("click", () => { error.hidden = true; voice.speak("你好，我是你的英语学习伙伴。我们慢慢来，一起练习吧。"); });
  previewEn.addEventListener("click", () => { error.hidden = true; voice.speak("Hi! I'm your English learning partner. Let's practice together, one step at a time."); });
  voiceLanguage.addEventListener("change", saveVoiceSettings);
  autoSpeak.addEventListener("change", () => { saveVoiceSettings(); if (!autoSpeak.checked) voice.stopSpeaking(); });
  stopSpeaking.addEventListener("click", () => voice.stopSpeaking());
  mic.addEventListener("click", () => {
    error.hidden = true;
    voiceNotice = "";
    if (recordingState === "recording") voice.stopRecording();
    else {
      if (active?.automatic) active.controller.abort();
      pendingTip = null;
      clearTimeout(studyTimer);
      void voice.startRecording(voiceLanguage.value);
    }
  });
  window.addEventListener("pagehide", () => voice.dispose());
  speakingPractice = window.DeskTalkSpeaking?.create({
    container: panel,
    getVoiceSettings: () => ({ ...voiceSettings,
      enVoiceName: voice.getVoices().find(item => item.voiceURI === voiceSettings.enVoice)?.name || "",
      zhVoiceName: voice.getVoices().find(item => item.voiceURI === voiceSettings.zhVoice)?.name || "",
    }),
    onEnter() {
      pendingTip = null; clearTimeout(studyTimer); hideTip();
      const previous = active; active = null; sequence++; previous?.controller.abort();
      status.hidden = true; log.setAttribute("aria-busy", "false");
      voice.cancelRecording(); voice.stopSpeaking();
      panel.setAttribute("data-speaking", "true");
    },
    onExit() {
      panel.setAttribute("data-speaking", "false");
      renderVoiceState(); updateContext(); input.focus();
    },
    onState: state => pet?.updateState(state),
  });
  widget.querySelector("#ai-speaking-entry").addEventListener("click", () => speakingPractice?.open());
  widget.querySelector("#ai-call-entry").addEventListener("click", () => { speakingPractice?.open(); void speakingPractice?.startCall(); });
  const seenTips = new Set();
  function hideTip() { tip.hidden = true; }
  function showTip(content, source) {
    tipText.textContent = content.length > 220 ? `${content.slice(0, 220)}…` : content;
    tipSource.textContent = source;
    tipSource.title = source;
    tip.hidden = false;
  }
  function setProactiveEnabled(enabled) {
    proactiveEnabled = Boolean(enabled);
    proactiveToggle.checked = proactiveEnabled;
    pet?.setProactiveEnabled(proactiveEnabled);
    try { localStorage.setItem(PROACTIVE_KEY, String(proactiveEnabled)); } catch (_) { /* Current page still works. */ }
    if (!proactiveEnabled) {
      pendingTip = null;
      clearTimeout(studyTimer);
      hideTip();
      if (!speakingPractice?.isActive) voice.stopSpeaking();
      if (active?.automatic) {
        const previous = active;
        active = null;
        sequence++;
        previous.controller.abort();
        status.hidden = true;
        log.setAttribute("aria-busy", "false");
        renderVoiceState();
      }
    }
  }
  proactiveToggle.addEventListener("change", () => setProactiveEnabled(proactiveToggle.checked));
  widget.querySelector("#ai-tip-pause").addEventListener("click", () => setProactiveEnabled(false));
  widget.querySelector("#ai-tip-close").addEventListener("click", () => { hideTip(); voice.stopSpeaking(); });
  widget.querySelector("#ai-tip-open").addEventListener("click", () => setOpen(true));
  const getContext = () => window.DeskTalkTutor?.getContext() || { activity: "none", title: "DeskTalk", entries: [] };
  const screenKey = context => JSON.stringify(context);
  function updateContext() {
    if (speakingPractice?.isActive) return;
    const context = getContext();
    const key = screenKey(context);
    if (lastScreenKey !== null && key !== lastScreenKey) {
      hideTip();
      voice.stopSpeaking();
      pendingTip = null;
      clearTimeout(studyTimer);
      if (active && (!active.automatic || active.context.activity !== context.activity || active.context.title !== context.title)) {
        const previous = active;
        active = null;
        sequence++;
        previous.controller.abort();
        if (!previous.automatic && !input.value) input.value = previous.content;
        status.hidden = true;
        log.setAttribute("aria-busy", "false");
        voiceNotice = "页面内容已更新，将依据当前屏幕回答；可直接发送输入框中的问题。";
        renderVoiceState();
      }
    }
    lastScreenKey = key;
    const word = context.activity === "study" ? `当前屏幕 ${context.entries.length} 个词` : context.activity === "page" ? "已读取当前可见内容" : context.prompt;
    widget.querySelector("#ai-context-label").textContent = `${context.title}${word ? " · " + word : ""}`;
    widget.querySelector("#ai-context-label").title = context.entries.map(entry => `${entry.word}：${entry.meaning}`).join("\n") || context.prompt || context.title;
    explain.textContent = context.activity === "study" ? "讲解当前屏幕" : context.activity === "page" ? "讲解当前页面" : "讲解当前题";
    explain.disabled = (!context.entries.length && !(context.activity === "page" && context.prompt)) || recordingState !== "idle";
    explain.title = context.activity === "study" && !context.entries.length ? "向下滚动到词条区域后即可讲解" : "结合提问时屏幕内的学习内容讲解";
  }
  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (!open) {
      speakingPractice?.close();
      voice.cancelRecording();
    } else { hideTip(); updateContext(); }
    (open ? input : toggle).focus();
  }
  toggle.addEventListener("click", () => setOpen(panel.hidden));
  widget.querySelector(".ai-close").addEventListener("click", () => setOpen(false));
  widget.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Escape") setOpen(false);
    if (event.target === input && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  function appendMessage(role, content, caption = "") {
    const bubble = document.createElement("div");
    bubble.className = `ai-message ai-${role}`;
    if (caption) {
      const label = document.createElement("small");
      label.className = "ai-message-caption";
      label.textContent = caption;
      bubble.append(label);
    }
    bubble.append(document.createTextNode(content));
    if (role === "assistant" && voice.canSpeak) {
      const replay = document.createElement("button");
      replay.type = "button";
      replay.className = "ai-replay";
      replay.textContent = "🔊 朗读";
      replay.setAttribute("aria-label", "朗读这条回复");
      replay.addEventListener("click", () => voice.speak(content));
      bubble.append(replay);
    }
    log.append(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
  }
  async function requestReply(content, context = getContext(), automatic = false) {
    if (speakingPractice?.isActive) return;
    updateContext();
    if (!automatic) context = getContext();
    if (recordingState !== "idle") {
      if (!automatic) { error.textContent = "请先结束录音，识别完成后再发送。"; error.hidden = false; }
      return;
    }
    if (!content || (active && !active.automatic)) return;
    if (automatic && (!proactiveEnabled || document.hidden || active)) return;
    if (active?.automatic) active.controller.abort();
    if (!automatic) {
      voiceNotice = "";
      voice.stopSpeaking();
      pendingTip = null;
      clearTimeout(studyTimer);
    }
    error.hidden = true;
    if (location.protocol === "file:") {
      error.textContent = "请运行 python3 server.py，并通过 http://127.0.0.1:8000 打开网站后聊天。";
      error.hidden = false;
      return;
    }
    const messages = [...history.slice(-8), { role: "user", content, context }];
    const bubble = automatic ? null : appendMessage("user", content, context.title);
    if (!automatic) input.value = "";
    const ticket = ++sequence;
    const controller = new AbortController();
    active = { controller, automatic, context, content };
    renderVoiceState();
    status.textContent = automatic ? "千问正在准备学习小贴士…" : "千问正在思考…";
    status.hidden = false;
    log.setAttribute("aria-busy", "true");
    const timer = setTimeout(() => controller.abort(), 130000);
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, personality: preferences.personality, kind: automatic ? "tip" : "chat" }), signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "聊天服务暂时不可用，请稍后重试。");
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("千问没有返回有效回复，请重试。");
      if (ticket !== sequence || controller.signal.aborted) return;
      if ((!automatic && screenKey(getContext()) !== screenKey(context)) || (automatic && getContext().activity !== context.activity)) {
        updateContext();
        return;
      }
      history = [...messages, { role: "assistant", content: data.reply }];
      const subject = context.prompt || context.entries[0]?.word;
      const source = `${context.title}${context.activity === "study" ? ` · ${context.entries.length} 个词` : context.activity === "quiz" ? ` · ${context.prompt}` : ""}`;
      appendMessage("assistant", data.reply, automatic ? `学习小贴士 · ${context.title}${subject ? " · " + subject : ""}` : `提问时的页面：${source}`);
      pet?.notifyReply();
      if (panel.hidden && !document.hidden) showTip(data.reply, automatic ? `刚才的学习提示 · ${source}` : `AI 回复 · ${source}`);
      if (voiceSettings.autoSpeak && voice.canSpeak && !document.hidden && recordingState === "idle") voice.speak(data.reply);
    } catch (failure) {
      if (ticket !== sequence || (automatic && controller.signal.aborted)) return;
      if (bubble) {
        bubble.classList.add("ai-failed");
        bubble.append(document.createTextNode("（发送失败）"));
        if (!input.value) input.value = content;
      }
      error.textContent = failure.name === "AbortError" ? "千问回复超时，请重试。" : failure instanceof TypeError ? "无法连接聊天服务，请检查网络或稍后重试。" : failure.message;
      error.hidden = false;
      if (panel.hidden && !document.hidden) showTip(error.textContent, "主动讲解未完成");
    } finally {
      clearTimeout(timer);
      if (ticket === sequence) {
        active = null;
        renderVoiceState();
        status.hidden = true;
        log.setAttribute("aria-busy", "false");
        if (pendingTip && proactiveEnabled && !document.hidden) {
          const tip = pendingTip;
          pendingTip = null;
          if (tip.context.activity !== "study" || getContext().entries.some(entry => entry.word === tip.context.entries[0]?.word)) {
            void requestReply(tip.content, tip.context, true);
          }
        }
      }
    }
  }
  function offerTip(context, type) {
    if (speakingPractice?.isActive || !proactiveEnabled || document.hidden || recordingState !== "idle" || !context.entries.length) return;
    const key = `${type}:${context.id}`;
    if (seenTips.has(key)) return;
    seenTips.add(key);
    if (seenTips.size > 200) seenTips.delete(seenTips.values().next().value);
    const content = type === "mistake"
      ? "我刚才这道题做错了。请依据这道题的资料，用不超过三句话温柔地讲清关键区别，给一个记忆小技巧或短英文例句。不要把它当成我现在正在做的下一题。"
      : "我选中了这个单词。请用不超过三句话自然地解释词义，并给一个记忆技巧或简短英文例句。";
    if (active) pendingTip = { context, content };
    else void requestReply(content, context, true);
  }
  window.addEventListener("desktalk:answer", event => {
    updateContext();
    if (!event.detail.correct) offerTip(event.detail.context, "mistake");
  });
  window.addEventListener("desktalk:study-word", event => {
    updateContext();
    clearTimeout(studyTimer);
    const context = event.detail.context;
    studyTimer = setTimeout(() => offerTip(context, "study"), 250);
  });
  window.addEventListener("desktalk:context", updateContext);
  window.addEventListener("popstate", updateContext);
  let contextFrame = 0;
  function refreshVisibleContext(event) {
    if ((panel.hidden && !proactiveEnabled) || contextFrame || (event.type === "scroll" && widget.contains(event.target))) return;
    contextFrame = requestAnimationFrame(() => { contextFrame = 0; updateContext(); });
  }
  document.addEventListener("scroll", refreshVisibleContext, { passive: true, capture: true });
  window.addEventListener("resize", refreshVisibleContext);
  window.addEventListener("hashchange", refreshVisibleContext);
  document.addEventListener("visibilitychange", () => { if (document.hidden) { hideTip(); if (!speakingPractice?.isActive) voice.stopSpeaking(); } });
  const screenObserver = new MutationObserver(() => refreshVisibleContext({ type: "mutation" }));
  document.querySelectorAll(".shell, #studyPage, #dictationOverlay").forEach(region => {
    screenObserver.observe(region, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
  });
  document.querySelectorAll(".overlay").forEach(region => {
    screenObserver.observe(region, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
  });
  document.addEventListener("click", event => {
    if (!widget.contains(event.target)) setTimeout(updateContext, 0);
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    void requestReply(input.value.trim());
  });
  explain.addEventListener("click", () => {
    const context = getContext();
    const content = context.activity === "quiz" ? "请依次解释这四个选项：英文词分别是什么意思，中文释义分别对应什么词？我还没作答时请不要标出正确答案。"
      : context.activity === "dictation" ? "请根据这道默写题给我一点记忆提示。还没作答时先不要直接告诉我完整拼写。"
      : context.activity === "page" ? "请根据当前前台页面或弹窗里实际可见的文字，简要说明我正在查看什么内容。"
      : `请按从上到下的顺序，简要解释我当前屏幕显示的全部 ${context.entries.length} 个词条。使用数字编号或单词标题，不要用 A/B/C/D 选项格式；每词先给出简明词义，确保全部列完。`;
    void requestReply(content, context);
  });
  function renderPreferences() {
    style.value = preferences.style;
    personality.value = preferences.personality;
  }
  style.addEventListener("change", () => {
    if (presets[style.value]) personality.value = presets[style.value];
    settingsNote.textContent = "点击保存后生效。";
  });
  personality.addEventListener("input", () => {
    style.value = "custom";
    settingsNote.textContent = "点击保存后生效。";
  });
  function savePreferences(value) {
    preferences = value;
    renderPreferences();
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences));
      settingsNote.textContent = "已保存，下次回复生效。";
    } catch (_) {
      settingsNote.textContent = "本次页面已生效；浏览器禁止保存设置，刷新后会恢复默认。";
    }
  }
  widget.querySelector("#ai-save").addEventListener("click", () => savePreferences({ style: style.value, personality: personality.value.trim() || presets.gentle }));
  widget.querySelector("#ai-reset").addEventListener("click", () => savePreferences({ style: "gentle", personality: presets.gentle }));
  renderPreferences();
  renderVoiceState();
  updateContext();
})();
