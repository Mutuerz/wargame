'use strict';
// Sound: synthesized effects plus a few recorded clips. Starts on the first click.
//
// Every sound that happens somewhere in the world goes through a 3D chain built for that one sound:
//   source -> level (distance, walls in between) -> air (high frequencies fade with distance, muffled behind walls)
//          -> placement around your head -> output, plus a reverb send that grows with distance (far shots echo).
// It also arrives late by the speed of sound (343 m/s), so a far sniper's flash comes before its bang.
// Placement has three modes (Shift+N cycles them, the choice is remembered):
//   'hrtf'     Headphones 3D: the browser's HRTF binaural panner, which also places sounds above and below you.
//   'surround' 7.1 (or 5.1) speakers: each sound is panned between the two nearest of the 7 speakers, booms also
//              feed the subwoofer (LFE). Offered when the sound device exposes 6 or 8 output channels; virtual 7.1
//              headsets that show up in Windows as a 7.1 device take this path and do their own binaural mix.
//   'stereo'   Plain left/right panning, with sounds behind you slightly muffled.
// Auto picks 'surround' on a 6+ channel device, otherwise 'hrtf'.
const SPK = {   // speaker angles in degrees (0 = front, + = right), indexed by output channel (WAVE / Web Audio order)
  8: [-30, 30, 0, null, -145, 145, -95, 95],   // FL FR C LFE BL BR SL SR
  6: [-30, 30, 0, null, -115, 115],            // FL FR C LFE SL SR
};
const SFX = {
  ctx: null, on: true, shotWin: 0, shotN: 0, listener: { x: 0, y: 0, z: 0, yaw: 0 }, cur: null,
  mode: 'hrtf', pref: 'auto', chans: 2,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C({ latencyHint: 'interactive' });
      try { this.pref = localStorage.getItem('bh_audio_mode') || 'auto'; } catch (e) { }
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.buildBus();
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
      this.loadClip('ammoClip', 'sfx/ammo-pickup.mp3');
      this.loadClip('bestClip', 'sfx/best-play.mp3');
      this.loadClip('killClip', 'sfx/kill.mp3');
    } catch (e) { this.ctx = null; }
  },
  // The output graph for the current mode. Rebuilt when the mode changes; sounds already playing finish on the old one.
  buildBus() {
    const c = this.ctx, dst = c.destination, max = dst.maxChannelCount || 2;
    const surr = max >= 8 ? 8 : max >= 6 ? 6 : 0;
    this.mode = this.pref === 'auto' ? (surr ? 'surround' : 'hrtf') : this.pref === 'surround' && !surr ? 'hrtf' : this.pref;
    if (this.bus) { const old = this.bus; old.master.gain.setTargetAtTime(0, c.currentTime, 0.05); setTimeout(() => { try { old.master.disconnect(); } catch (e) { } }, 3000); }
    const bus = {}, n = this.mode === 'surround' ? surr : 2;
    this.chans = n;
    try {
      dst.channelCount = n;
      dst.channelCountMode = 'explicit';
      dst.channelInterpretation = n > 2 ? 'discrete' : 'speakers';
    } catch (e) { }
    bus.master = c.createGain(); bus.master.gain.value = this.on ? 0.45 : 0;
    // the dry bus carries sounds with no place (your own gun, UI, music): always front left + right
    bus.dry = c.createGain(); bus.dry.channelCount = 2; bus.dry.channelCountMode = 'explicit'; bus.dry.channelInterpretation = 'speakers';
    // reverb: a short outdoor slap and tail (stereo impulse made from decaying noise with a few early reflections)
    bus.verb = c.createConvolver(); bus.verb.buffer = this.makeIR(1.9);
    bus.verbIn = c.createGain(); bus.verbIn.gain.value = 0.55; bus.verbIn.connect(bus.verb);
    if (n > 2) {
      bus.mix = c.createChannelMerger(n);
      bus.mix.channelInterpretation = 'discrete';
      bus.mix.connect(bus.master);
      bus.master.channelCount = n; bus.master.channelCountMode = 'explicit'; bus.master.channelInterpretation = 'discrete';
      const ds = c.createChannelSplitter(2); bus.dry.connect(ds); ds.connect(bus.mix, 0, 0); ds.connect(bus.mix, 1, 1);
      // the reverb tail surrounds you: left side to FL / SL / BL, right side to FR / SR / BR
      const vs = c.createChannelSplitter(2); bus.verb.connect(vs);
      SPK[n].forEach((a, ch) => {
        if (a === null || a === 0) return;
        const g = c.createGain(); g.gain.value = Math.abs(a) > 60 ? 0.8 : 0.55;
        vs.connect(g, a < 0 ? 0 : 1); g.connect(bus.mix, 0, ch);
      });
      // the subwoofer: booms and heavy shots send their low end here
      bus.lfe = c.createBiquadFilter(); bus.lfe.type = 'lowpass'; bus.lfe.frequency.value = 110;
      bus.lfe.channelCount = 1; bus.lfe.channelCountMode = 'explicit';
      bus.lfe.connect(bus.mix, 0, 3);
    } else {
      bus.dry.connect(bus.master); bus.verb.connect(bus.master);
    }
    bus.master.connect(dst);
    this.bus = bus;
    if (this.wind) { try { this.wind.disconnect(); } catch (e) { } this.wind.connect(bus.dry); } this.master = bus.dry;   // older code paths that write to "master" land on the dry bus
  },
  makeIR(sec) {
    const c = this.ctx, sr = c.sampleRate, len = Math.floor(sr * sec), ir = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) { const t = i / sr; d[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.32) * (t < 0.012 ? t / 0.012 : 1) * 0.5; }
      // early reflections off the ground, walls and hills: a few discrete taps, different per ear
      for (let k = 0; k < 7; k++) { const at = Math.floor(sr * (0.018 + Math.random() * 0.14)); for (let j = 0; j < 90 && at + j < len; j++) d[at + j] += (Math.random() * 2 - 1) * 0.5 * Math.exp(-j / 25) * (1 - k / 9); }
    }
    return ir;
  },
  modeName() { return this.mode === 'surround' ? (this.chans === 8 ? '7.1 surround speakers' : '5.1 surround speakers') : this.mode === 'hrtf' ? 'Headphones 3D (HRTF)' : 'Stereo'; },
  // Shift+N: auto -> headphones -> surround (only if the device has 6+ channels) -> stereo -> auto
  cycleMode() {
    if (!this.ctx) return 'Click to start sound first';
    const max = this.ctx.destination.maxChannelCount || 2;
    const order = ['auto', 'hrtf', ...(max >= 6 ? ['surround'] : []), 'stereo'];
    this.pref = order[(order.indexOf(this.pref) + 1) % order.length];
    try { localStorage.setItem('bh_audio_mode', this.pref); } catch (e) { }
    this.buildBus();
    this.speakerTest();
    return (this.pref === 'auto' ? 'Auto: ' : '') + this.modeName() + (max < 6 && this.pref === 'auto' ? ' (device has ' + max + ' channels; set Windows to 7.1 for surround)' : '');
  },
  // a tick that circles you once, front -> right -> back -> left, to check the speakers are where they should be
  speakerTest() {
    const L = this.listener;
    for (let i = 0; i < 8; i++) setTimeout(() => {
      if (!this.ok()) return;
      const a = L.yaw + i * Math.PI / 4;
      this.at(L.x + Math.cos(a) * 160, L.y + Math.sin(a) * 160, L.z, { verb: 0.05 }, () => this.tone(0.3, 1200, 900, 0.09, 'triangle'));
    }, 300 + i * 260);
  },
  toggle() { this.on = !this.on; if (this.bus) this.bus.master.gain.value = this.on ? 0.45 : 0; return this.on; },
  vol(x, y) {
    const d = dist(x, y, this.listener.x, this.listener.y);
    if (d > 2600) return 0;
    return 1 / (1 + d / 380);
  },
  // Place whatever fn() plays at (x, y, z) in the world. Inside fn, burst / tone / clip route into the 3D chain.
  // opts: verb (extra reverb), lfe (subwoofer send 0..1), spread (0..1: how much a big sound fills the room), life (s).
  at(x, y, z, opts, fn) {
    if (!this.ok()) return;
    if (this.cur) { fn(); return; }
    const c = this.ctx, L = this.listener, bus = this.bus, o = opts || {};
    if (z === undefined || z === null) z = (G && G.m && typeof elevAt === 'function' ? elevAt(G.m, x, y) : 0) + 24;
    const dx = x - L.x, dy = y - L.y, dz = z - L.z, d2 = Math.hypot(dx, dy), d = Math.hypot(d2, dz);
    const near = d < 28;   // your own gun, footsteps, things in your hands: no placement
    // what is between you and it: walls, floors, roofs and hill crests muffle and soften the sound
    let occ = false;
    if (!near && d < 2600 && G && G.m && typeof los3 === 'function') { try { occ = !los3(G.m, L.x, L.y, L.z, x, y, z); } catch (e) { } }
    const t0 = c.currentTime + (near ? 0 : d / (CFG.PX_PER_M || 20) / 343);
    const input = c.createGain(); input.channelCount = 1; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
    input.gain.value = occ ? 0.5 : 1;
    const air = c.createBiquadFilter(); air.type = 'lowpass'; air.Q.value = 0.5;
    let fc = 18000 / (1 + d / 520);
    if (occ) fc = Math.min(fc, 750);
    // behind you: the outer ear shades the highs a little, which helps tell front from back on speakers and stereo
    const fwd = d2 > 1 ? (dx * Math.cos(L.yaw) + dy * Math.sin(L.yaw)) / d2 : 1;
    if (this.mode !== 'hrtf' && fwd < 0) fc *= 1 + fwd * 0.45;
    air.frequency.value = Math.max(300, fc);
    input.connect(air);
    const verb = c.createGain(); verb.gain.value = (o.verb || 0) + (near ? 0.1 : 0.12 + 0.45 * Math.min(1, d / 1600) + (occ ? 0.2 : 0));
    air.connect(verb); verb.connect(bus.verbIn);
    const nodes = [input, air, verb];
    if (near) air.connect(bus.dry);
    else this.place(air, dx, dy, dz, d, o, nodes);
    if (o.lfe && bus.lfe) { const g = c.createGain(); g.gain.value = o.lfe * (occ ? 0.7 : 1); input.connect(g); g.connect(bus.lfe); nodes.push(g); }
    this.cur = { node: input, t: t0 };
    try { fn(); } finally { this.cur = null; }
    setTimeout(() => nodes.forEach(n => { try { n.disconnect(); } catch (e) { } }), ((o.life || 2.5) + (t0 - c.currentTime)) * 1000 + 1500);
  },
  place(from, dx, dy, dz, d, o, nodes) {
    const c = this.ctx, L = this.listener, bus = this.bus;
    // into your head's frame: f = ahead, r = to your right, u = up
    const cs = Math.cos(L.yaw), sn = Math.sin(L.yaw);
    const f = dx * cs + dy * sn, r = -dx * sn + dy * cs, u = dz;
    if (this.mode === 'hrtf') {
      const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'linear'; p.rolloffFactor = 0; p.coneOuterGain = 1;
      // Web Audio's listener faces -z with +x to the right and +y up; distance is already in the level, so unit length
      const k = 1 / Math.max(1, d);
      if (p.positionX) { p.positionX.value = r * k; p.positionY.value = u * k; p.positionZ.value = -f * k; } else p.setPosition(r * k, u * k, -f * k);
      from.connect(p); p.connect(bus.dry); nodes.push(p);
      return;
    }
    const az = Math.atan2(r, f) * 180 / Math.PI;   // 0 front, + right
    if (this.mode === 'stereo') {
      const p = c.createStereoPanner(); p.pan.value = clamp(Math.sin(az * Math.PI / 180), -1, 1) * 0.9;
      from.connect(p); p.connect(bus.dry); nodes.push(p);
      return;
    }
    // surround: constant-power pan between the two speakers either side of the sound, blended toward every speaker
    // for close or big sounds (an explosion next to you comes from everywhere)
    const spk = SPK[this.chans], ring = [];
    spk.forEach((a, ch) => { if (a !== null) ring.push({ a, ch }); });
    ring.sort((p, q) => p.a - q.a);
    let i = ring.findIndex(s => s.a > az); if (i < 0) i = 0;
    const B = ring[i], A = ring[(i - 1 + ring.length) % ring.length];
    let span = B.a - A.a; if (span <= 0) span += 360;
    let off = az - A.a; if (off < 0) off += 360;
    const t = clamp(off / span, 0, 1);
    const spread = clamp(Math.max(o.spread || 0, 1 - (d - 28) / 90), 0, 1), even = Math.sqrt(1 / ring.length);
    for (const s of ring) {
      const pan = s === A ? Math.cos(t * Math.PI / 2) : s === B ? Math.sin(t * Math.PI / 2) : 0;
      const g = Math.sqrt(pan * pan * (1 - spread) + even * even * spread);
      if (g < 0.01) continue;
      const n = c.createGain(); n.gain.value = g; from.connect(n); n.connect(bus.mix, 0, s.ch); nodes.push(n);
    }
  },
  // where a sound starts and which node it plays into: the current 3D chain inside at(), else the dry bus
  t() { return this.cur ? this.cur.t : this.ctx.currentTime; },
  out() { return this.cur ? this.cur.node : this.bus.dry; },
  burst(v, freq, q, dur, type = 'bandpass', rate = 1) {
    const c = this.ctx, t = this.t();
    const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = rate * (0.85 + Math.random() * 0.3);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out());
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  },
  tone(v, f0, f1, dur, type = 'sine') {
    const c = this.ctx, t = this.t();
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.out()); o.start(t); o.stop(t + dur + 0.05);
  },
  ok() { return this.ctx && this.on && this.bus; },
  shot(x, y, mine, z) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    if (now - this.shotWin > 0.05) { this.shotWin = now; this.shotN = 0; }
    if (++this.shotN > 6) return;
    const v = this.vol(x, y) * (mine ? 0.8 : 0.5);
    if (v < 0.02) return;
    this.at(x, y, z, { lfe: 0.25 }, () => {
      this.burst(v, 1400, 0.7, 0.11);
      this.tone(v * 0.6, 160, 45, 0.09, 'triangle');
    });
  },
  boom(x, y, z) {
    if (!this.ok()) return;
    const v = Math.min(1, this.vol(x, y) * 2.2);
    this.at(x, y, z, { lfe: 1, spread: 0.35, verb: 0.2, life: 3 }, () => {
      this.burst(v, 300, 0.5, 1.4, 'lowpass', 0.5);
      this.tone(v, 90, 25, 0.9, 'sine');
    });
  },
  step(v = 0.1, soft) { if (this.ok()) { this.burst(v * (soft ? 0.5 : 1), 260 + Math.random() * 120, 1.2, 0.07, 'lowpass', 0.6); this.burst(v * 0.35, 1800 + Math.random() * 900, 2, 0.03); } },
  nade(x, y) { if (this.ok()) this.at(x, y, undefined, null, () => this.tone(this.vol(x, y) * 0.22, 2600 + Math.random() * 600, 1900, 0.05, 'triangle')); },
  click(v = 0.25) { if (this.ok()) this.tone(v, 1800, 900, 0.04, 'square'); },
  reload() { if (!this.ok()) return; this.tone(0.15, 600, 300, 0.06, 'square'); setTimeout(() => this.ok() && this.tone(0.18, 900, 500, 0.05, 'square'), 260); },
  beep(x, y) { if (this.ok()) this.at(x, y, undefined, null, () => this.tone(this.vol(x, y) * 0.4, 1760, 1760, 0.08, 'square')); },
  pickup() { if (!this.ok()) return; if (this.ammoClip) this.clip(this.ammoClip, 0.8); else this.tone(0.2, 520, 780, 0.12, 'triangle'); },   // ammo from a body, crate, cart or drop
  capture(good) { if (this.ok()) { this.tone(0.25, good ? 440 : 330, good ? 880 : 165, 0.45, 'triangle'); } },
  // decoded once into a buffer so it plays instantly, as often as needed
  loadClip(key, url) {
    fetch(url).then(r => (r.ok ? r.arrayBuffer() : null)).then(b => b && this.ctx.decodeAudioData(b)).then(buf => { if (buf) this[key] = buf; }).catch(() => {});
  },
  knife() { if (this.ok()) { this.tone(0.12, 1400, 500, 0.09, 'sawtooth'); } },   // swing whoosh
  // end-of-match music under the best-play replay; stops if the replay is skipped
  // loop: repeat the first 6.4 s (before the clip's own fade) until bestEnd(), so a long replay never runs out of music
  bestPlay(loop) {
    this.bestStop();
    if (!this.ok() || !this.bestClip) return;
    const c = this.ctx, src = c.createBufferSource(), g = c.createGain();
    src.buffer = this.bestClip; g.gain.value = 0.9; src.connect(g); g.connect(this.bus.dry);
    if (loop) { src.loop = true; src.loopStart = 0; src.loopEnd = 6.4; }
    src.start();
    this.bestSrc = { src, g };
  },
  bestEnd() { if (this.bestSrc) this.bestSrc.src.loop = false; },
  bestStop() {
    const b = this.bestSrc; this.bestSrc = null;
    if (!b) return;
    const t = this.ctx.currentTime; b.g.gain.setValueAtTime(b.g.gain.value, t); b.g.gain.linearRampToValueAtTime(0, t + 0.4); b.src.stop(t + 0.45);
  },
  clip(buf, v, off, dur) {
    const c = this.ctx, src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; src.playbackRate.value = 0.94 + Math.random() * 0.12; g.gain.value = v;
    src.connect(g); g.connect(this.out());
    if (off !== undefined) src.start(this.t(), off, dur); else src.start(this.t());
  },
  // pump shotgun: the blast, then 0.6 s later the pump racking the next shell (pumpIf() decides then; no shell, no pump)
  shotgun(x, y, mine, pumpIf, z) {
    if (!this.ok()) return;
    if (!this.sgShot) { this.shot(x, y, mine, z); return; }
    const v = this.vol(x, y) * (mine ? 0.55 : 0.4);
    if (v < 0.02) return;
    this.at(x, y, z, { lfe: 0.5, life: 3 }, () => this.clip(this.sgShot, v));
    if (this.sgPump) setTimeout(() => { if (this.ok() && (!pumpIf || pumpIf())) this.at(mine ? this.listener.x : x, mine ? this.listener.y : y, mine ? this.listener.z : z, null, () => this.clip(this.sgPump, Math.min(1, v * 1.3))); }, 600);
  },
  // SMG: the uploaded burst was cut into 4 single shots (0.34 s slots, each with a short room tail). Each bullet plays
  // one, never the same twice in a row, slightly varied in pitch and level, so the sound follows the real fire rate,
  // stops the instant you let go, and works for every SMG you hear (yours louder, others by distance).
  smg(x, y, mine, z) {
    if (!this.ok()) return;
    if (!this.smgClip) { this.shot(x, y, mine, z); return; }
    const now = this.ctx.currentTime;
    if (now - this.shotWin > 0.05) { this.shotWin = now; this.shotN = 0; }
    if (++this.shotN > 6) return;
    const v = this.vol(x, y) * (mine ? 0.5 : 0.42);
    if (v < 0.02) return;
    let i = Math.floor(Math.random() * 3); if (i >= (this.smgLast ?? -1)) i++; this.smgLast = i;
    this.at(x, y, z, { lfe: 0.2 }, () => this.clip(this.smgClip, v * (0.9 + Math.random() * 0.2), i * 0.34, 0.33));
  },
  // sniper rifle: the heavy shot clip (synth shot until it has loaded), heard further away than other guns
  sniper(x, y, mine, z) {
    if (!this.ok()) return;
    if (!this.snShot) { this.shot(x, y, mine, z); return; }
    const v = Math.min(1, this.vol(x, y) * (mine ? 0.6 : 0.95));
    if (v > 0.02) this.at(x, y, z, { lfe: 0.6, verb: 0.15, life: 3.5 }, () => this.clip(this.snShot, v));
  },
  // you hit someone: the bullet-impact clip at full volume (synth tick until it has loaded)
  hit() { if (!this.ok()) return; if (this.hitClip) this.clip(this.hitClip, 0.9); else this.tone(0.12, 2400, 1800, 0.03, 'square'); },
  // you got hit: the sharp impact clip (rate-limited so an SMG burst does not stack ten of them)
  hurt() {
    if (!this.ok()) return;
    const now = this.ctx.currentTime; if (now - (this.hurtAt || 0) < 0.07) return; this.hurtAt = now;
    if (this.hurtClip) this.clip(this.hurtClip, 0.8); else this.tone(0.2, 300, 120, 0.08, 'sawtooth');
  },
  // anyone else hit: the same clip, quieter with distance, from where it happened
  hitNear(x, y) { if (this.ok() && this.hitClip) { const v = this.vol(x, y) * 0.55; if (v > 0.03) this.at(x, y, undefined, null, () => this.clip(this.hitClip, v)); } },
  // Every frame (from the 3D view): where your head is and which way it faces, footsteps of everyone near you, and
  // the crack of bullets that pass close by.
  tick(v, dt) {
    const L = this.listener;
    L.x = v.x; L.y = v.y; L.z = v.z; L.yaw = v.yaw;
    if (!this.ok() || !G || !G.soldiers) return;
    const me = v.who || G.player;
    for (const s of G.soldiers) {
      if (s === me || !s.alive || s.riding || s.para > 0) { s._sfx = null; continue; }
      const x = s.rx ?? s.x, y = s.ry ?? s.y;
      const p = s._sfx || (s._sfx = { x, y, acc: 0 });
      const moved = Math.hypot(x - p.x, y - p.y); p.x = x; p.y = y;
      if (moved > 60 || (s.jz || 0) > 2) continue;   // teleports (respawn, net correction) and jumps make no steps
      p.acc += moved;
      const stride = s.crouch ? 34 : 42;
      if (p.acc < stride) continue;
      p.acc = 0;
      const d = Math.hypot(x - L.x, y - L.y); if (d > 700) continue;
      const run = moved / Math.max(dt, 1e-3) > (CFG.WALK || 100) * 1.15;
      const vv = (run ? 0.3 : 0.17) * (s.crouch ? 0.35 : 1) / (1 + d / 160);
      if (vv < 0.012) continue;
      const fz = (s.rfz ?? (typeof feetZ === 'function' ? feetZ(s) : undefined) ?? 0) + 2;
      this.at(x, y, fz, { life: 0.5 }, () => this.step(vv));
    }
    // near misses: a bullet that comes within ~2.5 m of your head cracks past on the side it went by
    if (!G.bullets || !me || !me.alive) return;
    for (const b of G.bullets) {
      if (b._wz || b.mine || b.owner === me || (b.team !== undefined && me.team === b.team)) continue;
      const x0 = b.x - b.vx * dt, y0 = b.y - b.vy * dt, sx = b.x - x0, sy = b.y - y0, l2 = sx * sx + sy * sy;
      if (l2 < 1) continue;
      const k = clamp(((L.x - x0) * sx + (L.y - y0) * sy) / l2, 0, 1), cx = x0 + sx * k, cy = y0 + sy * k;
      const md = Math.hypot(cx - L.x, cy - L.y, (b.z ?? L.z) - L.z);
      if (md > 50 || md < 6) continue;
      b._wz = 1;
      const vv = 0.32 * (1 - md / 60);
      this.at(cx + (cx - L.x) * 2, cy + (cy - L.y) * 2, b.z, { verb: 0.1, life: 0.6 }, () => {
        this.burst(vv, 3200, 1.6, 0.07, 'bandpass', 1.4);
        this.tone(vv * 0.5, 2400, 900, 0.12, 'sawtooth');
      });
    }
  },
  startWind() {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.3;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = c.createGain(); g.gain.value = 0.05;
    src.connect(f); f.connect(g); g.connect(this.bus.dry); src.start();
    this.wind = g;
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
  if (SFX.killClip) SFX.clip(SFX.killClip, 0.9);   // Juanes's impact clip on every enemy kill
  else { SFX.tone(0.35, 150, 50, 0.35 + n * 0.08, 'sawtooth'); SFX.burst(0.25, 900, 0.8, 0.25); }
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
