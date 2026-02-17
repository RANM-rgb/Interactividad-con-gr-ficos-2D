const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// HUD
const lvlEl = document.getElementById("lvl");
const groupCountEl = document.getElementById("groupCount");
const killedEl = document.getElementById("killed");
const totalEl = document.getElementById("total");
const pctEl = document.getElementById("pct");
const spdEl = document.getElementById("spd");

// Ajuste canvas real
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ======= CONFIG =======
const GROUP_SIZE = 10;
const MAX_LEVELS = 10;

const BASE_SPEED = 1.0;
const SPEED_INCREASE = 0.35;

const MIN_RADIUS = 18;
const MAX_RADIUS = 45;

const SIDE_DRIFT = 0.9;
const FADE_SPEED = 0.03;
const SHRINK_SPEED = 0.22;
const RESTITUTION = 1.0;

// Fondo grid
const GRID_SIZE = 32;

// POP
const POP_PARTICLES_MIN = 18;
const POP_PARTICLES_MAX = 28;
const POP_GRAVITY = 0.04;
// ======================

// Mouse
let mouseX = -9999;
let mouseY = -9999;

// Estado
let level = 1;
let circles = [];
let finished = false;

// Partículas pop
let particles = [];

// ===== Resultados globales =====
let removedThisLevel = 0;         // eliminados en el nivel actual
let escapedThisLevel = 0;         // escapados en el nivel actual

let totalRemoved = 0;             // eliminados total del juego
let totalEscaped = 0;             // escapados total del juego
let perLevelRemoved = Array(MAX_LEVELS).fill(0);
let perLevelEscaped = Array(MAX_LEVELS).fill(0);

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

function updateHUD() {
  // HUD del nivel (solo eliminados por click)
  const total = GROUP_SIZE;
  const pct = total === 0 ? 0 : Math.round((removedThisLevel / total) * 100);

  lvlEl.textContent = String(level);
  groupCountEl.textContent = String(GROUP_SIZE);
  killedEl.textContent = String(removedThisLevel);
  totalEl.textContent = String(total);
  pctEl.textContent = `${pct}%`;
  spdEl.textContent = levelSpeed().toFixed(2);
}

function distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// Fondo tipo agar.io
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

// ===== POP particles =====
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = rand(-2.5, 2.5);
    this.vy = rand(-3.6, -0.8);
    this.size = rand(2, 5);
    this.life = rand(18, 30);
    this.alpha = 1;
    this.color = color;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += POP_GRAVITY;
    this.life -= 1;
    this.alpha = clamp(this.life / 30, 0, 1);
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

function spawnPop(x, y, baseColor) {
  const n = randInt(POP_PARTICLES_MIN, POP_PARTICLES_MAX);
  for (let i = 0; i < n; i++) particles.push(new Particle(x, y, baseColor));
  for (let i = 0; i < Math.floor(n * 0.25); i++) particles.push(new Particle(x, y, "rgba(255,255,255,0.95)"));
}

// ===== Circle =====
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
    this.isHover = false;

    this.alpha = 1;
    this.fading = false;
    this.dead = false;

    this.killedByClick = false; // distingue eliminado vs escapado
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
  }

  step() {
    if (this.dead) return;

    this.isHover = this.isMouseOver(mouseX, mouseY);

    const W = canvas.clientWidth;
    this.posX += this.dx;
    this.posY += this.dy;

    // rebote lateral
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

        // contabilizar eliminado
        removedThisLevel++;
        totalRemoved++;
        updateHUD();
      }
    }

    // sale arriba => escapado (si no fue click)
    if (!this.dead && (this.posY + this.radius < 0)) {
      this.dead = true;

      if (!this.killedByClick) {
        escapedThisLevel++;
        totalEscaped++;
      }
    }
  }

  draw() {
    if (this.dead) return;

    ctx.save();
    ctx.globalAlpha = clamp(this.alpha, 0, 1);

    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = this.isHover ? 16 : 10;
    ctx.shadowOffsetY = 4;

    // cuerpo
    ctx.beginPath();
    ctx.fillStyle = this.baseColor;
    ctx.arc(this.posX, this.posY, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // borde
    ctx.shadowBlur = 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = this.strokeColor;
    ctx.stroke();
    ctx.closePath();

    // highlight
    ctx.beginPath();
    ctx.globalAlpha = clamp(this.alpha * (this.isHover ? 0.55 : 0.35), 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.arc(this.posX - this.radius * 0.35, this.posY - this.radius * 0.35, this.radius * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.closePath();

    // texto
    ctx.globalAlpha = clamp(this.alpha, 0, 1);
    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.font = `${Math.max(12, Math.floor(this.radius * 0.6))}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(this.id), this.posX, this.posY);

    ctx.restore();
  }
}

// ===== Colisiones =====
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

  // separación
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

  // impulso
  const rvx = b.dx - a.dx;
  const rvy = b.dy - a.dy;

  const velAlongNormal = rvx * nx + rvy * ny;
  if (velAlongNormal > 0) return;

  const e = RESTITUTION;
  const j = -(1 + e) * velAlongNormal / (1 / a.mass + 1 / b.mass);
  const ix = j * nx;
  const iy = j * ny;

  a.dx -= ix / a.mass;
  a.dy -= iy / a.mass;
  b.dx += ix / b.mass;
  b.dy += iy / b.mass;
}

// ===== Crear nivel =====
function createLevel() {
  circles = [];
  removedThisLevel = 0;
  escapedThisLevel = 0;

  const spd = levelSpeed();
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  let tries = 0;
  while (circles.length < GROUP_SIZE && tries < 5000) {
    tries++;

    const radius = randInt(MIN_RADIUS, MAX_RADIUS);
    const x = rand(radius, W - radius);
    const y = H + rand(50, 240);

    let dx = rand(-SIDE_DRIFT, SIDE_DRIFT) * spd;
    let dy = -rand(0.6, 1.25) * spd;

    if (Math.abs(dx) < 0.15) dx = dx < 0 ? -0.15 : 0.15;

    const c = new Circle(circles.length + 1, x, y, radius, dx, dy, randomColor());

    // evitar nacer encimados
    let ok = true;
    for (const other of circles) {
      const d = distance(c.posX, c.posY, other.posX, other.posY);
      if (d < c.radius + other.radius + 10) { ok = false; break; }
    }

    if (ok) circles.push(c);
  }

  updateHUD();
}

// ===== Mouse & Click =====
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

canvas.addEventListener("click", (e) => {
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

// ===== Pantalla final =====
function drawFinalResults() {
  const totalGame = MAX_LEVELS * GROUP_SIZE;
  const pctRemoved = Math.round((totalRemoved / totalGame) * 100);
  const pctEscaped = 100 - pctRemoved;
  const seconds = Math.max(1, Math.round((performance.now() - startTime) / 1000));

  // Fondo suavizado
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  // Tarjeta
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const cardW = Math.min(640, W * 0.86);
  const cardH = Math.min(420, H * 0.72);
  const x = (W - cardW) / 2;
  const y = (H - cardH) / 2;

  ctx.fillStyle = "rgba(15,23,42,0.92)";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 18;
  ctx.fillRect(x, y, cardW, cardH);

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff";
  ctx.font = "28px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("✅ Resultados finales", W / 2, y + 22);

  ctx.font = "18px Arial";
  ctx.textAlign = "left";

  const left = x + 28;
  let yy = y + 78;
  const line = 28;

  ctx.fillText(`Niveles jugados: ${MAX_LEVELS}`, left, yy); yy += line;
  ctx.fillText(`Total de elementos: ${totalGame}`, left, yy); yy += line;

  yy += 8;
  ctx.fillText(`Eliminados (click): ${totalRemoved}  (${pctRemoved}%)`, left, yy); yy += line;
  ctx.fillText(`Escapados (salieron arriba): ${totalEscaped}  (${pctEscaped}%)`, left, yy); yy += line;

  yy += 8;
  ctx.fillText(`Tiempo total: ${seconds} s`, left, yy); yy += line;

  yy += 14;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText("Eliminados por nivel:", left, yy); yy += line;

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  let row = 0;
  for (let i = 0; i < MAX_LEVELS; i++) {
    const text = `Nivel ${i + 1}: ${perLevelRemoved[i]} eliminados, ${perLevelEscaped[i]} escapados`;
    ctx.fillText(text, left, yy);
    yy += 22;
    row++;
    if (row === 6) break; // evita desbordar
  }

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "14px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Recarga la página para volver a jugar.", W / 2, y + cardH - 28);

  ctx.restore();
}

// ===== Loop principal =====
function updateCircle() {
  requestAnimationFrame(updateCircle);

  drawGrid();

  // partículas
  for (const p of particles) p.update();
  particles = particles.filter(p => p.life > 0);

  // Si terminó, mostrar resultados y partículas
  if (finished) {
    for (const p of particles) p.draw();
    drawFinalResults();
    return;
  }

  // movimiento
  for (const c of circles) c.step();

  // colisiones + cambio de color
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

  // dibujar círculos
  let alive = 0;
  for (const c of circles) {
    c.draw();
    if (!c.dead) alive++;
  }

  // dibujar partículas encima
  for (const p of particles) p.draw();

  // nivel completado
  if (alive === 0) {
    // Guardar resultados del nivel actual
    perLevelRemoved[level - 1] = removedThisLevel;
    perLevelEscaped[level - 1] = escapedThisLevel;

    if (level < MAX_LEVELS) {
      level++;
      createLevel();
    } else {
      finished = true;
    }
  }
}

// Iniciar
createLevel();
updateCircle();




