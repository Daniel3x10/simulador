"use strict";
/* ==========================================================================
   config.js — Constantes del experimento, de los parámetros de la interfaz
   y de los escenarios evaluados. Solo datos, sin lógica.
   ========================================================================== */

// ---------- Diseño experimental (tablas 18 a 20) ----------
const INCUBATION_DAYS = 56;
const SAMPLING_DAYS = [0, 7, 14, 28, 42, 56];
const BENCH_LAYOUT_T19 = ["T1R2", "T0R1", "T2R3", "T2R1", "T1R1", "T0R3", "T0R2", "T2R2", "T1R3"];
const TREATMENT_NAMES = ["T0 · Relave sin tratamiento", "T1 · Compost sin inocular", "T2 · Compost inoculado"];
const COMPARISONS = [
  { key: "10", a: 1, b: 0, label: "Compost" },
  { key: "20", a: 2, b: 0, label: "Compost inoculado" },
  { key: "21", a: 2, b: 1, label: "Microorganismo" },
];

// ---------- Umbrales de los criterios ----------
const POWER_TARGET = 0.8;           // potencia mínima para considerar un efecto demostrable
const ACTIVE_POPULATION = 1e5;      // células/g: población activa
const DETECTION_LIMIT = 1e3;        // células/g: límite de detección
const GROWTH_PH_MAX = 4.5;          // pH máximo de crecimiento de la bacteria

// ---------- Masa de muestra por recipiente (g) ----------
// pH/CE 6 × 10 g + SPLP 50 g (+ viabilidad 5 × 10 g en T2)
const SAMPLE_MASS_NEEDED = [110, 110, 160];

// ---------- Parámetros de la interfaz: id del control → formato de su valor ----------
const PARAM_FORMAT = {
  acid:  v => Math.round(v) + " mmol H⁺/kg",
  beta:  v => Math.round(v) + " mmol/kg por pH",
  phr:   v => fmt(v, 2),
  cer:   v => Math.round(v) + " µS/cm",
  comp:  v => v + " % (1 : " + fmt(100 / v, 1) + ")",
  compd: v => fmt(v, 1) + " kg",
  phc1:  v => fmt(v, 2),
  phc2:  v => fmt(v, 2),
  cec1:  v => fmt(v, 1) + " mS/cm",
  cec2:  v => fmt(v, 1) + " mS/cm",
  dose:  v => v + " mL/kg",
  xc:    v => fmtSci(10 ** v) + " /mL",
  kd:    v => fmt(v, 2) + " d⁻¹",
  tt:    v => fmt(v, 1) + " °C",
  alpha: v => fmt(v, 3) + " pH/d",
  eps:   v => Math.round(v) + " µS/cm/d",
  nrep:  () => "3 (9 muestras)",
  mrec:  v => v + " g",
  disp:  v => fmt(v, 1) + " kg",
  sdph:  v => "± " + fmt(v, 2),
  cvce:  v => fmt(v, 1) + " %",
  sdn:   v => "± " + fmt(v, 2) + " log",
};
const PARAM_IDS = Object.keys(PARAM_FORMAT);

// Cambios del escenario con acondicionamiento ácido respecto a los valores del HTML.
const ACID_TAB_OVERRIDES = { phc1: "4", phc2: "4", tt: "28" };

// ---------- Escenarios de la tabla 38 ----------
const SCENARIOS = [
  { name: "Diseño experimental", tab: "real", overrides: {},
    description: "pH medido de 7,99; 10 % de compost; tres réplicas de 500 g; 20 °C; desviación entre réplicas de ± 0,05 unidades de pH." },
  { name: "Dispersión observada en la medición inicial", tab: "real", overrides: { sdph: "0.56" },
    description: "Diseño experimental con una desviación entre réplicas de ± 0,56 unidades de pH (tabla 23)." },
  { name: "Cepa de mayor resistencia", tab: "real", overrides: { kd: "0.05" },
    description: "Tasa de mortalidad a pH neutro diez veces menor (0,05 d⁻¹ en lugar de 0,50 d⁻¹)." },
  { name: "Dosis de compost de 20 %", tab: "real", overrides: { comp: "20" },
    description: "100 g de compost por cada 500 g de relave, con las nueve unidades experimentales." },
  { name: "Acondicionamiento a pH 6,0", tab: "funciona", overrides: { acid: "100", phc1: "6", phc2: "6" },
    description: "Tres tratamientos y compost acondicionados a pH 6,0; incubación a 28 °C." },
  { name: "Acondicionamiento ácido mínimo", tab: "funciona", overrides: {}, useMinimumAcid: true,
    description: "Dosis mínima de ácido calculada en el escenario 2 (relave a pH ≈ 4,5), compost a pH 4,0 e incubación a 28 °C." },
  { name: "Acondicionamiento mínimo con mayor homogeneidad", tab: "funciona", overrides: { sdph: "0.03" }, useMinimumAcid: true,
    description: "Escenario anterior con una desviación entre réplicas de ± 0,03 unidades de pH." },
];

// ---------- Mapa de la figura 38 y rango de la figura 39 ----------
const HEAT_PH_VALUES = Array.from({ length: 21 }, (_, i) => +(3.5 + i * 0.25).toFixed(2)); // 3,5 … 8,5
const HEAT_KD_VALUES = [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5];
const RANGE_PH_VALUES = [2.5, 3, 3.5, 4, 4.5];

// ---------- Búsqueda de proporciones ----------
const PROPORTION_GRID = { compost: [5, 10, 15, 20, 25, 30, 40, 50, 75, 100], dose: [50, 100, 150, 200] };