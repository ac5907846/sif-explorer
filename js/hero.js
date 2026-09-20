/* The opening picture of the Findings page. Three thousand dots, one thousand per OSHA tier, so a dot is a tenth of a
   percent of its tier. They first fill one accident triangle, take the colour of their mechanism, then fly apart into
   twelve triangles, one per mechanism, where the width of a layer is the mechanism's share of that tier. Two further
   stages recolour the dots by the high-energy flag and single out the three mechanisms that carry most fatalities.
   Every number comes from data/hero.json (build_hero.py). The picture plays by itself on the landing view; any click,
   key, wheel or touch hands it over, and only the Play button resumes it. */
'use strict';

const Hero = (() => {
  const PER_TIER = 1000, TIERS = ['fatal', 'severe', 'recordable'];            // drawing order, apex first
  const TIER_NAME = { recordable: 'Recordable', severe: 'Severe', fatal: 'Fatal' };
  const TIER_COLOR = { recordable: '#3E86A0', severe: '#4E8A3E', fatal: '#B0507E' };
  const HE_COLOR = '#8A2F5C', LOW_COLOR = '#C4C4C4';
  const SHORT = { ELECTRICAL: 'Electrical', FALL_LOWER: 'Fall, lower level', TRANSPORT: 'Transport', FIRE_EXPLOSION: 'Fire, explosion', HARMFUL_SUBSTANCE: 'Harmful subst.', TEMPERATURE: 'Temperature',
    CAUGHT: 'Caught', VIOLENCE_ANIMAL: 'Violence, animal', STRUCK_BY: 'Struck by', FALL_SAME: 'Fall, same level', OVEREXERTION: 'Overexertion', STRUCK_AGAINST: 'Struck against' };   // key buttons only; the picture and the readout use the full names
  const STAGES = [
    { key: 'tiers', label: 'One triangle' }, { key: 'mechanisms', label: 'Mechanisms' }, { key: 'twelve', label: 'Twelve triangles' },
    { key: 'energy', label: 'High energy' }, { key: 'concentration', label: 'Concentration' }];
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const raf = window.requestAnimationFrame ? cb => window.requestAnimationFrame(cb) : cb => setTimeout(() => cb(performance.now()), 16);
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  let H, F, root, cv, ctx, W = 0, HT = 0, dpr = 1, dots = [], mechs = [], byCode = {}, panels = [], triBox = null;
  let stage = 0, spot = null, running = false, moveStart = 0, MOVE = 1500, labelT = 1, ready = false;

  /* ------------------------------------------------------------ the dots: tier, mechanism, high-energy flag */
  function allocate(shares, total) {                       // largest remainder, so every tier has exactly `total` dots
    const raw = shares.map(s => s * total), n = raw.map(Math.floor); let left = total - n.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - n[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { n[i]++; left--; } });
    return n;
  }
  function buildDots() {
    dots = [];
    TIERS.forEach(t => {
      const n = allocate(mechs.map(m => m.share[t]), PER_TIER);
      mechs.forEach((m, k) => {
        const hi = Math.round(n[k] * m.he[t]);
        for (let i = 0; i < n[k]; i++) dots.push({ tier: t, m: k, he: i < hi, x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, r: 2, fr: 2, tr: 2, a: 1, fa: 1, ta: 1, d: 0, c0: '', c1: '' });
      });
    });
  }

  /* ------------------------------------------------------------ layout A: one triangle, three bands of equal area */
  function layoutTriangle() {
    const TW = Math.min(W * .7, 760), TH = HT - 24, top = 10, cx = W * .45;
    let lo = 2, hi = 14, pts = [];
    const fill = s => { const p = []; for (let y = top + s / 2; y < top + TH; y += s) { const hw = (y - top) / TH * TW / 2; for (let x = -hw + s / 2; x <= hw - s / 2 + 1e-6; x += s) p.push([cx + x, y]); } return p; };
    for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (fill(mid).length >= dots.length) lo = mid; else hi = mid; }
    pts = fill(lo).slice(0, dots.length);
    const r = Math.max(1.1, lo * .33);
    TIERS.forEach((t, b) => {
      const band = pts.slice(b * PER_TIER, (b + 1) * PER_TIER).sort((p, q) => p[0] - q[0] || p[1] - q[1]);   // left to right, so mechanisms become slices
      const mine = dots.filter(d => d.tier === t);
      mine.forEach((d, i) => { d.A = { x: band[i][0], y: band[i][1], r }; });
    });
    const ys = b => { const band = pts.slice(b * PER_TIER, (b + 1) * PER_TIER); return (band[0][1] + band[band.length - 1][1]) / 2; };
    triBox = { x: cx + TW / 2 + 14, rows: TIERS.map((t, b) => ({ t, y: ys(b), hw: (ys(b) - top) / TH * TW / 2 })), cx };
  }

  /* ------------------------------------------------------------ layout B: twelve triangles, fatal on top as in the paper */
  function layoutPanels() {
    const shown = mechs.filter(m => !m.other);
    const cols = W >= 760 ? 4 : W >= 560 ? 3 : 2, rows = Math.ceil(shown.length / cols);
    const cw = W / cols, ch = (HT - 6) / rows, head = 34, layerH = (ch - head - 6) / 3;
    const maxN = Math.max(...shown.map(m => Math.max(...TIERS.map(t => dots.filter(d => d.m === mechs.indexOf(m) && d.tier === t).length))));
    let p = Math.min(5, (layerH - 3) / 6);                                     // at least six rows of dots in a layer
    let rowsN = Math.max(4, Math.floor((layerH - 3) / p));
    while (Math.ceil(maxN / rowsN) * p > cw - 64 && p > 1.6) { p -= .1; rowsN = Math.max(4, Math.floor((layerH - 3) / p)); }
    panels = [];
    shown.forEach((m, k) => {
      const mi = mechs.indexOf(m), px = (k % cols) * cw, py = 3 + Math.floor(k / cols) * ch, cx = px + cw / 2 - 12;
      const P = { m: mi, x: px, y: py, w: cw, h: ch, cx, layers: [] };
      TIERS.forEach((t, li) => {
        const mine = dots.filter(d => d.m === mi && d.tier === t), n = mine.length, nc = Math.max(1, Math.ceil(n / rowsN));
        const y0 = py + head + li * layerH, x0 = cx - nc * p / 2;
        mine.forEach((d, i) => { const c = Math.floor(i / rowsN), rr = i % rowsN; d.B = { x: x0 + c * p + p / 2, y: y0 + (layerH - rowsN * p) / 2 + rr * p + p / 2, r: Math.max(.9, p * .36), a: 1 }; });
        P.layers.push({ t, y: y0 + layerH / 2, right: cx + nc * p / 2 + 6, n });
      });
      panels.push(P);
    });
    dots.forEach(d => { if (mechs[d.m].other) d.B = { x: d.A.x, y: HT + 30, r: 1, a: 0 }; });   // other or unknown has no triangle of its own
  }

  /* ------------------------------------------------------------ stage targets */
  function colourOf(d, s) { return s === 0 ? TIER_COLOR[d.tier] : s === 3 ? (d.he ? HE_COLOR : LOW_COLOR) : mechs[d.m].color; }
  function setTargets(s, instant) {
    const now = performance.now();
    dots.forEach(d => {
      const L = s < 2 ? d.A : d.B;
      d.fx = d.x; d.fy = d.y; d.fr = d.r; d.fa = d.a; d.tx = L.x; d.ty = L.y; d.tr = L.r; d.ta = L.a == null ? 1 : L.a;
      d.c0 = d.c1 || colourOf(d, s); d.c1 = colourOf(d, s);
      d.d = instant ? 0 : (d.m * 28 + Math.random() * 260);                    // mechanisms leave one after another
      if (instant) { d.x = d.tx; d.y = d.ty; d.r = d.tr; d.a = d.ta; d.c0 = d.c1; }
    });
    moveStart = instant ? now - 1e6 : now; labelT = instant ? 1 : 0;
    if (!running) { running = true; raf(frame); }
  }

  /* ------------------------------------------------------------ drawing */
  function frame(ts) {
    const el = ts - moveStart; let busy = false;
    dots.forEach(d => {
      const k = Math.max(0, Math.min(1, (el - d.d) / MOVE)), e = ease(k);
      d.x = d.fx + (d.tx - d.fx) * e; d.y = d.fy + (d.ty - d.fy) * e; d.r = d.fr + (d.tr - d.fr) * e; d.a = d.fa + (d.ta - d.fa) * e; d.k = k;
      if (k < 1) busy = true;
    });
    labelT = Math.max(0, Math.min(1, (el - MOVE * .7) / 500)); if (labelT < 1) busy = true;
    paint();
    if (busy) raf(frame); else running = false;
  }
  function inSpot(d) { return !spot || spot.indexOf(mechs[d.m].code) >= 0; }
  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, HT);
    dots.forEach(d => {
      if (d.a < .02) return;
      ctx.globalAlpha = d.a * (inSpot(d) ? 1 : .13); ctx.fillStyle = d.k < .5 ? d.c0 : d.c1;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.2832); ctx.fill();
    });
    ctx.globalAlpha = labelT; ctx.textBaseline = 'middle';
    if (stage < 2) {
      triBox.rows.forEach(r => {
        ctx.textAlign = 'left'; ctx.fillStyle = '#000'; ctx.font = '600 14px "Segoe UI", Arial, sans-serif'; ctx.fillText(TIER_NAME[r.t], triBox.cx + r.hw + 18, r.y - 9);
        ctx.font = '13px "Segoe UI", Arial, sans-serif'; ctx.fillText(F.int(H.n[r.t]) + ' cases', triBox.cx + r.hw + 18, r.y + 9);
      });
    } else {
      panels.forEach(P => {
        const m = mechs[P.m], on = !spot || spot.indexOf(m.code) >= 0;
        ctx.globalAlpha = labelT * (on ? 1 : .3); ctx.textAlign = 'center'; ctx.fillStyle = '#000';
        ctx.font = '600 13px "Segoe UI", Arial, sans-serif'; ctx.fillText(m.name, P.cx, P.y + 11);
        ctx.font = '12px "Segoe UI", Arial, sans-serif'; ctx.fillText('fatal ratio ' + F.ratio(m.er_fatal[0]), P.cx, P.y + 27);
        ctx.textAlign = 'left'; ctx.font = '11px "Segoe UI", Arial, sans-serif';
        P.layers.forEach(L => ctx.fillText(stage === 3 ? (L.n ? F.pct(m.he[L.t]) : '') : F.pct(m.share[L.t], 1), L.right, L.y));
      });
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------ readout: four slots whose numbers move from their last value */
  const slots = [];
  const FMT = { int: v => F.int(Math.round(v)), pct1: v => F.pct(v, 1), pct0: v => F.pct(v, 0), ratio: v => F.ratio(v), dec2: v => F.dec(v, 2) };
  function setSlot(i, value, fmt, label) {
    const s = slots[i]; s.lab.textContent = label || ''; s.box.style.visibility = value == null ? 'hidden' : 'visible';
    if (value == null) return;
    const from = s.fmt === fmt && s.v != null ? s.v : 0, t0 = performance.now(), dur = reduced ? 0 : 900; s.v = value; s.fmt = fmt; const token = ++s.token;
    (function step(ts) {
      if (token !== s.token) return;
      const k = dur ? Math.min(1, (ts - t0) / dur) : 1; s.num.textContent = FMT[fmt](from + (value - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf(step);
    })(t0);
    setTimeout(() => { if (token === s.token) s.num.textContent = FMT[fmt](value); }, dur + 300);   // frames can stall in a background tab
  }
  function readout() {
    const one = spot && spot.length === 1 ? byCode[spot[0]] : null, T = ['recordable', 'severe', 'fatal'];
    const of = { recordable: 'of recordable cases', severe: 'of severe injuries', fatal: 'of fatalities' };
    let title;
    if (stage === 0) {
      title = 'Three OSHA injury tiers, US construction';
      T.forEach((t, i) => setSlot(i, H.n[t], 'int', `${TIER_NAME[t].toLowerCase()}, ${H.years[t][0]} to ${H.years[t][1]}`)); setSlot(3, null);
    } else if (stage === 3) {
      title = one ? `${one.name}: cases coded as high-energy exposure` : 'Cases coded as high-energy exposure';
      T.forEach((t, i) => setSlot(i, one ? one.he[t] : H.he_share[t], 'pct0', of[t])); setSlot(3, null);
    } else if (stage === 4 && !one) {
      title = 'Electrical, fall to lower level and transport together';
      T.forEach((t, i) => setSlot(i, H.top3[t], 'pct0', of[t])); setSlot(3, H.index.fatal.index, 'dec2', 'concentration index, fatal tier');
    } else if (one) {
      title = one.name; T.forEach((t, i) => setSlot(i, one.share[t], 'pct1', of[t])); setSlot(3, one.er_fatal[0], 'ratio', 'fatal ratio');
    } else {
      title = stage === 1 ? 'The same triangle, coloured by injury mechanism' : 'One triangle per mechanism, in order of fatal ratio';
      const a = mechs[0], z = mechs.filter(m => !m.other).slice(-1)[0];
      setSlot(0, mechs.filter(m => !m.other).length, 'int', 'mechanisms'); setSlot(1, a.er_fatal[0], 'ratio', `highest fatal ratio, ${a.name.toLowerCase()}`);
      setSlot(2, z.er_fatal[0], 'ratio', `lowest, ${z.name.toLowerCase()}`); setSlot(3, null);
    }
    const sw = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
    root.querySelector('.hero-legend').innerHTML = '<span>One dot is .1% of its tier</span>' + (stage === 0 ? ['recordable', 'severe', 'fatal'].map(t => sw(TIER_COLOR[t], TIER_NAME[t])).join('')
      : stage === 3 ? sw(HE_COLOR, 'High-energy exposure') + sw(LOW_COLOR, 'Not high energy') : '<span>Colour: injury mechanism</span>') + (stage >= 2 ? '<span>Layers, top to bottom: fatal, severe, recordable</span>' : '');
    root.querySelector('.hero-title').textContent = title;
    root.querySelectorAll('.hero-stages button').forEach((b, i) => b.classList.toggle('on', i === stage));
    root.querySelectorAll('.hero-key button').forEach(b => b.classList.toggle('on', !!spot && spot.indexOf(b.dataset.code) >= 0));
  }

  /* ------------------------------------------------------------ public moves */
  function go(s, sp) {
    const moved = s !== stage; stage = s; spot = sp || null;
    if (moved) setTargets(stage, reduced); else if (!running) paint();
    readout();
  }
  function spotlight(sp) { spot = sp; if (!running) paint(); readout(); }

  /* ------------------------------------------------------------ autoplay */
  const tour = (() => {
    let playing = false, gen = 0, idx = 0, btn, bar;
    const E = c => [c];
    const STEPS = [
      { ms: 3400, run: s => { go(0); return s(3400); } },
      { ms: 6200, run: s => { go(1); return s(2000).then(() => { spotlight(E('STRUCK_BY')); return s(1800); }).then(() => { spotlight(E('FALL_LOWER')); return s(1800); }).then(() => { spotlight(null); return s(600); }); } },
      { ms: 12000, run: s => { go(2); let p = s(2800); ['ELECTRICAL', 'FALL_LOWER', 'TRANSPORT', 'OVEREXERTION', 'STRUCK_AGAINST'].forEach(c => { p = p.then(() => { spotlight(E(c)); return s(1700); }); }); return p.then(() => { spotlight(null); return s(700); }); } },
      { ms: 5200, run: s => { go(3); return s(5200); } },
      { ms: 5200, run: s => { go(4, H.top3.mechanisms); return s(5200); } }];
    const total = STEPS.reduce((a, x) => a + x.ms, 0);
    function sleep(ms) { const g = gen; return new Promise((res, rej) => setTimeout(() => (g === gen && playing ? res() : rej('stop')), ms)); }
    function loop() {
      const g = gen, st = STEPS[idx], before = STEPS.slice(0, idx).reduce((a, x) => a + x.ms, 0);
      bar.style.transition = 'none'; bar.style.transform = `scaleX(${before / total})`; bar.getBoundingClientRect();
      bar.style.transition = `transform ${st.ms}ms linear`; bar.style.transform = `scaleX(${(before + st.ms) / total})`;
      st.run(sleep).then(() => { if (g !== gen) return; idx = (idx + 1) % STEPS.length; loop(); }, () => {});
    }
    function paintBtn() { btn.firstChild.textContent = playing ? 'Pause' : 'Play'; btn.setAttribute('aria-label', (playing ? 'Pause' : 'Play') + ' the animation'); btn.classList.toggle('on', playing); }
    function play() { if (playing) return; playing = true; gen++; idx = Math.min(stage, STEPS.length - 1); paintBtn(); loop(); }
    function pause() { if (!playing) return; playing = false; gen++; const now = getComputedStyle(bar).transform; bar.style.transition = 'none'; bar.style.transform = now; paintBtn(); }
    function attach(b) { btn = b; bar = b.querySelector('i'); btn.addEventListener('click', () => (playing ? pause() : play())); paintBtn(); }
    return { attach, play, pause, playing: () => playing };
  })();
  function interrupt(e) { if (e.target && e.target.closest && e.target.closest('.hero-play')) return; tour.pause(); }
  document.addEventListener('pointerdown', interrupt, true); document.addEventListener('keydown', interrupt, true);
  window.addEventListener('wheel', interrupt, { passive: true, capture: true }); window.addEventListener('touchstart', interrupt, { passive: true, capture: true });

  /* ------------------------------------------------------------ mount */
  function size() {
    const w = Math.floor(cv.parentElement.clientWidth); if (!w) return false;
    W = w; HT = W >= 760 ? 450 : W >= 560 ? 620 : 840; dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = HT * dpr; cv.style.height = HT + 'px'; ctx = cv.getContext('2d');
    layoutTriangle(); layoutPanels(); return true;
  }
  function mount(host, data, fmt, autoplay) {
    H = data; F = fmt; root = host; mechs = H.mechanisms.slice().sort((a, b) => a.other - b.other); byCode = {}; mechs.forEach(m => { byCode[m.code] = m; });
    host.innerHTML = `<div class="hero-head"><div class="hero-stages" role="group" aria-label="Stage of the picture">${STAGES.map((s, i) => `<button type="button" data-s="${i}">${s.label}</button>`).join('')}</div>
        <button type="button" class="hero-play">Play<i></i></button></div>
      <div class="hero-body"><div class="hero-read"><div class="hero-title" aria-live="polite"></div><div class="hero-nums">${[0, 1, 2, 3].map(() => '<div class="hero-num"><b>0</b><span></span></div>').join('')}</div>
        <div class="hero-legend"></div></div>
      <div class="hero-canvas"><canvas aria-label="Animated picture: the accident triangle of US construction split into one triangle per injury mechanism"></canvas><div class="hero-key" role="group" aria-label="Injury mechanisms">${mechs.filter(m => !m.other).map(m => `<button type="button" data-code="${m.code}"><i style="background:${m.color}"></i>${SHORT[m.code] || m.name}</button>`).join('')}</div></div></div>`;
    cv = host.querySelector('canvas');
    host.querySelectorAll('.hero-num').forEach(b => slots.push({ box: b, num: b.querySelector('b'), lab: b.querySelector('span'), v: null, fmt: null, token: 0 }));
    host.querySelectorAll('.hero-stages button').forEach(b => b.addEventListener('click', () => go(Number(b.dataset.s), Number(b.dataset.s) === 4 ? H.top3.mechanisms : null)));
    host.querySelectorAll('.hero-key button').forEach(b => b.addEventListener('click', () => { const on = spot && spot.length === 1 && spot[0] === b.dataset.code; if (stage === 0) go(1, on ? null : [b.dataset.code]); else spotlight(on ? null : [b.dataset.code]); }));
    cv.addEventListener('mousemove', e => {                                   // a paused picture answers to the pointer
      if (tour.playing() || stage < 2 || stage === 4) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, P = panels.find(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
      const code = P ? mechs[P.m].code : null; if ((spot && spot[0]) !== code || (spot && spot.length > 1)) spotlight(code ? [code] : null);
    });
    cv.addEventListener('mouseleave', () => { if (!tour.playing() && stage >= 2 && stage !== 4 && spot) spotlight(null); });
    buildDots(); size(); tour.attach(host.querySelector('.hero-play'));
    stage = 0; setTargets(0, true); dots.forEach(d => { d.c0 = d.c1 = colourOf(d, 0); }); paint(); readout(); ready = true;
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (cv.isConnected && cv.parentElement.clientWidth && Math.floor(cv.parentElement.clientWidth) !== W) { size(); setTargets(stage, true); paint(); } }, 150); });
    if (autoplay && !reduced) tour.play();
  }
  return { mount, go, spotlight, pause: () => tour.pause(), resize: () => { if (ready && size()) { setTargets(stage, true); paint(); } }, ready: () => ready, state: () => ({ stage, spot, W, HT }) };
})();

window.Hero = Hero;   // app.js reaches the picture through window, a top-level const is not a property of it
