/* ==========================================================================
   NEON HIGHWAY — endless runner arcade, Canvas 2D, JavaScript vanilla
   Structure : 1 Config · 2 DOM/État · 3 Pools · 4 Redimensionnement ·
               5 Projection · 6 Décor · 7 Véhicules · 8 Logique · 9 Entrées · 10 Boucle
   ========================================================================== */
(() => {
'use strict';

/* ---------- 1. CONFIG ---------- */
const P = 0.075;          // force de la perspective : t = 1 / (1 + z * P)
const SPAWN_Z = 115;      // profondeur d'apparition des véhicules
const UNIT = 0.32;        // km/h -> unités de monde / seconde
const STORE = 'neonHighwayBest';
const COLORS = ['#c4162a', '#7d8590', '#1d3f9e', '#1a1b22', '#e0a81c', '#6a2fb5', '#1ea8c9'];   // teintes type Tesla

/* ---------- 2. DOM & ÉTAT ---------- */
const $ = id => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d');
const ui = { coins: $('coins'), speed: $('speed'), dist: $('dist'), best: $('best'), fill: $('boostFill'), bar: $('boostBar'),
  hud: $('hud'), touch: $('touch'), menu: $('menu'), over: $('over'), final: $('finalDist'),
  rec: $('newRec'), toast: $('toast'), flash: $('flash') };
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const loadBest = () => { try { return +localStorage.getItem(STORE) || 0; } catch (e) { return 0; } };
const saveBest = v => { try { localStorage.setItem(STORE, String(v)); } catch (e) {} };

const S = { mode: 'menu', v: 105, dist: 0, time: 0, clk: 0, scroll: 0, boost: 100, boosting: false, locked: false,
  bf: 0, coins: 0, jy: 0, jv: 0, coinT: 2, lane: 0, target: 0, tilt: 0, shake: 0, flash: 0, spawnT: 1, best: loadBest(), overAt: 0 };
const inp = { boost: false };

/* ---------- 3. POOLS (aucune allocation dans la boucle) ---------- */
const cars = Array.from({ length: 16 }, () => ({ on: false, lane: 0, z: -999, v: 0, truck: false, color: '#fff', passed: false }));
const coinsP = Array.from({ length: 30 }, () => ({ on: false, lane: 0, z: -999 }));
const parts = Array.from({ length: 90 }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, c: '#fff', s: 2 }));
const streaks = Array.from({ length: 40 }, () => ({ a: rnd(0.1, 3.04), r: Math.random(), sp: rnd(0.5, 1.2) }));
const stars = Array.from({ length: 60 }, () => [Math.random(), Math.random() * 0.8, Math.random() * 1.4 + 0.4]);

// dégradés partagés, définis dans le repère 100x100 des véhicules (réutilisés à chaque dessin)
const shadeG = ctx.createLinearGradient(0, -64, 0, -8);
[[0, 'rgba(255,255,255,.4)'], [.35, 'rgba(255,255,255,0)'], [.7, 'rgba(0,0,0,.1)'], [1, 'rgba(0,0,0,.5)']].forEach(s => shadeG.addColorStop(s[0], s[1]));
const glassG = ctx.createLinearGradient(0, -60, 0, -44);
glassG.addColorStop(0, '#7e9fd0'); glassG.addColorStop(1, '#0d1630');

/* ---------- 4. REDIMENSIONNEMENT ---------- */
let W = 0, H = 0, dpr = 1, cx = 0, hy = 0, py = 0, RW = 0, LS = 0, tb = 1;
let skyG, seaG, roadG, hazeG, glowG, sunG, sunX = 0, sunY = 0, sunR = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = W / 2; hy = H * 0.40; py = H * 0.87;
  RW = Math.min(W * 0.47, H * 0.52);   // demi-largeur de route au niveau du joueur
  LS = RW / 1.5;                       // largeur d'une voie
  tb = (H - hy) / (py - hy);           // t en bas d'écran
  const grad = (y0, y1, stops) => { const g = ctx.createLinearGradient(0, y0, 0, y1); stops.forEach(s => g.addColorStop(s[0], s[1])); return g; };
  skyG = grad(0, hy, [[0, '#0b0830'], [.35, '#3a1768'], [.62, '#b2347e'], [.85, '#ff6f61'], [1, '#ffb36b']]);
  seaG = grad(hy, H, [[0, '#7a2f86'], [.12, '#241556'], [1, '#080b24']]);
  roadG = grad(hy, H, [[0, '#2a1b52'], [.3, '#151a40'], [1, '#090c26']]);
  hazeG = grad(hy - 30, hy + 90, [[0, 'rgba(255,140,170,0)'], [.3, 'rgba(255,140,170,.42)'], [1, 'rgba(255,140,170,0)']]);
  sunR = Math.min(W, H) * 0.17; sunX = cx - W * 0.16; sunY = hy - sunR * 0.25;
  glowG = ctx.createRadialGradient(sunX, sunY, sunR * 0.2, sunX, sunY, sunR * 2.6);
  glowG.addColorStop(0, 'rgba(255,170,90,.6)'); glowG.addColorStop(1, 'rgba(255,100,150,0)');
  sunG = grad(sunY - sunR, sunY + sunR, [[0, '#ffe07a'], [.5, '#ff8a5c'], [1, '#ff4f8b']]);
}

/* ---------- 5. PROJECTION ---------- */
const T = z => 1 / (1 + z * P);          // échelle selon la profondeur z (0 = joueur)
const X = (lane, t) => cx + lane * LS * t;
const Y = t => hy + (py - hy) * t;

function quad(l1, l2, t1, t2, fill) {
  ctx.fillStyle = fill; ctx.beginPath();
  ctx.moveTo(X(l1, t1), Y(t1)); ctx.lineTo(X(l2, t1), Y(t1));
  ctx.lineTo(X(l2, t2), Y(t2)); ctx.lineTo(X(l1, t2), Y(t2));
  ctx.closePath(); ctx.fill();
}

/* ---------- 6. DÉCOR ---------- */
function drawBackground() {
  ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, hy + 1);
  // étoiles
  for (const s of stars) { ctx.globalAlpha = (0.3 + 0.5 * Math.abs(Math.sin(S.clk * 1.5 + s[0] * 40))) * (1 - s[1]); ctx.fillStyle = '#fff'; ctx.fillRect(s[0] * W, s[1] * hy, s[2], s[2]); }
  ctx.globalAlpha = 1;
  // soleil (clippé à l'horizon) avec bandes
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hy); ctx.clip();
  ctx.fillStyle = glowG; ctx.fillRect(0, 0, W, hy);
  ctx.fillStyle = sunG; ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, 6.283); ctx.fill();
  ctx.fillStyle = 'rgba(70,20,100,.8)';
  for (let k = 0; k < 6; k++) ctx.fillRect(sunX - sunR, sunY + sunR * (0.05 + k * 0.15), sunR * 2, 1.5 + k * 1.5);
  ctx.restore();
  // montagnes lointaines + bâtiments (légère parallaxe selon la voie)
  const n = 34, bw = W / n, ox = -S.lane * 5;
  ctx.fillStyle = '#2a1458'; ctx.beginPath(); ctx.moveTo(0, hy);
  for (let i = 0; i <= n; i++) ctx.lineTo(i * bw + ox, hy - (10 + 26 * Math.abs(Math.sin(i * 0.8) + 0.6 * Math.sin(i * 2.1))) * H / 800);
  ctx.lineTo(W, hy); ctx.fill();
  ctx.fillStyle = '#150a33';
  for (let i = 0; i < n; i++) {
    const x = i * bw + ox * 2; if (Math.abs(x + bw / 2 - cx) < W * 0.05) continue;
    const h = (6 + 30 * Math.abs(Math.sin(i * 3.7) * Math.cos(i * 1.3))) * H / 800 * (x > cx ? 1 : 0.5);
    ctx.fillRect(x, hy - h, bw * 0.8, h);
  }
  // mer (gauche) et terre (droite)
  ctx.fillStyle = seaG; ctx.fillRect(0, hy, W, H - hy);
  ctx.fillStyle = 'rgba(8,4,28,.55)'; ctx.fillRect(cx, hy, W - cx, H - hy);
  for (let k = 0; k < 12; k++) {      // reflet du soleil sur l'eau
    const f = k / 12, y = hy + (H - hy) * f * f + 2, w = sunR * (0.3 + f * 1.4) * (0.6 + 0.4 * Math.sin(S.clk * 2 + k * 1.7));
    ctx.fillStyle = 'rgba(255,170,120,.35)'; ctx.fillRect(sunX - w / 2, y, w, 1 + f * 3);
  }
}

function drawRoad() {
  ctx.fillStyle = roadG; ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(cx + RW * tb, H); ctx.lineTo(cx - RW * tb, H); ctx.fill();
  // bandes transversales (sensation de vitesse)
  const off = S.scroll % 6;
  ctx.lineWidth = 1;
  for (let i = 0; i < 22; i++) {
    const z = i * 6 - off; if (z < -3) continue;
    const t = T(z); ctx.strokeStyle = 'rgba(60,200,255,' + (0.05 + 0.07 * t + 0.08 * S.bf) + ')';
    ctx.beginPath(); ctx.moveTo(X(-1.5, t), Y(t)); ctx.lineTo(X(1.5, t), Y(t)); ctx.stroke();
  }
  // séparateurs de voie animés
  const dOff = S.scroll % 8, dc = 'rgba(150,245,255,' + (0.7 + 0.3 * S.bf) + ')';
  for (let i = 0; i < 16; i++) {
    const z = i * 8 - dOff, z2 = z + 3.5; if (z2 < -3) continue;
    const t1 = T(Math.max(z, -3)), t2 = T(z2), dw = 0.03;
    quad(-0.5 - dw, -0.5 + dw, t1, t2, dc); quad(0.5 - dw, 0.5 + dw, t1, t2, dc);
  }
  // bordures cyan lumineuses
  ctx.strokeStyle = '#37f0ff'; ctx.lineWidth = Math.max(2, W * 0.004); ctx.shadowColor = '#37f0ff'; ctx.shadowBlur = 14;
  for (const s of [-1.5, 1.5]) { ctx.beginPath(); ctx.moveTo(X(s, 0), hy); ctx.lineTo(X(s, tb), H); ctx.stroke(); }
  ctx.shadowBlur = 0;
}

function drawPalm(x, y, s) {
  const h = LS * s * 0.95, tx = x - h * 0.06, ty = y - h;
  ctx.strokeStyle = '#150b2e'; ctx.lineWidth = Math.max(1, LS * s * 0.035);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + h * 0.05, y - h * 0.55, tx, ty); ctx.stroke();
  ctx.lineWidth = Math.max(1, LS * s * 0.02);
  const L = h * 0.4;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI + i * (Math.PI / 6), c = Math.cos(a), sn = Math.sin(a);
    ctx.beginPath(); ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(tx + c * L * 0.5, ty + sn * L * 0.9 - L * 0.15, tx + c * L, ty + sn * L * 0.4 + L * 0.4); ctx.stroke();
  }
}

function drawPylon(x, y, s, dir) {
  const h = LS * s * 0.8, lx = x + dir * h * 0.3, ly = y - h;
  ctx.strokeStyle = '#1d1442'; ctx.lineWidth = Math.max(1, LS * s * 0.03);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, ly); ctx.lineTo(lx, ly); ctx.stroke();
  ctx.fillStyle = 'rgba(80,240,255,.25)'; ctx.beginPath(); ctx.arc(lx, ly, Math.max(2, LS * s * 0.08), 0, 6.283); ctx.fill();
  ctx.fillStyle = '#b8fbff'; ctx.beginPath(); ctx.arc(lx, ly, Math.max(1, LS * s * 0.03), 0, 6.283); ctx.fill();
}

function drawRoadside() {   // palmiers (droite) et pylônes (gauche), du plus loin au plus proche
  const PS = 10, off = S.scroll % PS;
  for (let i = 14; i >= 0; i--) {
    const z = i * PS - off; if (z < -4) continue;
    const t = T(z), y = Y(t);
    drawPalm(X(2.15, t), y, t);
    const z2 = z + PS / 2; if (z2 > 140) continue;
    const t2 = T(z2); drawPylon(X(-2.0, t2), Y(t2), t2, 1);
  }
}

function drawStreaks() {
  if (S.bf < 0.03) return;
  const diag = Math.hypot(W, H); ctx.lineWidth = 1.5;
  for (const l of streaks) {
    const r0 = l.r * diag, r1 = r0 + diag * 0.07 * (0.3 + l.r), c = Math.cos(l.a), s = Math.sin(l.a);
    ctx.strokeStyle = 'rgba(160,245,255,' + (S.bf * 0.4 * l.r) + ')';
    ctx.beginPath(); ctx.moveTo(cx + c * r0, hy + s * r0); ctx.lineTo(cx + c * r1, hy + s * r1); ctx.stroke();
  }
}

/* ---------- 7. VÉHICULES ---------- */
// Silhouette arrière de berline électrique (inspirée Tesla, sans logo) — repère 100 x 100
function tesla(col, player) {
  if (player) {   // coussins anti-gravité cyan à la place des roues
    ctx.fillStyle = '#7ff7ff'; ctx.shadowColor = '#37f0ff'; ctx.shadowBlur = 16 + 10 * S.bf;
    ctx.fillRect(-46, -8, 15, 4); ctx.fillRect(31, -8, 15, 4); ctx.shadowBlur = 0;
  } else { ctx.fillStyle = '#050509'; ctx.fillRect(-46, -12, 15, 12); ctx.fillRect(31, -12, 15, 12); }
  ctx.beginPath(); ctx.moveTo(-48, -9); ctx.lineTo(-50, -28); ctx.quadraticCurveTo(-50, -38, -43, -40); ctx.lineTo(-37, -42);
  ctx.quadraticCurveTo(-34, -60, -24, -63); ctx.lineTo(24, -63); ctx.quadraticCurveTo(34, -60, 37, -42); ctx.lineTo(43, -40);
  ctx.quadraticCurveTo(50, -38, 50, -28); ctx.lineTo(48, -9); ctx.quadraticCurveTo(0, -4, -48, -9); ctx.closePath();
  ctx.fillStyle = col; ctx.fill(); ctx.fillStyle = shadeG; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-31, -44); ctx.quadraticCurveTo(-29, -58, -21, -60); ctx.lineTo(21, -60); ctx.quadraticCurveTo(29, -58, 31, -44); ctx.closePath();
  ctx.fillStyle = glassG; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.moveTo(-24, -58); ctx.lineTo(-8, -58); ctx.lineTo(-18, -45); ctx.lineTo(-30, -45); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-43, -40); ctx.lineTo(43, -40); ctx.stroke();
  ctx.fillStyle = '#10111a'; ctx.fillRect(-38, -18, 76, 9);                       // diffuseur
  ctx.fillStyle = 'rgba(255,255,255,.1)'; for (let i = -3; i <= 3; i++) ctx.fillRect(i * 10 - 1, -18, 2, 9);
  ctx.fillStyle = '#e8ebf3'; ctx.fillRect(-13, -30, 26, 9); ctx.fillStyle = '#39405a'; ctx.fillRect(-10, -27, 20, 3);   // plaque
  for (let s = -1; s <= 1; s += 2) {   // feux LED effilés
    ctx.save(); ctx.scale(s, 1);
    ctx.fillStyle = 'rgba(255,30,60,.3)'; ctx.fillRect(-52, -43, 40, 12);
    ctx.fillStyle = '#ff2442'; ctx.beginPath(); ctx.moveTo(-49, -32); ctx.quadraticCurveTo(-49, -39, -41, -40); ctx.lineTo(-14, -40);
    ctx.lineTo(-14, -35); ctx.lineTo(-41, -34.5); ctx.quadraticCurveTo(-45, -34, -47, -30); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  if (player) { ctx.fillStyle = '#37f0ff'; ctx.fillRect(-24, -64, 48, 1.8); ctx.fillRect(-40, -7, 80, 2); }
}

// kind : 0 voiture, 1 camion, 2 joueur, 3 barrière — dessin dans un repère 100 x 100, origine = bas centre
function drawCar(x, y, w, col, kind, tilt, alpha) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y);
  if (kind !== 2) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(0, 0, w * 0.6, w * 0.09, 0, 0, 6.283); ctx.fill(); }
  ctx.rotate(tilt); const k = w / 100; ctx.scale(k, k);
  if (w < 24) {   // niveau de détail réduit au loin
    ctx.fillStyle = col; ctx.fillRect(-50, kind === 1 ? -80 : -48, 100, kind === 1 ? 72 : 40);
    ctx.fillStyle = '#ff3040'; ctx.fillRect(-44, -30, 24, 12); ctx.fillRect(20, -30, 24, 12);
  } else if (kind === 1) {   // camion
    ctx.fillStyle = col; ctx.fillRect(-50, -86, 100, 78);
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(-50, -86, 100, 6);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(-2, -80, 4, 72); ctx.fillRect(-50, -26, 100, 18);
    ctx.fillStyle = '#10121c'; ctx.fillRect(-46, -14, 92, 6);
    ctx.fillStyle = 'rgba(255,40,70,.3)'; ctx.fillRect(-50, -30, 26, 16); ctx.fillRect(24, -30, 26, 16);
    ctx.fillStyle = '#ff2b45'; ctx.fillRect(-46, -26, 18, 9); ctx.fillRect(28, -26, 18, 9);
    ctx.fillStyle = '#07080f'; ctx.fillRect(-44, -10, 18, 10); ctx.fillRect(26, -10, 18, 10);
  } else if (kind === 3) {   // barrière basse à sauter
    ctx.fillStyle = '#12142e'; ctx.fillRect(-50, -34, 100, 24);
    ctx.save(); ctx.beginPath(); ctx.rect(-50, -34, 100, 24); ctx.clip(); ctx.fillStyle = '#ff7a2f';
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.moveTo(-50 + i * 18, -34); ctx.lineTo(-38 + i * 18, -34); ctx.lineTo(-46 + i * 18, -10); ctx.lineTo(-58 + i * 18, -10); ctx.fill(); }
    ctx.restore();
    ctx.shadowColor = '#37f0ff'; ctx.shadowBlur = 10; ctx.fillStyle = '#37f0ff'; ctx.fillRect(-50, -37, 100, 3); ctx.shadowBlur = 0;
    ctx.fillStyle = '#07080f'; ctx.fillRect(-44, -10, 6, 10); ctx.fillRect(38, -10, 6, 10);
  } else if (kind === 2) {
    tesla('#f3f5fa', true);
  } else {
    tesla(col, false);
  }
  ctx.restore();
}

function drawTraffic(front) {   // front = true : voitures devant le joueur (z > 0)
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i]; if (!c.on || (c.z > 0) !== front) continue;
    const t = T(c.z), w = LS * 0.66 * t * (c.truck ? 1.12 : 1);
    drawCar(X(c.lane, t), Y(t), w, c.color, c.bar ? 3 : c.truck ? 1 : 0, 0, Math.min(1, 0.15 + t * 8));
  }
}

function drawCoins() {
  for (const c of coinsP) {
    if (!c.on || c.z <= 0) continue;
    const t = T(c.z), r = LS * 0.13 * t, x = X(c.lane, t), y = Y(t) - LS * 0.45 * t, sq = Math.abs(Math.cos(S.clk * 5 + c.z * 0.4));
    ctx.fillStyle = 'rgba(255,200,60,.3)'; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.6, r * sq), r, 0, 0, 6.283); ctx.fill();
  }
}

function drawPlayer() {
  const x = X(S.lane, 1), w = LS * 0.66, lift = (S.jy + 0.05 + 0.012 * Math.sin(S.clk * 6)) * w;   // la voiture flotte
  ctx.fillStyle = 'rgba(0,0,0,' + (0.5 - 0.25 * Math.min(1, S.jy * 2)) + ')'; ctx.beginPath(); ctx.ellipse(x, py, w * 0.6, w * 0.09, 0, 0, 6.283); ctx.fill();
  if (S.bf > 0.03) {   // traînées et halo cyan pendant le boost
    const len = H * 0.22 * S.bf;
    for (const sx of [-0.3, 0.3]) {
      const gx = x + sx * w, g = ctx.createLinearGradient(0, py - w * 0.4 - len, 0, py - w * 0.4);
      g.addColorStop(0, 'rgba(55,240,255,0)'); g.addColorStop(1, 'rgba(55,240,255,.7)');
      ctx.fillStyle = g; ctx.fillRect(gx - w * 0.05, py - w * 0.4 - len, w * 0.1, len);
    }
    ctx.fillStyle = 'rgba(55,240,255,' + (0.15 + 0.3 * S.bf) + ')'; ctx.beginPath(); ctx.ellipse(x, py, w * 0.75, w * 0.14, 0, 0, 6.283); ctx.fill();
  }
  drawCar(x, py - lift, w, '#fff', 2, S.tilt, 1);
}

function drawParticles() {
  for (const p of parts) { if (!p.on) continue; ctx.globalAlpha = p.life / p.max; ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.s, p.s); }
  ctx.globalAlpha = 1;
}

/* ---------- 8. LOGIQUE ---------- */
function emit(x, y, vx, vy, life, c, s, g) {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]; if (p.on) continue;
    p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = p.max = life; p.c = c; p.s = s; p.g = g; return;
  }
}

let toastTimer = 0;
function toast(txt) { ui.toast.textContent = txt; ui.toast.classList.remove('show'); void ui.toast.offsetWidth; ui.toast.classList.add('show'); }

function spawn() {
  // Jamais 3 voies bloquées sur la même fenêtre de profondeur : la partie reste toujours jouable
  const occ = [false, false, false]; let n = 0;
  for (const c of cars) if (c.on && c.z > SPAWN_Z - 24) { const i = c.lane + 1; if (!occ[i]) { occ[i] = true; n++; } }
  let l = (Math.random() * 3) | 0;
  if (n >= 2 && !occ[l]) for (let k = 0; k < 3; k++) { const i = (l + k) % 3; if (occ[i]) { l = i; break; } }
  for (const c of cars) {
    if (c.on) continue;
    if (cars.some(o => o.on && o.lane === l - 1 && o.z > SPAWN_Z - 12)) return;   // évite l'empilement dans une voie
    c.on = true; c.lane = l - 1; c.z = SPAWN_Z; c.passed = false;
    c.bar = Math.random() < 0.2; c.truck = !c.bar && Math.random() < 0.18; c.v = c.bar ? 0 : c.truck ? rnd(45, 62) : rnd(62, 100);
    c.color = c.truck ? '#6a7490' : COLORS[(Math.random() * COLORS.length) | 0];
    return;
  }
}

function steer(d) { if (S.mode === 'play') S.target = clamp(S.target + d, -1, 1); }
function jump() { if (S.mode === 'play' && S.jy === 0) S.jv = 3.1; }

function spawnCoins() {   // ligne de 6 pièces dans une voie libre
  const occ = [false, false, false];
  for (const c of cars) if (c.on && c.z > 0) occ[c.lane + 1] = true;
  const free = [0, 1, 2].filter(i => !occ[i]); if (!free.length) return;
  const l = free[(Math.random() * free.length) | 0] - 1;
  for (let n = 0, i = 0; n < 6 && i < coinsP.length; i++) { const k = coinsP[i]; if (k.on) continue; k.on = true; k.lane = l; k.z = SPAWN_Z + n * 4; n++; }
}

function start() {
  for (const c of cars) { c.on = false; c.z = -999; }
  for (const k of coinsP) k.on = false;
  ui.coins.textContent = 0;
  Object.assign(S, { mode: 'play', coins: 0, jy: 0, jv: 0, coinT: 2, v: 127, dist: 0, time: 0, boost: 100, boosting: false, locked: false, lane: 0, target: 0, tilt: 0, spawnT: 1.2, shake: 0, flash: 0 });
  ui.menu.classList.add('hidden'); ui.over.classList.add('hidden');
  ui.hud.classList.remove('hidden'); ui.bar.classList.remove('hidden'); ui.touch.classList.remove('hidden');
  ui.best.textContent = S.best;
}

function crash() {
  S.mode = 'over'; S.shake = 1; S.flash = 1; S.boosting = false; inp.boost = false; S.overAt = performance.now();
  const px = X(S.lane, 1);
  for (let i = 0; i < 32; i++) emit(px + rnd(-30, 30), py - 20, rnd(-260, 260), rnd(-380, -60), rnd(0.5, 1), i % 2 ? '#ff7a3d' : '#ffd25a', rnd(2, 5), 520);
  const d = Math.floor(S.dist), rec = d > S.best;
  if (rec) { S.best = d; saveBest(d); }
  ui.final.textContent = d.toLocaleString('fr-FR') + ' m'; ui.rec.classList.toggle('hidden', !rec);
  ui.best.textContent = S.best; ui.over.classList.remove('hidden'); ui.touch.classList.add('hidden');
}

function updatePlay(dt) {
  S.time += dt;
  // boost limité : se vide vite, se recharge lentement, verrou en cas de surchauffe
  const want = inp.boost && !S.locked && S.boost > 0;
  if (want) { S.boost -= 30 * dt; if (S.boost <= 0) { S.boost = 0; S.locked = true; toast('SURCHAUFFE'); } }
  else { S.boost = Math.min(100, S.boost + 7 * dt); if (S.locked && S.boost >= 25) S.locked = false; }
  S.boosting = want && !S.locked;
  const base = 127 + Math.min(36, S.time * 0.42), target = base + (S.boosting ? 58 : 0);   // ~127 -> 163 (220 en boost)
  S.v += (target - S.v) * Math.min(1, dt * (S.boosting ? 2.6 : 1.6));
  S.scroll += S.v * UNIT * dt; S.dist += S.v / 3.6 * dt;

  S.spawnT -= dt;
  if (S.spawnT <= 0) { spawn(); S.spawnT = Math.max(0.38, 1.15 - S.dist / 8000) * rnd(0.75, 1.35); }

  for (const c of cars) {
    if (!c.on) continue;
    c.z -= (S.v - c.v) * UNIT * dt;
    if (c.z < 1.3 && c.z > -1.1 && Math.abs(c.lane - S.lane) < (c.truck ? 0.8 : 0.72) && !(c.bar && S.jy > 0.2)) { crash(); return; }
    if (!c.passed && c.z < -1.2) {   // dépassement réussi = petite recharge
      c.passed = true; const close = Math.abs(c.lane - S.lane) < 0.95;
      S.boost = Math.min(100, S.boost + (close ? 10 : 5)); if (close) toast('CLOSE CALL  +BOOST');
    }
    if (c.z < -5) { c.on = false; c.z = -999; }
  }
  if (S.jy > 0 || S.jv > 0) { S.jv -= 10 * dt; S.jy += S.jv * dt; if (S.jy <= 0) { S.jy = 0; S.jv = 0; } }   // saut
  S.coinT -= dt; if (S.coinT <= 0) { spawnCoins(); S.coinT = rnd(1.6, 3.2); }
  for (const k of coinsP) {
    if (!k.on) continue; k.z -= S.v * UNIT * dt;
    if (k.z < 1 && k.z > -1 && Math.abs(k.lane - S.lane) < 0.6) { k.on = false; S.coins++; S.boost = Math.min(100, S.boost + 0.8); ui.coins.textContent = S.coins; }
    else if (k.z < -3) k.on = false;
  }
  if (S.boosting) { const x = X(S.lane, 1), w = LS * 0.66; emit(x + w * 0.3 * (Math.random() < 0.5 ? -1 : 1), py - w * 0.3, rnd(-30, 30), -rnd(80, 220), 0.4, '#5ff4ff', rnd(2, 4), 0); }
  ui.speed.textContent = Math.round(S.v); ui.dist.textContent = Math.floor(S.dist);
  ui.fill.style.width = S.boost + '%'; ui.bar.classList.toggle('low', S.locked);
}

function update(dt) {
  S.clk += dt;
  S.shake = Math.max(0, S.shake - dt * 2.4); S.flash = Math.max(0, S.flash - dt * 2.2);
  S.bf += ((S.boosting ? 1 : 0) - S.bf) * Math.min(1, dt * 6);
  S.lane += (S.target - S.lane) * Math.min(1, dt * 11);                      // changement de voie fluide
  S.tilt += ((S.target - S.lane) * 0.22 - S.tilt) * Math.min(1, dt * 10);   // inclinaison
  if (S.mode === 'play') updatePlay(dt);
  else if (S.mode === 'menu') { S.v = 105; S.scroll += S.v * UNIT * dt; }
  if (S.mode !== 'over') for (const l of streaks) { l.r += l.sp * dt * (0.5 + S.bf * 2); if (l.r > 1) { l.r = 0.03; l.a = rnd(0.1, 3.04); } }
  for (const p of parts) { if (!p.on) continue; p.life -= dt; if (p.life <= 0) { p.on = false; continue; } p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
}

/* ---------- 9. ENTRÉES ---------- */
function tryStart() { if (S.mode === 'menu' || (S.mode === 'over' && performance.now() - S.overAt > 700)) start(); }

window.addEventListener('keydown', e => {
  const c = e.code;
  if (c === 'ArrowLeft' || c === 'ArrowRight' || c === 'ArrowUp' || c === 'ArrowDown' || c === 'Space') e.preventDefault();   // pas de scroll
  if (c === 'ArrowLeft' || c === 'KeyA') { if (!e.repeat) steer(-1); }
  else if (c === 'ArrowRight' || c === 'KeyD') { if (!e.repeat) steer(1); }
  else if (c === 'ArrowUp' || c === 'KeyW') { if (S.mode === 'play' && !e.repeat) jump(); }
  else if (c === 'Space' || c === 'ShiftLeft') { if (S.mode === 'play') inp.boost = true; else if (c === 'Space' && !e.repeat) tryStart(); }
  else if (c === 'Enter' && !e.repeat) tryStart();
});
window.addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'ShiftLeft') inp.boost = false; });
window.addEventListener('blur', () => { inp.boost = false; });

$('startBtn').addEventListener('click', start);
$('retryBtn').addEventListener('click', start);
ui.touch.querySelectorAll('button').forEach(b => {   // commandes tactiles
  const act = b.dataset.act;
  b.addEventListener('pointerdown', e => { e.preventDefault(); if (act === 'left') steer(-1); else if (act === 'right') steer(1); else if (act === 'jump') jump(); else if (S.mode === 'play') inp.boost = true; });
  if (act === 'boost') ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => b.addEventListener(ev, () => { inp.boost = false; }));
});
document.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('resize', resize);

/* ---------- 10. RENDU & BOUCLE ---------- */
function render() {
  ctx.save();
  if (S.shake > 0) ctx.translate(rnd(-1, 1) * S.shake * 14, rnd(-1, 1) * S.shake * 10);
  drawBackground(); drawRoad(); drawRoadside();
  ctx.fillStyle = hazeG; ctx.fillRect(0, hy - 30, W, 120);          // brouillard d'horizon
  drawStreaks();
  // tri en place (insertion) : du plus loin au plus proche
  for (let i = 1; i < cars.length; i++) { const c = cars[i]; let j = i - 1; while (j >= 0 && cars[j].z < c.z) { cars[j + 1] = cars[j]; j--; } cars[j + 1] = c; }
  drawTraffic(true); drawCoins(); drawPlayer(); drawTraffic(false); drawParticles();
  ctx.restore();
  ui.flash.style.opacity = S.flash;
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts;
  update(dt); render(); requestAnimationFrame(frame);
}

resize(); ui.best.textContent = S.best; requestAnimationFrame(frame);
})();
