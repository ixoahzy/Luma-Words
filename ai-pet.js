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
  const expressions = ['neutral', 'wave', 'pat', 'poke', 'celebrate', 'comfort', 'thinking', 'sleepy'];
  const reactions = { wave: '嗨，我在这里～', pat: '摸摸头，充电成功！', poke: '诶？被你发现啦。', celebrate: '好开心，和你一起加油！', comfort: '没关系，我们一起记住它。', thinking: '让我认真想一想…', sleepy: '我安静陪着你。', jumping: '一起加油！' };
  function interactionAt(x, y) {
    if (x < .2 || x > .8) return 'chat';
    return y < .27 ? 'pat' : y < .53 ? 'poke' : 'chat';
  }
  function expressionFor(flags = {}, gesture, sleepy = false) {
    if (gesture) return expressions.includes(gesture) ? gesture : gesture === 'jumping' ? 'celebrate' : 'wave';
    return flags.waiting ? 'wave' : flags.failed ? 'comfort' : flags.busy ? 'thinking' : flags.speaking || flags.unread ? 'wave' : sleepy ? 'sleepy' : 'neutral';
  }
  function animationFor(flags = {}, movement, gesture) {
    const mapped = { wave: 'waving', celebrate: 'jumping', pat: 'waiting', poke: 'review', comfort: 'waiting', thinking: 'running', sleepy: 'idle' };
    return movement || (gesture ? mapped[gesture] || gesture : resolveState(flags));
  }
  function liveFrame(state, elapsed, gaze, reduced = false) {
    if (reduced) return { row: 0, column: 0 };
    if (state === 'idle' && gaze) {
      // Directional poses must still blink, rather than freezing while looking.
      return elapsed % 4800 < 140 ? { row: 0, column: 2 } : gaze;
    }
    const definition = animations[state];
    if (definition && !definition[2]) elapsed %= definition[1].reduce((sum, duration) => sum + duration, 0);
    return frameAt(state, elapsed);
  }
  function clarifyFrame(source, width, height) {
    const result = new Uint8ClampedArray(source);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, alpha = source[i + 3];
      if (alpha < 8) { result[i + 3] = 0; continue; }
      // Only sharpen opaque interiors. Sharpening alpha/colour across a
      // transparent boundary creates the very halos we want to avoid.
      if (alpha > 245 && x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        const adjacent = [i - 4, i + 4, i - width * 4, i + width * 4];
        if (adjacent.every(n => source[n + 3] > 245)) {
          for (let c = 0; c < 3; c++) {
            const mean = adjacent.reduce((sum, n) => sum + source[n + c], 0) / 4;
            result[i + c] = source[i + c] + .24 * (source[i + c] - mean);
          }
        }
      }
      // The original atlas was keyed from green. Despill only strong green
      // on translucent outlines; golden eyes and opaque costume stay intact.
      if (alpha < 245 && source[i + 1] > Math.max(source[i], source[i + 2]) + 24) {
        result[i + 1] = Math.max(result[i], result[i + 2]);
      }
    }
    return result;
  }
  const hdRows = [
    ['idle',6], ['running-right',8], ['running-left',8], ['waving',4],
    ['jumping',5], ['failed',8], ['waiting',6], ['running',6], ['review',6],
    ['look-0',8], ['look-1',8]
  ];
  function hdFrameDescriptor(frame) {
    const row = hdRows[frame.row];
    if (!row || frame.column < 0 || frame.column >= row[1]) return null;
    return { file: `assets/lion/motion-hd/${row[0]}.png`, columns: 2, rows: Math.ceil(row[1] / 2), index: frame.column,
      alignFeet: ![1,2,4].includes(frame.row), scale: frame.row >= 9 ? .96 : 1 };
  }
  function footBaseline(pixels, width, height) {
    for (let y = height - 1; y >= 0; y--) {
      let solid = 0;
      for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 127 && ++solid >= 3) return (y + .5) / height;
    }
    return .947;
  }
  function frameRenderer(canvas, image, onReady = () => {}, onQuality = () => {}) {
    const context = canvas.getContext?.('2d');
    if (!context) return null;
    const source = document.createElement('canvas');
    source.width = 192; source.height = 208;
    const reader = source.getContext('2d', { willReadFrequently: true }), cache = new Map(), sheets = new Map();
    let lastDraw = '';
    function loadSheet(descriptor) {
      if (!descriptor) return null;
      if (sheets.has(descriptor.file)) return sheets.get(descriptor.file);
      let resolve;
      const entry = { image: new Image(), ready: false, failed: false, attempts: 0, promise: new Promise(done => { resolve = done; }) };
      sheets.set(descriptor.file, entry);
      entry.image.onload = () => {
        const cellWidth = entry.image.naturalWidth / descriptor.columns, cellHeight = entry.image.naturalHeight / descriptor.rows;
        entry.ready = cellWidth >= 380 && cellHeight >= 380 && Math.abs(cellWidth / cellHeight - 1) < .08;
        entry.failed = !entry.ready;
        if (!entry.ready) console.warn('DeskTalk HD sheet dimensions rejected', descriptor.file, cellWidth, cellHeight);
        resolve(entry.ready);
        if (entry.ready) { lastDraw = ''; onReady(); }
      };
      const request = () => {
        entry.attempts++;
        const url = new URL(descriptor.file, document.baseURI);
        if (entry.attempts > 1) url.searchParams.set('retry', String(entry.attempts));
        entry.image.src = url.href;
      };
      entry.image.onerror = () => {
        if (entry.attempts < 2) { request(); return; }
        console.warn('DeskTalk HD sheet failed to load', descriptor.file);
        entry.failed = true; resolve(false);
      };
      request();
      return entry;
    }
    // Direction sheets are shared by all gaze poses. Load them alongside
    // idle; remaining actions load only when needed rather than blocking UI.
    [0,9,10].forEach(row => loadSheet(hdFrameDescriptor({ row, column: 0 })));
    const draw = (frame, width, height) => {
      const density = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
      const pixelsWide = Math.round(width * density), pixelsHigh = Math.round(height * density);
      const descriptor = hdFrameDescriptor(frame);
      loadSheet(descriptor);
      const sheet = descriptor && sheets.get(descriptor.file);
      const hd = sheet?.ready;
      // HD preparation is available immediately, even if the old atlas is
      // still downloading. Do not disable the renderer on that initial race.
      if (!hd && !image.naturalWidth) return;
      const key = `${hd ? 'hd' : 'original'}:${frame.row}:${frame.column}`, drawKey = `${key}:${pixelsWide}:${pixelsHigh}`;
      if (drawKey === lastDraw) return;
      let cached = cache.get(key), tile = cached?.tile;
      if (!tile) {
        const cellWidth = hd ? sheet.image.naturalWidth / descriptor.columns : 192;
        const cellHeight = hd ? sheet.image.naturalHeight / descriptor.rows : 208;
        const tileWidth = Math.round(cellWidth), tileHeight = Math.round(cellHeight);
        source.width = tileWidth; source.height = tileHeight;
        reader.drawImage(hd ? sheet.image : image,
          (hd ? descriptor.index % descriptor.columns : frame.column) * cellWidth,
          (hd ? Math.floor(descriptor.index / descriptor.columns) : frame.row) * cellHeight,
          cellWidth, cellHeight, 0, 0, tileWidth, tileHeight);
        const data = reader.getImageData(0, 0, tileWidth, tileHeight);
        // Generated HD detail is preserved; do not sharpen the newly drawn
        // fine linework a second time. Keep original cleanup as fallback.
        if (!hd) data.data.set(clarifyFrame(data.data, tileWidth, tileHeight));
        tile = document.createElement('canvas'); tile.width = tileWidth; tile.height = tileHeight;
        tile.getContext('2d').putImageData(data, 0, 0);
        if (cache.size >= 16) cache.delete(cache.keys().next().value);
        cached = { tile, baseline: hd && descriptor.alignFeet ? footBaseline(data.data, tileWidth, tileHeight) : null };
        cache.set(key, cached);
      }
      if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
        canvas.width = pixelsWide; canvas.height = pixelsHigh;
      }
      context.clearRect(0, 0, pixelsWide, pixelsHigh);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      const drawHeight = pixelsHigh * (hd ? descriptor.scale : 1);
      const drawWidth = drawHeight * tile.width / tile.height;
      const drawY = cached.baseline === null ? 0 : pixelsHigh * .947 - cached.baseline * drawHeight;
      context.drawImage(tile, (pixelsWide - drawWidth) / 2, drawY, drawWidth, drawHeight);
      onQuality(hd ? 'hd' : 'original');
      lastDraw = drawKey;
    };
    draw.prepare = frame => {
      const descriptor = hdFrameDescriptor(frame);
      // An explicit new interaction may recover from an earlier connection
      // failure; render ticks never create an unbounded retry loop.
      if (descriptor && sheets.get(descriptor.file)?.failed) sheets.delete(descriptor.file);
      const entry = loadSheet(descriptor);
      return entry && !entry.ready && !entry.failed ? entry.promise : null;
    };
    return draw;
  }
  function avatarSize(scale, viewportWidth, viewportHeight) {
    const width = Math.max(48, Math.min(176 * scale, viewportWidth - 24, viewportHeight * .46 - 26));
    return { width, height: width + 26 };
  }
  function mount(root, { proactiveEnabled = true, onProactiveChange = () => {}, onChatToggle = null } = {}) {
    if (root._deskTalkPet) return root._deskTalkPet;
    const toggle = root.querySelector(".ai-toggle"), panel = root.querySelector(".ai-panel");
    const tip = root.querySelector(".ai-tip");
    if (!toggle || !panel) return null;
    const storageKey = "lumaWords.amberPet.v1", localOnly = toggle.textContent.includes("本机");
    let preferences = { scale: 1, gaze: true, minimal: false, position: null, wander: false, reactions: true };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved) preferences = { scale: [0.8, 1, 1.25, 1.5, 1.6].includes(saved.scale) ? saved.scale : 1,
        gaze: saved.gaze !== false, minimal: saved.minimal === true,
        wander: saved.wander === true, reactions: saved.reactions !== false,
        position: saved.position && [saved.position.x, saved.position.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) ? saved.position : null };
    } catch (_) { /* Keep useful defaults when storage is unavailable. */ }
    root.classList.add("has-lion-pet");
    toggle.classList.add("ai-pet-toggle");
    toggle.innerHTML = '<span class="ai-pet-stage" aria-hidden="true"><span class="ai-pet-sprite"></span><canvas class="ai-pet-canvas"></canvas><span class="ai-pet-fx"></span></span><span class="ai-pet-label"></span>';
    const sprite = toggle.querySelector(".ai-pet-sprite"), label = toggle.querySelector(".ai-pet-label");
    const canvas = toggle.querySelector('.ai-pet-canvas');
    const tools = document.createElement("div");
    tools.className = "ai-pet-tools";
    tools.innerHTML = `<button type="button" class="ai-pet-settings" aria-label="lion 设置" aria-expanded="false">⚙</button>
      <div class="ai-pet-menu" role="group" aria-label="lion 设置" hidden>
        <strong>lion · 互动陪伴</strong><button type="button" class="ai-pet-chat">打开 / 收起聊天</button>
        <div class="ai-pet-actions"><button type="button" data-pet-action="wave">招手</button><button type="button" data-pet-action="jumping">跳跃</button><button type="button" data-pet-action="pat">摸摸头</button><button type="button" data-pet-action="poke">戳脸颊</button><button type="button" data-pet-action="celebrate">开心</button><button type="button" data-pet-action="comfort">鼓励</button><button type="button" data-pet-action="thinking">思考</button><button type="button" data-pet-action="sleepy">休息</button></div>
        <label>角色大小<select class="ai-pet-scale" aria-label="角色大小"><option value="0.8">小巧</option><option value="1">标准 · 176px</option><option value="1.25">放大 · 220px</option><option value="1.5">大号 · 264px</option><option value="1.6">特大 · 282px</option></select></label>
        <label><input type="checkbox" class="ai-pet-gaze">视线跟随</label>
        <label><input type="checkbox" class="ai-pet-reactions">学习表情反馈</label>
        <label><input type="checkbox" class="ai-pet-wander">边角散步（默认关闭）</label>
        ${localOnly ? "" : '<label><input type="checkbox" class="ai-pet-proactive">主动学习提示</label>'}
        <button type="button" class="ai-pet-minimize"></button><button type="button" class="ai-pet-reset">恢复右下角位置</button>
        <small>摸头部 · 戳脸颊 · 点击身体聊天<br>双击开心回应 · 拖拽移动<br>键盘 Enter 聊天 · 设置自动保存</small>
      </div>`;
    root.append(tools);
    const settings = tools.querySelector(".ai-pet-settings"), menu = tools.querySelector(".ai-pet-menu");
    const scale = tools.querySelector(".ai-pet-scale"), gazeInput = tools.querySelector(".ai-pet-gaze"), minimize = tools.querySelector(".ai-pet-minimize");
    const proactiveInput = tools.querySelector(".ai-pet-proactive");
    if (proactiveInput) {
      proactiveInput.checked = proactiveEnabled;
      proactiveInput.addEventListener("change", () => onProactiveChange(proactiveInput.checked));
    }
    scale.value = String(preferences.scale); gazeInput.checked = preferences.gaze;
    const wanderInput = tools.querySelector('.ai-pet-wander'), reactionsInput = tools.querySelector('.ai-pet-reactions');
    wanderInput.checked = preferences.wander; reactionsInput.checked = preferences.reactions;
    const fx = toggle.querySelector('.ai-pet-fx');
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let flags = {}, movement = null, gesture = null, gazeFrame = null, drag = null, suppressClick = false;
    let animation = "", started = 0, timer, pointerFrame, readyTimer, assetFailed = false;
    let lastFrame = '', drawFrame;
    let interactionTimer, reactionTimer, wanderTimer, walkFrame, clickTimer, strolling = false, lastInteraction = performance.now();
    let reactionLabel = '', preparing = false, actionSequence = 0, preparationTimer;
    let size = { width: 112, height: 146 }, position = { x: 0, y: 0 };
    function save() { try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch (_) { /* Continue without persistence. */ } }
    function rememberPosition() {
      preferences.position = { x: position.x / Math.max(1, innerWidth - size.width), y: position.y / Math.max(1, innerHeight - size.height) };
      save();
    }
    function positionPanel() {
      if (!panel.hidden) {
        const panelWidth = Math.min(380, innerWidth - 24);
        const result = placePanel({ ...position, ...size }, { width: panelWidth, height: Math.min(localOnly ? 300 : innerWidth <= 480 ? 560 : 650, innerHeight - 32) }, { width: innerWidth, height: innerHeight });
        Object.assign(panel.style, { width: `${panelWidth}px`, left: `${result.left}px`, top: `${result.top}px`, height: `${result.maxHeight}px`, maxHeight: `${result.maxHeight}px` });
      }
      if (tip && !tip.hidden) {
        const width = Math.min(268, innerWidth - 24), height = Math.min(tip.scrollHeight || 180, 180);
        const result = placePanel({ ...position, ...size }, { width, height }, { width: innerWidth, height: innerHeight });
        Object.assign(tip.style, { width: `${width}px`, left: `${result.left}px`, top: `${result.top}px`, right: "auto", bottom: "auto" });
      }
    }
    function layout(restore = false) {
      const minimal = preferences.minimal || assetFailed;
      root.classList.toggle("ai-pet-is-minimal", minimal);
      size = minimal ? { width: 134, height: 44 } : avatarSize(preferences.scale, innerWidth, innerHeight);
      root.style.setProperty("--pet-width", `${size.width}px`);
      root.style.setProperty("--pet-sprite-height", `${minimal ? 0 : size.height - 26}px`);
      minimize.textContent = preferences.minimal ? "显示 lion" : "收起 lion";
      if (restore) position = preferences.position ? { x: preferences.position.x * Math.max(1, innerWidth - size.width), y: preferences.position.y * Math.max(1, innerHeight - size.height) } : { x: innerWidth - size.width - 24, y: innerHeight - size.height - 24 };
      position = clampPosition(position.x, position.y, size.width, size.height, innerWidth, innerHeight);
      Object.assign(root.style, { left: `${position.x}px`, top: `${position.y}px`, right: "auto", bottom: "auto" });
      const menuHeight = Math.min(menu.scrollHeight || 300, innerHeight - 32);
      menu.style.left = `${Math.max(8, Math.min(position.x + size.width - 218, innerWidth - 226))}px`;
      menu.style.top = `${Math.max(8, Math.min(position.y > innerHeight / 2 ? position.y - menuHeight : position.y + 32, innerHeight - menuHeight - 8))}px`;
      positionPanel();
    }
    function render() {
      clearTimeout(timer);
      const state = animationFor(flags, movement, gesture), now = performance.now();
      if (state !== animation) { animation = state; started = now; }
      // Keep playing the genuine action frames; HD portraits only decorate
      // the expression menu and never replace the animated character.
      const frame = liveFrame(state, now - started, preferences.gaze ? gazeFrame : null, reduced.matches);
      const position = `${frame.column / 7 * 100}% ${frame.row / 10 * 100}%`;
      if (position !== lastFrame) {
        sprite.style.backgroundPosition = position;
        lastFrame = position;
      }
      if (drawFrame && !preferences.minimal) {
        try { drawFrame(frame, size.width, size.height - 26); }
        catch (error) { console.warn('DeskTalk avatar canvas fallback', error.name, error.message); drawFrame = null; root.classList.remove('ai-pet-clear'); }
      }
      root.dataset.petFrame = `${frame.row}:${frame.column}`;
      root.dataset.petExpression = expressionFor(flags, gesture, now - lastInteraction > 45000);
      root.dataset.petMotion = reduced.matches ? 'still' : movement || gesture || (flags.busy ? 'thinking' : flags.speaking ? 'talking' : 'idle');
      const text = flags.waiting ? "正在听你说" : flags.failed ? "连接遇到问题" : flags.busy ? "正在思考…" : flags.speaking ? "正在朗读…" : preparing ? "稍等，马上动起来～" : gesture ? reactionLabel : flags.unread ? "回复已就绪" : localOnly ? "AI · 本机功能" : "lion · AI 助手";
      label.textContent = text;
      toggle.setAttribute("aria-label", `lion AI 助手，${text}`);
      root.dataset.petState = state;
      if (!document.hidden && !preferences.minimal && !assetFailed && !reduced.matches) timer = setTimeout(render, 1000 / 60);
    }
    function stopWalk() { cancelAnimationFrame(walkFrame); strolling = false; movement = null; }
    function play(name, duration = 2400, message = '') {
      stopWalk(); clearTimeout(interactionTimer); clearTimeout(reactionTimer);
      clearTimeout(preparationTimer);
      const sequence = ++actionSequence;
      const start = () => {
        if (sequence !== actionSequence) return;
        preparing = false;
        if (document.hidden || preferences.minimal) { render(); return; }
        stopWalk(); gesture = name; lastInteraction = performance.now(); started = lastInteraction; animation = ''; gazeFrame = null;
        reactionLabel = message || reactions[name] || '陪着你一起学';
        fx.textContent = name === 'pat' ? '♡' : name === 'celebrate' || name === 'jumping' ? '✦' : name === 'poke' ? '!' : '';
        render();
        interactionTimer = setTimeout(() => { gesture = null; fx.textContent = ''; render(); }, duration);
      };
      const state = animationFor({}, null, name);
      const pending = drawFrame?.prepare?.({ row: animations[state]?.[0] || 0, column: 0 });
      if (pending) {
        preparing = true; gesture = null; fx.textContent = ''; render();
        // A bad connection must not leave interaction waiting indefinitely.
        const timeout = new Promise(done => { preparationTimer = setTimeout(done, 20000); });
        Promise.race([pending, timeout]).then(() => { if (sequence === actionSequence) { clearTimeout(preparationTimer); start(); } });
      } else start();
    }
    function scheduleWalk() {
      clearTimeout(wanderTimer);
      wanderTimer = setTimeout(() => {
        if (preferences.wander && !preferences.minimal && panel.hidden && menu.hidden && (!tip || tip.hidden) && !document.hidden && !drag && !gesture && !preparing && !flags.busy && !flags.speaking && !flags.waiting && !reduced.matches) {
          const initial = { ...position }, began = performance.now();
          // A small excursion in the owner's chosen corner, returning home.
          const distance = Math.min(52, Math.max(0, initial.x - 8));
          strolling = true;
          function step(now) {
            if (!strolling) return;
            const progress = Math.min(1, (now - began) / 3200);
            position.x = initial.x - Math.sin(progress * Math.PI) * distance;
            movement = progress < .5 ? 'running-left' : 'running-right';
            layout(); render();
            if (progress < 1) walkFrame = requestAnimationFrame(step);
            else { stopWalk(); render(); }
          }
          walkFrame = requestAnimationFrame(step);
        }
        scheduleWalk();
      }, 16000 + Math.random() * 8000);
    }
    function setMenu(open) { menu.hidden = !open; settings.setAttribute("aria-expanded", String(open)); if (open) layout(); }
    settings.addEventListener("click", () => setMenu(menu.hidden));
    tools.querySelector('.ai-pet-chat').addEventListener('click', () => { setMenu(false); stopWalk(); onChatToggle?.(); });
    tools.querySelectorAll("[data-pet-action]").forEach(button => {
      const index = expressions.indexOf(button.dataset.petAction === 'jumping' ? 'celebrate' : button.dataset.petAction);
      button.style.setProperty('--expression-x', `${index % 2 * 100}%`);
      button.style.setProperty('--expression-y', `${Math.floor(index / 2) / 3 * 100}%`);
      button.addEventListener("click", () => { play(button.dataset.petAction); setMenu(false); });
    });
    scale.addEventListener("change", () => { stopWalk(); preferences.scale = Number(scale.value); layout(); rememberPosition(); });
    wanderInput.addEventListener('change', () => { preferences.wander = wanderInput.checked; stopWalk(); save(); render(); scheduleWalk(); });
    reactionsInput.addEventListener('change', () => { preferences.reactions = reactionsInput.checked; save(); });
    gazeInput.addEventListener("change", () => { preferences.gaze = gazeInput.checked; gazeFrame = null; root.style.setProperty('--pet-look', '0deg'); root.style.setProperty('--pet-lift', '0px'); save(); render(); });
    minimize.addEventListener("click", () => { stopWalk(); preferences.minimal = !preferences.minimal; layout(); rememberPosition(); setMenu(false); render(); });
    tools.querySelector(".ai-pet-reset").addEventListener("click", () => { stopWalk(); preferences.position = null; layout(true); rememberPosition(); setMenu(false); });
    toggle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.isPrimary === false) return;
      stopWalk(); lastInteraction = performance.now();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { ...position }, moved: false };
      toggle.setPointerCapture(event.pointerId);
    });
    toggle.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true; movement = dx < 0 ? "running-left" : "running-right";
      clearTimeout(clickTimer);
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
      if (!event.detail || !onChatToggle) { if (panel.hidden) play('wave'); return; }
      event.preventDefault(); event.stopImmediatePropagation(); clearTimeout(clickTimer);
      if (event.detail > 1) { play('celebrate'); return; }
      const rect = sprite.getBoundingClientRect();
      const action = preferences.minimal || assetFailed ? 'chat' : interactionAt((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      clickTimer = setTimeout(() => {
        if (action === 'chat') { stopWalk(); onChatToggle(); }
        else play(action);
      }, action === 'chat' ? 550 : 160);
    }, true);
    document.addEventListener("pointerdown", event => { if (!tools.contains(event.target)) setMenu(false); });
    root.addEventListener("keydown", event => { if (event.key === "Escape") setMenu(false); });
    document.addEventListener("pointermove", event => {
      if (drag || strolling || !preferences.gaze || preferences.minimal || event.pointerType === "touch") return;
      cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        const rect = sprite.getBoundingClientRect();
        gazeFrame = lookAt(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
        const dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
        root.style.setProperty('--pet-look', `${reduced.matches || gesture ? 0 : Math.max(-2.5, Math.min(2.5, dx / 180))}deg`);
        root.style.setProperty('--pet-lift', `${reduced.matches || gesture ? 0 : Math.max(-2, Math.min(2, dy / 250))}px`);
        render();
      });
    }, { passive: true });
    document.addEventListener("pointerleave", () => { gazeFrame = null; root.style.setProperty('--pet-look', '0deg'); root.style.setProperty('--pet-lift', '0px'); render(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { stopWalk(); clearTimeout(clickTimer); } render(); });
    reduced.addEventListener("change", () => { stopWalk(); render(); });
    window.addEventListener("resize", () => { stopWalk(); layout(true); render(); });
    window.addEventListener('desktalk:answer', event => {
      if (!preferences.reactions || preferences.minimal || document.hidden) return;
      clearTimeout(reactionTimer);
      const correct = event.detail?.correct;
      if (typeof correct !== 'boolean') return;
      // Wrong-answer chat requests start on the same event. React after that
      // synchronous state update so the encouraging pose remains visible.
      reactionTimer = setTimeout(() => play(correct ? 'celebrate' : 'comfort', 3000, correct ? '答对啦，继续保持！' : ''), 0);
    });
    const panelObserver = new MutationObserver(() => {
      if (!panel.hidden) { stopWalk(); flags.unread = false; render(); }
      positionPanel();
    });
    panelObserver.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    if (tip) panelObserver.observe(tip, { attributes: true, attributeFilter: ["hidden"] });
    const image = new Image();
    try {
      drawFrame = frameRenderer(canvas, image,
        () => { if (assetFailed) { assetFailed = false; layout(); } render(); },
        quality => { root.dataset.petQuality = quality; root.classList.add('ai-pet-clear'); });
    } catch (_) { /* Keep the original CSS renderer as a usable fallback. */ }
    image.onload = render;
    image.onerror = () => { if (root.dataset.petQuality !== 'hd') { assetFailed = true; layout(); render(); } };
    image.src = new URL("assets/lion/spritesheet.webp", document.baseURI).href;
    const hd = new Image();
    hd.onload = () => { root.classList.add('ai-pet-hd-ready'); };
    hd.src = new URL('assets/lion/expressions-hd.png', document.baseURI).href;
    layout(true); render(); scheduleWalk();
    const api = {
      setProactiveEnabled(enabled) { if (proactiveInput) proactiveInput.checked = enabled; },
      updateState(next) { flags = { ...flags, ...next }; if (flags.busy) flags.unread = false; if (flags.busy || flags.waiting || flags.speaking) stopWalk(); render(); },
      notifyReply() {
        flags.unread = true; render(); clearTimeout(readyTimer);
        if (!panel.hidden) readyTimer = setTimeout(() => { flags.unread = false; render(); }, 1800);
      },
    };
    window.addEventListener("pagehide", () => { stopWalk(); clearTimeout(timer); clearTimeout(readyTimer); clearTimeout(wanderTimer); clearTimeout(interactionTimer); clearTimeout(reactionTimer); clearTimeout(clickTimer); clearTimeout(preparationTimer); actionSequence++; preparing = false; cancelAnimationFrame(pointerFrame); lastFrame = ''; gesture = null; animation = ''; fx.textContent = ''; });
    window.addEventListener("pageshow", () => { render(); scheduleWalk(); });
    root._deskTalkPet = api;
    return api;
  }
  window.DeskTalkPet = { mount, frameAt, lookAt, clampPosition, placePanel, resolveState, interactionAt, expressionFor, avatarSize, animationFor, liveFrame, clarifyFrame, hdFrameDescriptor, footBaseline };
})();
