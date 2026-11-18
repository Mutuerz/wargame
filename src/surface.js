'use strict';
// Surface detail (preview). Every lit surface of the world gets fine detail from a tiling noise texture,
// projected from three sides in world space (so stretched boxes, rocks and the terrain all get it at the
// same real-world scale with no UV seams), used two ways:
//   colour: a little darker and lighter grain, plus a large-scale variation that breaks up repeats;
//   relief: the same noise as a height bump, so light catches tiny ridges (derivative bump mapping).
// The detail noise is generated here at load time; the terrain also blends in a per-theatre color map from
// assets/textures/ (see that folder's README).

const SURF = { tex: null, on: true, ground: {} };

const GROUND_TEXTURES = { forest: 'grass', desert: 'sand', urban: 'sand', snow: 'snow', swamp: 'swamp' };
function groundAlbedo(biome) {
  const name = GROUND_TEXTURES[biome];
  if (!name) return null;
  if (!SURF.ground[name]) SURF.ground[name] = assetTexture(name);
  return SURF.ground[name];
}

function surfNoiseTexture(size = 256) {
  // periodic value-noise fBm, so the texture tiles seamlessly
  const N = size, out = new Float32Array(N * N);
  const oct = [[8, 0.5], [16, 0.25], [32, 0.15], [64, 0.1]];
  for (const [f, a] of oct) {
    const g = new Float32Array(f * f); for (let i = 0; i < g.length; i++) g[i] = Math.random();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * f, fy = y / N * f, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const v = (i, j) => g[((j % f + f) % f) * f + ((i % f + f) % f)];
      out[y * N + x] += a * lerp(lerp(v(x0, y0), v(x0 + 1, y0), sx), lerp(v(x0, y0 + 1), v(x0 + 1, y0 + 1), sx), sy);
    }
  }
  const c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
  let mn = 1e9, mx = -1e9; for (const v of out) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  for (let i = 0; i < N * N; i++) { const v = (out[i] - mn) / (mx - mn) * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
  return t;
}

// opts: strength (colour grain), bump (relief), scale (world px per tile)
function addSurfaceDetail(mat, opts = {}) {
  if (!SURF.on || !mat || mat.userData.surf || !(mat.isMeshLambertMaterial || mat.isMeshStandardMaterial) || mat.transparent) return;
  if (!SURF.tex) SURF.tex = surfNoiseTexture();
  mat.userData.surf = true;
  const u = {
    surfTex: { value: SURF.tex },
    surfAlbedoTex: { value: opts.albedo || SURF.tex },
    surfAlbedoAvg: { value: opts.albedo && opts.albedo.userData.avg || new THREE.Vector3(1, 1, 1) },
    surfK: { value: new THREE.Vector4(opts.strength ?? 0.32, opts.bump ?? 0.9, 1 / (opts.scale ?? 70), opts.albedoStrength ?? 0) },
  };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfW; varying vec3 vSurfN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 sw = vec4(transformed, 1.0); vec3 sn = objectNormal;
          #ifdef USE_INSTANCING
            sw = instanceMatrix * sw; sn = mat3(instanceMatrix) * sn;
          #endif
          sw = modelMatrix * sw; vSurfW = sw.xyz; vSurfN = normalize(mat3(modelMatrix) * sn); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D surfTex; uniform sampler2D surfAlbedoTex; uniform vec3 surfAlbedoAvg; uniform vec4 surfK; varying vec3 vSurfW; varying vec3 vSurfN;
        float surfH(vec3 p, vec3 n) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-4);
          vec3 q = p * surfK.z;
          return texture2D(surfTex, q.zy).r * w.x + texture2D(surfTex, q.xz).r * w.y + texture2D(surfTex, q.xy).r * w.z;
        }
        vec3 surfAlbedo(vec3 p, vec3 n) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-4);
          vec3 q = p * surfK.z;
          return texture2D(surfAlbedoTex, q.zy).rgb * w.x + texture2D(surfAlbedoTex, q.xz).rgb * w.y + texture2D(surfAlbedoTex, q.xy).rgb * w.z;
        }
        float surfBig(vec3 p) { return texture2D(surfTex, p.xz * 0.0011).r; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float sH = surfH(vSurfW, vSurfN);
        diffuseColor.rgb *= 1.0 + (sH - 0.5) * 2.0 * surfK.x;
        diffuseColor.rgb *= 0.9 + 0.2 * surfBig(vSurfW);
        // the theatre's ground photo as detail around the painted map's colour (divided by its own average), so
        // roads, mud and sector colours keep their hue and brightness and only gain the photo's texture
        diffuseColor.rgb *= mix(vec3(1.0), clamp(surfAlbedo(vSurfW, vSurfN) / max(surfAlbedoAvg, vec3(0.02)), 0.0, 2.5), surfK.w);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { // derivative bump from the same detail height
          vec2 dH = vec2(dFdx(sH), dFdy(sH)) * surfK.y * 4.0;
          vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition);
          vec3 R1 = cross(sY, normal), R2 = cross(normal, sX);
          float det = dot(sX, R1);
          vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
          normal = normalize(abs(det) * normal - grad);
        }`);
  };
  mat.customProgramCacheKey = () => 'surf';
  mat.needsUpdate = true;
}

// After the world is built: give its solid surfaces detail. The terrain gets a finer, stronger grain.
function surfaceWorld(world, terrain, biome) {
  if (!SURF.on) return;
  world.traverse(o => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    if (o === terrain) addSurfaceDetail(o.material, { strength: 0.42, bump: 1.4, scale: 62, albedo: groundAlbedo(biome), albedoStrength: 0.55 });
    else addSurfaceDetail(o.material, { strength: 0.26, bump: 0.55, scale: 60 });
  });
}
