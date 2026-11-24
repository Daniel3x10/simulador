"use strict";
/* ==========================================================================
   scenarios-view.js — Pestaña 3: tabla de escenarios (tabla 38), mapa de
   objetivos (figura 38) y comportamiento dentro del rango de pH
   (tabla y figura 39). Los resultados se guardan en caché.
   ========================================================================== */

let scenarioResults = null;
const heatCache = {};
const rangeCache = {};
let heatTemperature = 20;
let rangeTemperature = 28;

// ---------- Tabla de escenarios ----------
/** Valores y parámetros de un escenario (con el ácido mínimo si corresponde). */
function scenarioParams(scenario) {
  const values = { ...TAB_DEFAULTS[scenario.tab], ...scenario.overrides };
  let params = toModelParams(values, scenario.tab);
  if (scenario.useMinimumAcid) {
    const acid = findMinimumAcid(params);
    values.acid = String(acid === null ? 0 : acid);
    params = toModelParams(values, scenario.tab);
  }
  return { values, params };
}

function computeScenarios() {
  return SCENARIOS.map(scenario => {
    const { values, params } = scenarioParams(scenario);
    return { scenario, values, params, evaluation: evaluateDesign(params, false) };
  });
}

const yesNo = (ok) => chipHTML(ok ? "good" : "bad", ok ? "Sí" : "No");

function acidNote(r) {
  if (r.scenario.tab !== "funciona") return "";
  const acid = +r.values.acid;
  return ` <span class="note">(${Math.round(acid)} mmol H⁺/kg ≈ ${fmt(acid * r.params.mrec / 1000 / 2, 1)} mL de H₂SO₄ 1 M por unidad)</span>`;
}

function scenarioRowHTML(r, index) {
  const e = r.evaluation, o = e.objectives, [kind, text] = verdictOf(e);
  return `<tr>
    <td><b>${index + 1}. ${r.scenario.name}</b></td>
    <td>${r.scenario.description}${acidNote(r)}</td>
    <td>${yesNo(o[0])}<br><span class="note">${fmtPercent(e.p10)}</span></td>
    <td>${yesNo(o[1])}<br><span class="note">${e.finalN < 1 ? "< 1" : fmtSci(e.finalN)} /g</span></td>
    <td>${yesNo(o[2])}<br><span class="note">${fmtPercent(e.p21)}</span></td>
    <td>${yesNo(o[3])}<br><span class="note">pH ${fmt(e.finalPHT2, 2)}</span></td>
    <td>${yesNo(o[4])}</td>
    <td><span class="chip ${kind}" style="white-space:normal">${text}</span></td>
    <td><button type="button" data-load="${index}">Analizar</button></td>
  </tr>`;
}

function renderScenarioTable() {
  if (!scenarioResults) scenarioResults = computeScenarios();
  $("sit-table").innerHTML = `<table class="data"><tr><th>Escenario</th><th>Descripción</th><th>1. Compost</th><th>2. Viabilidad</th><th>3. Microorganismo</th><th>4. Metales</th><th>5. Material</th><th>Resultado</th><th></th></tr>` +
    scenarioResults.map(scenarioRowHTML).join("") + `</table>`;
  $$("[data-load]").forEach(b => b.addEventListener("click", () => loadScenario(+b.dataset.load)));
}

/** Carga un escenario en su pestaña para revisarlo en detalle. */
function loadScenario(index) {
  const r = scenarioResults[index], tab = r.scenario.tab;
  tabValues[tab] = { ...r.values };
  if (location.hash.slice(1) === tab) showTab(tab);
  else location.hash = tab;
}

function renderScenarioSummary() {
  const fulfilled = scenarioResults.filter(r => verdictOf(r.evaluation)[0] === "good");
  const conclusion = fulfilled.length
    ? `<p><b>Escenarios en que se cumple la hipótesis completa:</b> ${fulfilled.map(r => SCENARIOS.indexOf(r.scenario) + 1).join(", ")}.</p>`
    : `<p><b>Conclusión.</b> Ningún escenario cumple simultáneamente todos los objetivos: la condición que requiere el microorganismo (pH ≤ 4,5) es la misma que moviliza los metales. Con el diseño de nueve unidades experimentales, el resultado demostrable es el efecto del compost (escenarios 1 y 4).</p>`;
  $("sit-x").querySelector(".xb").innerHTML = [
    `<p><b>Relave en su condición natural (escenarios 1 a 4).</b> Se demuestra el efecto del compost: T1 y T2 modifican el pH y la conductividad eléctrica respecto a T0. Con la dispersión observada en la medición inicial (escenario 2), solo la conductividad permite distinguir el efecto.</p>`,
    `<p><b>Viabilidad del microorganismo.</b> A pH 7,99 la bacteria solo permanece detectable si su resistencia es mucho mayor que la supuesta (escenario 3), y aun así no presenta efecto medible, porque fuera de su rango de pH no oxida el hierro ni los sulfuros.</p>`,
    `<p><b>Acondicionamiento ácido (escenarios 5 a 7).</b> El acondicionamiento a pH 6,0 no es suficiente. Con el sistema a pH 4,5 o menor, el microorganismo permanece activo y su efecto es demostrable; sin embargo, a ese pH aumenta la movilidad del Cu y del Zn, lo que contradice el objetivo de la investigación.</p>`,
    conclusion,
  ].join("");
}

// ---------- Mapa de objetivos (figura 38) ----------
const heatCategories = () => [
  { color: color("t2"), label: "Se cumple la hipótesis completa" },
  { color: color("t1"), label: "Efecto del microorganismo demostrable, con movilización de Cu y Zn" },
  { color: color("amber"), label: "Microorganismo viable sin efecto medible" },
  { color: color("slate"), label: "Solo se demuestra el efecto del compost" },
  { color: color("brown"), label: "Ningún efecto demostrable" },
];

/** Parámetros de una celda del mapa: pH del sistema y mortalidad de la cepa. */
function heatCellParams(pH, kd, temperature) {
  const base = TAB_DEFAULTS.real, acidified = pH < 7.99 - 1e-6;
  return { acid: 0, beta: +base.beta, phr: pH, cer: +base.cer, comp: +base.comp,
    phc1: acidified ? Math.min(7.2, pH) : 7.2, phc2: acidified ? Math.min(6.8, pH) : 6.8, cec1: 3.5, cec2: 3.8,
    dose: 100, Xc: 10 ** 8.03, kd, T: temperature, alpha: 0.03, eps: 15, nr: 3, mrec: 500, disp: 5, sdph: 0.05, cvce: 0.03, sdn: 0.3 };
}

function heatGrid(temperature) {
  if (!heatCache[temperature]) {
    heatCache[temperature] = HEAT_KD_VALUES.map(kd => HEAT_PH_VALUES.map(pH => categoryOf(evaluateDesign(heatCellParams(pH, kd, temperature), true))));
  }
  return heatCache[temperature];
}

function heatLayout(W, H) {
  const left = 60, right = 10, top = 10, bottom = 40, plotW = W - left - right, plotH = H - top - bottom;
  return { left, top, plotW, plotH, cellW: plotW / HEAT_PH_VALUES.length, cellH: plotH / HEAT_KD_VALUES.length, rows: HEAT_KD_VALUES.length };
}

function drawHeatCells(ctx, grid, g, categories) {
  ctx.globalAlpha = 0.9;
  grid.forEach((row, j) => row.forEach((category, i) => {
    ctx.fillStyle = categories[category].color;
    ctx.fillRect(g.left + i * g.cellW + 0.5, g.top + (g.rows - 1 - j) * g.cellH + 0.5, g.cellW - 1, g.cellH - 1);
  }));
  ctx.globalAlpha = 1;
}

function drawHeatAxes(ctx, g) {
  ctx.font = "11px " + color("fontMono"); ctx.fillStyle = color("muted");
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  HEAT_PH_VALUES.forEach((pH, i) => { if (Math.abs(pH * 2 - Math.round(pH * 2)) < 1e-6) ctx.fillText(fmt(pH, 1), g.left + (i + 0.5) * g.cellW, g.top + g.plotH + 5); });
  ctx.fillText("pH del relave durante el ensayo", g.left + g.plotW / 2, g.top + g.plotH + 22);
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  HEAT_KD_VALUES.forEach((kd, j) => ctx.fillText(fmt(kd, 2), g.left - 6, g.top + (g.rows - 1 - j + 0.5) * g.cellH));
  ctx.save(); ctx.translate(12, g.top + g.plotH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("Mortalidad (d⁻¹)", 0, 0); ctx.restore();
}

function drawHeatAnnotations(ctx, g) {
  const xi = HEAT_PH_VALUES.findIndex(pH => pH >= 7.99 - 0.13), yj = HEAT_KD_VALUES.indexOf(0.5);
  const cx = g.left + (xi + 0.5) * g.cellW, cy = g.top + (g.rows - 1 - yj + 0.5) * g.cellH;
  ctx.strokeStyle = color("ink"); ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cy, Math.min(g.cellW, g.cellH) * 0.38, 0, 6.283); ctx.stroke();
  ctx.fillStyle = color("ink"); ctx.font = "600 11px " + color("fontBody"); ctx.textAlign = "right"; ctx.textBaseline = "bottom";
  ctx.fillText("Condición experimental", cx - 10, g.top + (g.rows - 1 - yj) * g.cellH - 2);

  const x45 = g.left + (HEAT_PH_VALUES.indexOf(4.5) + 1) * g.cellW;
  ctx.save(); ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x45, g.top); ctx.lineTo(x45, g.top + g.plotH); ctx.stroke(); ctx.restore();
  ctx.font = "11px " + color("fontMono"); ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText("← rango de crecimiento", g.left + 4, g.top + 4);
}

function renderHeatmap() {
  const canvas = $("heat"), W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

  const categories = heatCategories(), g = heatLayout(W, H);
  drawHeatCells(ctx, heatGrid(heatTemperature), g, categories);
  drawHeatAxes(ctx, g);
  drawHeatAnnotations(ctx, g);
  $("hleg").innerHTML = categories.map(c => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join("");
}

// ---------- Rango de pH (tabla y figura 39) ----------
const rangeColors = () => [color("petrol"), color("teal"), color("t0"), color("t1"), color("amber")];

function rangeResults(temperature) {
  if (!rangeCache[temperature]) {
    const base = scenarioParams({ tab: "real", overrides: {} }).params;
    rangeCache[temperature] = RANGE_PH_VALUES.map(pH => {
      const params = { ...base, phr: pH, phc1: pH, phc2: pH, T: temperature };
      return { pH, evaluation: evaluateDesign(params, false) };
    });
  }
  return rangeCache[temperature];
}

/** mL de H₂SO₄ 1 M por recipiente de 500 g para llevar el relave de 7,99 al pH indicado. */
const acidMlFor = (pH) => (7.99 - pH) * 50 * 0.5 / 2;

function rangeRowHTML(r) {
  const e = r.evaluation, [kind, text] = powerStatus(e.p21);
  return `<tr><td class="num">${fmt(r.pH, 1)}</td><td class="num">≈ ${fmt(acidMlFor(r.pH), 0)} mL</td><td class="num">${fmtSci(e.finalN)} /g</td>` +
    `<td class="num">${fmt(e.finalPHT2, 2)} (${fmt(last(e.curves.ph[1]), 2)})</td><td class="num">${fmtSigned(e.d21, 2)} pH · ${fmtSigned(e.c21, 0)} µS/cm</td>` +
    `<td class="num">${fmtPercent(e.p21)} ${chipHTML(kind, text)}</td><td>${chipHTML(e.objectives[3] ? "good" : "bad", e.objectives[3] ? "Movilidad baja" : "Movilidad alta")}</td></tr>`;
}

function renderRangeAnalysis() {
  const results = rangeResults(rangeTemperature), colors = rangeColors();
  drawChart($("c-rn"), { xmin: 0, xmax: 57.5, ymin: 4, ymax: 8, ystep: 1, log: true, marker: null, sday: null,
    series: results.map((r, i) => ({ x: r.evaluation.curves.t, y: r.evaluation.curves.N, color: colors[i] })) });
  drawChart($("c-rph"), { xmin: 0, xmax: 57.5, ymin: 1, ymax: 5, ystep: 1, dec: 0, marker: null, sday: null,
    series: results.map((r, i) => ({ x: r.evaluation.curves.t, y: r.evaluation.curves.ph[2], color: colors[i] })),
    hlines: [{ y: 1.3, label: "pH 1,3: límite inferior de la bacteria" }] });
  const legend = legendHTML(results.map((r, i) => ({ color: colors[i], label: `pH ${fmt(r.pH, 1)}` })));
  setHTML($("l-rn"), legend); setHTML($("l-rph"), legend);
  $("range-table").innerHTML = `<table class="data"><tr><th>pH inicial</th><th>H₂SO₄ 1 M por unidad</th><th>Población viable al día 56</th><th>pH final de T2 (T1)</th><th>Diferencia T2 − T1</th><th>Potencia</th><th>Cu y Zn</th></tr>` +
    results.map(rangeRowHTML).join("") + `</table>`;
}

// ---------- Vista completa ----------
function renderScenariosView() {
  renderScenarioTable();
  renderScenarioSummary();
  renderHeatmap();
  renderRangeAnalysis();
}

/** Muestra un estado de carga la primera vez (el cálculo tarda unos instantes). */
function showScenariosView() {
  if (scenarioResults) { renderScenariosView(); return; }
  $("sit-table").innerHTML = `<p class="loading" role="status">Calculando los siete escenarios…</p>`;
  setTimeout(renderScenariosView, 30);
}

function setPressed(selector, attr, value) {
  $$(selector).forEach(b => b.setAttribute("aria-pressed", String(+b.dataset[attr] === value)));
}