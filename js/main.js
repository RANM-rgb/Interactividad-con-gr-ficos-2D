const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// HUD
const lvlEl = document.getElementById("lvl");
const aliveEl = document.getElementById("alive");
const totalEl = document.getElementById("total");
const goalEl = document.getElementById("goal");
const killedEl = document.getElementById("killed");
const escapedEl = document.getElementById("escaped");
const comboEl = document.getElementById("combo");
const scoreEl = document.getElementById("score");
const spdEl = document.getElementById("spd");
const levelBar = document.getElementById("levelBar");

// Buttons
const btnStart = document.getElementById("btnStart");
const btnPause = document.getElementById("btnPause");
const btnRestart = document.getElementById("btnRestart");
const btnMute = document.getElementById("btnMute");

// Power-ups
const puSlow = document.getElementById("puSlow");
const puFreeze = document.getElementById("puFreeze");
const puDouble = document.getElementById("puDouble");

// Overlay options
const overlay = document.getElementById("overlay");
const overlayClose = document.getElementById("overlayClose");
const difficultySel = document.getElementById("difficulty");
const volumeSlider = document.getElementById("volume");

// Resize
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

// POP
const POP_PARTICLES_MIN = 18;
const POP_PARTICLES_MAX = 28;
const POP_GRAVITY = 0.04;

// Combo
const COMBO_WINDOW_MS = 900;

// Power-ups duration (ms)
const SLOW_MS = 3500;
const FREEZE_MS = 1600;
const DOUBLE_MS = 4500;
// ==================

// ===== Audio (louder) =====
let audioCtx = null;
let masterGain = null;
let musicGain = null;
let isMuted = false;
let musicNodes = [];
let musicOn = false;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = audioCtx.createGain();
  // MÁS ALTO por defecto (usuario pidió)
  masterGain.gain.value = 0.50;
  masterGain.connect(audioCtx.destination);

  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.10;
  musicGain.connect(masterGain);
}

function setVolumeFromUI() {
  if (!masterGain) return;
  const v = Number(volumeSlider.value) / 100; // 0..1
  // volumen fuerte: base 0.05 a 0.90
  masterGain.gain.value = isMuted ? 0 : (0.05 + v * 0.85);
}

function setMuted(m) {
  isMuted = m;
  setVolumeFromUI();
  btnMute.textContent = isMuted ? "🔇 Mute" : "🔊 Sonido";
}

function beep({ freq=440, dur=0.08, type="sine", gain=0.35, slideTo=null }={}) {
  if (!audioCtx || isMuted) return;
  const t0 = audioCtx.currentTime;

  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);

  if (slideTo != null) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  o.connect(g);
  g.connect(masterGain);

  o.start(t0);
  o.stop(t0 + dur);
}

function popSound(){ beep({freq:520, slideTo:180, dur:0.10, type:"triangle", gain:0.65}); beep({freq:880, slideTo:320, dur:0.07, type:"sine", gain:0.35}); }
function hitSound(){ beep({freq:220, slideTo:160, dur:0.06, type:"square", gain:0.18}); }
function levelUpSound(){ beep({freq:440, slideTo:660, dur:0.12, type:"sine", gain:0.28}); beep({freq:660, slideTo:880, dur:0.12, type:"sine", gain:0.28}); }

// Música generada (simple)
function startMusic() {
  if (!audioCtx || isMuted || musicOn) return;
  musicOn = true;

  // 2 osciladores suaves + filtro
  const filt = audioCtx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 900;

  const o1 = audioCtx.createOscillator();
  const o2 = audioCtx.createOscillator();
  o1.type = "sine";
  o2.type = "triangle";

  const g1 = audioCtx.createGain();
  const g2 = audioCtx.createGain();
  g1.gain.value = 0.10;
  g2.gain.value = 0.06;

  // Acordes sencillos (loop por tiempo)
  const notes = [220, 277.18, 329.63, 392.00, 329.63, 277.18]; // vibe
  let idx = 0;

  function stepChord() {
    if (!musicOn) return;
    const t = audioCtx.currentTime;
    const n = notes[idx % notes.length];
    o1.frequency.setValueAtTime(n, t);
    o2.frequency.setValueAtTime(n * 2, t);
    idx++;
    setTimeout(stepChord, 450);
  }

  o1.connect(g1);
  o2.connect(g2);
  g1.connect(filt);
  g2.connect(filt);
  filt.connect(musicGain);

  o1.start();
  o2.start();
  stepChord();

  musicNodes = [o1, o2, g1, g2, filt];
}

function stopMusic() {
  musicOn = false;
  try {
    for (const n of musicNodes) {
      if (n && typeof n.stop === "function") n.stop();
    }
  } catch {}
  musicNodes = [];
}
// =======================

// Mouse
let mouseX = -9999, mouseY = -9999;

// Game state
let level = 1;
let circles = [];
let particles = [];
let rings = [];
let finished = false;
let paused = true;

// Stats
let killedThisLevel = 0, escapedThisLevel = 0;
let totalKilled = 0, totalEscaped = 0;
let perLevelKilled = Array(MAX_LEVELS).fill(0);
let perLevelEscaped = Array(MAX_LEVELS).fill(0);

// Score & combo
let score = 0;
let combo = 1;
let lastKillTime = 0;

// Difficulty + Goal
let difficulty = "normal";
let goalMin = 7; // por defecto normal

// Power-ups
let slowUntil = 0;
let freezeUntil = 0;
let doubleUntil = 0;

// Time
const startTime = performance.now();

// Utils
function rand(min,max){ return Math.random()*(max-min)+min; }
function randInt(min,max){ return Math.floor(rand(min,max+1)); }
function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }
function distance(x1,y1,x2,y2){ const dx=x2-x1, dy=y2-y1; return Math.sqrt(dx*dx+dy*dy); }

function levelSpeed() {
  let s = BASE_SPEED + (level - 1) * SPEED_INCREASE;

  // dificultad altera velocidad base
  if (difficulty === "easy") s *= 0.92;
  if (difficulty === "hard") s *= 1.18;

  // powerup slow
  const now = performance.now();
  if (now < slowUntil) s *= 0.55;

  // freeze (0)
  if (now < freezeUntil) s *= 0.0;

  return s;
}

function randomColor() {
  const h = randInt(0, 360);
  return `hsl(${h}, 85%, 55%)`;
}

function darkerStroke(color) {
  const m = color.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/i);
  if (!m) return "rgba(0,0,0,0.35)";
  const h = Number(m[1]), s = Number(m[2]), l = Number(m[3]);
  return `hsl(${h}, ${s}%, ${Math.max(18, l - 22)}%)`;
}

// Grid
function drawGrid() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  ctx.save();
  ctx.fillStyle = "#fff7c2";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 1;
  for (let x=0; x<=W; x+=GRID_SIZE){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y=0; y<=H; y+=GRID_SIZE){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();
}

// Particles & rings
class Particle {
  constructor(x,y,color){
    this.x=x; this.y=y;
    this.vx=rand(-2.6,2.6);
    this.vy=rand(-3.8,-0.8);
    this.size=rand(2,5);
    this.life=rand(18,34);
    this.alpha=1;
    this.color=color;
  }
  update(){
    this.x+=this.vx; this.y+=this.vy;
    this.vy+=POP_GRAVITY;
    this.life-=1;
    this.alpha=clamp(this.life/34,0,1);
  }
  draw(){
    if(this.life<=0) return;
    ctx.save();
    ctx.globalAlpha=this.alpha;
    ctx.beginPath();
    ctx.fillStyle=this.color;
    ctx.arc(this.x,this.y,this.size,0,Math.PI*2);
    ctx.fill();
    ctx.closePath();
    ctx.restore();
  }
}

class Ring {
  constructor(x,y,color){
    this.x=x; this.y=y;
    this.r=6;
    this.life=18;
    this.color=color;
  }
  update(){ this.r+=6; this.life-=1; }
  draw(){
    if(this.life<=0) return;
    ctx.save();
    ctx.globalAlpha=clamp(this.life/18,0,1);
    ctx.beginPath();
    ctx.lineWidth=3;
    ctx.strokeStyle=this.color;
    ctx.arc(this.x,this.y,this.r,0,Math.PI*2);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }
}

function spawnPop(x,y,color){
  const n=randInt(POP_PARTICLES_MIN, POP_PARTICLES_MAX);
  for(let i=0;i<n;i++) particles.push(new Particle(x,y,color));
  for(let i=0;i<Math.floor(n*0.22);i++) particles.push(new Particle(x,y,"rgba(255,255,255,0.95)"));
  rings.push(new Ring(x,y,"rgba(255,255,255,0.9)"));
}

// Circle
class Circle {
  constructor(id,x,y,r,dx,dy,color){
    this.id=id;
    this.radius=r;
    this.posX=x; this.posY=y;
    this.dx=dx; this.dy=dy;
    this.mass=r*r;
    this.baseColor=color;
    this.strokeColor=darkerStroke(color);
    this.alpha=1;
    this.fading=false;
    this.dead=false;
    this.killedByClick=false;
    this.isHover=false;
  }

  isMouseOver(mx,my){ return distance(mx,my,this.posX,this.posY) <= this.radius; }

  setColor(c){ this.baseColor=c; this.strokeColor=darkerStroke(c); }

  startFade(){
    if(this.dead || this.fading) return;
    this.fading=true;
    this.killedByClick=true;
    spawnPop(this.posX,this.posY,this.baseColor);
    popSound();
  }

  step(){
    if(this.dead) return;

    this.isHover = this.isMouseOver(mouseX, mouseY);

    // freeze / slow afecta velocidad
    const spdFactor = levelSpeed() / (BASE_SPEED + (level - 1) * SPEED_INCREASE || 1);
    const W = canvas.clientWidth;

    // movimiento
    this.posX += this.dx * spdFactor;
    this.posY += this.dy * spdFactor;

    // rebote lateral
    if(this.posX + this.radius > W){ this.posX=W-this.radius; this.dx=-this.dx; }
    if(this.posX - this.radius < 0){ this.posX=this.radius; this.dx=-this.dx; }

    // fade + shrink
    if(this.fading){
      this.alpha -= FADE_SPEED;
      this.radius -= SHRINK_SPEED;
      if(this.alpha<=0 || this.radius<=0){
        this.alpha=0; this.radius=Math.max(0,this.radius);
        this.dead=true;

        // stats
        killedThisLevel++;
        totalKilled++;

        // combo
        const now = performance.now();
        if(now - lastKillTime <= COMBO_WINDOW_MS) combo = Math.min(combo + 1, 9);
        else combo = 1;
        lastKillTime = now;

        // score (x2 si powerup)
        const mult = (performance.now() < doubleUntil) ? 2 : 1;
        score += Math.round(mult * 100 * (1 + (combo - 1) * 0.25) * (1 + (level - 1) * 0.08));
      }
    }

    // escape arriba
    if(!this.dead && (this.posY + this.radius < 0)){
      this.dead=true;
      if(!this.killedByClick){
        escapedThisLevel++;
        totalEscaped++;
        score = Math.max(0, score - 35);
        combo = 1;
      }
    }
  }

  draw(){
    if(this.dead) return;

    ctx.save();
    ctx.globalAlpha=clamp(this.alpha,0,1);

    ctx.shadowColor="rgba(0,0,0,0.22)";
    ctx.shadowBlur=this.isHover ? 18 : 12;
    ctx.shadowOffsetY=4;

    // body
    ctx.beginPath();
    ctx.fillStyle=this.baseColor;
    ctx.arc(this.posX,this.posY,this.radius,0,Math.PI*2);
    ctx.fill();

    // outline
    ctx.shadowBlur=0;
    ctx.lineWidth=4;
    ctx.strokeStyle=this.strokeColor;
    ctx.stroke();
    ctx.closePath();

    // highlight
    ctx.beginPath();
    ctx.globalAlpha=clamp(this.alpha*(this.isHover ? 0.58 : 0.38),0,1);
    ctx.fillStyle="rgba(255,255,255,0.92)";
    ctx.arc(this.posX-this.radius*0.35, this.posY-this.radius*0.35, this.radius*0.22, 0, Math.PI*2);
    ctx.fill();
    ctx.closePath();

    // text
    ctx.globalAlpha=clamp(this.alpha,0,1);
    ctx.fillStyle="rgba(15,23,42,0.92)";
    ctx.font=`${Math.max(12, Math.floor(this.radius*0.6))}px Arial`;
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    ctx.fillText(String(this.id), this.posX, this.posY);

    ctx.restore();
  }
}

// Collisions (no atraviesan)
function circlesCollide(a,b){
  return distance(a.posX,a.posY,b.posX,b.posY) <= (a.radius + b.radius);
}
function resolveElasticCollision(a,b){
  let nx=b.posX-a.posX, ny=b.posY-a.posY;
  let dist=Math.sqrt(nx*nx+ny*ny) || 1;
  nx/=dist; ny/=dist;

  // separation
  const overlap=(a.radius+b.radius)-dist;
  if(overlap>0){
    const totalMass=a.mass+b.mass;
    const moveA=overlap*(b.mass/totalMass);
    const moveB=overlap*(a.mass/totalMass);
    a.posX-=nx*moveA; a.posY-=ny*moveA;
    b.posX+=nx*moveB; b.posY+=ny*moveB;
  }

  // impulse
  const rvx=b.dx-a.dx, rvy=b.dy-a.dy;
  const velAlongNormal=rvx*nx + rvy*ny;
  if(velAlongNormal>0) return;

  const j=-(1+RESTITUTION)*velAlongNormal / (1/a.mass + 1/b.mass);
  const ix=j*nx, iy=j*ny;

  a.dx-=ix/a.mass; a.dy-=iy/a.mass;
  b.dx+=ix/b.mass; b.dy+=iy/b.mass;

  hitSound();
}

// Goals by difficulty
function computeGoalMin() {
  if (difficulty === "easy") return 6;
  if (difficulty === "hard") return 8;
  return 7; // normal
}

// HUD update
function updateHUD(){
  const alive = circles.filter(c => !c.dead).length;

  lvlEl.textContent = String(level);
  aliveEl.textContent = String(alive);
  totalEl.textContent = String(GROUP_SIZE);

  goalMin = computeGoalMin();
  goalEl.textContent = `${goalMin}/10`;

  killedEl.textContent = String(killedThisLevel);
  escapedEl.textContent = String(escapedThisLevel);

  comboEl.textContent = `x${combo}`;
  scoreEl.textContent = String(score);

  spdEl.textContent = levelSpeed().toFixed(2);

  const done = killedThisLevel + escapedThisLevel;
  const pct = Math.round((done / GROUP_SIZE) * 100);
  levelBar.style.width = `${pct}%`;
}

// Create level
function createLevel(){
  circles=[];
  killedThisLevel=0;
  escapedThisLevel=0;
  levelBar.style.width="0%";

  const spd = BASE_SPEED + (level - 1) * SPEED_INCREASE;
  const W=canvas.clientWidth, H=canvas.clientHeight;

  let tries=0;
  while(circles.length < GROUP_SIZE && tries < 6000){
    tries++;
    const r=randInt(MIN_RADIUS, MAX_RADIUS);
    const x=rand(r, W-r);
    const y=H + rand(60,260);

    let dx=rand(-SIDE_DRIFT, SIDE_DRIFT) * spd;
    let dy=-rand(0.6, 1.25) * spd;
    if(Math.abs(dx)<0.15) dx = dx<0 ? -0.15 : 0.15;

    const c=new Circle(circles.length+1, x, y, r, dx, dy, randomColor());

    let ok=true;
    for(const other of circles){
      const d=distance(c.posX,c.posY,other.posX,other.posY);
      if(d < c.radius + other.radius + 10){ ok=false; break; }
    }
    if(ok) circles.push(c);
  }

  updateHUD();
}

// Final results (simple overlay text on canvas)
function drawFinalResults(){
  const W=canvas.clientWidth, H=canvas.clientHeight;
  const totalGame = MAX_LEVELS * GROUP_SIZE;
  const pctKilled = Math.round((totalKilled / totalGame) * 100);
  const seconds = Math.max(1, Math.round((performance.now() - startTime)/1000));

  ctx.save();
  ctx.fillStyle="rgba(255,255,255,0.75)";
  ctx.fillRect(0,0,W,H);

  const cardW=Math.min(760, W*0.92);
  const cardH=Math.min(520, H*0.80);
  const x=(W-cardW)/2, y=(H-cardH)/2;

  ctx.fillStyle="rgba(11,18,32,0.92)";
  ctx.shadowColor="rgba(0,0,0,0.35)";
  ctx.shadowBlur=20;
  ctx.fillRect(x,y,cardW,cardH);

  ctx.shadowBlur=0;
  ctx.fillStyle="#fff";
  ctx.textAlign="center";
  ctx.textBaseline="top";
  ctx.font="28px Arial";
  ctx.fillText("🏁 Resultados finales", W/2, y+22);

  ctx.textAlign="left";
  ctx.font="18px Arial";
  let yy=y+78;
  const left=x+28;

  ctx.fillStyle="rgba(255,255,255,0.90)";
  ctx.fillText(`Tiempo: ${seconds}s   ·   Score: ${score}`, left, yy); yy+=32;
  ctx.fillStyle="rgba(255,255,255,0.85)";
  ctx.fillText(`Eliminados: ${totalKilled} (${pctKilled}%)`, left, yy); yy+=28;
  ctx.fillText(`Escapados: ${totalEscaped}`, left, yy); yy+=28;

  ctx.fillStyle="rgba(255,255,255,0.92)";
  yy+=10;
  ctx.fillText("Detalle por nivel:", left, yy); yy+=28;

  ctx.fillStyle="rgba(255,255,255,0.82)";
  const col2 = left + Math.floor(cardW/2);
  let y1=yy, y2=yy;
  for(let i=0;i<MAX_LEVELS;i++){
    const t=`Nivel ${i+1}: ${perLevelKilled[i]} K / ${perLevelEscaped[i]} E`;
    if(i<5){ ctx.fillText(t,left,y1); y1+=24; }
    else { ctx.fillText(t,col2,y2); y2+=24; }
  }

  ctx.textAlign="center";
  ctx.fillStyle="rgba(255,255,255,0.70)";
  ctx.font="14px Arial";
  ctx.fillText("Presiona R para reiniciar o botón ↻", W/2, y+cardH-28);

  ctx.restore();
}

// Input
canvas.addEventListener("mousemove", (e)=>{
  const rect=canvas.getBoundingClientRect();
  mouseX=e.clientX-rect.left;
  mouseY=e.clientY-rect.top;
});

canvas.addEventListener("click", (e)=>{
  if(paused || finished) return;
  const rect=canvas.getBoundingClientRect();
  const cx=e.clientX-rect.left;
  const cy=e.clientY-rect.top;

  for(let i=circles.length-1;i>=0;i--){
    const c=circles[i];
    if(!c.dead && distance(cx,cy,c.posX,c.posY)<=c.radius){
      c.startFade();
      break;
    }
  }
});

// Keyboard
window.addEventListener("keydown", (e)=>{
  const k=e.key.toLowerCase();
  if(k==="p") togglePause();
  if(k==="m") toggleMute();
  if(k==="r") restartGame();

  if(k==="1") activateSlow();
  if(k==="2") activateFreeze();
  if(k==="3") activateDouble();
});

// Buttons
btnStart.addEventListener("click", ()=>startGame());
btnPause.addEventListener("click", ()=>togglePause());
btnRestart.addEventListener("click", ()=>restartGame());
btnMute.addEventListener("click", ()=>toggleMute());

overlayClose.addEventListener("click", ()=>startGame());
volumeSlider.addEventListener("input", ()=>setVolumeFromUI());
difficultySel.addEventListener("change", ()=>{ difficulty = difficultySel.value; updateHUD(); });

// Power-up buttons
puSlow.addEventListener("click", ()=>activateSlow());
puFreeze.addEventListener("click", ()=>activateFreeze());
puDouble.addEventListener("click", ()=>activateDouble());

function activateSlow(){
  if(paused || finished) return;
  slowUntil = performance.now() + SLOW_MS;
  beep({freq: 330, slideTo: 220, dur: 0.12, type:"sine", gain:0.30});
}
function activateFreeze(){
  if(paused || finished) return;
  freezeUntil = performance.now() + FREEZE_MS;
  beep({freq: 180, slideTo: 120, dur: 0.14, type:"triangle", gain:0.28});
}
function activateDouble(){
  if(paused || finished) return;
  doubleUntil = performance.now() + DOUBLE_MS;
  beep({freq: 740, slideTo: 990, dur: 0.16, type:"sine", gain:0.26});
}

// Controls
function startGame(){
  initAudio();
  if(audioCtx && audioCtx.state==="suspended") audioCtx.resume();
  setVolumeFromUI();

  difficulty = difficultySel.value;
  updateHUD();

  overlay.classList.remove("show");
  paused=false;
  finished=false;
  btnPause.textContent="⏸ Pausa";

  // música ON
  startMusic();
}

function togglePause(){
  if(finished) return;
  paused = !paused;
  btnPause.textContent = paused ? "▶ Reanudar" : "⏸ Pausa";
  overlay.classList.toggle("show", paused);
}

function toggleMute(){
  initAudio();
  setMuted(!isMuted);
  if (isMuted) stopMusic();
  else startMusic();
}

function restartGame(){
  level=1;
  finished=false;
  paused=true;

  circles=[];
  particles=[];
  rings=[];

  killedThisLevel=0;
  escapedThisLevel=0;

  totalKilled=0;
  totalEscaped=0;
  perLevelKilled = Array(MAX_LEVELS).fill(0);
  perLevelEscaped = Array(MAX_LEVELS).fill(0);

  score=0;
  combo=1;
  lastKillTime=0;

  slowUntil=0; freezeUntil=0; doubleUntil=0;

  createLevel();
  updateHUD();

  overlay.classList.add("show");
  btnPause.textContent="⏸ Pausa";
}

// Main loop
function loop(){
  requestAnimationFrame(loop);

  drawGrid();

  // update particles/rings
  for(const p of particles) p.update();
  particles = particles.filter(p=>p.life>0);

  for(const r of rings) r.update();
  rings = rings.filter(r=>r.life>0);

  if(finished){
    // draw last fx
    for(const r of rings) r.draw();
    for(const p of particles) p.draw();
    drawFinalResults();
    return;
  }

  if(!paused){
    // step
    for(const c of circles) c.step();

    // collisions + color change
    for(let i=0;i<circles.length;i++){
      for(let j=i+1;j<circles.length;j++){
        const a=circles[i], b=circles[j];
        if(a.dead || b.dead) continue;
        if(circlesCollide(a,b)){
          resolveElasticCollision(a,b);
          a.setColor(randomColor());
          b.setColor(randomColor());
        }
      }
    }
  }

  // draw circles
  let alive=0;
  for(const c of circles){
    c.draw();
    if(!c.dead) alive++;
  }

  // draw fx
  for(const r of rings) r.draw();
  for(const p of particles) p.draw();

  // update HUD
  updateHUD();

  // level complete?
  if(!paused && alive===0){
    // Guardar stats del nivel
    perLevelKilled[level-1] = killedThisLevel;
    perLevelEscaped[level-1] = escapedThisLevel;

    // Objetivo por nivel: si no cumples, repites el nivel
    if(killedThisLevel < computeGoalMin()){
      // repite nivel
      combo = 1;
      beep({freq: 200, slideTo: 120, dur: 0.20, type:"square", gain:0.25});
      createLevel();
      return;
    }

    // pasa nivel
    if(level < MAX_LEVELS){
      level++;
      levelUpSound();
      createLevel();
    } else {
      finished = true;
      stopMusic();
    }
  }
}

function computeGoalMin(){
  if(difficulty==="easy") return 6;
  if(difficulty==="hard") return 8;
  return 7;
}

// Init
function init(){
  difficulty = difficultySel.value;
  createLevel();
  updateHUD();
  overlay.classList.add("show");
  paused=true;
  setMuted(false);
}
init();
loop();





