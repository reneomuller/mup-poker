// Kahoot-style quiz driving for the admin: one big „Další ▶“ button (#qzadvance), the space bar / → key, and
// „Automaticky“ (#qzauto): closes a question when time is up or everyone answered, and shows the board 5 s
// after the reveal. Every step goes through the server's quizAdvance with the current seq, so two admin
// tabs, a double press or auto + manual can never skip a step. Standalone: dealer.js is not touched; the box
// is (re)attached above the Kvíz tab's .qzctl buttons whenever dealer.js re-renders that panel.
(function () {
  'use strict';
  const API = '/api/game';
  const AUTO_KEY = 'mup.qzauto';
  const GRACE = 1500, REVEAL_HOLD = 5000;
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const hdr = () => ({ 'x-dealer': ls.get('mup.dealer') || '' });
  let auto = ls.get(AUTO_KEY) !== '0';
  let q = null, skew = 0, busy = false, fired = { seq: -1, at: 0 }, revealSeen = { seq: -1, at: 0 }, timer = null, lastAdv = 0;

  const css = document.createElement('style');
  css.textContent = `
#qzautobox { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; align-items: center; margin-top: 12px; }
#qzadvance { width: 100%; min-height: 64px; font-size: 20px; font-weight: 800; }
#qzautobox label { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; white-space: nowrap; cursor: pointer; }
#qzauto { width: 22px; height: 22px; accent-color: #6754DF; }
#qzautostat { grid-column: 1 / -1; font-size: 14px; opacity: .75; min-height: 1.3em; }
@media (max-width: 480px) { #qzautobox { grid-template-columns: 1fr; } #qzadvance { font-size: 18px; } }`;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.id = 'qzautobox';
  box.innerHTML = '<button class="s-btn s-primary" id="qzadvance" type="button" disabled>Další ▶</button>'
    + '<label><input type="checkbox" id="qzauto"> Automaticky</label><div id="qzautostat" aria-live="polite"></div>';
  const btn = box.querySelector('#qzadvance'), chk = box.querySelector('#qzauto'), stat = box.querySelector('#qzautostat');
  chk.checked = auto;
  chk.onchange = () => { auto = chk.checked; ls.set(AUTO_KEY, auto ? '1' : '0'); render(); };

  const now = () => Date.now() + skew;
  // v4 quizplus: an explanation („Proč“) on the reveal adds reading time (≈ 35 ms per character, at most +7 s)
  const hold = () => REVEAL_HOLD + (q && typeof q.why === 'string' ? Math.min(7000, q.why.length * 35) : 0);
  const live = () => q && ['question', 'reveal', 'board'].includes(q.state);
  const lastQ = () => q && (q.idx ?? -1) + 1 >= (q.total || 0);
  function label() {
    if (!live()) return 'Další ▶';
    if (q.state === 'question') return 'Odhalit';
    if (q.state === 'reveal') return 'Žebříček';
    if (q.idx < 0) return 'Spustit 1. otázku';
    return lastQ() ? 'Konec kvízu' : 'Další otázka ▶';
  }
  function status() {
    if (!live()) return q && q.state === 'done' ? 'Kvíz skončil.' : 'Spusťte kvíz – pak už stačí „Další“ (mezerník nebo →).';
    if (!auto) return 'Automaticky vypnuto – ovládejte tlačítkem, mezerníkem nebo →.';
    if (q.state === 'question') {
      if (q.expected > 0 && q.answered >= q.expected) return 'Všichni odpověděli – odhaluji…';
      const s = Math.max(0, Math.ceil(((q.endsAt || 0) + GRACE - now()) / 1000));
      return `Automaticky odhalím za ${s} s · odpovědělo ${q.answered || 0}/${q.expected || 0}`;
    }
    if (q.state === 'reveal') {
      const s = revealSeen.seq === q.seq ? Math.max(0, Math.ceil((revealSeen.at + hold() - Date.now()) / 1000)) : Math.ceil(hold() / 1000);
      return `Žebříček za ${s} s`;
    }
    if (q.idx < 0) return 'Úvodní obrazovka – „Spustit 1. otázku“ (mezerník nebo →).';
    return lastQ() ? 'Poslední otázka hotová – „Konec kvízu“ ukáže konečné pořadí.' : 'Čekám na vás – „Další otázka“ (mezerník nebo →).';
  }
  function render() {
    btn.textContent = label();
    btn.disabled = !live() || busy;
    stat.textContent = status();
  }

  // keep the box above the quiz buttons (dealer.js rebuilds the panel's innerHTML on its ticks)
  function attach() {
    const ctl = document.querySelector('.qzctl');
    if (ctl && ctl.parentNode && box.nextSibling !== ctl) ctl.parentNode.insertBefore(box, ctl);
  }
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });

  async function advance(isAuto) {
    if (!live() || busy) return;
    busy = true; lastAdv = Date.now(); render();
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...hdr() }, body: JSON.stringify({ op: 'quizAdvance', seq: q.seq || 0, ...(isAuto ? { auto: true } : {}) }) }).then((x) => x.json());
      if (r && r.quiz) q = { ...q, ...r.quiz };
    } catch {}
    busy = false;
    await poll();
  }
  btn.onclick = () => advance(false);
  document.addEventListener('keydown', (e) => {
    if ((e.key !== ' ' && e.key !== 'ArrowRight') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(a.tagName) || a.isContentEditable)) return;
    if (!box.isConnected || !box.offsetParent || !live()) return; // only on the visible Kvíz tab
    e.preventDefault();
    advance(false);
  });

  function maybeAuto() {
    if (!auto || !live() || busy || (fired.seq === q.seq && Date.now() - fired.at < 2500)) return; // a refused auto step retries
    if (q.state === 'question' && ((q.expected > 0 && q.answered >= q.expected) || now() >= (q.endsAt || 0) + GRACE)) { fired = { seq: q.seq, at: Date.now() }; advance(true); }
    else if (q.state === 'reveal') {
      if (revealSeen.seq !== q.seq) revealSeen = { seq: q.seq, at: Date.now() };
      if (Date.now() - revealSeen.at >= hold()) { fired = { seq: q.seq, at: Date.now() }; advance(true); }
    }
  }

  async function poll() {
    clearTimeout(timer);
    try {
      const j = await fetch(API, { headers: hdr(), cache: 'no-store' }).then((x) => x.json());
      // the GET is cached ~0.7 s: right after a step, ignore an older snapshot
      if (j && j.quiz && !(q && j.quiz.seq < q.seq && Date.now() - lastAdv < 2500)) { q = j.quiz; if (q.serverNow) skew = q.serverNow - Date.now(); }
    } catch {}
    attach(); maybeAuto(); render();
    timer = setTimeout(poll, live() ? 1000 : 3000);
  }
  setInterval(() => { if (live()) { maybeAuto(); render(); } }, 250);
  poll();
})();
