'use strict';
const TAU = Math.PI * 2;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
const rand = (a, b) => a + Math.random() * (b - a);
const pickRand = arr => arr[Math.floor(Math.random() * arr.length)];
function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
function turnTo(a, target, maxStep) { return a + clamp(angDiff(a, target), -maxStep, maxStep); }
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function shapeBB(o) {
  return o.t === 'c' ? [o.x - o.r, o.y - o.r, o.x + o.r, o.y + o.r] : [o.x, o.y, o.x + o.w, o.y + o.h];
}
function pointInShape(o, x, y) {
  if (o.t === 'c') return dist2(x, y, o.x, o.y) <= o.r * o.r;
  return x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h;
}
function segCircleHit(x0, y0, x1, y1, cx, cy, r) {
  // returns t of first intersection on segment, or -1
  const dx = x1 - x0, dy = y1 - y0;
  const fx = x0 - cx, fy = y0 - cy;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
