"use strict";
// ==========================================================================
// utils.js — Utilidades generales DOM, formato numérico, operaciones
// numéricas y números aleatorios reproducibles. No depende de otros archivos.
// ==========================================================================

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Cambia el texto solo si es distinto (evita trabajo innecesario del navegador). */
function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Cambia el HTML solo si es distinto. */
function setHTML(el, html) {
  if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
}

/** Etiqueta de estado (verde, ámbar, cobre o gris). */
function chipHTML(kind, text) {
  return `<span class="chip ${kind}">${text}</span>`;
}

/** Destello breve para indicar que un recuadro cambió. */
function flash(el) {
  el.classList.remove("flash");
  void el.offsetWidth; // reinicia la animación
  el.classList.add("flash");
}

// ---------- Formato (convención española: coma decimal) ----------
const SUPERSCRIPT = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const toSuperscript = (n) => String(n).split("").map(c => SUPERSCRIPT[c] || c).join("");

/** 7.99 → 7,99 */
function fmt(value, decimals = 1) {
  return value.toFixed(decimals).replace(".", ",").replace(/^-/, "−");
}

/** 0.5 → +0,50 */
function fmtSigned(value, decimals) {
  return (value >= 0 ? "+" : "") + fmt(value, decimals);
}

/** 1.07e8 → 1,1 × 10⁸ */
function fmtSci(value) {
  if (!isFinite(value) || value <= 0) return "0";
  if (value < 1) return "< 1";
  const exponent = Math.floor(Math.log10(value));
  return fmt(value / (10 ** exponent), 1) + " × 10" + toSuperscript(exponent);
}

/** Valor p con el formato habitual. */
function fmtP(p) {
  return p < 0.001 ? "< 0,001" : fmt(p, 3);
}

const fmtPercent = (fraction) => Math.round(fraction * 100) + " %";

// ---------- Operaciones numéricas ----------
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const last = (arr) => arr[arr.length - 1];
const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;

/** Desviación estándar muestral (n − 1). */
function stdDev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

/** Interpolación lineal de y(x) sobre una serie ordenada t (búsqueda binaria). */
function interpolate(t, y, x) {
  if (x <= t[0]) return y[0];
  if (x >= last(t)) return last(y);
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid; else hi = mid;
  }
  return y[lo] + ((x - t[lo]) / (t[hi] - t[lo])) * (y[hi] - y[lo]);
}

// ---------- Aleatoriedad reproducible ----------
/** Generador uniforme Mulberry32: la misma semilla produce la misma secuencia. */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generador normal estándar (Box-Muller) a partir de uno uniforme. */
function gaussian(uniform) {
  return () => {
    let u = 0, v = 0;
    while (u === 0) u = uniform();
    while (v === 0) v = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185 * v);
  };
}
