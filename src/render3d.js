'use strict';
// First-person 3D view, drawn with Three.js on its own canvas under the HUD canvas.
// The simulation stays on the 2D map: world (x, y) becomes three.js (x, height, y), with the same units
// (about 20 px = 1 m). Heights come from the terrain (elevAt), floors (soldier.z) and obstacle heights (o.z0, o.z1).

const R3 = {
  ok: false, map: null, look: { yaw: 0, pitch: 0 }, zoom: 1, fov: CFG.FOV,
  bySid: new Map(), soldiers: new Map(), bodies: [], decals: [], rubble: [], kick: 0, lastMag: -1, lastShotT: 0,
};

const SKY = {
  forest: { sky: '#a7bfcf', fog: '#a9b9ad', near: 600, far: 3000, sun: '#fff3dc', hemiSky: '#cfe1ff', hemiGround: '#4d5a36', sunI: 1.6, roof: '#7a3f31' },
  desert: { sky: '#e5d3ad', fog: '#ddc9a2', near: 700, far: 3200, sun: '#fff0cf', hemiSky: '#fff4dc', hemiGround: '#a9895a', sunI: 1.9, roof: '#9a6a44' },
  urban:  { sky: '#8f949a', fog: '#7f8388', near: 400, far: 2500, sun: '#f2eee6', hemiSky: '#c9ced6', hemiGround: '#4a4a46', sunI: 1.2, roof: '#4d4f55' },
  snow:   { sky: '#dfe7ee', fog: '#e4ebf0', near: 400, far: 2600, sun: '#ffffff', hemiSky: '#eef5ff', hemiGround: '#9fb0be', sunI: 1.4, roof: '#e8eef2' },
  swamp:  { sky: '#7d8a79', fog: '#6f7d6c', near: 200, far: 1700, sun: '#e9f0d8', hemiSky: '#b8c7b0', hemiGround: '#38402a', sunI: 1.0, roof: '#4a3f2c' },
};

const v3 = document.getElementById('view');
let gl3 = null;
try {
  gl3 = new THREE.WebGLRenderer({ canvas: v3, antialias: true, powerPreference: 'high-performance' });
  gl3.shadowMap.enabled = true;
  gl3.shadowMap.type = THREE.PCFSoftShadowMap;
  gl3.outputColorSpace = THREE.SRGBColorSpace;
  R3.ok = true;
} catch (e) { console.error('WebGL is not available', e); }

const scene3 = new THREE.Scene();
// Sky panorama. If it cannot load (index.html opened from disk), fall back to the theatre's plain sky colour.
let skyboxFailed = false;
const SKYBOX_TEXTURE = new THREE.TextureLoader().load('assets/textures/cinematic-sky-equirectangular.jpg', undefined, undefined, () => {
  skyboxFailed = true;
  if (scene3.environment === SKYBOX_TEXTURE) scene3.environment = null;
  if (scene3.background === SKYBOX_TEXTURE) scene3.background = scene3.userData.skyCol || null;
});
SKYBOX_TEXTURE.mapping = THREE.EquirectangularReflectionMapping;
SKYBOX_TEXTURE.colorSpace = THREE.SRGBColorSpace;
scene3.environment = SKYBOX_TEXTURE;
if ('environmentIntensity' in scene3) scene3.environmentIntensity = 0.35;
const cam3 = new THREE.PerspectiveCamera(CFG.FOV, 1, 2, 7000);
cam3.rotation.order = 'YXZ';
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
vmScene.add(new THREE.HemisphereLight('#ffffff', '#555555', 2.2));
const vmSun = new THREE.DirectionalLight('#ffffff', 1.4); vmSun.position.set(0.3, 1, 0.4); vmScene.add(vmSun);

function resize3() {
  if (!R3.ok) return;
  gl3.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  gl3.setSize(window.innerWidth, window.innerHeight, false);
  cam3.aspect = vmCam.aspect = window.innerWidth / Math.max(1, window.innerHeight);
  cam3.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize3);
resize3();

// ---------- shared geometry and materials
const UBOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const UCYL = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0);
const UCONE = new THREE.ConeGeometry(1, 1, 9).translate(0, 0.5, 0);
const USPH = new THREE.IcosahedronGeometry(1, 1);
const UROCK = new THREE.DodecahedronGeometry(1, 0);
const lam = (c, o = {}) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o));
// Load a color map from assets/textures/. If it cannot load (for example index.html opened from disk, where the
// browser blocks images for WebGL), fall back to a white pixel so the material keeps its plain vertex color instead
// of rendering black. Shared with surface.js.
function assetTexture(name, repeatX = 1, repeatY = 1) {
  const t = new THREE.Texture();
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8; // three clamps this to what the GPU supports
  t.userData.keepAlive = true; t.userData.avg = new THREE.Vector3(1, 1, 1);
  new THREE.ImageLoader().load(`assets/textures/${name}.png`,
    img => {
      t.image = img; t.needsUpdate = true;
      // average colour in linear light, so a shader can use the map as detail around the colour it already has
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data;
      t.userData.avg.set(...[d[0], d[1], d[2]].map(v => Math.pow(v / 255, 2.2)));
    },
    undefined,
    () => {
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 1);
      t.image = c; t.needsUpdate = true;
      console.warn(`texture ${name}.png did not load; using plain colors`);
    });
  return t;
}
const WORLD_TEX = {
  bark: assetTexture('bark', 1, 2),
  leaves: assetTexture('leaves', 2, 2),
  paint: assetTexture('vehicle-paint', 1, 1),
  rubber: assetTexture('tire-rubber', 1, 1),
};
const texturedLam = (texture, opts = {}) => lam('#ffffff', Object.assign({ map: texture }, opts));
const col3 = c => new THREE.Color(c);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
function mat(x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}
const shade = (hex, f) => { const c = col3(hex); c.multiplyScalar(f); return c; };

function makeDotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const DOT = makeDotTexture();

function labelSprite(text, color, size = 64, bg = 'rgba(10,14,12,0.7)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 52, 0, TAU); g.fill();
  g.strokeStyle = color; g.lineWidth = 7; g.stroke();
  g.fillStyle = '#fff'; g.font = '700 64px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  sp.scale.set(size / 1000, size / 1000, 1); sp.renderOrder = 10;
  sp.userData = { canvas: c, tex, text, color };
  return sp;
}
function relabel(sp, text, color) {
  if (sp.userData.text === text && sp.userData.color === color) return;
  const g = sp.userData.canvas.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(10,14,12,0.7)'; g.beginPath(); g.arc(64, 64, 52, 0, TAU); g.fill();
  g.strokeStyle = color; g.lineWidth = 7; g.stroke();
  g.fillStyle = '#fff'; g.font = '700 ' + (text.length > 2 ? 40 : 64) + 'px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  sp.userData.tex.needsUpdate = true; sp.userData.text = text; sp.userData.color = color;
}

function markerSprite(color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(12, 16); g.lineTo(52, 16); g.lineTo(32, 46); g.closePath(); g.stroke(); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  sp.scale.set(0.022, 0.022, 1); sp.renderOrder = 9;
  return sp;
}
// Batches of instanced static geometry (one draw call per shape for the whole map).
class Batch {
  constructor(geo, material) { this.geo = geo; this.mat = material; this.items = []; }
  add(m, color, sid) { this.items.push([m, color, sid]); }
  build(group) {
    const n = this.items.length; if (!n) return;
    const im = new THREE.InstancedMesh(this.geo, this.mat, n);
    this.items.forEach(([m, c, sid], i) => {
      im.setMatrixAt(i, m); im.setColorAt(i, c instanceof THREE.Color ? c : col3(c));
      if (sid !== undefined) { if (!R3.bySid.has(sid)) R3.bySid.set(sid, []); R3.bySid.get(sid).push([im, i]); }
    });
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    group.add(im);
  }
}

// ---------- build the world for a map
function r3Build(m, art) {
  if (!R3.ok) return;
  if (R3.world) { scene3.remove(R3.world); disposeTree(R3.world); }
  R3.map = m; R3.bySid.clear();
  R3.soldiers.forEach(o => scene3.remove(o.g)); R3.soldiers.clear();
  for (const b of R3.bodies) scene3.remove(b.g); R3.bodies = [];
  R3.decals = []; R3.rubble = [];
  const world = new THREE.Group(); R3.world = world; scene3.add(world);
  const B = BIOMES[m.biome], K = SKY[m.biome];
  scene3.userData.skyCol = col3(K.sky);
  scene3.background = skyboxFailed ? scene3.userData.skyCol : SKYBOX_TEXTURE;
  scene3.fog = new THREE.Fog(K.fog, K.near, K.far);
  R3.fogBase = [K.near, K.far];

  // lights
  const hemi = new THREE.HemisphereLight(K.hemiSky, K.hemiGround, 1.25); world.add(hemi);
  const sun = new THREE.DirectionalLight(K.sun, K.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -900; sc.right = 900; sc.top = 900; sc.bottom = -900; sc.near = 10; sc.far = 3000;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 1.5;
  world.add(sun); world.add(sun.target);
  R3.sun = sun;

  // terrain: one vertex every CELL px, textured with the painted ground layer
  const nx = GW + 1, ny = GH + 1, pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = i * CELL, y = j * CELL;
    pos[k * 3] = x; pos[k * 3 + 1] = elevAt(m, x, y); pos[k * 3 + 2] = y;
    uv[k * 2] = x / W; uv[k * 2 + 1] = 1 - y / H;
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let p = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tg.setIndex(new THREE.BufferAttribute(idx, 1));
  tg.computeVertexNormals();
  const tex = new THREE.CanvasTexture(art.ground);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = gl3.capabilities.getMaxAnisotropy();
  const terrain = new THREE.Mesh(tg, lam('#ffffff', { map: tex }));
  terrain.receiveShadow = true;
  world.add(terrain);
  // ground beyond the map edge
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(W * 4, H * 4).rotateX(-Math.PI / 2), lam(shade(B.ground, 0.8)));
  apron.position.set(W / 2, -3, H / 2); world.add(apron);

  // water: rivers, the gaps under bridges and swamp pools
  const waterM = new THREE.MeshLambertMaterial({ color: B.water, transparent: true, opacity: 0.82 });
  for (const r of m.rivers.concat(m.bridges.map(b => b.gap))) {
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(r.w + 20, r.h).rotateX(-Math.PI / 2), waterM);
    wm.position.set(r.x + r.w / 2, elevAt(m, r.x + r.w / 2, clamp(r.y + r.h / 2, 0, H)) - 6, r.y + r.h / 2); world.add(wm);
  }
  const poolM = new THREE.MeshLambertMaterial({ color: B.pool || B.water, transparent: true, opacity: 0.88 });
  for (const pl of m.pools) {
    const pm = new THREE.Mesh(new THREE.CircleGeometry(pl.r - 4, 24).rotateX(-Math.PI / 2), poolM);
    pm.position.set(pl.x, elevAt(m, pl.x, pl.y) + 1.5, pl.y); world.add(pm);
  }

  // obstacles
  const box = new Batch(UBOX, lam('#ffffff')), cyl = new Batch(UCYL, lam('#ffffff')), cone = new Batch(UCONE, lam('#ffffff'));
  const sph = new Batch(USPH, lam('#ffffff', { flatShading: true })), rock = new Batch(UROCK, lam('#ffffff', { flatShading: true }));
  const bark = new Batch(UCYL, texturedLam(WORLD_TEX.bark));
  const leaves = new Batch(USPH, texturedLam(WORLD_TEX.leaves, { flatShading: true }));
  const vehicle = new Batch(UBOX, texturedLam(WORLD_TEX.paint));
  const rubber = new Batch(UCYL, texturedLam(WORLD_TEX.rubber));
  const wallCol = k => WALL_COLORS[k] ? WALL_COLORS[k][1] : '#999';
  for (const o of m.solids) {
    const k = o.kind, gz = o.gz, sd = o.seed || 0.5, sid = o.sid;
    const cx = o.t === 'c' ? o.x : o.x + o.w / 2, cy = o.t === 'c' ? o.y : o.y + o.h / 2;
    const sink = 14;   // sink everything a little into the ground so slopes do not show gaps
    if (o.t === 'r' && (k === 'hwall' || k === 'window' || WALL_COLORS[k])) {
      const c = k === 'window' ? wallCol('hwall') : wallCol(k);
      const base = gz + o.z0 - (o.z0 === 0 ? sink : 0), top = gz + o.z1;
      const tint = shade(c, 0.88 + sd * 0.2);
      if (o.window) {
        box.add(mat(cx, base, cy, o.w, gz + o.z0 + WIN_LO - base, o.h), tint, sid);
        box.add(mat(cx, gz + o.z0 + WIN_HI, cy, o.w, top - (gz + o.z0 + WIN_HI), o.h), tint, sid);
        box.add(mat(cx, gz + o.z0 + WIN_LO - 3, cy, o.w + (o.w > o.h ? 0 : 6), 3, o.h + (o.w > o.h ? 6 : 0)), shade(c, 0.7), sid);   // sill
      } else box.add(mat(cx, base, cy, o.w, top - base, o.h), tint, sid);
      continue;
    }
    switch (k) {
      case 'tree': {
        const r = o.r;
        bark.add(mat(cx, gz - sink, cy, r * 0.32, 95 + sink, r * 0.32), '#ffffff', sid);
        leaves.add(mat(cx, gz + 120 + sd * 20, cy, r * 2.0, r * 1.7, r * 2.0, sd * 6), shade('#ffffff', 0.9 + sd * 0.2), sid);
        leaves.add(mat(cx + r * 0.5, gz + 165 + sd * 15, cy - r * 0.3, r * 1.4, r * 1.3, r * 1.4, sd * 3), shade('#ffffff', 0.95 + sd * 0.15), sid);
        break;
      }
      case 'pine': {
        const r = o.r;
        bark.add(mat(cx, gz - sink, cy, r * 0.28, 70 + sink, r * 0.28), '#ffffff', sid);
        cone.add(mat(cx, gz + 50, cy, r * 2.1, 110, r * 2.1, sd * 6), shade(B.tree, 1 + sd * 0.3), sid);
        cone.add(mat(cx, gz + 115, cy, r * 1.6, 95, r * 1.6, sd * 4), shade(B.treeMid, 1 + sd * 0.3), sid);
        cone.add(mat(cx, gz + 175, cy, r * 1.0, 75, r * 1.0), m.biome === 'snow' ? '#eef3f5' : shade(B.treeMid, 1.2), sid);
        break;
      }
      case 'deadtree': {
        const r = o.r;
        bark.add(mat(cx, gz - sink, cy, r * 0.45, 140 + sink, r * 0.45), '#b4a18a', sid);
        box.add(mat(cx, gz + 80, cy, 4, 60, 4, sd * 6, 0.7), '#3b3424', sid);
        box.add(mat(cx, gz + 105, cy, 3, 45, 3, sd * 6 + 2, -0.6), '#3b3424', sid);
        break;
      }
      case 'rock': case 'ice': case 'rubble': {
        const h = o.z1 - o.z0, c = k === 'ice' ? '#bcd3e2' : k === 'rubble' ? '#6f6a62' : B.rock;
        rock.add(mat(cx, gz + h * 0.35, cy, o.r * 1.05, h * 0.75, o.r * 1.05, sd * 6, sd - 0.5), shade(c, 0.85 + sd * 0.3), sid);
        break;
      }
      case 'cactus': {
        cyl.add(mat(cx, gz - sink, cy, o.r * 0.7, 52 + sink, o.r * 0.7), '#5d7f3a', sid);
        cyl.add(mat(cx + o.r * 0.9, gz + 22, cy, o.r * 0.4, 18, o.r * 0.4), '#5d7f3a', sid);
        cyl.add(mat(cx - o.r * 0.9, gz + 28, cy, o.r * 0.4, 14, o.r * 0.4), '#5d7f3a', sid);
        break;
      }
      case 'bag': {
        const c = m.biome === 'snow' ? '#c9c2aa' : '#a8936a';
        sph.add(mat(cx, gz + 5, cy, o.r * 1.15, 7, o.r), shade(c, 0.9 + sd * 0.2), sid);
        sph.add(mat(cx, gz + 15, cy, o.r * 1.05, 7, o.r * 0.95, 0.7), shade(c, 0.95 + sd * 0.2), sid);
        break;
      }
      case 'crate': box.add(mat(cx, gz - 4, cy, o.w, o.z1 + 4, o.h, sd * 0.3), shade('#8a6a3e', 0.85 + sd * 0.3), sid); break;
      case 'log': box.add(mat(cx, gz - 4, cy, o.w, o.z1 + 4, o.h), '#5b4430', sid); break;
      case 'barrier': box.add(mat(cx, gz - 4, cy, o.w, o.z1 + 4, o.h), '#9b9890', sid); break;
      case 'snowwall': box.add(mat(cx, gz - 6, cy, o.w, o.z1 + 6, o.h), '#f2f6f8', sid); break;
      case 'car': {
        const longX = o.w >= o.h, L = Math.max(o.w, o.h), S = Math.min(o.w, o.h);
        const c = pickR(mulberry32((sd * 1e9) >>> 0), ['#a9b0a4', '#89938a', '#b3a68a', '#8e969b']);
        vehicle.add(mat(cx, gz - 2, cy, o.w, 18, o.h), c, sid);
        vehicle.add(mat(cx, gz + 16, cy, longX ? L * 0.55 : S * 0.88, 14, longX ? S * 0.88 : L * 0.55), shade(c, 0.84), sid);
        box.add(mat(cx + (longX ? L * 0.49 : S * 0.49), gz + 7, cy, 2, 7, S * 0.75, 0), '#333a3c', sid);
        const wr = Math.max(6, Math.min(10, S * 0.19)), ww = Math.max(5, Math.min(8, S * 0.15));
        for (const along of [-1, 1]) for (const side of [-1, 1]) {
          const wx = cx + (longX ? along * L * 0.3 : side * S * 0.46);
          const wz = cy + (longX ? side * S * 0.46 : along * L * 0.3);
          rubber.add(mat(wx, gz + wr - 2, wz, wr, ww, wr, 0, longX ? Math.PI / 2 : 0, longX ? 0 : Math.PI / 2), '#ffffff', sid);
        }
        break;
      }
      case 'truck': case 'tank': case 'container': case 'tent': case 'barrel': case 'hay': case 'fence': case 'well':
      case 'bus': case 'dumpster': case 'boat': case 'pole': case 'bunker':
        buildProp(o, k, cx, cy, gz, sd, sid, { box, cyl, cone, sph, vehicle, rubber }, m.biome); break;
      default: box.add(mat(cx, gz - 4, cy, o.t === 'c' ? o.r * 2 : o.w, o.z1 + 4, o.t === 'c' ? o.r * 2 : o.h), '#777', sid);
    }
  }
  // houses: upper floor, stairs and roofs
  for (const f of m.houses) {
    const b = f.base, FH = CFG.FLOOR_H, rc = K.roof;
    if (f.stories === 2) {
      const st = f.stair, rects = [];
      rects.push([f.x, f.y, f.w, st.ry - f.y], [f.x, st.ry + st.rh, f.w, f.y + f.h - st.ry - st.rh], [f.x, st.ry, st.rx - f.x, st.rh], [st.rx + st.rw, st.ry, f.x + f.w - st.rx - st.rw, st.rh]);
      for (const [x, y, w, h] of rects) if (w > 0.5 && h > 0.5) box.add(mat(x + w / 2, b + FH - 7, y + h / 2, w - 0.5, 7, h - 0.5), '#6b5a48');
      // stairs: solid steps
      const n = 10, dx = (st.x1 - st.x0) / n, dy = (st.y1 - st.y0) / n, horiz = st.y0 === st.y1;
      for (let i = 0; i < n; i++) {
        const x = st.x0 + dx * (i + 0.5), y = st.y0 + dy * (i + 0.5), h = FH * (i + 1) / n;
        box.add(mat(x, b - 2, y, horiz ? Math.abs(dx) + 0.5 : st.w, h + 2 - (i === n - 1 ? 7 : 0), horiz ? st.w : Math.abs(dy) + 0.5), shade('#7a6450', 0.9 + (i % 2) * 0.12));
      }
    }
    // gable roof along the long side
    const top = b + f.stories * FH, long = f.w >= f.h, L = (long ? f.w : f.h) + 16, S = (long ? f.h : f.w) + 16, rise = 44;
    const g = roofGeometry(L, S, rise);
    const roof = new THREE.Mesh(g, lam(rc, { flatShading: true, side: THREE.DoubleSide }));
    roof.position.set(f.x + f.w / 2, top, f.y + f.h / 2);
    if (!long) roof.rotation.y = Math.PI / 2;
    roof.castShadow = true; roof.receiveShadow = true;
    world.add(roof);
    box.add(mat(f.x + f.w / 2, top - 5, f.y + f.h / 2, f.w, 5, f.h), shade(rc, 0.6));   // ceiling under the roof
  }
  // bridges
  R3.bridges = m.bridges.map(br => {
    const g = new THREE.Group();
    const e = elevAt(m, br.cx, br.cy);
    const deck = new THREE.Mesh(UBOX, lam('#8a6a42')); deck.scale.set(br.w + 30, 9, br.h); deck.position.set(br.cx, e - 6, br.cy);
    deck.castShadow = deck.receiveShadow = true;
    const railM = lam('#5b4430');
    for (const sy of [-1, 1]) {
      const rail = new THREE.Mesh(UBOX, railM); rail.scale.set(br.w + 30, 4, 4); rail.position.set(br.cx, e + 16, br.cy + sy * (br.h / 2 - 3)); g.add(rail);
      for (let i = 0; i < 6; i++) { const post = new THREE.Mesh(UBOX, railM); post.scale.set(4, 20, 4); post.position.set(br.x - 12 + i * (br.w + 24) / 5, e, br.cy + sy * (br.h / 2 - 3)); g.add(post); }
    }
    const plate = new THREE.Mesh(UBOX, lam('#e6ad45')); plate.scale.set(36, 1, 36); plate.position.set(br.cx, e + 3, br.cy);
    g.add(deck, plate);
    const stub = new THREE.Group();
    for (const sx of [-1, 1]) { const s = new THREE.Mesh(UBOX, lam('#4a3a24')); s.scale.set(26, 8, br.h - 10); s.position.set(br.cx + sx * (br.w / 2 - 6), e - 6, br.cy); s.rotation.z = sx * 0.25; stub.add(s); }
    stub.visible = false;
    world.add(g, stub);
    return { g, stub };
  });
  // depots: crates and a flag pole
  m.depots.forEach((d, t) => {
    const e = elevAt(m, d.x, d.y);
    for (let i = 0; i < 5; i++) box.add(mat(d.x - 50 + (i % 3) * 36, e - 2 + (i > 2 ? 32 : 0), d.y + 34, 32, 32, 32, i * 0.2), shade('#7b6a43', 0.9 + i * 0.05));
    cyl.add(mat(d.x + 70, e, d.y - 50, 2, 150, 2), '#cccccc');
    box.add(mat(d.x + 70 + (t === 0 ? 22 : -22), e + 120, d.y - 50, 44, 28, 1.5), TEAMS[t].color);
  });
  for (const bt of [box, cyl, cone, sph, rock, bark, leaves, vehicle, rubber]) bt.build(world);

  // sector borders: a line on the ground along every edge between two sectors (and around the bases)
  if (m.sector) {
    const seg = [], gz = (x, y) => elevAt(m, clamp(x, 0, W - 1), clamp(y, 0, H - 1)) + 3;
    const add = (x0, y0, x1, y1) => { for (let k = 0; k < 2; k++) { const a = k / 2, b = (k + 1) / 2;
      const xa = x0 + (x1 - x0) * a, ya = y0 + (y1 - y0) * a, xb = x0 + (x1 - x0) * b, yb = y0 + (y1 - y0) * b;
      seg.push(new THREE.Vector3(xa, gz(xa, ya), ya), new THREE.Vector3(xb, gz(xb, yb), yb)); } };
    for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
      const v = m.sector[j * NW + i];
      if (i + 1 < NW && m.sector[j * NW + i + 1] !== v) add((i + 1) * NC, j * NC, (i + 1) * NC, (j + 1) * NC);
      if (j + 1 < NH && m.sector[(j + 1) * NW + i] !== v) add(i * NC, (j + 1) * NC, (i + 1) * NC, (j + 1) * NC);
    }
    world.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: '#f0d9a0', transparent: true, opacity: 0.55 })));
  }
  // sector flags: a pole with a flag that rises as the sector is captured, and its letter
  R3.points = m.points.map(pt => {
    const e = elevAt(m, pt.x, pt.y);
    const ring = null;
    const pole = new THREE.Mesh(UCYL, lam('#d8d4c4')); pole.scale.set(2.2, 170, 2.2); pole.position.set(pt.x, e, pt.y);
    const flagM = lam('#d8d4c4', { side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(50, 30).translate(25, 0, 0), flagM);
    flag.position.set(pt.x, e + 150, pt.y);
    const label = labelSprite(pt.name, '#e6ad45', 46);
    label.position.set(pt.x, e + 200, pt.y);
    pole.castShadow = true;
    world.add(pole, flag, label);
    return { ring, flag, label, e };
  });
  R3.dyn = new THREE.Group(); world.add(R3.dyn);
  R3.pools = {};
  buildParticles(world);
  buildTracers(world);
  buildWeather(world, m.biome);
  R3.decalMesh = null;
  if (typeof surfaceWorld === 'function') surfaceWorld(world, terrain, m.biome);
}

function roofGeometry(L, S, rise) {
  const hl = L / 2, hs = S / 2;
  const v = [
    // two slopes
    -hl, 0, -hs, hl, 0, -hs, hl, rise, 0, -hl, 0, -hs, hl, rise, 0, -hl, rise, 0,
    -hl, 0, hs, -hl, rise, 0, hl, rise, 0, -hl, 0, hs, hl, rise, 0, hl, 0, hs,
    // gable ends
    -hl, 0, -hs, -hl, rise, 0, -hl, 0, hs, hl, 0, -hs, hl, 0, hs, hl, rise, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry && ![UBOX, UCYL, UCONE, USPH, UROCK].includes(n.geometry)) n.geometry.dispose();
    if (n.material) { const ms = Array.isArray(n.material) ? n.material : [n.material]; for (const mm of ms) { if (mm.map && mm.map !== DOT && !mm.map.userData.keepAlive) mm.map.dispose(); mm.dispose(); } }
  });
}

// A wall (or any solid) knocked down: hide its instances and leave rubble.
function r3RemoveSolid(o) {
  const list = R3.bySid.get(o.sid);
  if (!list) return;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const [im, i] of list) { im.setMatrixAt(i, zero); im.instanceMatrix.needsUpdate = true; }
  R3.bySid.delete(o.sid);
  const e = o.gz + o.z0;
  for (let i = 0; i < 4; i++) addRubble(o.x + Math.random() * o.w, e + (o.z0 > 0 ? 0 : 0), o.y + Math.random() * o.h, o.z0 > 0);
}
function addRubble(x, e, y, fromAbove) {
  if (!R3.dyn) return;
  const ground = elevAt(R3.map, x, y);
  const f = houseAt(R3.map, x, y);
  const z = f && fromAbove && f.stories === 2 && !inStair(f.stair, x, y) ? f.base + CFG.FLOOR_H : ground;
  const r = new THREE.Mesh(UROCK, lam(shade('#6f6458', 0.8 + Math.random() * 0.4), { flatShading: true }));
  const s = 4 + Math.random() * 6;
  r.scale.set(s * 1.4, s, s); r.position.set(x, z + s * 0.4, y); r.rotation.set(Math.random(), Math.random() * 6, 0);
  r.castShadow = true;
  R3.world.add(r);
  R3.rubble.push(r);
  if (R3.rubble.length > 240) { const old = R3.rubble.shift(); R3.world.remove(old); old.material.dispose(); }
}

// ---------- decals: blood and scorch marks lying on the ground
const DECAL_MAX = 260;
function addDecal(x, y, r, color, alpha) {
  if (!R3.world) return;
  if (!R3.decalMesh) {
    const g = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    R3.decalMesh = new THREE.InstancedMesh(g, m, DECAL_MAX); R3.decalMesh.count = 0; R3.decalMesh.frustumCulled = false; R3.decalMesh.receiveShadow = true;
    R3.decalN = 0;
    R3.world.add(R3.decalMesh);
  }
  const f = houseAt(R3.map, x, y);
  const e = elevAt(R3.map, x, y) + 0.8;
  const i = R3.decalN % DECAL_MAX;
  R3.decalMesh.setMatrixAt(i, mat(x, e, y, r, 1, r * (0.8 + Math.random() * 0.4), Math.random() * 6));
  R3.decalMesh.setColorAt(i, col3(color));
  R3.decalN++;
  R3.decalMesh.count = Math.min(DECAL_MAX, R3.decalN);
  R3.decalMesh.instanceMatrix.needsUpdate = true;
  if (R3.decalMesh.instanceColor) R3.decalMesh.instanceColor.needsUpdate = true;
}

// Route the 2D decal stamps into the 3D world as well.
const _stampBlood = stampBlood, _stampScorch = stampScorch, _stampBody = stampBody, _stampRubble = stampRubble;
stampBlood = function (art, x, y, r) { if (art) _stampBlood(art, x, y, r); addDecal(x, y, r * 1.8, '#5a0b0b'); };
stampScorch = function (art, x, y, r) { if (art) _stampScorch(art, x, y, r); addDecal(x, y, r, '#1c1a16'); };
stampBody = function (art, s) { if (art) _stampBody(art, s); addBody(s.x, s.y, s.angle, s.team, s.z || 0, s.fallA, s.cls && s.cls.key, s.para || 0); addDecal(s.x - Math.cos(s.angle) * 8, s.y - Math.sin(s.angle) * 8, 16, '#4a0909'); };
stampRubble = function (art, o) { if (art) _stampRubble(art, o); r3RemoveSolid(o); };
stampCasing = function () {};

// ---------- soldiers
// Low-poly but detailed: boots, knee pads, plate carrier with pouches, backpack with a bedroll, gloves,
// a helmet with brim, cover band and goggles, and weapons with magazine, sights and stock.
const SOLDIER_GEO = {
  thigh: new THREE.BoxGeometry(6, 9, 6).translate(0, -4.5, 0),
  shin: new THREE.BoxGeometry(5.2, 8, 5.2).translate(0, -12, 0),
  knee: new THREE.BoxGeometry(2, 3.2, 4.6).translate(3.2, -8.6, 0),
  boot: new THREE.BoxGeometry(8.5, 3.2, 5.8).translate(1.4, -15.6, 0),
  hips: new THREE.BoxGeometry(8.5, 4, 13).translate(0, 2, 0),
  torso: new THREE.BoxGeometry(8.4, 11, 13.2).translate(0, 8.5, 0),
  vest: new THREE.BoxGeometry(9.8, 8.5, 12).translate(0, 8.8, 0),
  pouch: new THREE.BoxGeometry(2.2, 3.4, 2.8),
  collar: new THREE.CylinderGeometry(3.2, 3.6, 2, 10),
  pack: new THREE.BoxGeometry(4.5, 9, 9.5),
  roll: new THREE.CylinderGeometry(2, 2, 10, 8).rotateX(Math.PI / 2),
  head: new THREE.SphereGeometry(4.3, 14, 10),
  nose: new THREE.BoxGeometry(1.2, 1.4, 1.1),
  helmet: new THREE.SphereGeometry(5.3, 14, 7, 0, TAU, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(5.9, 6.1, 0.9, 16),
  goggles: new THREE.TorusGeometry(5.35, 0.75, 6, 18, Math.PI * 0.9),
  upper: new THREE.BoxGeometry(7, 4, 4).translate(3.5, 0, 0),
  fore: new THREE.BoxGeometry(8, 3.4, 3.4).translate(10.5, 0, 0),
  glove: new THREE.BoxGeometry(3, 3.6, 3.6).translate(16, 0, 0),
};
// Arm from shoulder S to hand H (arms-group coordinates): upper arm 7 long, forearm + glove reaching 11; the elbow
// bends toward 'down and out' (side +1 = right).
const ARM_FORE = new THREE.BoxGeometry(8, 3.4, 3.4).translate(4, 0, 0), ARM_GLOVE = new THREE.BoxGeometry(3, 3.6, 3.6).translate(9.5, 0, 0);
function ikArm(S, H, side, uni, glove) {
  const L1 = 7, L2 = 11, X = new THREE.Vector3(1, 0, 0), g = new THREE.Group();
  const sv = new THREE.Vector3(...S), hv = new THREE.Vector3(...H), dir = hv.clone().sub(sv);
  const dl = clamp(dir.length(), 0.5, L1 + L2 - 0.05); dir.normalize();
  const a = Math.acos(clamp((L1 * L1 + dl * dl - L2 * L2) / (2 * L1 * dl), -1, 1));
  const pole = new THREE.Vector3(0, -1, side * 0.7); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const E = sv.clone().addScaledVector(dir, Math.cos(a) * L1).addScaledVector(pole, Math.sin(a) * L1);
  const up = new THREE.Mesh(SOLDIER_GEO.upper, uni); up.position.copy(sv); up.quaternion.setFromUnitVectors(X, E.clone().sub(sv).normalize());
  const fq = new THREE.Quaternion().setFromUnitVectors(X, hv.clone().sub(E).normalize());
  const fo = new THREE.Mesh(ARM_FORE, uni); fo.position.copy(E); fo.quaternion.copy(fq);
  const gl = new THREE.Mesh(ARM_GLOVE, glove); gl.position.copy(E); gl.quaternion.copy(fq);
  g.add(up, fo, gl);
  return g;
}
const GUN_SPEC = {   // length, height, barrel length, magazine height, stock length
  rifleman: { L: 22, H: 3.6, B: 9, mag: 6, stock: 8 },
  sniper: { L: 28, H: 3.2, B: 15, mag: 3.5, stock: 10, scope: true },
  smg: { L: 15, H: 3.8, B: 4, mag: 8, stock: 5 },
  lmg: { L: 25, H: 4.6, B: 11, mag: 0, stock: 9, box: true, bipod: true },
  shotgun: { L: 16, H: 3.6, B: 13, mag: 0, stock: 9, pump: true },
  pistol: { L: 9, H: 3.4, B: 2, mag: 5, stock: 0 },
};
function gunMesh(clsKey, material) {
  const g = new THREE.Group(), sp = GUN_SPEC[clsKey] || GUN_SPEC.rifleman;
  const metal = lam('#3e423f'), wood = clsKey === 'sniper' || clsKey === 'shotgun' ? lam('#5a4330') : material;
  const add = (geo, m, x, y, z, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.z = rz; g.add(o); return o; };
  add(new THREE.BoxGeometry(sp.L, sp.H, 3), material, sp.L / 2 - 2, 0, 0);                                 // receiver
  add(new THREE.CylinderGeometry(0.75, 0.75, sp.B, 8).rotateZ(Math.PI / 2), metal, sp.L - 2 + sp.B / 2, 0.6, 0); // barrel
  if (sp.stock) add(new THREE.BoxGeometry(sp.stock, sp.H * 1.15, 2.6), wood, -sp.stock / 2 - 1.5, -0.7, 0);              // stock
  add(new THREE.BoxGeometry(2, 4.2, 2.4), material, 3, -3.2, 0, -0.35);                                     // grip
  if (sp.mag) add(new THREE.BoxGeometry(2.6, sp.mag, 2.2), metal, 9, -sp.H / 2 - sp.mag / 2 + 0.6, 0, 0.18); // magazine
  add(new THREE.BoxGeometry(1.2, 1.6, 1), metal, sp.L - 3, sp.H / 2 + 0.8, 0);                              // front sight
  if (sp.scope) {
    add(new THREE.CylinderGeometry(1.4, 1.4, 11, 10).rotateZ(Math.PI / 2), metal, 10, sp.H / 2 + 2.4, 0);
    add(new THREE.CylinderGeometry(1.8, 1.8, 2, 10).rotateZ(Math.PI / 2), metal, 16, sp.H / 2 + 2.4, 0);
  } else add(new THREE.BoxGeometry(3, 1.6, 1.6), metal, 6, sp.H / 2 + 0.8, 0);                              // rear sight
  if (sp.pump) {   // magazine tube under the barrel and a ribbed pump grip
    add(new THREE.CylinderGeometry(0.65, 0.65, sp.B, 8).rotateZ(Math.PI / 2), metal, sp.L - 2 + sp.B / 2, -0.9, 0);
    add(new THREE.CylinderGeometry(1.4, 1.4, 6, 10).rotateZ(Math.PI / 2), lam('#222'), sp.L + 3, -0.6, 0);
  }
  if (sp.box) add(new THREE.BoxGeometry(5, 5, 4.4), lam('#4b5a3a'), 8, -4.4, 1.2);                         // ammo box
  if (sp.bipod) { add(new THREE.BoxGeometry(0.7, 7, 0.7), metal, sp.L - 4, -3.5, -1.2, 0.5); add(new THREE.BoxGeometry(0.7, 7, 0.7), metal, sp.L - 4, -3.5, 1.2, 0.5); }
  g.traverse(n => { if (n.isMesh) n.castShadow = true; });
  return g;
}
const SHARED_GEO = new Set(Object.values(SOLDIER_GEO));
function disposeModel(g) {
  g.traverse(n => {
    if (n.geometry && !SHARED_GEO.has(n.geometry)) n.geometry.dispose();
    if (n.material) n.material.dispose();
  });
}
function makeSoldierModel(team, clsKey) {
  const T = TEAMS[team];
  const uni = lam(shade(T.color, 0.5)), dark = lam(shade(T.dark, 0.85)), vestM = lam(shade(T.dark, 0.6)), helm = lam(T.helmet);
  const skin = lam('#c99b7a'), boots = lam('#2a2622'), glove = lam('#3a3631'), strap = lam('#2f3329'), gunM = lam('#232624');
  const pouchM = lam(shade(T.helmet, 0.9)), glass = lam('#20262a', { emissive: '#0d1418' });
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const leg = z => {
    const L = new THREE.Group(); L.position.set(0, 16, z);
    const shin = new THREE.Group(); shin.position.y = -9; L.userData.shin = shin;   // knee joint
    for (const mm of [new THREE.Mesh(SOLDIER_GEO.shin, dark), new THREE.Mesh(SOLDIER_GEO.knee, strap), new THREE.Mesh(SOLDIER_GEO.boot, boots)]) { mm.position.y = 9; shin.add(mm); }
    L.add(new THREE.Mesh(SOLDIER_GEO.thigh, dark), shin);
    return L;
  };
  const legL = leg(-3.4), legR = leg(3.4);
  const hips = new THREE.Mesh(SOLDIER_GEO.hips, dark); hips.position.y = 14;
  const torso = new THREE.Mesh(SOLDIER_GEO.torso, uni); torso.position.y = 16;
  const vest = new THREE.Mesh(SOLDIER_GEO.vest, vestM); vest.position.y = 16;
  for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(SOLDIER_GEO.pouch, pouchM); p.position.set(5.6, 21.2, -3.6 + i * 3.6); body.add(p); }
  const collar = new THREE.Mesh(SOLDIER_GEO.collar, uni); collar.position.y = 28;
  const pack = new THREE.Mesh(SOLDIER_GEO.pack, pouchM); pack.position.set(-6.8, 24, 0);
  const roll = new THREE.Mesh(SOLDIER_GEO.roll, lam('#5d5a48')); roll.position.set(-7, 30, 0);
  const head = new THREE.Mesh(SOLDIER_GEO.head, skin); head.position.y = 32.4;
  const nose = new THREE.Mesh(SOLDIER_GEO.nose, skin); nose.position.set(4.3, 32.2, 0);
  const helmet = new THREE.Mesh(SOLDIER_GEO.helmet, helm); helmet.position.y = 33.2;
  const brim = new THREE.Mesh(SOLDIER_GEO.brim, helm); brim.position.y = 33.3;
  const goggles = new THREE.Mesh(SOLDIER_GEO.goggles, glass); goggles.position.y = 35.2; goggles.rotation.set(Math.PI / 2, 0, Math.PI * 0.55);
  const band = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2, 4.6), lam(T.color, { emissive: shade(T.color, 0.35) })); band.position.set(0, 24.5, 6.9);   // armband
  const band2 = band.clone(); band2.position.z = -6.9;
  const arms = new THREE.Group(); arms.position.set(1, 26.5, 0);
  // a real rifle hold: stock in the right shoulder, right hand on the grip, left hand forward under the handguard,
  // elbows bent down and out (two-bone IK, solved once here). The pistol is held out in front with both hands.
  const sp = GUN_SPEC[clsKey] || GUN_SPEC.rifleman, pistol = !sp.stock;
  const G = pistol ? [9, -3, 0.8] : [2.5, -2.2, 2.4];
  const gun = gunMesh(clsKey, gunM); gun.position.set(G[0], G[1], G[2]); gun.rotation.y = pistol ? 0 : -0.05;
  const hR = [G[0] + 3, G[1] - 3.4, G[2]], hL = pistol ? [G[0] + 2.4, G[1] - 3.9, G[2] - 1.6] : [G[0] + Math.min(sp.L * 0.62, 14.5), G[1] - 2, G[2] - 0.4];
  arms.add(ikArm([0, 0, 5.4], hR, 1, uni, glove), ikArm([0, 0, -5.4], hL, -1, uni, glove), gun);
  body.add(legL, legR, hips, torso, vest, collar, pack, roll, head, nose, helmet, brim, goggles, band, band2, arms);
  // parachute canopy and lines, shown while dropping in
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(34, 14, 6, 0, TAU, 0, Math.PI / 2.4), lam(shade(T.color, 0.75), { side: THREE.DoubleSide }));
  canopy.scale.y = 0.55; canopy.position.y = 92; chute.add(canopy);
  const lineM = new THREE.LineBasicMaterial({ color: '#2a2a2a' }), pts = [];
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; pts.push(new THREE.Vector3(0, 30, 0), new THREE.Vector3(Math.cos(a) * 28, 98, Math.sin(a) * 28)); }
  chute.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineM));
  chute.visible = false; g.add(chute);
  g.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
  g.userData = { body, legL, legR, arms, chute, cls: clsKey, team };
  return g;
}
// Third-person animation (smooth feel): stride-matched walk and run cycles with knees, blended by speed,
// legs swing toward the direction of travel (strafing, walking backwards), a forward lean when running,
// a little body bob per footfall, and turning eased instead of snapping between network updates.
function animateSoldier(s, o, u, dt) {
  const x = s.rx ?? s.x, y = s.ry ?? s.y, fz = s.rfz ?? feetZ(s), a = s.ra ?? s.angle;
  o.g.position.set(x, fz, y);
  o.ang = o.ang === undefined ? a : o.ang + angDiff(o.ang, a) * (1 - Math.exp(-dt * 22));
  o.g.rotation.y = -o.ang;
  // velocity from what is drawn, smoothed (works for bots, predicted and interpolated soldiers alike)
  if (o.lx !== undefined && dt > 0) {
    const vx = (x - o.lx) / dt, vy = (y - o.ly) / dt, ok = Math.hypot(vx, vy) < 600, kk = 1 - Math.exp(-dt * 12);
    o.vx = lerp(o.vx || 0, ok ? vx : 0, kk); o.vy = lerp(o.vy || 0, ok ? vy : 0, kk);
  }
  o.lx = x; o.ly = y;
  const spd = Math.hypot(o.vx || 0, o.vy || 0), air = (s.jz || 0) > 2 && !(s.para > 0);
  const walkT = s.para > 0 || s.crouch || air ? 0 : clamp(spd / CFG.WALK, 0, 1), runT = s.para > 0 || s.crouch || air ? 0 : clamp((spd - CFG.WALK) / (CFG.SPRINT - CFG.WALK), 0, 1);
  o.wT = lerp(o.wT || 0, walkT, 1 - Math.exp(-dt * 10)); o.rT = lerp(o.rT || 0, runT, 1 - Math.exp(-dt * 6));
  o.cT = lerp(o.cT || 0, s.crouch ? 1 : 0, 1 - Math.exp(-dt * 12)); o.aT = lerp(o.aT || 0, air ? 1 : 0, 1 - Math.exp(-dt * 14));
  const rel = spd > 5 ? Math.atan2(o.vy, o.vx) - o.ang : 0, fwd = Math.cos(rel), side = Math.sin(rel);
  const ph = s.rwp ?? s.walkPhase, A = lerp(0.42, 0.78, o.rT) * o.wT, B = lerp(0.55, 1.15, o.rT) * o.wT;
  const leg = (L, p) => {
    const sw = Math.sin(p) * A, kn = 0.08 * o.wT + B * Math.max(0, Math.cos(p)) * (fwd >= 0 ? 1 : 0.6);
    L.rotation.z = sw * fwd; L.rotation.x = -sw * side * 0.7; L.userData.shin.rotation.z = -kn;
  };
  leg(u.legL, ph); leg(u.legR, ph + Math.PI);
  // crouch (kneel) and jump (tuck) blend over the walk pose
  const c = o.cT, t = o.aT;
  u.legL.rotation.z = lerp(lerp(u.legL.rotation.z, 1.35, c), 0.9, t); u.legL.userData.shin.rotation.z = lerp(lerp(u.legL.userData.shin.rotation.z, -1.5, c), -1.1, t);
  u.legR.rotation.z = lerp(lerp(u.legR.rotation.z, -0.35, c), 0.3, t); u.legR.userData.shin.rotation.z = lerp(lerp(u.legR.userData.shin.rotation.z, -1.2, c), -0.9, t);
  u.body.position.y = -10 * c - Math.abs(Math.sin(ph)) * 0.9 * o.wT * (1 - c) + 0.4 * o.wT;
  u.body.rotation.z = -0.16 * o.rT * fwd;   // lean into a run
  u.body.rotation.x = 0.06 * o.rT * side;
  u.arms.rotation.x = Math.sin(ph) * 0.05 * o.wT;
}
function soldierObj(s) {
  let o = R3.soldiers.get(s.id);
  const ck = s.cls.key;
  if (o && (o.cls !== ck || o.team !== s.team)) { scene3.remove(o.g); disposeModel(o.g); o = null; }
  if (!o) {
    o = { g: makeSoldierModel(s.team, ck), cls: ck, team: s.team, mark: null };
    scene3.add(o.g);
    R3.soldiers.set(s.id, o);
  }
  return o;
}
// Deaths are animated: the soldier is knocked back away from the shot and falls in one of three ways
// (backward, crumpling forward onto the knees, or twisting sideways), then settles with a small bounce.
// z is the floor the body comes to rest on; air is how high above it the soldier died (parachuting).
function addBody(x, y, angle, team, z, fallA, cls, air) {
  if (!R3.map) return;
  if (fallA === undefined || fallA === null) fallA = angle + Math.PI;
  const g = makeSoldierModel(team, cls || 'rifleman');
  const r = Math.random(), kind = r < 0.5 ? 'back' : r < 0.8 ? 'fwd' : 'side';
  const heading = kind === 'back' ? fallA + Math.PI : kind === 'fwd' ? fallA : fallA + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
  g.rotation.y = -heading;
  const ground = elevAt(R3.map, x, y) + (z || 0);
  g.position.set(x, ground + (air || 0), y);
  scene3.add(g);
  const knock = kind === 'back' ? rand(14, 26) : kind === 'fwd' ? rand(4, 10) : rand(8, 16);
  R3.bodies.push({ g, t: 0, born: G.time, kind, x, y, ground, air: air || 0, kx: Math.cos(fallA) * knock, ky: Math.sin(fallA) * knock,
    dur: kind === 'fwd' ? 0.95 : 0.7, side: Math.random() < 0.5 ? 1 : -1, armA: rand(-1.4, -0.6) });
  if (R3.bodies.length > 18) { const b = R3.bodies.shift(); scene3.remove(b.g); disposeModel(b.g); }
}
function animateBody(b, dt) {
  b.t += dt;
  const u = b.g.userData, T = b.t, p = clamp(T / b.dur, 0, 1);
  const easeOut = 1 - (1 - Math.min(1, T / 0.45)) ** 3;   // knockback slide
  const settle = p < 1 ? 0 : Math.exp(-(T - b.dur) * 9) * Math.sin((T - b.dur) * 28) * 0.07;   // small bounce on impact
  let fall = 0;
  if (b.air > 0) fall = Math.max(0, b.air - 0.5 * 900 * T * T);
  b.g.position.set(b.x + b.kx * easeOut, b.ground + fall, b.y + b.ky * easeOut);
  const LIE = Math.PI / 2 - 0.08;
  if (b.kind === 'back') {
    // stagger, knees give, then tip over backward with the arms flung up
    const tip = p * p * (3 - 2 * p) * (p < 0.15 ? 0.3 : 1);
    u.body.rotation.z = LIE * tip + settle;
    u.body.position.y = 4 * tip - Math.sin(p * Math.PI) * 4;
    u.legL.rotation.z = -0.5 * Math.sin(p * Math.PI) + 0.3 * p; u.legR.rotation.z = 0.25 * p;
    u.arms.rotation.z = b.armA * Math.min(1, p * 1.6);
  } else if (b.kind === 'fwd') {
    // drop to the knees first, then fall face down
    const knee = Math.min(1, p / 0.4), tip = clamp((p - 0.35) / 0.65, 0, 1);
    const tipE = tip * tip;
    u.legL.rotation.z = 1.3 * knee * (1 - tipE * 0.8); u.legR.rotation.z = 1.2 * knee * (1 - tipE * 0.8);
    u.body.position.y = -10 * knee * (1 - tipE) + 4 * tipE;
    u.body.rotation.z = -LIE * tipE - settle;
    u.arms.rotation.z = -0.4 * knee + 0.9 * tipE;
  } else {
    // twist and fall onto the side
    const tip = p * p;
    u.body.rotation.y = 0.9 * b.side * Math.min(1, p * 2);
    u.body.rotation.x = LIE * tip * b.side + settle * b.side;
    u.body.position.y = 3 * tip;
    u.legL.rotation.z = 0.5 * p; u.legR.rotation.z = -0.3 * p;
    u.arms.rotation.z = -0.8 * p;
  }
}

// ---------- dynamic objects (trucks, carts, grenades, C4, drops, caches, strikes, bombers)
function pool(name, make) {
  const p = R3.pools[name] || (R3.pools[name] = { items: [], used: 0 });
  return {
    get() { let o = p.items[p.used]; if (!o) { o = make(); p.items.push(o); R3.dyn.add(o); } o.visible = true; p.used++; return o; },
    done() { for (let i = p.used; i < p.items.length; i++) p.items[i].visible = false; p.used = 0; },
  };
}
function meshBox(w, h, d, c, y = 0) { const mm = new THREE.Mesh(UBOX, lam(c)); mm.scale.set(w, h, d); mm.position.y = y; mm.castShadow = mm.receiveShadow = true; return mm; }
function wheel(x, z) { const w = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 5, 10).rotateX(Math.PI / 2), lam('#1b1b1b')); w.position.set(x, 7, z); return w; }
function makeTruck(team) {
  const g = new THREE.Group();
  g.add(meshBox(70, 34, 40, '#556048', 10), meshBox(26, 28, 38, shade(TEAMS[team].dark, 1.1), 10));
  g.children[1].position.x = 50;
  g.add(meshBox(70, 3, 42, '#46503c', 44));
  for (const [x, z] of [[-24, 20], [-24, -20], [40, 20], [40, -20]]) g.add(wheel(x, z));
  return g;
}
function makeCart(team) {
  const g = new THREE.Group();
  g.add(meshBox(56, 18, 40, '#6a5a3a', 8), meshBox(56, 14, 3, '#5a4a2f', 26), meshBox(56, 14, 3, '#5a4a2f', 26));
  g.children[1].position.z = 19; g.children[2].position.z = -19;
  const flag = meshBox(16, 10, 1, TEAMS[team].color, 52); flag.position.x = -20; g.add(flag);
  const pole = meshBox(1.5, 30, 1.5, '#ccc', 30); pole.position.x = -28; g.add(pole);
  for (const [x, z] of [[-18, 21], [-18, -21], [18, 21], [18, -21]]) g.add(wheel(x, z));
  const riders = new THREE.Group(); riders.name = 'riders'; g.add(riders);
  for (let i = 0; i < 8; i++) { const h = new THREE.Mesh(SOLDIER_GEO.helmet, lam(TEAMS[team].helmet)); h.position.set(-18 + (i % 4) * 12, 30, i < 4 ? -9 : 9); riders.add(h); }
  return g;
}

function updateDynamic(dt) {
  const m = G.m, P = G.player;
  for (const t of [0, 1]) {
    const tp = pool('truck' + t, () => makeTruck(t));
    for (const tr of G.trucks) if (tr.team === t && (t === P.team || isVisible(P.team, tr.x, tr.y))) {
      const o = tp.get(); o.position.set(tr.x, elevAt(m, clamp(tr.x, 0, W), tr.y), tr.y); o.rotation.y = tr.dir > 0 ? 0 : Math.PI;
    }
    tp.done();
    const cp = pool('cart' + t, () => makeCart(t));
    for (const c of G.carts) if (c.team === t && (t === P.team || isVisible(P.team, c.x, c.y))) {
      const o = cp.get(); o.position.set(c.x, elevAt(m, c.x, c.y), c.y); o.rotation.y = -c.angle;
      const r = o.getObjectByName('riders'); r.children.forEach((h, i) => { h.visible = i < c.riders.length; });
    }
    cp.done();
  }
  const gp = pool('nade', () => { const s = new THREE.Mesh(new THREE.SphereGeometry(3.5, 8, 6), lam('#3a4a2c')); s.castShadow = true; return s; });
  for (const g of G.grenades) {
    const o = gp.get();
    o.position.set(g.x, elevAt(m, g.x, g.y) + (g.z || 0) + 3.5, g.y);
    o.rotation.set(g.spin || 0, 0, (g.spin || 0) * 0.7);
  }
  gp.done();
  const c4p = pool('c4', () => { const g = new THREE.Group(); g.add(meshBox(14, 6, 10, '#c9b27a')); const l = new THREE.Mesh(new THREE.SphereGeometry(2, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff3b2f' })); l.position.y = 8; l.name = 'led'; g.add(l); return g; });
  for (const c of G.c4s) { const o = c4p.get(); o.position.set(c.x, elevAt(m, c.x, c.y) + 3, c.y); o.getObjectByName('led').visible = Math.sin(G.time * (c.fuse < 2 ? 30 : 12)) > 0; }
  c4p.done();
  const dp = pool('drop', () => {
    const g = new THREE.Group(); g.add(meshBox(28, 24, 28, '#4f6b3a'), meshBox(29, 4, 29, '#e6ad45', 10));
    const chute = new THREE.Mesh(new THREE.SphereGeometry(40, 12, 6, 0, TAU, 0, Math.PI / 2), lam('#d8d0b8', { side: THREE.DoubleSide })); chute.position.y = 90; chute.name = 'chute'; g.add(chute);
    return g;
  });
  for (const d of G.drops) {
    const o = dp.get(), f = Math.max(0, d.fall);
    o.position.set(d.x, elevAt(m, d.x, d.y) + f * 110, d.y); o.rotation.y = d.t * 0.3;
    o.getObjectByName('chute').visible = f > 0;
  }
  dp.done();
  const kp = pool('cache', () => { const g = new THREE.Group(); for (let i = 0; i < 6; i++) { const b = meshBox(22, 20, 22, '#7b6a43'); b.position.set((i % 3) * 24 - 24, i > 2 ? 20 : 0, 0); g.add(b); } return g; });
  // ammo crates left on a captured point: green boxes with a yellow band, one per soldier they can serve
  const ap = pool('ammo', () => {
    const g = new THREE.Group();
    for (let i = 0; i < 2; i++) { const b = new THREE.Group(); b.add(meshBox(30, 16, 18, '#44532f'), meshBox(31, 3, 19, '#e6ad45', 6)); b.position.set(i * 34 - 17, 0, 0); g.add(b); }
    return g;
  });
  for (const c of G.caches) {
    if (c.ammo) {
      const o = ap.get(); o.position.set(c.x, elevAt(m, c.x, c.y), c.y);
      o.children.forEach((b, i) => { b.visible = i < c.charges; });
      continue;
    }
    if (c.depot) continue;
    const o = kp.get(); o.position.set(c.x, elevAt(m, c.x, c.y), c.y);
    o.children.forEach((b, i) => { b.visible = i < Math.min(6, c.charges); });
  }
  kp.done(); ap.done();
  // air strikes: a red zone on the ground and the bomber passing over
  const sp = pool('strike', () => {
    const g = new THREE.Group();
    const zone = new THREE.Mesh(UBOX, new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: 0.16, depthWrite: false }));
    zone.scale.set(CFG.STRIKE_W, 220, CFG.STRIKE_H); zone.name = 'zone'; g.add(zone);
    const lab = labelSprite('10', '#ff3b2f', 52); lab.position.y = 260; lab.name = 'lab'; g.add(lab);
    return g;
  });
  const bp = pool('bomber', () => {
    const g = new THREE.Group(), mm = '#4a4f47';
    g.add(meshBox(120, 14, 16, mm), meshBox(30, 4, 180, mm), meshBox(16, 4, 60, mm));
    g.children[2].position.x = -50; g.children[1].position.x = 10;
    const fin = meshBox(14, 22, 2, mm); fin.position.set(-52, 10, 0); g.add(fin);
    return g;
  });
  for (const st of G.strikes) {
    const o = sp.get(), e = elevAt(m, st.x, st.y), mine = st.team === P.team;
    o.position.set(st.x, e - 20, st.y);
    const z = o.getObjectByName('zone');
    z.material.color.set(mine ? TEAMS[st.team].color : '#ff3b2f');
    z.material.opacity = 0.1 + 0.1 * (0.5 + 0.5 * Math.sin(G.time * (st.t < 3 ? 18 : 7)));
    relabel(o.getObjectByName('lab'), st.t > 0 ? String(Math.ceil(st.t)) : '!', mine ? TEAMS[st.team].color : '#ff3b2f');
    if (st.t <= 0.8) {
      const b = bp.get(), prog = clamp((0.8 - st.t) / 1.6, 0, 1), dir = st.dir || 1;
      b.position.set(st.x - dir * 1400 + dir * 2800 * prog, e + 420, st.y); b.rotation.y = dir > 0 ? 0 : Math.PI;
    }
  }
  sp.done(); bp.done();
  // bridges and capture points
  m.bridges.forEach((br, i) => { const o = R3.bridges[i]; o.g.visible = !br.destroyed; o.stub.visible = br.destroyed; });
  m.points.forEach((pt, i) => {
    const o = R3.points[i], c = pt.owner >= 0 ? TEAMS[pt.owner].color : (pt.prog > 1 ? TEAMS[0].color : pt.prog < -1 ? TEAMS[1].color : '#d8d4c4');
    o.flag.material.color.set(c);
    o.flag.position.y = o.e + 40 + 115 * (pt.owner >= 0 ? 1 : Math.abs(pt.prog) / 100);
    o.flag.rotation.y = Math.sin(G.time * 1.3 + i) * 0.4;
    if (o.ring) o.ring.material.color.set(pt.owner >= 0 ? TEAMS[pt.owner].color : '#e6ad45');
    const contested = pt.c0 > 0 && pt.c1 > 0;
    relabel(o.label, pt.name, contested && Math.sin(G.time * 10) > 0 ? '#ffffff' : pt.owner >= 0 ? TEAMS[pt.owner].color : '#e6ad45');
  });
  // dying soldiers fall, then lie still
  for (const b of R3.bodies) if (b.t < 2.5) animateBody(b, dt); else b.t += dt;
}

// ---------- bullets (tracers) and particles
function buildTracers(world) {
  const N = 400, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, fog: false }));
  l.frustumCulled = false; world.add(l);
  R3.tracers = l; R3.tracerN = N;
}
function updateTracers() {
  const g = R3.tracers.geometry, p = g.attributes.position.array, c = g.attributes.color.array;
  let n = 0;
  for (const b of G.bullets) {
    if (n >= R3.tracerN) break;
    if (b.owner === G.player || b.mine) { if (!b.seen) { b.seen = 1; continue; } }   // your own tracer starts a frame later, away from the camera
    const sp = Math.hypot(b.vx, b.vy, b.vz || 0) || 1, L = b.sniper ? 140 : b.pel ? 50 : 90;
    const z = b.z !== undefined ? b.z : elevAt(G.m, b.x, b.y) + 26;
    p[n * 6] = b.x; p[n * 6 + 1] = z; p[n * 6 + 2] = b.y;
    p[n * 6 + 3] = b.x - b.vx / sp * L; p[n * 6 + 4] = z - (b.vz || 0) / sp * L; p[n * 6 + 5] = b.y - b.vy / sp * L;
    const k = b.sniper ? [1, 1, 0.85] : [1, 0.9, 0.55];
    c[n * 6] = k[0]; c[n * 6 + 1] = k[1]; c[n * 6 + 2] = k[2]; c[n * 6 + 3] = k[0] * 0.55; c[n * 6 + 4] = k[1] * 0.4; c[n * 6 + 5] = k[2] * 0.2;
    n++;
  }
  g.setDrawRange(0, n * 2);
  g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
}
function particleMaterial(additive) {
  return new THREE.ShaderMaterial({
    uniforms: { tex: { value: DOT }, scale: { value: 600 } },
    vertexShader: 'attribute float size; attribute vec4 col; varying vec4 vC; uniform float scale;' +
      'void main(){ vC = col; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(size * scale / -mv.z, 1.0, 400.0); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D tex; varying vec4 vC;' +
      'void main(){ float a = texture2D(tex, gl_PointCoord).a * vC.a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }',
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}
function particleSet(world, additive, N) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(N), 1));
  g.setAttribute('col', new THREE.BufferAttribute(new Float32Array(N * 4), 4));
  const pts = new THREE.Points(g, particleMaterial(additive));
  pts.frustumCulled = false; world.add(pts);
  return { pts, N, n: 0 };
}
function buildParticles(world) { R3.pNorm = particleSet(world, false, 2000); R3.pAdd = particleSet(world, true, 1200); }
function pushP(set, x, y, z, size, r, g, b, a) {
  if (set.n >= set.N) return;
  const at = set.pts.geometry.attributes, i = set.n++;
  at.position.array[i * 3] = x; at.position.array[i * 3 + 1] = z; at.position.array[i * 3 + 2] = y;
  at.size.array[i] = size;
  at.col.array[i * 4] = r; at.col.array[i * 4 + 1] = g; at.col.array[i * 4 + 2] = b; at.col.array[i * 4 + 3] = a;
}
function updateParticles3() {
  const m = G.m, N = R3.pNorm, A = R3.pAdd;
  N.n = 0; A.n = 0;
  for (const p of G.particles) {
    const f = p.life / p.max, e = p.z === undefined ? elevAt(m, clamp(p.x, 0, W - 1), clamp(p.y, 0, H - 1)) : 0;
    switch (p.type) {
      case 'flash':
        if (p.big) { pushP(A, p.x, p.y, p.z ?? e + 27, 75, 1, 0.95, 0.75, f); pushP(A, p.x, p.y, p.z ?? e + 27, 30, 1, 1, 1, f); }
        else pushP(A, p.x, p.y, p.z ?? e + 27, 22, 1, 0.8, 0.4, f);
        break;
      case 'spark': pushP(A, p.x, p.y, p.z ?? e + 20, 4, 1, 0.85, 0.45, f); break;
      case 'fire': pushP(A, p.x, p.y, e + 8 + (1 - f) * 55 + p.size, p.size * 2.4, 1, 0.55 + f * 0.3, 0.15, f * 0.9); break;
      case 'blood': pushP(N, p.x, p.y, p.z ?? e + 22 - (1 - f) * 14, p.size * 3, 0.5, 0.03, 0.03, f * 0.9); break;
      case 'dust': pushP(N, p.x, p.y, (p.z ?? e + 8) + (1 - f) * 10, p.size * 3, 0.55, 0.5, 0.42, f * 0.55); break;
      case 'smoke': {
        const age = p.max - p.life;
        const c = p.ambient ? 0.32 : 0.42;
        pushP(N, p.x, p.y, e + 20 + age * (p.ambient ? 45 : 28), p.size * 2.6, c, c, c * 0.95, f * (p.ambient ? 0.35 : 0.5));
        break;
      }
    }
  }
  // glowing tracer heads with a fading trail, so bullets read clearly at any distance
  const P = G.player;
  for (const b of G.bullets) {
    if ((b.owner === P || b.mine) && (b.gs = (b.gs || 0) + 1) < 3) continue;   // not right in front of your own eyes
    const z = b.z !== undefined ? b.z : elevAt(m, b.x, b.y) + 26, sp = Math.hypot(b.vx, b.vy, b.vz || 0) || 1;
    const big = b.sniper ? 1.5 : b.pel ? 0.6 : 1, ux = b.vx / sp, uy = b.vy / sp, uz = (b.vz || 0) / sp;
    pushP(A, b.x, b.y, z, 10 * big, 1, 0.75, 0.35, 0.55);
    pushP(A, b.x, b.y, z, 4 * big, 1, 1, 0.9, 1);
    for (let i = 1; i <= 3; i++) pushP(A, b.x - ux * i * 18 * big, b.y - uy * i * 18 * big, z - uz * i * 18 * big, (8 - i * 1.6) * big, 1, 0.6, 0.25, 0.35 - i * 0.08);
  }
  for (const S of [N, A]) {
    const at = S.pts.geometry.attributes;
    S.pts.geometry.setDrawRange(0, S.n);
    at.position.needsUpdate = at.size.needsUpdate = at.col.needsUpdate = true;
    S.pts.material.uniforms.scale.value = (window.innerHeight / 2) / Math.tan(cam3.fov * Math.PI / 360);
  }
}

// ---------- weather around the camera
function buildWeather(world, biome) {
  const kind = BIOMES[biome].weather, N = kind === 'fog' ? 260 : kind === 'leaves' ? 350 : 800;
  const g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = rand(-700, 700); pos[i * 3 + 1] = rand(-50, 450); pos[i * 3 + 2] = rand(-700, 700); seed[i] = Math.random(); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const look = {
    snow: ['#ffffff', 4, 0.9], leaves: ['#b2852f', 4, 0.9], sand: ['#e0c48a', 2.5, 0.6], ash: ['#c8c3b9', 2.5, 0.7], fog: ['#dfe8d8', 90, 0.07],
  }[kind] || ['#ffffff', 3, 0.5];
  const mtl = new THREE.ShaderMaterial({
    uniforms: { tex: { value: DOT }, color: { value: col3(look[0]) }, size: { value: look[1] }, opacity: { value: look[2] }, maxPx: { value: kind === 'fog' ? 260 : 5 } },
    vertexShader: 'uniform float size; uniform float maxPx; varying float vA;' +
      'void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float px = size * 380.0 / -mv.z; gl_PointSize = clamp(px, 1.0, maxPx); vA = clamp(-mv.z / 60.0, 0.0, 1.0); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D tex; uniform vec3 color; uniform float opacity; varying float vA;' +
      'void main(){ float a = texture2D(tex, gl_PointCoord).a * opacity * vA; if (a < 0.01) discard; gl_FragColor = vec4(color, a); }',
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, mtl); pts.frustumCulled = false;
  world.add(pts);
  R3.weather = { pts, kind, seed, N };
}
function updateWeather(dt, cx, cz) {
  const w = R3.weather; if (!w) return;
  const p = w.pts.geometry.attributes.position.array, t = G.time;
  for (let i = 0; i < w.N; i++) {
    const s = w.seed[i]; let vx = 0, vy = 0, vz = 0;
    if (w.kind === 'snow') { vx = 18 + Math.sin(t + s * 9) * 14; vy = -40 - s * 25; vz = Math.cos(t * 0.7 + s * 7) * 10; }
    else if (w.kind === 'leaves') { vx = 30 + Math.sin(t * 2 + s * 9) * 25; vy = -22 - s * 15; vz = Math.cos(t + s * 5) * 20; }
    else if (w.kind === 'sand') { vx = 260 + s * 120; vy = -8 + Math.sin(t * 3 + s * 9) * 10; vz = 40; }
    else if (w.kind === 'ash') { vx = 25; vy = -10 + s * 18; vz = Math.sin(t + s * 4) * 10; }
    else { vx = 8; vz = 4; }
    p[i * 3] += vx * dt; p[i * 3 + 1] += vy * dt; p[i * 3 + 2] += vz * dt;
    if (p[i * 3] > 700) p[i * 3] -= 1400; if (p[i * 3] < -700) p[i * 3] += 1400;
    if (p[i * 3 + 2] > 700) p[i * 3 + 2] -= 1400; if (p[i * 3 + 2] < -700) p[i * 3 + 2] += 1400;
    if (p[i * 3 + 1] < -50) p[i * 3 + 1] += 500; if (p[i * 3 + 1] > 450) p[i * 3 + 1] -= 500;
  }
  w.pts.geometry.attributes.position.needsUpdate = true;
  // the box follows the camera in 1400 px steps' worth of wrap-around
  w.pts.position.set(cx, (R3.camElev || 0), cz);
}

// ---------- first-person weapon (view model): see viewmodel.js

// ---------- props (vehicles, containers, camp gear...): built from the shared instanced boxes and cylinders, so a
// hundred of them cost a handful of draw calls. Long axis = the rect's long side; local +x is the front.
function buildProp(o, k, cx, cy, gz, sd, sid, B3, biome) {
  const { box, cyl, cone, vehicle, rubber } = B3, rng = mulberry32((sd * 1e9) >>> 0);
  const isR = o.t === 'r', L = isR ? Math.max(o.w, o.h) : o.r * 2, S = isR ? Math.min(o.w, o.h) : o.r * 2;
  const ry = isR ? (o.w >= o.h ? 0 : Math.PI / 2) + (rng() < 0.5 ? 0 : Math.PI) : rng() * 6.28;
  const ca = Math.cos(ry), sa = Math.sin(ry);
  const at = (lx, lz) => [cx + lx * ca + lz * sa, cy - lx * sa + lz * ca];
  const B = (lx, lz, y, sx, sy, sz, c, rx = 0, rz = 0) => { const [x, z] = at(lx, lz); box.add(mat(x, gz + y, z, sx, sy, sz, ry, rx, rz), c, sid); };
  const PB = (lx, lz, y, sx, sy, sz, c, rx = 0, rz = 0) => { const [x, z] = at(lx, lz); vehicle.add(mat(x, gz + y, z, sx, sy, sz, ry, rx, rz), shade(c, 1.24), sid); };
  const C = (lx, lz, y, r, h, c) => { const [x, z] = at(lx, lz); cyl.add(mat(x, gz + y, z, r, h, r, ry), c, sid); };
  const wheel = (lx, lz, r, w) => { const [x, z] = at(lx, lz - w / 2); (rubber || cyl).add(mat(x, gz + r - 2, z, r, w, r, ry, Math.PI / 2), rubber ? '#ffffff' : '#1c1c1a', sid); };
  const olive = biome === 'desert' ? '#9a8256' : biome === 'snow' ? '#d9ddd8' : '#4f5638';
  switch (k) {
    case 'truck': {
      const c = shade(olive, 0.85 + sd * 0.3);
      B(0, 0, 4, L, 6, S * 0.86, '#2a2a26');
      PB(L * 0.33, 0, 9, L * 0.28, 27, S * 0.92, c);
      B(L * 0.475, 0, 22, 1.5, 9, S * 0.78, '#26303a');
      B(L * 0.47, 0, 9, 3, 10, S * 0.9, shade(c, 0.6));
      PB(-L * 0.15, 0, 10, L * 0.62, 6, S, shade(c, 0.8));
      PB(-L * 0.15, 0, 16, L * 0.6, 22, S * 0.96, biome === 'snow' ? '#c9c7b8' : '#6b6a4a');
      for (const lx of [L * 0.3, -L * 0.08, -L * 0.3]) for (const s of [-1, 1]) wheel(lx, s * S * 0.44, 9, 7);
      break;
    }
    case 'tank': {
      const c = shade(olive, 0.8 + sd * 0.3);
      for (const s of [-1, 1]) B(0, s * S * 0.38, -2, L * 1.02, 15, S * 0.25, '#262622');
      PB(0, 0, 6, L * 0.96, 15, S * 0.74, c);
      PB(-L * 0.06, 0, 21, L * 0.44, 12, S * 0.58, shade(c, 1.08));
      B(-L * 0.12, 0, 33, 10, 4, 10, shade(c, 0.8));
      const [bx, bz] = at(L * 0.16, 0); cyl.add(mat(bx, gz + 27, bz, 2.6, L * 0.62, 2.6, ry, 0, -Math.PI / 2 + (rng() - 0.5) * 0.25), shade(c, 0.7), sid);
      break;
    }
    case 'container': {
      const c = shade(['#8a3b2c', '#2f5d7c', '#4f6b3a', '#a0742e', '#6d6f72'][Math.floor(rng() * 5)], 0.85 + sd * 0.25);
      B(0, 0, -4, L, 64, S, c);
      for (let x = -L / 2 + 8; x < L / 2 - 4; x += 11) B(x, 0, -2, 2.2, 60, S + 1.6, shade(c, 0.78));
      B(L / 2, 0, -2, 1.6, 60, S * 0.98, shade(c, 0.6));
      break;
    }
    case 'tent': {
      const c = biome === 'snow' ? '#cfcab4' : biome === 'desert' ? '#b9a37a' : '#6f6a4c', rise = 38, run = S / 2, len = Math.hypot(rise, run), th = Math.atan2(rise, run);
      B(0, 0, -1, L, 3, S, shade(c, 0.6));
      for (const s of [-1, 1]) B(0, s * run / 2, rise / 2 - 1, L, 2, len, shade(c, s < 0 ? 0.95 : 1.1), s * th, 0);
      B(L / 2 - 1, 0, 0, 1.5, rise * 0.8, S * 0.3, shade(c, 0.45));
      break;
    }
    case 'barrel': {
      const c = ['#5a6b3a', '#8a2f25', '#2f4a6b', '#7a6a3a'][Math.floor(rng() * 4)];
      C(0, 0, -2, o.r, 30, shade(c, 0.85 + sd * 0.3));
      for (const y of [7, 18]) C(0, 0, y, o.r + 0.6, 1.6, shade(c, 0.6));
      break;
    }
    case 'hay': {
      const [x, z] = at(0, -13); cyl.add(mat(x, gz + o.r - 2, z, o.r, 26, o.r, ry, Math.PI / 2), shade('#c9a75a', 0.85 + sd * 0.3), sid);
      break;
    }
    case 'fence': {
      const c = shade(biome === 'snow' ? '#5b4636' : '#6b5135', 0.85 + sd * 0.3);
      for (let x = -L / 2 + 2; x <= L / 2; x += 30) B(x, 0, -4, 4, 32, 4, shade(c, 0.85));
      for (const y of [9, 20]) B(0, 0, y, L, 3.5, 2.5, c);
      break;
    }
    case 'well': {
      C(0, 0, -4, o.r, 28, shade('#8d8778', 0.85 + sd * 0.3));
      C(0, 0, 0, o.r * 0.72, 24.5, '#141413');
      for (const s of [-1, 1]) B(0, s * o.r * 0.8, 20, 3, 34, 3, '#5b4430');
      B(0, 0, 52, 4, 3, o.r * 1.9, '#5b4430');
      B(0, 0, 55, o.r * 1.4, 2, o.r * 2.2, '#7a5c3a', 0.35);
      break;
    }
    case 'bus': {
      const c = shade(rng() < 0.5 ? '#c8a43a' : '#7b5a3a', 0.8 + sd * 0.3);
      PB(0, 0, 6, L, 42, S, c);
      B(0, 0, 28, L * 0.92, 11, S + 1, '#23292d');
      B(L / 2, 0, 18, 1.5, 20, S * 0.85, '#23292d');
      PB(0, 0, 48, L * 0.98, 2, S * 0.96, shade(c, 0.75));
      for (const lx of [L * 0.32, -L * 0.3]) for (const s of [-1, 1]) wheel(lx, s * S * 0.44, 10, 7);
      break;
    }
    case 'dumpster': {
      const c = shade('#2f5a3a', 0.8 + sd * 0.3);
      B(0, 0, -2, L, 30, S, c);
      B(0, -S * 0.03, 28, L * 1.02, 2.5, S * 1.04, shade(c, 0.7), 0.12);
      break;
    }
    case 'boat': {
      const c = shade('#6b4a2e', 0.85 + sd * 0.3);
      B(0, 0, -3, L * 0.9, 13, S, c);
      B(L * 0.47, 0, -3, L * 0.12, 11, S * 0.55, c);
      B(0, 0, 9, L * 0.78, 1.5, S * 0.7, shade(c, 0.55));
      B(-L * 0.05, 0, 7, 4, 3, S * 0.9, shade(c, 0.8));
      break;
    }
    case 'pole': {
      C(0, 0, -6, 3.5, 196, '#5b4430');
      B(0, 0, 176, 4, 4, 46, '#4a3828');
      for (const s of [-1, 0, 1]) B(0, s * 18, 180, 2.5, 4, 2.5, '#d7d2c4');
      break;
    }
    case 'bunker': {
      const c = shade('#8a877c', 0.85 + sd * 0.25);
      B(0, 0, -4, L, 40, S, c);
      B(L / 2, 0, 20, 1.5, 6, S * 0.7, '#141413');
      B(0, 0, 36, L * 1.06, 4, S * 1.06, shade(c, 0.85));
      break;
    }
  }
}

// ---------- per-frame
// No fog of war in the 3D view: every soldier is drawn and only walls, terrain and distance haze hide them.
// (The minimap and the M map still show only enemies your team has spotted.)
function soldierShown(s, P) { return s.alive && s.x > -9000; }
// Where the camera is: your eyes, or a chase view of a teammate / your cart while you wait to respawn.
function cameraView(P) {
  const kc = kcCamera(); if (kc) return kc;   // kill cam replay (killcam.js)
  const m = G.m;
  // your own death: the view drops to the ground and rolls over before the spectator camera takes over
  if (!P.alive && R3.wasAlive && R3.lastCam && R3.lastCam.fp) R3.death = { x: R3.lastCam.x, y: R3.lastCam.y, z: R3.lastCam.z, yaw: R3.lastCam.yaw, pitch: R3.lastCam.pitch, t: 0, side: Math.random() < 0.5 ? 1 : -1 };
  R3.wasAlive = P.alive;
  if (!P.alive && R3.death && !P.riding) {
    const d = R3.death, t = d.t;
    if (t < 2.2) {
      const p = Math.min(1, t / 0.7), e = p * p, z = lerp(d.z, d.z - CFG.EYE + 8, e);
      return { fp: true, dead: true, x: d.x, y: d.y, z, yaw: d.yaw + d.side * 0.25 * e, pitch: lerp(d.pitch, 0.35, e), roll: d.side * 1.25 * e };
    }
  } else if (P.alive) R3.death = null;
  if (P.alive) {
    const auto = G.auto;
    const yaw = auto ? P.angle : R3.look.yaw, pitch = auto ? P.pitch : R3.look.pitch;
    if (FEEL.on && !auto) {
      const f = feelCamera(P, R3.dt || 1 / 60), fz = P.rfz ?? feetZ(P);
      return { fp: true, x: (P.rx ?? P.x) + f.dx, y: (P.ry ?? P.y) + f.dy, z: fz + (P.crouch ? CFG.CROUCH_EYE : CFG.EYE) + f.dz, yaw: yaw + f.yaw, pitch: pitch + f.pitch, roll: f.roll, fovAdd: f.fov };
    }
    const moving = Math.hypot(P.vx, P.vy) > 20;
    const bob = moving ? Math.sin(P.walkPhase * 1.0) * 1.2 : 0;
    return { fp: true, x: P.x, y: P.y, z: eyeZ(P) + bob, yaw, pitch };
  }
  let tgt = P.riding || spectateTarget();
  // spectating in first person (V): through the teammate's eyes, with their gun
  if (R3.specFP && tgt && !tgt.isCart && !P.riding) {
    const fz = tgt.rfz ?? feetZ(tgt), yaw = tgt.ra ?? tgt.angle;
    R3.specPitch = lerp(R3.specPitch ?? 0, clamp(tgt.pitch || 0, -1.4, 1.4), 0.3);
    return { fp: true, who: tgt, x: tgt.rx ?? tgt.x, y: tgt.ry ?? tgt.y, z: fz + (tgt.crouch ? CFG.CROUCH_EYE : CFG.EYE), yaw, pitch: R3.specPitch };
  }
  if (!tgt) return { fp: false, x: R3.lastCam ? R3.lastCam.x : W / 2, y: R3.lastCam ? R3.lastCam.y : H / 2, z: (R3.lastCam ? R3.lastCam.z : 200) + 0, yaw: R3.lastCam ? R3.lastCam.yaw : 0, pitch: -0.5 };
  const a = tgt.angle || 0, back = tgt.isCart ? 170 : 110, up = tgt.isCart ? 110 : 70;
  const fz = tgt.isCart ? elevAt(m, tgt.x, tgt.y) : feetZ(tgt);
  const tz = fz + 34;
  // pull the camera in when a wall or tree is in the way
  let k = 1;
  for (let f = 0.15; f <= 1.0001; f += 0.05) {
    const x = tgt.x - Math.cos(a) * back * f, y = tgt.y - Math.sin(a) * back * f, z = tz + (up - 34) * f;
    if (x < 10 || y < 10 || x > W - 10 || y > H - 10 || blockedAt(m, x, y, z) || slabBetween(m, x, y, tz, z)) { k = Math.max(0.1, f - 0.1); break; }
  }
  const cx = tgt.x - Math.cos(a) * back * k, cy = tgt.y - Math.sin(a) * back * k;
  const cz = Math.max(tz + (up - 34) * k, elevAt(m, cx, cy) + 20);
  const d = Math.hypot(tgt.x - cx, tgt.y - cy);
  const v = { fp: false, x: cx, y: cy, z: cz, yaw: Math.atan2(tgt.y - cy, tgt.x - cx), pitch: Math.atan2(tz - cz, d) };
  if (R3.lastCam && !R3.lastCam.fp) {   // smooth the chase camera
    const k = 0.15; v.x = lerp(R3.lastCam.x, v.x, k); v.y = lerp(R3.lastCam.y, v.y, k); v.z = lerp(R3.lastCam.z, v.z, k);
    v.yaw = R3.lastCam.yaw + angDiff(R3.lastCam.yaw, v.yaw) * k; v.pitch = lerp(R3.lastCam.pitch, v.pitch, k);
  }
  return v;
}

function render3d(dt) {
  if (!R3.ok || !G) return;
  const m = G.m, P = G.player;
  if (R3.map !== m) { r3Build(m, G.art); R3.look.yaw = P.angle; R3.look.pitch = 0; }
  // camera
  if (R3.death) R3.death.t += Math.min(dt, 0.05);
  R3.dt = dt;
  feelResolution(dt);
  const v = cameraView(P);
  R3.lastCam = v;
  // hide your own body while the death camera lies where it fell
  for (const b of R3.bodies) b.g.visible = !b.kcHide && !(v.dead && Math.hypot(b.x - v.x, b.y - v.y) < 40);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sh = reduce ? 0 : G.cam.shake * 0.4;
  R3.kick = Math.max(0, R3.kick - dt * 6);
  cam3.position.set(v.x + rand(-sh, sh), v.z + rand(-sh, sh) * 0.5, v.y + rand(-sh, sh));
  cam3.rotation.set(v.pitch + (FEEL.on ? 0 : R3.kick * 0.04), -v.yaw - Math.PI / 2, 0);
  if (v.roll) cam3.rotateZ(v.roll);
  G.cam.x = v.x; G.cam.y = v.y;
  SFX.listener.x = v.x; SFX.listener.y = v.y;
  R3.camElev = v.z;
  // scope zoom
  const VW_ = v.who || P;   // whose eyes: yours, or the kill cam / first-person spectating target
  R3.vScoped = !!(v.fp && !v.dead && VW_.scoped);
  const adsZ = VW_ === P ? (P.cls.scopeRange ? 0 : P.aimP || 0) : VW_.ads ? 1 : 0;   // the zoom grows as the sights come up
  const zoomT = v.dead ? 1 : v.fp && VW_.scoped ? CFG.SCOPE_ZOOM : v.fp ? 1 + (CFG.ADS_ZOOM - 1) * adsZ : 1;
  R3.zoom = lerp(R3.zoom, zoomT, 1 - Math.exp(-dt * 14));
  if (Math.abs(R3.zoom - zoomT) < 0.02) R3.zoom = zoomT;
  const fov = 2 * Math.atan(Math.tan((CFG.FOV + (v.fovAdd || 0)) * Math.PI / 360) / R3.zoom) * 180 / Math.PI;
  if (Math.abs(cam3.fov - fov) > 0.01) { cam3.fov = fov; cam3.updateProjectionMatrix(); }
  R3.fov = fov;
  const fb = R3.fogBase, fz = R3.zoom > 1.5 ? 1.6 : 1;
  scene3.fog.near = fb[0] * fz; scene3.fog.far = fb[1] * fz;
  // sun and its shadow box follow the camera
  const sx = Math.round(v.x / 50) * 50, sy = Math.round(v.y / 50) * 50, se = elevAt(m, clamp(sx, 0, W - 1), clamp(sy, 0, H - 1));
  R3.sun.position.set(sx - 700, se + 1400, sy - 500); R3.sun.target.position.set(sx, se, sy);

  // soldiers
  const seenIds = new Set();
  for (const s of G.soldiers) {
    const show = soldierShown(s, P) && !(s === (v.who || P) && v.fp);
    if (!show) { const o = R3.soldiers.get(s.id); if (o) o.g.visible = false; continue; }
    const o = soldierObj(s), u = o.g.userData;
    o.g.visible = true; seenIds.add(s.id);
    if (FEEL.on) animateSoldier(s, o, u, dt);
    else {
    o.g.position.set(s.x, feetZ(s), s.y);
    o.g.rotation.y = -s.angle;
    const moving = Math.hypot(s.vx || 0, s.vy || 0) > 15 || (o.lx !== undefined && Math.hypot(s.x - o.lx, s.y - o.ly) > 0.6);
    o.lx = s.x; o.ly = s.y;
    const sw = moving && !(s.para > 0) ? Math.sin(s.walkPhase) * 0.6 : 0;
    u.body.rotation.set(0, 0, 0); u.legL.rotation.x = u.legR.rotation.x = 0; u.legL.userData.shin.rotation.z = u.legR.userData.shin.rotation.z = 0;
    if (s.crouch) { u.body.position.y = -10; u.legL.rotation.z = 1.35; u.legR.rotation.z = -0.25; }   // kneeling
    else if ((s.jz || 0) > 2 && !(s.para > 0)) { u.body.position.y = 0; u.legL.rotation.z = 0.9; u.legR.rotation.z = 0.3; }   // jumping / vaulting: legs tucked
    else { u.body.position.y = 0; u.legL.rotation.z = sw; u.legR.rotation.z = -sw; }
    }
    u.chute.visible = s.para > 0;
    // arms: reload lowers them smoothly, each shot kicks them back, a hit makes the soldier flinch, a throw swings over
    o.reT = lerp(o.reT || 0, s.reloading ? 1 : 0, 1 - Math.exp(-dt * 8));
    const kt = G.time - (s.lastShotT ?? -9), kick = kt >= 0 && kt < 0.16 ? 1 - kt / 0.16 : 0, heavy = s.cls && (s.cls.key === 'sniper' || s.cls.pellets) ? 2.2 : 1;
    if (o.lhp !== undefined && s.alive && s.hp < o.lhp - 0.5) o.flT = 0.3;
    o.lhp = s.hp; o.flT = Math.max(0, (o.flT || 0) - dt);
    if (o.lnades !== undefined && (s.nades || 0) < o.lnades && s.alive) o.thT = 0.55;
    o.lnades = s.nades || 0; o.thT = Math.max(0, (o.thT || 0) - dt);
    if (o.armX0 === undefined) o.armX0 = u.arms.position.x;
    const fl = Math.sin(o.flT / 0.3 * Math.PI), th = o.thT > 0 ? Math.sin((1 - o.thT / 0.55) * Math.PI) : 0;
    const lowReady = (o.rT || 0) * (1 - (o.adsT || 0));   // sprinting: muzzle down, rifle across the body
    u.arms.rotation.z = (s.pitch || 0) - 0.6 * o.reT + kick * 0.1 * heavy + th * 1.6 - 0.45 * lowReady;
    u.arms.rotation.x = (FEEL.on ? u.arms.rotation.x : 0) - 0.25 * lowReady;
    o.adsT = lerp(o.adsT || 0, s.ads || s.scoped ? 1 : 0, 1 - Math.exp(-dt * 10));
    if (o.armY0 === undefined) o.armY0 = u.arms.position.y;
    u.arms.position.x = o.armX0 - kick * 1.2 * heavy - o.adsT * 1.5; u.arms.position.y = o.armY0 + o.adsT * 3.5;
    u.body.rotation.z += fl * 0.22; u.body.rotation.x += fl * 0.08;
    // teammates: a marker above the head (seen through walls) with their name when close
    if (s.team === P.team && s !== P) {
      if (!o.mark) { o.mark = markerSprite(TEAMS[s.team].color); scene3.add(o.mark); }
      o.mark.visible = dist(s.x, s.y, v.x, v.y) < 1100; o.mark.position.set(s.rx ?? s.x, (s.rfz ?? feetZ(s)) + 50, s.ry ?? s.y);
    } else if (o.mark) o.mark.visible = false;
  }
  for (const [id, o] of R3.soldiers) if (!seenIds.has(id)) { o.g.visible = false; if (o.mark) o.mark.visible = false; }

  updateDynamic(dt);
  updateTracers();
  updateParticles3();
  updateWeather(dt, v.x, v.y);

  gl3.autoClear = true;
  if (typeof postRender !== 'function' || !postRender(dt)) gl3.render(scene3, cam3);

  // someone else's weapon: the kill cam or first-person spectating (a simple hip pose, kick and flash on their shots)
  if (v.fp && v.who && (v.who !== P || KC.on) && v.who.cls && !(v.who.scoped && R3.zoom > 1.5)) {
    const w = v.who;
    R3.wAdsT = lerp(R3.wAdsT || 0, w.ads ? 1 : 0, 1 - Math.exp(-dt * 14)); const ad = R3.wAdsT;
    if (!R3.vm || R3.vmCls !== w.cls.key || R3.vmTeam !== w.team) buildViewModel(w.cls.key, w.team);
    const vm = R3.vm, st = G.time - (w.lastShotT ?? -9), kick = st >= 0 && st < 0.15 ? 1 - st / 0.15 : 0, rl = w.reloading ? 1 : 0;
    const ph = w.rwp ?? w.walkPhase ?? 0, mv = Math.min(1, Math.hypot(w.vx || 0, w.vy || 0) / CFG.WALK);
    if (R3.vmCls !== w.cls.key) R3.wAdsT = 0;
    vm.position.set(lerp(0.12 + Math.sin(ph) * 0.012 * mv, 0, ad), lerp(-0.11 - Math.abs(Math.cos(ph)) * 0.01 * mv, -(R3.vmSpec?.sight ?? 0.207) * 0.3, ad) - rl * 0.08, lerp(-0.2, -0.15, ad) + kick * 0.025);
    vm.rotation.set(kick * 0.07 * (1 - ad * 0.6) + rl * 0.45, 0.04 * (1 - ad), rl * 0.5);
    const fl = vm.getObjectByName('flash'); fl.visible = st >= 0 && st < 0.05; fl.material.rotation = Math.random() * TAU;
    gl3.autoClear = false; gl3.clearDepth(); gl3.render(vmScene, vmCam); gl3.autoClear = true;
    R3.lastMag = -1;
  }
  // own weapon
  else if (v.fp && !v.dead && !v.who && !G.auto && !(P.scoped && R3.zoom > 1.5)) {
    if (!R3.vm || R3.vmCls !== P.cls.key || R3.vmTeam !== P.team) { buildViewModel(P.cls.key); R3.lastMag = P.mag; }
    const vm = R3.vm;
    if (P.mag < R3.lastMag && !P.reloading) { R3.kick = Math.min(1.2, R3.kick + (P.cls.key === 'sniper' ? 1.2 : P.cls.key === 'shotgun' ? 1.0 : 0.45)); R3.lastShotT = G.time; feelShot(P); }
    R3.lastMag = P.mag;
    const moving = Math.hypot(P.vx, P.vy) > 20, sprint = moving && Math.hypot(P.vx, P.vy) > CFG.WALK * 1.15;
    const bx = moving ? Math.sin(P.walkPhase * 0.5) * 0.025 : 0, by = moving ? Math.abs(Math.cos(P.walkPhase * 0.5)) * 0.02 : Math.sin(performance.now() / 900) * 0.004;
    const rl = P.reloading ? Math.sin(clamp(1 - P.reloadT / P.reloadMax, 0, 1) * Math.PI) : 0;
    const ap = P.aimP || 0, apE = ap * ap * (3 - 2 * ap);   // the gun rises to the eye over the aim delay
    R3.adsT = lerp(R3.adsT || 0, apE, 1 - Math.exp(-dt * 20));
    const ad = R3.adsT;
    if (!feelWeapon(P, dt, vm, { ads: ad, sprint, reload: rl })) {
        vm.position.set(lerp(0.12 + bx + (sprint ? 0.03 : 0), 0, ad), lerp(-0.11 - by + (sprint ? -0.02 : 0), -(R3.vmSpec?.sight ?? 0.207) * 0.3, ad) - rl * 0.1, lerp(-0.2, -0.17, ad) + R3.kick * 0.03 * (1 - ad * 0.5));
    vm.rotation.set(R3.kick * 0.08 * (1 - ad * 0.6) + rl * 0.5 + (sprint ? -0.35 : 0), (sprint ? 0.5 : 0.04) * (1 - ad), rl * 0.6);
    }
    const fl = vm.getObjectByName('flash');
    fl.visible = G.time - R3.lastShotT < 0.05; fl.material.rotation = Math.random() * TAU;
    animateViewModel();
    gl3.autoClear = false;
    gl3.clearDepth();
    gl3.render(vmScene, vmCam);
    gl3.autoClear = true;
  } else R3.lastMag = P.mag;
}
