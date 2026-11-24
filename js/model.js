"use strict";
/* ==========================================================================
   model.js — Modelo 2 de la tesis (sección 3.5.6) para la población de
   A. ferrooxidans y modelo empírico de pH y CE (tablas 29 y 30).
   Funciones puras: reciben parámetros y devuelven resultados.
   ========================================================================== */

const MODEL = {
  muEff: 0.12,           // μópt · f = 2,4 d⁻¹ × 0,05 (tabla 32)
  nMax: 1e8,             // capacidad máxima (células/g)
  kdBase: 0.02,          // mortalidad basal (d⁻¹)
  halfSaturation: 1e6,   // población a la que la actividad es la mitad de la máxima
  adaptationDays: 7,     // adaptación del inóculo en el compost
  adaptationTemp: 29,    // °C durante la adaptación
  step: 0.05,            // paso de integración (días)
  saveEvery: 5,          // guardar un punto cada 5 pasos (0,25 días)
};
const CARDINAL_PH = { min: 1.3, opt: 2.5, max: 4.5 };   // Rosso et al. (1995)
const CARDINAL_T = { min: 10, opt: 32, max: 37 };       // Rosso et al. (1993)

// ---------- Factores de crecimiento ----------
/** Modelo cardinal de pH (ecuación 19). */
function cardinalPH(x, min, opt, max) {
  if (x <= min || x >= max) return 0;
  const n = (x - min) * (x - max);
  return n / (n - (x - opt) ** 2);
}

/** Modelo cardinal de temperatura (CTMI). */
function cardinalTemperature(x, min, opt, max) {
  if (x <= min || x >= max) return 0;
  const num = (x - max) * (x - min) ** 2;
  const den = (opt - min) * ((opt - min) * (x - opt) - (opt - max) * (opt + min - 2 * x));
  return Math.max(num / den, 0);
}

const gammaPH = (pH) => cardinalPH(pH, CARDINAL_PH.min, CARDINAL_PH.opt, CARDINAL_PH.max);
const gammaT = (T) => cardinalTemperature(T, CARDINAL_T.min, CARDINAL_T.opt, CARDINAL_T.max);

/** Mortalidad: basal dentro del rango; aumenta linealmente hasta kdNeutral entre pH 4,5 y 6,5. */
function mortality(pH, kdNeutral) {
  if (pH <= CARDINAL_PH.max) return MODEL.kdBase;
  return MODEL.kdBase + Math.min((pH - CARDINAL_PH.max) / 2, 1) * (kdNeutral - MODEL.kdBase);
}

/** Tasa neta de crecimiento sin limitación por capacidad (d⁻¹). */
function netGrowthRate(pH, T, kdNeutral) {
  return MODEL.muEff * gammaPH(pH) * gammaT(T) - mortality(pH, kdNeutral);
}

// ---------- Mezcla relave + compost ----------
/** Factores que dependen de la proporción de compost. */
function mixFactors(compostPct) {
  const ratio = compostPct / 100;
  const weight = 1.282 * ratio / (1 + 1.282 * ratio);
  const weightAt10 = 0.1282 / 1.1282;
  return {
    massFraction: compostPct / (100 + compostPct),
    weight,
    phDropScale: Math.min(weight / weightAt10, 3),
    saltScale: Math.min(compostPct / 10, 3),
  };
}

/** pH inicial del relave tras el acondicionamiento ácido. */
function tailingsInitialPH(p) {
  return Math.max(2, p.phr - p.acid / p.beta);
}

/** Curvas base de pH y CE por tratamiento, sin el efecto de la bacteria. */
function makeBaseCurves(p, phTailings0, mix) {
  const compostPH = [null, p.phc1, p.phc2];
  const compostCE = [0, p.cec1 * 1000, p.cec2 * 1000];

  const ph = (t, tr) => {
    if (tr === 0) return phTailings0;
    const ph0 = phTailings0 + mix.weight * (compostPH[tr] - phTailings0);
    return ph0 - 0.2 * mix.phDropScale * (1 - Math.exp(-0.07 * t));   // mineralización
  };
  const ce = (t, tr) => {
    const gypsum = p.cer + 40 * t / INCUBATION_DAYS;                   // disolución de yeso
    if (tr === 0) return gypsum;
    return gypsum + 0.786 * mix.massFraction * compostCE[tr] + 147 * mix.saltScale * (1 - Math.exp(-0.03 * t));
  };
  return { ph, ce };
}

/** Población del inóculo tras la adaptación en el compost y la dilución en el relave. */
function inoculumAfterMixing(p, massFraction) {
  const perGram = p.Xc * p.dose / 1000;
  const adaptationRate = netGrowthRate(p.phc2, MODEL.adaptationTemp, p.kd);
  const afterAdaptation = Math.min(MODEL.nMax, perGram * Math.exp(adaptationRate * MODEL.adaptationDays));
  return { perGram, mixed: afterAdaptation * massFraction };
}

// ---------- Simulación de los 56 días ----------
function recordPoint(curves, base, t, phT2, ceBio, n) {
  curves.t.push(t);
  curves.ph[0].push(base.ph(t, 0));
  curves.ph[1].push(base.ph(t, 1));
  curves.ph[2].push(phT2);
  curves.ce[0].push(base.ce(t, 0));
  curves.ce[1].push(base.ce(t, 1));
  curves.ce[2].push(base.ce(t, 2) + ceBio);
  curves.N.push(n);
}

/**
 * Integra el modelo durante la incubación.
 * Devuelve las series t, ph[3], ce[3], N y los valores derivados.
 */
function simulate(p) {
  const mix = mixFactors(p.comp);
  const phTailings0 = tailingsInitialPH(p);
  const base = makeBaseCurves(p, phTailings0, mix);
  const inoculum = inoculumAfterMixing(p, mix.massFraction);
  const curves = { t: [], ph: [[], [], []], ce: [[], [], []], N: [] };

  const h = MODEL.step;
  let n = inoculum.mixed, bioPHDrop = 0, bioCERise = 0;
  for (let i = 0; i <= INCUBATION_DAYS / h; i++) {
    const t = i * h;
    const phT2 = base.ph(t, 2) - bioPHDrop;
    if (i % MODEL.saveEvery === 0) recordPoint(curves, base, t, phT2, bioCERise, n);

    const growth = gammaPH(phT2) * gammaT(p.T);
    const activity = growth * n / (n + MODEL.halfSaturation);
    const rate = MODEL.muEff * growth * (1 - n / MODEL.nMax) - mortality(phT2, p.kd);
    n = Math.max(n * Math.exp(rate * h), 1e-30);
    bioPHDrop += p.alpha * activity * h;
    bioCERise += p.eps * activity * h;
  }

  return { ...curves, initialPerGram: inoculum.perGram, initialMixed: inoculum.mixed, phTailings0, massFraction: mix.massFraction, bioPHDrop, bioCERise };
}

/** Primer día en que la población cae bajo el límite de detección (o null). */
function detectionLossDay(curves) {
  const i = curves.N.findIndex(n => n < DETECTION_LIMIT);
  return i === -1 ? null : curves.t[i];
}

// ---------- Movilidad de metales (tabla 31) ----------
/** Devuelve, para cada metal, [estado, descripción]. */
function metalMobility(pH) {
  const cuZn = pH >= 7 ? ["good", "Baja: precipita"] : pH >= 5.5 ? ["warn", "Media"] : ["bad", "Alta: se moviliza"];
  const fe = pH >= 4 ? ["good", "Baja: jarosita y óxidos estables"] : pH >= 3 ? ["warn", "Media"] : ["bad", "Alta: se disuelve"];
  const as = pH > 7.5 ? ["warn", "Moderada: se desorbe a pH alcalino"] : pH >= 3 ? ["good", "Baja: adsorbido en óxidos de Fe"] : ["bad", "Alta: se disuelven los óxidos"];
  return { Fe: fe, As: as, Cu: cuZn, Zn: cuZn };
}

/** Metales con movilidad alta a un pH dado. */
function highlyMobileMetals(pH) {
  const mobility = metalMobility(pH);
  return ["Cu", "Zn", "Fe", "As"].filter(m => mobility[m][0] === "bad");
}