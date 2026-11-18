'use strict';
// Post-processing (preview): the image goes through a chain like a modern game's instead of straight to screen.
//   ambient occlusion (GTAO: contact shadows in corners, under cover, where walls meet the ground)
//   -> bloom (muzzle flashes, tracers, fire and explosions glow)
//   -> filmic tone mapping (ACES) and sRGB output
//   -> grade (gentle contrast, saturation, warm highlights / cool shadows, vignette)
// Anti-aliasing comes from a multisampled render target. Quality: High (all), Medium (no AO), Off (plain).
// F8 cycles it; it also steps down by itself when frames run long (see feel.js adaptive resolution).

const POST = { ok: false, q: params.get('gfx') || 'high', composer: null, w: 0, h: 0, pr: 0, slowT: 0 };

const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, vig: { value: 0.32 }, sat: { value: 1.1 }, con: { value: 1.06 }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vig, sat, con, time; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat);                                   // saturation
      c = (c - 0.5) * con + 0.5;                                  // contrast around mid grey
      c += vec3(0.018, 0.008, -0.012) * smoothstep(0.45, 1.0, l); // warm highlights
      c += vec3(-0.01, 0.0, 0.016) * (1.0 - smoothstep(0.0, 0.35, l)); // cool shadows
      vec2 d = vUv - 0.5; c *= 1.0 - vig * dot(d, d) * 1.6;       // vignette
      c += (hash(vUv * 1000.0) - 0.5) / 255.0;                    // dither: no banding in the sky
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

function postBuild() {
  if (!window.THREE_PP || !R3.ok) return false;
  const P = THREE_PP;
  if (POST.composer) { POST.composer.dispose && POST.composer.dispose(); POST.composer = null; }
  const w = window.innerWidth, h = window.innerHeight, pr = gl3.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 });
  const c = new P.EffectComposer(gl3, rt);
  c.setPixelRatio(pr); c.setSize(w, h);
  c.addPass(new P.RenderPass(scene3, cam3));
  if (POST.q === 'high') {
    const ao = new P.GTAOPass(scene3, cam3, w, h);
    ao.output = P.GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 0.85;
    ao.updateGtaoMaterial({ radius: 26, distanceExponent: 1.4, thickness: 6, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    c.addPass(ao); POST.ao = ao;
  } else POST.ao = null;
  const bloom = new P.UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.5, 0.88);
  c.addPass(bloom); POST.bloom = bloom;
  c.addPass(new P.OutputPass());
  const grade = new P.ShaderPass(GRADE_SHADER); c.addPass(grade); POST.grade = grade;
  POST.composer = c; POST.w = w; POST.h = h; POST.pr = pr; POST.ok = true;
  gl3.toneMapping = THREE.ACESFilmicToneMapping; gl3.toneMappingExposure = 1.3;
  return true;
}

// Draws the 3D world. Returns false when post-processing is off (the caller renders the plain way).
function postRender(dt) {
  if (POST.q === 'off' || !window.THREE_PP) { if (gl3.toneMapping !== THREE.NoToneMapping) gl3.toneMapping = THREE.NoToneMapping; return false; }
  const w = window.innerWidth, h = window.innerHeight, pr = gl3.getPixelRatio();
  if (!POST.composer) { try { postBuild(); } catch (e) { console.error('post-processing unavailable', e); POST.q = 'off'; return false; } }
  if (w !== POST.w || h !== POST.h || pr !== POST.pr) { POST.composer.setPixelRatio(pr); POST.composer.setSize(w, h); POST.w = w; POST.h = h; POST.pr = pr; }
  POST.grade.uniforms.time.value = (performance.now() / 1000) % 100;
  // the sniper scope view gets less vignette (it draws its own), the death view a heavier one
  POST.grade.uniforms.vig.value = R3.zoom > 1.5 ? 0.12 : 0.32;
  // automatic step-down: AO is the most expensive pass; drop it if frames stay slow
  if (POST.q === 'high' && typeof FEEL !== 'undefined') {
    POST.slowT = FEEL.ft > 1 / 38 ? POST.slowT + dt : Math.max(0, POST.slowT - dt);
    if (POST.slowT > 3) { POST.q = 'medium'; POST.slowT = 0; postBuild(); if (G) message('Graphics: Medium (ambient occlusion off to keep the frame rate)', '#8e9b92', 2.5); }
  }
  POST.composer.render(dt);
  return true;
}

window.addEventListener('keydown', e => {
  if (e.code !== 'F8') return;
  e.preventDefault();
  POST.q = POST.q === 'high' ? 'medium' : POST.q === 'medium' ? 'off' : 'high';
  if (POST.q !== 'off') postBuild();
  if (G) message(`Graphics: ${POST.q === 'high' ? 'High (ambient occlusion, bloom, grading)' : POST.q === 'medium' ? 'Medium (bloom, grading)' : 'Off (plain, like the current game)'} · F8 to change`, '#e6ad45', 2.5);
});
