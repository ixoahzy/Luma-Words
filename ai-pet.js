(() => {
  "use strict";
  const animations = {
    idle: [0, [280, 110, 110, 140, 140, 320], true],
    "running-right": [1, Array(8).fill(90), true],
    "running-left": [2, Array(8).fill(90), true],
    waving: [3, [140, 140, 140, 280], false],
    jumping: [4, [100, 90, 110, 110, 150], false],
    failed: [5, Array(8).fill(160), true],
    waiting: [6, Array(6).fill(180), true],
    running: [7, Array(6).fill(140), true],
    review: [8, Array(6).fill(160), true],
  };
  function frameAt(state, elapsed) {
    const [row, durations, loop] = animations[state] || animations.idle;
    const total = durations.reduce((a, b) => a + b, 0);
    let time = Math.max(0, elapsed);
    if (!loop && time >= total) return { row, column: durations.length - 1, done: true };
    time %= total;
    let column = 0;
    while (column < durations.length - 1 && time >= durations[column]) time -= durations[column++];
    return { row, column, done: false };
  }
  function lookAt(dx, dy, deadZone = 26) {
    if (Math.hypot(dx, dy) < deadZone) return null;
    const direction = Math.round(((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360) / 22.5) % 16;
    return { row: 9 + Math.floor(direction / 8), column: direction % 8 };
  }
  function clampPosition(x, y, width, height, viewportWidth, viewportHeight) {
    return { x: Math.max(8, Math.min(x, viewportWidth - width - 8)), y: Math.max(8, Math.min(y, viewportHeight - height - 8)) };
  }
  function placePanel(anchor, panel, viewport) {
    const gap = 12, margin = 8;
    let left, top, maxHeight = Math.min(panel.height, viewport.height - margin * 2);
    if (anchor.x >= panel.width + gap + margin) {
      left = anchor.x - panel.width - gap;
      top = anchor.y + anchor.height - maxHeight;
    } else if (viewport.width - anchor.x - anchor.width >= panel.width + gap + margin) {
      left = anchor.x + anchor.width + gap;
      top = anchor.y;
    } else {
      left = anchor.x + anchor.width / 2 - panel.width / 2;
      const above = anchor.y - gap - margin, below = viewport.height - anchor.y - anchor.height - gap - margin;
      if (Math.max(above, below) >= 260) {
        maxHeight = Math.min(maxHeight, Math.max(above, below));
        top = above >= below ? anchor.y - gap - maxHeight : anchor.y + anchor.height + gap;
      } else top = margin;
    }
    return { left: Math.max(margin, Math.min(left, viewport.width - panel.width - margin)),
      top: Math.max(margin, Math.min(top, viewport.height - maxHeight - margin)), maxHeight };
  }
  function resolveState(flags = {}, movement, gesture) {
    return movement || gesture || (flags.waiting ? "waiting" : flags.failed ? "failed" : flags.unread || flags.speaking ? "review" : flags.busy ? "running" : "idle");
  }
  function mount(root) {
    if (root._lumaPet) return root._lumaPet;
    const toggle = root.querySelector(".ai-toggle"), panel = root.querySelector(".ai-panel");
    if (!toggle || !panel) return null;
    const storageKey = "lumaWords.amberPet.v1", localOnly = toggle.textContent.includes("本机");
    let preferences = { scale: 1, gaze: true, minimal: false, position: null };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved) preferences = { scale: [1, 1.25, 1.5].includes(saved.scale) ? saved.scale : 1,
        gaze: saved.gaze !== false, minimal: saved.minimal === true,
        position: saved.position && [saved.position.x, saved.position.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) ? saved.position : null };
    } catch (_) { /* Keep useful defaults when storage is unavailable. */ }
    root.classList.add("has-amber-pet");
    toggle.classList.add("ai-pet-toggle");
    toggle.innerHTML = '<span class="ai-pet-sprite" aria-hidden="true"></span><span class="ai-pet-label"></span>';
    const sprite = toggle.querySelector(".ai-pet-sprite"), label = toggle.querySelector(".ai-pet-label");
    const tools = document.createElement("div");
    tools.className = "ai-pet-tools";
    tools.innerHTML = `<button type="button" class="ai-pet-settings" aria-label="小琥珀设置" aria-expanded="false">⚙</button>
      <div class="ai-pet-menu" role="group" aria-label="小琥珀设置" hidden>
        <strong>小琥珀</strong><div class="ai-pet-actions"><button type="button" data-pet-action="waving">挥手</button><button type="button" data-pet-action="jumping">跳跃</button></div>
        <label>角色大小<select class="ai-pet-scale" aria-label="角色大小"><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select></label>
        <label><input type="checkbox" class="ai-pet-gaze">视线跟随</label>
        <button type="button" class="ai-pet-minimize"></button><button type="button" class="ai-pet-reset">恢复右下角位置</button>
        <small>点击聊天 · 拖拽移动<br>位置和设置自动保存</small>
      </div>`;
    root.append(tools);
    const settings = tools.querySelector(".ai-pet-settings"), menu = tools.querySelector(".ai-pet-menu");
    const scale = tools.querySelector(".ai-pet-scale"), gazeInput = tools.querySelector(".ai-pet-gaze"), minimize = tools.querySelector(".ai-pet-minimize");
    scale.value = String(preferences.scale); gazeInput.checked = preferences.gaze;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let flags = {}, movement = null, gesture = null, gazeFrame = null, drag = null, suppressClick = false;
    let animation = "", started = 0, timer, pointerFrame, readyTimer, assetFailed = false;
    let size = { width: 112, height: 146 }, position = { x: 0, y: 0 };
    function save() { try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch (_) { /* Continue without persistence. */ } }
    function rememberPosition() {
      preferences.position = { x: position.x / Math.max(1, innerWidth - size.width), y: position.y / Math.max(1, innerHeight - size.height) };
      save();
    }
    function positionPanel() {
      if (panel.hidden) return;
      const panelWidth = Math.min(380, innerWidth - 24);
      const result = placePanel({ ...position, ...size }, { width: panelWidth, height: Math.min(localOnly ? 300 : innerWidth <= 480 ? 560 : 650, innerHeight - 32) }, { width: innerWidth, height: innerHeight });
      Object.assign(panel.style, { width: `${panelWidth}px`, left: `${result.left}px`, top: `${result.top}px`, height: `${result.maxHeight}px`, maxHeight: `${result.maxHeight}px` });
    }
    function layout(restore = false) {
      const minimal = preferences.minimal || assetFailed;
      root.classList.toggle("ai-pet-is-minimal", minimal);
      const width = minimal ? 134 : Math.min(112 * preferences.scale, innerWidth - 24);
      size = { width, height: minimal ? 44 : width * 208 / 192 + 26 };
      root.style.setProperty("--pet-width", `${size.width}px`);
      root.style.setProperty("--pet-sprite-height", `${minimal ? 0 : size.height - 26}px`);
      minimize.textContent = preferences.minimal ? "显示小琥珀" : "收起小琥珀";
      if (restore) position = preferences.position ? { x: preferences.position.x * Math.max(1, innerWidth - size.width), y: preferences.position.y * Math.max(1, innerHeight - size.height) } : { x: innerWidth - size.width - 24, y: innerHeight - size.height - 24 };
      position = clampPosition(position.x, position.y, size.width, size.height, innerWidth, innerHeight);
      Object.assign(root.style, { left: `${position.x}px`, top: `${position.y}px`, right: "auto", bottom: "auto" });
      const menuHeight = Math.min(menu.scrollHeight || 300, innerHeight - 32);
      menu.style.left = `${Math.max(8, Math.min(position.x + size.width - 194, innerWidth - 202))}px`;
      menu.style.top = `${Math.max(8, Math.min(position.y > innerHeight / 2 ? position.y - menuHeight : position.y + 32, innerHeight - menuHeight - 8))}px`;
      positionPanel();
    }
    function render() {
      clearTimeout(timer);
      const state = resolveState(flags, movement, gesture), now = performance.now();
      if (state !== animation) { animation = state; started = now; }
      let frame = frameAt(state, now - started);
      if (gesture && frame.done) { gesture = null; render(); return; }
      if (reduced.matches) frame = { row: 0, column: 0 };
      else if (state === "idle" && preferences.gaze && gazeFrame) frame = gazeFrame;
      sprite.style.backgroundPosition = `${frame.column / 7 * 100}% ${frame.row / 10 * 100}%`;
      const text = flags.waiting ? "正在听你说" : flags.failed ? "连接遇到问题" : flags.busy ? "正在思考…" : flags.speaking ? "正在朗读…" : flags.unread ? "回复已就绪" : localOnly ? "AI · 本机功能" : "小琥珀 · AI 助手";
      label.textContent = text;
      toggle.setAttribute("aria-label", `小琥珀 AI 助手，${text}`);
      root.dataset.petState = state;
      if (!document.hidden && !preferences.minimal && !assetFailed && !reduced.matches) timer = setTimeout(render, 80);
    }
    function play(name) { gesture = name; started = performance.now(); animation = ""; gazeFrame = null; render(); }
    function setMenu(open) { menu.hidden = !open; settings.setAttribute("aria-expanded", String(open)); if (open) layout(); }
    settings.addEventListener("click", () => setMenu(menu.hidden));
    tools.querySelectorAll("[data-pet-action]").forEach(button => button.addEventListener("click", () => { play(button.dataset.petAction); setMenu(false); }));
    scale.addEventListener("change", () => { preferences.scale = Number(scale.value); layout(); rememberPosition(); });
    gazeInput.addEventListener("change", () => { preferences.gaze = gazeInput.checked; gazeFrame = null; save(); render(); });
    minimize.addEventListener("click", () => { preferences.minimal = !preferences.minimal; layout(); rememberPosition(); setMenu(false); render(); });
    tools.querySelector(".ai-pet-reset").addEventListener("click", () => { preferences.position = null; layout(true); rememberPosition(); setMenu(false); });
    toggle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.isPrimary === false) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { ...position }, moved: false };
      toggle.setPointerCapture(event.pointerId);
    });
    toggle.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true; movement = dx < 0 ? "running-left" : "running-right";
      position = { x: drag.start.x + dx, y: drag.start.y + dy };
      setMenu(false); layout(); render();
    });
    function finishDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      suppressClick = drag.moved && event.type !== "pointercancel";
      if (drag.moved) rememberPosition();
      drag = null; movement = null;
      if (toggle.hasPointerCapture(event.pointerId)) toggle.releasePointerCapture(event.pointerId);
      render();
    }
    toggle.addEventListener("pointerup", finishDrag);
    toggle.addEventListener("pointercancel", finishDrag);
    toggle.addEventListener("lostpointercapture", event => { if (drag) finishDrag(event); });
    toggle.addEventListener("click", event => {
      if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); return; }
      setMenu(false);
      if (panel.hidden) play("waving");
    }, true);
    document.addEventListener("pointerdown", event => { if (!tools.contains(event.target)) setMenu(false); });
    root.addEventListener("keydown", event => { if (event.key === "Escape") setMenu(false); });
    document.addEventListener("pointermove", event => {
      if (drag || !preferences.gaze || preferences.minimal || event.pointerType === "touch") return;
      cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        const rect = sprite.getBoundingClientRect();
        gazeFrame = lookAt(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
        render();
      });
    }, { passive: true });
    document.addEventListener("pointerleave", () => { gazeFrame = null; render(); });
    document.addEventListener("visibilitychange", render);
    reduced.addEventListener("change", render);
    window.addEventListener("resize", () => layout(true));
    const panelObserver = new MutationObserver(() => {
      if (!panel.hidden) { flags.unread = false; render(); }
      positionPanel();
    });
    panelObserver.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    const image = new Image();
    image.onerror = () => { assetFailed = true; layout(); render(); };
    image.src = new URL("assets/amber/spritesheet.webp", document.baseURI).href;
    layout(true); render();
    const api = {
      updateState(next) { flags = { ...flags, ...next }; if (flags.busy) flags.unread = false; render(); },
      notifyReply() {
        flags.unread = true; render(); clearTimeout(readyTimer);
        if (!panel.hidden) readyTimer = setTimeout(() => { flags.unread = false; render(); }, 1800);
      },
    };
    window.addEventListener("pagehide", () => { clearTimeout(timer); clearTimeout(readyTimer); cancelAnimationFrame(pointerFrame); });
    window.addEventListener("pageshow", render);
    root._lumaPet = api;
    return api;
  }
  window.LumaPet = { mount, frameAt, lookAt, clampPosition, placePanel, resolveState };
})();
