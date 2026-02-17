const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// HUD elements
const lvlEl = document.getElementById("lvl");
const aliveEl = document.getElementById("alive");
const totalEl = document.getElementById("total");
const killedEl = document.getElementById("killed");
const escapedEl = document.getElementById("escaped");
const comboEl = document.getElementById("combo");
const scoreEl = document.getElementById("score");
const spdEl = document.getElementById("spd");
const levelBar = document.getElementById("levelBar");

// UI buttons
const btnStart = document.getElementById("btnStart");
const btnPause = document.getElementById("btnPause");
const btnRestart = document.getElementById("btnRestart");
const btnMute = document.getElementById("btnMute");

// Overlay
const overlay = document.getElementById("overlay");
const overlayClose = document.getElementById("overlayClose");

// Canvas sizing
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ===== CONFIG =====
const GROUP_SIZE = 10;
const MAX_LEVELS = 10;

const BASE_SPEED = 1.0;
const SPEED_INCREASE = 0.35;

const MIN_RADIUS = 18;
const MAX_RADIUS = 45;

const SIDE_DRIFT = 0.9;
const RESTITUTION = 1.0;

const FADE_SPEED = 0.03;
const SHRINK_SPEED = 0.22;

const GRID_SIZE = 32;

// Pop particles
const POP_PARTICLES_MIN = 18;
const POP_PARTICLES_MAX = 28;
const POP_GRAVITY = 0.04;

// “Juice”
const COLLISION_FLASH_FRAMES = 10;
const SCREEN_SHAKE_POWER = 2.6;
// ===================

// ===== Audio (WebAudio, sin archivos) =====
let audioCtx = null;
let masterGain = null;
let isMuted = false;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.18; // volumen general
  masterGain.connect(audioCtx.destination);
}

function setMuted(m) {
  isMuted = m;
  if (masterGain) masterGain.gain.value = isMuted ? 0 : 0.18;
  btnMute.textContent = isMuted ? "🔇 Mute" : "🔊 Sonido";
}

function beep({ freq = 440, dur = 0.08, type = "sine", gain = 0.35, slideTo = null } = {}) {
  if (!audioCtx || isMuted) return;
  const t0 = audioCtx.currentTime;

  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);

  if (slideTo != null) {
    o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
  }

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  o.connect(g);
  g.connect(masterGain);

  o.start(t0);
  o.stop(t0 + dur);
}

function popSound() {
  // pop corto y brillante
  beep({ freq: 520, slideTo: 180, dur: 0.10, type: "triangle", gain: 0.42 });
  beep({ freq: 880, slideTo: 320, dur: 0.07, type: "sine", gain: 0.22 });
}
function hitSound() {
  // “toc” de colisión suave
  beep({ freq: 220, slideTo: 160, dur: 0.06, type: "square", gain: 0.10 });
}
function levelUpSound() {
  beep({ freq: 440, slideTo: 660, dur: 0.12, type: "sine", gain: 0.22 });
  beep({ freq: 660, slideTo: 880, dur: 0.12, type: "sine", gain: 0.22 });
}
// ===============================

// Mouse
let mouseX = -9999;
let mouseY = -9999;

// Game state
let level = 1;
let circles = [];
let particles = [];
let rings = []; // ondas tipo pop
let finished = false;
let paused = true;

// Stats per level + global
let killedThisLevel = 0;
let escapedThisLevel = 0;

let totalKilled = 0;
let totalEscaped = 0;
let perLevelKilled = Array(MAX_LEVELS).fill(0);
let perLevelEscaped = Array(MAX_LEVELS).fill(0);

let score = 0;
let combo = 1;
let lastKillTime = 0; // para combo
const COMBO_WINDOW_MS = 900;

let shakeFrames = 0;
let shakeX = 0;
let shakeY = 0;

const startTime = performance.now();

// Utils
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function levelSpeed() {
  return BASE_SPEED + (level - 1) * SPEED_INCREASE;
}

function randomColor() {
  const h = randInt(0, 360);
  return `hsl(${h}, 85%, 55%)`;
}

function darkerStroke(color) {
  const m = color.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/i);
  if (!m) return "rgba(0,0,0,0.35)";
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Number(m[3]);
  const newL = Math.max(18, l - 22);
  return `hsl(${h}, ${s}%, ${newL}%)`;
}

function distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// Grid background
function drawGrid() {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  ctx.save();
  ctx.fillStyle = "#fff7c2";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 1;

  for (let x = 0; x <= W; x += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  ctx.restore();
}

// Particles & rings
class Particle {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    this.vx = rand(-2.6, 2.6);
    this.vy = rand(-3.8, -0.8);
    this.size = rand(2, 5);
    this.life = rand(18, 34);
    this.alpha = 1;
    this.color = color;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += POP_GRAVITY;
    this.life -= 1;
    this.alpha = clamp(this.life / 34, 0, 1);
  }
  draw() {
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.beginPath();
    ctx.fillStyle = this.color;
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.closePath();
    ctx.restore();
  }
}

class Ring {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    this.r = 6;
    this.life = 18;
    this.color = color;
  }
  update() {
    this.r += 6;
    this.life -= 1;
  }
  draw() {
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(this.life / 18, 0, 1);
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.color;
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }
}

function spawnPop(x, y, baseColor) {
  const n = randInt(POP_PARTICLES_MIN, POP_PARTICLES_MAX);
  for (let i = 0; i < n; i++) particles.push(new Particle(x, y, baseColor));
  for (let i = 0; i < Math.floor(n * 0.22); i++) particles.push(new Particle(x, y, "rgba(255,255,255,0.95)"));
  rings.push(new Ring(x, y, "rgba(255,255,255,0.9)"));
}

// Circle class (agar style)
class Circle {
  constructor(id, x, y, radius, dx, dy, color) {
    this.id = id;
    this.radius = radius;
    this.posX = x;
    this.posY = y;

    this.dx = dx;
    this.dy = dy;
    this.mass = radius * radius;

    this.baseColor = color;
    this.strokeColor = darkerStroke(color);

    this.alpha = 1;
    this.fading = false;
    this.dead = false;

    this.isHover = false;
    this.flash = 0; // “juice” al colisionar
    this.killedByClick = false;
  }

  isMouseOver(mx, my) {
    return distance(mx, my, this.posX, this.posY) <= this.radius;
  }

  setColor(newColor) {
    this.baseColor = newColor;
    this.strokeColor = darkerStroke(newColor);
  }

  startFade() {
    if (this.dead || this.fading) return;
    this.fading = true;
    this.killedByClick = true;
    spawnPop(this.posX, this.posY, this.baseColor);
    popSound();
  }

  step() {
    if (this.dead) return;

    this.isHover = this.isMouseOver(mouseX, mouseY);
    if (this.flash > 0) this.flash--;

    const W = canvas.clientWidth;
    this.posX += this.dx;
    this.posY += this.dy;

    // bounce sides
    if (this.posX + this.radius > W) {
      this.posX = W - this.radius;
      this.dx = -this.dx;
    }
    if (this.posX - this.radius < 0) {
      this.posX = this.radius;
      this.dx = -this.dx;
    }

    // fade + shrink
    if (this.fading) {
      this.alpha -= FADE_SPEED;
      this.radius -= SHRINK_SPEED;

      if (this.alpha <= 0 || this.radius <= 0) {
        this.alpha = 0;
        this.radius = Math.max(0, this.radius);
        this.dead = true;

        // stats + combo + score
        killedThisLevel++;
        totalKilled++;

        const now = performance.now();
        if (now - lastKillTime <= COMBO_WINDOW_MS) combo = Math.min(combo + 1, 9);
        else combo = 1;
        lastKillTime = now;

        // score: base 100 + bonus por combo + por nivel
        score += Math.round(100 * (1 + (combo - 1) * 0.25) * (1 + (level - 1) * 0.08));

        updateHUD();
      }
    }

    // escape
    if (!this.dead && (this.posY + this.radius < 0)) {
      this.dead = true;
      if (!this.killedByClick) {
        escapedThisLevel++;
        totalEscaped++;
        // penalización ligera
        score = Math.max(0, score - 35);
        combo = 1;
        updateHUD();
      }
    }
  }

  draw() {
    if (this.dead) return;

    ctx.save();
    ctx.globalAlpha = clamp(this.alpha, 0, 1);

    // shadow
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = this.isHover ? 18 : 12;
    ctx.shadowOffsetY = 4;

    // body
    ctx.beginPath();
    ctx.fillStyle = this.baseColor;
    ctx.arc(this.posX, this.posY, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // outline (flash brighten)
    ctx.shadowBlur = 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = this.flash > 0 ? "rgba(255,255,255,0.9)" : this.strokeColor;
    ctx.stroke();
    ctx.closePath();

    // highlight
    ctx.beginPath();
    ctx.globalAlpha = clamp(this.alpha * (this.isHover ? 0.58 : 0.38), 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.arc(
      this.posX - this.radius * 0.35,
      this.posY - this.radius * 0.35,
      this.radius * 0.22,
      0, Math.PI * 2
    );
    ctx.fill();
    ctx.closePath();

    // text
    ctx.globalAlpha = clamp(this.alpha, 0, 1);
    ctx.fillStyle = "rgba(15,23,42,0.92)";
    ctx.font = `${Math.max(12, Math.floor(this.radius * 0.6))}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(this.id), this.posX, this.posY);

    ctx.restore();
  }
}

// Collision helpers
function circlesCollide(a, b) {
  const d = distance(a.posX, a.posY, b.posX, b.posY);
  return d <= (a.radius + b.radius);
}

function resolveElasticCollision(a, b) {
  let nx = b.posX - a.posX;
  let ny = b.posY - a.posY;

  let dist = Math.sqrt(nx * nx + ny * ny) || 1;
  nx /= dist;
  ny /= dist;

  // separation
  const overlap = (a.radius + b.radius) - dist;
  if (overlap > 0) {
    const totalMass = a.mass + b.mass;
    const moveA = overlap * (b.mass / totalMass);
    const moveB = overlap * (a.mass / totalMass);

    a.posX -= nx * moveA;
    a.posY -= ny * moveA;
    b.posX += nx * moveB;
    b.posY += ny * moveB;
  }

  // impulse
  const rvx = b.dx - a.dx;
  const rvy = b.dy - a.dy;
  const velAlongNormal = rvx * nx + rvy * ny;
  if (velAlongNormal > 0) return;

  const j = -(1 + RESTITUTION) * velAlongNormal / (1 / a.mass + 1 / b.mass);
  const ix = j * nx;
  const iy = j * ny;

  a.dx -= ix / a.mass;
  a.dy -= iy / a.mass;
  b.dx += ix / b.mass;
  b.dy += iy / b.mass;

  // juice: flash + shake + sound
  a.flash = COLLISION_FLASH_FRAMES;
  b.flash = COLLISION_FLASH_FRAMES;

  if (shakeFrames < 6) {
    shakeFrames = 6;
  }
  hitSound();
}

// HUD update
function updateHUD() {
  const alive = circles.filter(c => !c.dead).length;

  lvlEl.textContent = String(level);
  aliveEl.textContent = String(alive);
  totalEl.textContent = String(GROUP_SIZE);

  killedEl.textContent = String(killedThisLevel);
  escapedEl.textContent = String(escapedThisLevel);

  comboEl.textContent = `x${combo}`;
  scoreEl.textContent = String(score);

  spdEl.textContent = levelSpeed().toFixed(2);

  // progress bar: (killed+escaped)/10
  const done = killedThisLevel + escapedThisLevel;
  const pct = Math.round((done / GROUP_SIZE) * 100);
  levelBar.style.width = `${pct}%`;
}

// Create level
function createLevel() {
  circles = [];
  killedThisLevel = 0;
  escapedThisLevel = 0;
  levelBar.style.width = "0%";

  const spd = levelSpeed();
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  let tries = 0;
  while (circles.length < GROUP_SIZE && tries < 6000) {
    tries++;
    const radius = randInt(MIN_RADIUS, MAX_RADIUS);
    const x = rand(radius, W - radius);
    const y = H + rand(60, 260);

    let dx = rand(-SIDE_DRIFT, SIDE_DRIFT) * spd;
    let dy = -rand(0.6, 1.25) * spd;
    if (Math.abs(dx) < 0.15) dx = dx < 0 ? -0.15 : 0.15;

    const c = new Circle(circles.length + 1, x, y, radius, dx, dy, randomColor());

    // avoid initial overlap
    let ok = true;
    for (const other of circles) {
      const d = distance(c.posX, c.posY, other.posX, other.posY);
      if (d < c.radius + other.radius + 10) { ok = false; break; }
    }
    if (ok) circles.push(c);
  }

  updateHUD();
}

// Final results screen
function drawFinalResults() {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  const totalGame = MAX_LEVELS * GROUP_SIZE;
  const pctKilled = Math.round((totalKilled / totalGame) * 100);
  const pctEscaped = 100 - pctKilled;
  const seconds = Math.max(1, Math.round((performance.now() - startTime) / 1000));

  // dim background
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillRect(0, 0, W, H);

  const cardW = Math.min(720, W * 0.90);
  const cardH = Math.min(520, H * 0.78);
  const x = (W - cardW) / 2;
  const y = (H - cardH) / 2;

  ctx.fillStyle = "rgba(11,18,32,0.92)";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 20;
  ctx.fillRect(x, y, cardW, cardH);

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "28px Arial";
  ctx.fillText("🏁 Resultados finales", W / 2, y + 22);

  ctx.font = "18px Arial";
  ctx.textAlign = "left";
  const left = x + 28;
  let yy = y + 80;
  const line = 28;

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(`Niveles: ${MAX_LEVELS}   ·   Tiempo: ${seconds}s   ·   Score: ${score}`, left, yy); yy += line + 8;

  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.fillText(`Eliminados: ${totalKilled} (${pctKilled}%)`, left, yy); yy += line;
  ctx.fillText(`Escapados: ${totalEscaped} (${pctEscaped}%)`, left, yy); yy += line;

  yy += 10;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText("Detalle por nivel:", left, yy); yy += line;

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  // dos columnas para que quepan 10 niveles
  const col2 = left + Math.floor(cardW / 2);
  let y1 = yy, y2 = yy;
  for (let i = 0; i < MAX_LEVELS; i++) {
    const t = `Nivel ${i + 1}: ${perLevelKilled[i]} K / ${perLevelEscaped[i]} E`;
    if (i < 5) {
      ctx.fillText(t, left, y1);
      y1 += 24;
    } else {
      ctx.fillText(t, col2, y2);
      y2 += 24;
    }
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.70)";
  ctx.font = "14px Arial";
  ctx.fillText("Tip: Presiona R para reiniciar o el botón ↻", W / 2, y + cardH - 28);

  ctx.restore();
}

// Input
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

canvas.addEventListener("click", (e) => {
  if (paused || finished) return;
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  for (let i = circles.length - 1; i >= 0; i--) {
    const c = circles[i];
    if (!c.dead && distance(cx, cy, c.posX, c.posY) <= c.radius) {
      c.startFade();
      break;
    }
  }
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "p") togglePause();
  if (k === "m") toggleMute();
  if (k === "r") restartGame();
});

// Buttons
btnStart.addEventListener("click", () => startGame());
btnPause.addEventListener("click", () => togglePause());
btnRestart.addEventListener("click", () => restartGame());
btnMute.addEventListener("click", () => toggleMute());

overlayClose.addEventListener("click", () => {
  startGame();
});

// Controls
function startGame() {
  initAudio();
  // En algunos navegadores hay que “despertar” audio con interacción
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();

  overlay.classList.remove("show");
  paused = false;
  finished = false;
  btnPause.textContent = "⏸ Pausa";
}

function togglePause() {
  if (finished) return;
  paused = !paused;
  btnPause.textContent = paused ? "▶ Reanudar" : "⏸ Pausa";
  overlay.classList.toggle("show", paused);
}

function toggleMute() {
  initAudio();
  setMuted(!isMuted);
}

function restartGame() {
  level = 1;
  finished = false;
  paused = true;

  // reset stats
  circles = [];
  particles = [];
  rings = [];

  killedThisLevel = 0;
  escapedThisLevel = 0;

  totalKilled = 0;
  totalEscaped = 0;
  perLevelKilled = Array(MAX_LEVELS).fill(0);
  perLevelEscaped = Array(MAX_LEVELS).fill(0);

  score = 0;
  combo = 1;
  lastKillTime = 0;

  createLevel();
  updateHUD();

  overlay.classList.add("show");
  btnPause.textContent = "⏸ Pausa";
}

// Screen shake
function applyShake() {
  if (shakeFrames > 0) {
    shakeFrames--;
    shakeX = rand(-SCREEN_SHAKE_POWER, SCREEN_SHAKE_POWER);
    shakeY = rand(-SCREEN_SHAKE_POWER, SCREEN_SHAKE_POWER);
  } else {
    shakeX = 0;
    shakeY = 0;
  }
}

// Main loop
function loop() {
  requestAnimationFrame(loop);

  // background
  drawGrid();

  // particles & rings update
  for (const p of particles) p.update();
  particles = particles.filter(p => p.life > 0);

  for (const r of rings) r.update();
  rings = rings.filter(r => r.life > 0);

  applyShake();

  // Apply camera shake transform
  ctx.save();
  ctx.translate(shakeX, shakeY);

  if (!paused && !finished) {
    // step circles
    for (const c of circles) c.step();

    // collisions + color change
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const a = circles[i];
        const b = circles[j];
        if (a.dead || b.dead) continue;

        if (circlesCollide(a, b)) {
          resolveElasticCollision(a, b);
          a.setColor(randomColor());
          b.setColor(randomColor());
        }
      }
    }

    // draw circles
    let alive = 0;
    for (const c of circles) {
      c.draw();
      if (!c.dead) alive++;
    }

    // draw rings & particles above
    for (const r of rings) r.draw();
    for (const p of particles) p.draw();

    // level end check
    if (alive === 0) {
      // Save level results
      perLevelKilled[level - 1] = killedThisLevel;
      perLevelEscaped[level - 1] = escapedThisLevel;

      if (level < MAX_LEVELS) {
        level++;
        levelUpSound();
        createLevel();
      } else {
        finished = true;
        paused = false;
      }
    }

    updateHUD();
  } else {
    // draw frozen scene (circles)
    for (const c of circles) c.draw();
    for (const r of rings) r.draw();
    for (const p of particles) p.draw();

    if (finished) {
      drawFinalResults();
    }
  }

  ctx.restore();
}

// Create first level + show overlay at start
function init() {
  createLevel();
  updateHUD();
  overlay.classList.add("show");
  paused = true;
  setMuted(false);
}
init();
loop();





