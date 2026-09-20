/* Application: loads data/*.json lazily per page, routes the top navigation, renders each page (the map first) and the narrative tool. */
'use strict';

const App = (() => {
  const VERSION = '20260922';    // cache-busting query string for every JSON fetch; bump when data/*.json changes
  const D = {};                  // loaded JSON by name
  const rendered = new Set();    // pages already rendered
  const TIERS = ['recordable', 'severe', 'fatal'];
  const TIER_NAME = { recordable: 'Recordable', severe: 'Severe', fatal: 'Fatal' };
  const MECH_ORDER = [];
  let mechName = {}, energyName = {}, heName = {};

  /* ---------------------------------------------------------------- formatting (project style rules) */
  const fmt = {
    dec(v, d = 2) { if (v == null || Number.isNaN(v)) return 'n/a'; return Number(v).toFixed(d).replace(/^(-?)0\./, '$1.'); },
    ratio(v) {
      if (v == null || Number.isNaN(v)) return 'n/a';
      if (v === 0) return '0';
      if (v >= 10) return String(Math.round(v));
      if (v >= 1) return fmt.dec(v, 1);
      return fmt.dec(v, v >= .01 ? 2 : 3);
    },
    pct(v, d = 0) { if (v == null || Number.isNaN(v)) return 'n/a'; return (v * 100).toFixed(d).replace(/^(-?)0\./, '$1.') + '%'; },
    int(v) { return v == null ? 'n/a' : Number(v).toLocaleString('en-US'); },
    p(p) { if (p == null) return ''; return p < .001 ? 'p < .001' : 'p = ' + fmt.dec(p, p < .01 ? 3 : 2); },
    ci(lo, hi) { return `${fmt.ratio(lo)} to ${fmt.ratio(hi)}`; },
  };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const el = id => document.getElementById(id);
  const html = (id, s) => { el(id).innerHTML = s; };

  function seg(id, options, value, onChange) {
    // options: [{v, label}]
    const wrap = document.createElement('span'); wrap.className = 'seg'; wrap.id = id;
    options.forEach(o => {
      const b = document.createElement('button'); b.textContent = o.label; b.dataset.v = o.v;
      if (o.v === value) b.classList.add('on');
      b.onclick = () => { wrap.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(o.v); };
      wrap.appendChild(b);
    });
    return wrap;
  }
  const segValue = id => el(id).querySelector('button.on').dataset.v;
  function tile(value, label, color) { return `<div class="tile ${color || ''}"><div class="value">${value}</div><div class="label">${label}</div></div>`; }
  /* Small info icon whose tooltip (HTML) opens on hover or click; `label` is the accessible name. */
  function info(text, label) { return `<span class="info-wrap"><button type="button" class="info" aria-label="${esc(label || 'More information')}">i</button><span class="tip">${text}</span></span>`; }
  function card(title, chartId, note, cls) {
    return `<div class="card"><h3>${title}${note ? info(note, 'About this chart') : ''}</h3><div id="${chartId}" class="chart ${cls || ''}"></div></div>`;
  }
  /* Tooltip placement: keep the popover inside the viewport; click toggles a pinned state, a click elsewhere closes it. */
  function placeTip(wrap) {
    const tip = wrap.querySelector(':scope > .tip'); if (!tip) return;
    tip.classList.remove('right', 'above'); tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) tip.classList.add('right');
    if (r.bottom > window.innerHeight - 8 && r.top > r.height + 40) tip.classList.add('above');
    tip.style.display = '';
  }
  document.addEventListener('mouseover', e => { const w = e.target.closest && e.target.closest('.info-wrap'); if (w) placeTip(w); });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.info-wrap > button');
    document.querySelectorAll('.info-wrap.open').forEach(w => { if (!b || w !== b.parentElement) w.classList.remove('open'); });
    if (b) { const w = b.parentElement; w.classList.toggle('open'); if (w.classList.contains('open')) placeTip(w); }
  });

  /* ---------------------------------------------------------------- provenance line: OSHA product, filter, script, n, download month */
  const SCRIPT = {
    escalation: 'analysis/04_escalation_ratios_bootstrap/01_escalation_analysis.py', sif: 'analysis/05_lightgbm_sif_model/01_sif_potential_model.py',
    context: 'analysis/06_contextual_logistic_regression/01_contextual_analysis.py', linkage: 'analysis/07_record_linkage_logistic/01_linkage_analysis.py',
    evaluate: 'analysis/03_qlora_llm_coding/04_evaluate.py', student: 'analysis/08_knowledge_distillation_onnx/02_measure_student.py',
    predict: 'analysis/03_qlora_llm_coding/03_predict.py', studentCorpus: 'analysis/08_knowledge_distillation_onnx/03_student_corpus_predictions.py', app: 'web_app/build_data.py',
  };
  function prov(o) {
    // o: {src: subset of ['ita','sir','imis'], filter, script (array or string), n, note}
    const P = D.summary.provenance;
    const src = (o.src || ['ita', 'sir', 'imis']).map(k => `<a href="${P[k].url}" target="_blank" rel="noopener">${esc(P[k].product)}</a> (${esc(P[k].files)})`).join('; ');
    const scripts = [].concat(o.script || []).map(s => `<code>${esc(s)}</code>`).join(', ');
    const text = `Source: ${src}. Scope: ${esc(o.filter || P.scope)}.${o.n != null ? ` n = ${typeof o.n === 'number' ? fmt.int(o.n) : esc(o.n)}.` : ''}${scripts ? ` Script in the <a href="${P.repository}" target="_blank" rel="noopener">repository</a>: ${scripts}.` : ''} Data downloaded ${esc(P.downloaded)}.${o.note ? ' ' + esc(o.note) : ''}`;
    return `<div class="prov-row"><span class="info-wrap"><button type="button" class="source" aria-label="Data source and provenance">Source</button><span class="tip">${text}</span></span></div>`;
  }
  function provAfter(chartId, o) { const c = el(chartId).closest('.card'); if (c) c.insertAdjacentHTML('beforeend', prov(o)); }
  const scopeN = () => { const sc = D.summary.scope_counts; return `${fmt.int(sc.recordable)} recordable, ${fmt.int(sc.severe)} severe, ${fmt.int(sc.fatal)} fatal`; };

  /* ---------------------------------------------------------------- data loading (lazy, per page) and routing */
  const PAGES = ['findings', 'map', 'overview', 'explorer', 'sensitivity', 'highenergy', 'within', 'sif', 'context', 'establishments', 'models', 'cases', 'tool'];
  const INITIAL = ['summary', 'labels', 'hero'];   // what the opening picture needs, nothing else; the map files load with the Map page
  const GROUP = ['overview', 'explorer', 'sensitivity', 'highenergy', 'within', 'sif', 'context', 'establishments', 'models'];   // the pages behind the Analyses tab
  const PRIMARY = [['findings', 'Findings'], ['map', 'Map'], ['overview', 'Analyses'], ['cases', 'Cases'], ['tool', 'Tool']];
  const LANDING = ['', '#findings'].includes(location.hash);   // the picture plays by itself only on the landing view, not on a deep link
  const PAGE_FILES = { findings: [], map: ['us_states', 'state_years', 'monthly'], overview: ['escalation'], explorer: ['escalation'], sensitivity: ['escalation'], highenergy: ['high_energy'], within: ['within_recordable', 'escalation'],
    sif: ['sif'], context: ['context'], establishments: ['establishments'], models: ['models'], cases: ['cases_sample'], tool: ['escalation', 'high_energy', 'sif_lookup', 'examples'] };
  const RENDER = { findings: renderFindings, map: renderMap, overview: renderOverview, explorer: renderExplorer, sensitivity: renderSensitivity, highenergy: renderHighEnergy, within: renderWithin,
    sif: renderSif, context: renderContext, establishments: renderEstablishments, models: renderModels, cases: renderCases, tool: renderTool };
  const pending = {};
  function fetchJson(f) {
    if (D[f]) return Promise.resolve(D[f]);
    if (!pending[f]) pending[f] = fetch(`data/${f}.json?v=${VERSION}`).then(r => { if (!r.ok) throw new Error(`data/${f}.json: HTTP ${r.status}`); return r.json(); })
      .then(j => { D[f] = j; return j; }).catch(e => { delete pending[f]; throw e; });
    return pending[f];
  }
  const need = files => Promise.all(files.map(fetchJson));
  function overlay(show, text) {
    const o = el('overlay'); if (!o) return;
    if (text) el('overlay-text').textContent = text;
    o.classList.toggle('hide', !show);
  }

  async function init() {
    try {
      await need(INITIAL);
    } catch (e) {
      el('overlay-text').innerHTML = `Could not load the data files (${esc(e.message)}). Serve the folder over HTTP, for example <code>python -m http.server</code>, and reload.`;
      return;
    }
    D.labels.mechanism.forEach(m => { mechName[m.code] = m.name; MECH_ORDER.push(m.code); });
    D.labels.energy_source.forEach(e => energyName[e.code] = e.name);
    D.labels.high_energy.forEach(h => heName[h.code] = h.name);
    html('tip-howto', howToText());
    const nav = el('nav');
    PRIMARY.forEach(([p, t]) => { const a = document.createElement('a'); a.href = '#' + p; a.textContent = t; a.dataset.page = p; nav.appendChild(a); });
    GROUP.forEach(p => { const a = document.createElement('a'); a.href = '#' + p; a.textContent = el(p).dataset.title; a.dataset.page = p; el('subnav').appendChild(a); });
    window.addEventListener('hashchange', route);
    await route();
  }

  let routing = 0;
  async function route() {
    let page = (location.hash || '#findings').slice(1);
    if (!PAGES.includes(page)) page = 'findings';
    if (page !== 'findings' && window.Hero && Hero.ready()) Hero.pause();
    PAGES.forEach(p => el(p).classList.toggle('active', p === page));
    const grouped = GROUP.includes(page);
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page || (grouped && a.dataset.page === 'overview')));
    document.querySelectorAll('#subnav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
    el('subnav').hidden = !grouped;
    window.scrollTo(0, 0);
    if (page !== 'findings' && !window.echarts) {   // the chart library loads in the background; only the chart pages wait for it
      overlay(true, 'Loading…'); const t0 = Date.now();
      while (!window.echarts && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 60));
      if (!window.echarts) { html(page + '-body', 'The chart library could not be loaded. Check the connection and reload.'); overlay(false); return; }
    }
    if (!rendered.has(page)) {
      const files = PAGE_FILES[page].filter(f => !D[f]);
      const token = ++routing;
      if (files.length) {
        overlay(true, page === 'cases' ? 'Loading the case sample (about 650 KB)…' : 'Loading…');
        try { await need(files); } catch (e) { html(page + '-body', `Could not load the data (${esc(e.message)}).`); overlay(false); return; }
        if (token !== routing) return;   // the user moved on while this page was loading
      }
      rendered.add(page);
      RENDER[page]();
      if (page === 'map') await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));   // let the map paint under the overlay
      overlay(false);
    }
    Charts.resizeAll();
    if (page === 'findings' && window.Hero && Hero.ready()) Hero.resize();
    // a section id equals its hash, so on a revisit the browser scrolls the section under the sticky header after this handler: undo it
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  function howToText() {
    const S = D.summary, sc = S.scope_counts;
    return `<p><b>Findings</b> opens with the accident triangle split by injury mechanism. <b>Map</b> animates state counts by tier through the years. <b>Analyses</b> holds the detailed pages: <b>Overview</b> gives the headline numbers. <b>Escalation</b> shows shares by tier and the ratios with intervals, for mechanisms or energy sources. <b>Sensitivity</b> repeats the ratios under other scopes and undercount factors. <b>High energy</b> and <b>Within recordables</b> contrast the two severity signals available inside the recordable tier. <b>SIF potential</b> summarizes the case-level model. <b>Context</b> covers shift hour, season, weekday, occupation and establishment size. <b>Establishments</b> links severe reports to ITA establishments. <b>Models</b> documents coder accuracy. <b>Cases</b> lists sampled narratives with links to the OSHA records.</p>
      <p><b>Tool</b> codes a narrative you paste and returns its escalation ratios, high-energy share and SIF potential index, all computed locally in your browser.</p>
      <p>Corpus: ${fmt.int(S.corpus_n)} construction narratives coded; main analytic scope ${fmt.int(sc.recordable + sc.severe + sc.fatal)} cases in ${S.n_states} federal OSHA states. Every chart has a Source link with the OSHA product, filter, n and script.</p>`;
  }

  /* ---------------------------------------------------------------- findings (landing page): the animated triangle picture and the three research questions */
  function renderFindings() {
    const Hd = D.hero, named = Hd.mechanisms.filter(m => !m.other), hi = named[0], lo = named[named.length - 1];
    const q = (href, n, text, value, label, color) => `<a class="tile q ${color}" href="${href}"><div class="qn">${n}</div><div class="qt">${text}</div><div class="value">${value}</div><div class="label">${label}</div></a>`;
    html('findings-body', `<div class="hero" id="hero"></div><div class="tiles qs">` +
      q('#explorer', 'RQ1', 'Does each mechanism hold a fixed share across the three tiers?', `${fmt.ratio(lo.er_fatal[0])} to ${fmt.ratio(hi.er_fatal[0])}`, `fatal ratio, ${lo.name.toLowerCase()} to ${hi.name.toLowerCase()}`, 'blue') +
      q('#highenergy', 'RQ2', 'Do minor and serious injuries share their mechanism and their energy level?', `${fmt.pct(Hd.he_share.recordable)} to ${fmt.pct(Hd.he_share.fatal)}`, 'high-energy exposure, recordable cases to fatalities', 'pink') +
      q('#sif', 'RQ3', 'Can the attributes of a narrative rank cases by their potential to become a serious injury or fatality?', 'SIF potential index', 'from mechanism, energy source and the high-energy flag', 'green') +
      `</div>` + prov({ n: scopeN(), script: [SCRIPT.escalation, 'web_app/build_hero.py'], note: 'Each dot of the picture is one tenth of a percent of its tier, so the width of a layer is the share of the mechanism in that tier.' }));
    Hero.mount(el('hero'), Hd, fmt, LANDING);
  }

  /* ---------------------------------------------------------------- map: choropleth with a year timeline, monthly counts below */
  const METRICS = {
    severe: { label: 'Severe injury reports', short: 'Severe', tier: 'severe', color: 'green' },
    fatal: { label: 'Fatality investigations', short: 'Fatal', tier: 'fatal', color: 'pink' },
    recordable: { label: 'Recordable cases', short: 'Recordable', tier: 'recordable', color: 'blue' },
    he: { label: 'High-energy share of recordables', short: 'High-energy share', tier: 'recordable', color: 'gray', share: true },
  };
  // one hue per tier as everywhere in the app, each a smooth light-to-dark ramp; the share measure has its own hue so it is not read as a count
  const RAMP = { green: ['#F4FAF2', '#CFE8C6', '#8CC98A', '#3E9B5A', '#14603A'], pink: ['#FDF1F4', '#F8C9D6', '#EE8DB2', '#C2408F', '#6B0F6B'],
                 blue: ['#F2F8FC', '#CBE2F1', '#86BFE0', '#3583BD', '#0C447F'], gray: ['#F7F4FA', '#DAD3EA', '#AFA0D1', '#7A5BB0', '#452A7A'] };
  const SMALL = new Set(['RI', 'CT', 'MA', 'NJ', 'DE', 'MD', 'DC', 'VT', 'NH']);
  const HATCH = { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [1, 5], rotation: Math.PI / 4, color: 'rgba(0,0,0,.13)', symbolSize: 1 };
  const MAP_ASPECT = 1.62;   // width over height of the contiguous states in the Albers projection
  function renderMap() {
    const SY = D.state_years, G = D.us_states, MO = D.monthly;
    echarts.registerMap('us', G);
    const abbrOf = {}; G.features.forEach(f => abbrOf[f.properties.name] = f.properties.abbr);
    const fedStates = Object.keys(SY.states).filter(a => SY.states[a].federal && G.features.some(f => f.properties.abbr === a));
    const Y = SY.years;
    html('map-body', `
      <div class="controls">
        <span class="group"><span>Colour by</span><span id="mp-metric"></span></span>
        <span class="map-legend"><span class="sw"></span> State plan states, outside the main scope</span>
        <span class="map-year" id="map-year" aria-live="polite"></span>
        <span class="year-note">${Y.severe[0]} to ${Y.severe[Y.severe.length - 1]}, recordable from ${Y.recordable[0]}; ${fedStates.length} federal OSHA states</span>
      </div>
      <div class="map-wrap"><div id="map-chart"></div></div>
      ${prov({ filter: `construction (NAICS 23), all states; counts by the state of the incident over the years of the main scope, federal OSHA states coloured`, n: `${fmt.int(fedStates.reduce((a, s) => a + SY.states[s].n.recordable, 0))} recordable, ${fmt.int(fedStates.reduce((a, s) => a + SY.states[s].n.severe, 0))} severe, ${fmt.int(fedStates.reduce((a, s) => a + SY.states[s].n.fatal, 0))} fatal in the coloured states`, script: [SCRIPT.escalation, SCRIPT.app], note: 'Boundaries: Census cartographic boundary file 1:20,000,000 (2023), simplified.' })}
      <div class="card" style="margin-top:1rem"><h3>Cases per month by tier${info('Main scope (federal OSHA states), by month of the incident date. Recordable cases exist only for 2023 and 2024, the ITA case-detail years inside the scope. The shaded band follows the year selected on the map.', 'About this chart')}</h3><div id="map-monthly"></div>${prov({ n: scopeN(), script: SCRIPT.escalation, note: 'Monthly counts as in the data landscape figure of the paper.' })}</div>`);
    const state = { metric: 'severe', frame: 0, frames: [] };
    el('mp-metric').replaceWith(seg('mp-metric', Object.keys(METRICS).map(k => ({ v: k, label: METRICS[k].short })), state.metric, v => { state.metric = v; state.frame = 0; draw(); }));
    const chart = Charts.init('map-chart');

    /* the largest box of the country's own proportions that fits above the timeline */
    function mapBox() {
      const w = chart.getWidth() - 16, top = 6, h = chart.getHeight() - top - 64;
      const width = Math.min(w, h * MAP_ASPECT); return { size: Math.round(width), cy: Math.round(top + h / 2) };
    }
    function valueOf(abbr, y) {
      const st = SY.states[abbr], M = METRICS[state.metric]; if (!st) return null;
      if (M.share) return y === 'All' ? st.he[M.tier] : st.he_year[M.tier][y];
      return y === 'All' ? st.n[M.tier] : st.by_year[M.tier][y];
    }
    function tooltip(p) {
      const a = abbrOf[p.name], st = SY.states[a], y = state.frames[state.frame] || 'All';
      if (!st) return `<b>${p.name}</b><br>No cases in the corpus.`;
      const yr = t => (y === 'All' || !Y[t].includes(Number(y))) ? null : st.by_year[t][y];
      const line = t => `${TIER_NAME[t]}: ${y !== 'All' && yr(t) != null ? `<b>${fmt.int(yr(t))}</b> in ${y}, ` : ''}${fmt.int(st.n[t])} in ${Y[t][0]} to ${Y[t][Y[t].length - 1]}`;
      const top = t => st.top_mech[t] ? `${mechName[st.top_mech[t][0]] || st.top_mech[t][0]} (${fmt.pct(st.top_mech[t][1])} of ${t})` : 'n/a';
      return `<b>${p.name}</b> <span style="color:#444">${st.federal ? 'federal OSHA state, main scope' : 'state plan state, outside the main scope'}</span><br>` +
        TIERS.map(line).join('<br>') +
        `<br>High-energy share: recordables ${fmt.pct(st.he.recordable)}, severe ${fmt.pct(st.he.severe)}, fatal ${fmt.pct(st.he.fatal)}` +
        `<br>Top mechanism: ${top('fatal')}; ${top('recordable')}`;
    }
    function draw() {
      const M = METRICS[state.metric], years = Y[M.tier];
      state.frames = years.map(String).concat('All');
      const dataFor = (y, max) => G.features.map(f => {
        const a = f.properties.abbr, st = SY.states[a], federal = st && st.federal, v = federal ? valueOf(a, y) : null;
        // too small for a permanent label (the name shows on hover); on the dark end of the ramp the label turns white
        const small = SMALL.has(a) ? { label: { show: false } } : { label: { color: federal && v / max > .55 ? '#fff' : '#333' } };
        return federal ? Object.assign({ name: f.properties.name, value: v }, small) : Object.assign({ name: f.properties.name, value: null, itemStyle: { areaColor: '#F1F1F1', decal: HATCH }, emphasis: { itemStyle: { areaColor: '#E6E6E6' } } }, small);
      });
      const narrow = chart.getWidth() < 700;
      const maxYear = Math.max(...fedStates.flatMap(a => years.map(y => valueOf(a, String(y)) || 0)));
      const maxAll = Math.max(...fedStates.map(a => valueOf(a, 'All') || 0));
      const visual = max => ({ type: 'continuous', min: 0, max: M.share ? Math.ceil(max * 20) / 20 : max, calculable: false, orient: 'horizontal', left: 24, bottom: 58, itemWidth: 12, itemHeight: 160,
        inRange: { color: RAMP[M.color] }, text: [M.share ? fmt.pct(Math.ceil(max * 20) / 20) : fmt.int(max), '0'], textStyle: { color: '#000', fontSize: 11 }, outOfRange: { color: '#F9F9F9' }, seriesIndex: 0 });
      chart.setOption({
        baseOption: {
          textStyle: { color: '#000', fontFamily: 'Segoe UI, Helvetica Neue, Arial, sans-serif', fontSize: 12 },
          animationDurationUpdate: 700, animationEasingUpdate: 'cubicInOut',
          timeline: { axisType: 'category', data: state.frames, currentIndex: Math.min(state.frame, state.frames.length - 1), autoPlay: true, playInterval: 1400, loop: true, bottom: 4, left: 50, right: 40,
            symbol: 'circle', symbolSize: 7, label: { color: '#000', fontSize: 11 }, lineStyle: { color: '#000', width: 1 }, itemStyle: { color: '#fff', borderColor: '#000', borderWidth: 1 },
            checkpointStyle: { color: '#000', borderColor: '#000', symbolSize: 11, animationDuration: 300 }, progress: { lineStyle: { color: '#000', width: 1 }, itemStyle: { color: '#000', borderColor: '#000' }, label: { color: '#000' } },
            controlStyle: { color: '#000', borderColor: '#000', itemSize: 18, itemGap: 10 }, emphasis: { itemStyle: { color: '#000' }, label: { color: '#000' } } },
          tooltip: Object.assign({ trigger: 'item', formatter: tooltip }, Charts.tooltipBox()),
          series: [{ type: 'map', map: 'us', name: M.label, projection: Charts.albersUSA(), roam: false, aspectScale: 1, layoutCenter: ['50%', (mapBox().cy) + 'px'], layoutSize: mapBox().size,   // a centre and one size keep the shape of the country at any window size
            itemStyle: { areaColor: '#F1F1F1', borderColor: '#fff', borderWidth: .8 },
            emphasis: { label: { show: true, color: '#000', fontSize: 11 }, itemStyle: { areaColor: 'inherit', borderColor: '#000', borderWidth: 1.4 } }, select: { disabled: true },
            label: { show: true, formatter: p => abbrOf[p.name] || '', fontSize: 10, color: '#000' }, labelLayout: { hideOverlap: true } }],
        },
        options: state.frames.map(y => ({
          visualMap: visual(y === 'All' ? maxAll : maxYear),
          series: [{ data: dataFor(y, (y === 'All' ? maxAll : maxYear) || 1) }],
        })),
      }, { notMerge: true });
      showYear(); syncMonthly();
    }
    // the year stands in the controls row, outside the chart, so it can never sit on a state at any window size
    const showYear = () => { const y = state.frames[state.frame] || 'All'; el('map-year').textContent = y === 'All' ? 'All years' : y; };
    chart.on('timelinechanged', e => { state.frame = e.currentIndex; showYear(); syncMonthly(); });
    let mapRt; window.addEventListener('resize', () => { clearTimeout(mapRt); mapRt = setTimeout(() => { if (el('map').classList.contains('active')) { chart.resize(); chart.setOption({ baseOption: { series: [{ layoutCenter: ['50%', mapBox().cy + 'px'], layoutSize: mapBox().size }] } }); } }, 120); });

    // monthly counts: a compact line chart with a progressive first draw; the shaded year follows the timeline
    const x = MO.ym;
    const monthly = Charts.lines({ el: 'map-monthly', x, valueName: 'Cases per month', min: 0, height: 230, animationDuration: 1800, xLabelInterval: 11, xLabelFormatter: v => v.slice(0, 4), grid: { left: 60, right: 24, top: 30, bottom: 30 },
      series: TIERS.map(t => ({ name: TIER_NAME[t], color: Charts.TIER_COLOR[t], data: MO[t], symbol: 'none', width: 1.6 })),
      tooltipFormatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(p => p.value != null).map(p => `${p.marker} ${p.seriesName}: ${fmt.int(p.value)}`).join('<br>') });
    monthly.setOption({ series: TIERS.map(() => ({ symbolSize: 4, showSymbol: false })) });
    function syncMonthly() {
      const y = state.frames[state.frame];
      const data = y && y !== 'All' && x.includes(`${y}-01`) ? [[{ xAxis: `${y}-01` }, { xAxis: `${y}-12` }]] : [];
      monthly.setOption({ series: [{ markArea: { silent: true, itemStyle: { color: 'rgba(0,0,0,.07)' }, data } }] });
    }
    draw();
  }

  /* ---------------------------------------------------------------- overview */
  function renderOverview() {
    const S = D.summary, he = S.high_energy_share, sc = S.scope_counts;
    const orders = Math.round(S.er_range_orders);
    html('tip-overview', `Three public OSHA injury tiers for US construction were harmonized with a fine-tuned language model into one taxonomy of 13 mechanisms, 11 energy sources and a high-energy flag. The share of a mechanism among fatalities relative to its share among recordables, the escalation ratio, spans ${orders === 4 ? 'four' : orders} orders of magnitude: electrical contact ${fmt.ratio(S.er_fatal.ELECTRICAL)}, fall to lower level ${fmt.ratio(S.er_fatal.FALL_LOWER)}, transportation ${fmt.ratio(S.er_fatal.TRANSPORT)}, struck by ${fmt.ratio(S.er_fatal.STRUCK_BY)}, fall on same level ${fmt.ratio(S.er_fatal.FALL_SAME)}, overexertion ${fmt.ratio(S.er_fatal.OVEREXERTION)}. High-energy exposure rises from ${fmt.pct(he.recordable)} of recordables to ${fmt.pct(he.severe)} of severe and ${fmt.pct(he.fatal)} of fatal cases. An establishment’s recordable count does not predict whether it also reports a severe injury (odds ratio ${fmt.dec(S.or_log_rec, 2)} per log unit, ${fmt.p(S.p_log_rec)}), but the high-energy share of its recordables does (odds ratio ${fmt.dec(S.or_high_energy_share, 1)}).`);
    html('overview-body', `
      <div class="message">${esc(S.message)}</div>
      <div class="tiles">
        ${tile(fmt.int(sc.recordable), 'Recordable cases, ITA Form 301, 2023 to 2025', 'blue')}
        ${tile(fmt.int(sc.severe), 'Severe cases, Severe Injury Reports, 2015 to 2025', 'green')}
        ${tile(fmt.int(sc.fatal), 'Fatal cases, IMIS investigations, 2015 to 2025', 'pink')}
        ${tile(fmt.ratio(S.er_fatal.ELECTRICAL) + ' vs ' + fmt.ratio(S.er_fatal.OVEREXERTION), 'Fatal escalation ratio, electrical vs overexertion')}
        ${tile(`${fmt.pct(he.recordable)} → ${fmt.pct(he.severe)} → ${fmt.pct(he.fatal)}`, 'High-energy share: recordable, severe, fatal')}
        ${tile(fmt.dec(S.or_high_energy_share, 1), 'Odds ratio of a severe injury per unit high-energy share of recordables')}
        ${tile(fmt.dec(S.auc_fatal_vs_recordable, 2), 'AUC, fatal vs recordable, SIF potential model')}
        ${tile(`${S.student_mb} MB`, `Browser model (bge-small int8), macro-F1 ${fmt.dec(S.student_macro_f1_int8, 2)} vs teacher ${fmt.dec(S.teacher_macro_f1, 2)}`)}
      </div>
      ${prov({ n: scopeN(), script: [SCRIPT.escalation, SCRIPT.sif, SCRIPT.linkage, SCRIPT.student], note: `Corpus coded: ${fmt.int(S.provenance.corpus_by_source.ITA)} ITA, ${fmt.int(S.provenance.corpus_by_source.SIR)} SIR and ${fmt.int(S.provenance.corpus_by_source.IMIS)} IMIS narratives; the counts above are the cases inside the main scope.` })}
      <div class="grid two">
        ${card('Share of each mechanism by tier (log scale)', 'ov-slope', 'Pink lines rise across tiers (fatal escalation ratio 1.5 or more), blue lines fall (.67 or less), gray lines stay roughly flat. Hover a line for the shares. Main scope: ' + S.n_states + ' federal OSHA states.')}
        <div class="card"><h3>Fatal escalation ratio by mechanism${info('Share of the mechanism among fatalities divided by its share among recordables, main scope, with the 95% bootstrap interval. Sorted by ratio; dashed line at 1.', 'About this chart')}</h3><div id="ov-er" class="chart"></div></div>
      </div>`);
    const rows = D.escalation.mechanism;
    const series = rows.map(r => {
      const er = r.ER_fatal;
      const color = er >= 1.5 ? 'pink' : (er <= .67 ? 'blue' : 'gray');
      return { name: mechName[r.mechanism], data: [r.share_recordable, r.share_severe, r.share_fatal], color, width: color === 'gray' ? 1.5 : 2.2, meta: [r, r, r] };
    });
    Charts.lines({ el: 'ov-slope', x: TIERS.map(t => TIER_NAME[t]), series, log: true, min: .0002, max: .6, valueName: 'Share of tier', endLabels: true, legendShow: false, height: 470,
      valueFormatter: v => fmt.dec(v * 100, v < .01 ? 2 : (v < .1 ? 1 : 0)) + '%',
      tooltipFormatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.sort((a, b) => b.value - a.value).map(p => `${p.marker} ${p.seriesName}: ${fmt.pct(p.value, 1)}`).join('<br>') });
    provAfter('ov-slope', { n: scopeN(), script: SCRIPT.escalation });
    const er = rows.slice().sort((a, b) => b.ER_fatal - a.ER_fatal);
    Charts.dotInterval({ el: 'ov-er', categories: er.map(r => mechName[r.mechanism]), log: true, min: .001, valueName: 'Fatal vs recordable (escalation ratio)', height: 470, color: 'pink',
      points: er.map(r => ({ v: r.ER_fatal, lo: r.ER_fatal_lo, hi: r.ER_fatal_hi, row: r })),
      tooltipFormatter: p => { const r = p.data.raw; return `<b>${p.name}</b><br>Ratio ${fmt.ratio(r.v)} (95% interval ${fmt.ci(r.lo, r.hi)})<br>n recordable ${fmt.int(r.row.n_recordable)}, fatal ${fmt.int(r.row.n_fatal)}`; } });
    provAfter('ov-er', { n: scopeN(), script: SCRIPT.escalation, note: 'Bootstrap intervals: 1,000 resamples of cases within tier.' });
  }

  /* ---------------------------------------------------------------- escalation explorer */
  function renderExplorer() {
    html('explorer-body', `
      <div class="controls">
        <span class="group"><span>Dimension</span><span id="ex-dim"></span></span>
        <span class="group"><span>Ratio</span><span id="ex-ratio"></span></span>
        <span class="group"><span>Scale</span><span id="ex-scale"></span></span>
        <span class="group"><span>Order</span><span id="ex-sort"></span></span>
      </div>
      <div class="grid two">
        ${card('Share of each category within tier', 'ex-shares', 'Hover a bar for the count. Shares within a tier sum to 100%.', 'tall')}
        ${card('Escalation ratio with 95% bootstrap interval', 'ex-ratio-chart', 'Dashed line: ratio 1 (same weight in both tiers). Ratios of exactly 0 (no cases in the numerator tier) are drawn at the axis floor.', 'tall')}
      </div>
      <div class="card scroll" style="margin-top:1rem"><h3>Table</h3><div id="ex-table"></div></div>`);
    const state = { dim: 'mechanism', ratio: 'fatal', scale: 'log', sort: 'ratio' };
    el('ex-dim').replaceWith(seg('ex-dim', [{ v: 'mechanism', label: 'Mechanism' }, { v: 'energy', label: 'Energy source' }], state.dim, v => { state.dim = v; draw(); }));
    el('ex-ratio').replaceWith(seg('ex-ratio', [{ v: 'severe', label: 'Severe vs recordable' }, { v: 'fatal', label: 'Fatal vs recordable' }, { v: 'fatal_vs_severe', label: 'Fatal vs severe' }], state.ratio, v => { state.ratio = v; draw(); }));
    el('ex-scale').replaceWith(seg('ex-scale', [{ v: 'log', label: 'Log' }, { v: 'linear', label: 'Linear' }], state.scale, v => { state.scale = v; draw(); }));
    el('ex-sort').replaceWith(seg('ex-sort', [{ v: 'ratio', label: 'By ratio' }, { v: 'taxonomy', label: 'Taxonomy' }], state.sort, v => { state.sort = v; draw(); }));

    function draw() {
      const key = state.dim === 'mechanism' ? 'mechanism' : 'energy_source';
      const nameOf = state.dim === 'mechanism' ? mechName : energyName;
      let rows = D.escalation[state.dim].filter(r => r.n_recordable + r.n_severe + r.n_fatal > 0);
      const col = { severe: 'ER_severe', fatal: 'ER_fatal', fatal_vs_severe: 'ER_fatal_vs_severe' }[state.ratio];
      const label = { severe: 'Severe vs recordable', fatal: 'Fatal vs recordable', fatal_vs_severe: 'Fatal vs severe' }[state.ratio];
      if (state.sort === 'ratio') rows = rows.slice().sort((a, b) => (b[col] ?? -1) - (a[col] ?? -1));
      const cats = rows.map(r => nameOf[r[key]]);
      const log = state.scale === 'log';
      Charts.bars({ el: 'ex-shares', categories: cats, horizontal: true, valueName: 'Share of tier (%)', height: 470,
        series: TIERS.map(t => ({ name: TIER_NAME[t], color: Charts.TIER_COLOR[t], data: rows.map(r => r['share_' + t] * 100), meta: rows.map(r => r['n_' + t]) })),
        tooltipFormatter: p => `<b>${p.name}</b><br>${p.seriesName}: ${fmt.dec(p.data.raw, 1)}% (n = ${fmt.int(p.data.meta)})` });
      Charts.dotInterval({ el: 'ex-ratio-chart', categories: cats, log, min: log ? .001 : 0, valueName: label + ' (escalation ratio)', height: 470,
        color: state.ratio === 'severe' ? 'green' : 'pink',
        points: rows.map(r => ({ v: r[col], lo: r[col + '_lo'], hi: r[col + '_hi'], row: r })),
        tooltipFormatter: p => { const r = p.data.raw; return `<b>${p.name}</b><br>${label}: ${fmt.ratio(r.v)}<br>95% interval: ${fmt.ci(r.lo, r.hi)}<br>n recordable ${fmt.int(r.row.n_recordable)}, severe ${fmt.int(r.row.n_severe)}, fatal ${fmt.int(r.row.n_fatal)}`; } });
      html('ex-table', `<table class="data"><thead><tr><th>${state.dim === 'mechanism' ? 'Mechanism' : 'Energy source'}</th><th class="num">n recordable</th><th class="num">n severe</th><th class="num">n fatal</th>
        <th class="num">Share recordable</th><th class="num">Share severe</th><th class="num">Share fatal</th><th class="num">ER severe (95% CI)</th><th class="num">ER fatal (95% CI)</th><th class="num">ER fatal vs severe (95% CI)</th></tr></thead><tbody>` +
        rows.map(r => `<tr><td>${nameOf[r[key]]}</td><td class="num">${fmt.int(r.n_recordable)}</td><td class="num">${fmt.int(r.n_severe)}</td><td class="num">${fmt.int(r.n_fatal)}</td>
          <td class="num">${fmt.pct(r.share_recordable, 1)}</td><td class="num">${fmt.pct(r.share_severe, 1)}</td><td class="num">${fmt.pct(r.share_fatal, 1)}</td>
          <td class="num">${fmt.ratio(r.ER_severe)} (${fmt.ci(r.ER_severe_lo, r.ER_severe_hi)})</td><td class="num">${fmt.ratio(r.ER_fatal)} (${fmt.ci(r.ER_fatal_lo, r.ER_fatal_hi)})</td>
          <td class="num">${fmt.ratio(r.ER_fatal_vs_severe)} (${fmt.ci(r.ER_fatal_vs_severe_lo, r.ER_fatal_vs_severe_hi)})</td></tr>`).join('') + '</tbody></table>');
    }
    draw();
    ['ex-shares', 'ex-ratio-chart'].forEach(id => provAfter(id, { n: scopeN(), script: SCRIPT.escalation, note: 'Bootstrap intervals: 1,000 resamples of cases within tier.' }));
    const t = D.escalation.tests;
    el('ex-table').insertAdjacentHTML('afterend', `<p class="note">Mechanism mix differs across tiers: Cramér’s V ${fmt.dec(t.homogeneity_mechanism.cramers_v, 2)}, ${fmt.p(t.homogeneity_mechanism.p)}.${info(`Homogeneity of mechanism mix across the three tiers: chi-square ${fmt.int(Math.round(t.homogeneity_mechanism.chi2))}, ${t.homogeneity_mechanism.dof} df, Cramér’s V ${fmt.dec(t.homogeneity_mechanism.cramers_v, 2)}, ${fmt.p(t.homogeneity_mechanism.p)}. Recordable vs severe V ${fmt.dec(t.homogeneity_recordable_vs_severe.cramers_v, 2)}; severe vs fatal V ${fmt.dec(t.homogeneity_severe_vs_fatal.cramers_v, 2)}; recordable vs fatal V ${fmt.dec(t.homogeneity_recordable_vs_fatal.cramers_v, 2)}.`, 'Test details')}</p>`);
  }

  /* ---------------------------------------------------------------- sensitivity */
  function renderSensitivity() {
    const V = D.escalation.variants, meta = D.escalation.variant_meta;
    html('sensitivity-body', `
      <div class="controls"><span class="group"><span>Ratio</span><span id="se-ratio"></span></span></div>
      <div class="grid two">
        ${card('Escalation ratio under five scopes', 'se-variants', Object.keys(meta).map(k => `<b>${VNAME[k]}</b>: ${esc(meta[k])}`).join('. ') + '.', 'tall')}
        ${card('Escalation ratio when minor recordables are undercounted by factor k', 'se-under', esc(D.escalation.underreporting_note) + ' Hover a line for the values at each k.', 'tall')}
      </div>`);
    const state = { ratio: 'fatal' };
    el('se-ratio').replaceWith(seg('se-ratio', [{ v: 'severe', label: 'Severe vs recordable' }, { v: 'fatal', label: 'Fatal vs recordable' }], state.ratio, v => { state.ratio = v; draw(); }));
    function draw() {
      const col = 'ER_' + state.ratio;
      const main = V.main.slice().sort((a, b) => b[col] - a[col]);
      const cats = main.map(r => mechName[r.mechanism]);
      const colors = { main: 'black', allstates: 'blue', y2023_2025: 'green', naics2381: 'pink', naics_other: 'gray' };
      const symbols = { main: 'circle', allstates: 'diamond', y2023_2025: 'triangle', naics2381: 'rect', naics_other: 'pin' };
      Charts.dots({ el: 'se-variants', categories: cats, log: true, min: .001, valueName: (state.ratio === 'fatal' ? 'Fatal' : 'Severe') + ' vs recordable (escalation ratio)', height: 470,
        series: Object.keys(V).map(k => { const byM = Object.fromEntries(V[k].map(r => [r.mechanism, r])); return { name: VNAME[k], color: colors[k], symbol: symbols[k], data: main.map(r => byM[r.mechanism] ? byM[r.mechanism][col] : null), meta: main.map(r => byM[r.mechanism]) }; }),
        tooltipFormatter: p => { const r = p.data.meta; return `<b>${p.name}</b><br>${p.seriesName}: ${fmt.ratio(p.data.raw)} (95% interval ${fmt.ci(r[col + '_lo'], r[col + '_hi'])})<br>n recordable ${fmt.int(r.n_recordable)}, severe ${fmt.int(r.n_severe)}, fatal ${fmt.int(r.n_fatal)}`; } });
      const U = D.escalation.underreporting;
      const ks = [...new Set(U.map(r => r.k))].sort((a, b) => a - b);
      const series = MECH_ORDER.map(m => {
        const vals = ks.map(k => U.find(r => r.k === k && r.mechanism === m)[col]);
        const er = vals[0];
        return { name: mechName[m], data: vals, color: er >= 1.5 ? 'pink' : (er <= .67 ? 'blue' : 'gray'), width: 1.8 };
      });
      Charts.lines({ el: 'se-under', x: ks.map(k => 'k = ' + k), series, log: true, min: .001, valueName: 'Escalation ratio', endLabels: true, legendShow: false, height: 470,
        tooltipFormatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.sort((a, b) => b.value - a.value).map(p => `${p.marker} ${p.seriesName}: ${fmt.ratio(p.value)}`).join('<br>') });
    }
    draw();
    provAfter('se-variants', { filter: 'five scopes as listed in the note; the all-states variant adds the state plan states', script: SCRIPT.escalation });
    provAfter('se-under', { n: scopeN(), script: SCRIPT.escalation });
  }
  const VNAME = { main: 'Main scope', allstates: 'All states', y2023_2025: '2023 to 2025 only', naics2381: 'NAICS 2381', naics_other: 'Other NAICS 23' };

  /* ---------------------------------------------------------------- high energy */
  function renderHighEnergy() {
    const H = D.high_energy;
    html('highenergy-body', `
      <div class="tiles">${TIERS.map(t => tile(fmt.pct(H.by_tier[t].mean), `High-energy share among ${t} cases (n = ${fmt.int(H.by_tier[t].size)})`, Charts.TIER_COLOR[t])).join('')}</div>
      <div class="grid two">
        ${card('High-energy share by mechanism and tier', 'he-mech', 'Fall on same level and struck against are low energy by definition of the flag; the interesting rows are struck by, caught, temperature and harmful substance, where the same mechanism label hides very different energy levels.', 'tall')}
        <div class="card"><h3>Reading${info(`The high-energy flag separates the tiers better than any mechanism label: ${fmt.pct(H.by_tier.recordable.mean)} of recordables are high energy, against ${fmt.pct(H.by_tier.severe.mean)} of severe and ${fmt.pct(H.by_tier.fatal.mean)} of fatal cases. Inside struck-by injuries, ${fmt.pct(H.by_tier_mechanism.find(r => r.mechanism === 'STRUCK_BY').recordable)} of recordables are high energy against ${fmt.pct(H.by_tier_mechanism.find(r => r.mechanism === 'STRUCK_BY').fatal)} of fatalities; inside caught-in cases the figures are ${fmt.pct(H.by_tier_mechanism.find(r => r.mechanism === 'CAUGHT').recordable)} and ${fmt.pct(H.by_tier_mechanism.find(r => r.mechanism === 'CAUGHT').fatal)}. A recordable struck-by injury from a hand tool and a fatal struck-by from a falling load share a mechanism code but not an energy level. This is why the establishment analysis uses the high-energy share of recordables, not their count, as the precursor signal.`, 'Reading in full')}</h3>
          <ul class="facts">
            <li>High energy: <b>${fmt.pct(H.by_tier.recordable.mean)}</b> of recordables, <b>${fmt.pct(H.by_tier.severe.mean)}</b> of severe, <b>${fmt.pct(H.by_tier.fatal.mean)}</b> of fatal cases.</li>
            <li>Struck by: <b>${fmt.pct(H.by_tier_mechanism.find(r => r.mechanism === 'STRUCK_BY').recordable)}</b> of recordables high energy, <b>${fmt.pct(H.by_tier_mechanism.find(r => r.mechanism === 'STRUCK_BY').fatal)}</b> of fatalities.</li>
            <li>Caught in or between: <b>${fmt.pct(H.by_tier_mechanism.find(r => r.mechanism === 'CAUGHT').recordable)}</b> against <b>${fmt.pct(H.by_tier_mechanism.find(r => r.mechanism === 'CAUGHT').fatal)}</b>.</li>
            <li>Same mechanism code, different energy level: the precursor signal is the high-energy share, not the count.</li>
          </ul>
        </div>
      </div>`);
    Charts.bars({ el: 'he-mech', categories: MECH_ORDER.map(m => mechName[m]), horizontal: true, valueName: 'High-energy share (%)', max: 100, height: 470,
      series: TIERS.map(t => ({ name: TIER_NAME[t], color: Charts.TIER_COLOR[t], data: MECH_ORDER.map(m => (H.by_tier_mechanism.find(r => r.mechanism === m)[t] || 0) * 100) })),
      tooltipFormatter: p => `<b>${p.name}</b><br>${p.seriesName}: ${fmt.dec(p.data.raw, 1)}% high energy` });
    provAfter('he-mech', { n: scopeN(), script: SCRIPT.escalation, note: 'High-energy flag assigned per narrative by the fine-tuned coder; cases coded not determinable are excluded from the shares.' });
  }

  /* ---------------------------------------------------------------- within recordables */
  function renderWithin() {
    const W = D.within_recordable, E = D.escalation.mechanism;
    const rows = W.slice().sort((a, b) => b.dafw_case_share - a.dafw_case_share);
    html('within-body', `
      <div class="grid two">
        ${card('Share of recordables with days away from work, by mechanism', 'wi-share', 'Sorted by days-away share. Hover for n.', 'tall')}
        ${card('Median days away when the case involves days away', 'wi-median', 'Same order as the left chart.', 'tall')}
      </div>
      <div class="grid two" style="margin-top:1rem">
        ${card('Days-away share versus fatal escalation ratio (log)', 'wi-scatter', 'Each point is a mechanism. Overexertion and same-level falls have a high days-away share but almost never escalate; electrical contact is the reverse. Dashed line: escalation ratio 1.')}
        <div class="card"><h3>Reading${info(`Within the recordable tier, days away from work rewards the chronic and musculoskeletal mechanisms: fall to lower level ${fmt.pct(W.find(r => r.mechanism === 'FALL_LOWER').dafw_case_share)} of cases with days away (median ${W.find(r => r.mechanism === 'FALL_LOWER').median_dafw_when_away} days), overexertion ${fmt.pct(W.find(r => r.mechanism === 'OVEREXERTION').dafw_case_share)}, fall on same level ${fmt.pct(W.find(r => r.mechanism === 'FALL_SAME').dafw_case_share)}. Only fall to lower level scores high on both signals. Overexertion and same-level falls cost days but do not kill; electrical contact costs relatively few days (median ${W.find(r => r.mechanism === 'ELECTRICAL').median_dafw_when_away}) but has a fatal escalation ratio of ${fmt.ratio(E.find(r => r.mechanism === 'ELECTRICAL').ER_fatal)}. A lost-time metric and a fatality precursor metric therefore point at different injuries. Both are needed; neither substitutes for the other.`, 'Reading in full')}</h3>
          <ul class="facts">
            <li>Fall to lower level: <b>${fmt.pct(W.find(r => r.mechanism === 'FALL_LOWER').dafw_case_share)}</b> with days away (median ${W.find(r => r.mechanism === 'FALL_LOWER').median_dafw_when_away} days); high on both signals.</li>
            <li>Overexertion <b>${fmt.pct(W.find(r => r.mechanism === 'OVEREXERTION').dafw_case_share)}</b>, fall on same level <b>${fmt.pct(W.find(r => r.mechanism === 'FALL_SAME').dafw_case_share)}</b>: cost days, rarely kill.</li>
            <li>Electrical contact: median ${W.find(r => r.mechanism === 'ELECTRICAL').median_dafw_when_away} days away, fatal escalation ratio <b>${fmt.ratio(E.find(r => r.mechanism === 'ELECTRICAL').ER_fatal)}</b>.</li>
            <li>Lost time and fatality precursors point at different injuries; both are needed.</li>
          </ul>
        </div>
      </div>`);
    const cats = rows.map(r => mechName[r.mechanism]);
    Charts.bars({ el: 'wi-share', categories: cats, horizontal: true, valueName: 'Cases with days away (%)', max: 100, height: 470,
      series: [{ name: 'Days-away share', color: 'blue', data: rows.map(r => r.dafw_case_share * 100), meta: rows.map(r => r.n) }],
      tooltipFormatter: p => `<b>${p.name}</b><br>${fmt.dec(p.data.raw, 1)}% with days away (n = ${fmt.int(p.data.meta)})` });
    Charts.bars({ el: 'wi-median', categories: cats, horizontal: true, valueName: 'Median days away', height: 470,
      series: [{ name: 'Median days away', color: 'gray', data: rows.map(r => r.median_dafw_when_away), meta: rows.map(r => r.mean_dafw) }],
      tooltipFormatter: p => `<b>${p.name}</b><br>Median ${p.data.raw} days; mean over all cases ${fmt.dec(p.data.meta, 1)} days` });
    Charts.scatter({ el: 'wi-scatter', xName: 'Cases with days away (%)', yName: 'Fatal vs recordable escalation ratio', logY: true, color: 'pink',
      points: W.map(r => ({ x: r.dafw_case_share * 100, y: E.find(e => e.mechanism === r.mechanism).ER_fatal, label: mechName[r.mechanism], row: r })),
      tooltipFormatter: p => `<b>${p.name}</b><br>Days-away share ${fmt.dec(p.data.raw.x, 1)}%<br>Fatal escalation ratio ${fmt.ratio(p.data.raw.y)}` });
    const nRec = W.reduce((a, r) => a + (r.n || 0), 0);
    ['wi-share', 'wi-median'].forEach(id => provAfter(id, { src: ['ita'], filter: 'recordable tier of the main scope; days away from the Form 301 outcome and days-away fields', n: nRec, script: SCRIPT.escalation }));
    provAfter('wi-scatter', { n: scopeN(), script: SCRIPT.escalation });
  }

  /* ---------------------------------------------------------------- SIF potential */
  function renderSif() {
    const M = D.sif.metrics, med = D.sif.median_by_mechanism_high_energy;
    html('sif-body', `
      <div class="tiles">
        ${tile(fmt.dec(M.auc_fatal_vs_recordable, 2), 'AUC fatal vs recordable (out of fold)', 'pink')}
        ${tile(fmt.dec(M.auc_severe_vs_recordable, 2), 'AUC severe vs recordable', 'green')}
        ${tile(fmt.dec(M.auc_sif_vs_recordable, 2), 'AUC severe or fatal vs recordable')}
        ${tile(fmt.dec(M.auc_sif_vs_recordable_mechanism_only, 2), 'Same, mechanism alone')}
        ${tile(fmt.dec(M.auc_fatal_vs_severe, 2), 'AUC fatal vs severe')}
        ${tile(fmt.int(M.n), 'Cases in the model')}
      </div>
      <div class="grid two">
        ${card('Median SIF potential index by mechanism and high-energy flag (log)', 'sif-median', 'Index = (p severe + p fatal) / p recordable with balanced classes. The flag moves every mechanism by one to two orders of magnitude; missing bars mean no cases with that flag value.', 'tall')}
        ${card('Mean absolute SHAP value by feature and predicted class', 'sif-shap', 'Feature importance on a stratified sample of 2,500 cases per tier. The high-energy flag dominates the fatal class; mechanism and energy source carry most of the rest.', 'tall')}
      </div>
      <p class="note" style="margin-top:.8rem">Features: mechanism, energy source, high-energy flag, fall height, direct control. No industry codes.${info(`Features: mechanism, energy source, high-energy flag, fall height (feet, when stated), whether a fall height was stated, direct-control status. Industry codes are deliberately excluded: differences in NAICS mix between tiers come from the coverage of each data source, not from risk. Class weights equalize the three tiers. Cross-validated best iterations: ${M.cv_best_iters.join(', ')}. Multiclass log loss ${fmt.dec(M.multiclass_logloss, 3)}. The Tool page evaluates the same model on a lookup grid built with fall height and direct control unknown.`, 'Model details')}</p>`);
    const cats = MECH_ORDER.map(m => mechName[m]);
    const byM = Object.fromEntries(med.map(r => [r.mechanism, r]));
    Charts.bars({ el: 'sif-median', categories: cats, horizontal: true, log: true, min: .005, valueName: 'Median SIF potential index', height: 470,
      series: [{ name: 'Low energy (flag 0)', color: 'blue', data: MECH_ORDER.map(m => byM[m].he_0) }, { name: 'High energy (flag 1)', color: 'pink', data: MECH_ORDER.map(m => byM[m].he_1) }],
      valueFormatter: Charts.fmtLogTick,
      tooltipFormatter: p => `<b>${p.name}</b><br>${p.seriesName}: ${p.data.raw == null ? 'no cases' : fmt.ratio(p.data.raw)}` });
    const feats = ['high_energy', 'mechanism', 'energy_source', 'fall_height_ft', 'direct_control_absent', 'fall_height_known'];
    const FN = { high_energy: 'High-energy flag', mechanism: 'Mechanism', energy_source: 'Energy source', fall_height_ft: 'Fall height', direct_control_absent: 'Direct control absent', fall_height_known: 'Fall height stated' };
    Charts.bars({ el: 'sif-shap', categories: feats.map(f => FN[f]), horizontal: true, valueName: 'Mean |SHAP| (log odds)', height: 470,
      series: TIERS.map(t => ({ name: TIER_NAME[t] + ' class', color: Charts.TIER_COLOR[t], data: feats.map(f => M.shap_mean_abs_by_class[t][f]) })),
      tooltipFormatter: p => `<b>${p.name}</b><br>${p.seriesName}: ${fmt.dec(p.data.raw, 3)}` });
    provAfter('sif-median', { n: M.n, script: SCRIPT.sif, note: 'Out-of-fold predictions from 5-fold cross-validation, LightGBM with balanced class weights.' });
    provAfter('sif-shap', { filter: 'stratified sample of 2,500 cases per tier from the main scope', script: SCRIPT.sif });
  }

  /* ---------------------------------------------------------------- context */
  function renderContext() {
    const C = D.context, st = C.stats;
    html('context-body', `
      <div class="grid two">
        ${card('Hours into the shift, recordable tier', 'cx-shift', `Bands are 95% intervals. Days-away share declines with hours into the shift (Spearman rho ${fmt.dec(st.trend_dafw_vs_hours_into_shift.spearman_rho, 3)}, ${fmt.p(st.trend_dafw_vs_hours_into_shift.p)}) but the trend disappears once mechanism is adjusted for (logit ${fmt.p(st.logit_dafw_hours_into_shift.adjusted_for_mechanism.p_his)}). The high-energy share does not change with hours into the shift (${fmt.p(st.trend_high_energy_vs_hours_into_shift.p)}). ${fmt.int(st.recordable_with_shift_time.n)} recordables (${fmt.pct(st.recordable_with_shift_time.share)}) have a shift start time.`)}
        ${card('Month index by tier (1 = average month)', 'cx-month', `Summer is elevated in every tier. Month by tier: chi-square ${fmt.dec(st.test_month_x_tier.chi2, 1)}, ${fmt.p(st.test_month_x_tier.p)}.`)}
      </div>
      <div class="grid two" style="margin-top:1rem">
        ${card('Weekday share by tier', 'cx-weekday', `Weekend share: recordable ${fmt.pct(st.weekend_share_by_tier.recordable, 1)}, severe ${fmt.pct(st.weekend_share_by_tier.severe, 1)}, fatal ${fmt.pct(st.weekend_share_by_tier.fatal, 1)} (${fmt.p(st.test_weekday_x_tier.p)}).`)}
        ${card('Fatal vs recordable escalation ratio by occupation group', 'cx-occ', `Occupation groups merge the ITA SOC autocoder with legacy IMIS occupation titles by keyword; coverage ${fmt.pct(st.occupation_coverage.recordable.coded / st.occupation_coverage.recordable.total)} of recordables and ${fmt.pct(st.occupation_coverage.fatal.coded / st.occupation_coverage.fatal.total)} of fatalities. Painters have only ${fmt.int(C.occupation_escalation.find(r => r.trade === 'Painters').n_recordable)} recordables, so their ratio is unstable.`, 'tall')}
      </div>
      <div class="grid two" style="margin-top:1rem">
        ${card('Recordable severity signals by establishment size', 'cx-size', `Large establishments have a lower days-away share but a higher share of high-escalation mechanisms and of high-energy cases. Adjusted for mechanism, days-away odds fall with log employees (coefficient ${fmt.dec(st.logit_dafw_log10_employees_adj_mechanism.coef, 2)}, ${fmt.p(st.logit_dafw_log10_employees_adj_mechanism.p)}).`)}
        <div class="card"><h3>Month index by mechanism${info('Index above 1 (pink) means more cases than an average month for that mechanism; below 1 (blue) fewer. Temperature cases in June to August reach an index of 2.5 or more.', 'About this chart')}</h3>
          <div class="controls"><span class="group"><span>Tier</span><span id="cx-tier"></span></span></div>
          <div id="cx-heat" class="chart tall"></div>
        </div>
      </div>`);
    const H = C.hours_into_shift;
    Charts.lines({ el: 'cx-shift', x: H.map(r => r.his_bin), xName: 'Hours into shift', valueName: 'Share (%)', min: 0, max: 60,
      series: [{ name: 'Days-away share', color: 'blue', data: H.map(r => r.dafw_share * 100), band: H.map(r => [r.dafw_share_lo * 100, r.dafw_share_hi * 100]), meta: H },
               { name: 'High-energy share', color: 'pink', data: H.map(r => r.high_energy_share * 100), band: H.map(r => [r.high_energy_share_lo * 100, r.high_energy_share_hi * 100]), meta: H },
               { name: 'High-escalation mechanism share', color: 'green', data: H.map(r => r.high_er_mech_share * 100), band: H.map(r => [r.high_er_mech_share_lo * 100, r.high_er_mech_share_hi * 100]), meta: H }],
      tooltipFormatter: ps => { const q = ps.filter(p => !/band/.test(p.seriesName)); return `<b>${q[0].axisValue} hours (n = ${fmt.int(q[0].data.meta.n)})</b><br>` + q.map(p => `${p.marker} ${p.seriesName}: ${fmt.dec(p.value, 1)}%`).join('<br>'); } });
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MI = C.month_index_by_tier, MC = C.month_counts_by_tier;
    Charts.lines({ el: 'cx-month', x: MONTHS, valueName: 'Month index', min: .5, max: 1.5,
      series: TIERS.map(t => ({ name: TIER_NAME[t], color: Charts.TIER_COLOR[t], data: MI.map(r => r[t]), meta: MC.map(r => r[t]) })),
      markLine: { silent: true, symbol: 'none', lineStyle: { color: '#000', type: 'dashed' }, label: { show: false }, data: [{ yAxis: 1 }] },
      tooltipFormatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.map(p => `${p.marker} ${p.seriesName}: ${fmt.dec(p.value, 2)} (n = ${fmt.int(p.data.meta)})`).join('<br>') });
    const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    Charts.bars({ el: 'cx-weekday', categories: WD, valueName: 'Share of tier (%)',
      series: TIERS.map(t => ({ name: TIER_NAME[t], color: Charts.TIER_COLOR[t], data: C.weekday_by_tier.map(r => r[t] * 100) })),
      tooltipFormatter: p => `<b>${p.name}</b><br>${p.seriesName}: ${fmt.dec(p.data.raw, 1)}%` });
    const O = C.occupation_escalation.slice().sort((a, b) => b.ER_fatal - a.ER_fatal);
    Charts.dotInterval({ el: 'cx-occ', categories: O.map(r => r.trade), log: true, min: .05, valueName: 'Fatal vs recordable escalation ratio', height: 470, color: 'pink',
      points: O.map(r => ({ v: r.ER_fatal, lo: r.ER_fatal_lo, hi: r.ER_fatal_hi, row: r })),
      tooltipFormatter: p => { const r = p.data.raw; return `<b>${p.name}</b><br>Ratio ${fmt.ratio(r.v)} (95% interval ${fmt.ci(r.lo, r.hi)})<br>n recordable ${fmt.int(r.row.n_recordable)}, fatal ${fmt.int(r.row.n_fatal)}`; } });
    const SZ = C.size_class;
    Charts.bars({ el: 'cx-size', categories: SZ.map(r => r.size_class), valueName: 'Share of recordables (%), by establishment employees', max: 70,
      series: [{ name: 'Days away', color: 'blue', data: SZ.map(r => r.dafw_share * 100), meta: SZ }, { name: 'High-escalation mechanism', color: 'green', data: SZ.map(r => r.high_er_mech_share * 100), meta: SZ },
               { name: 'High energy', color: 'pink', data: SZ.map(r => r.high_energy_share * 100), meta: SZ }],
      tooltipFormatter: p => `<b>${p.name}</b><br>${p.seriesName}: ${fmt.dec(p.data.raw, 1)}%<br>n cases ${fmt.int(p.data.meta.n_cases)}, establishments ${fmt.int(p.data.meta.n_establishments)}` });
    const state = { tier: 'fatal' };
    el('cx-tier').replaceWith(seg('cx-tier', TIERS.map(t => ({ v: t, label: TIER_NAME[t] })), state.tier, v => { state.tier = v; heat(); }));
    function heat() {
      const rows = C.month_index_by_mechanism[state.tier], counts = C.month_counts_by_mechanism[state.tier];
      const cells = [];
      rows.forEach((r, mi) => MECH_ORDER.forEach((m, k) => cells.push([mi, k, r[m]])));
      Charts.heatmap({ el: 'cx-heat', x: MONTHS, y: MECH_ORDER.map(m => mechName[m]), cells, mid: 1, span: .8, valueName: 'Index', height: 470,
        tooltipFormatter: p => { const mi = p.value[0], k = p.value[1]; return `<b>${MECH_ORDER.map(m => mechName[m])[k]}, ${MONTHS[mi]}</b><br>Index ${p.data.raw == null ? 'n/a' : fmt.dec(p.data.raw, 2)}; n = ${fmt.int(counts[mi][MECH_ORDER[k]])}`; } });
    }
    heat();
    provAfter('cx-shift', { src: ['ita'], filter: 'recordable tier of the main scope with a shift start time and an incident time', n: st.recordable_with_shift_time.n, script: SCRIPT.context });
    ['cx-month', 'cx-weekday', 'cx-heat'].forEach(id => provAfter(id, { n: scopeN(), script: SCRIPT.context }));
    provAfter('cx-occ', { src: ['ita', 'imis'], filter: 'recordable and fatal cases of the main scope with a coded occupation', n: `${fmt.int(st.occupation_coverage.recordable.coded)} recordable, ${fmt.int(st.occupation_coverage.fatal.coded)} fatal`, script: SCRIPT.context });
    provAfter('cx-size', { src: ['ita'], filter: 'recordable tier of the main scope, establishment employees from the ITA summary file', n: C.size_class.reduce((a, r) => a + (r.n_cases || 0), 0), script: SCRIPT.context });
  }

  /* ---------------------------------------------------------------- establishments */
  function renderEstablishments() {
    const E = D.establishments, S = E.stats, L = S.logit_models, cc = S.mechanism_concordance;
    const ge3 = S.compare_ge3_recordables;
    html('establishments-body', `
      <div class="tiles">
        ${tile(fmt.int(S.linked_score_ge_95.sir_cases), `Severe injury reports (2023 to 2025) linked to ITA establishments at name score 95 or more, of ${fmt.int(S.sir_cases_2023_2025_fed_states)}`, 'green')}
        ${tile(fmt.int(S.linked_score_ge_95.ita_establishments), `ITA establishments with a linked severe report, of ${fmt.int(S.ita_establishments_fed_states)}`, 'blue')}
        ${tile(`${fmt.int(ge3.n_with_sir)} of ${fmt.int(ge3.n_establishments)}`, 'Establishments with at least 3 recordables that also have a severe report')}
        ${tile(fmt.pct(S.share_of_establishment_recordables_before_sir_mean), 'Mean share of an establishment’s recordables dated before its severe report')}
      </div>
      <div class="grid two">
        ${card('Linkage yield by name-match threshold', 'es-yield', 'Fuzzy employer-name and location match (rapidfuzz). The paper uses threshold 95. Severe reports have no employer identifier, so linkage relies on names.')}
        ${card('Establishments with a severe report, by size and high-energy tercile', 'es-rate', 'Establishments with at least 3 recordables, grouped by employee count and by tercile of the high-energy share of their recordables. Hover for n; the smallest size class has very few establishments.')}
      </div>
      <div class="grid two" style="margin-top:1rem">
        <div class="card"><h3>Logistic models for having a severe report (n = ${fmt.int(L.size_only.n)})${info('Every model adjusts for log employees. Recordable volume (log count) is not significant; the high-energy share of recordables and the high-escalation mechanism share are. Odds ratios for shares are per unit share (0 to 1).', 'About this chart')}</h3><div id="es-or" class="chart"></div>
          <div class="scroll"><table class="data"><thead><tr><th>Model</th><th>Term</th><th class="num">Odds ratio</th><th class="num">p</th><th class="num">Pseudo R²</th></tr></thead><tbody>${orRows(L)}</tbody></table></div></div>
        ${card('Mechanism concordance between a severe report and the same establishment’s recordables', 'es-conc', `Observed versus permutation null (bars with 95% null interval) over ${fmt.int(cc.n_linked_sir_cases)} linked severe cases. Present: the severe case mechanism appears among the establishment’s recordables (${fmt.p(cc.p_one_sided.present)}); modal: it equals the most common recordable mechanism (${fmt.p(cc.p_one_sided.modal)}); share: mean recordable share of that mechanism (${fmt.p(cc.p_one_sided.share)}).`)}
      </div>
      <div class="card scroll" style="margin-top:1rem"><h3>Establishments with and without a severe report (at least 3 recordables)</h3>${compareTable(ge3)}</div>`);
    const TH = ['100', '95', '90', '85'];
    Charts.bars({ el: 'es-yield', categories: TH.map(t => 'Score ≥ ' + t), valueName: 'Count',
      series: [{ name: 'Linked severe cases', color: 'green', data: TH.map(t => S['linked_score_ge_' + t].sir_cases), meta: TH.map(t => S['linked_score_ge_' + t]) },
               { name: 'ITA establishments', color: 'blue', data: TH.map(t => S['linked_score_ge_' + t].ita_establishments), meta: TH.map(t => S['linked_score_ge_' + t]) }],
      tooltipFormatter: p => `<b>${p.name}</b><br>${p.seriesName}: ${fmt.int(p.data.raw)}<br>Ambiguous multi-establishment matches: ${fmt.int(p.data.meta.sir_cases_ambiguous_multi_establishment)}` });
    const R = E.has_sir_by_size_tercile, sizes = [...new Set(R.map(r => r.size_class))], terc = ['low', 'middle', 'high'];
    Charts.bars({ el: 'es-rate', categories: sizes, valueName: 'Establishments with a severe report (%), by employees', max: 60,
      series: terc.map((t, i) => ({ name: t[0].toUpperCase() + t.slice(1) + ' high-energy tercile', color: ['blue', 'gray', 'pink'][i], data: sizes.map(s => { const r = R.find(x => x.size_class === s && x.high_er_tercile === t); return r ? r.has_sir_rate * 100 : null; }), meta: sizes.map(s => R.find(x => x.size_class === s && x.high_er_tercile === t)) })),
      tooltipFormatter: p => p.data.meta ? `<b>${p.name}</b><br>${p.seriesName}: ${fmt.dec(p.data.raw, 1)}% (n = ${p.data.meta.n})` : `<b>${p.name}</b><br>${p.seriesName}: no establishments` });
    const terms = [['size_volume', 'log_rec', 'Log recordable count'], ['size_volume_dafw', 'dafw_share', 'Days-away share'], ['size_volume_sif', 'mean_log_sif', 'Mean log SIF potential'],
                   ['size_volume_high_er', 'high_er_share', 'High-escalation mechanism share'], ['size_volume_high_energy', 'high_energy_share', 'High-energy share']];
    Charts.dots({ el: 'es-or', categories: terms.map(t => t[2]), log: true, min: .5, max: 10, valueName: 'Odds ratio (log scale)', height: 300, gridLeft: 210,
      series: [{ name: 'Odds ratio, adjusted for log employees', color: 'pink', data: terms.map(t => L[t[0]].odds_ratio[t[1]]), meta: terms.map(t => L[t[0]]) , symbol: 'circle' }],
      tooltipFormatter: p => { const m = p.data.meta, term = terms[p.dataIndex]; return `<b>${p.name}</b><br>Odds ratio ${fmt.dec(p.data.raw, 2)}, ${fmt.p(m.p[term[1]])}<br>Pseudo R² ${fmt.dec(m.pseudo_r2, 3)}`; } });
    const measures = [['present', 'Present'], ['modal', 'Modal'], ['share', 'Mean share']];
    const obsKey = { present: 'sir_mechanism_present_in_establishment_recordables', modal: 'sir_mechanism_equals_modal_recordable_mechanism', share: 'mean_recordable_share_of_sir_mechanism' };
    const ch = Charts.bars({ el: 'es-conc', categories: measures.map(m => m[1]), valueName: 'Share (%)', max: 80,
      series: [{ name: 'Observed', color: 'pink', data: measures.map(m => cc.observed[obsKey[m[0]]] * 100) }, { name: 'Permutation null mean', color: 'gray', data: measures.map(m => cc.permutation_null_mean[m[0]] * 100), meta: measures.map(m => cc.permutation_null_ci[m[0]]) }],
      tooltipFormatter: p => `<b>${p.name}</b><br>${p.seriesName}: ${fmt.dec(p.data.raw, 1)}%` + (p.data.meta ? `<br>Null 95% interval ${fmt.dec(p.data.meta[0] * 100, 1)}% to ${fmt.dec(p.data.meta[1] * 100, 1)}%` : '') });
    ch.setOption({ series: [{}, {}, { type: 'custom', name: 'Null 95% interval', silent: true, z: 5, tooltip: { show: false }, itemStyle: { color: '#000' },
      renderItem(params, api) { const i = api.value(0); const lo = api.coord([i, api.value(1)]), hi = api.coord([i, api.value(2)]); const w = api.size([1, 0])[0] * .35 * .45 + api.size([1, 0])[0] * .05; const x = lo[0] + w * 1.0;
        const st = { stroke: '#000', lineWidth: 1.5 }; return { type: 'group', children: [{ type: 'line', shape: { x1: x, y1: lo[1], x2: x, y2: hi[1] }, style: st }, { type: 'line', shape: { x1: x - 4, y1: lo[1], x2: x + 4, y2: lo[1] }, style: st }, { type: 'line', shape: { x1: x - 4, y1: hi[1], x2: x + 4, y2: hi[1] }, style: st }] }; },
      data: measures.map((m, i) => [i, cc.permutation_null_ci[m[0]][0] * 100, cc.permutation_null_ci[m[0]][1] * 100]), encode: { x: 0, y: [1, 2] } }] });
    provAfter('es-yield', { src: ['ita', 'sir'], filter: `severe reports 2023 to 2025 in federal states (${fmt.int(S.sir_cases_2023_2025_fed_states)}) matched by employer name and state to ${fmt.int(S.ita_establishments_fed_states)} ITA construction establishments`, script: SCRIPT.linkage });
    provAfter('es-rate', { src: ['ita', 'sir'], filter: 'ITA establishments with at least 3 recordables, main scope', n: L.size_only.n, script: SCRIPT.linkage });
    provAfter('es-or', { src: ['ita', 'sir'], filter: 'ITA establishments with at least 3 recordables, main scope', n: L.size_only.n, script: SCRIPT.linkage });
    provAfter('es-conc', { src: ['ita', 'sir'], filter: 'linked severe cases at establishments with at least 3 recordables', n: cc.n_linked_sir_cases, script: SCRIPT.linkage, note: 'Null: 1,000 permutations of severe cases across establishments.' });
  }
  function orRows(L) {
    const MN = { size_only: 'Size only', size_volume: 'Size + volume', size_volume_high_er: 'Size + volume + high-escalation share', size_volume_dafw: 'Size + volume + days-away share', size_volume_high_energy: 'Size + volume + high-energy share', size_volume_sif: 'Size + volume + mean log SIF' };
    const TN = { log_emp: 'Log employees', log_rec: 'Log recordables', high_er_share: 'High-escalation mechanism share', dafw_share: 'Days-away share', high_energy_share: 'High-energy share', mean_log_sif: 'Mean log SIF potential' };
    return Object.keys(MN).map(k => Object.keys(L[k].params).filter(t => t !== 'Intercept').map((t, i) =>
      `<tr${['high_energy_share', 'high_er_share'].includes(t) ? ' class="hl"' : ''}><td>${i === 0 ? MN[k] : ''}</td><td>${TN[t]}</td><td class="num">${fmt.dec(L[k].odds_ratio[t], 2)}</td><td class="num">${fmt.p(L[k].p[t]).replace('p ', '')}</td><td class="num">${i === 0 ? fmt.dec(L[k].pseudo_r2, 3) : ''}</td></tr>`).join('')).join('');
  }
  function compareTable(g) {
    const rows = [['employees', 'Employees'], ['n_rec', 'Recordables'], ['rec_rate_per_100fte', 'Recordables per 100 FTE'], ['dafw_share', 'Days-away share'], ['high_er_share', 'High-escalation mechanism share'], ['high_energy_share', 'High-energy share'], ['mean_log_sif', 'Mean log SIF potential']];
    const f = (k, v) => ['dafw_share', 'high_er_share', 'high_energy_share'].includes(k) ? fmt.pct(v) : fmt.dec(v, k === 'employees' || k === 'n_rec' ? 0 : 2);
    return `<table class="data"><thead><tr><th>Measure</th><th class="num">Median, with severe report (n = ${g.n_with_sir})</th><th class="num">Median, without (n = ${g.n_establishments - g.n_with_sir})</th><th class="num">Mann-Whitney p</th></tr></thead><tbody>` +
      rows.map(([k, n]) => `<tr><td>${n}</td><td class="num">${f(k, g[k].median_with_sir)}</td><td class="num">${f(k, g[k].median_without_sir)}</td><td class="num">${fmt.p(g[k].mannwhitney_p).replace('p ', '')}</td></tr>`).join('') + '</tbody></table>';
  }

  /* ---------------------------------------------------------------- models */
  function renderModels() {
    const M = D.models, coders = M.coders;
    html('models-body', `
      <div class="card scroll"><h3>Coder comparison on the gold test set${info(`Mechanism unless stated. Legacy codes are the event codes native to each source, mapped to the taxonomy; coverage is the share of test cases with a mappable legacy code. The student was trained for ${M.student.epochs} epochs on ${fmt.int(M.student.train_n)} narratives (teacher silver labels plus gold training labels). ONNX latency on one CPU thread: fp32 median ${fmt.dec(M.onnx.variants.fp32.latency_ms_median, 0)} ms, int8 median ${fmt.dec(M.onnx.variants.int8.latency_ms_median, 0)} ms per narrative.`, 'About this table')}</h3>
        <table class="data"><thead><tr><th>Coder</th><th class="num">n</th><th class="num">Coverage</th><th class="num">Accuracy</th><th class="num">Macro-F1</th><th class="num">Kappa</th><th class="num">Energy accuracy</th><th class="num">High-energy accuracy</th></tr></thead><tbody>
        ${coders.map(c => `<tr${c.id === 'student_int8' ? ' class="hl"' : ''}><td>${esc(c.name)}</td><td class="num">${c.n}</td><td class="num">${c.coverage == null ? '' : fmt.pct(c.coverage)}</td><td class="num">${fmt.dec(c.accuracy, 3)}</td><td class="num">${fmt.dec(c.macro_f1, 3)}</td><td class="num">${fmt.dec(c.kappa, 3)}</td><td class="num">${c.energy_accuracy == null ? '' : fmt.dec(c.energy_accuracy, 3)}</td><td class="num">${c.high_energy_accuracy == null ? '' : fmt.dec(c.high_energy_accuracy, 3)}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="card" style="margin-top:1rem"><h3>Per-class F1 for mechanism${info(`Support in the test set (n per class) is shown in the tooltip. Fire or explosion (n = ${M.test_support.FIRE_EXPLOSION}) and struck against (n = ${M.test_support.STRUCK_AGAINST}) are the weakest classes for every coder.`, 'About this chart')}</h3>
        <div class="controls" id="mo-pick"></div>
        <div id="mo-f1" class="chart tall"></div>
      </div>`);
    const pick = el('mo-pick');
    const defaults = new Set(['legacy_codes_all', 'qwen7b_zeroshot', 'qwen7b_finetuned', 'student_int8']);
    const colors = { legacy_codes_all: 'gray', qwen7b_zeroshot: 'blue', qwen7b_finetuned: 'green', student_int8: 'pink', student_fp32: 'pink', legacy_codes_ITA: 'gray', legacy_codes_SIR: 'gray', legacy_codes_IMIS: 'gray' };
    coders.forEach(c => {
      const lab = document.createElement('label'); lab.style.marginRight = '.8rem';
      lab.innerHTML = `<input type="checkbox" value="${c.id}" ${defaults.has(c.id) ? 'checked' : ''}> ${esc(c.name)}`;
      lab.querySelector('input').onchange = draw; pick.appendChild(lab);
    });
    function draw() {
      const sel = [...pick.querySelectorAll('input:checked')].map(i => i.value);
      const chosen = coders.filter(c => sel.includes(c.id));
      Charts.bars({ el: 'mo-f1', categories: MECH_ORDER.map(m => mechName[m]), horizontal: true, valueName: 'F1', max: 1, height: 470,
        series: chosen.map(c => ({ name: c.name, color: colors[c.id] || 'gray', data: MECH_ORDER.map(m => c.per_class_f1[m]) })),
        valueFormatter: v => fmt.dec(v, 1),
        tooltipFormatter: p => `<b>${p.name}</b> (n = ${M.test_support[MECH_ORDER[p.dataIndex]]})<br>${p.seriesName}: F1 ${fmt.dec(p.data.raw, 2)}` });
    }
    draw();
    provAfter('mo-f1', { filter: 'gold test split of the adjudicated labels, all three sources', n: coders[0].n, script: [SCRIPT.evaluate, SCRIPT.student], note: 'Gold labels and coding rules are in analysis/02_gold_standard_manual_coding of the repository.' });
  }

  /* ---------------------------------------------------------------- cases */
  function renderCases() {
    const C = D.cases_sample, all = C.cases;
    html('cases-body', `
      <div class="tiles">
        ${TIERS.map(t => tile(fmt.int(C.n_by_tier[t]), `${TIER_NAME[t]} cases in the sample`, Charts.TIER_COLOR[t])).join('')}
        ${tile(fmt.pct(C.share_severe_with_inspection), 'Severe cases in the main scope that opened an OSHA inspection and therefore have a per-case page')}
      </div>
      <div class="controls">
        <span class="group"><span>Tier</span><span id="ca-tier"></span></span>
        <span class="group"><span>Mechanism</span><select id="ca-mech"><option value="">All</option>${MECH_ORDER.map(m => `<option value="${m}">${mechName[m]}</option>`).join('')}</select></span>
        <span class="group"><label><input type="checkbox" id="ca-linked"> Only cases with a per-case OSHA page</label></span>
        <span class="group"><label><input type="checkbox" id="ca-disagree"> Only cases where teacher and student differ</label></span>
        <span class="group"><input type="text" id="ca-search" placeholder="Search the narratives"></span>
        <span class="muted" id="ca-count"></span>
      </div>
      <div class="cases" id="ca-list"></div>
      <div style="margin:.8rem 0"><button class="primary" id="ca-more" hidden>Show 40 more</button></div>
      ${prov({ n: `${fmt.int(C.n)} sampled from ${scopeN()} (seed ${C.seed}, up to ${C.per_cell} per mechanism and tier)`, script: [SCRIPT.predict, SCRIPT.studentCorpus, SCRIPT.app], note: 'Texts are reproduced verbatim from the public OSHA files except for whitespace and punctuation repairs. IMIS abstracts with words glued by line breaks were sampled last.' })}`);
    const state = { tier: 'all', mech: '', linked: false, disagree: false, q: '', shown: 40 };
    el('ca-tier').replaceWith(seg('ca-tier', [{ v: 'all', label: 'All' }].concat(TIERS.map(t => ({ v: t, label: TIER_NAME[t] }))), state.tier, v => { state.tier = v; state.shown = 40; draw(); }));
    el('ca-mech').onchange = e => { state.mech = e.target.value; state.shown = 40; draw(); };
    el('ca-linked').onchange = e => { state.linked = e.target.checked; state.shown = 40; draw(); };
    el('ca-disagree').onchange = e => { state.disagree = e.target.checked; state.shown = 40; draw(); };
    let timer; el('ca-search').oninput = e => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); state.shown = 40; draw(); }, 200); };
    el('ca-more').onclick = () => { state.shown += 40; draw(); };
    const list = el('ca-list');
    list.addEventListener('click', ev => { const b = ev.target.closest('button[data-code]'); if (b) codeInBrowser(b); });
    function draw() {
      const rows = all.filter(c => (state.tier === 'all' || c.tier === state.tier) && (!state.mech || c.mechanism === state.mech) && (!state.linked || c.per_case)
        && (!state.disagree || (c.student_mechanism && c.student_mechanism !== c.mechanism)) && (!state.q || c.narrative.toLowerCase().includes(state.q)));
      el('ca-count').textContent = `${fmt.int(rows.length)} of ${fmt.int(all.length)} cases`;
      list.innerHTML = rows.slice(0, state.shown).map(caseCard).join('') || '<p class="muted">No case matches these filters.</p>';
      el('ca-more').hidden = rows.length <= state.shown;
    }
    function caseCard(c) {
      const link = c.per_case
        ? `<a class="osha" href="${c.url}" target="_blank" rel="noopener" title="Opens the OSHA IMIS page; if OSHA answers with a server error, its IMIS backend is down, try again later">View at OSHA</a> <span class="muted small">${esc(c.url_note)}</span>`
        : `<span class="osha muted">No per-case page: ${esc(c.url_note)}, <a href="${c.url}" target="_blank" rel="noopener">download page</a></span>`;
      const student = c.student_mechanism
        ? `<span>Student (corpus run): <b>${mechName[c.student_mechanism]}</b>${c.student_p != null ? ` (p ${fmt.dec(c.student_p, 2)})` : ''}${c.student_mechanism !== c.mechanism ? ' <span class="tag">differs</span>' : ''}</span>` : '';
      return `<div class="case" data-id="${c.id}">
        <div class="head"><span class="tag ${c.tier}">${TIER_NAME[c.tier]}</span><span class="id">${esc(c.id)}</span><span class="muted">${esc(c.date)}, ${esc(c.state || '')}</span>${link}</div>
        <p class="text">${esc(c.narrative)}</p>
        <div class="labels">
          <span>Teacher: <b>${mechName[c.mechanism]}</b>, ${energyName[c.energy_source] || esc(c.energy_source)}, ${(heName[c.high_energy] || '').toLowerCase()}</span>
          ${c.sif != null ? `<span>SIF potential index <b>${fmt.ratio(c.sif)}</b></span>` : ''}
          ${student}
          <button class="link" data-code="${c.id}">Code this narrative in the browser</button><span class="live"></span>
        </div>
      </div>`;
    }
    async function codeInBrowser(btn) {
      const cardEl = btn.closest('.case'), live = cardEl.querySelector('.live'), c = all.find(x => x.id === cardEl.dataset.id);
      btn.disabled = true; live.className = 'live';
      try {
        if (NarrativeModel.state.status !== 'ready') {
          live.textContent = 'Loading the browser model (34 MB, once)…';
          await NarrativeModel.load(p => { if (p.stage === 'model' && p.total) live.textContent = `Downloading the model: ${(p.loaded / 1048576).toFixed(1)} of ${(p.total / 1048576).toFixed(1)} MB`; });
        }
        const r = await NarrativeModel.predict(c.narrative);
        const m = r.mechanism[0], e = r.energy[0], h = r.highEnergy[0];
        live.innerHTML = `Browser model now: <b>${mechName[m.code]}</b> (p ${fmt.dec(m.p, 2)}), ${energyName[e.code]}, ${heName[h.code].toLowerCase()}, ${fmt.dec(r.ms, 0)} ms${m.code === c.mechanism ? ', agrees with the teacher' : ', differs from the teacher'}`;
      } catch (err) { live.className = 'live err'; live.textContent = 'Could not run the model: ' + err.message; }
      btn.disabled = false;
    }
    draw();
  }

  /* ---------------------------------------------------------------- tool */
  function renderTool() {
    html('tool-body', `
      <div class="disclaimer">Not a determination of OSHA recordability or compliance; nothing you type leaves your browser.${info('This tool does not determine OSHA recordability or regulatory compliance and is not a substitute for an investigation. It estimates, from the wording of a narrative, how often incidents of this kind escalate to hospitalization or death in national OSHA data. All inference runs locally in your browser; nothing you type is uploaded or stored.', 'Disclaimer in full')}</div>
      <div class="card">
        <h3>Narrative${info(`<p>1. The text is tokenized with the WordPiece vocabulary of bge-small (max 256 tokens).</p><p>2. The distilled int8 ONNX model (${D.summary.student_mb} MB, downloaded once) returns probabilities for 13 mechanisms, 11 energy sources and the high-energy flag. Test macro-F1 ${fmt.dec(D.summary.student_macro_f1_int8, 2)} for mechanism.</p><p>3. The predicted codes, which you can override, are looked up in the escalation tables and in a precomputed grid of the SIF potential model (fall height and direct control set to unknown).</p>`, 'What happens')}</h3>
        <div class="tool-entry"><div id="tool-guide"></div><div id="tool-say"></div>
        <textarea id="tool-text" placeholder="Example: Employee was installing conduit from a 10-foot stepladder when the ladder shifted; he fell to the concrete floor and fractured his wrist."></textarea></div>
        <div class="controls" style="margin:.6rem 0 0">
          <button class="primary" id="tool-run" disabled>Code this narrative</button>
          <button class="link" id="tool-example">Insert an example</button>
          <span class="muted" id="tool-count"></span>
        </div>
        <div id="tool-status" class="status"></div>
        <div class="progress" id="tool-progress" hidden><div></div></div>
      </div>
      <div class="result" id="tool-result" hidden>
        <div class="card"><h3>Coding (editable)</h3>
          <div class="pred">
            <div class="field"><label>Mechanism</label><select id="tf-mech">${MECH_ORDER.map(m => `<option value="${m}">${mechName[m]}</option>`).join('')}</select><ul class="probs" id="tp-mech"></ul></div>
            <div class="field"><label>Energy source</label><select id="tf-energy">${D.labels.energy_source.map(e => `<option value="${e.code}">${e.name}</option>`).join('')}</select><ul class="probs" id="tp-energy"></ul></div>
            <div class="field"><label>High-energy flag</label><select id="tf-he">${D.labels.high_energy.map(h => `<option value="${h.code}">${h.name}</option>`).join('')}</select><ul class="probs" id="tp-he"></ul></div>
          </div>
        </div>
        <div id="tool-reading" class="reading"></div>
        <div class="tiles" id="tool-tiles"></div>
        <div class="grid two">
          ${card('High-energy share of this mechanism by tier', 'tool-he-chart', '', 'short')}
          <div class="card"><h3>Severe and fatal narratives with the same mechanism${info('Public OSHA texts from the Severe Injury Reports and IMIS fatality investigations, chosen at random among short narratives.', 'About these examples')}</h3><ul class="examples" id="tool-examples"></ul></div>
        </div>
        <details style="margin-top:.8rem"><summary class="muted">Tokens sent to the model</summary><div class="tokens" id="tool-tokens"></div></details>
      </div>`);
    const ta = el('tool-text'), run = el('tool-run'), status = el('tool-status'), prog = el('tool-progress');
    const EX = ['Employee was installing conduit from a 10-foot stepladder when the ladder shifted; he fell to the concrete floor and fractured his wrist.',
      'While guiding a steel beam being lowered by a crane, the load swung and pinned the employee against a column. He was hospitalized with a fractured pelvis.',
      'Employee was lifting a bundle of rebar with a coworker and felt a sharp pain in his lower back. He was placed on restricted duty.',
      'The boom of a concrete pump truck contacted an overhead 13.2 kV power line while the employee was holding the hose.',
      'Employee tripped over an extension cord on the ground floor and landed on his knee, resulting in a contusion.'];
    let exIdx = 0;
    Guide.mount(el('tool-guide'), el('tool-say')); Guide.act('think', 0, 'One moment, the coder is loading.');
    el('tool-example').onclick = () => { ta.value = EX[exIdx++ % EX.length]; ta.dispatchEvent(new Event('input')); };
    ta.addEventListener('input', () => { const w = ta.value.trim().split(/\s+/).filter(Boolean).length; el('tool-count').textContent = w ? `${w} words` : '';
      if (!run.disabled) Guide.act(w ? 'read' : 'point', w ? 2600 : 0, !w ? 'Type or paste an incident narrative here.' : w < 8 ? 'A sentence or two on what happened is enough.' : 'Ready when you are: Code this narrative.'); });
    ['tf-mech', 'tf-energy', 'tf-he'].forEach(id => el(id).onchange = renderDownstream);
    run.onclick = async () => {
      const text = ta.value.trim();
      if (!text) { status.textContent = 'Paste a narrative first.'; Guide.act('no', 1600, 'There is no narrative yet.'); return; }
      Guide.act('think', 0, 'Reading the narrative.');
      run.disabled = true; status.className = 'status'; status.textContent = 'Coding…';
      try {
        const r = await NarrativeModel.predict(text);
        showPrediction(r);
        status.textContent = `Coded in ${fmt.dec(r.ms, 0)} ms (${r.nTokens} tokens${r.truncated ? ', truncated to 256' : ''}).`;
      } catch (e) { status.className = 'status error'; status.textContent = 'Inference failed: ' + e.message; Guide.act('no', 2000, 'The coder failed on this text.'); }
      run.disabled = false;
    };
    // load the model when the page is first opened
    status.textContent = 'Preparing the model…'; prog.hidden = false;
    NarrativeModel.load(p => {
      const bar = prog.firstElementChild;
      if (p.stage === 'runtime') status.textContent = 'Loading onnxruntime-web from the CDN…';
      else if (p.stage === 'tokenizer') status.textContent = 'Loading the vocabulary…';
      else if (p.stage === 'model') { status.textContent = `Downloading the model: ${(p.loaded / 1048576).toFixed(1)} MB${p.total ? ' of ' + (p.total / 1048576).toFixed(1) + ' MB' : ''}`; bar.style.width = (p.total ? p.fraction * 100 : 50) + '%'; }
      else if (p.stage === 'session') { status.textContent = 'Initializing the inference session…'; bar.style.width = '100%'; }
    }).then(() => { status.textContent = 'Model ready. Paste a narrative and click the button.'; prog.hidden = true; run.disabled = false;
        Guide.act('wave', 2400, 'Type or paste an incident narrative here.'); setTimeout(() => { if (Guide.state() === 'idle' && !ta.value) Guide.act('point', 3200); }, 2600); })
      .catch(e => { status.className = 'status error'; status.innerHTML = `The model could not be loaded (${esc(e.message)}). You can still choose the codes manually below. <button class="link" id="tool-retry">Retry</button>`; prog.hidden = true;
        el('tool-retry').onclick = () => { rendered.delete('tool'); renderTool(); };
        el('tool-result').hidden = false; renderDownstream(); });

    function probList(id, ranked, nameOf) {
      html(id, ranked.slice(0, 3).map(r => `<li><span class="lbl">${nameOf(r.code)}</span><span class="bar" style="width:${Math.max(2, r.p * 120)}px"></span><span>${fmt.pct(r.p)}</span></li>`).join(''));
    }
    function showPrediction(r) {
      el('tf-mech').value = r.mechanism[0].code; el('tf-energy').value = r.energy[0].code; el('tf-he').value = String(r.highEnergy[0].code);
      probList('tp-mech', r.mechanism, c => mechName[c]); probList('tp-energy', r.energy, c => energyName[c]); probList('tp-he', r.highEnergy, c => heName[c]);
      html('tool-tokens', r.tokens.map(esc).join(' '));
      el('tool-result').hidden = false;
      renderDownstream();
      el('tool-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function renderDownstream() {
      const m = el('tf-mech').value, e = el('tf-energy').value, h = Number(el('tf-he').value);
      const row = D.escalation.mechanism.find(r => r.mechanism === m);
      const heRow = D.high_energy.by_tier_mechanism.find(r => r.mechanism === m);
      const lk = D.sif_lookup.grid[`${m}|${e}|${h}`];
      const sif = lk ? lk[3] : null;
      const erF = row.ER_fatal, erS = row.ER_severe;
      // reading level from the two headline signals of the paper: the fatal escalation ratio of the mechanism and the high-energy flag
      let level;
      if (h === 1) level = erF >= .3 ? 'high' : 'moderate';
      else if (h === 0) level = erF >= 1.5 ? 'moderate' : 'low';
      else level = erF >= 1.5 ? 'high' : (erF >= .3 ? 'moderate' : 'low');
      const advice = { high: 'treat as high potential: investigate as a precursor, verify that direct controls for the energy source were present and effective',
        moderate: 'moderate potential: confirm the energy source and whether a direct control was in place before closing the case as minor',
        low: 'low escalation potential: important for frequency and days away, but rarely a precursor of a fatality' }[level];
      const rel = v => v >= 1 ? `${fmt.ratio(v)} times as prevalent` : `only ${fmt.ratio(v)} times as prevalent (${fmt.ratio(1 / v)} times rarer)`;
      const reading = el('tool-reading'); reading.className = 'reading ' + level;
      Guide.act(level, 5200, { high: 'High potential: check the direct controls.', moderate: 'Moderate potential: confirm the energy source.', low: 'Low escalation potential.' }[level]);
      const full = `Cases coded <b>${mechName[m]}</b> make up ${fmt.pct(row.share_recordable, 1)} of recordables, ${fmt.pct(row.share_severe, 1)} of severe injuries and ${fmt.pct(row.share_fatal, 1)} of fatalities. They are ${rel(erF)} among fatalities as among recordables (95% interval ${fmt.ci(row.ER_fatal_lo, row.ER_fatal_hi)}) and ${rel(erS)} among severe injuries. ` +
        `${fmt.pct(heRow.recordable)} of recordables with this mechanism are high energy, against ${fmt.pct(heRow.fatal)} of fatalities; this case is coded <b>${heName[h].toLowerCase()}</b>. ` +
        (sif == null ? '' : `The SIF potential index for this combination (${mechName[m]}, ${energyName[e]}, ${heName[h].toLowerCase()}) is <b>${fmt.ratio(sif)}</b>: with balanced classes, the model’s odds of a severe or fatal outcome versus a recordable are ${sif >= 1 ? 'above' : 'below'} even. The index uses narrative-derived features only, with fall height and direct-control status set to unknown; it is a likelihood ratio, not a probability for this case. `) +
        `Escalation figures for the mechanism come from the main scope (${fmt.int(D.summary.scope_counts.recordable)} recordable, ${fmt.int(D.summary.scope_counts.severe)} severe, ${fmt.int(D.summary.scope_counts.fatal)} fatal cases in federal OSHA states). Ratios of 0 mean no case of that kind in the numerator tier.`;
      reading.innerHTML = `<b>${mechName[m]}</b>, ${heName[h].toLowerCase()}: ${rel(erF)} among fatalities as among recordables. Reading: <b>${advice}</b>.${info(full, 'Reading in full')}`;
      html('tool-tiles', tile(fmt.ratio(erS), `Severe vs recordable escalation ratio (95% interval ${fmt.ci(row.ER_severe_lo, row.ER_severe_hi)})`, 'green') +
        tile(fmt.ratio(erF), `Fatal vs recordable escalation ratio (95% interval ${fmt.ci(row.ER_fatal_lo, row.ER_fatal_hi)})`, 'pink') +
        tile(sif == null ? 'n/a' : fmt.ratio(sif), 'SIF potential index, (p severe + p fatal) / p recordable') +
        (lk ? tile(`${fmt.pct(lk[0])} / ${fmt.pct(lk[1])} / ${fmt.pct(lk[2])}`, 'Balanced class probabilities: recordable / severe / fatal') : ''));
      Charts.bars({ el: 'tool-he-chart', categories: TIERS.map(t => TIER_NAME[t]), valueName: 'High-energy share (%)', max: 100, height: 260,
        series: [{ name: 'High-energy share', color: 'pink', data: TIERS.map(t => (heRow[t] || 0) * 100) }], tooltipFormatter: p => `${p.name}: ${fmt.dec(p.data.raw, 1)}% high energy` });
      if (!el('tool-he-chart').closest('.card').querySelector('.prov')) provAfter('tool-he-chart', { n: scopeN(), script: [SCRIPT.escalation, SCRIPT.sif, SCRIPT.app], note: 'The browser coder is the int8 bge-small student distilled from the fine-tuned Qwen2.5-7B teacher.' });
      const ex = D.examples[m] || [];
      html('tool-examples', ex.slice(0, 6).map(x => `<li><span class="tag ${x.tier}">${TIER_NAME[x.tier]}</span><span class="muted">${x.case_id}</span><br>${esc(x.narrative)}</li>`).join('') || '<li>No examples for this mechanism.</li>');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();   // deferred scripts run once the document is parsed, so start at once
  return { D, fmt };
})();
