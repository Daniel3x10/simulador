"use strict";
/* ==========================================================================
   bench.js — Mesa de unidades experimentales: construcción, selección y
   animación de cada recipiente (pH, compost y bacilos).
   ========================================================================== */

const benchCanvas = {};
const benchReadout = {};
const cellsByUnit = {};
const compostSpecks = {};
let benchVisible = true;

// Color de fondo según el pH (ácido → alcalino), alineado con la paleta.
const PH_COLOR_STOPS = [
  [2.0, [181, 101, 29]],   // óxido
  [3.5, [226, 104, 60]],   // cobre oscuro
  [4.5, [246, 169, 107]],  // cobre claro
  [6.5, [15, 139, 141]],   // turquesa medio
  [8.0, [11, 79, 108]],    // azul petróleo
  [9.5, [11, 59, 74]],     // azul noche
];

// ---------- Construcción y selección ----------
function benchUnitHTML(unit, index) {
  return `<div class="unit" tabindex="0" role="button" aria-pressed="false" data-u="${unit}" id="u-${unit}">
    <div class="unit-head"><span><span class="tag t${treatmentOf(unit)}"></span>${unit}</span><span class="unit-pos">Posición ${index + 1}</span></div>
    <canvas id="mc-${unit}" aria-label="Recipiente ${unit}"></canvas>
    <div class="unit-readout" id="nv-${unit}"></div>
  </div>`;
}

function buildBench() {
  const replicates = Math.round(readNum("nrep"));
  state.benchOrder = benchOrderFor(replicates);
  setText($("bench-title"), replicates === 3
    ? "Disposición de las unidades experimentales (tabla 19)"
    : `Disposición de las unidades experimentales (${3 * replicates} unidades, orden aleatorio)`);
  $("bench").innerHTML = state.benchOrder.map(benchUnitHTML).join("");
  cacheBenchElements();
  bindBenchSelection();
  if (state.selectedUnit && !state.benchOrder.includes(state.selectedUnit)) state.selectedUnit = null;
}

function cacheBenchElements() {
  Object.keys(benchCanvas).forEach(k => { delete benchCanvas[k]; delete benchReadout[k]; });
  state.benchOrder.forEach(u => { benchCanvas[u] = $("mc-" + u); benchReadout[u] = $("nv-" + u); });
}

function bindBenchSelection() {
  $$(".unit").forEach(el => {
    const select = () => toggleUnitSelection(el.dataset.u);
    el.addEventListener("click", select);
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
  });
}

function toggleUnitSelection(unit) {
  state.selectedUnit = state.selectedUnit === unit ? null : unit;
  markSelectedUnit();
  drawSimulationCharts();
  updateDayViews(true);
  renderInterpretation();
}

function markSelectedUnit() {
  state.benchOrder.forEach(u => {
    const el = $("u-" + u);
    if (!el) return;
    el.classList.toggle("sel", state.selectedUnit === u);
    el.setAttribute("aria-pressed", String(state.selectedUnit === u));
  });
}

function resetBenchCells() {
  Object.keys(cellsByUnit).forEach(k => delete cellsByUnit[k]);
}

// ---------- Colores ----------
function phToRGB(ph) {
  const stops = PH_COLOR_STOPS;
  if (ph <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (ph <= stops[i][0]) {
      const f = (ph - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return stops[i - 1][1].map((v, k) => Math.round(v + (stops[i][1][k] - v) * f));
    }
  }
  return last(stops)[1];
}

// ---------- Capas del dibujo de un recipiente ----------
function drawSoil(ctx, ph, W, H) {
  ctx.fillStyle = `rgb(${phToRGB(ph).join(",")})`;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.10)";             // granos de relave
  for (let i = 0; i < 22; i++) { ctx.beginPath(); ctx.arc((i * 83.7 + 13) % W, (i * 41.3 + 7) % H, 2 + (i % 3), 0, 6.283); ctx.fill(); }
}

function specksFor(unit, compostPct) {
  const key = unit + compostPct;
  if (!compostSpecks[key]) {
    const rand = mulberry32(unit.charCodeAt(1) * 97 + replicateOf(unit) * 13 + compostPct);
    compostSpecks[key] = Array.from({ length: Math.round(compostPct * 1.6) }, () => ({ x: rand(), y: rand(), size: 2 + rand() * 4 }));
  }
  return compostSpecks[key];
}

function drawCompost(ctx, unit, compostPct, W, H) {
  ctx.fillStyle = "rgba(107,46,20,0.8)";
  specksFor(unit, compostPct).forEach(s => { ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.size, 0, 6.283); ctx.fill(); });
}

function drawVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

function drawPHLabel(ctx, ph) {
  const label = `pH ${fmt(ph, 2)}`;
  ctx.font = "10.5px " + color("fontMono");
  const width = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(11,59,74,0.75)"; ctx.fillRect(5, 5, width + 10, 17);
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(label, 10, 14);
}

// ---------- Bacilos ----------
function newCell(W, H) {
  return { x: Math.random() * W, y: Math.random() * H, angle: Math.random() * 6.283, speed: 0.4 + Math.random() * 0.8, phase: Math.random() * 6.283, length: 8 + Math.random() * 4, dead: 0 };
}

/** Número de bacilos a mostrar (escala logarítmica de la población). */
function targetCellCount(N) {
  if (N < 1) return 0;
  return Math.max(1, Math.min(60, Math.round((Math.log10(N) + 1) / 10 * 60)));
}

/** Intensidad de muerte visual según la tasa neta negativa. */
const dyingIntensity = (rate) => rate < -0.05 ? Math.min(0.85, -rate * 1.4) : 0;

/** Añade o retira bacilos gradualmente hasta el número objetivo. */
function adjustCellPopulation(cells, target, dying, W, H) {
  const alive = cells.filter(c => !c.dead);
  if (alive.length < target) for (let i = 0; i < Math.min(2, target - alive.length); i++) cells.push(newCell(W, H));
  if (alive.length > target) for (let i = 0; i < Math.min(2, alive.length - target); i++) alive[i].dead = 0.01;
  if (dying > 0) alive.forEach(c => { if (Math.random() < dying * 0.004) c.dead = 0.01; });
}

function moveCell(cell, dt, dying, W, H) {
  const speed = (cell.dead ? 0.15 : 1) * (dying ? 0.45 : 1) * cell.speed * 24 * dt * (REDUCED_MOTION ? 0.3 : 1);
  if (!cell.dead && Math.random() < 0.02) cell.angle += (Math.random() - 0.5) * 2.4;
  cell.x += Math.cos(cell.angle) * speed;
  cell.y += Math.sin(cell.angle) * speed;
  if (cell.x < -12) cell.x = W + 12; if (cell.x > W + 12) cell.x = -12;
  if (cell.y < -12) cell.y = H + 12; if (cell.y > H + 12) cell.y = -12;
}

function drawCell(ctx, cell, now) {
  const length = cell.length * (cell.dead ? 0.8 : 1), r = 2.3;
  ctx.save();
  ctx.translate(cell.x, cell.y); ctx.rotate(cell.angle);
  ctx.globalAlpha = cell.dead ? Math.max(0, 1 - cell.dead) : 1;
  if (!cell.dead) {                                     // flagelo
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 0.8; ctx.beginPath();
    for (let s = 0; s <= 8; s++) ctx.lineTo(-cell.length / 2 - s * 1.1, Math.sin(s * 0.9 + now * 14 + cell.phase) * 1.5);
    ctx.stroke();
  }
  ctx.fillStyle = cell.dead ? "#9a9a9a" : color("bacteria");
  ctx.strokeStyle = "rgba(107,46,20,0.55)"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-length / 2 + r, -r); ctx.lineTo(length / 2 - r, -r); ctx.arc(length / 2 - r, 0, r, -1.571, 1.571);
  ctx.lineTo(-length / 2 + r, r); ctx.arc(-length / 2 + r, 0, r, 1.571, 4.712);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function animateCells(ctx, cells, dt, now, dying, W, H) {
  for (let i = cells.length - 1; i >= 0; i--) {
    const cell = cells[i];
    if (cell.dead) { cell.dead += dt * 0.6; if (cell.dead > 1) { cells.splice(i, 1); continue; } }
    moveCell(cell, dt, dying, W, H);
    drawCell(ctx, cell, now);
  }
}

function drawBacteria(ctx, unit, unitState, dt, now, W, H) {
  const { params: p, curves: c } = state.sim;
  const meanPH = interpolate(c.t, c.ph[2], state.day);
  const dying = dyingIntensity(netGrowthRate(meanPH, p.T, p.kd));
  const cells = cellsByUnit[unit] || (cellsByUnit[unit] = []);
  adjustCellPopulation(cells, targetCellCount(unitState.n), dying, W, H);
  animateCells(ctx, cells, dt, now, dying, W, H);
}

// ---------- Cuadro de animación ----------
function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = W * dpr; canvas.height = H * dpr; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W, H };
}

function drawUnitFrame(unit, dt, now) {
  const canvas = benchCanvas[unit];
  if (!canvas || !canvas.clientWidth || !state.sim || !state.noise[unit]) return;
  const { ctx, W, H } = sizeCanvas(canvas), tr = treatmentOf(unit), unitState = unitStateAt(unit, state.day);
  drawSoil(ctx, unitState.ph, W, H);
  if (tr > 0) drawCompost(ctx, unit, state.sim.params.comp, W, H);
  if (tr === 2) drawBacteria(ctx, unit, unitState, dt, now, W, H);
  drawVignette(ctx, W, H);
  drawPHLabel(ctx, unitState.ph);
}

/** Avanza la animación de todos los recipientes (solo si la mesa está a la vista). */
function stepBench(dt, now) {
  if (!benchVisible) return;
  for (const unit of state.benchOrder) drawUnitFrame(unit, dt, now);
}

/** Texto bajo cada recipiente con sus valores del día actual. */
function updateUnitReadouts() {
  state.sim.units.forEach(unit => {
    const el = benchReadout[unit];
    if (!el) return;
    const tr = treatmentOf(unit), s = unitStateAt(unit, state.day);
    const detail = tr === 2 ? `Población viable: ${s.n < DETECTION_LIMIT ? "no detectable" : fmtSci(s.n) + " /g"}`
      : tr === 1 ? "Compost sin inocular" : "Relave sin tratamiento";
    setHTML(el, `Día ${fmt(state.day, 0)}: pH ${fmt(s.ph, 2)} · ${Math.round(s.ce)} µS/cm<br>${detail}`);
  });
}