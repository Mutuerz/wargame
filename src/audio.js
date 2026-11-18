'use strict';
// Synthesized sound effects (no audio files). Starts on the first click.
const SFX = {
  ctx: null, on: true, shotWin: 0, shotN: 0, listener: { x: 0, y: 0 },
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.startWind();
      loadVoiceFiles();
      this.loadClip('hitClip', 'sfx/bullet-hit.mp3');
      this.loadClip('sgShot', 'sfx/shotgun-shot.mp3');
      this.loadClip('sgPump', 'sfx/shotgun-pump.mp3');
      this.loadClip('snShot', 'sfx/sniper-shot.mp3');
      this.loadClip('hsClip', 'sfx/headshot.mp3');
      this.loadClip('smgClip', 'sfx/smg-shots.mp3');
      this.loadClip('f30Clip', 'sfx/final30.mp3');
      this.loadClip('hurtClip', 'sfx/hurt.mp3');
    } catch (e) { this.ctx = null; }
  },
  toggle() { this.on = !this.on; if (this.master) this.master.gain.value = this.on ? 0.45 : 0; return this.on; },
  vol(x, y) {
    const d = dist(x, y, this.listener.x, this.listener.y);
    if (d > 2600) return 0;
    return 1 / (1 + d / 380);
  },
  burst(v, freq, q, dur, type = 'bandpass', rate = 1) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = rate * (0.85 + Math.random() * 0.3);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  },
  tone(v, f0, f1, dur, type = 'sine') {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  ok() { return this.ctx && this.on; },
  shot(x, y, mine) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    if (now - this.shotWin > 0.05) { this.shotWin = now; this.shotN = 0; }
    if (++this.shotN > 6) return;
    const v = this.vol(x, y) * (mine ? 0.8 : 0.5);
    if (v < 0.02) return;
    this.burst(v, 1400, 0.7, 0.11);
    this.tone(v * 0.6, 160, 45, 0.09, 'triangle');
  },
  boom(x, y) {
    if (!this.ok()) return;
    const v = Math.min(1, this.vol(x, y) * 2.2);
    this.burst(v, 300, 0.5, 1.4, 'lowpass', 0.5);
    this.tone(v, 90, 25, 0.9, 'sine');
  },
  step(v = 0.1, soft) { if (this.ok()) { this.burst(v * (soft ? 0.5 : 1), 260 + Math.random() * 120, 1.2, 0.07, 'lowpass', 0.6); this.burst(v * 0.35, 1800 + Math.random() * 900, 2, 0.03); } },
  nade(x, y) { if (this.ok()) this.tone(this.vol(x, y) * 0.22, 2600 + Math.random() * 600, 1900, 0.05, 'triangle'); },
  click(v = 0.25) { if (this.ok()) this.tone(v, 1800, 900, 0.04, 'square'); },
  reload() { if (!this.ok()) return; this.tone(0.15, 600, 300, 0.06, 'square'); setTimeout(() => this.ok() && this.tone(0.18, 900, 500, 0.05, 'square'), 260); },
  beep(x, y) { if (this.ok()) this.tone(this.vol(x, y) * 0.4, 1760, 1760, 0.08, 'square'); },
  pickup() { if (this.ok()) { this.tone(0.2, 520, 780, 0.12, 'triangle'); } },
  capture(good) { if (this.ok()) { this.tone(0.25, good ? 440 : 330, good ? 880 : 165, 0.45, 'triangle'); } },
  // decoded once into a buffer so it plays instantly, as often as needed
  loadClip(key, url) {
    fetch(url).then(r => (r.ok ? r.arrayBuffer() : null)).then(b => b && this.ctx.decodeAudioData(b)).then(buf => { if (buf) this[key] = buf; }).catch(() => {});
  },
  clip(buf, v) {
    const c = this.ctx, src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; src.playbackRate.value = 0.94 + Math.random() * 0.12; g.gain.value = v;
    src.connect(g); g.connect(this.master); src.start();
  },
  // pump shotgun: the blast, then 0.6 s later the pump racking the next shell (pumpIf() decides then; no shell, no pump)
  shotgun(x, y, mine, pumpIf) {
    if (!this.ok()) return;
    if (!this.sgShot) { this.shot(x, y, mine); return; }
    const v = this.vol(x, y) * (mine ? 0.55 : 0.4);
    if (v < 0.02) return;
    this.clip(this.sgShot, v);
    if (this.sgPump) setTimeout(() => { if (this.ok() && (!pumpIf || pumpIf())) this.clip(this.sgPump, Math.min(1, v * 1.3)); }, 600);
  },
  // SMG: the uploaded burst was cut into 4 single shots (0.34 s slots, each with a short room tail). Each bullet plays
  // one, never the same twice in a row, slightly varied in pitch and level, so the sound follows the real fire rate,
  // stops the instant you let go, and works for every SMG you hear (yours louder, others by distance).
  smg(x, y, mine) {
    if (!this.ok()) return;
    if (!this.smgClip) { this.shot(x, y, mine); return; }
    const now = this.ctx.currentTime;
    if (now - this.shotWin > 0.05) { this.shotWin = now; this.shotN = 0; }
    if (++this.shotN > 6) return;
    const v = this.vol(x, y) * (mine ? 0.5 : 0.42);
    if (v < 0.02) return;
    let i = Math.floor(Math.random() * 3); if (i >= (this.smgLast ?? -1)) i++; this.smgLast = i;
    const c = this.ctx, src = c.createBufferSource(), g = c.createGain();
    src.buffer = this.smgClip; src.playbackRate.value = 0.96 + Math.random() * 0.08; g.gain.value = v * (0.9 + Math.random() * 0.2);
    src.connect(g); g.connect(this.master); src.start(0, i * 0.34, 0.33);
  },
  // sniper rifle: the heavy shot clip (synth shot until it has loaded), heard further away than other guns
  sniper(x, y, mine) {
    if (!this.ok()) return;
    if (!this.snShot) { this.shot(x, y, mine); return; }
    const v = Math.min(1, this.vol(x, y) * (mine ? 0.6 : 0.95));
    if (v > 0.02) this.clip(this.snShot, v);
  },
  // you hit someone: the bullet-impact clip at full volume (synth tick until it has loaded)
  hit() { if (!this.ok()) return; if (this.hitClip) this.clip(this.hitClip, 0.9); else this.tone(0.12, 2400, 1800, 0.03, 'square'); },
  // you got hit: the sharp impact clip (rate-limited so an SMG burst does not stack ten of them)
  hurt() {
    if (!this.ok()) return;
    const now = this.ctx.currentTime; if (now - (this.hurtAt || 0) < 0.07) return; this.hurtAt = now;
    if (this.hurtClip) this.clip(this.hurtClip, 0.8); else this.tone(0.2, 300, 120, 0.08, 'sawtooth');
  },
  // anyone else hit: the same clip, quieter with distance
  hitNear(x, y) { if (this.ok() && this.hitClip) { const v = this.vol(x, y) * 0.55; if (v > 0.03) this.clip(this.hitClip, v); } },
  startWind() {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.3;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = c.createGain(); g.gain.value = 0.05;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  },
};

// ---------- kill callouts: "Enemy down", "Double kill" ... "Pentakill"
// If sfx/voice/<key>.mp3 files exist (any announcer recording you like), they are played; otherwise the
// browser's own speech voice reads the line, pitched down, over a synthesized sting.
const KILL_LINES = [null, ['kill', 'ENEMY DOWN', 'Enemy down'], ['double', 'DOUBLE KILL', 'Double kill!'], ['triple', 'TRIPLE KILL', 'Triple kill!'],
  ['quadra', 'QUADRA KILL', 'Quadra kill!'], ['penta', 'PENTAKILL', 'Penta kill!']];
const VOICE = { files: {}, tried: false, pick: null };
function loadVoiceFiles() {
  if (VOICE.tried) return; VOICE.tried = true;
  for (let i = 1; i < KILL_LINES.length; i++) {
    const k = KILL_LINES[i][0], a = new Audio();
    a.preload = 'auto';
    a.oncanplaythrough = () => { VOICE.files[k] = a; };
    a.onerror = () => { delete VOICE.files[k]; };
    a.src = `sfx/voice/${k}.mp3`;
  }
}
function announcerVoice() {
  if (VOICE.pick !== null || !window.speechSynthesis) return VOICE.pick;
  const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
  if (!vs.length) return null;
  VOICE.pick = vs.find(v => /male|daniel|david|guy|fred|alex|george|arthur|james/i.test(v.name) && !/female/i.test(v.name)) || vs[0];
  return VOICE.pick;
}
function announceKill(n, head, dist, name) {
  n = clamp(n | 0, 1, 5);
  const [key, text, said] = KILL_LINES[n];
  // the kill list at the bottom of the screen: one line per kill, multi-kills stack up
  if (G && dist != null) { (G.killList || (G.killList = [])).push({ name, dist, head, n, at: performance.now() / 1000 }); if (G.killList.length > 5) G.killList.shift(); }
  if (G) G.killFx = { n, text, t: n > 1 ? 2.2 : 1.4, max: n > 1 ? 2.2 : 1.4 };
  if (!SFX.ok()) return;
  // sting: a deep hit, brighter and longer for bigger streaks
  SFX.tone(0.35, 150, 50, 0.35 + n * 0.08, 'sawtooth');
  SFX.burst(0.25, 900, 0.8, 0.25);
  if (n > 1) setTimeout(() => SFX.ok() && SFX.tone(0.16, 440 + n * 110, 880 + n * 220, 0.25 + n * 0.05, 'triangle'), 90);
  // a headshot kill plays the headshot clip; a multi-kill voice then waits until it is done
  const hs = head && SFX.hsClip;
  if (hs) SFX.clip(SFX.hsClip, 1);
  if (n === 1) return;   // a single kill gets the sting only; the voice is for multi-kills
  if (hs) { setTimeout(() => SFX.ok() && announceVoice(n), 1100); return; }
  announceVoice(n);
}
function announceVoice(n) {
  const [key, , said] = KILL_LINES[n];
  const f = VOICE.files[key];
  if (f) { try { f.currentTime = 0; f.volume = 0.9; f.play(); } catch (e) { } return; }
  if (!window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(said);
    const v = announcerVoice(); if (v) u.voice = v;
    u.pitch = 0.35; u.rate = n >= 5 ? 0.8 : 0.95; u.volume = 1;
    speechSynthesis.speak(u);
  } catch (e) { }
}
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { VOICE.pick = null; };

// Last 30 seconds of the match: the war-drums stinger plays once (sfx/final30.mp3), fading out if the match ends
// sooner or you leave it. Called every frame by ui.js.
function finalCountdown() {
  const src = SFX.f30Src;
  if (src && (!G || G.over || G !== src.g)) {
    try { const now = SFX.ctx.currentTime; src.gain.gain.setTargetAtTime(0, now, 0.4); src.node.stop(now + 2); } catch (e) { }
    SFX.f30Src = null;
  }
  if (!G || G.over || G.final30 || G.time < CFG.TIME_LIMIT - 30) return;
  G.final30 = true;
  if (typeof message === 'function') message('30 seconds left', '#e6ad45', 2.5);
  if (!SFX.ok() || !SFX.f30Clip) return;
  const c = SFX.ctx, node = c.createBufferSource(), gain = c.createGain();
  node.buffer = SFX.f30Clip; gain.gain.value = 0.6;
  node.connect(gain); gain.connect(SFX.master); node.start();
  SFX.f30Src = { node, gain, g: G };
}
