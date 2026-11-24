"use strict";
/* ==========================================================================
   main.js — Punto de entrada: navegación entre pestañas, eventos de la
   interfaz, bucle de animación e inicialización.
   ========================================================================== */

let lastFrameTime = performance.now();
let lastRenderedDay = -1;
let pendingFinalUpdate = false;

// ---------- Pestañas ----------
const TABS = ["real", "funciona", "situaciones"];

function updateTabNavigation(tab) {
  $$(".tabs a").forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function showTab(requested) {
  const tab = TABS.includes(requested) ? requested : "real";
  if (state.tab !== tab && state.sim && state.tab !== "situaciones") saveCurrentTab();
  updateTabNavigation(tab);
  $("v-sim").hidden = tab === "situaciones";
  $("v-sit").hidden = tab !== "situaciones";
  state.tab = tab;
  if (tab === "situaciones") showScenariosView();
  else showSimulationView(tab);
}

function showSimulationView(tab) {
  restoreTabValues(tab);
  $("acid-group").hidden = tab !== "funciona";
  $("banner-real").hidden = tab !== "real";
  $("banner-funciona").hidden = tab !== "funciona";
  resetBenchCells();
  state.day = 0; $("day").value = 0; lastRenderedDay = -1;
  buildBench();
  recalc();
  renderInterpretation(tab === "real"
    ? "Escenario experimental: condiciones de la metodología (tabla 18)."
    : "Escenario con acondicionamiento ácido: dosis mínima calculada.");
}

/** Recupera los valores guardados de la pestaña; la primera vez calcula el ácido mínimo. */
function restoreTabValues(tab) {
  if (tabValues[tab]) { applyValues(tabValues[tab]); return; }
  applyValues(TAB_DEFAULTS[tab]);
  setMinimumAcid();
  saveCurrentTab();
}

function setMinimumAcid() {
  const acid = findMinimumAcid(readParams());
  $("acid").value = acid === null ? 0 : acid;
  return acid;
}

// ---------- Acciones de los botones ----------
/** Ejecuta una tarea pesada mostrando el botón como ocupado. */
function runBusy(button, label, task) {
  const original = button.textContent;
  button.disabled = true; button.setAttribute("aria-busy", "true"); button.textContent = label;
  setTimeout(() => {
    try { task(); }
    finally { button.disabled = false; button.removeAttribute("aria-busy"); button.textContent = original; }
  }, 30);
}

function onFindMinimumAcid() {
  const acid = findMinimumAcid(readParams());
  if (acid === null) {
    renderInterpretation("No se identificó una condición que cumpla los criterios: con los parámetros actuales, ni con 400 mmol H⁺/kg el microorganismo permanece activo con efecto demostrable. Puede evaluarse una mayor temperatura de incubación o una mayor acidificación biológica.");
    return;
  }
  $("acid").value = acid;
  state.draft = false; recalc();
  renderInterpretation(`Acondicionamiento mínimo: ${acid} mmol H⁺/kg de relave (≈ ${fmt(acid * readNum("mrec") / 1000 / 2, 1)} mL de H₂SO₄ 1 M por unidad experimental).`);
}

function proportionMessage(q) {
  const e = state.sim.design;
  let msg = `Proporción óptima: compost : relave = 1 : ${fmt(100 / q.comp, 1)} (${q.comp} %), ${q.dose} mL/kg de cultivo y ${q.mrec} g de relave por unidad experimental` +
    (state.tab === "funciona" ? `, con ${Math.round(q.acid)} mmol H⁺/kg de ácido` : "") + ".";
  if (state.tab === "real") {
    if (!e.objectives[1]) {
      const phMax = simulate({ ...readParams(), comp: 100 }).ph[2][0];
      msg += ` Con el relave a pH ${fmt(readNum("phr"), 2)}, ninguna proporción permite la viabilidad del microorganismo: incluso con una relación 1 : 1, la mezcla alcanza pH ${fmt(phMax, 2)}, fuera de su rango de crecimiento (≤ 4,5).`;
    }
    return msg;
  }
  const acidAt1to1 = findMinimumAcidFast({ ...readParams(), comp: 100 });
  if (!e.objectives[3]) msg += " El microorganismo permanece activo, pero a ese pH aumenta la movilidad del Cu y del Zn.";
  if (acidAt1to1 !== null && acidAt1to1 < q.acid) msg += ` Una mayor proporción de compost acidificado reduce el ácido requerido: con una relación 1 : 1 serían suficientes ${Math.round(acidAt1to1)} mmol H⁺/kg, aunque se requerirían ${fmt(6 * q.mrec / 1000, 1)} kg de compost.`;
  return msg;
}

function onOptimizeProportions() {
  const best = findBestProportion(readParams(), state.tab);
  if (!best) {
    renderInterpretation("No se identificó una proporción factible: el relave y el compost disponibles no son suficientes para las nueve unidades experimentales. Debe aumentarse el material disponible o reducirse la masa por unidad.");
    return;
  }
  const q = best.q;
  $("comp").value = q.comp; $("dose").value = q.dose; $("mrec").value = q.mrec;
  if (state.tab === "funciona") $("acid").value = q.acid;
  state.draft = false; recalc();
  renderInterpretation(proportionMessage(q));
}

function onReset() {
  applyValues(TAB_DEFAULTS[state.tab]);
  if (state.tab === "funciona") setMinimumAcid();
  resetBenchCells(); buildBench();
  state.draft = false; recalc();
  renderInterpretation("Parámetros restablecidos a los valores del escenario.");
}

function onApplyObservedDispersion() {
  $("sdph").value = 0.56;
  state.draft = false; recalc();
  renderInterpretation("Se aplicó la desviación observada en la medición inicial del relave (DE = 0,56).");
}

function onNewRealization() {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
  drawReplicateNoise(); recalc();
  renderInterpretation("Se generó una nueva realización aleatoria de las réplicas.");
}

/** Copia las mediciones simuladas en el formato de la hoja de registro. */
function simulatedDataRows() {
  const rows = ["Dia\tCodigo\tTratamiento\tpH\tCE_uS_cm\tBacteria_celulas_g"];
  SAMPLING_DAYS.forEach((day, i) => state.sim.units.forEach(u => {
    const m = state.sim.measurements[u][i];
    const bacteria = treatmentOf(u) === 2 ? (m.n < DETECTION_LIMIT ? "<1E+03" : m.n.toExponential(2)) : "";
    rows.push([day, u, "T" + u[1], m.ph.toFixed(2), Math.round(m.ce), bacteria].join("\t"));
  }));
  return rows.join("\n");
}

async function onCopyData() {
  const toast = $("toast");
  try {
    await navigator.clipboard.writeText(simulatedDataRows());
    toast.textContent = "Datos copiados al portapapeles; pueden pegarse en la hoja pH_CE del registro.";
  } catch (e) {
    toast.textContent = "No se pudo copiar en este navegador.";
  }
  setTimeout(() => toast.textContent = "", 4000);
}

// ---------- Enlace de eventos ----------
function bindParameterInputs() {
  $$(".controls input[type=range]").forEach(input => {
    input.addEventListener("input", () => { state.draft = true; scheduleRecalc(); });   // arrastrando: cálculo rápido
    input.addEventListener("change", () => { state.draft = false; scheduleRecalc(); }); // al soltar: cálculo exacto
  });
}

function bindActionButtons() {
  $("find").addEventListener("click", e => runBusy(e.currentTarget, "Calculando…", onFindMinimumAcid));
  $("findprop").addEventListener("click", e => runBusy(e.currentTarget, "Optimizando…", onOptimizeProportions));
  $("reset").addEventListener("click", onReset);
  $("disp56").addEventListener("click", onApplyObservedDispersion);
  $("reroll").addEventListener("click", onNewRealization);
  $("csv").addEventListener("click", onCopyData);
}

function bindTimelineControls() {
  $("day").addEventListener("input", e => { state.day = parseFloat(e.target.value); setPlaying(false); });
  $("play").addEventListener("click", () => {
    if (!state.playing && state.day >= INCUBATION_DAYS) state.day = 0;
    setPlaying(!state.playing);
  });
  $("prevd").addEventListener("click", () => {
    const previous = [...SAMPLING_DAYS].reverse().find(d => d < state.day - 0.01);
    jumpToDay(previous === undefined ? 0 : previous);
  });
  $("nextd").addEventListener("click", () => {
    const next = SAMPLING_DAYS.find(d => d > state.day + 0.01);
    jumpToDay(next === undefined ? INCUBATION_DAYS : next);
  });
  $("speed").addEventListener("change", e => { state.durationSec = +e.target.value; });
}

function bindScenarioControls() {
  $$("[data-ht]").forEach(b => b.addEventListener("click", () => {
    heatTemperature = +b.dataset.ht; setPressed("[data-ht]", "ht", heatTemperature); renderHeatmap();
  }));
  $$("[data-rt]").forEach(b => b.addEventListener("click", () => {
    rangeTemperature = +b.dataset.rt; setPressed("[data-rt]", "rt", rangeTemperature); renderRangeAnalysis();
  }));
}

/** Redibuja lo visible (tras cambiar el tamaño de la ventana o cargar las fuentes). */
function redrawVisible() {
  if (state.tab === "situaciones") { renderHeatmap(); renderRangeAnalysis(); return; }
  drawSimulationCharts();
  updateDayViews(true);
}

function bindGlobalEvents() {
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

  let resizeQueued = false;
  window.addEventListener("resize", () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; redrawVisible(); });
  });

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { loadTheme(); redrawVisible(); });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(entries => { benchVisible = entries[0].isIntersecting; }).observe($("bench"));
  }
}

// ---------- Bucle de animación ----------
function advancePlayback(dt) {
  if (!state.playing) return;
  state.day += dt * INCUBATION_DAYS / state.durationSec;
  if (state.day > INCUBATION_DAYS) { state.day = INCUBATION_DAYS; setPlaying(false); }
  $("day").value = state.day;
}

/** Actualiza la vista solo si cambió el día; al detenerse, hace una última actualización completa. */
function refreshDayIfChanged() {
  if (state.day !== lastRenderedDay) {
    lastRenderedDay = state.day;
    setText($("o-day"), "Día " + fmt(state.day, 1));
    updateDayViews(false);
    pendingFinalUpdate = true;
  } else if (pendingFinalUpdate) {
    updateDayViews(true);
    pendingFinalUpdate = false;
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  if (state.tab !== "situaciones" && state.sim) {
    advancePlayback(dt);
    refreshDayIfChanged();
    stepBench(dt, now / 1000);
  }
  requestAnimationFrame(frame);
}

// ---------- Inicio ----------
function init() {
  loadTheme();
  captureDefaults();
  drawReplicateNoise();
  buildSamplingDayButtons();
  buildMilestones();
  buildLiveCards();
  bindParameterInputs();
  bindActionButtons();
  bindTimelineControls();
  bindScenarioControls();
  bindGlobalEvents();
  if (REDUCED_MOTION) setPlaying(false);
  showTab(location.hash.slice(1) || "real");
  requestAnimationFrame(frame);
}

init();