'use strict';
// First-person weapons: detailed, physically shaded models seen only in your own view (other soldiers use the
// simpler gunMesh in render3d.js). Units: the gun is about 1 long, -z points forward, y up, x right. The sight
// line sits at y = VM_SIGHT so aiming down the sights lines it up with the crosshair.

const VM_SIGHT = 0.207;
const VMX = {};   // shared textures and materials, made once

function vmCanvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function vmInit() {
  if (VMX.ready) return;
  VMX.ready = true;
  // fine grain for roughness and bump: worn, slightly uneven finishes instead of flat plastic
  VMX.noise = vmCanvas(256, 256, (g, w, h) => {
    const d = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = 120 + Math.random() * 90; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
    g.putImageData(d, 0, 0);
    g.globalAlpha = 0.18;   // scratches
    for (let i = 0; i < 140; i++) { g.strokeStyle = Math.random() < 0.5 ? '#fff' : '#000'; g.lineWidth = Math.random() * 1.2; g.beginPath(); const x = Math.random() * w, y = Math.random() * h, a = Math.random() * 6.28, l = 4 + Math.random() * 30; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  });
  VMX.wood = vmCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#6b4526'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      const v = Math.sin(y * 0.22 + Math.sin(y * 0.05) * 3) * 0.5 + 0.5;
      g.fillStyle = `rgba(${40 + v * 50 | 0},${22 + v * 25 | 0},${10 + v * 10 | 0},${0.35 + v * 0.3})`; g.fillRect(0, y, w, 1);
    }
    g.globalAlpha = 0.25;
    for (let i = 0; i < 60; i++) { g.fillStyle = Math.random() < 0.5 ? '#2a170a' : '#a0703f'; g.fillRect(Math.random() * w, Math.random() * h, 20 + Math.random() * 120, 1); }
  });
  VMX.knurl = vmCanvas(64, 64, (g, w, h) => {
    g.fillStyle = '#777'; g.fillRect(0, 0, w, h); g.strokeStyle = '#222'; g.lineWidth = 1.5;
    for (let i = -w; i < w * 2; i += 6) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke(); }
  });
  VMX.fabric = vmCanvas(128, 128, (g, w, h) => {
    g.fillStyle = '#888'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = y % 4 ? '#6a6a6a' : '#9a9a9a'; g.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 3) { g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x, 0, 1, h); }
  });
  // a soft sky-and-ground environment so metal has something to reflect
  if (typeof gl3 !== 'undefined' && gl3) {
    const env = vmCanvas(256, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#dfe9f2'); gr.addColorStop(0.45, '#aab7c0'); gr.addColorStop(0.52, '#6c6558'); gr.addColorStop(1, '#2c2a26');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(w * 0.18, h * 0.1, w * 0.16, h * 0.12);   // bright "windows" give crisp highlights
      g.fillRect(w * 0.62, h * 0.18, w * 0.1, h * 0.08);
    });
    env.mapping = THREE.EquirectangularReflectionMapping;
    env.colorSpace = THREE.SRGBColorSpace;
    try { const pm = new THREE.PMREMGenerator(gl3); VMX.env = pm.fromEquirectangular(env).texture; pm.dispose(); } catch (e) { VMX.env = null; }
    if (VMX.env) vmScene.environment = VMX.env;
  }
  const std = (color, metal, rough, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, metalness: metal, roughness: rough, roughnessMap: VMX.noise, bumpMap: VMX.noise, bumpScale: 0.0015, envMapIntensity: 1.35 }, o));
  VMX.mats = {
    steel: std('#62676b', 0.9, 0.38),
    blued: std('#3c434b', 0.85, 0.33),
    anod: std('#424645', 0.55, 0.5),
    poly: std('#323436', 0.05, 0.72, { bumpScale: 0.003 }),
    tan: std('#6e6249', 0.05, 0.8, { bumpScale: 0.003 }),
    dark: new THREE.MeshStandardMaterial({ color: '#050505', metalness: 0.2, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ map: VMX.wood, color: '#c9a27c', metalness: 0, roughness: 0.55, bumpMap: VMX.wood, bumpScale: 0.002 }),
    rubber: std('#151515', 0, 0.95, { bumpMap: VMX.knurl, bumpScale: 0.004 }),
    knurl: std('#2a2c2d', 0.7, 0.6, { bumpMap: VMX.knurl, bumpScale: 0.004 }),
    brass: std('#b98d3e', 1, 0.3),
    shell: std('#9b1f1a', 0.1, 0.45),
    lens: new THREE.MeshStandardMaterial({ color: '#0d2233', metalness: 1, roughness: 0.05, emissive: '#06121c' }),
    glass: new THREE.MeshStandardMaterial({ color: '#88c8d8', metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false }),
    glove: std('#5a5146', 0, 0.92, { bumpMap: VMX.fabric, bumpScale: 0.003 }),
    leather: std('#2a2520', 0.05, 0.7),
  };
}

// Geometry helpers ------------------------------------------------------------------------------------------
function vmBox(g, w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o;
}
// cylinder along z (r0 at the back, r1 at the front)
function vmCyl(g, r0, len, m, x, y, z, seg = 18, r1 = r0) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg).rotateX(-Math.PI / 2), m); o.position.set(x, y, z); g.add(o); return o;
}
// side profile extruded across x. pts are [z, y] pairs.
function vmProfile(g, pts, width, m, x = 0, bevel = 0.006) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(Math.PI / 2);   // shape x -> -z (we stored -z), extrusion -> x
  const o = new THREE.Mesh(geo, m); o.position.x = x; g.add(o); return o;
}
function vmRail(g, M, y, z0, z1, w = 0.044) {   // Picatinny rail: a base and a row of cross slots
  vmBox(g, w * 0.8, 0.01, z1 - z0, M.anod, 0, y, (z0 + z1) / 2);
  for (let z = z0 + 0.008; z < z1 - 0.004; z += 0.02) vmBox(g, w, 0.008, 0.011, M.anod, 0, y + 0.008, z);
}
function vmIronFront(g, M, z, base) {   // front sight post rising to the sight line
  vmBox(g, 0.03, VM_SIGHT - base - 0.012, 0.018, M.blued, 0, (base + VM_SIGHT) / 2 - 0.006, z);
  vmBox(g, 0.006, 0.02, 0.006, M.blued, 0, VM_SIGHT - 0.006, z);
  vmBox(g, 0.006, 0.03, 0.02, M.blued, 0.014, VM_SIGHT - 0.01, z); vmBox(g, 0.006, 0.03, 0.02, M.blued, -0.014, VM_SIGHT - 0.01, z);   // ears
}
function vmIronRear(g, M, z, base) {   // ghost-ring aperture
  vmBox(g, 0.045, VM_SIGHT - base - 0.015, 0.02, M.blued, 0, (base + VM_SIGHT) / 2 - 0.012, z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.004, 8, 20), M.blued); ring.position.set(0, VM_SIGHT, z); g.add(ring);
}
function vmRedDot(g, M, z, base, big) {   // reflex/holo sight: housing, tinted glass and a glowing dot
  const h = big ? 0.075 : 0.05, w = big ? 0.07 : 0.05, d = big ? 0.1 : 0.06;
  vmBox(g, w * 0.8, VM_SIGHT - base - h / 2 + 0.006, d, M.anod, 0, (base + VM_SIGHT - h / 2) / 2, z);
  vmBox(g, 0.008, h, d, M.anod, w / 2, VM_SIGHT, z); vmBox(g, 0.008, h, d, M.anod, -w / 2, VM_SIGHT, z);
  vmBox(g, w + 0.008, 0.009, d, M.anod, 0, VM_SIGHT + h / 2, z);
  vmBox(g, 0.014, 0.012, 0.02, M.knurl, w / 2 + 0.01, VM_SIGHT - 0.01, z);   // brightness knob
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.glass); gl.position.set(0, VM_SIGHT, z - d / 2 + 0.01); g.add(gl);
  const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: '#ff3b2e', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  dot.scale.set(0.012, 0.012, 1); dot.position.set(0, VM_SIGHT, z - d / 2 - 0.25); g.add(dot);
}
function vmGrip(g, M, m) {   // pistol grip with finger grooves
  vmProfile(g, [[0.03, 0.03], [-0.03, 0.03], [-0.005, -0.04], [0.005, -0.055], [0.0, -0.07], [0.012, -0.085], [0.01, -0.11], [0.02, -0.13], [0.07, -0.13], [0.065, -0.09], [0.045, 0.0]], 0.05, m || M.poly);
}
function vmTrigger(g, M, z) {
  vmBox(g, 0.044, 0.006, 0.09, M.anod, 0, -0.02, z - 0.04);   // guard bottom
  vmBox(g, 0.044, 0.04, 0.006, M.anod, 0, 0.0, z - 0.085);
  vmBox(g, 0.008, 0.03, 0.008, M.steel, 0, 0.005, z - 0.04, 0.3);
}
function vmMuzzleBrake(g, M, z, r, y = 0.12) {
  vmCyl(g, r, 0.07, M.blued, 0, y, z, 16);
  for (let i = 0; i < 3; i++) { vmBox(g, r * 2.3, 0.006, 0.008, M.dark, 0, y, z - 0.02 + i * 0.018); }
}

// Weapons ---------------------------------------------------------------------------------------------------
function vmRifle(g, M) {
  // lower receiver with magazine well, upper receiver, rail, handguard, barrel
  vmProfile(g, [[0.05, 0.1], [-0.27, 0.1], [-0.27, 0.06], [-0.22, 0.03], [-0.22, -0.02], [-0.12, -0.02], [-0.11, 0.03], [0.05, 0.03]], 0.062, M.anod);
  vmBox(g, 0.066, 0.06, 0.34, M.anod, 0, 0.13, -0.12);
  vmBox(g, 0.004, 0.028, 0.08, M.dark, 0.034, 0.13, -0.1);              // ejection port
  vmBox(g, 0.003, 0.03, 0.085, M.anod, 0.035, 0.13, -0.1);              // dust cover
  vmCyl(g, 0.012, 0.04, M.steel, 0.03, 0.145, 0.0, 10);                  // forward assist
  vmBox(g, 0.07, 0.012, 0.028, M.anod, 0, 0.16, 0.06);                   // charging handle
  vmRail(g, M, 0.163, -0.3, 0.05);
  const hg = vmCyl(g, 0.046, 0.44, M.anod, 0, 0.12, -0.53, 8); hg.rotation.z = Math.PI / 8;
  for (let i = 0; i < 6; i++) for (const s of [1, -1]) vmBox(g, 0.006, 0.014, 0.04, M.dark, s * 0.043, 0.12, -0.38 - i * 0.055);
  vmRail(g, M, 0.163, -0.75, -0.32, 0.04);
  vmCyl(g, 0.012, 0.24, M.blued, 0, 0.12, -0.87, 12);
  vmCyl(g, 0.017, 0.03, M.blued, 0, 0.12, -0.8, 12);                     // gas block
  vmMuzzleBrake(g, M, -1.02, 0.019);
  vmIronFront(g, M, -0.72, 0.17);
  vmRedDot(g, M, -0.13, 0.17, true);
  vmGrip(g, M); vmTrigger(g, M, 0.0);
  // curved magazine
  { const m0 = g.children.length;
  vmProfile(g, [[-0.215, 0.03], [-0.125, 0.03], [-0.12, -0.06], [-0.135, -0.15], [-0.16, -0.23], [-0.25, -0.22], [-0.225, -0.14], [-0.215, -0.06]], 0.05, M.poly);
  for (let i = 0; i < 4; i++) vmBox(g, 0.054, 0.004, 0.085, M.poly, 0, -0.04 - i * 0.04, -0.17 - i * 0.007);
  vmMagGroup(g, m0); }
  // buffer tube and adjustable stock
  vmCyl(g, 0.022, 0.24, M.anod, 0, 0.12, 0.17, 14);
  vmProfile(g, [[0.12, 0.14], [0.34, 0.14], [0.35, 0.0], [0.3, 0.0], [0.24, 0.07], [0.14, 0.09]], 0.06, M.poly);
  vmBox(g, 0.064, 0.16, 0.02, M.rubber, 0, 0.08, 0.35);
  return { muzzle: -1.07, hand: [-0.5, 0.07], mag: [-0.17, -0.1] };
}
function vmSniper(g, M) {
  // wooden stock with pistol grip and cheek rest, long forend
  vmProfile(g, [[-0.72, 0.13], [-0.72, 0.08], [-0.1, 0.05], [-0.06, 0.01], [-0.03, -0.1], [0.04, -0.12], [0.06, -0.05], [0.12, 0.02], [0.38, -0.02], [0.4, 0.0], [0.4, 0.16], [0.18, 0.17], [0.1, 0.15], [0.05, 0.13]], 0.07, M.wood, 0, 0.01);
  vmBox(g, 0.074, 0.17, 0.02, M.rubber, 0, 0.07, 0.405);
  vmCyl(g, 0.031, 0.34, M.blued, 0, 0.135, -0.12, 20);                   // receiver
  vmBox(g, 0.004, 0.024, 0.07, M.dark, 0.031, 0.14, -0.08);
  const bolt = new THREE.Group(); bolt.name = 'bolt'; g.add(bolt);
  vmCyl(bolt, 0.012, 0.06, M.steel, 0.0, 0.14, 0.07, 12);
  const arm = vmCyl(bolt, 0.007, 0.07, M.steel, 0.045, 0.12, 0.03, 10); arm.rotation.set(0, Math.PI / 2, -0.6);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), M.blued); knob.position.set(0.08, 0.1, 0.03); bolt.add(knob);
  vmCyl(g, 0.022, 0.8, M.blued, 0, 0.135, -0.68, 18, 0.015);             // tapered heavy barrel
  vmMuzzleBrake(g, M, -1.1, 0.022, 0.135);
  // scope: rings, tube, objective bell, eyepiece, turrets, lenses
  for (const z of [-0.05, -0.24]) { vmBox(g, 0.05, 0.05, 0.03, M.anod, 0, 0.175, z); vmBox(g, 0.04, 0.012, 0.03, M.anod, 0, VM_SIGHT + 0.024, z); }
  vmCyl(g, 0.022, 0.42, M.anod, 0, VM_SIGHT, -0.15, 24);
  vmCyl(g, 0.024, 0.11, M.anod, 0, VM_SIGHT, -0.41, 24, 0.042);
  vmCyl(g, 0.042, 0.03, M.anod, 0, VM_SIGHT, -0.48, 24);
  vmCyl(g, 0.032, 0.09, M.anod, 0, VM_SIGHT, 0.1, 24, 0.024);
  vmCyl(g, 0.033, 0.02, M.rubber, 0, VM_SIGHT, 0.15, 24);
  const lensF = vmCyl(g, 0.038, 0.004, M.lens, 0, VM_SIGHT, -0.497, 24); const lensR = vmCyl(g, 0.028, 0.004, M.lens, 0, VM_SIGHT, 0.162, 24);
  const tt = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 16), M.knurl); tt.position.set(0, VM_SIGHT + 0.035, -0.15); g.add(tt);
  const ts = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 16).rotateZ(Math.PI / 2), M.knurl); ts.position.set(0.035, VM_SIGHT, -0.15); g.add(ts);
  { const m0 = g.children.length;
  vmBox(g, 0.04, 0.05, 0.07, M.poly, 0, 0.03, -0.12);                    // magazine
  vmMagGroup(g, m0); }
  vmTrigger(g, M, 0.02);
  // folded bipod
  for (const s of [1, -1]) vmBox(g, 0.008, 0.008, 0.2, M.blued, s * 0.02, 0.06, -0.55);
  return { muzzle: -1.15, hand: [-0.45, 0.06], mag: [-0.12, 0.03] };
}
function vmSmg(g, M) {
  vmProfile(g, [[0.06, 0.16], [-0.3, 0.16], [-0.3, 0.06], [-0.2, 0.04], [-0.18, 0.02], [0.06, 0.02]], 0.06, M.anod);
  vmBox(g, 0.004, 0.026, 0.06, M.dark, 0.031, 0.12, -0.07);
  vmRail(g, M, 0.163, -0.28, 0.05, 0.04);
  vmCyl(g, 0.034, 0.24, M.anod, 0, 0.11, -0.42, 18);                     // integral suppressor shroud
  for (let i = 0; i < 7; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.003, 6, 20), M.blued); r.position.set(0, 0.11, -0.32 - i * 0.032); g.add(r); }
  vmCyl(g, 0.036, 0.02, M.blued, 0, 0.11, -0.55, 18);
  const vg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.13, 14), M.poly); vg.position.set(0, 0.02, -0.36); g.add(vg);   // vertical foregrip
  vmRedDot(g, M, -0.1, 0.17, false);
  vmIronFront(g, M, -0.27, 0.165);
  vmGrip(g, M); vmTrigger(g, M, 0.03);
  { const m0 = g.children.length;
  vmProfile(g, [[-0.15, 0.03], [-0.1, 0.03], [-0.095, -0.24], [-0.155, -0.24]], 0.04, M.poly);   // straight magazine
  vmBox(g, 0.046, 0.016, 0.07, M.poly, 0, -0.245, -0.125);
  vmMagGroup(g, m0); }
  // folding wire stock
  for (const s of [1, -1]) vmBox(g, 0.008, 0.008, 0.26, M.blued, s * 0.022, 0.1, 0.18);
  vmBox(g, 0.06, 0.12, 0.018, M.rubber, 0, 0.06, 0.31);
  vmBox(g, 0.008, 0.008, 0.25, M.blued, 0, 0.02, 0.19, -0.3);
  return { muzzle: -0.58, hand: [-0.36, -0.05], vgrip: true, mag: [-0.125, -0.1] };
}
function vmLmg(g, M) {
  vmProfile(g, [[0.08, 0.17], [-0.36, 0.17], [-0.36, 0.06], [-0.1, 0.04], [-0.08, 0.02], [0.08, 0.02]], 0.085, M.anod);
  vmProfile(g, [[0.02, 0.2], [-0.3, 0.2], [-0.32, 0.17], [0.04, 0.17]], 0.08, M.anod);           // feed cover
  vmBox(g, 0.012, 0.012, 0.3, M.anod, 0.03, 0.2, -0.14);
  // carry handle
  vmBox(g, 0.02, 0.05, 0.02, M.anod, 0, 0.23, -0.3); vmBox(g, 0.02, 0.05, 0.02, M.anod, 0, 0.23, -0.46); vmBox(g, 0.024, 0.016, 0.2, M.poly, 0, 0.26, -0.38);
  // heavy barrel in a perforated heat shroud
  vmCyl(g, 0.045, 0.4, M.blued, 0, 0.11, -0.56, 16);
  for (let i = 0; i < 7; i++) for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; vmBox(g, 0.012, 0.012, 0.025, M.dark, Math.cos(a) * 0.044, 0.11 + Math.sin(a) * 0.044, -0.4 - i * 0.05, 0, 0, a); }
  vmCyl(g, 0.02, 0.2, M.blued, 0, 0.11, -0.86, 14);
  vmMuzzleBrake(g, M, -0.99, 0.026);
  vmIronFront(g, M, -0.82, 0.13);
  vmIronRear(g, M, -0.02, 0.2);
  vmGrip(g, M); vmTrigger(g, M, 0.04);
  // ammo box and belt
  { const m0 = g.children.length;
  vmProfile(g, [[-0.28, 0.06], [-0.1, 0.06], [-0.1, -0.12], [-0.28, -0.12]], 0.1, M.tan, -0.07);
  vmBox(g, 0.004, 0.06, 0.12, M.dark, -0.121, -0.03, -0.19);
  vmMagGroup(g, m0); }
  for (let i = 0; i < 6; i++) { const b = vmCyl(g, 0.006, 0.05, M.brass, -0.03, 0.08 + i * 0.012, -0.22, 8); b.rotation.set(0, Math.PI / 2, 0); }
  // stock and bipod
  vmProfile(g, [[0.08, 0.16], [0.36, 0.14], [0.37, -0.02], [0.3, -0.02], [0.2, 0.06], [0.08, 0.05]], 0.07, M.poly);
  vmBox(g, 0.074, 0.16, 0.02, M.rubber, 0, 0.06, 0.375);
  for (const s of [1, -1]) vmBox(g, 0.01, 0.01, 0.24, M.blued, s * 0.025, 0.07, -0.72, 0.05);
  return { muzzle: -1.04, hand: [-0.42, 0.05], mag: [-0.19, -0.03] };
}
function vmShotgun(g, M) {
  vmProfile(g, [[0.04, 0.165], [-0.24, 0.165], [-0.24, 0.06], [-0.2, 0.05], [-0.06, 0.04], [-0.04, 0.02], [0.04, 0.02]], 0.062, M.blued);
  vmBox(g, 0.004, 0.03, 0.09, M.dark, 0.032, 0.125, -0.1);               // ejection port
  vmBox(g, 0.004, 0.02, 0.1, M.steel, -0.032, 0.06, -0.12);              // loading gate
  vmCyl(g, 0.019, 0.62, M.blued, 0, 0.145, -0.55, 18);                   // barrel
  vmCyl(g, 0.016, 0.5, M.blued, 0, 0.09, -0.49, 16);                     // magazine tube
  vmCyl(g, 0.018, 0.02, M.steel, 0, 0.09, -0.745, 16);
  vmBox(g, 0.012, 0.05, 0.02, M.blued, 0, 0.115, -0.74);                 // barrel clamp
  vmBox(g, 0.008, 0.008, 0.6, M.blued, 0, 0.168, -0.55);                 // vent rib
  vmIronFront(g, M, -0.84, 0.165);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), M.brass); bead.position.set(0, VM_SIGHT + 0.006, -0.84); g.add(bead);
  vmIronRear(g, M, -0.03, 0.165);
  vmTrigger(g, M, 0.0);
  // side saddle with spare shells
  vmBox(g, 0.008, 0.04, 0.13, M.poly, -0.036, 0.11, -0.12);
  for (let i = 0; i < 4; i++) { const s = vmCyl(g, 0.011, 0.06, M.shell, -0.045, 0.11, -0.07 - i * 0.03, 12); s.rotation.set(Math.PI / 2, 0, 0); const c = vmCyl(g, 0.0115, 0.014, M.brass, -0.045, 0.085, -0.07 - i * 0.03, 12); c.rotation.set(Math.PI / 2, 0, 0); }
  // wooden stock with grip
  vmProfile(g, [[0.04, 0.16], [0.04, 0.02], [0.08, -0.08], [0.13, -0.09], [0.14, -0.03], [0.38, 0.0], [0.4, 0.02], [0.4, 0.15], [0.2, 0.15]], 0.065, M.wood, 0, 0.01);
  vmBox(g, 0.068, 0.17, 0.02, M.rubber, 0, 0.085, 0.405);
  // pump: slides back after each shot
  const pump = new THREE.Group(); pump.name = 'pump'; g.add(pump);
  vmCyl(pump, 0.033, 0.2, M.poly, 0, 0.095, -0.42, 18);
  for (let i = 0; i < 8; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.004, 6, 20), M.poly); r.position.set(0, 0.095, -0.34 - i * 0.022); pump.add(r); }
  for (const s of [1, -1]) vmBox(pump, 0.004, 0.006, 0.22, M.steel, s * 0.02, 0.105, -0.3);   // action bars
  return { muzzle: -0.88, hand: [-0.42, 0.06], pump: true, mag: [-0.2, 0.08] };
}

function vmPistol(g, M) {
  // machine pistol: polymer frame, steel slide with serrations, extended 8-round magazine, fire selector
  const slide = new THREE.Group(); slide.name = 'slide'; g.add(slide);
  vmProfile(slide, [[0.06, 0.17], [-0.27, 0.17], [-0.28, 0.16], [-0.28, 0.115], [0.06, 0.115]], 0.05, M.steel, 0, 0.004);
  for (let i = 0; i < 7; i++) for (const s of [1, -1]) vmBox(slide, 0.004, 0.04, 0.005, M.dark, s * 0.025, 0.145, 0.04 - i * 0.012);   // grip serrations
  vmBox(slide, 0.004, 0.022, 0.06, M.dark, 0.025, 0.15, -0.1);         // ejection port
  vmBox(slide, 0.03, VM_SIGHT - 0.17, 0.014, M.blued, 0, (VM_SIGHT + 0.17) / 2 - 0.004, 0.045);   // rear sight with a notch
  vmBox(slide, 0.008, 0.012, 0.016, M.dark, 0, VM_SIGHT - 0.002, 0.045);
  vmBox(slide, 0.008, VM_SIGHT - 0.17, 0.012, M.blued, 0, (VM_SIGHT + 0.17) / 2 - 0.004, -0.26);  // front post
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 8, 6), new THREE.MeshBasicMaterial({ color: '#d8ff7a' })); dot.position.set(0, VM_SIGHT - 0.004, -0.267); slide.add(dot);
  vmCyl(g, 0.012, 0.03, M.blued, 0, 0.14, -0.295, 12);                    // barrel crown
  vmProfile(g, [[0.04, 0.115], [-0.26, 0.115], [-0.26, 0.085], [-0.06, 0.08], [-0.05, 0.06], [0.04, 0.06]], 0.048, M.poly);   // frame + rail
  for (let i = 0; i < 3; i++) vmBox(g, 0.05, 0.006, 0.01, M.poly, 0, 0.078, -0.13 - i * 0.03);
  vmProfile(g, [[0.03, 0.065], [-0.025, 0.065], [-0.005, -0.03], [0.0, -0.08], [0.06, -0.08], [0.05, -0.02], [0.045, 0.06]], 0.05, M.poly);   // grip
  vmBox(g, 0.052, 0.06, 0.04, M.rubber, 0, 0.0, 0.03, -0.2);
  { const m0 = g.children.length;
  vmProfile(g, [[0.0, -0.075], [0.05, -0.075], [0.06, -0.15], [0.005, -0.15]], 0.042, M.blued);   // extended magazine
  vmBox(g, 0.046, 0.016, 0.065, M.poly, 0, -0.155, 0.03);
  vmMagGroup(g, m0); }
  vmTrigger(g, M, -0.03);
  vmBox(g, 0.006, 0.014, 0.02, M.steel, 0.027, 0.09, 0.0);               // fire selector
  return { muzzle: -0.32, hand: [0.02, -0.02], cup: true, mag: [0.03, -0.11] };
}

// Hands and sleeves -----------------------------------------------------------------------------------------
function vmHand(M, left) {
  const h = new THREE.Group();
  vmBox(h, 0.06, 0.07, 0.085, M.glove, 0, 0, 0);
  for (let i = 0; i < 4; i++) {   // fingers curled around the grip
    const f = new THREE.Group(); f.position.set(left ? 0.03 : -0.03, 0.025 - i * 0.022, -0.035); h.add(f);
    vmBox(f, 0.04, 0.019, 0.02, M.glove, left ? 0.02 : -0.02, 0, 0);
    vmBox(f, 0.02, 0.018, 0.02, M.glove, left ? 0.04 : -0.04, 0, 0.012, 0, left ? -0.6 : 0.6, 0);
  }
  vmBox(h, 0.022, 0.022, 0.06, M.glove, left ? -0.03 : 0.03, 0.03, -0.04, 0.2, left ? 0.3 : -0.3, 0);   // thumb
  vmBox(h, 0.064, 0.02, 0.03, M.leather, 0, -0.01, 0.05);             // cuff strap
  return h;
}
function vmSleeve(g, mat, x, y, z, rx, ry) {
  const s = new THREE.Group(); s.position.set(x, y, z); s.rotation.set(rx, ry, 0); g.add(s);
  vmCyl(s, 0.042, 0.42, mat, 0, 0, 0.21, 14, 0.036);
  vmCyl(s, 0.038, 0.04, mat, 0, 0, 0.02, 14);
  for (let i = 0; i < 3; i++) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.005, 6, 16), mat); w.position.set(0, 0, 0.08 + i * 0.09); s.add(w); }   // fabric creases
  return s;
}

// the magazine as its own group, so the reload can pull it out and seat a fresh one
function vmMagGroup(g, from) {
  const mg = new THREE.Group(); mg.name = 'mag';
  for (const n of g.children.slice(from)) mg.add(n);
  g.add(mg); mg.userData.base = mg.position.clone();
}

function buildViewModel(clsKey) {
  vmInit();
  if (R3.vm) { vmScene.remove(R3.vm); R3.vm.traverse(n => { if (n.geometry) n.geometry.dispose(); }); }
  const M = VMX.mats, g = new THREE.Group();
  const sleeveM = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a4f40').lerp(new THREE.Color(TEAMS[G.player.team].dark), 0.35), metalness: 0, roughness: 0.95, bumpMap: VMX.fabric, bumpScale: 0.004 });
  const spec = (clsKey === 'sniper' ? vmSniper : clsKey === 'smg' ? vmSmg : clsKey === 'lmg' ? vmLmg : clsKey === 'shotgun' ? vmShotgun : clsKey === 'pistol' ? vmPistol : vmRifle)(g, M);
  const handR = vmHand(M, false); handR.position.set(0.0, -0.05, 0.03); handR.rotation.set(-0.35, 0, 0); g.add(handR);
  const handL = vmHand(M, true);
  if (spec.cup) { handL.position.set(-0.045, -0.03, 0.02); handL.rotation.set(-0.3, 0.2, -0.2); }   // support hand wraps the grip
  else if (spec.vgrip) { handL.position.set(-0.01, spec.hand[1] - 0.04, spec.hand[0]); handL.rotation.set(-0.2, 0, 0); }
  else { handL.position.set(-0.012, spec.hand[1] - 0.045, spec.hand[0]); handL.rotation.set(0, 0, -0.35); }
  (spec.pump ? g.getObjectByName('pump') : g).add(handL);
  vmSleeve(g, sleeveM, 0.03, -0.1, 0.08, 0.35, 0.05);
  if (spec.cup) vmSleeve(g, sleeveM, -0.08, -0.08, 0.1, 0.3, -0.35);
  else vmSleeve(spec.pump ? g.getObjectByName('pump') : g, sleeveM, -0.07, spec.hand[1] - 0.04, spec.hand[0] + 0.07, 0.25, 0.5);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: '#ffd27a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.set(0.35, 0.35, 1); flash.position.set(0, clsKey === 'sniper' ? 0.135 : clsKey === 'shotgun' ? 0.145 : clsKey === 'pistol' ? 0.14 : 0.12, spec.muzzle - 0.06); flash.visible = false; flash.name = 'flash';
  g.add(flash);
  g.traverse(n => { if (n.isMesh) n.frustumCulled = false; });
  const holder = new THREE.Group(); holder.add(g); g.scale.setScalar(0.3);
  if (spec.cup) g.position.z = -0.07;   // the pistol is held out at arm's length
  vmScene.add(holder);
  R3.vm = holder; R3.vmCls = clsKey; R3.vmTeam = G.player.team; R3.vmSpec = spec;
  R3.drawT = 0;   // weapon comes up from below (feel.js)
}
// per-frame extras: the shotgun pump and the sniper bolt cycle after each shot
function animateViewModel() {
  const vm = R3.vm; if (!vm) return;
  const t = G.time - (R3.lastShotT ?? -9);
  const cyc = t > 0.12 && t < 0.62 ? Math.sin((t - 0.12) / 0.5 * Math.PI) : 0;
  const pump = vm.getObjectByName('pump'); if (pump) pump.position.z = cyc * 0.11;
  const slide = vm.getObjectByName('slide'); if (slide) slide.position.z = t >= 0 && t < 0.06 ? Math.sin(t / 0.06 * Math.PI) * 0.05 : 0;   // slide blowback
  const bolt = vm.getObjectByName('bolt'); if (bolt) { bolt.position.z = cyc * 0.08; }
}
