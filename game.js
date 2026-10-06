(() => {
  "use strict";

  // Stage matches the flappybird.io column. Ground is a thin strip, like the grass.
  const BASE_W = 416;
  const BASE_H = 512;
  const GROUND_RATIO = 0.93;
  let W = BASE_W;
  let H = BASE_H;
  let GROUND_Y = Math.round(H * GROUND_RATIO);
  let sceneryReady = false;

  // Flappy-style hop. The opening tightens with the score, but stays clearable.
  const PIPE_W = Math.round(BASE_W * 0.15);
  const PIPE_GAP = Math.round(BASE_H * 0.30);
  const PIPE_SPACING = Math.round(BASE_W * 0.55);
  // Same hop as Flappy Bird: fixed upward speed, then a clean fall.
  const GRAVITY = 0.25;
  const FLAP_V = -4.6;
  const MAX_FALL = 9;
  const SPEED = BASE_W / 155;

  function worldScale() {
    return H / BASE_H;
  }
  const STEP = 1000 / 60;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const muteBtn = document.getElementById("muteBtn");

  const wrap = document.getElementById("wrap");

  function isPhoneLayout() {
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    return vw / vh < BASE_W / BASE_H - 0.01;
  }

  function fitFrame() {
    const phone = isPhoneLayout();
    document.body.classList.toggle("phone", phone);
    if (!phone) {
      wrap.style.top = "";
      wrap.style.left = "";
      wrap.style.width = "";
      wrap.style.height = "";
      return;
    }
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    wrap.style.top = (vv ? vv.offsetTop : 0) + "px";
    wrap.style.left = (vv ? vv.offsetLeft : 0) + "px";
    wrap.style.width = vw + "px";
    wrap.style.height = vh + "px";
  }

  function pickScale(w, h) {
    let scale = Math.max(1, Math.ceil(window.devicePixelRatio || 1) * 2);
    while (scale > 1 && w * scale * h * scale > 2500000) scale -= 1;
    return scale;
  }

  function clampScenery() {
    plankton.forEach((p) => {
      if (p.y < 0 || p.y > GROUND_Y) p.y = Math.random() * GROUND_Y;
    });
    fishes.forEach((f, i) => {
      if (f.y < 30 || f.y > GROUND_Y - 36) {
        f.y = GROUND_Y * (0.3 + i * 0.12);
      }
    });
  }

  function syncOkBtn() {
    okBtn.x = W / 2 - 52;
    okBtn.y = H <= BASE_H + 8 ? 330 : GROUND_Y * 0.82;
  }

  function readyLayout() {
    if (H <= BASE_H + 8) {
      return { title: 100, ready: 150, name: 200, tap: 300, best: 365, shark: H / 2 - 40 };
    }
    const water = GROUND_Y;
    return {
      title: water * 0.22,
      ready: water * 0.34,
      name: water * 0.46,
      tap: water * 0.68,
      best: water * 0.88,
      shark: water * 0.46,
    };
  }

  function resize() {
    fitFrame();
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const nextH = Math.max(BASE_H, Math.round(BASE_W * (rect.height / rect.width)));
    const scale = pickScale(BASE_W, nextH);
    W = BASE_W;
    H = nextH;
    GROUND_Y = Math.round(H * GROUND_RATIO);
    syncOkBtn();
    if (sceneryReady) clampScenery();
    const bw = Math.round(W * scale);
    const bh = Math.round(H * scale);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.imageSmoothingEnabled = true;
    }
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  if (window.visualViewport) {
    visualViewport.addEventListener("resize", resize);
    visualViewport.addEventListener("scroll", resize);
  }

  // Swim is an underwater glub (CC0); coin and crash are synthesized.
  const SFX = {
    flap: ["sfx/bubble-0.ogg", "sfx/bubble-1.ogg", "sfx/bubble-2.wav"],
  };
  const sfxRaw = {};
  for (const name of Object.keys(SFX)) {
    sfxRaw[name] = Promise.all(SFX[name].map((url) => fetch(url).then((r) => {
      if (!r.ok) throw new Error(url);
      return r.arrayBuffer();
    })));
  }

  const audio = {
    ctx: null,
    master: null,
    muted: localStorage.getItem("fs_muted") === "1",
    buffers: {},
    last: {},
    ready: null,
    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return Promise.resolve();
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1.35;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -8;
        comp.knee.value = 8;
        comp.ratio.value = 3;
        comp.attack.value = 0.003;
        comp.release.value = 0.12;
        this.master.connect(comp).connect(this.ctx.destination);
        this.ready = this.decode();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ready || Promise.resolve();
    },
    async decode() {
      for (const name of Object.keys(SFX)) {
        const raws = await sfxRaw[name];
        this.buffers[name] = [];
        for (const raw of raws) {
          const buf = await this.ctx.decodeAudioData(raw.slice(0));
          this.normalize(buf, 0.92);
          this.buffers[name].push(buf);
        }
      }
    },
    normalize(buf, target) {
      let peak = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const data = buf.getChannelData(c);
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      }
      if (peak < 0.001) return;
      const g = target / peak;
      if (g > 0.98 && g < 1.02) return;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const data = buf.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] *= g;
      }
    },
    play(name, gain, rate, vary, maxDur, delay) {
      if (this.muted) return;
      this.init().then(() => {
        if (this.muted || !this.ctx) return;
        const list = this.buffers[name];
        if (!list || !list.length) return;
        let i = Math.floor(Math.random() * list.length);
        if (list.length > 1 && i === this.last[name]) i = (i + 1) % list.length;
        this.last[name] = i;
        const src = this.ctx.createBufferSource();
        src.buffer = list[i];
        const playback = rate * (1 + (Math.random() * 2 - 1) * vary);
        src.playbackRate.value = playback;
        const g = this.ctx.createGain();
        const now = this.ctx.currentTime + (delay || 0);
        const heard = Math.min(src.buffer.duration, maxDur);
        const stopAt = now + heard / playback;
        g.gain.setValueAtTime(gain, now);
        g.gain.setValueAtTime(gain, Math.max(now, stopAt - 0.05));
        g.gain.linearRampToValueAtTime(0.001, stopAt);
        src.connect(g).connect(this.master);
        src.start(now);
        src.stop(stopAt + 0.02);
      }).catch(() => {});
    },
    tone(type, freq, start, dur, gain, endFreq) {
      const t = this.ctx.currentTime + start;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    synth(fn) {
      if (this.muted) return;
      this.init();
      if (this.ctx) fn();
    },
    flap() { this.play("flap", 1, 0.96, 0.03, 0.55); },
    point() {
      this.synth(() => {
        this.tone("square", 988, 0, 0.08, 0.16);
        this.tone("square", 1319, 0.08, 0.32, 0.16);
      });
    },
    hit() {
      this.synth(() => {
        const ctx = this.ctx;
        const len = Math.floor(ctx.sampleRate * 0.12);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = 0.5;
        src.connect(g).connect(this.master);
        src.start();
        this.tone("triangle", 160, 0, 0.18, 0.5, 60);
        this.tone("square", 523, 0.35, 0.16, 0.1);
        this.tone("square", 392, 0.52, 0.16, 0.1);
        this.tone("square", 262, 0.69, 0.4, 0.1);
      });
    },
    swoosh() { this.play("flap", 1, 0.9, 0.02, 0.5); },
  };

  function updateMuteBtn() { muteBtn.textContent = audio.muted ? "🔇" : "🔊"; }
  updateMuteBtn();
  function toggleMute() {
    audio.muted = !audio.muted;
    localStorage.setItem("fs_muted", audio.muted ? "1" : "0");
    updateMuteBtn();
  }

  // ---------- State ----------
  let state = "ready"; // ready | play | dying | over
  let paused = false;
  let frame = 0;
  let score = 0;
  let best = parseInt(localStorage.getItem("fs_best") || "0", 10);
  let isNewBest = false;
  let groundX = 0;
  let pipes = [];
  let flash = 0;
  let lastOpening = null;
  let shake = 0;
  let overTimer = 0;
  let deep = false;
  let skin = 0;

  const SKINS = [
    { name: "Hiu Selam", body: "#5b8db8", dark: "#3a6690", belly: "#eef6fb", gear: "goggles" },
    { name: "Hiu Ninja", body: "#7a7f94", dark: "#4d5266", belly: "#f2f2f5", gear: "headband" },
    { name: "Hiu Raja", body: "#6c5bb8", dark: "#463a8a", belly: "#f3efff", gear: "crown" },
    { name: "Hiu Neon", body: "#1fb5a5", dark: "#0f7d72", belly: "#e4fffb", gear: "glow" },
    { name: "Hiu Bajak", body: "#3e4a57", dark: "#222a33", belly: "#eceff1", gear: "bandana" },
    { name: "Hiu Robot", body: "#90a4ae", dark: "#546e7a", belly: "#f7f9fa", gear: "visor" },
    { name: "Hiu Api", body: "#ef6c00", dark: "#bf360c", belly: "#ffe0b2", gear: "flame" },
    { name: "Hiu Es", body: "#81d4fa", dark: "#0277bd", belly: "#f5fdff", gear: "crystal" },
    { name: "Hiu Koki", body: "#f5f0e6", dark: "#b7aa96", belly: "#fffdf8", gear: "toque" },
    { name: "Hiu Galaksi", body: "#6a3ec8", dark: "#3d2380", belly: "#e1d5f5", gear: "planet" },
  ];

  const shark = { x: Math.round(BASE_W * 0.22), y: 0, vy: 0, rot: 0, r: 12 };
  const okBtn = { x: W / 2 - 52, y: 330, w: 104, h: 36 };

  let bubbles = [];
  const plankton = Array.from({ length: 45 }, () => ({
    x: Math.random() * W,
    y: Math.random() * GROUND_Y,
    s: Math.random() * 1.6 + 0.6,
    p: Math.random() * Math.PI * 2,
  }));
  const fishes = Array.from({ length: 4 }, (_, i) => ({
    x: Math.random() * W,
    y: 180 + i * 45 + Math.random() * 20,
    s: 0.25 + Math.random() * 0.35,
    size: 5 + Math.random() * 4,
  }));
  const weeds = Array.from({ length: Math.ceil(W / 36) }, (_, i) => ({
    x: i * 36 + Math.random() * 14,
    h: 8 + Math.random() * 14,
    p: Math.random() * 6,
  }));

  function difficulty() {
    return Math.min(1, Math.floor(score / 10) / 4);
  }

  function scrollSpeed() {
    return SPEED * (1 + difficulty() * 0.36);
  }

  function pipeSpacing() {
    return PIPE_SPACING * (1 - difficulty() * 0.14);
  }

  function gapSize() {
    const k = worldScale();
    return (PIPE_GAP - 12 - difficulty() * 36) * k;
  }

  function reset() {
    state = "ready";
    score = 0;
    isNewBest = false;
    pipes = [];
    lastOpening = null;
    bubbles = [];
    shark.y = readyLayout().shark;
    shark.vy = 0;
    shark.rot = 0;
    overTimer = 0;
    deep = Math.random() < 0.4;
    skin = Math.floor(Math.random() * SKINS.length);
  }

  function spawnPipe(x) {
    const k = worldScale();
    const gap = gapSize();
    const topMin = H * 0.07;
    const bottomLimit = GROUND_Y - H * 0.2;
    const topMax = Math.max(topMin, bottomLimit - gap);
    const v = Math.abs(FLAP_V) * k;
    const g = GRAVITY * k;
    const climb = (v * v) / (2 * g);
    const frames = pipeSpacing() / scrollSpeed();
    const taps = Math.max(2, frames / 16);
    const reach = climb * taps * (0.48 + difficulty() * 0.2);
    let center = topMin + gap / 2 + Math.random() * Math.max(0, topMax - topMin);
    if (lastOpening != null) {
      const lo = Math.max(topMin + gap / 2, lastOpening - reach);
      const hi = Math.min(topMax + gap / 2, lastOpening + reach);
      center = lo + Math.random() * Math.max(0, hi - lo);
    }
    lastOpening = center;
    const top = center - gap / 2;
    const spots = Array.from({ length: 10 }, () => ({
      dx: 6 + Math.random() * (PIPE_W - 12),
      dy: Math.random(),
      r: 2 + Math.random() * 3,
    }));
    const hue = Math.random() < 0.5 ? "#ff7aa8" : "#ff9d5c";
    pipes.push({ x, top, gap, passed: false, spots, coral: hue });
  }

  function addBubbles(n, x, y, spread = 4) {
    for (let i = 0; i < n; i++) {
      bubbles.push({
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        r: 1.5 + Math.random() * 2.5,
        vy: -0.4 - Math.random() * 0.8,
        life: 60 + Math.random() * 40,
      });
    }
  }

  function flap() {
    const k = worldScale();
    shark.vy = FLAP_V * k;
    audio.flap();
    const tx = shark.x - Math.cos(shark.rot) * 18 * k;
    const ty = shark.y - Math.sin(shark.rot) * 18 * k;
    addBubbles(4, tx, ty, 4 * k);
  }

  // ---------- Input ----------
  function toLogical(evt) {
    const rect = canvas.getBoundingClientRect();
    const p = evt.touches ? evt.touches[0] : evt;
    return {
      x: ((p.clientX - rect.left) / rect.width) * W,
      y: ((p.clientY - rect.top) / rect.height) * H,
    };
  }

  function inRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  function beginPlay() {
    state = "play";
    spawnPipe(W + 200);
    spawnPipe(W + 200 + PIPE_SPACING);
    flap();
  }

  function action(pos) {
    audio.init();
    if (paused) { paused = false; return; }
    switch (state) {
      case "ready":
        beginPlay();
        break;
      case "play":
        flap();
        break;
      case "over":
        if (overTimer < 40) return;
        if (!pos || inRect(pos, okBtn)) {
          audio.swoosh();
          reset();
          beginPlay();
        }
        break;
    }
  }

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    action(toLogical(e));
  });
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    action(toLogical(e));
  }, { passive: false });
  muteBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleMute(); muteBtn.blur(); });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW" || e.code === "Enter") {
      e.preventDefault();
      if (e.repeat) return;
      action(null);
    } else if (e.code === "KeyP" || e.code === "Escape") {
      if (state === "play") paused = !paused;
    } else if (e.code === "KeyM") {
      toggleMute();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "play") paused = true;
  });

  // ---------- Update ----------
  // Shark hitbox: two circles along the body axis (head + torso).
  function sharkCircles() {
    const k = worldScale();
    const c = Math.cos(shark.rot), s = Math.sin(shark.rot);
    return [
      { x: shark.x + c * 8 * k, y: shark.y + s * 8 * k, r: 10 * k },
      { x: shark.x - c * 8 * k, y: shark.y - s * 8 * k, r: 9 * k },
    ];
  }

  function hitTest(p) {
    const gap = p.gap || PIPE_GAP;
    const rects = [
      { x: p.x, y: 0, w: PIPE_W, h: p.top },
      { x: p.x, y: p.top + gap, w: PIPE_W, h: GROUND_Y - p.top - gap },
    ];
    return sharkCircles().some((ci) =>
      rects.some((rc) => {
        const cx = Math.max(rc.x, Math.min(ci.x, rc.x + rc.w));
        const cy = Math.max(rc.y, Math.min(ci.y, rc.y + rc.h));
        return (ci.x - cx) ** 2 + (ci.y - cy) ** 2 < ci.r * ci.r;
      })
    );
  }

  function die() {
    state = "dying";
    flash = 10;
    shake = 12;
    audio.hit();
    addBubbles(12, shark.x, shark.y, 16);
  }

  function update() {
    frame++;
    if (flash > 0) flash--;
    if (shake > 0) shake--;

    const moving = state === "ready" || state === "play";
    const flow = scrollSpeed();
    if (moving) {
      groundX -= flow;
      fishes.forEach((f) => {
        f.x -= f.s;
        if (f.x < -20) {
          f.x = W + 20;
          f.y = 70 + Math.random() * Math.max(80, GROUND_Y * 0.55);
        }
      });
      weeds.forEach((w) => { w.x -= flow; if (w.x < -10) w.x += W + 30; });
    }

    for (const b of bubbles) {
      b.y += b.vy;
      b.x += Math.sin((frame + b.y) / 10) * 0.3 - (moving ? flow * 0.5 : 0);
      b.life--;
    }
    bubbles = bubbles.filter((b) => b.life > 0 && b.y > -10);
    if (frame % 25 === 0) addBubbles(1, Math.random() * W, GROUND_Y + 4, 2);

    if (state === "ready") {
      shark.y = readyLayout().shark + Math.sin(frame / 10) * 6;
      shark.rot = Math.sin(frame / 20) * 0.08;
      if (frame % 40 === 0) addBubbles(1, shark.x + 18 * worldScale(), shark.y - 2, 2);
      return;
    }

    if (state === "play" || state === "dying") {
      const k = worldScale();
      shark.vy = Math.min(shark.vy + GRAVITY * k, MAX_FALL * k);
      shark.y += shark.vy;
      if (shark.vy < 0) shark.rot = Math.max(-0.45, shark.rot - 0.15);
      else if (shark.vy > 3 * k) shark.rot = Math.min(Math.PI / 2, shark.rot + 0.08);
      if (shark.y < -20 * k) { shark.y = -20 * k; shark.vy = 0; }
    }

    if (state === "play") {
      for (const p of pipes) {
        p.x -= flow;
        if (!p.passed && p.x + PIPE_W < shark.x) {
          p.passed = true;
          score++;
          audio.point();
        }
        if (hitTest(p)) { die(); break; }
      }
      if (pipes.length && pipes[0].x < -PIPE_W - 10) pipes.shift();
      const last = pipes[pipes.length - 1];
      if (last && last.x <= W + 10 - pipeSpacing()) spawnPipe(last.x + pipeSpacing());
    }

    if ((state === "play" || state === "dying") && shark.y + shark.r * worldScale() >= GROUND_Y) {
      shark.y = GROUND_Y - shark.r * worldScale();
      if (state === "play") die();
      gameOver();
    }

    if (state === "over") overTimer++;
  }

  function gameOver() {
    state = "over";
    overTimer = 0;
    if (score > best) {
      best = score;
      isNewBest = true;
      localStorage.setItem("fs_best", String(best));
    }
  }

  // ---------- Drawing ----------
  function drawSea() {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    if (deep) { g.addColorStop(0, "#04132b"); g.addColorStop(1, "#0a3550"); }
    else { g.addColorStop(0, "#3fc1d9"); g.addColorStop(0.6, "#1a8fb8"); g.addColorStop(1, "#0f6f99"); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND_Y);

    if (!deep) {
      // sunlight rays
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < Math.ceil(W / 60); i++) {
        const x = 30 + i * 60 + Math.sin(frame / 90 + i) * 12;
        const rg = ctx.createLinearGradient(0, 0, 0, GROUND_Y * 0.8);
        rg.addColorStop(0, "rgba(255,255,255,0.14)");
        rg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.moveTo(x - 10, 0); ctx.lineTo(x + 14, 0);
        ctx.lineTo(x + 50, GROUND_Y * 0.8); ctx.lineTo(x + 10, GROUND_Y * 0.8);
        ctx.fill();
      }
      ctx.restore();
      // surface ripple
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 6) ctx.lineTo(x, 4 + Math.sin(x / 14 + frame / 15) * 2);
      ctx.stroke();
    } else {
      plankton.forEach((p) => {
        ctx.globalAlpha = 0.35 + 0.4 * Math.sin(frame / 25 + p.p);
        ctx.fillStyle = "#7fffe6";
        ctx.beginPath(); ctx.arc(p.x, p.y + Math.sin(frame / 40 + p.p) * 3, p.s, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    // distant fish silhouettes
    ctx.fillStyle = deep ? "rgba(120,200,255,0.18)" : "rgba(0,60,100,0.25)";
    fishes.forEach((f) => {
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, f.size, f.size * 0.5, 0, 0, Math.PI * 2);
      ctx.moveTo(f.x + f.size * 0.8, f.y);
      ctx.lineTo(f.x + f.size * 1.6, f.y - f.size * 0.5);
      ctx.lineTo(f.x + f.size * 1.6, f.y + f.size * 0.5);
      ctx.fill();
    });

    // far reef silhouette
    ctx.fillStyle = deep ? "#082a40" : "#13759a";
    const off = ((groundX * 0.3) % 60 + 60) % 60;
    for (let x = off - 60; x < W + 60; x += 30) {
      const k = Math.abs(Math.round((x - off) / 30)) % 4;
      const h = [26, 40, 32, 48][k];
      ctx.beginPath();
      ctx.ellipse(x, GROUND_Y, 20, h, 0, Math.PI, 0);
      ctx.fill();
    }
  }

  function drawRock(x, y, w, h, p, flipY) {
    if (h <= 0) return;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#5a4a6e");
    g.addColorStop(0.35, "#8c79a3");
    g.addColorStop(1, "#43355a");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = "rgba(30,20,45,0.3)";
    p.spots.forEach((s) => {
      const sy = flipY ? y + h - s.dy * h : y + s.dy * h;
      ctx.beginPath(); ctx.arc(x + s.dx, sy, s.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();

    ctx.strokeStyle = "#2a1f3a";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function drawCoralLip(x, y, w, h, color, dir, k) {
    // dir: -1 = coral grows upward (bottom pillar), 1 = grows downward (top pillar)
    ctx.fillStyle = color;
    ctx.strokeStyle = "#7a2347";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();

    const edge = dir === 1 ? y + h : y;
    const bump = 5 * k;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const cx = x + bump + i * ((w - bump * 2) / 4);
      ctx.moveTo(cx + bump, edge);
      ctx.arc(cx, edge, bump, 0, Math.PI * 2);
    }
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(x + (8 + i * 12) * k, y + h / 2, 2 * k, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawPipe(p) {
    const k = (p.gap || PIPE_GAP) / PIPE_GAP;
    const lipH = PIPE_W * 0.22 * k, lipOver = PIPE_W * 0.05;
    const bottomY = p.top + (p.gap || PIPE_GAP);
    drawRock(p.x, -2, PIPE_W, p.top - lipH + 2, p, false);
    drawRock(p.x, bottomY + lipH, PIPE_W, GROUND_Y - bottomY - lipH, p, true);

    // hanging seaweed on the top pillar
    ctx.strokeStyle = "#3fae5a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < 2; i++) {
      const sx = p.x + 14 + i * 22;
      ctx.beginPath();
      ctx.moveTo(sx, p.top - lipH);
      ctx.quadraticCurveTo(sx + Math.sin(frame / 15 + i) * 6, p.top - lipH + 10, sx + Math.sin(frame / 12 + i) * 4, p.top - lipH + 2);
      ctx.stroke();
    }

    drawCoralLip(p.x - lipOver, p.top - lipH, PIPE_W + lipOver * 2, lipH, p.coral, 1, k);
    drawCoralLip(p.x - lipOver, bottomY, PIPE_W + lipOver * 2, lipH, p.coral, -1, k);
  }

  function drawGround() {
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, "#f2d48a");
    g.addColorStop(1, "#c9a55c");
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    // sand ripples
    ctx.strokeStyle = "rgba(150,110,50,0.35)";
    ctx.lineWidth = 2;
    const off = ((groundX % 40) + 40) % 40;
    for (let row = 0; row < 4; row++) {
      ctx.beginPath();
      for (let x = off - 40; x < W + 40; x += 40) {
        const y = GROUND_Y + 22 + row * 22;
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 10, y - 5, x + 20, y);
        ctx.quadraticCurveTo(x + 30, y + 5, x + 40, y);
      }
      ctx.stroke();
    }

    // shells & starfish
    const deco = ((groundX % 144) + 144) % 144;
    for (let x = deco - 144; x < W + 144; x += 144) {
      drawStar(x + 30, GROUND_Y + 40, 7);
      drawShell(x + 100, GROUND_Y + 72);
    }

    ctx.fillStyle = "#3d2b1f";
    ctx.fillRect(0, GROUND_Y - 1, W, 2);

    // seaweed
    ctx.lineCap = "round";
    weeds.forEach((w) => {
      ctx.strokeStyle = "#2f9e4f";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(w.x, GROUND_Y + 2);
      const sway = Math.sin(frame / 20 + w.p) * 6;
      ctx.quadraticCurveTo(w.x - sway, GROUND_Y - w.h / 2, w.x + sway, GROUND_Y - w.h);
      ctx.stroke();
    });
  }

  function drawStar(x, y, r) {
    ctx.fillStyle = "#ff8a65";
    ctx.strokeStyle = "#b54a2e";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  function drawShell(x, y) {
    ctx.fillStyle = "#fff0e0";
    ctx.strokeStyle = "#c4936a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 7, Math.PI, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) { ctx.moveTo(x, y); ctx.lineTo(x + i * 3, y - 6); }
    ctx.stroke();
  }

  function drawBubbles() {
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    bubbles.forEach((b) => {
      ctx.globalAlpha = Math.min(1, b.life / 30);
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath(); ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.3, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawShark() {
    const s = SKINS[skin];
    const alive = state === "ready" || state === "play";
    const dead = state === "dying" || state === "over";
    const tailSwing = alive ? Math.sin(frame / 4) * 0.35 : 0;
    const finFlap = alive ? Math.sin(frame / 3) : 0;

    ctx.save();
    ctx.translate(shark.x, shark.y);
    ctx.rotate(shark.rot);
    ctx.scale(worldScale(), worldScale());
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#1b2433";
    ctx.lineJoin = "round";

    if (s.gear === "glow" || s.gear === "planet") {
      ctx.shadowColor = s.gear === "glow" ? "#5fffe9" : "#d1b3ff";
      ctx.shadowBlur = 14;
    }

    // tail fin
    ctx.save();
    ctx.translate(-14, 0);
    ctx.rotate(tailSwing);
    ctx.fillStyle = s.dark;
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-10, -11);
    ctx.quadraticCurveTo(-6, 0, -9, 9);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // dorsal fin
    ctx.fillStyle = s.dark;
    ctx.beginPath();
    ctx.moveTo(-6, -8);
    ctx.quadraticCurveTo(-3, -20, 4, -19);
    ctx.quadraticCurveTo(1, -13, 4, -8);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // body
    ctx.fillStyle = s.body;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.quadraticCurveTo(-8, -11, 6, -10);
    ctx.quadraticCurveTo(18, -8, 19, 1);
    ctx.quadraticCurveTo(17, 9, 4, 10);
    ctx.quadraticCurveTo(-8, 10, -16, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    // belly
    ctx.fillStyle = s.belly;
    ctx.beginPath();
    ctx.moveTo(-10, 3);
    ctx.quadraticCurveTo(2, 11, 16, 4);
    ctx.quadraticCurveTo(4, 7, -10, 3);
    ctx.fill();

    // neon stripe
    if (s.gear === "glow") {
      ctx.strokeStyle = "#b6fff4";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-12, -1); ctx.quadraticCurveTo(0, -6, 14, -4);
      ctx.stroke();
      ctx.strokeStyle = "#1b2433";
    } else if (s.gear === "planet") {
      ctx.fillStyle = "#fff59d";
      [[-8, -2], [1, 3], [7, -5]].forEach(([sx, sy]) => ctx.fillRect(sx, sy, 1.5, 1.5));
    } else if (s.gear === "visor") {
      ctx.strokeStyle = "#78909c";
      ctx.beginPath();
      ctx.moveTo(-10, -3); ctx.lineTo(-3, -3); ctx.lineTo(-5, 3);
      ctx.stroke();
      ctx.strokeStyle = "#1b2433";
    } else if (s.gear === "crystal") {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.ellipse(-4, -4, 3.2, 1.2, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // gills
    ctx.strokeStyle = s.dark;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-1 - i * 3, -3);
      ctx.quadraticCurveTo(-3 - i * 3, 0, -1 - i * 3, 3);
      ctx.stroke();
    }
    ctx.strokeStyle = "#1b2433";
    ctx.lineWidth = 1.5;

    // pectoral fin
    ctx.fillStyle = s.dark;
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.lineTo(-7, 12 + finFlap * 3);
    ctx.lineTo(4, 8);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // mouth with teeth
    ctx.fillStyle = "#7a1f2b";
    ctx.beginPath();
    ctx.moveTo(8, 4);
    ctx.quadraticCurveTo(13, 8, 18, 3);
    ctx.lineTo(8, 4);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 3; i++) {
      const tx = 9.5 + i * 2.8;
      ctx.beginPath();
      ctx.moveTo(tx, 3.8); ctx.lineTo(tx + 1.2, 6); ctx.lineTo(tx + 2.4, 3.6);
      ctx.fill();
    }

    // eye
    if (dead) {
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(8, -6); ctx.lineTo(13, -1);
      ctx.moveTo(13, -6); ctx.lineTo(8, -1);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(10.5, -3.5, 3.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(11.5, -3.5, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(12, -4.3, 0.6, 0, Math.PI * 2); ctx.fill();
    }

    drawGear(s.gear, dead);
    ctx.restore();
  }

  function drawGear(gear, dead) {
    ctx.strokeStyle = "#1b2433";
    ctx.lineWidth = 1.5;
    if (gear === "goggles") {
      ctx.strokeStyle = "#ffb300";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, -7); ctx.quadraticCurveTo(2, -10, 7, -6);
      ctx.stroke();
      ctx.fillStyle = "rgba(160,230,255,0.45)";
      ctx.strokeStyle = "#ffb300";
      ctx.beginPath(); ctx.ellipse(10.5, -3.5, 5.5, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // snorkel
      ctx.strokeStyle = "#ff5252";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(4, -8); ctx.lineTo(3, -17); ctx.lineTo(7, -18);
      ctx.stroke();
    } else if (gear === "headband") {
      ctx.fillStyle = "#e53935";
      ctx.beginPath();
      ctx.moveTo(4, -10); ctx.lineTo(17, -6); ctx.lineTo(17, -2.5); ctx.lineTo(4, -6.5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      const flutter = state === "play" || state === "ready" ? Math.sin(frame / 3) * 3 : 4;
      ctx.beginPath();
      ctx.moveTo(4, -8);
      ctx.lineTo(-6, -14 + flutter);
      ctx.lineTo(-4, -10 + flutter);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (gear === "crown") {
      ctx.save();
      ctx.translate(6, -10);
      ctx.rotate(dead ? 0.6 : -0.15);
      ctx.fillStyle = "#ffd54f";
      ctx.beginPath();
      ctx.moveTo(-5, 0); ctx.lineTo(-5, -6); ctx.lineTo(-2.5, -3);
      ctx.lineTo(0, -8); ctx.lineTo(2.5, -3); ctx.lineTo(5, -6); ctx.lineTo(5, 0);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#e53935";
      ctx.beginPath(); ctx.arc(0, -2, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (gear === "bandana") {
      ctx.fillStyle = "#e53935";
      ctx.beginPath();
      ctx.moveTo(-1, -9); ctx.quadraticCurveTo(8, -15, 18, -6);
      ctx.lineTo(16, -3); ctx.quadraticCurveTo(8, -9, 1, -6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      const flutter = state === "play" || state === "ready" ? Math.sin(frame / 3) * 2 : 2;
      ctx.beginPath();
      ctx.moveTo(-1, -8); ctx.lineTo(-8, -13 + flutter); ctx.lineTo(-5, -6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#1b2433";
      ctx.beginPath();
      ctx.ellipse(10.5, -3.5, 4.4, 3.5, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(5, -7); ctx.lineTo(16, 1);
      ctx.stroke();
      ctx.fillStyle = "#ffd54f";
      ctx.beginPath(); ctx.arc(16, 2, 1.1, 0, Math.PI * 2); ctx.fill();
    } else if (gear === "visor") {
      ctx.fillStyle = "#81d4fa";
      ctx.strokeStyle = "#37474f";
      ctx.beginPath();
      ctx.rect(6.5, -7, 8.5, 6);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#cfd8dc";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(9, -11); ctx.lineTo(9, -16);
      ctx.stroke();
      ctx.fillStyle = frame % 28 < 14 ? "#ff5252" : "#69f0ae";
      ctx.beginPath(); ctx.arc(9, -16.6, 1.5, 0, Math.PI * 2); ctx.fill();
    } else if (gear === "flame") {
      const flick = Math.sin(frame / 3);
      ctx.strokeStyle = "#e65100";
      for (let i = 0; i < 3; i++) {
        const x = -4 + i * 4.5;
        const h = (i === 1 ? 12 : 8) + flick * (i === 1 ? 2 : 1);
        ctx.fillStyle = i === 1 ? "#fff176" : "#ff9800";
        ctx.beginPath();
        ctx.moveTo(x, -11);
        ctx.quadraticCurveTo(x + 3, -11 - h, x + 6, -11);
        ctx.quadraticCurveTo(x + 3, -15, x, -11);
        ctx.fill(); ctx.stroke();
      }
    } else if (gear === "crystal") {
      ctx.fillStyle = "#e0f7fa";
      ctx.strokeStyle = "#00acc1";
      ctx.beginPath();
      ctx.moveTo(7, -10); ctx.lineTo(10, -19); ctx.lineTo(14, -10);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(3, -9); ctx.lineTo(5.5, -15); ctx.lineTo(8, -9);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (gear === "toque") {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(7, -15, 7, 4.5, 0, Math.PI, 0);
      ctx.lineTo(14, -12); ctx.lineTo(0, -12);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillRect(1.5, -13, 11, 4);
      ctx.strokeRect(1.5, -13, 11, 4);
    } else if (gear === "planet") {
      ctx.fillStyle = "#7e57c2";
      ctx.beginPath(); ctx.arc(8, -16, 3.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#ffe082";
      ctx.beginPath(); ctx.ellipse(8, -16, 6.2, 2.1, 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "#1b2433";
    }
  }

  function text(str, x, y, size, fill = "#fff", align = "center", stroke = "#0b2a3d") {
    ctx.font = `900 ${size}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, size / 6);
    ctx.strokeStyle = stroke;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(str, x, y);
  }

  function roundRect(x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function drawReady() {
    const ui = readyLayout();
    text("StupidShark", W / 2, ui.title, 34, "#ffde59");
    text("Get Ready!", W / 2, ui.ready, 24, "#7ef0d0");
    text(SKINS[skin].name, W / 2, ui.name, 14, "#fff");

    const y = ui.tap + Math.sin(frame / 10) * 3;
    roundRect(W / 2 - 50, y - 20, 100, 40, 10, "rgba(255,255,255,0.8)", "#0b2a3d");
    text("TAP", W / 2, y, 20, "#ff7043", "center", "#fff");
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(W / 2, y - 34); ctx.lineTo(W / 2 - 8, y - 24); ctx.lineTo(W / 2 + 8, y - 24); ctx.closePath();
    ctx.fill();
    text(`Best: ${best}`, W / 2, ui.best, 16, "#fff");
  }

  function medalFor(s) {
    if (s >= 40) return { name: "Mutiara", c1: "#f5f0ff", c2: "#b9a8d9" };
    if (s >= 30) return { name: "Gold", c1: "#ffd54f", c2: "#c79100" };
    if (s >= 20) return { name: "Silver", c1: "#e0e0e0", c2: "#8e8e8e" };
    if (s >= 10) return { name: "Bronze", c1: "#e0a060", c2: "#8d5524" };
    return null;
  }

  function drawOver() {
    const t = Math.min(1, overTimer / 25);
    const ease = 1 - Math.pow(1 - t, 3);

    const tall = H > BASE_H + 8;
    const titleY = tall ? GROUND_Y * 0.22 : 120;
    const py = (tall ? GROUND_Y * 0.36 : 170) + (1 - ease) * (tall ? 80 : 300);
    text("Game Over", W / 2, titleY - (1 - ease) * 30, 36, "#ff8a3d");
    const panelW = Math.min(W - 80, 360);
    const panelX = (W - panelW) / 2;
    roundRect(panelX, py, panelW, 116, 8, "#e9f7fb", "#0b2a3d");
    roundRect(panelX + 6, py + 6, panelW - 12, 104, 6, null, "#8fc9dc");

    const medalX = panelX + 52;
    const scoreX = panelX + panelW - 24;
    text("MEDAL", medalX, py + 22, 12, "#1a8fb8", "center", "#fff");
    text("SCORE", scoreX, py + 22, 12, "#1a8fb8", "center", "#fff");
    text("BEST", scoreX, py + 66, 12, "#1a8fb8", "center", "#fff");

    const shown = overTimer > 25 ? Math.min(score, Math.floor((overTimer - 25) / 2)) : 0;
    text(String(shown), scoreX, py + 44, 22);
    text(String(best), scoreX, py + 88, 22);

    if (isNewBest && overTimer > 25) {
      roundRect(scoreX - 64, py + 58, 30, 14, 3, "#ff3b3b");
      ctx.font = "bold 9px Arial"; ctx.fillStyle = "#fff"; ctx.textAlign = "center";
      ctx.fillText("NEW", scoreX - 49, py + 65);
    }

    const m = medalFor(score);
    const mx = medalX, my = py + 66;
    ctx.beginPath(); ctx.arc(mx, my, 24, 0, Math.PI * 2);
    ctx.fillStyle = m ? m.c1 : "#cfe6ee"; ctx.fill();
    if (m) {
      ctx.strokeStyle = m.c2; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(mx, my, 15, 0, Math.PI * 2);
      ctx.fillStyle = m.c2; ctx.fill();
      const sparkle = (frame / 6) % (Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = Math.abs(Math.sin(sparkle));
      ctx.fillRect(mx - 12 + Math.cos(sparkle) * 4, my - 12, 3, 3);
      ctx.globalAlpha = 1;
      ctx.font = "bold 8px Arial"; ctx.fillStyle = "#fff"; ctx.textAlign = "center";
      ctx.fillText(m.name.toUpperCase(), mx, my + 1);
    }

    if (overTimer >= 40) {
      roundRect(okBtn.x, okBtn.y, okBtn.w, okBtn.h, 6, "#fff", "#0b2a3d");
      roundRect(okBtn.x + 3, okBtn.y + 3, okBtn.w - 6, okBtn.h - 6, 4, "#1a8fb8");
      text("PLAY", W / 2, okBtn.y + okBtn.h / 2 + 1, 18, "#fff", "center", "#0b2a3d");
    }
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    drawSea();
    pipes.forEach(drawPipe);
    drawGround();
    drawBubbles();
    drawShark();

    if (state === "play" || state === "dying") {
      text(String(score), W / 2, H * 0.11, Math.round(52 * worldScale()), "#fff", "center", "#000");
    }
    if (state === "ready") drawReady();
    if (state === "over") drawOver();

    ctx.restore();

    if (paused) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, W, H);
      text("PAUSED", W / 2, H / 2, 32);
    }

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash / 10})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- Loop (fixed timestep) ----------
  let last = performance.now();
  let acc = 0;
  function loop(now) {
    acc += Math.min(now - last, 34);
    last = now;
    while (acc >= STEP) {
      if (!paused) update();
      acc -= STEP;
    }
    render();
    requestAnimationFrame(loop);
  }

  sceneryReady = true;
  resize();
  reset();
  requestAnimationFrame(loop);
})();
