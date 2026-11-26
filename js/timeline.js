"use strict";
/* ==========================================================================
   timeline.js — Línea de tiempo: hitos de muestreo, tarjetas en vivo de
   cada tratamiento y descripción de la etapa actual.
   ========================================================================== */

let milestoneButtons = [];
let liveRefs = null;
let lastSlowUpdate = 0;
const gaugePosition = (pH) => clamp((pH - 1) / 8 * 100, 0, 100);

// ---------- Hitos ----------
function milestoneLabel(day) {
  if (day === 0) return "Montaje";
  if (day === INCUBATION_DAYS) return "Final · SPLP";
  return "Muestreo";
}

function buildMilestones() {
  const position = (d) => d / INCUBATION_DAYS * 100;
  $("miles").innerHTML = `<div class="track"></div><div class="fill" id="mfill"></div>` + SAMPLING_DAYS.map(d =>
    `<button type="button" data-jump="${d}" style="left:${position(d)}%" aria-label="Ir al día ${d}">${d}</button>` +
    `<span style="left:${position(d)}%">${milestoneLabel(d)}</span>`).join("");
  milestoneButtons = $$("[data-jump]");
  milestoneButtons.forEach(b => b.addEventListener("click", () => jumpToDay(+b.dataset.jump)));
}

// ---------- Tarjetas en vivo ----------
function liveCardHTML(tr) {
  const band = `left:${gaugePosition(1.3)}%;width:${gaugePosition(4.5) - gaugePosition(1.3)}%`;
  const population = tr === 2
    ? `<div class="live-row"><span>Población</span><div class="bar"><i data-r="nbar"></i></div><span class="live-value" data-r="n"></span></div>
       <div class="live-row"><span></span><span class="live-delta" data-r="nstatus"></span><span></span></div>`
    : `<div class="live-row"><span>Población</span><span class="live-delta">${tr === 1 ? "Sin inóculo (control del compost)" : "Sin inóculo (control absoluto)"}</span><span></span></div>`;
  return `<div class="live-card t${tr}">
    <div class="live-title"><span class="tag t${tr}"></span>${TREATMENT_NAMES[tr]}</div>
    <div class="live-row"><span>pH</span><div class="gauge"><div class="gauge-band" style="${band}" title="Rango de crecimiento (1,3–4,5)"></div><div class="gauge-pin" data-r="pin"></div></div><span class="live-value" data-r="ph"></span></div>
    <div class="live-row"><span></span><span class="live-delta" data-r="dph"></span><span></span></div>
    <div class="live-row"><span>CE</span><div class="bar"><i data-r="cebar"></i></div><span class="live-value" data-r="ce"></span></div>
    <div class="live-row"><span></span><span class="live-delta" data-r="dce"></span><span></span></div>
    ${population}
  </div>`;
}

function buildLiveCards() {
  $("live").innerHTML = [0, 1, 2].map(liveCardHTML).join("");
  liveRefs = $$(".live-card", $("live")).map(card => {
    const refs = {};
    $$("[data-r]", card).forEach(el => refs[el.dataset.r] = el);
    return refs;
  });
}

function populationStatus(N) {
  if (N >= ACTIVE_POPULATION) return "Población activa";
  if (N >= DETECTION_LIMIT) return "Población en declive";
  return "Por debajo del límite de detección";
}

function updateLiveCard(tr, day) {
  const c = state.sim.curves, refs = liveRefs[tr];
  const ph = interpolate(c.t, c.ph[tr], day), ce = interpolate(c.t, c.ce[tr], day);
  refs.pin.style.left = gaugePosition(ph) + "%";
  setText(refs.ph, fmt(ph, 2));
  setText(refs.dph, `${fmtSigned(ph - c.ph[tr][0], 2)} respecto al día 0`);
  refs.cebar.style.width = Math.min(100, ce / 3500 * 100) + "%";
  setText(refs.ce, Math.round(ce) + " µS/cm");
  setText(refs.dce, `${fmtSigned(ce - c.ce[tr][0], 0)} µS/cm respecto al día 0`);
  if (tr === 2) {
    const N = interpolate(c.t, c.N, day), logN = N > 0 ? Math.log10(N) : -30;
    refs.nbar.style.width = clamp((logN + 1) / 9 * 100, 0, 100) + "%";
    setText(refs.n, (N < 1 ? "< 1" : fmtSci(N)) + " /g");
    setText(refs.nstatus, populationStatus(N));
  }
}

function updateTimelineHeader(day) {
  setText($("tl-day"), "Día " + fmt(day, 1));
  $("mfill").style.width = (day / INCUBATION_DAYS * 100) + "%";
  milestoneButtons.forEach(b => b.classList.toggle("done", +b.dataset.jump <= day + 1e-6));
}

// ---------- Narración ----------
/** Actividades de laboratorio programadas para un día (tabla 20). */
function scheduledActivities(day) {
  const list = [];
  if (day === 0) list.push("Montaje de las nueve unidades según la tabla 19 y primer muestreo de pH y conductividad (submuestras de 10 g).");
  if ([7, 14, 28, 42].includes(day)) list.push("Muestreo de pH y conductividad eléctrica en submuestras de 10 g de cada unidad.");
  if ([7, 14, 28].includes(day)) list.push("Recuento de la población viable de T2 por número más probable en medio 9K.");
  if (day === INCUBATION_DAYS) list.push("Último muestreo de pH, conductividad y población viable; fin de la incubación y ensayo SPLP para Fe, As, Cu y Zn.");
  if (day > 0 && day % 3 === 0) list.push("Control gravimétrico de la humedad y reposición con agua destilada.");
  return list;
}

/** Etapa del inóculo en el día indicado: título y explicación. */
function microbeStage(day) {
  const { params: p, curves: c, final } = state.sim;
  const phT2 = interpolate(c.t, c.ph[2], day), N = interpolate(c.t, c.N, day);
  const rate = netGrowthRate(phT2, p.T, p.kd), lossDay = final.lossDay, N0 = c.initialMixed;
  if (day < 1) return { rate, title: "Etapa inicial: mezcla y estabilización",
    text: `Al mezclar el compost inoculado con el relave, la población de T2 se diluye a ${fmtSci(N0)} células/g. El pH de la mezcla (${fmt(phT2, 2)}) ${phT2 > GROWTH_PH_MAX ? "se encuentra fuera" : "se encuentra dentro"} del rango de crecimiento de la especie (1,3–4,5).` };
  if (lossDay !== null && day < lossDay) return { rate, title: "Declive del inóculo",
    text: `La población de T2 desciende de ${fmtSci(N0)} a ${fmtSci(N)} células/g, porque a pH ${fmt(phT2, 2)} el microorganismo no obtiene energía y su tasa neta es de ${fmt(rate, 2)} d⁻¹. Bajará del límite de detección hacia el día ${Math.round(lossDay)}.` };
  if (lossDay !== null) return { rate, title: "Inóculo no detectable",
    text: `Desde el día ${Math.round(lossDay)} la población de T2 se encuentra por debajo del límite de detección (10³ células/g). A partir de esta etapa, T2 se comporta prácticamente igual que T1.` };
  if (rate > 0.005) return { rate, title: "Crecimiento y oxidación activa",
    text: `La población de T2 aumenta a ${fmtSci(N)} células/g (tasa neta de ${fmtSigned(rate, 3)} d⁻¹). Al oxidar el hierro y los sulfuros del relave, el microorganismo produce ácido: el pH de T2 desciende más rápido que el de T1.` };
  return { rate, title: "Persistencia sin crecimiento",
    text: `La población de T2 se mantiene en ${fmtSci(N)} células/g, en el límite de su rango de pH, con una actividad oxidativa reducida.` };
}

function phNarrative(day, stage) {
  const c = state.sim.curves, at = (tr) => interpolate(c.t, c.ph[tr], day);
  const p0 = at(0), p1 = at(1), p2 = at(2);
  const cause = day < 1 ? ", por el aporte del compost"
    : ` (${fmtSigned(p1 - c.ph[1][0], 2)} y ${fmtSigned(p2 - c.ph[2][0], 2)} desde el día 0), por la mineralización del compost`;
  const biological = state.sim.final.lossDay === null && stage.rate > 0.005 ? " y, en T2, por la acidificación biológica" : "";
  return `<b>pH:</b> T0 se mantiene en ${fmt(p0, 2)}; T1 y T2 se encuentran en ${fmt(p1, 2)} y ${fmt(p2, 2)}${cause}${biological}.`;
}

function ceNarrative(day) {
  const c = state.sim.curves, at = (tr) => Math.round(interpolate(c.t, c.ce[tr], day));
  return `<b>Conductividad eléctrica:</b> T0 = ${at(0)}, T1 = ${at(1)} y T2 = ${at(2)} µS/cm; el aumento en T1 y T2 se debe a las sales del compost y a su mineralización.`;
}

function updateNarrative(day) {
  const stage = microbeStage(day), roundedDay = Math.round(day);
  const activities = Math.abs(day - roundedDay) < 0.35 ? scheduledActivities(roundedDay) : [];
  const html = `<p><b>${stage.title}</b> (día ${fmt(day, 0)} de 56).</p><p>${stage.text}</p><p>${phNarrative(day, stage)}</p><p>${ceNarrative(day)}</p>` +
    (activities.length ? `<p class="event"><b>Actividad programada para el día ${roundedDay}:</b> ${activities.join(" ")}</p>` : "");
  setHTML($("narr").querySelector(".xb"), html);
}

// ---------- Actualización por día ----------
/**
 * Actualiza todo lo que depende del día mostrado.
 * El marcador de las gráficas se repinta siempre; los textos, como máximo cada 110 ms.
 */
function updateDayViews(force) {
  if (!state.sim || state.tab === "situaciones") return;
  CHART_CANVASES().forEach(cv => paintDayMarker(cv, state.day));
  const now = performance.now();
  if (!force && now - lastSlowUpdate < 110) return;
  lastSlowUpdate = now;
  updateTimelineHeader(state.day);
  [0, 1, 2].forEach(tr => updateLiveCard(tr, state.day));
  updateNarrative(state.day);
  updateUnitReadouts();
}

function setPlaying(playing) {
  state.playing = playing;
  setText($("play"), playing ? "Pausar" : "Reproducir");
}

/** Salta a un día; si es de muestreo, también cambia el análisis estadístico. */
function jumpToDay(day) {
  state.day = day;
  setPlaying(false);
  $("day").value = day;
  if (SAMPLING_DAYS.includes(day) && day !== state.samplingDay) { setSamplingDay(day); recalc(); }
  else updateDayViews(true);
  renderInterpretation();
}