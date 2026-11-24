"use strict";
/* ==========================================================================
   stats.js — Estadística: distribuciones t y F, ANOVA de un factor y
   potencia estadística (Monte Carlo y aproximación analítica).
   ========================================================================== */

// ---------- Funciones especiales (Numerical Recipes) ----------
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = 1.000000000190015;
  for (let j = 0; j < 6; j++) series += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * series / x);
}

function betaContinuedFraction(a, b, x) {
  const tiny = 1e-30, qab = a + b, qap = a + 1, qam = a - 1;
  const guard = (v) => Math.abs(v) < tiny ? tiny : v;
  let c = 1, d = 1 / guard(1 - qab * x / qap), h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 / guard(1 + aa * d); c = guard(1 + aa / c); h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 / guard(1 + aa * d); c = guard(1 + aa / c);
    const delta = d * c; h *= delta;
    if (Math.abs(delta - 1) < 3e-12) break;
  }
  return h;
}

/** Función beta incompleta regularizada I_x(a, b). */
function incompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? front * betaContinuedFraction(a, b, x) / a
    : 1 - front * betaContinuedFraction(b, a, 1 - x) / b;
}

// ---------- Distribuciones ----------
/** Valor p de la distribución F. */
const pValueF = (F, df1, df2) => F <= 0 ? 1 : incompleteBeta(df2 / 2, df1 / 2, df2 / (df2 + df1 * F));

/** Valor p bilateral de la distribución t. */
const pValueT = (t, df) => incompleteBeta(df / 2, 0.5, df / (df + t * t));

/** Valor crítico bilateral de t para α = 0,05 (bisección, con caché). */
const T_CRITICAL_CACHE = {};
function tCritical(df) {
  if (T_CRITICAL_CACHE[df]) return T_CRITICAL_CACHE[df];
  let lo = 0, hi = 50;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (pValueT(mid, df) > 0.05) lo = mid; else hi = mid;
  }
  return T_CRITICAL_CACHE[df] = (lo + hi) / 2;
}

/** Distribución normal estándar acumulada (aproximación de Abramowitz y Stegun). */
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - q : q;
}

// ---------- ANOVA de un factor (ecuación 12) ----------
function oneWayAnova(groups) {
  const all = groups.flat(), grandMean = mean(all), k = groups.length, n = all.length;
  const ssBetween = groups.reduce((s, g) => s + g.length * (mean(g) - grandMean) ** 2, 0);
  const ssWithin = groups.reduce((s, g) => { const m = mean(g); return s + g.reduce((q, x) => q + (x - m) ** 2, 0); }, 0);
  const dfWithin = n - k, msWithin = ssWithin / dfWithin;
  const F = (ssBetween / (k - 1)) / msWithin;
  return { F, p: pValueF(F, k - 1, dfWithin), msWithin, dfWithin };
}

/** Diferencia mínima significativa de Fisher. */
function leastSignificantDifference(anova, replicates) {
  return tCritical(anova.dfWithin) * Math.sqrt(anova.msWithin * 2 / replicates);
}

// ---------- Potencia estadística ----------
const POWER_CACHE = {};
const MONTE_CARLO_RUNS = 3000;

/** Suma de cuadrados dentro de los grupos. */
function withinSumOfSquares(groups) {
  return groups.reduce((q, g) => { const m = mean(g); return q + g.reduce((w, x) => w + (x - m) ** 2, 0); }, 0);
}

/** Potencia por Monte Carlo: fracción de experimentos simulados en que la diferencia es significativa. */
function powerMonteCarlo(diff, sd, replicates) {
  const key = diff.toFixed(5) + "|" + sd.toFixed(5) + "|" + replicates;
  if (POWER_CACHE[key] !== undefined) return POWER_CACHE[key];

  const normal = gaussian(mulberry32(12345)), df = 3 * replicates - 3, tc = tCritical(df);
  let significant = 0;
  for (let run = 0; run < MONTE_CARLO_RUNS; run++) {
    const groups = [0, diff, 0].map(mu => Array.from({ length: replicates }, () => mu + normal() * sd));
    const msWithin = withinSumOfSquares(groups) / df;
    const t = Math.abs(mean(groups[1]) - mean(groups[0])) / Math.sqrt(msWithin * 2 / replicates);
    if (t > tc) significant++;
  }
  return POWER_CACHE[key] = significant / MONTE_CARLO_RUNS;
}

/** Potencia aproximada (analítica e instantánea). */
function powerApprox(diff, sd, replicates) {
  const noncentrality = Math.abs(diff) / (sd * Math.sqrt(2 / replicates));
  const tc = tCritical(3 * replicates - 3);
  return normalCdf(noncentrality - tc) + normalCdf(-noncentrality - tc);
}

/** Estado y texto según la potencia. */
function powerStatus(power) {
  if (power >= POWER_TARGET) return ["good", "Potencia ≥ 80 %: demostrable"];
  if (power >= 0.5) return ["warn", "Potencia 50–80 %: insuficiente"];
  return ["bad", "Potencia < 50 %: no demostrable"];
}