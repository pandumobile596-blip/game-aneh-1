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

  // Same world as flappybird.io: 1.44 by 2.56, simulated at 120Hz.
  const WORLD_W = 1.44;
  const WORLD_H = 2.56;
  const GRAVITY_U = 5;
  const FLAP_U = 1.4;
  const FALL_CAP_U = 2.2;
  const SCROLL_U = 0.6;
  const OPENING_GAPS = [0.62, 0.59, 0.56, 0.53, 0.5];

  function ppu() {
    return Math.min(W / WORLD_W, H / WORLD_H);
  }
  function pipeW() {
    return 0.26 * ppu();
  }

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
      return { title: 100, ready: 150, name: 200, tap: 300, best: 365, shark: H / 2 };
    }
    const water = GROUND_Y;
    return {
      title: water * 0.22,
      ready: water * 0.34,
      name: water * 0.46,
      tap: water * 0.68,
      best: water * 0.88,
      shark: H / 2,
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
    GROUND_Y = Math.min(H - 12, Math.round(H / 2 + 0.975 * ppu()));
    shark.x = Math.round(W * 0.271);
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

  const audio = {
    ctx: null,
    master: null,
    muted: localStorage.getItem("fs_muted") === "1",
    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.28;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -28;
        comp.knee.value = 8;
        comp.ratio.value = 1.6;
        comp.attack.value = 0.002;
        comp.release.value = 0.08;
        this.master.connect(comp).connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },
    tone(type, freq, start, dur, gain, endFreq) {
      const t = this.ctx.currentTime + start;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t + dur);
      g.gain.setValueAtTime(Math.max(gain, 0.0001), t);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    synth(fn) {
      if (this.muted) return;
      this.init();
      if (!this.ctx) return;
      const run = () => { try { fn(); } catch (err) { /* skip a failed blip */ } };
      if (this.ctx.state === "running") run();
      else {
        const pending = this.ctx.resume();
        if (pending && pending.then) pending.then(run);
        else run();
      }
    },
    burst(gain, dur) {
      this.synth(() => {
        const ctx = this.ctx;
        const now = ctx.currentTime;
        const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          const env = 1 - i / len;
          data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, now);
        g.gain.linearRampToValueAtTime(0.0001, now + dur);
        src.connect(g).connect(this.master);
        src.start(now);
        src.stop(now + dur + 0.02);
      });
    },
    flap() {},
    point() {
      this.synth(() => {
        this.tone("sine", 988, 0, 0.07, 0.16);
        this.tone("sine", 1318, 0.06, 0.12, 0.12);
      });
    },
    hit() {
      this.burst(0.28, 0.16);
      this.synth(() => this.tone("triangle", 240, 0, 0.22, 0.18, 70));
    },
    swoosh() { this.burst(0.2, 0.14); },
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

  const shark = { x: Math.round(BASE_W * 0.22), y: 0, vy: 0, rot: 0, r: 8 };
  const okBtn = { x: W / 2 - 52, y: 330, w: 104, h: 36 };
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

  let runFrames = 0;
  let spawnCount = 0;

  function pressure() {
    const seconds = runFrames / 60;
    return Math.log2(1 + score / 6) + Math.log2(1 + seconds / 20) * 0.4;
  }

  function scrollSpeed() {
    return (SCROLL_U * ppu() / 60) * (1 + pressure() * 0.16);
  }

  function pipeSpacing() {
    return ppu() * Math.max(0.52, 1 - pressure() * 0.04);
  }

  function gapSize() {
    const opening = spawnCount < OPENING_GAPS.length ? OPENING_GAPS[spawnCount] : 0.47;
    return Math.max(0.29, opening - pressure() * 0.022) * ppu();
  }

  function reset() {
    state = "ready";
    score = 0;
    isNewBest = false;
    pipes = [];
    lastOpening = null;
    shark.y = readyLayout().shark;
    shark.vy = 0;
    shark.rot = 0;
    overTimer = 0;
    runFrames = 0;
    spawnCount = 0;
    deep = false;
  }

  function spawnPipe(x) {
    const gap = gapSize();
    const half = gap / 2;
    const spread = Math.min(0.45, pressure() * 0.035);
    const yHi = H / 2 + (0.2 + spread) * ppu();
    const yLo = H / 2 - (0.8 + spread * 0.6) * ppu();
    const minC = Math.max(10 + half, yLo);
    const maxC = Math.min(GROUND_Y - 10 - half, yHi);
    const center = minC + Math.random() * Math.max(0, maxC - minC);
    const openY = lastOpening == null ? center : lastOpening;
    lastOpening = center;
    const top = center - half;
    pipes.push({ x, top, gap, passed: false, coinTaken: false, openY, bull: center < openY });
    spawnCount++;
  }

  function flap() {
    shark.vy = FLAP_U;
    audio.flap();
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
      { x: shark.x + c * 6 * k, y: shark.y + s * 6 * k, r: 7 * k },
      { x: shark.x - c * 6 * k, y: shark.y - s * 6 * k, r: 6.5 * k },
    ];
  }

  function coinSpot(p) {
    return {
      x: p.x + pipeW() / 2,
      y: p.top + p.gap / 2,
      r: Math.max(14, ppu() * 0.07),
    };
  }

  function takeCoin(p) {
    const c = coinSpot(p);
    return sharkCircles().some((ci) => {
      const dx = ci.x - c.x;
      const dy = ci.y - c.y;
      return dx * dx + dy * dy < (ci.r + c.r) * (ci.r + c.r);
    });
  }

  function hitTest(p) {
    const gap = p.gap;
    const w = pipeW();
    const rects = [
      { x: p.x, y: 0, w, h: p.top },
      { x: p.x, y: p.top + gap, w, h: GROUND_Y - p.top - gap },
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
  }

  function update() {
    frame++;
    if (flash > 0) flash--;
    if (shake > 0) shake--;

    const moving = state === "ready" || state === "play";
    const flow = scrollSpeed();
    if (moving) groundX -= flow;

    if (state === "ready") {
      shark.y = readyLayout().shark + Math.sin(frame / 60 * 5) * 0.05 * ppu();
      shark.rot = 0;
      shark.vy = 0;
      return;
    }

    if (state === "play" || state === "dying") {
      // Two 120Hz steps per frame, same order as flappybird.io.
      // vy is world units per second, positive upward.
      for (let i = 0; i < 2; i++) stepBird();
      faceBird();
    }

    if (state === "play") {
      runFrames++;
      for (const p of pipes) {
        p.x -= flow;
        if (!p.coinTaken && takeCoin(p)) {
          p.coinTaken = true;
          score++;
          audio.point();
        }
        if (hitTest(p)) { die(); break; }
      }
      if (pipes.length && pipes[0].x < -pipeW() - 10) pipes.shift();
      const spawnX = W + ppu() * 0.12;
      const last = pipes[pipes.length - 1];
      if (!last && runFrames >= 90) spawnPipe(spawnX);
      else if (last && spawnX - last.x >= pipeSpacing()) spawnPipe(spawnX);
    }

    if ((state === "play" || state === "dying") && shark.y + 0.068 * ppu() >= GROUND_Y) {
      shark.y = GROUND_Y - 0.068 * ppu();
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
    ctx.fillStyle = "#101418";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const y = (GROUND_Y / 8) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  function drawStick(x, y, h, bull, bodyAtEnd) {
    if (h < 6) return;
    const bodyW = pipeW();
    const wickX = x + bodyW / 2;
    const bodyH = Math.max(22, Math.min(h * 0.46, 78));
    const wickTip = Math.min(12, h * 0.16);
    const bodyY = bodyAtEnd ? y + h - bodyH - wickTip : y + wickTip;
    const color = bull ? "#178a56" : "#c4473a";
    const edge = bull ? "#9dffdf" : "#ffc1b5";
    const glow = bull ? "#3dffc2" : "#ff7a68";
    ctx.strokeStyle = glow;
    ctx.lineWidth = Math.max(2, bodyW * 0.1);
    ctx.lineCap = "butt";
    ctx.shadowColor = glow;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(wickX, y);
    ctx.lineTo(wickX, y + h);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillRect(x, bodyY, bodyW, bodyH);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, bodyY + 0.75, bodyW - 1.5, bodyH - 1.5);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x + 3, bodyY + 3, Math.max(2, bodyW * 0.16), Math.max(4, bodyH - 6));
  }

  function drawPipe(p) {
    const bottomY = p.top + p.gap;
    drawStick(p.x, 0, p.top, p.bull, true);
    drawStick(p.x, bottomY, Math.max(0, GROUND_Y - bottomY), p.bull, false);
  }

  function drawCoins() {
    for (const p of pipes) {
      if (p.coinTaken) continue;
      const c = coinSpot(p);
      text("$", c.x, c.y, Math.max(26, ppu() * 0.13), "#f0c43a", "center", "#3d2a06");
    }
  }

  function drawPriceLine() {
    if (!pipes.length) return;
    ctx.beginPath();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#e7eef6";
    ctx.lineWidth = 2;
    const first = pipes[0];
    const firstY = first.top + first.gap / 2;
    ctx.moveTo(first.x + pipeW() / 2, firstY);
    for (let i = 1; i < pipes.length; i++) {
      const p = pipes[i];
      ctx.lineTo(p.x + pipeW() / 2, p.top + p.gap / 2);
    }
    const last = pipes[pipes.length - 1];
    ctx.lineTo(W + 24, last.top + last.gap / 2);
    ctx.stroke();
  }

  function stepBird() {
    const dt = 1 / 120;
    if (shark.vy < -FALL_CAP_U) shark.vy = -FALL_CAP_U;
    shark.vy -= GRAVITY_U * dt;
    shark.y -= shark.vy * ppu() * dt;
  }

  function faceBird() {
    const rising = shark.vy > 0.05;
    const worldRot = rising
      ? 0.7
      : Math.max(-1.05, 0.7 + shark.vy * 0.75);
    const target = -worldRot;
    shark.rot += (target - shark.rot) * 0.5;
  }

  function drawGround() {
    ctx.fillStyle = "#0b0e12";
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = "#2a3340";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 1);
    ctx.lineTo(W, GROUND_Y + 1);
    ctx.stroke();
  }


  function drawShark() {
    const alive = state === "ready" || state === "play";
    const dead = state === "dying" || state === "over";
    const tailSwing = alive ? Math.sin(frame / 4) * 0.08 : 0.04;

    ctx.save();
    ctx.translate(shark.x, shark.y);
    ctx.rotate(shark.rot);
    ctx.scale(worldScale() * 0.8, worldScale() * 0.8);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0a0a0a";
    ctx.lineWidth = 2.4;

    ctx.save();
    ctx.translate(-15, 0);
    ctx.rotate(tailSwing);
    ctx.fillStyle = "#d5d5d5";
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-11, -10);
    ctx.quadraticCurveTo(-5, 0, -10, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#cfcfcf";
    ctx.beginPath();
    ctx.moveTo(-5, -7);
    ctx.lineTo(-1, -18);
    ctx.lineTo(7, -7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f7f7f7";
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.quadraticCurveTo(-6, -11, 8, -9);
    ctx.quadraticCurveTo(20, -7, 21, 1);
    ctx.quadraticCurveTo(18, 9, 2, 10);
    ctx.quadraticCurveTo(-8, 10, -15, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(-8, 2);
    ctx.quadraticCurveTo(4, 10, 15, 3);
    ctx.quadraticCurveTo(4, 6, -8, 2);
    ctx.fill();

    ctx.strokeStyle = "#7a7a7a";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(7 - i * 2.2, -1);
      ctx.quadraticCurveTo(5.6 - i * 2.2, 1.2, 7 - i * 2.2, 3.2);
      ctx.stroke();
    }

    ctx.fillStyle = "#d0d0d0";
    ctx.strokeStyle = "#161616";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(1, 5);
    ctx.lineTo(-6, 11);
    ctx.lineTo(5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f7f7f7";
    ctx.beginPath();
    ctx.moveTo(9, 3);
    ctx.quadraticCurveTo(15, 7, 19, 2.2);
    ctx.quadraticCurveTo(14, 4, 9, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 3; i++) {
      const tx = 11 + i * 2.2;
      ctx.beginPath();
      ctx.moveTo(tx, 2.4);
      ctx.lineTo(tx + 0.8, 4.6);
      ctx.lineTo(tx + 1.7, 2.3);
      ctx.fill();
    }

    if (dead) {
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(10, -6); ctx.lineTo(15, -1.5);
      ctx.moveTo(15, -6); ctx.lineTo(10, -1.5);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(12.5, -3.2, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
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
    text("StupidShark", W / 2, ui.title, 32, "#f4fff9", "center", "#04110c");
    text("Get Ready", W / 2, ui.ready, 22, "#3dffc2", "center", "#04110c");
    text("Ride the chart", W / 2, ui.name, 14, "#9fb8ae", "center", "#04110c");

    const y = ui.tap + Math.sin(frame / 10) * 3;
    roundRect(W / 2 - 50, y - 20, 100, 40, 10, "#12382c", "#3dffc2");
    text("TAP", W / 2, y, 20, "#e9fff6", "center", "#04110c");
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(W / 2, y - 34); ctx.lineTo(W / 2 - 8, y - 24); ctx.lineTo(W / 2 + 8, y - 24); ctx.closePath();
    ctx.fill();
    text(`Best: ${best}`, W / 2, ui.best, 16, "#fff");
  }

  function medalFor(s) {
    if (s >= 40) return { name: "Diamond", c1: "#e8fff6", c2: "#1f8f5f" };
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
    text("Game Over", W / 2, titleY - (1 - ease) * 30, 36, "#e0a15a", "center", "#04110c");
    const panelW = Math.min(W - 80, 360);
    const panelX = (W - panelW) / 2;
    roundRect(panelX, py, panelW, 116, 8, "#101614", "#1f8f5f");
    roundRect(panelX + 6, py + 6, panelW - 12, 104, 6, null, "#2a4a3c");

    const medalX = panelX + 52;
    const scoreX = panelX + panelW - 24;
    text("MEDAL", medalX, py + 22, 12, "#7dcea0", "center", "#04110c");
    text("COINS", scoreX, py + 22, 12, "#7dcea0", "center", "#04110c");
    text("BEST", scoreX, py + 66, 12, "#7dcea0", "center", "#04110c");

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
      roundRect(okBtn.x, okBtn.y, okBtn.w, okBtn.h, 6, "#0d241c", "#1f8f5f");
      roundRect(okBtn.x + 3, okBtn.y + 3, okBtn.w - 6, okBtn.h - 6, 4, "#1b6b45");
      text("PLAY", W / 2, okBtn.y + okBtn.h / 2 + 1, 18, "#f4fff9", "center", "#04110c");
    }
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    drawSea();
    pipes.forEach(drawPipe);
    drawPriceLine();
    drawCoins();
    drawGround();
    drawShark();

    if (state === "play" || state === "dying") {
      const size = Math.round(20 * worldScale());
      text("$" + score, 16, 28 * worldScale(), size, "#f0c43a", "left", "#04110c");
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
