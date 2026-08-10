/* ══════════════════════════════════════════════════════════════
   Herramienta de diagnóstico TRL — UPTC
   Réplica en web del libro "Herramienta de diagnostico TRL.xlsm".

   Reglas de cálculo tomadas de la hoja RESULTADOS del libro original:
   · Cada pregunta pertenece a un nivel TRL (columna B de cada hoja).
   · Para cada nivel se calcula  % = respuestas "Sí" / total de preguntas del nivel.
   · El TRL alcanzado es el nivel MÁS ALTO cuyo % supera su umbral,
     evaluando de 9 hacia 1 (fórmula RESULTADOS!J21).
   · Umbrales: TRL 1-2 → 0,79 · TRL 3-4 y 6 → 0,60 · TRL 5, 7-9 → 0,70
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const DATA = window.TRL_DATA;
  const STORAGE_KEY = 'trl-uptc-v1';
  const THEME_KEY = 'trl-uptc-theme';

  const PROFILE_FIELDS = [
    ['investigador', 'Investigador(a)'],
    ['grupo', 'Grupo I+D+i / Centro'],
    ['telefono', 'Teléfono'],
    ['email', 'Correo electrónico'],
    ['tecnologia', 'Tecnología'],
  ];

  /** @type {{answers: Record<string,'yes'|'no'>, profile: Record<string,string>}} */
  let state = { answers: {}, profile: {} };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // ═══════════════════════ Persistencia ═══════════════════════

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.answers = parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : {};
        state.profile = parsed.profile && typeof parsed.profile === 'object' ? parsed.profile : {};
      }
    } catch (err) {
      console.warn('No se pudieron recuperar las respuestas guardadas:', err);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      flashSaved();
    } catch (err) {
      console.warn('No se pudieron guardar las respuestas:', err);
      const hint = document.getElementById('save-hint');
      if (hint) {
        hint.textContent = 'No se pudo guardar';
        hint.dataset.state = 'error';
      }
    }
  }

  /* Aviso discreto de autoguardado: sin él no hay señal de que las respuestas
     persisten, y el cuestionario es largo como para generar dudas. */
  function flashSaved() {
    const hint = document.getElementById('save-hint');
    if (!hint) return;
    hint.textContent = 'Guardado';
    hint.dataset.state = 'ok';
    clearTimeout(flashSaved._timer);
    flashSaved._timer = setTimeout(() => { hint.dataset.state = 'idle'; }, 1800);
  }

  // ═══════════════════════ Utilidades ═══════════════════════

  const allQuestions = DATA.sections.flatMap((section) =>
    section.items.map((item) => Object.assign({ section: section.short }, item))
  );

  const escapeHtml = (str) =>
    String(str).replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
    );

  const pct = (value) => Math.round(value * 1000) / 10;

  /* Concordancia de número: los textos de la ruta mezclan cantidades variables. */
  const conj = (count, singular, plural) => (count === 1 ? singular : plural);
  const count = (n, singular, plural) => `${n} ${conj(n, singular, plural)}`;

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* Resalta los términos del glosario dentro del enunciado de una pregunta.
     Se usan lookarounds con letras acentuadas porque \b de JS no las reconoce. */
  const glossaryMatcher = (function build() {
    const lookup = new Map();
    const patterns = [];
    DATA.glossary.forEach((entry) => {
      [entry.term].concat(entry.aliases || []).forEach((alias) => {
        lookup.set(alias.toLowerCase(), entry);
        patterns.push(alias);
      });
    });
    patterns.sort((a, b) => b.length - a.length);
    const escaped = patterns.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const letter = 'A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ_';
    const regex = new RegExp(
      `(?<![${letter}])(${escaped.join('|')})(?![${letter}])`,
      'gi'
    );
    return { lookup, regex };
  })();

  function withGlossary(text) {
    return escapeHtml(text).replace(glossaryMatcher.regex, (match) => {
      const entry = glossaryMatcher.lookup.get(match.toLowerCase());
      if (!entry) return match;
      return `<abbr class="term" title="${escapeHtml(entry.term)}: ${escapeHtml(entry.definition)}">${match}</abbr>`;
    });
  }

  // ═══════════════════════ Cálculo de resultados ═══════════════════════

  function computeResults() {
    const byTrl = {};
    for (let level = 1; level <= 9; level += 1) {
      byTrl[level] = { yes: 0, total: 0, ratio: 0, threshold: DATA.thresholds[level] };
    }
    const byCategory = DATA.sections.map((section) => ({
      short: section.short,
      title: section.title,
      yes: 0,
      total: section.items.length,
      ratio: 0,
    }));

    allQuestions.forEach((question) => {
      const isYes = state.answers[question.id] === 'yes';
      byTrl[question.trl].total += 1;
      if (isYes) byTrl[question.trl].yes += 1;
    });
    DATA.sections.forEach((section, index) => {
      section.items.forEach((item) => {
        if (state.answers[item.id] === 'yes') byCategory[index].yes += 1;
      });
      byCategory[index].ratio = byCategory[index].yes / byCategory[index].total;
    });
    for (let level = 1; level <= 9; level += 1) {
      byTrl[level].ratio = byTrl[level].yes / byTrl[level].total;
    }

    // RESULTADOS!J21 — nivel más alto que supera su umbral, evaluando de 9 a 1.
    let achieved = 0;
    for (let level = 9; level >= 1; level -= 1) {
      if (byTrl[level].ratio > byTrl[level].threshold) { achieved = level; break; }
    }

    const answered = allQuestions.filter((q) => state.answers[q.id]).length;

    return {
      byTrl,
      byCategory,
      achieved,
      maturity: DATA.maturity[achieved],
      answered,
      total: allQuestions.length,
    };
  }

  // ═══════════════════════ Construcción de la interfaz ═══════════════════════

  const TABS = [
    { id: 'guia', label: 'Guía' },
    { id: 'perfil', label: 'Perfil' },
  ]
    .concat(DATA.sections.map((section, index) => ({
      id: 's' + index,
      label: `${index + 1}. ${section.short}`,
      short: section.short,
      section: index,
    })))
    .concat([
      { id: 'resultados', label: 'Resultados' },
      { id: 'plan', label: 'Ruta TRL 9' },
      { id: 'glosario', label: 'Glosario' },
    ]);

  /* Las 7 secciones del cuestionario se agrupan como casillas numeradas: con
     etiquetas de texto la barra no cabía y obligaba a desplazarla en horizontal.
     El nombre completo va en title/aria-label, y la sección abierta lo repite
     en su encabezado, así que no se pierde información. */
  function buildTabs() {
    const render = (tab) => {
      if (tab.section === undefined) {
        return `<button type="button" class="tab" data-tab="${tab.id}">${escapeHtml(tab.label)}</button>`;
      }
      const name = `Sección ${tab.section + 1} de ${DATA.sections.length}: ${tab.short}`;
      return `<button type="button" class="tab tab-num" data-tab="${tab.id}"
        title="${escapeHtml(name)}" aria-label="${escapeHtml(name)}">${tab.section + 1}</button>`;
    };

    const before = TABS.filter((tab) => tab.section === undefined && ['guia', 'perfil'].includes(tab.id));
    const sections = TABS.filter((tab) => tab.section !== undefined);
    const after = TABS.filter((tab) => tab.section === undefined && !['guia', 'perfil'].includes(tab.id));

    $('#tabs').innerHTML =
      before.map(render).join('') +
      `<span class="tab-group">
         <span class="tab-group-label" aria-hidden="true">Cuestionario</span>
         ${sections.map(render).join('')}
       </span>` +
      after.map(render).join('');
  }

  function buildGuide() {
    $('#guide-intro').innerHTML = DATA.guide
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join('');

    $('#levels-list').innerHTML = DATA.levels
      .slice()
      .reverse()
      .map((level) => `
        <details class="level">
          <summary>
            <span class="lvl-stage">${escapeHtml(level.stage)}</span>
            <span class="lvl-code">TRL ${level.trl}</span>
            <span>${escapeHtml(level.name)}</span>
          </summary>
          <p>${escapeHtml(level.description)}</p>
        </details>`).join('');
  }

  function buildQuestionPanels() {
    $('#question-panels').innerHTML = DATA.sections.map((section, index) => {
      const questions = section.items.map((item) => `
        <div class="qcard" data-question="${item.id}">
          <div class="qcode"><b>${escapeHtml(item.id)}</b><span>TRL ${item.trl}</span></div>
          <div class="qtext">${withGlossary(item.text)}</div>
          <div class="choice">
            <input type="radio" id="q-${item.id}-yes" name="q-${item.id}" value="yes">
            <label for="q-${item.id}-yes">Sí</label>
            <input type="radio" id="q-${item.id}-no" name="q-${item.id}" value="no">
            <label for="q-${item.id}-no">No</label>
          </div>
        </div>`).join('');

      const prev = TABS[TABS.findIndex((t) => t.id === 's' + index) - 1];
      const next = TABS[TABS.findIndex((t) => t.id === 's' + index) + 1];

      return `
        <section class="panel" id="panel-s${index}" data-panel="s${index}" hidden>
          <div class="section-head">
            <span class="eyebrow">Sección ${index + 1} de ${DATA.sections.length}</span>
            <h1>${escapeHtml(section.title)}</h1>
            <div class="section-status">
              <span class="section-progress" data-section-progress="${index}"></span>
              <span class="section-tools no-print">
                <label class="switch">
                  <input type="checkbox" data-filter-pending="${index}">
                  <span>Solo sin responder</span>
                </label>
                <button type="button" class="btn btn-sm" data-jump="${index}">Ir a la siguiente sin responder</button>
              </span>
            </div>
          </div>
          <div class="qlist" data-qlist="${index}">${questions}</div>
          <p class="empty no-print" data-all-done="${index}" hidden>Todas las preguntas de esta sección están respondidas.</p>
          <div class="section-nav no-print">
            <button type="button" class="btn" data-goto="${prev.id}">← ${escapeHtml(prev.label)}</button>
            <button type="button" class="btn btn-primary" data-goto="${next.id}">${escapeHtml(next.label)} →</button>
          </div>
        </section>`;
    }).join('');
  }

  function buildGlossary() {
    const render = (filter) => {
      const term = (filter || '').trim().toLowerCase();
      const entries = DATA.glossary.filter(
        (entry) => !term || entry.term.toLowerCase().includes(term) || entry.definition.toLowerCase().includes(term)
      );
      $('#glossary-list').innerHTML = entries.length
        ? entries.map((entry) => `
            <div>
              <dt>${escapeHtml(entry.term)}</dt>
              <dd>${escapeHtml(entry.definition)}</dd>
            </div>`).join('')
        : '<p class="empty">Ningún término coincide con la búsqueda.</p>';
    };
    render('');
    $('#glossary-search').addEventListener('input', (event) => render(event.target.value));
  }

  // ═══════════════════════ Renderizado dependiente del estado ═══════════════════════

  function renderAnswers() {
    allQuestions.forEach((question) => {
      const answer = state.answers[question.id];
      const card = $(`.qcard[data-question="${question.id}"]`);
      if (!card) return;
      card.dataset.answer = answer || '';
      $$(`input[name="q-${question.id}"]`).forEach((input) => {
        input.checked = input.value === answer;
      });
    });
  }

  function renderProgress() {
    DATA.sections.forEach((section, index) => {
      const answered = section.items.filter((item) => state.answers[item.id]).length;
      const total = section.items.length;
      const label = $(`[data-section-progress="${index}"]`);
      if (label) label.textContent = `${answered} de ${total} preguntas respondidas`;
      const tab = $(`.tab[data-tab="s${index}"]`);
      if (tab) tab.dataset.state = answered === 0 ? 'empty' : answered === total ? 'done' : 'partial';
      applySectionFilter(index);
    });

    const answered = allQuestions.filter((q) => state.answers[q.id]).length;
    $('#global-bar').style.width = (answered / allQuestions.length) * 100 + '%';
  }

  /* Filtro "solo sin responder": oculta las tarjetas ya contestadas para que en
     una sesión larga se vea de un vistazo lo que queda. Se aplica sobre el DOM
     existente en vez de regenerarlo, para no perder el foco del teclado. */
  function applySectionFilter(index) {
    const toggle = $(`[data-filter-pending="${index}"]`);
    if (!toggle) return;
    const onlyPending = toggle.checked;
    const section = DATA.sections[index];
    let visible = 0;

    section.items.forEach((item) => {
      const card = $(`.qcard[data-question="${item.id}"]`);
      if (!card) return;
      const hide = onlyPending && Boolean(state.answers[item.id]);
      card.hidden = hide;
      if (!hide) visible += 1;
    });

    const notice = $(`[data-all-done="${index}"]`);
    if (notice) notice.hidden = !(onlyPending && visible === 0);
  }

  /* Lleva el foco a la primera pregunta sin responder, de la sección actual o,
     si ya está completa, de la siguiente que tenga pendientes. */
  function jumpToPending(index) {
    const order = DATA.sections
      .map((section, i) => ({ section, i }))
      .slice(index)
      .concat(DATA.sections.map((section, i) => ({ section, i })).slice(0, index));

    for (const entry of order) {
      const next = entry.section.items.find((item) => !state.answers[item.id]);
      if (!next) continue;
      if (entry.i !== index) show('s' + entry.i);
      const input = $(`#q-${CSS.escape(next.id)}-yes`);
      const card = $(`.qcard[data-question="${next.id}"]`);
      if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (input) input.focus({ preventScroll: true });
      return;
    }
    toast('No quedan preguntas sin responder');
  }

  function barRow(label, sub, ratio, threshold, reached) {
    const width = Math.min(100, ratio * 100);
    const marker = threshold === undefined ? '' :
      `<span class="bar-threshold" style="left:${threshold * 100}%" title="Umbral: ${pct(threshold)} %"></span>`;
    const valueText = threshold === undefined
      ? `<b>${pct(ratio)} %</b>`
      : `<b>${pct(ratio)} %</b> / ${pct(threshold)} %`;
    return `
      <div class="bar-row"${reached === undefined ? '' : ` data-reached="${reached}"`}>
        <span class="bar-label">${escapeHtml(label)}<small>${escapeHtml(sub)}</small></span>
        <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span>${marker}</span>
        <span class="bar-value">${valueText}</span>
      </div>`;
  }

  function renderResults() {
    const result = computeResults();
    const level = DATA.levels.find((item) => item.trl === result.achieved);

    // Aviso de cuestionario incompleto
    const warning = $('#results-warning');
    if (result.answered < result.total) {
      warning.hidden = false;
      warning.innerHTML = `<strong>Diagnóstico incompleto.</strong> Ha respondido ${result.answered} de ${result.total} preguntas.
        Las preguntas sin responder cuentan como <b>No</b>, por lo que el nivel mostrado puede subestimar la madurez real.`;
    } else {
      warning.hidden = true;
    }

    // Tarjeta principal
    const nextLevel = result.achieved < 9 ? result.byTrl[result.achieved + 1] : null;
    const nextPending = result.achieved < 9
      ? allQuestions.filter((q) => q.trl === result.achieved + 1 && state.answers[q.id] !== 'yes').length
      : 0;

    $('#score-card').innerHTML = `
      <div class="score-main">
        <div class="label">Nivel TRL alcanzado</div>
        <div class="big">${result.achieved || '—'}</div>
        <div class="maturity">${escapeHtml(result.maturity)}</div>
      </div>
      <div class="score-side">
        ${level ? `
          <span class="stage">${escapeHtml(level.stage)}</span>
          <h3>${escapeHtml(level.name)}</h3>
          <p>${escapeHtml(level.description)}</p>`
        : `<h3>Aún no se alcanza el TRL 1</h3>
           <p>Ninguno de los niveles supera su umbral de cumplimiento. Revise las preguntas de TRL 1 y 2:
              son la base sobre la que se apoyan todos los niveles superiores.</p>`}
        ${nextLevel ? `
          <div class="next"><b>Siguiente objetivo — TRL ${result.achieved + 1}:</b>
            ${pct(nextLevel.ratio)} % completado frente al umbral de ${pct(nextLevel.threshold)} %.
            ${conj(nextPending, 'Queda', 'Quedan')} <b>${nextPending}</b>
            ${conj(nextPending, 'actividad', 'actividades')} por cerrar en ese nivel.
            <button type="button" class="linklike go-plan no-print" data-goto="plan">Ver la ruta completa hasta TRL 9 →</button></div>`
        : '<div class="next"><b>Máximo nivel alcanzado.</b> La tecnología opera en su forma final bajo el rango completo de condiciones previstas.</div>'}
      </div>`;

    // Barras por nivel TRL
    const trlRows = [];
    for (let lvl = 9; lvl >= 1; lvl -= 1) {
      const item = result.byTrl[lvl];
      trlRows.push(barRow(
        `TRL ${lvl}`,
        `${item.yes} de ${item.total} "Sí"`,
        item.ratio,
        item.threshold,
        item.ratio > item.threshold
      ));
    }
    $('#bars-trl').innerHTML = trlRows.join('');

    // Barras por categoría
    $('#bars-cat').innerHTML = result.byCategory
      .map((cat, index) => barRow(`${index + 1}. ${cat.short}`, `${cat.yes} de ${cat.total} "Sí"`, cat.ratio))
      .join('');

    // Detalle por categoría
    $('#detail-grid').innerHTML = DATA.sections.map((section, index) => {
      const chips = section.items.map((item) => {
        const answer = state.answers[item.id] || '';
        return `<span class="chip" data-answer="${answer}" title="${escapeHtml(item.text)}">${escapeHtml(item.id)}</span>`;
      }).join('');
      const cat = result.byCategory[index];
      return `
        <div class="detail-block">
          <h3>${index + 1}. ${escapeHtml(section.short)} <span>${cat.yes}/${cat.total}</span></h3>
          <div class="detail-items">${chips}</div>
        </div>`;
    }).join('');

    // Cabecera del informe impreso
    const profileRows = PROFILE_FIELDS
      .map(([key, label]) => `<div><b>${escapeHtml(label)}:</b> ${escapeHtml(state.profile[key] || '—')}</div>`)
      .join('');
    $('#report-meta').innerHTML = `
      ${profileRows}
      <div class="full"><b>Fecha del diagnóstico:</b> ${new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
      <div class="full"><b>Descripción:</b> ${escapeHtml(state.profile.descripcion || '—')}</div>`;
  }

  /* Ruta de maduración: para cada nivel, cuántas actividades faltan para superar
     su umbral. Como el umbral es un porcentaje y la comparación es estricta (>),
     el mínimo de respuestas "Sí" es floor(umbral × total) + 1. El epsilon evita
     que un producto como 0,6 × 10 = 5,999… exija una actividad de menos. */
  function buildRoadmap() {
    const result = computeResults();
    const levels = [];

    for (let lvl = 1; lvl <= 9; lvl += 1) {
      const stats = result.byTrl[lvl];
      const items = allQuestions.filter((q) => q.trl === lvl);
      const pending = items.filter((q) => state.answers[q.id] !== 'yes');
      const needed = Math.min(items.length, Math.floor(stats.threshold * items.length + 1e-9) + 1);
      const definition = DATA.levels.find((entry) => entry.trl === lvl);

      levels.push({
        trl: lvl,
        name: definition ? definition.name : '',
        stage: definition ? definition.stage : '',
        yes: stats.yes,
        total: items.length,
        ratio: stats.ratio,
        threshold: stats.threshold,
        consolidated: stats.ratio > stats.threshold,
        needed,
        missing: Math.max(0, needed - stats.yes),
        items,
        pending,
      });
    }

    // El cuello de botella es el nivel más bajo sin consolidar: bloquea la ruta.
    const bottleneck = levels.find((level) => !level.consolidated);
    return { result, levels, bottleneck };
  }

  function renderPlan() {
    const onlyPending = $('#plan-only-pending').checked;
    const road = buildRoadmap();
    const totalPending = allQuestions.filter((q) => state.answers[q.id] !== 'yes').length;
    const remainingLevels = road.levels.filter((level) => !level.consolidated).length;

    // ── Resumen y línea de progreso ───────────────────────────────────────
    const stepper = road.levels.map((level) => {
      const stateName = level.consolidated ? 'done'
        : road.bottleneck && level.trl === road.bottleneck.trl ? 'next' : 'todo';
      return `<span class="step" data-state="${stateName}" title="TRL ${level.trl}: ${pct(level.ratio)} % de ${pct(level.threshold)} %">${level.trl}</span>`;
    }).join('');

    $('#plan-summary').innerHTML = `
      <div class="road-summary">
        <div class="road-summary-head">
          <div>
            <span class="label">Situación actual</span>
            <b>TRL ${road.result.achieved || '—'}</b>
            <small>${escapeHtml(road.result.maturity)}</small>
          </div>
          <span class="road-arrow" aria-hidden="true">→</span>
          <div>
            <span class="label">Meta</span>
            <b>TRL 9</b>
            <small>Producción</small>
          </div>
          <div class="road-counts">
            <div><b>${totalPending}</b><span>actividades pendientes</span></div>
            <div><b>${remainingLevels}</b><span>niveles por consolidar</span></div>
          </div>
        </div>
        <div class="stepper">${stepper}</div>
        ${road.bottleneck ? `
          <p class="road-focus"><b>Empiece por el TRL ${road.bottleneck.trl}.</b>
            Es el nivel más bajo sin consolidar, así que marca el paso siguiente de la ruta:
            necesita <b>${road.bottleneck.needed}</b> de ${road.bottleneck.total} actividades hechas para superar
            su umbral del ${pct(road.bottleneck.threshold)} % y lleva ${road.bottleneck.yes},
            así que <b>${conj(road.bottleneck.missing, 'le falta', 'le faltan')} ${road.bottleneck.missing}</b>.</p>`
        : '<p class="road-focus"><b>Todos los niveles están consolidados.</b> La tecnología ha completado la ruta hasta el TRL 9.</p>'}
      </div>`;

    // ── Recomendaciones nivel por nivel ───────────────────────────────────
    const blocks = road.levels.map((level) => {
      const visible = onlyPending ? level.pending : level.items;
      if (onlyPending && !visible.length) return '';

      const isNext = road.bottleneck && level.trl === road.bottleneck.trl;
      const stateName = level.consolidated ? 'done' : isNext ? 'next' : 'todo';
      const stateLabel = level.consolidated ? 'Umbral superado' : isNext ? 'Siguiente paso' : 'Pendiente';

      const left = level.pending.length;
      let meta;
      if (level.consolidated && !left) {
        meta = `Nivel completo: las ${level.total} actividades están hechas.`;
      } else if (level.consolidated) {
        meta = `Umbral superado (${pct(level.ratio)} % frente al ${pct(level.threshold)} % exigido).
          ${conj(left, 'Queda', 'Quedan')} ${count(left, 'actividad recomendada', 'actividades recomendadas')}
          para completar el nivel al 100 %.`;
      } else {
        meta = `Necesita al menos <b>${level.needed}</b> de ${level.total} actividades hechas para superar el
          umbral del ${pct(level.threshold)} %. Lleva ${level.yes}, así que
          <b>${conj(level.missing, 'falta', 'faltan')} ${level.missing}</b>.
          En este nivel ${conj(left, 'queda', 'quedan')} ${count(left, 'actividad pendiente', 'actividades pendientes')}.`;
      }

      const rows = visible.map((question) => {
        const done = state.answers[question.id] === 'yes';
        return `
          <div class="plan-item" data-done="${done}">
            <span class="plan-badge">${escapeHtml(question.id)}</span>
            <span class="plan-text">${escapeHtml(question.action)}<small>${escapeHtml(question.section)}</small></span>
            <span class="plan-status" data-done="${done}">${done ? 'Hecha' : 'Pendiente'}</span>
          </div>`;
      }).join('');

      return `
        <section class="road-level" data-state="${stateName}">
          <header class="road-level-head">
            <span class="road-num">TRL ${level.trl}</span>
            <div class="road-title">
              <span class="road-stage">${escapeHtml(level.stage)}</span>
              <h2>${escapeHtml(level.name)}</h2>
            </div>
            <span class="road-chip" data-state="${stateName}">${stateLabel}</span>
          </header>
          <p class="road-meta">${meta}</p>
          ${rows}
        </section>`;
    }).join('');

    $('#plan-list').innerHTML = blocks ||
      '<p class="empty">No hay actividades pendientes: todas las preguntas están respondidas con «Sí».</p>';
  }

  // ═══════════════════════ Navegación ═══════════════════════

  function show(tabId) {
    const known = TABS.some((tab) => tab.id === tabId);
    const target = known ? tabId : 'guia';

    $$('.panel').forEach((panel) => { panel.hidden = panel.dataset.panel !== target; });
    $$('.tab').forEach((tab) => tab.setAttribute('aria-current', String(tab.dataset.tab === target)));

    if (target === 'resultados') renderResults();
    if (target === 'plan') renderPlan();

    if (location.hash !== '#' + target) history.replaceState(null, '', '#' + target);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // ═══════════════════════ Import / export ═══════════════════════

  function exportJson() {
    const payload = {
      herramienta: 'Diagnóstico TRL — UPTC',
      version: 1,
      fecha: new Date().toISOString(),
      perfil: state.profile,
      respuestas: state.answers,
      resultado: (() => {
        const result = computeResults();
        return { trl: result.achieved, nivelDesarrollo: result.maturity, respondidas: result.answered, total: result.total };
      })(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const slug = (state.profile.tecnologia || 'diagnostico-trl')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'diagnostico-trl';
    link.href = url;
    link.download = `${slug}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Respuestas exportadas');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const answers = parsed.respuestas || parsed.answers;
        const profile = parsed.perfil || parsed.profile;
        if (!answers || typeof answers !== 'object') throw new Error('Formato no reconocido');

        const valid = {};
        allQuestions.forEach((question) => {
          const value = answers[question.id];
          if (value === 'yes' || value === 'no') valid[question.id] = value;
        });
        state.answers = valid;
        state.profile = profile && typeof profile === 'object' ? profile : {};

        save();
        fillProfileForm();
        renderAnswers();
        renderProgress();
        renderResults();
        toast(`Importadas ${Object.keys(valid).length} respuestas`);
      } catch (err) {
        toast('El archivo no es un diagnóstico válido');
        console.warn(err);
      }
    };
    reader.readAsText(file);
  }

  function fillProfileForm() {
    $$('#profile-form [name]').forEach((field) => {
      field.value = state.profile[field.name] || '';
    });
  }

  // ═══════════════════════ Tema ═══════════════════════

  function applyTheme(theme) {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    $('[data-theme-icon]').textContent = theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐';
  }

  // ═══════════════════════ Arranque ═══════════════════════

  function init() {
    load();

    buildTabs();
    buildGuide();
    buildQuestionPanels();
    buildGlossary();
    fillProfileForm();
    renderAnswers();
    renderProgress();

    applyTheme(localStorage.getItem(THEME_KEY));

    // Respuestas y controles por sección
    document.addEventListener('change', (event) => {
      const input = event.target;

      if (input.matches('.choice input[type="radio"]')) {
        const id = input.name.replace(/^q-/, '');
        state.answers[id] = input.value;
        save();
        const card = $(`.qcard[data-question="${id}"]`);
        if (card) card.dataset.answer = input.value;
        renderProgress();
        return;
      }

      if (input.matches('[data-filter-pending]')) {
        applySectionFilter(Number(input.dataset.filterPending));
      }
    });

    document.addEventListener('click', (event) => {
      const jump = event.target.closest('[data-jump]');
      if (jump) jumpToPending(Number(jump.dataset.jump));
    });

    // Perfil (autoguardado)
    $('#profile-form').addEventListener('input', (event) => {
      const field = event.target;
      if (!field.name) return;
      state.profile[field.name] = field.value;
      save();
    });

    // Navegación
    $('#tabs').addEventListener('click', (event) => {
      const tab = event.target.closest('.tab');
      if (tab) show(tab.dataset.tab);
    });
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-goto]');
      if (button) show(button.dataset.goto);
    });
    window.addEventListener('hashchange', () => show(location.hash.slice(1) || 'guia'));

    // Acciones de resultados
    $('#btn-print').addEventListener('click', () => window.print());
    $('#btn-print-plan').addEventListener('click', () => window.print());
    $('#btn-export').addEventListener('click', exportJson);
    $('#btn-import-trigger').addEventListener('click', () => $('#btn-import').click());
    $('#btn-import').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) importJson(file);
      event.target.value = '';
    });
    $('#plan-only-pending').addEventListener('change', renderPlan);

    // Tema
    $('#theme-toggle').addEventListener('click', () => {
      const current = localStorage.getItem(THEME_KEY);
      const next = current === 'dark' ? 'light' : current === 'light' ? '' : 'dark';
      if (next) localStorage.setItem(THEME_KEY, next);
      else localStorage.removeItem(THEME_KEY);
      applyTheme(next);
    });

    // Reinicio: exige doble clic para evitar borrados accidentales.
    const reset = $('#btn-reset');
    let armed = false;
    reset.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        reset.textContent = 'Pulse de nuevo para confirmar el borrado';
        setTimeout(() => { armed = false; reset.textContent = 'Borrar todas las respuestas'; }, 5000);
        return;
      }
      state = { answers: {}, profile: {} };
      localStorage.removeItem(STORAGE_KEY);
      fillProfileForm();
      renderAnswers();
      renderProgress();
      armed = false;
      reset.textContent = 'Borrar todas las respuestas';
      toast('Diagnóstico reiniciado');
      show('guia');
    });

    show(location.hash.slice(1) || 'guia');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
