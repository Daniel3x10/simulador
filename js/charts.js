"use strict";
/* ==========================================================================
   charts.js — Gráficas en canvas. Cada gráfica se dibuja una vez en una
   capa oculta; al avanzar el día solo se copia esa capa y se dibuja el
   marcador, lo que hace la animación muy liviana.
   ========================================================================== */

const CHART_MARGIN = { left: 56, right: 10, top: 10, bottom: 32 };

/** Prepara la capa oculta del canvas con la resolución de la pantalla. */
function createLayer(canvas) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W) return null;
  const layer = canvas._layer || (canvas._layer = document.createElement("canvas"));
  layer.width = Math.round(W * dpr);
  layer.height = Math.round(H * dpr);
  const ctx = layer.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return { layer, ctx, W, H, dpr };
}

/** Escalas de datos a píxeles. */
function makeScales(o, W, H) {
  const m = CHART_MARGIN, plotW = W - m.left - m.right, plotH = H - m.top - m.bottom;
  const toAxis = (v) => o.log ? Math.log10(Math.max(v, 10 ** o.ymin)) : v;
  return {
    left: m.left, top: m.top, right: W - m.right, bottom: m.top + plotH, plotW, plotH,
    x: (v) => m.left + (v - o.xmin) / (o.xmax - o.xmin) * plotW,
    y: (v) => m.top + plotH - (toAxis(v) - o.ymin) / (o.ymax - o.ymin) * plotH,
    yAxis: (v) => m.top + plotH - (v - o.ymin) / (o.ymax - o.ymin) * plotH,
  };
}

function yTickLabel(o, value) {
  if (o.log) return "10" + toSuperscript(Math.round(value));
  return o.dec ? fmt(value, o.dec) : String(Math.round(value));
}

function drawYGrid(ctx, o, s) {
  ctx.strokeStyle = color("line"); ctx.fillStyle = color("muted"); ctx.lineWidth = 1;
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let v = o.ymin; v <= o.ymax + 1e-9; v += o.ystep) {
    const py = s.yAxis(v);
    ctx.beginPath(); ctx.moveTo(s.left, py); ctx.lineTo(s.right, py); ctx.stroke();
    ctx.fillText(yTickLabel(o, v), s.left - 6, py);
  }
}

function drawXTicks(ctx, s) {
  ctx.fillStyle = color("muted"); ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let d = 0; d <= INCUBATION_DAYS; d += 7) ctx.fillText(String(d), s.x(d), s.bottom + 5);
  ctx.fillText("Día de incubación", s.left + s.plotW / 2, s.bottom + 18);
}

function drawReferenceLines(ctx, lines, s) {
  lines.forEach(line => {
    const py = s.y(line.y);
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = color("muted");
    ctx.beginPath(); ctx.moveTo(s.left, py); ctx.lineTo(s.right, py); ctx.stroke(); ctx.restore();
    ctx.fillStyle = color("muted"); ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.fillText(line.label, s.right - 2, py - 2);
  });
}

/** Franja que señala el día de muestreo elegido en el análisis estadístico. */
function drawSamplingBand(ctx, day, s) {
  ctx.save(); ctx.fillStyle = color("teal"); ctx.globalAlpha = 0.1;
  ctx.fillRect(s.x(day) - 7, s.top, 14, s.plotH); ctx.restore();
}

function drawSeries(ctx, series, s) {
  ctx.lineWidth = 2;
  series.forEach(sr => {
    ctx.strokeStyle = sr.color; ctx.beginPath();
    sr.x.forEach((x, i) => { const px = s.x(x), py = s.y(sr.y[i]); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke();
  });
}

function drawPoints(ctx, points, s) {
  const surface = color("surface"), ink = color("ink");
  points.forEach(pt => {
    const px = s.x(pt.x) + (pt.jitter || 0), py = s.y(pt.y);
    ctx.globalAlpha = pt.dim ? 0.3 : 1;
    ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(px, py, pt.big ? 6 : 3.8, 0, 6.283); ctx.fill();
    ctx.strokeStyle = pt.big ? ink : surface; ctx.lineWidth = pt.big ? 2 : 1.2; ctx.stroke();
    if (pt.hollow) { ctx.fillStyle = surface; ctx.beginPath(); ctx.arc(px, py, 1.8, 0, 6.283); ctx.fill(); }
  });
  ctx.globalAlpha = 1;
}

function drawFrame(ctx, s) {
  ctx.strokeStyle = color("ink"); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(s.left, s.top); ctx.lineTo(s.left, s.bottom); ctx.lineTo(s.right, s.bottom); ctx.stroke();
}

/**
 * Dibuja una gráfica completa.
 * o = { xmin, xmax, ymin, ymax, ystep, dec?, log?, series, points?, hlines?, sday?, marker? }
 */
function drawChart(canvas, o) {
  const L = createLayer(canvas);
  if (!L) return;
  const { ctx, W, H } = L, s = makeScales(o, W, H);
  ctx.font = "11px " + color("fontMono");
  drawYGrid(ctx, o, s);
  drawXTicks(ctx, s);
  drawReferenceLines(ctx, o.hlines || [], s);
  if (o.sday != null) drawSamplingBand(ctx, o.sday, s);

  ctx.save(); ctx.beginPath(); ctx.rect(s.left, s.top, s.plotW, s.plotH); ctx.clip();
  drawSeries(ctx, o.series, s);
  drawPoints(ctx, o.points || [], s);
  ctx.restore();

  drawFrame(ctx, s);
  canvas._chart = { layer: L.layer, dpr: L.dpr, W, scales: s };
  paintDayMarker(canvas, o.marker);
}

/** Copia la capa estática y dibuja encima la línea del día actual. */
function paintDayMarker(canvas, day) {
  const chart = canvas && canvas._chart;
  if (!chart) return;
  if (canvas.width !== chart.layer.width || canvas.height !== chart.layer.height) {
    canvas.width = chart.layer.width; canvas.height = chart.layer.height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(chart.layer, 0, 0);
  if (day == null) return;

  const s = chart.scales, px = s.x(day), rust = color("rust");
  ctx.setTransform(chart.dpr, 0, 0, chart.dpr, 0, 0);
  ctx.save();
  ctx.strokeStyle = rust; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.moveTo(px, s.top); ctx.lineTo(px, s.bottom); ctx.stroke();
  if (day > 0.2) {
    const nearRight = px > chart.W - 70;
    ctx.globalAlpha = 1; ctx.fillStyle = rust; ctx.font = "600 10.5px " + color("fontMono");
    ctx.textAlign = nearRight ? "right" : "left"; ctx.textBaseline = "top";
    ctx.fillText("Día " + fmt(day, 0), px + (nearRight ? -4 : 4), s.top + 2);
  }
  ctx.restore();
}

/** Rango de eje "redondo" que contiene todos los valores. */
function niceRange(values, pad, steps) {
  const lo = Math.min(...values) - pad, hi = Math.max(...values) + pad, span = hi - lo;
  const step = steps.find(st => span / st <= 8) || last(steps);
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

/** Leyenda HTML: líneas para series y puntos para réplicas. */
function legendHTML(items) {
  return items.map(it => `<span${it.dot ? ' class="dot"' : ""} style="--c:${it.color}">${it.label}</span>`).join("");
}