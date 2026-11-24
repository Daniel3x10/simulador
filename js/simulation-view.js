"use strict";
/* ==========================================================================
   simulation-view.js — Pestañas 1 y 2: recálculo de la simulación y
   presentación de indicadores, gráficas, estadística, metales,
   composición e interpretación.
   ========================================================================== */

const CHART_CANVASES = () => [$("c-ph"), $("c-ce"), $("c-n")];

// ---------- Cálculo ----------
/** Recalcula todo a partir de los controles y actualiza la vista. */
function recalc() {
  updateParamOutputs();
  const sim = computeSimulation(readParams());
  state.sim = sim;
  sim.final = summarizeFinalDay(sim);
  sim.stats = { ph: analyzeVariable(sim, "ph", 2), ce: analyzeVariable(sim, "ce", 0) };
  sim.design = evaluateDesign(sim.params, state.draft);
  sim.feasibility = checkFeasibility(sim.params, sim.design);

  renderKpis(sim);
  renderStatsTables(sim);
  renderMetalsTable(sim);
  renderComposition(sim);
  renderFeasibility(sim);
  drawSimulationCharts();
  markSelectedUnit();
  updateDayViews(true);
}

/** Recalcula como máximo una vez por cuadro (mientras se arrastran controles). */
let recalcQueued = false;
function scheduleRecalc() {
  if (recalcQueued) return;
  recalcQueued = true;
  requestAnimationFrame(() => { recalcQueued = false; recalc(); renderInterpretation(); });
}

function updateParamOutputs() {
  PARAM_IDS.forEach(id => setText($("o-" + id), PARAM_FORMAT[id](readNum(id))));
}

function summarizeFinalDay(sim) {
  const c = sim.curves, finalPH = [0, 1, 2].map(tr => last(c.ph[tr]));
  return { finalPH, finalN: last(c.N), lossDay: detectionLossDay(c), mobileMetals: highlyMobileMetals(finalPH[2]) };
}

// ---------- Estadística del día de muestreo ----------
function groupsAt(sim, key, dayIndex) {
  return [0, 1, 2].map(tr => sim.units.filter(u => treatmentOf(u) === tr).map(u => sim.measurements[u][dayIndex][key]));
}

const expectedAt = (sim, key, tr, day) => interpolate(sim.curves.t, sim.curves[key][tr], day);

function compareTreatments(sim, key, groups, anova, cmp) {
  const p = sim.params, day = state.samplingDay, nr = p.nr;
  const simulated = mean(groups[cmp.a]) - mean(groups[cmp.b]);
  const t = Math.abs(simulated) / Math.sqrt(anova.msWithin * 2 / nr);
  const ea = expectedAt(sim, key, cmp.a, day), eb = expectedAt(sim, key, cmp.b, day);
  const sd = key === "ph" ? p.sdph : p.cvce * (ea + eb) / 2;
  return { simulated, pValue: pValueT(t, anova.dfWithin), expected: ea - eb, power: designPower(ea - eb, sd, nr) };
}

/** ANOVA y comparaciones de una variable (pH o CE) en el día de muestreo elegido. */
function analyzeVariable(sim, key, decimals) {
  const groups = groupsAt(sim, key, SAMPLING_DAYS.indexOf(state.samplingDay));
  const anova = oneWayAnova(groups);
  const comparisons = {};
  COMPARISONS.forEach(cmp => comparisons[cmp.key] = compareTreatments(sim, key, groups, anova, cmp));
  return { groups, anova, lsd: leastSignificantDifference(anova, sim.params.nr), decimals, comparisons };
}

function setSamplingDay(day) {
  state.samplingDay = day;
  $$("[data-sday]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.sday === day)));
}

function buildSamplingDayButtons() {
  $("days").innerHTML = `<span>Día de muestreo</span><span class="segmented">` +
    SAMPLING_DAYS.map(d => `<button type="button" data-sday="${d}" aria-pressed="${d === state.samplingDay}">${d}</button>`).join("") + `</span>`;
  $$("[data-sday]").forEach(b => b.addEventListener("click", () => { setSamplingDay(+b.dataset.sday); recalc(); renderInterpretation(); }));
}

// ---------- Indicadores ----------
function kpiItems(sim) {
  const p = sim.params, f = sim.final, day = state.samplingDay;
  const ph10 = sim.stats.ph.comparisons["10"], ph21 = sim.stats.ph.comparisons["21"], ce21 = sim.stats.ce.comparisons["21"];
  const microbePower = Math.max(ph21.power, ce21.power), tailingsKg = 3 * p.nr * p.mrec / 1000;
  const items = [
    { label: "pH al día 56 (T0 · T1 · T2)", value: f.finalPH.map(x => fmt(x, 2)).join(" · "),
      status: f.finalPH[2] > GROWTH_PH_MAX ? ["bad", "Fuera del rango de crecimiento"] : ["good", "Dentro del rango de crecimiento"] },
    { label: "Población viable en T2", value: f.lossDay === null ? fmtSci(f.finalN) + " /g al día 56" : `< 10³ /g desde el día ${fmt(f.lossDay, 1)}`,
      status: f.finalN >= ACTIVE_POPULATION ? ["good", "Activa"] : f.finalN >= DETECTION_LIMIT ? ["warn", "Débil"] : ["bad", "No detectable"] },
    { label: `Efecto del microorganismo (T2 − T1), día ${day}`, value: `${fmtSigned(ph21.expected, 2)} pH · ${fmtSigned(ce21.expected, 0)} µS/cm`,
      status: powerStatus(microbePower), detail: `Potencia: ${fmtPercent(microbePower)}` },
    { label: `Efecto del compost (T1 − T0), día ${day}`, value: `${fmtSigned(ph10.expected, 2)} pH`,
      status: powerStatus(ph10.power), detail: `Potencia: ${fmtPercent(ph10.power)}` },
    { label: `Relave requerido (${3 * p.nr} unidades)`, value: fmt(tailingsKg, 1) + " kg",
      status: tailingsKg <= p.disp ? ["good", `Suficiente (${fmt(p.disp, 1)} kg disponibles)`] : ["bad", `Déficit de ${fmt(tailingsKg - p.disp, 1)} kg`] },
  ];
  items.push(state.tab === "funciona" ? acidKpi(sim) : metalsKpi(sim));
  return items;
}

function acidKpi(sim) {
  const p = sim.params;
  return { label: "Ácido por unidad experimental", value: `${fmt(p.acid * p.mrec / 1000 / 2, 1)} mL de H₂SO₄ 1 M`,
    status: p.acid > 0 ? ["warn", `pH inicial del relave ${fmt(sim.curves.phTailings0, 2)}`] : ["none", "Sin acondicionar"] };
}

function metalsKpi(sim) {
  const mobile = sim.final.mobileMetals;
  return { label: "Movilidad de metales en T2", value: mobile.length ? "Aumenta" : "Baja o estable",
    status: mobile.length ? ["bad", "Movilidad alta: " + mobile.join(", ")] : ["good", "Coherente con la hipótesis"] };
}

function renderKpis(sim) {
  $("kpis").innerHTML = kpiItems(sim).map(k =>
    `<div class="kpi"><span class="kpi-label">${k.label}</span><span class="kpi-value">${k.value}</span>` +
    (k.detail ? `<span class="kpi-label">${k.detail}</span>` : "") + chipHTML(k.status[0], k.status[1]) + `</div>`).join("");
}

// ---------- Tablas estadísticas ----------
function anovaRowHTML(name, a) {
  const significant = a.anova.p < 0.05;
  const means = a.groups.map(g => `<td class="num">${fmt(mean(g), a.decimals)} ± ${fmt(stdDev(g), a.decimals)}</td>`).join("");
  return `<tr><td>${name}</td>${means}<td class="num">F = ${fmt(a.anova.F, 2)} · p = ${fmtP(a.anova.p)} ` +
    chipHTML(significant ? "good" : "bad", significant ? "Significativo (p < 0,05)" : "No significativo") +
    `</td><td class="num">± ${fmt(a.lsd, a.decimals)}</td></tr>`;
}

function comparisonCellsHTML(c, decimals) {
  const [kind, text] = powerStatus(c.power);
  return `<td class="num">${fmtSigned(c.expected, decimals)}</td><td class="num">${fmtSigned(c.simulated, decimals)} (${fmtP(c.pValue)})</td>` +
    `<td class="num">${fmtPercent(c.power)} ${chipHTML(kind, text)}</td>`;
}

function renderStatsTables(sim) {
  const { ph, ce } = sim.stats, nr = sim.params.nr;
  const anovaTable = `<table class="data"><tr><th>Variable</th><th>T0 media ± DE</th><th>T1 media ± DE</th><th>T2 media ± DE</th><th>ANOVA</th><th>Diferencia mínima significativa</th></tr>` +
    anovaRowHTML("pH", ph) + anovaRowHTML("CE (µS/cm)", ce) + `</table>`;
  const comparisonTable = `<table class="data table-gap"><tr><th>Comparación</th><th>Efecto evaluado</th><th>pH: diferencia esperada</th><th>pH: diferencia simulada (p)</th><th>pH: potencia</th><th>CE: diferencia esperada</th><th>CE: diferencia simulada (p)</th><th>CE: potencia</th></tr>` +
    COMPARISONS.map(cmp => `<tr><td>T${cmp.a} vs T${cmp.b}</td><td>${cmp.label}</td>${comparisonCellsHTML(ph.comparisons[cmp.key], 2)}${comparisonCellsHTML(ce.comparisons[cmp.key], 0)}</tr>`).join("") + `</table>`;
  const note = `<p class="note table-note">Diferencia esperada: valor del modelo. Diferencia simulada: valor obtenido con la realización aleatoria actual de las réplicas y su valor p (diferencia mínima significativa de Fisher, α = 0,05, ${3 * nr - 3} grados de libertad). Potencia: probabilidad de rechazar la hipótesis nula con ${nr} réplicas, estimada con 3 000 repeticiones del experimento${state.draft ? " (valor aproximado mientras se ajusta el control)" : ""}.</p>`;
  $("stats").innerHTML = anovaTable + comparisonTable + note;
}

// ---------- Metales ----------
function renderMetalsTable(sim) {
  const { finalPH, mobileMetals } = sim.final;
  const rows = finalPH.map((ph, tr) => {
    const m = metalMobility(ph);
    return `<tr><td>T${tr}</td><td class="num">${fmt(ph, 2)}</td>${["Fe", "As", "Cu", "Zn"].map(k => `<td>${chipHTML(m[k][0], m[k][1])}</td>`).join("")}</tr>`;
  }).join("");
  const note = mobileMetals.length
    ? `Al pH final de T2 (${fmt(finalPH[2], 2)}) se esperaría movilidad alta de ${mobileMetals.join(" y ")}. A pH 7,99 estos metales precipitan; el acondicionamiento ácido contradice el objetivo de reducir su movilidad.`
    : "Ningún metal pasa a movilidad alta, lo que es coherente con la hipótesis.";
  $("metals").innerHTML = `<table class="data"><tr><th>Tratamiento</th><th>pH final</th><th>Fe</th><th>As</th><th>Cu</th><th>Zn</th></tr>${rows}</table><p class="note table-note">${note}</p>`;
}

// ---------- Composición y factibilidad ----------
function compositionRowHTML(u) {
  const compost = u.compost ? fmt(u.compost, 0) + (u.tr === 2 ? " inoculado" : "") : "—";
  const liquid = u.liquid ? fmt(u.liquid, 1) + " " + u.liquidName : (u.tr === 2 ? "—" : "0");
  return `<tr><td><span class="tag t${u.tr}"></span>T${u.tr} × 3</td><td class="num">${Math.round(u.tailings)}</td><td class="num">${compost}</td><td class="num">${liquid}</td><td class="num">${fmt(u.total, 0)}</td></tr>`;
}

function renderComposition(sim) {
  const p = sim.params, F = sim.feasibility;
  $("comp-table").innerHTML = `<table class="data"><tr><th>Unidad experimental</th><th>Relave (g)</th><th>Compost (g)</th><th>Líquido (mL)</th><th>Total (g)</th></tr>` +
    F.units.map(compositionRowHTML).join("") + `</table>` +
    `<p class="note table-note">Compost : relave = 1 : ${fmt(100 / p.comp, 1)} en T1 y T2. Para las 9 muestras: ${fmt(F.tailingsKg, 2)} kg de relave, ${fmt(F.compostKg * 1000, 0)} g de compost (${fmt(F.compostKg * 500, 0)} g inoculado para T2) y ${fmt(F.compostKg / 2 * p.dose, 0)} mL de cultivo.</p>`;
}

function checkResultHTML(check) {
  if (check.ok) return chipHTML("good", "Sí");
  return check.warnOnly ? chipHTML("warn", "Advertencia") : chipHTML("bad", "No");
}

function feasibilityVerdict(sim) {
  const o = sim.design.objectives;
  const pending = !o[1] ? "el microorganismo no es viable" : !o[2] ? "el efecto del microorganismo no es demostrable" : !o[3] ? "aumenta la movilidad del Cu y del Zn" : "";
  if (!sim.feasibility.feasible) return ["bad", "Diseño no factible con estas proporciones"];
  if (pending) return ["warn", "Diseño factible para demostrar el efecto del compost; sin embargo, " + pending];
  return ["good", "Diseño factible: se cumplen todos los objetivos"];
}

function renderFeasibility(sim) {
  const [kind, text] = feasibilityVerdict(sim);
  $("feas").innerHTML = `<table class="data table-gap"><tr><th>Criterio</th><th>Cumple</th><th>Detalle</th></tr>` +
    sim.feasibility.checks.map(c => `<tr><td>${c.label}</td><td>${checkResultHTML(c)}</td><td class="num wrap-text">${c.detail}</td></tr>`).join("") +
    `</table><p class="table-note"><span class="chip ${kind}" style="white-space:normal">${text}</span></p>`;
}

// ---------- Gráficas ----------
const replicateJitter = (unit, replicates) => (replicateOf(unit) - (replicates + 1) / 2) * (10 / replicates);

function replicatePoints(sim, key, units) {
  const colors = treatmentColors(), sel = state.selectedUnit;
  return units.flatMap(u => sim.measurements[u].map(m => ({
    x: m.day, y: m[key], color: colors[treatmentOf(u)], jitter: replicateJitter(u, sim.params.nr),
    big: sel === u, dim: sel && sel !== u, hollow: key === "n" && m.n < DETECTION_LIMIT,
  })));
}

function drawPHChart(sim, colors) {
  const values = sim.units.flatMap(u => sim.measurements[u].map(m => m.ph)).concat(sim.curves.ph.flat());
  const r = niceRange(values, 0.08, [0.1, 0.2, 0.5, 1]);
  drawChart($("c-ph"), { xmin: 0, xmax: 57.5, ymin: r.min, ymax: r.max, ystep: r.step, dec: r.step < 1 ? 1 : 0,
    marker: state.day, sday: state.samplingDay,
    series: [0, 1, 2].map(tr => ({ x: sim.curves.t, y: sim.curves.ph[tr], color: colors[tr] })),
    points: replicatePoints(sim, "ph", sim.units),
    hlines: r.min < GROWTH_PH_MAX && r.max > GROWTH_PH_MAX ? [{ y: GROWTH_PH_MAX, label: "pH 4,5: límite de la bacteria" }] : [] });
}

function drawCEChart(sim, colors) {
  const values = sim.units.flatMap(u => sim.measurements[u].map(m => m.ce)).concat(sim.curves.ce.flat());
  const r = niceRange(values, 60, [100, 200, 500, 1000]);
  drawChart($("c-ce"), { xmin: 0, xmax: 57.5, ymin: r.min, ymax: r.max, ystep: r.step,
    marker: state.day, sday: state.samplingDay,
    series: [0, 1, 2].map(tr => ({ x: sim.curves.t, y: sim.curves.ce[tr], color: colors[tr] })),
    points: replicatePoints(sim, "ce", sim.units) });
}

function drawPopulationChart(sim, colors) {
  const t2Units = sim.units.filter(u => treatmentOf(u) === 2);
  drawChart($("c-n"), { xmin: 0, xmax: 57.5, ymin: -1, ymax: 9, ystep: 1, log: true,
    marker: state.day, sday: state.samplingDay,
    series: [{ x: sim.curves.t, y: sim.curves.N, color: colors[2] }],
    points: replicatePoints(sim, "n", t2Units),
    hlines: [{ y: ACTIVE_POPULATION, label: "10⁵ activa" }, { y: DETECTION_LIMIT, label: "10³ límite de detección" }] });
}

function updateChartLegends(colors) {
  const treatments = legendHTML([0, 1, 2].map(tr => ({ color: colors[tr], label: `T${tr} (valor esperado)` })).concat([{ color: color("muted"), label: "Réplicas simuladas", dot: true }]));
  setHTML($("l-ph"), treatments);
  setHTML($("l-ce"), treatments);
  setHTML($("l-n"), legendHTML([{ color: colors[2], label: "T2 (modelo 2)" }, { color: colors[2], label: "Réplicas simuladas (punto hueco: no detectable)", dot: true }]));
}

function drawSimulationCharts() {
  const sim = state.sim;
  if (!sim || state.tab === "situaciones") return;
  const colors = treatmentColors();
  drawPHChart(sim, colors);
  drawCEChart(sim, colors);
  drawPopulationChart(sim, colors);
  updateChartLegends(colors);
}

// ---------- Interpretación ----------
function populationText(sim) {
  const p = sim.params, c = sim.curves, f = sim.final;
  const outcome = f.lossDay === null
    ? `Con la mezcla a pH ${fmt(c.ph[2][0], 2)} y ${fmt(p.T, 0)} °C, el microorganismo permanece activo y alcanza ${fmtSci(f.finalN)} células/g al día 56.`
    : `Con la mezcla a pH ${fmt(c.ph[2][0], 2)}, fuera de su rango de crecimiento, la población desciende por debajo del límite de detección (10³ células/g) el día ${fmt(f.lossDay, 1)}.`;
  return `<p><b>Población viable.</b> El inóculo aporta ${fmtSci(c.initialPerGram)} células/g de compost. Tras 7 días de adaptación a pH ${fmt(p.phc2, 2)} y la dilución en el relave, la población inicial de T2 es de ${fmtSci(c.initialMixed)} células/g. ${outcome}</p>`;
}

function microbeEffectText(sim) {
  const ph21 = sim.stats.ph.comparisons["21"], ce21 = sim.stats.ce.comparisons["21"], best = Math.max(ph21.power, ce21.power);
  const cause = sim.final.lossDay === null && sim.params.alpha > 0
    ? "La diferencia se atribuye a la actividad bacteriana, que oxida el hierro y los sulfuros del relave con producción de ácido y liberación de sulfato."
    : "Esta diferencia proviene del menor pH y del mayor contenido de sales del compost inoculado, y no de la actividad bacteriana.";
  return `<p><b>Efecto del microorganismo (T2 − T1), día ${state.samplingDay}.</b> La diferencia esperada es de ${fmtSigned(ph21.expected, 2)} unidades de pH y ${fmtSigned(ce21.expected, 0)} µS/cm, con una potencia estadística de ${fmtPercent(best)} para ${sim.params.nr} réplicas. ${cause}</p>`;
}

function compostEffectText(sim) {
  const ph10 = sim.stats.ph.comparisons["10"];
  return `<p><b>Efecto del compost (T1 − T0).</b> La diferencia esperada es de ${fmtSigned(ph10.expected, 2)} unidades de pH, con una potencia de ${fmtPercent(ph10.power)} para una desviación entre réplicas de ± ${fmt(sim.params.sdph, 2)}.</p>`;
}

function metalsText(sim) {
  const mobile = sim.final.mobileMetals;
  return mobile.length
    ? `<p><b>Movilidad de los metales.</b> Al pH final de T2 se esperaría una movilidad alta de ${mobile.join(" y ")}, contraria al objetivo de la investigación.</p>`
    : `<p><b>Movilidad de los metales.</b> Al pH final no se esperan metales con movilidad alta.</p>`;
}

function selectedUnitText(sim, unit) {
  const m = sim.measurements[unit][SAMPLING_DAYS.indexOf(state.samplingDay)];
  const population = treatmentOf(unit) === 2 ? `; población viable ${m.n < DETECTION_LIMIT ? "no detectable" : fmtSci(m.n) + " células/g"}` : "";
  return `<p><b>Unidad ${unit}</b> (posición ${state.benchOrder.indexOf(unit) + 1}): pH ${fmt(m.ph, 2)} y ${Math.round(m.ce)} µS/cm el día ${state.samplingDay}${population}.</p>`;
}

/** Recuadro de interpretación. Si se indica un motivo, se muestra primero y el recuadro destella. */
function renderInterpretation(reason) {
  const sim = state.sim;
  if (!sim) return;
  const parts = [
    reason ? `<p><b>${reason}</b></p>` : "",
    populationText(sim), microbeEffectText(sim), compostEffectText(sim),
    state.tab === "funciona" ? metalsText(sim) : "",
    state.selectedUnit ? selectedUnitText(sim, state.selectedUnit) : "",
  ];
  const box = $("xbox");
  box.querySelector(".xb").innerHTML = parts.join("");
  if (reason) flash(box);
}