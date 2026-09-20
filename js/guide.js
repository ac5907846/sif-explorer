/* The guide of the Tool page: a construction worker in a hard hat, drawn as inline SVG and moved with CSS only. She waves
   when the coder is ready, points at the text box, follows the typing, thinks while a narrative is coded and reacts to
   the reading (low, moderate, high). Between events she does something small now and then (a wave, a look around, a tip
   of the hat, a stretch). With prefers-reduced-motion she stands still and only her words change. */
'use strict';

const Guide = (() => {
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SKIN = '#F1C9A5', HAIR = '#4A2E1F', HAT = '#F5C542', HAT_D = '#C99A1E', VEST = '#D5E84B', VEST_D = '#9DB022', SHIRT = '#3E6C8F', PANTS = '#34495E', INK = '#2B2B2B';
  const SVG = `<svg viewBox="0 0 120 150" role="img" aria-label="Guide: a construction worker in a hard hat">
    <ellipse cx="60" cy="144" rx="30" ry="4" fill="#000" opacity=".1"/>
    <g class="g-body">
      <rect x="47" y="104" width="11" height="34" rx="4" fill="${PANTS}"/><rect x="62" y="104" width="11" height="34" rx="4" fill="${PANTS}"/>
      <rect x="43" y="135" width="17" height="8" rx="3.5" fill="${INK}"/><rect x="60" y="135" width="17" height="8" rx="3.5" fill="${INK}"/>
      <g class="g-arm g-arm-l"><path d="M41 72 L35 100" stroke="${SHIRT}" stroke-width="9" stroke-linecap="round"/><circle cx="34.5" cy="103" r="5" fill="${SKIN}"/></g>
      <g class="g-arm g-arm-r"><path d="M79 72 L85 100" stroke="${SHIRT}" stroke-width="9" stroke-linecap="round"/><circle cx="85.5" cy="103" r="5" fill="${SKIN}"/></g>
      <g class="g-torso">
        <rect x="40" y="64" width="40" height="46" rx="11" fill="${VEST}" stroke="${VEST_D}" stroke-width="1"/>
        <path d="M60 64 L60 110" stroke="${VEST_D}" stroke-width="1.2"/>
        <rect x="40.5" y="84" width="39" height="5" fill="#D9D9D9"/><rect x="40.5" y="97" width="39" height="5" fill="#D9D9D9"/>
        <path d="M52 64 L60 74 L68 64" fill="${SHIRT}"/>
      </g>
      <g class="g-head">
        <path d="M80 40 q14 8 9 28 q-7 -2 -9 -12z" fill="${HAIR}"/>
        <rect x="55" y="54" width="10" height="12" rx="4" fill="${SKIN}"/>
        <circle cx="60" cy="40" r="19" fill="${SKIN}"/>
        <path d="M41 40 q-1 12 5 16 q-2 -12 1 -18z M79 40 q1 12 -5 16 q2 -12 -1 -18z" fill="${HAIR}"/>
        <g class="g-eyes"><ellipse class="g-eye" cx="52.5" cy="42" rx="2.3" ry="3" fill="${INK}"/><ellipse class="g-eye" cx="67.5" cy="42" rx="2.3" ry="3" fill="${INK}"/></g>
        <circle cx="47" cy="49" r="3.2" fill="#F0A58F" opacity=".55"/><circle cx="73" cy="49" r="3.2" fill="#F0A58F" opacity=".55"/>
        <path class="g-mouth g-smile" d="M53 50 q7 7 14 0" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
        <ellipse class="g-mouth g-oh" cx="60" cy="52" rx="3" ry="3.6" fill="${INK}"/>
        <g class="g-hat"><path d="M39 35 a21 21 0 0 1 42 0z" fill="${HAT}" stroke="${HAT_D}" stroke-width="1"/><rect x="34" y="33" width="52" height="6" rx="3" fill="${HAT}" stroke="${HAT_D}" stroke-width="1"/>
          <path d="M57 15.5 h6 v18 h-6z" fill="${HAT_D}" opacity=".55"/></g>
      </g>
      <g class="g-bang"><circle cx="100" cy="22" r="11" fill="#fff" stroke="${INK}" stroke-width="1.6"/><path d="M100 15 v9" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><circle cx="100" cy="29" r="1.8" fill="${INK}"/></g>
    </g></svg>`;
  const IDLE = ['wave', 'look', 'tip', 'stretch'];
  let root, bubble, state = 'idle', timer = null, idleTimer = null, lastIdle = -1;

  function mount(host, bubbleEl) {
    root = host; host.classList.add('guide'); host.innerHTML = `<div class="guide-fig">${SVG}</div>`;
    bubble = bubbleEl; bubble.classList.add('guide-bubble'); bubble.setAttribute('aria-live', 'polite');
    host.querySelector('.guide-fig').addEventListener('click', () => act('wave', 1800));   // she waves back
    schedule();
  }
  function setClass(name) { root.className = 'guide' + (reduced ? ' still' : '') + ' is-' + name; state = name; }
  function say(text) { if (bubble && text != null) { bubble.textContent = text; bubble.hidden = !text; } }
  /* a pose; with `hold` it falls back to idle after that many milliseconds */
  function act(name, hold, text) {
    if (!root) return; clearTimeout(timer); setClass(name); say(text);
    if (hold) timer = setTimeout(() => setClass('idle'), hold);
    schedule();
  }
  function schedule() {                                   // something small now and then, only while she is idle
    clearTimeout(idleTimer); if (reduced) return;
    idleTimer = setTimeout(() => {
      if (root && root.isConnected && state === 'idle' && document.visibilityState === 'visible') {
        let k; do { k = Math.floor(Math.random() * IDLE.length); } while (k === lastIdle); lastIdle = k;
        act(IDLE[k], 2200);
      } else schedule();
    }, 5200 + Math.random() * 3000);
  }
  return { mount, act, say, state: () => state };
})();
window.Guide = Guide;
