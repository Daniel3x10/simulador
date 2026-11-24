"use strict";
/* ==========================================================================
   evaluation.js — Evaluación del diseño frente a los objetivos de la
   hipótesis, factibilidad material y búsquedas automáticas
   (ácido mínimo y mejor proporción). Sin acceso al DOM.
   ========================================================================== */

/** Potencia según el modo: aproximada mientras se arrastra un control, Monte Carlo en reposo. */
const designPower = (diff, sd, replicates) => state.draft ? powerApprox(diff, sd, replicates) : powerMonteCarlo(diff, sd, replicates);

// ---------- Objetivos de la hipótesis ----------
/**
 * Evalúa los cinco objetivos al día 56.
 * objectives = [compost, viabilidad, microorganismo, metales, material]
 */
function evaluateDesign(p, fast) {
  const curves = simulate(p), power = fast ? powerApprox : powerMonteCarlo;
  const phEnd = (tr) => last(curves.ph[tr]), ceEnd = (tr) => last(curves.ce[tr]);
  const ceSD = (a, b) => p.cvce * (ceEnd(a) + ceEnd(b)) / 2;

  const d10 = phEnd(1) - phEnd(0), c10 = ceEnd(1) - ceEnd(0);
  const d21 = phEnd(2) - phEnd(1), c21 = ceEnd(2) - ceEnd(1);
  const p10 = Math.max(power(d10, p.sdph, p.nr), power(c10, ceSD(1, 0), p.nr));
  const p21pH = power(d21, p.sdph, p.nr), p21CE = power(c21, ceSD(2, 1), p.nr);
  const finalN = last(curves.N);

  const compostEffect = p10 >= POWER_TARGET;
  const viable = finalN >= DETECTION_LIMIT;
  const microbeEffect = viable && (
    (p21pH >= POWER_TARGET && curves.bioPHDrop >= 0.5 * Math.abs(d21)) ||
    (p21CE >= POWER_TARGET && curves.bioCERise >= 0.5 * Math.abs(c21)));
  const metalsOk = metalMobility(phEnd(2)).Cu[0] !== "bad";
  const materialOk = 3 * p.nr * p.mrec / 1000 <= p.disp;

  return { curves, finalN, d10, d21, c21, p10, p21: Math.max(p21pH, p21CE), finalPHT2: phEnd(2),
    objectives: [compostEffect, viable, microbeEffect, metalsOk, materialOk] };
}

/** Veredicto en texto para la tabla de escenarios. */
function verdictOf(e) {
  const [compost, viable, microbe, metals, material] = e.objectives;
  if (compost && viable && microbe && metals && material) return ["good", "Se cumple la hipótesis"];
  if (viable && microbe && !metals) return ["warn", "Efecto del microorganismo demostrable, con aumento de la movilidad de Cu y Zn"];
  if (compost && viable && !microbe) return ["warn", "Efecto del compost demostrable; microorganismo viable sin efecto medible"];
  if (compost && !viable) return ["warn", "Efecto del compost demostrable; microorganismo no viable"];
  if (viable) return ["warn", "Microorganismo viable sin efectos demostrables"];
  return ["bad", "Ningún efecto demostrable"];
}

/** Categoría (0–4) para el mapa de la figura 38. */
function categoryOf(e) {
  const [compost, viable, microbe, metals] = e.objectives;
  if (compost && viable && microbe && metals) return 0;
  if (viable && microbe) return 1;
  if (viable) return 2;
  if (compost) return 3;
  return 4;
}

// ---------- Ácido mínimo ----------
const acidStep = (beta) => Math.max(1, Math.round(beta * 0.05));

/** Diferencia final de pH entre T2 y T1, o null si T2 no queda activa. */
function activeMicrobeDifference(p) {
  const curves = simulate(p);
  if (last(curves.N) < ACTIVE_POPULATION) return null;
  return last(curves.ph[2]) - last(curves.ph[1]);
}

/**
 * Menor dosis de ácido con T2 activa y T2 − T1 demostrable.
 * Descarta primero con la aproximación analítica y confirma con Monte Carlo.
 */
function findMinimumAcid(p) {
  for (let acid = 0; acid <= 400; acid += acidStep(p.beta)) {
    const q = { ...p, acid }, diff = activeMicrobeDifference(q);
    if (diff === null || powerApprox(diff, q.sdph, q.nr) < 0.6) continue;
    if (powerMonteCarlo(diff, q.sdph, q.nr) >= POWER_TARGET) return acid;
  }
  return null;
}

/** Versión rápida (solo aproximación analítica), para búsquedas masivas. */
function findMinimumAcidFast(p) {
  for (let acid = 0; acid <= 400; acid += acidStep(p.beta)) {
    const q = { ...p, acid }, diff = activeMicrobeDifference(q);
    if (diff !== null && powerApprox(diff, q.sdph, q.nr) >= POWER_TARGET) return acid;
  }
  return null;
}

// ---------- Composición y factibilidad ----------
/** Masa de cada componente por unidad experimental. */
function unitComposition(p) {
  const compost = p.mrec * p.comp / 100, liquid = compost * p.dose / 1000;
  return [
    { tr: 0, tailings: p.mrec, compost: 0, liquid, liquidName: "agua destilada", total: p.mrec + liquid },
    { tr: 1, tailings: p.mrec, compost, liquid, liquidName: "9K estéril", total: p.mrec + compost + liquid },
    { tr: 2, tailings: p.mrec, compost, liquid: 0, liquidName: "(en el compost)", total: p.mrec + compost },
  ];
}

/** Humedad del compost inoculado (compost al 55 % + cultivo). */
const inoculatedMoisture = (dose) => (550 + dose) / (1000 + dose) * 100;

/** Verifica material, masa de muestra, humedad y objetivos. */
function checkFeasibility(p, e) {
  const units = unitComposition(p);
  const tailingsKg = 9 * p.mrec / 1000, compostKg = 6 * p.mrec * p.comp / 100 / 1000, moisture = inoculatedMoisture(p.dose);
  const enoughSample = units.every(u => u.tailings + u.compost >= 1.25 * SAMPLE_MASS_NEEDED[u.tr]);
  const checks = [
    { label: "Disponibilidad de relave", ok: tailingsKg <= p.disp, detail: `${fmt(tailingsKg, 2)} kg de ${fmt(p.disp, 1)} kg`, required: true },
    { label: "Disponibilidad de compost", ok: compostKg <= p.compd, detail: `${fmt(compostKg, 2)} kg de ${fmt(p.compd, 1)} kg (T1 y T2)`, required: true },
    { label: "Masa suficiente para los análisis", ok: enoughSample, required: true,
      detail: `T2 requiere ≥ ${Math.round(1.25 * SAMPLE_MASS_NEEDED[2])} g (pH, CE, SPLP y viabilidad); dispone de ${Math.round(units[2].tailings + units[2].compost)} g` },
    { label: "Humedad del compost inoculado", ok: moisture <= 60, detail: `${fmt(moisture, 0)} % (máximo 60 %)`, required: true },
    { label: "Dentro del rango calibrado del modelo", ok: p.comp <= 30, warnOnly: true,
      detail: p.comp <= 30 ? "Hasta 30 % de compost" : "Más de 30 %: pH y CE son una extrapolación" },
    { label: "1. Efecto del compost demostrable", ok: e.objectives[0], detail: `Potencia: ${fmtPercent(e.p10)}`, required: true },
    { label: "2. Viabilidad del microorganismo", ok: e.objectives[1], detail: e.finalN < 1 ? "< 1 célula/g al día 56" : fmtSci(e.finalN) + " /g al día 56" },
    { label: "3. Efecto del microorganismo demostrable", ok: e.objectives[2], detail: `Potencia: ${fmtPercent(e.p21)}` },
    { label: "4. Sin aumento de la movilidad de metales", ok: e.objectives[3], detail: `pH final de T2: ${fmt(e.finalPHT2, 2)}` },
  ];
  const feasible = checks.filter(c => c.required).every(c => c.ok);
  return { checks, feasible, tailingsKg, compostKg, units };
}

// ---------- Mejor proporción ----------
/** Mayor masa de relave por unidad que permite el material disponible (múltiplos de 25 g). */
function maxTailingsPerUnit(p, compostPct) {
  const byTailings = Math.min(500, Math.floor(p.disp * 1000 / 9 / 25) * 25);
  const byCompost = Math.floor(p.compd * 1000 / (6 * compostPct / 100) / 25) * 25;
  return Math.min(byTailings, byCompost);
}

const proportionScore = (e, compostPct) =>
  (e.objectives[0] ? 4 : 0) + (e.objectives[1] ? 2 : 0) + (e.objectives[2] ? 3 : 0) + (e.objectives[3] ? 1 : 0) + (compostPct <= 30 ? 0.5 : 0);

/** Cercanía al diseño original (10 %, 100 mL/kg, 500 g y poco ácido). */
const distanceToOriginalDesign = (q, tab) =>
  Math.abs(q.comp - 10) / 10 + Math.abs(q.dose - 100) / 100 + Math.abs(q.mrec - 500) / 500 + (tab === "funciona" ? q.acid / 200 : 0);

function proportionCandidate(base, tab, comp, dose) {
  const mrec = maxTailingsPerUnit(base, comp);
  if (mrec < 100) return null;
  const q = { ...base, comp, dose, mrec };
  if (tab === "funciona") { const acid = findMinimumAcidFast(q); q.acid = acid === null ? 0 : acid; }
  const e = evaluateDesign(q, true);
  if (!checkFeasibility(q, e).feasible) return null;
  return { q, e, score: proportionScore(e, comp), distance: distanceToOriginalDesign(q, tab) };
}

/** Recorre la rejilla de proporciones y devuelve la mejor factible (o null). */
function findBestProportion(base, tab) {
  const candidates = [];
  PROPORTION_GRID.compost.forEach(comp => PROPORTION_GRID.dose.forEach(dose => {
    const candidate = proportionCandidate(base, tab, comp, dose);
    if (candidate) candidates.push(candidate);
  }));
  candidates.sort((a, b) => b.score - a.score || a.distance - b.distance);
  return candidates[0] || null;
}