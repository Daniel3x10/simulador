"use strict";
/* ==========================================================================
   state.js — Estado de la aplicación, colores del tema, lectura de los
   parámetros de la interfaz y cálculo de la simulación con réplicas.
   ========================================================================== */

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Estado único de la aplicación. */
const state = {
  tab: "real",              // "real" | "funciona" | "situaciones"
  sim: null,                // resultado del último cálculo
  day: 0,                   // día mostrado en la línea de tiempo
  playing: !REDUCED_MOTION,
  durationSec: 20,          // duración de la reproducción completa
  samplingDay: 56,          // día usado en el análisis estadístico
  selectedUnit: null,       // unidad resaltada en la mesa
  draft: false,             // true mientras se arrastra un control
  seed: 20261117,           // semilla de las réplicas
  noise: {},                // desviaciones aleatorias de cada unidad
  benchOrder: [],           // orden de las unidades en la mesa
};

// ---------- Colores del tema (se leen una vez desde las variables CSS) ----------
const THEME = {};
const THEME_VARS = {
  ink: "--ink", muted: "--muted", line: "--line", surface: "--surface",
  t0: "--t0", t1: "--t1", t2: "--t2",
  petrol: "--petrol", teal: "--teal", amber: "--amber", rust: "--rust", brown: "--brown",
  slate: "--slate", bacteria: "--bacteria", night: "--night",
  fontMono: "--font-mono", fontBody: "--font-body",
};
function loadTheme() {
  const styles = getComputedStyle(document.documentElement);
  Object.entries(THEME_VARS).forEach(([name, cssVar]) => THEME[name] = styles.getPropertyValue(cssVar).trim());
}
const color = (name) => THEME[name];
const treatmentColors = () => [color("t0"), color("t1"), color("t2")];

// ---------- Valores de los parámetros por pestaña ----------
const TAB_DEFAULTS = {};
const tabValues = {};

/** Guarda los valores iniciales del HTML como valores por defecto. */
function captureDefaults() {
  const htmlValues = currentValues();
  TAB_DEFAULTS.real = { ...htmlValues };
  TAB_DEFAULTS.funciona = { ...htmlValues, ...ACID_TAB_OVERRIDES };
  tabValues.real = { ...TAB_DEFAULTS.real };
  tabValues.funciona = null; // se calcula la primera vez que se abre
}

const readNum = (id) => parseFloat($(id).value);

function currentValues() {
  const values = {};
  PARAM_IDS.forEach(id => values[id] = $(id).value);
  return values;
}

function applyValues(values) {
  PARAM_IDS.forEach(id => $(id).value = values[id]);
}

function saveCurrentTab() {
  tabValues[state.tab] = currentValues();
}

/** Convierte los valores de la interfaz (texto) en parámetros del modelo. */
function toModelParams(v, tab) {
  return {
    acid: tab === "real" ? 0 : +v.acid, beta: +v.beta,
    phr: +v.phr, cer: +v.cer,
    comp: +v.comp, phc1: +v.phc1, phc2: +v.phc2, cec1: +v.cec1, cec2: +v.cec2,
    dose: +v.dose, Xc: 10 ** +v.xc, kd: +v.kd, T: +v.tt, alpha: +v.alpha, eps: +v.eps,
    nr: Math.round(+v.nrep), mrec: +v.mrec, disp: +v.disp, compd: +v.compd,
    sdph: +v.sdph, cvce: +v.cvce / 100, sdn: +v.sdn,
  };
}

const readParams = () => toModelParams(currentValues(), state.tab);

// ---------- Unidades experimentales ----------
const treatmentOf = (unit) => +unit[1];
const replicateOf = (unit) => +unit.slice(3);

function unitCodes(replicates) {
  const codes = [];
  for (let tr = 0; tr < 3; tr++) for (let r = 1; r <= replicates; r++) codes.push(`T${tr}R${r}`);
  return codes;
}

/** Orden de la tabla 19 para tres réplicas; aleatorio reproducible en otro caso. */
function benchOrderFor(replicates) {
  if (replicates === 3) return BENCH_LAYOUT_T19.slice();
  const codes = unitCodes(replicates), rand = mulberry32(777 + replicates);
  for (let i = codes.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [codes[i], codes[j]] = [codes[j], codes[i]]; }
  return codes;
}

// ---------- Réplicas aleatorias ----------
/** Genera las desviaciones de cada unidad (componente fijo + una por día de muestreo). */
function drawReplicateNoise() {
  const normal = gaussian(mulberry32(state.seed));
  state.noise = {};
  for (let tr = 0; tr < 3; tr++) {
    for (let r = 1; r <= 6; r++) {
      state.noise[`T${tr}R${r}`] = { ph: normal(), ce: normal(), n: normal(), days: SAMPLING_DAYS.map(() => ({ ph: normal(), ce: normal(), n: normal() })) };
    }
  }
}

const mixNoise = (unitPart, dayPart) => 0.8 * unitPart + 0.6 * dayPart;

/** Mediciones simuladas de una unidad en cada día de muestreo. */
function measureUnit(unit, curves, p) {
  const tr = treatmentOf(unit), z = state.noise[unit];
  return SAMPLING_DAYS.map((day, i) => {
    const zd = z.days[i];
    const logN = Math.log10(Math.max(interpolate(curves.t, curves.N, day), 1e-30));
    return {
      day,
      ph: interpolate(curves.t, curves.ph[tr], day) + p.sdph * mixNoise(z.ph, zd.ph),
      ce: interpolate(curves.t, curves.ce[tr], day) * (1 + p.cvce * mixNoise(z.ce, zd.ce)),
      n: tr === 2 ? 10 ** (logN + p.sdn * mixNoise(z.n, zd.n)) : null,
    };
  });
}

/** Simulación completa: curvas esperadas + mediciones de cada unidad. */
function computeSimulation(p) {
  const curves = simulate(p), units = unitCodes(p.nr), measurements = {};
  units.forEach(u => measurements[u] = measureUnit(u, curves, p));
  return { params: p, curves, units, measurements };
}

/** Valores continuos de una unidad en cualquier día (para la animación y las etiquetas). */
function unitStateAt(unit, day) {
  const { params: p, curves: c } = state.sim, tr = treatmentOf(unit), z = state.noise[unit];
  return {
    ph: interpolate(c.t, c.ph[tr], day) + p.sdph * 0.8 * z.ph,
    ce: interpolate(c.t, c.ce[tr], day) * (1 + p.cvce * 0.8 * z.ce),
    n: interpolate(c.t, c.N, day) * 10 ** (p.sdn * 0.8 * z.n),
  };
}