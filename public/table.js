// Projector screen: poker table, reveals, board screen. Quiz and exit live in table-quiz.js / table-exit.js.
(function () {
  const { esc, fmtM, sign, get, timeLeft, clock, PHASES, glassHTML, setGlass, t: tx, addTexts } = MUP;
  addTexts({
    'table.live': '{amount} v tomto kole',
    'table.cap.founders': 'Zakladatelé',
    'table.round.up': 'Up',
    'table.round.down': 'Down',
    'table.round.flat': 'Flat',
    'table.tranche.locked': 'Tranše',
    'table.market.kick': 'Karta trhu',
    'table.market.short': 'Trh',
    'table.market.block': 'Blok {block}',
    'table.board.points': 'Body',
    'table.board.drivers': 'Co hýbe oceněním',
    'table.board.return': 'výnos',
    'table.driver.class': 'Peníze třídy',
    'table.driver.rj': 'Smart money',
    'table.driver.revalue': 'Přecenění',
    'table.driver.round': 'Kolo',
    'table.driver.market': 'Trh',
    'table.driver.exit': 'Exit',
    'table.driver.demand': 'Poptávka',
    'table.mult.title': 'násobek bloku',
    'table.award.kick': 'Ocenění',
    'table.award.sharpest': 'Nejlepší investor',
    'table.award.analyst': 'Nejlepší analytik',
    'table.award.contrarian': 'Proti proudu',
    'table.award.custom': 'Zvláštní ocenění',
  });
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const SUITS = ['♠', '♥', '♦', '♣', '♠'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DEMO = window.TABLE_DEMO || null;

  let S = null, built = false, busy = false, lastSeq = 0, potShown = 0, localBoard = null;
  const seatEls = {};
  let seatKey = '';

  // ---------- small helpers shared with table-quiz.js / table-exit.js ----------
  const nb = (s) => String(s).replace(/ /g, ' ');
  const num1 = (n) => (Math.round(n * 10) / 10).toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = (n, signed = true) => {
    const v = Math.round((Number(n) || 0) * 10) / 10;
    return (signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : v < 0 ? '−' : '') + nb(Math.abs(v).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })) + ' %';
  };
  const mult = (m) => '×' + nb((Math.round((Number(m) || 0) * 10) / 10).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }));
  function setText(el, v) { v = String(v ?? ''); if (el && el._t !== v) { el._t = v; el.textContent = v; } }
  function setHTML(el, v) { if (el && el._h !== v) { el._h = v; el.innerHTML = v; return true; } return false; }
  function toggle(el, cls, on) { if (el && el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); }
  // fit a single-line text into its box by shrinking the font (min factor of the CSS size)
  function fit(el, minF = 0.6) {
    if (!el) return;
    el.style.fontSize = '';
    el.classList.remove('two');
    const base = parseFloat(getComputedStyle(el).fontSize);
    let f = 1;
    const floor = Math.max(minF, (1.45 * rem()) / base);
    while (f > floor && el.scrollWidth > el.clientWidth) { f = Math.max(floor, f - 0.05); el.style.fontSize = base * f + 'px'; }
  }
  // banner title: shrink, then wrap to two lines
  function fitTitle(el) {
    fit(el, 0.7);
    if (el.scrollWidth > el.clientWidth) { el.classList.add('two'); el.style.fontSize = parseFloat(getComputedStyle(el).fontSize) * 0.86 + 'px'; }
  }
  // number tweening (requestAnimationFrame, text only)
  const tweens = new Map();
  let raf = 0;
  function tween(el, to, fmt = fmtM, ms = 900) {
    if (!el) return;
    to = Number(to) || 0;
    if (el._to === to && el._fmt === fmt) return;
    const from = el._v ?? to;
    el._to = to; el._fmt = fmt;
    if (ms === 0 || from === to) { el._v = to; tweens.delete(el); setText(el, fmt(to)); return; }
    tweens.set(el, { from, to, t0: performance.now(), ms, fmt });
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    for (const [el, tw] of tweens) {
      const k = Math.min(1, (now - tw.t0) / tw.ms), e = 1 - Math.pow(1 - k, 3);
      el._v = tw.from + (tw.to - tw.from) * e;
      setText(el, tw.fmt(k >= 1 ? tw.to : el._v));
      if (k >= 1) tweens.delete(el);
    }
    if (tweens.size) raf = requestAnimationFrame(frame);
  }
  // Czech typography for text shown big: no line break inside numbers, before % / $, or after one-letter prepositions
  const typo = (str) => String(str ?? '')
    .replace(/(\d) (?=\d{3}(\D|$))/g, '$1\u00a0')
    .replace(/(\d) (?=[%$])/g, '$1\u00a0')
    .replace(/(^|[\s(„])([vkszouaiVKSZOUAI]) /g, '$1$2\u00a0');
  // v3 live numbers: Vnow / mult / rank / chg from the server, with v2 fallbacks (fixed price: V + money sent this round)
  const pending = (s) => s.phase === 'betting' || s.phase === 'closed';
  const vnow = (t) => Number(t.Vnow ?? ((t.V || 0) + (t.live || 0))) || 0;
  const chgOf = (t) => (t.chg != null ? Number(t.chg) || 0 : t.V ? vnow(t) / t.V - 1 : 0);
  const mult2 = (m) => '×' + nb((Number(m) || 0).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const chgTxt = (c) => { const p = Math.round(Math.abs(c) * 1000) / 10; return (c >= 0 ? '▲ ' : '▼ ') + nb(p.toLocaleString('cs-CZ', { maximumFractionDigits: p >= 10 ? 0 : 1 })) + ' %'; };
  function ranks(s) {
    const order = [...s.teams].sort((a, b) => vnow(b) - vnow(a));
    const r = {};
    order.forEach((t, i) => { r[t.id] = t.rank ?? i + 1; });
    return r;
  }
  // the block's demand multiple: live while pending, remembered / read from the drivers afterwards
  const multMem = {};
  function blockMult(s, tid, blk = s.block) {
    const t = (s.teams || []).find((x) => x.id === tid);
    if (pending(s) && t && t.mult != null) { (multMem[blk] = multMem[blk] || {})[tid] = Number(t.mult); return Number(t.mult); }
    const dm = s.demand?.[blk]?.mult?.[tid];
    if (dm != null) return Number(dm);
    for (const x of s.drivers?.[tid] || []) {
      if (x.kind !== 'demand' || (x.block != null && x.block !== blk)) continue;
      if (x.mult != null) return Number(x.mult);
      const m = /×\s*([\d]+(?:[,.]\d+)?)/.exec(x.note || x.label || '');
      if (m) return Number(m[1].replace(',', '.'));
    }
    return multMem[blk]?.[tid] ?? null;
  }
  const team = (s, id) => (s.teams || []).find((t) => t.id === id) || { id, name: '', color: '#888' };
  const on = (s, k) => !!(s.features && s.features[k]);
  const rem = () => Math.min(innerWidth / 100, innerHeight / 56.25);
  window.TBL = { $, esc, typo, fmtM, pct, num1, mult, mult2, vnow, nb, setText, setHTML, toggle, fit, tween, team, on, rem, sleep, stage, screens: [], state: () => S };

  function playUrl() { return location.origin + '/play'; }
  function qrSvg(text) {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag(4, 0); } catch { return ''; }
  }
  const LOCK = '<svg viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="6" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M3.3 6.2V4.4a2.7 2.7 0 0 1 5.4 0v1.8" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

  // ---------- build ----------
  function build(s) {
    $('glass').innerHTML = glassHTML() + '<div class="clock"></div><div class="tl"></div>';
    $('qr').innerHTML = qrSvg(playUrl());
    $('qrminiimg').innerHTML = qrSvg(playUrl());
    $('joinurl').textContent = playUrl().replace(/^https?:\/\//, '');
    built = true;
  }

  function buildSeats(s) {
    const box = $('seats');
    box.innerHTML = '';
    for (const k of Object.keys(seatEls)) delete seatEls[k];
    s.teams.forEach((t, i) => {
      const plate = document.createElement('div');
      plate.className = 'plate s' + i;
      plate.dataset.seat = t.id;
      plate.innerHTML = `<div class="rnd hidden"></div>
        <div class="nm"><span class="star hidden">★</span><span class="dot"></span><span class="tn"></span></div>
        <div class="val tnum">—</div>
        <div class="vr"><span class="rk"></span><span class="chg hidden"></span><span class="mx hidden"></span></div>
        <div class="cap hidden"><div class="capbar"><i class="cf"></i><i class="cc"></i><i class="cr"></i></div></div><div class="sub"></div>
        <div class="delta"></div><div class="badge"></div>`;
      const spot = document.createElement('div');
      spot.className = 'spot s' + i;
      spot.innerHTML = `<div class="stack"></div><div class="rjcards">
        <div class="pcard"><div class="back"></div><div class="face"></div></div>
        <div class="pcard"><div class="back"></div><div class="face"><span>RJ</span></div></div></div>
        <div class="tranche off"><div class="tst"></div><div class="tl">${LOCK}<span></span></div></div>`;
      box.appendChild(spot);
      box.appendChild(plate);
      seatEls[t.id] = { plate, spot, i, val: plate.querySelector('.val'), stack: spot.querySelector('.stack') };
    });
  }

  // ---------- chip stacks (patched, never rebuilt) ----------
  function renderStack(el, cls, rj) {
    const g = Math.min(24, Math.ceil(Math.max(0, cls) / 200000)), p = Math.min(12, Math.ceil(Math.max(0, rj) / 500000));
    const key = g + ',' + p;
    if (el._key === key) return;
    el._key = key;
    const kinds = [...Array(g).fill('g'), ...Array(p).fill('p')];
    const chips = el._chips || (el._chips = []);
    const per = 12;
    kinds.forEach((k, i) => {
      let c = chips[i];
      if (c && c._k !== k) { c.remove(); c = null; }
      if (!c) {
        c = document.createElement('div');
        c.className = 'chip ' + k; c._k = k;
        c.style.left = Math.floor(i / per) * 2.35 + 'rem';
        c.style.bottom = (i % per) * 0.4 + 'rem';
        c.style.zIndex = i % per;
        el.appendChild(c);
        chips[i] = c;
      }
    });
    for (let i = kinds.length; i < chips.length; i++) chips[i]?.remove();
    chips.length = kinds.length;
  }
  function renderTrancheStack(el, amt) {
    const n = amt > 0 ? Math.max(2, Math.min(6, Math.round(amt / 250000))) : 0;
    if (el._n === n) return;
    el._n = n;
    el.innerHTML = Array.from({ length: n }, (_, j) => `<div class="chip" style="bottom:${j * 0.4}rem"></div>`).join('');
  }

  // ---------- geometry ----------
  function center(el) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }
  function stackPt(t) { const r = seatEls[t].stack.getBoundingClientRect(); return [r.left + rem() * 2.4, r.bottom - rem() * 2]; }
  function fly(from, to, kind, n, spread = 1) {
    const size = rem() * 2.3;
    for (let k = 0; k < n; k++) {
      const el = document.createElement('div');
      el.className = 'fly';
      el.innerHTML = `<div class="chip ${kind}"></div>`;
      const jx = (Math.random() - 0.5) * size * 2 * spread, jy = (Math.random() - 0.5) * size * spread;
      const x0 = from[0] - size / 2 + jx, y0 = from[1] - size / 2 + jy;
      stage.appendChild(el);
      const dx = to[0] - from[0] - jx, dy = to[1] - from[1] - jy;
      el.animate([
        { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 0 },
        { transform: `translate(${x0 + dx * 0.5}px, ${y0 + dy * 0.5 - innerHeight * 0.07}px) scale(1.3)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${x0 + dx}px, ${y0 + dy}px) scale(1)`, opacity: 1 },
      ], { duration: 760, delay: k * 70, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
    }
  }

  function badge(t, text, cls) {
    const d = seatEls[t]?.plate.querySelector('.delta');
    if (!d) return;
    d.className = 'delta ' + (cls || '');
    d.textContent = text;
    requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('on')));
    clearTimeout(d._t);
    d._t = setTimeout(() => d.classList.remove('on'), 9000);
  }

  // ---------- reveals ----------
  async function revealClass(s) {
    busy = true;
    try {
      const d = s.reveal.delta || {};
      const potPt = center($('pot'));
      const blk = s.reveal.block || s.block;
      for (const t of s.teams) {
        const x = d[t.id] || 0, m = blockMult(s, t.id, blk);
        const hasM = m != null && Math.abs(m - 1) > 0.004;
        if ((!x && !hasM) || !seatEls[t.id]) continue;
        const e = seatEls[t.id];
        if (x) {
          const sp = stackPt(t.id);
          const n = Math.max(2, Math.min(12, Math.round(Math.abs(x) / 250000)));
          if (x > 0) fly(potPt, sp, 'g', n); else fly(sp, potPt, 'k', n);
          await sleep(820);
        }
        renderStack(e.stack, t.cls, t.rj);
        // the number already climbed live during investing: it only settles (no second count-up)
        tween(e.val, vnow(t), fmtM, 700);
        celebrate(e, hasM && m < 1);
        renderVR(s, t, e, true);
        badge(t.id, hasM ? mult2(m) + (x ? ' · ' + sign(x) : '') : sign(x), (hasM ? m < 1 : x < 0) ? 'neg' : '');
        await sleep(380);
      }
      $('pile').innerHTML = ''; potShown = 0;
    } finally { busy = false; }
  }

  function celebrate(e, neg) {
    const v = e.val;
    v.classList.remove('pop', 'popneg');
    void v.offsetWidth;
    v.classList.add(neg ? 'popneg' : 'pop');
    clearTimeout(v._pop); v._pop = setTimeout(() => v.classList.remove('pop', 'popneg'), 1400);
  }
  // rank chip, live change and (after the showdown) the block's multiple
  function renderVR(s, t, e, showMult) {
    const P = e.plate, rk = P.querySelector('.rk'), cg = P.querySelector('.chg'), mx = P.querySelector('.mx');
    const r = (e._ranks || {})[t.id] ?? t.rank;
    setText(rk, r ? '#' + r : '');
    toggle(rk, 'hidden', !r);
    toggle(rk, 'first', r === 1);
    const c = chgOf(t), showC = Math.abs(c) >= 0.0005;
    toggle(cg, 'hidden', !showC);
    if (showC) { setText(cg, chgTxt(c)); toggle(cg, 'down', c < 0); }
    const settled = !pending(s) && ['showdown', 'rj'].includes(s.phase);
    const m = settled || showMult ? blockMult(s, t.id, s.reveal?.kind === 'class' ? s.reveal.block || s.block : s.block) : null;
    const showM = m != null && Math.abs(m - 1) > 0.004;
    toggle(mx, 'hidden', !showM);
    if (showM) { setText(mx, mult2(m)); toggle(mx, 'down', m < 1); mx.title = tx('table.mult.title'); }
  }

  function rjFace(x) {
    if (!x) return '<span>RJ</span><b>—</b>';
    const a = Math.abs(x), v = a >= 1e6 ? (a / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + 'M' : Math.round(a / 1e3) + 'k';
    return `<span>RJ</span><b>${x > 0 ? '+' : '−'}${v}</b><span>$</span>`;
  }

  async function revealRJ(s) {
    busy = true;
    try {
      const d = s.reveal.delta || {};
      for (const t of s.teams) {
        const e = seatEls[t.id];
        if (!e) continue;
        const x = d[t.id] || 0;
        const card = e.spot.querySelector('.rjcards .pcard:last-child');
        card.querySelector('.face').innerHTML = rjFace(x);
        card.classList.add('up');
        if (x) {
          await sleep(450);
          const c = center(card);
          fly(c, stackPt(t.id), x > 0 ? 'p' : 'k', Math.max(2, Math.min(8, Math.round(Math.abs(x) / 500000))), 0.4);
          await sleep(650);
          renderStack(e.stack, t.cls, t.rj);
          tween(e.val, vnow(t), fmtM, 1000);
          badge(t.id, sign(x), x < 0 ? 'neg' : 'pink');
        }
        await sleep(250);
      }
    } finally { busy = false; }
  }

  function revealRevalue(s) {
    const d = s.reveal.delta || {};
    for (const t of s.teams) {
      if (!seatEls[t.id]) continue;
      tween(seatEls[t.id].val, vnow(t), fmtM, 1600);
      if (d[t.id]) badge(t.id, sign(d[t.id]), d[t.id] < 0 ? 'neg' : '');
    }
  }

  async function revealTranche(s) {
    busy = true;
    try {
      const r = s.reveal, e = seatEls[r.team];
      if (!e) return;
      const t = team(s, r.team);
      const from = center(e.spot.querySelector('.tranche .tst'));
      fly(from, stackPt(r.team), 'p', Math.max(2, Math.min(8, Math.round((r.amt || 0) / 250000))), 0.4);
      await sleep(900);
      renderStack(e.stack, t.cls, t.rj);
      tween(e.val, vnow(t), fmtM, 1000);
      badge(r.team, '+' + fmtM(r.amt || 0), 'pink');
      renderTranches(s);
    } finally { busy = false; }
  }

  // a market card: flip big in the centre, pop the effects on the plates, then park it on the board
  async function revealMarket(s) {
    busy = true;
    try {
      const r = s.reveal;
      const flipped = s.market?.flipped || [];
      const card = flipped[flipped.length - 1] || { title: r.title, text: r.text, effects: {} };
      const fx = card.effects || {};
      const big = $('mbig');
      const chips = s.teams.filter((t) => fx[t.id]).map((t) => `<span class="${fx[t.id] < 0 ? 'neg' : ''}"><i style="background:${t.color}"></i>${esc(t.name)} ${pct(fx[t.id])}</span>`).join('');
      big.innerHTML = `<div class="pcard"><div class="back"></div><div class="face">
        <div class="mk">${esc(tx('table.market.kick'))}</div><div class="mt">${esc(typo(r.title || card.title || ''))}</div>
        <div class="mx">${esc(typo(r.text || card.text || ''))}</div>${chips ? `<div class="mfx">${chips}</div>` : ''}</div></div>`;
      big.classList.remove('hidden');
      big.getAnimations().forEach((a) => a.cancel());
      big.animate([{ transform: 'translateY(-60vh) rotate(-6deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
      await sleep(750);
      big.querySelector('.pcard').classList.add('up');
      await sleep(1500);
      for (const t of s.teams) {
        if (!seatEls[t.id]) continue;
        const p = fx[t.id];
        tween(seatEls[t.id].val, vnow(t), fmtM, 1400);
        if (p) badge(t.id, pct(p), p < 0 ? 'neg' : '');
      }
      await sleep(6500);
      // park: shrink into the newest community card
      renderCommunity(s, true);
      const slot = document.querySelector('#board .mcard.newest');
      if (slot) {
        const a = big.getBoundingClientRect(), b = slot.getBoundingClientRect();
        const k = b.width / a.width;
        await big.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${k})`, opacity: 0.2 }],
          { duration: 700, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }).finished.catch(() => {});
      }
      big.classList.add('hidden');
      big.getAnimations().forEach((a) => a.cancel());
      slot?.classList.remove('hold');
    } finally { busy = false; }
  }

  // ---------- community cards: five blocks, or flipped market cards ----------
  function renderCommunity(s, force) {
    const board = $('board');
    const market = on(s, 'market');
    if (!market) {
      if (board._mode !== 'blocks') {
        board._mode = 'blocks';
        board.className = 'board';
        board.innerHTML = [1, 2, 3, 4, 5].map((n) => `
          <div class="pcard ${n === 2 || n === 3 ? 'red' : ''}" data-n="${n}"><div class="back"></div>
            <div class="face"><span class="r">${n}<br>${SUITS[n - 1]}</span><div><div class="s">${SUITS[n - 1]}</div><div class="c">Blok ${n}</div></div><span class="r r2">${n}<br>${SUITS[n - 1]}</span></div>
          </div>`).join('');
      }
      board.querySelectorAll('.pcard').forEach((c) => {
        const n = +c.dataset.n;
        toggle(c, 'up', s.phase === 'final' || n < s.block || (n === s.block && s.phase !== 'lobby'));
        toggle(c, 'cur', n === s.block && s.phase !== 'final');
      });
      return;
    }
    // during a market reveal the newest card is held back until the big card lands
    const flipped = (s.market?.flipped || []).slice(-3);
    const holding = busy && !force;
    const shown = holding && board._mode === 'market' ? board._shown : flipped;
    const key = JSON.stringify(shown.map((c) => c.id || c.title));
    if (board._mode === 'market' && board._key === key) return;
    board._mode = 'market'; board._key = key; board._shown = shown;
    board.className = 'board market';
    const slots = [...shown];
    while (slots.length < 3) slots.push(null);
    board.innerHTML = slots.map((c, i) => c
      ? `<div class="mcard ${i === shown.length - 1 ? 'newest' : ''}"><div class="pcard up"><div class="back"></div><div class="face"><div class="mk">${esc(c.block ? tx('table.market.block', { block: c.block }) : tx('table.market.short'))}</div><div class="mt">${esc(typo(c.title))}</div></div></div></div>`
      : `<div class="mcard empty"><div class="pcard"><div class="back"></div><div class="face"></div></div></div>`).join('');
  }

  function renderPot(s) {
    const show = s.phase === 'betting' || s.phase === 'closed';
    toggle($('pot'), 'hidden', !show);
    if (!show) { if (!busy) { $('pile').innerHTML = ''; potShown = 0; } return; }
    const pile = $('pile');
    if (s.betCount < potShown) { pile.innerHTML = ''; potShown = 0; }
    while (potShown < Math.min(s.betCount, 30)) {
      const i = potShown++;
      const m = document.createElement('div');
      m.className = 'mini';
      const r = ((i * 37) % 34) - 17, x = ((i * 53) % 16) - 8, y = ((i * 29) % 10) - 5;
      m.style.setProperty('--r', r + 'deg');
      m.style.marginLeft = x * 0.45 + 'rem'; m.style.marginTop = y * 0.3 + 'rem';
      pile.appendChild(m);
    }
    setHTML($('potlab'), esc(tx('table.pot', { n: '\u0001', total: s.playerCount })).replace('\u0001', `<b>${s.betCount}</b>`));
  }

  function renderGlass(s) {
    const w = $('glass'), left = timeLeft(s), svg = w.querySelector('svg');
    if (!svg) return;
    if (left === null) { setGlass(svg, 0.66); toggle(w, 'idle', true); toggle(w, 'over', false); toggle(w, 'low', false); return; }
    toggle(w, 'idle', false);
    setGlass(svg, s.timerTotal ? left / s.timerTotal : 0);
    setText(w.querySelector('.clock'), left > 0 ? clock(left) : tx('table.timeUp'));
    setText(w.querySelector('.tl'), s.timerLabel || (PHASES[s.phase] || ''));
    toggle(w, 'over', left <= 0);
    toggle(w, 'low', left > 0 && left <= 30000);
  }

  // ---------- phase banner ----------
  let phNow = null;
  function renderBanner(s) {
    setText($('blk'), s.phase === 'final' ? tx('table.final') : tx('table.block', { block: s.block, max: s.maxBlock }));
    let ph = PHASES[s.phase] || '';
    const pres = s.phase === 'pitch' && s.presenting ? team(s, s.presenting) : null;
    if (pres) ph = tx('table.pitchTitle', { team: pres.name });
    $('banner').dataset.phase = s.phase;
    if (ph !== phNow) {
      const box = $('ph').parentNode;
      const old = box.querySelector('.phw:not(.old)');
      if (phNow === null || !old) { setText($('ph'), ph); fitTitle($('ph')); }
      else {
        const nw = document.createElement('span');
        nw.className = 'phw new';
        nw.textContent = ph;
        box.appendChild(nw);
        fitTitle(nw);
        old.removeAttribute('id'); nw.id = 'ph';
        requestAnimationFrame(() => requestAnimationFrame(() => { old.classList.add('old'); nw.classList.remove('new'); }));
        setTimeout(() => old.remove(), 600);
      }
      phNow = ph;
    }
    // pitch: the presenting team's one-liner under the title (startup cards)
    const ol = pres && on(s, 'cards') ? (s.cards?.[pres.id]?.oneLiner || '') : '';
    setText($('phsub'), ol ? '„' + ol + '“' : '');
    toggle($('phsub'), 'hidden', !ol);
  }

  // ---------- seats ----------
  function renderSeats(s, animate) {
    const leader = [...s.teams].sort((a, b) => vnow(b) - vnow(a))[0]?.id;
    const rk = ranks(s);
    const cap = on(s, 'captable'), rounds = on(s, 'rounds');
    const rx = rjDelta(s);
    const anyPriced = rounds && Object.values(s.rounds || {}).some((r) => r && r.kind && r.kind !== 'flat');
    s.teams.forEach((t) => {
      const e = seatEls[t.id];
      if (!e) return;
      const P = e.plate;
      P.style.setProperty('--tc', t.color);
      P.querySelector('.dot').style.background = t.color;
      const tn = P.querySelector('.tn');
      if (tn._t !== t.name) { setText(tn, t.name); fit(tn, 0.83); }
      const inv = t.cls + t.rj, lv = t.live || 0;
      const sub = P.querySelector('.sub');
      const c = cap && t.cap;
      setHTML(sub, lv
        ? esc(tx('table.live', { amount: '\u0001' })).replace('\u0001', `<b>${(lv > 0 ? '+' : '−') + esc(fmtM(Math.abs(lv)))}</b>`)
        : c ? `${esc(tx('table.cap.founders'))} <b>${pct(c.founders, false)}</b>`
        : esc(inv > 0 ? tx('table.seat.invested', { amount: fmtM(inv) }) : tx('table.seat.valuation')));
      toggle(sub, 'live', !!lv); toggle(sub, 'neg', lv < 0);
      toggle(P.querySelector('.star'), 'hidden', !((inv > 0 || lv > 0) && t.id === leader && s.teams.some((x) => vnow(x) !== vnow(t))));
      e._ranks = rk;
      if (!busy) renderVR(s, t, e, false);
      setText(P.querySelector('.badge'), tx('table.badge'));
      toggle(P, 'presenting', s.phase === 'pitch' && s.presenting === t.id);
      // cap table: founders / class / RJ split under the value
      toggle(P.querySelector('.cap'), 'hidden', !c);
      if (c) {
        const [cf, cc, cr] = P.querySelectorAll('.capbar i');
        cf.style.flexGrow = Math.max(0, c.founders); cc.style.flexGrow = Math.max(0, c.cls); cr.style.flexGrow = Math.max(0, c.rj);
      }
      // priced round badge
      const rb = P.querySelector('.rnd'), r = rounds && s.rounds?.[t.id];
      toggle(rb, 'hidden', !r);
      if (r) {
        rb.className = 'rnd ' + (r.kind || 'flat');
        setText(rb, r.kind === 'up' ? '▲ ' + tx('table.round.up') + ' ' + pct(r.pct) : r.kind === 'down' ? '▼ ' + tx('table.round.down') + ' ' + pct(r.pct) : tx('table.round.flat'));
        // flat badges only make sense next to up/down ones
        toggle(rb, 'hidden', r.kind === 'flat' && !anyPriced);
      }
      if (!busy) {
        tween(e.val, vnow(t), fmtM, animate ? 900 : 0);
        renderStack(e.stack, Math.max(0, t.cls + lv), t.rj);
      }
      if (e.val._fitT !== e.val._t) { e.val._fitT = e.val._t; fit(e.val, 0.75); }
      const card = e.spot.querySelector('.rjcards .pcard:last-child');
      if (!rx && !busy) card.classList.remove('up');
      if (rx && !busy) {
        const face = rjFace(rx[t.id] || 0);
        const f = card.querySelector('.face');
        if (f._h !== face) { f._h = face; f.innerHTML = face; }
        card.classList.add('up');
      }
    });
    if (!busy) renderTranches(s);
    const light = $('light');
    const p = s.phase === 'pitch' && s.presenting ? seatEls[s.presenting] : null;
    if (p) {
      const f = light.getBoundingClientRect(), c = center(p.plate);
      const x = ((c[0] - f.left) / f.width) * 100, y = Math.max(0, Math.min(100, ((c[1] - f.top) / f.height) * 100));
      const bg = `radial-gradient(ellipse 34% 46% at ${x.toFixed(1)}% ${y.toFixed(1)}%, rgba(255,236,190,.3), transparent 70%)`;
      if (light._bg !== bg) { light._bg = bg; light.style.background = bg; }
    }
    toggle(light, 'on', !!p);
  }

  // RJ cards stay face up for the rest of the block, even after a later market card or tranche
  const rjMem = {};
  function rjDelta(s) {
    if (s.reveal && s.reveal.kind === 'rj' && s.reveal.block === s.block) return (rjMem[s.block] = s.reveal.delta || {});
    if (s.phase !== 'rj') return null;
    if (rjMem[s.block]) return rjMem[s.block];
    const d = {};
    let any = false;
    for (const [tid, arr] of Object.entries(s.drivers || {})) for (const x of arr || []) if (x.kind === 'rj' && x.block === s.block) { d[tid] = (d[tid] || 0) + (x.delta || 0); any = true; }
    return any ? d : null;
  }

  function renderTranches(s) {
    const show = on(s, 'tranches');
    const locked = {};
    if (show) for (const tr of s.tranches || []) if (tr.status === 'locked') locked[tr.team] = (locked[tr.team] || 0) + (tr.amt || 0);
    for (const [id, e] of Object.entries(seatEls)) {
      const box = e.spot.querySelector('.tranche'), amt = locked[id] || 0;
      toggle(box, 'off', !amt);
      if (amt) { renderTrancheStack(box.querySelector('.tst'), amt); setText(box.querySelector('.tl span'), fmtM(amt)); }
    }
  }

  function renderJoin(s) {
    const lobby = s.phase === 'lobby';
    toggle($('join'), 'hidden', !lobby);
    toggle(stage, 'lobby', lobby);
    toggle($('credits'), 'off', !lobby);
    const mini = !lobby && ['pitch', 'betting', 'closed'].includes(s.phase);
    toggle($('qrmini'), 'hidden', !mini);
    setText($('qrminil'), tx('table.qr'));
  }

  // ---------- board screen ----------
  function boardOn(s) {
    if (localBoard !== null) return localBoard;
    if (s.exit && on(s, 'exit')) return s.screen === 'board';
    return s.screen === 'board' || s.phase === 'final';
  }
  function renderBoardScreen(s) {
    const show = boardOn(s);
    toggle($('boardscreen'), 'on', show);
    if (!show) return;
    setText($('bkick'), s.phase === 'final' ? tx('phase.final') : tx('table.board.kick', { block: s.block }));
    renderChart(s);
    renderRank(s);
    renderPeople(s);
    renderTicker(s);
  }

  function renderChart(s) {
    const svg = $('chart'), box = svg.parentNode;
    const W = Math.max(200, box.clientWidth), Ht = Math.max(150, box.clientHeight), u = rem();
    const H0 = s.history.length ? s.history : [{ label: 'Start', V: {} }];
    const live = pending(s) && s.teams.some((t) => Math.abs(vnow(t) - t.V) >= 1);
    const H = live ? [...H0, { label: tx('table.board.now'), V: Object.fromEntries(s.teams.map((t) => [t.id, vnow(t)])) }] : H0;
    const key = JSON.stringify([W, Ht, H.map((h) => [h.label, h.V]), s.teams.map((t) => [t.name, t.color])]);
    if (svg._key === key) return;
    svg._key = key;
    svg.setAttribute('viewBox', `0 0 ${W} ${Ht}`);
    const fs = 1.45 * u, fsName = 1.6 * u;
    const all = H.flatMap((h) => Object.values(h.V));
    const max = Math.max(1, ...all) * 1.1;
    let nameW = 0;
    for (const t of s.teams) nameW = Math.max(nameW, Math.min(14, t.name.length) * fsName * 0.58);
    const padL = fs * 4.2, padR = nameW + u * 1.6, padT = u, padB = fs * 2.2;
    const x = (i) => padL + (H.length === 1 ? (W - padL - padR) / 2 : (i / (H.length - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - v / max) * (Ht - padT - padB);
    let out = '';
    const step = Math.pow(10, Math.floor(Math.log10(max / 4)));
    const nice = [1, 2, 5, 10].map((k) => k * step).find((k) => max / k <= 5) || step * 10;
    for (let v = 0; v <= max; v += nice) {
      out += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(242,234,214,.1)"/>`;
      out += `<text x="${padL - u * 0.8}" y="${y(v) + fs * 0.35}" text-anchor="end" fill="rgba(242,234,214,.6)" font-size="${fs}">${esc(fmtM(v).replace(/\s\$$/, '').replace(/ \$$/, ''))}</text>`;
    }
    // x labels: shortened, kept right-to-left as long as they do not collide
    const cut = (l) => { l = String(l); return l.length > 18 ? l.slice(0, 17) + '…' : l; };
    const lw = (l) => cut(l).length * fs * 0.56;
    let leftEdge = Infinity;
    const keep = [];
    for (let i = H.length - 1; i >= 0; i--) {
      const w = lw(H[i].label), last = i === H.length - 1, firstI = i === 0 && H.length > 1;
      const anchor = H.length === 1 ? 'middle' : last ? 'end' : firstI ? 'start' : 'middle';
      const x0 = anchor === 'end' ? x(i) - w : anchor === 'start' ? x(i) : x(i) - w / 2;
      if (x0 + w + u * 1.2 > leftEdge) continue;
      keep.push({ i, anchor });
      leftEdge = x0;
    }
    for (const k of keep) out += `<text x="${x(k.i)}" y="${Ht - fs * 0.5}" text-anchor="${k.anchor}" fill="rgba(242,234,214,.65)" font-size="${fs}">${esc(cut(H[k.i].label))}</text>`;
    const ends = [];
    for (const t of s.teams) {
      const pts = H.map((h, i) => [x(i), y(h.V[t.id] ?? 0)]);
      out += `<polyline fill="none" stroke="${t.color}" stroke-width="${u * 0.42}" stroke-linejoin="round" stroke-linecap="round" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
      pts.forEach((p) => { out += `<circle cx="${p[0]}" cy="${p[1]}" r="${u * 0.5}" fill="${t.color}"/>`; });
      const last = pts[pts.length - 1];
      ends.push({ t, y: last[1], x: last[0] });
    }
    ends.sort((a, b) => a.y - b.y);
    const gap = fsName * 1.15;
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < gap) ends[i].y = ends[i - 1].y + gap;
    const over = ends.length ? ends[ends.length - 1].y - (Ht - padB) : 0;
    if (over > 0) ends.forEach((e) => { e.y -= over; });
    for (const e of ends) {
      const nm = e.t.name.length > 14 ? e.t.name.slice(0, 13) + '…' : e.t.name;
      out += `<text x="${e.x + u * 1.1}" y="${e.y + fsName * 0.35}" fill="${e.t.color}" font-size="${fsName}" font-weight="700">${esc(nm)}</text>`;
    }
    svg.innerHTML = out;
  }

  // keyed rows positioned with transforms, so re-ordering slides instead of jumping
  function keyedList(ol, items, rowH, html) {
    const rows = ol._rows || (ol._rows = new Map());
    const seen = new Set();
    items.forEach((it, i) => {
      seen.add(it.key);
      let li = rows.get(it.key);
      if (!li) {
        li = document.createElement('li');
        li.style.transform = `translateY(${(i + 0.6) * rowH}rem)`;
        li.style.opacity = '0';
        ol.appendChild(li);
        rows.set(it.key, li);
      }
      setHTML(li, html(it, i));
      const tf = `translateY(${i * rowH}rem)`;
      requestAnimationFrame(() => { li.style.transform = tf; li.style.opacity = '1'; });
    });
    for (const [k, li] of rows) if (!seen.has(k)) { li.remove(); rows.delete(k); }
    ol.style.height = items.length * rowH + 'rem';
  }

  function renderRank(s) {
    const H = s.history || [];
    const prev = H.length > 1 ? H[H.length - 2].V : null;
    const items = [...s.teams].sort((a, b) => vnow(b) - vnow(a)).map((t) => ({ key: t.id, t }));
    const v3 = s.teams.some((t) => t.chg != null || t.Vnow != null) || pending(s);
    const settled = ['showdown', 'rj'].includes(s.phase);
    keyedList($('rank'), items, 5.6, ({ t }, i) => {
      const p = prev?.[t.id];
      const ch = v3 ? chgOf(t) * 100 : p ? ((t.V - p) / p) * 100 : 0;
      const chs = (v3 || p) && Math.abs(ch) >= 0.05 ? `<small class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲' : '▼'} ${pct(Math.abs(ch), false)}</small>` : `<small class="muted">${esc(tx('table.board.same'))}</small>`;
      const m = pending(s) ? (t.mult ?? null) : settled ? blockMult(s, t.id) : null;
      const ms = m != null && Math.abs(m - 1) > 0.004 ? `<small class="mx ${m < 1 ? 'down' : ''}">${esc(mult2(m))}</small>` : '';
      return `<span class="pos">${i + 1}</span><span class="tn"><span class="dot" style="background:${t.color}"></span><span class="nmx">${esc(t.name)}</span></span><span class="tv"><b>${esc(fmtM(vnow(t)))}</b><span class="tvs">${ms}${chs}</span></span>`;
    });
  }

  function renderPeople(s) {
    const track = on(s, 'track'), points = on(s, 'points') && s.points && Array.isArray(s.points.leaders);
    const inv = $('inv');
    const box = $('bspeople');
    const avail = box.clientHeight / rem();
    const nInv = points ? (avail > 50 ? 5 : 4) : Math.max(3, Math.min(10, Math.floor((avail - 4) / 4.4)));
    const L = (s.leaders || []).slice(0, nInv);
    if (!L.length) { setHTML(inv, `<li class="empty muted">${esc(tx('table.board.noInvestors'))}</li>`); inv._rows = null; inv.style.height = ''; }
    else {
      if (!inv._rows) { inv.innerHTML = ''; inv._h = null; }
      keyedList(inv, L.map((l) => ({ key: l.name + '|' + l.team, l })), 4.4, ({ l }, i) => {
        const t = team(s, l.team);
        const ret = track && l.returnPct != null ? `<b class="${l.returnPct > 0 ? 'up' : l.returnPct < 0 ? 'down' : 'muted'}">${pct(l.returnPct)}</b>` : '';
        return `<span class="pn"><i>${i + 1}.</i> ${esc(l.name)}</span><span class="pv"><span class="dot" style="background:${t.color}"></span>${esc(fmtM(l.value))}${ret}</span>`;
      });
    }
    toggle($('bspts'), 'hidden', !points);
    if (points) {
      const left = avail - inv.offsetHeight / rem() - 7;
      const n = Math.max(3, Math.min(10, Math.floor(left / 2.9)));
      const P = s.points.leaders.slice(0, n);
      const ol = $('pts');
      if (!P.length) { setHTML(ol, `<li class="empty muted">${esc(tx('table.board.noPoints'))}</li>`); ol._rows = null; ol.style.height = ''; return; }
      if (!ol._rows) { ol.innerHTML = ''; ol._h = null; }
      keyedList(ol, P.map((p) => ({ key: p.name + '|' + p.team, p })), 2.9, ({ p }, i) => {
        const t = team(s, p.team);
        return `<span class="pn one"><i>${i + 1}.</i> <span class="dot" style="background:${t.color}"></span>${esc(p.name)}</span><span class="pp">${esc(nb((p.total || 0).toLocaleString('cs-CZ')))}</span>`;
      });
    }
  }
  addTexts({ 'table.board.noPoints': 'Zatím nikdo nemá body.', 'table.board.now': 'Teď' });

  function renderTicker(s) {
    const show = on(s, 'drivers') && s.drivers && typeof s.drivers === 'object';
    const box = $('ticker');
    const all = [];
    if (show) for (const [tid, arr] of Object.entries(s.drivers)) for (const d of arr || []) if (d.kind !== 'demand' || Math.abs(d.delta || 0) >= 1) all.push({ ...d, team: d.team || tid });
    all.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const items = all.slice(0, 14);
    toggle(box, 'hidden', !items.length);
    toggle($('boardscreen'), 'withticker', !!items.length);
    if (!items.length) return;
    const html = items.map((d) => {
      const t = team(s, d.team);
      const kind = tx('table.driver.' + d.kind) !== 'table.driver.' + d.kind ? tx('table.driver.' + d.kind) : d.kind;
      const note = String(d.note || '').trim();
      const label = !note || d.kind === 'class' ? kind : note.toLowerCase().includes(String(kind).toLowerCase()) ? note : kind + ' · ' + note;
      return `<span class="tk"><span class="dot" style="background:${t.color}"></span><b>${esc(t.name)}</b> <span class="${d.delta < 0 ? 'down' : 'up'}">${d.delta < 0 ? '▼' : '▲'} ${esc(sign(d.delta || 0))}</span> <span class="tkk">${esc(label)}</span></span>`;
    }).join('');
    const strip = $('tkstrip');
    if (setHTML(strip, html + html)) {
      requestAnimationFrame(() => {
        const w = strip.scrollWidth / 2;
        strip.style.animationDuration = Math.max(20, w / (rem() * 7)) + 's';
      });
    }
  }

  // ---------- notes clouds ----------
  const SLOTS = [[33, 31], [67, 64], [67, 31], [33, 64], [50, 47], [50, 21], [27, 47], [73, 47], [38, 80], [62, 80], [22, 31], [78, 64]];
  const cloudEls = new Map();
  function cloudSize(p) {
    const a = Math.abs(p.amt || 0), n = (p.a || '').length;
    if (a >= 400000 || n > 160) return 'l';
    if (a >= 150000 || n > 70) return 'm';
    return 's';
  }

  // a question pinned from the board, shown big on the table
  let qpinKey = null;
  function renderQPin(s) {
    const el = $('qpin'), q = s.qpin || null;
    const key = JSON.stringify([q, s.teams.map((t) => t.name)]);
    if (key === qpinKey) return;
    qpinKey = key;
    if (!q) { el.classList.add('hidden'); return; }
    const t = team(s, q.team);
    el.innerHTML = `<div class="qph"><span class="dot" style="background:${t.color}"></span><span>Otázka pro <b>${esc(t.name)}</b></span><span class="qpc">${esc((s.qcats || {})[q.cat] || '')}</span><span class="qpv">▲ ${q.votes}</span></div>
      <div class="qpt">${esc(typo(q.text))}</div>${q.answer ? `<div class="qpa">${esc(typo(q.answer.text))}</div>` : ''}`;
    el.classList.remove('hidden');
  }

  function renderClouds(s) {
    const pins = s.pins || [], box = $('clouds');
    const ids = new Set(pins.map((p) => p.id));
    for (const [id, el] of cloudEls) if (!ids.has(id)) { el.classList.add('out'); setTimeout(() => el.remove(), 400); cloudEls.delete(id); }
    pins.forEach((p, i) => {
      let el = cloudEls.get(p.id);
      const t = team(s, p.team);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cloud ' + cloudSize(p);
        const amt = p.amt ? `<span class="camt ${p.amt < 0 ? 'neg' : ''}">${p.amt < 0 ? '−' : '+'}${esc(fmtM(Math.abs(p.amt)))}</span>` : '';
        el.innerHTML = `<div class="ch"><span class="dot" style="background:${t.color}"></span><b>${esc(t.name)}</b>${amt}</div>
          <div class="cq">${esc(p.q)}</div><div class="ca">${esc(typo(p.a))}</div>`;
        el.style.setProperty('--tc', t.color);
        el.style.setProperty('--r', ((((p.id.charCodeAt(0) + p.id.charCodeAt(1)) % 7) - 3) * 0.8) + 'deg');
        box.appendChild(el);
        cloudEls.set(p.id, el);
      }
      const [x, y] = SLOTS[i % SLOTS.length];
      el.style.left = x + '%'; el.style.top = y + '%';
    });
  }

  // ---------- awards spotlight ----------
  const seenAwards = new Set();
  let awardsPrimed = false, awardQ = [], awardBusy = false;
  function renderAwards(s, first) {
    const list = s.awards || [];
    if (!awardsPrimed || first) { list.forEach((a) => seenAwards.add(a.id)); awardsPrimed = true; return; }
    for (const a of list) if (!seenAwards.has(a.id)) { seenAwards.add(a.id); if (on(s, 'track')) awardQ.push(a); }
    if (!awardBusy && awardQ.length) showAward(awardQ.shift());
  }
  async function showAward(a) {
    awardBusy = true;
    const el = $('award');
    const t = team(S, a.team);
    const kind = tx('table.award.' + a.kind) !== 'table.award.' + a.kind ? tx('table.award.' + a.kind) : tx('table.award.custom');
    el.innerHTML = `<div class="aw-rays"></div><div class="aw-card">
      <div class="aw-kick">${esc(tx('table.award.kick'))} · ${esc(tx('table.block', { block: a.block || S.block, max: S.maxBlock }))}</div>
      <div class="aw-kind">${esc(kind)}</div>
      <div class="aw-name">${esc(a.name || '')}</div>
      <div class="aw-team"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</div>
      ${a.note ? `<div class="aw-note">${esc(typo(a.note))}</div>` : ''}</div>`;
    el.classList.remove('hidden', 'out');
    await sleep(8000);
    el.classList.add('out');
    await sleep(600);
    el.classList.add('hidden');
    awardBusy = false;
    if (awardQ.length) showAward(awardQ.shift());
  }

  // ---------- main loop ----------
  async function tick() {
    let s = await get();
    if (DEMO) s = DEMO(s);
    const first = !built;
    if (first) { build(s); lastSeq = s.reveal?.seq || 0; }
    const sk = s.teams.map((t) => t.id).join();
    if (sk !== seatKey) { seatKey = sk; buildSeats(s); }
    if (S && s.phase !== S.phase && s.phase === 'betting') window.MupSound?.cue('marketOpen'); // v4 sound
    S = s;
    $('warn')?.remove();
    renderBanner(s); renderJoin(s); renderGlass(s); renderBoardScreen(s);
    if (!first && s.reveal && s.reveal.seq > lastSeq && !busy) {
      lastSeq = s.reveal.seq;
      busy = true;
      renderSeats(s, false);
      const k = s.reveal.kind;
      if (k === 'class') window.MupSound?.cue('showdown'); // v4 sound
      if (k === 'class') revealClass(s);
      else if (k === 'rj') revealRJ(s);
      else if (k === 'market') revealMarket(s);
      else if (k === 'tranche') revealTranche(s);
      else if (k === 'exit') { busy = false; renderSeats(s, true); }
      else { busy = false; revealRevalue(s); }
    } else {
      if (s.reveal && !busy) lastSeq = Math.max(lastSeq, s.reveal.seq);
      renderSeats(s, !first);
    }
    renderCommunity(s);
    renderPot(s);
    renderQPin(s);
    renderClouds(s);
    renderAwards(s, first);
    for (const f of window.TBL.screens) { try { f(s, first); } catch (e) { console.warn(e); } }
  }

  function quizLive(s) { return !!(s && s.quiz && on(s, 'quiz') && !['idle', 'done'].includes(s.quiz.state)); }
  async function loop() {
    try { await tick(); } catch (e) { console.warn(e); }
    setTimeout(loop, document.hidden ? 3600 : quizLive(S) ? 1000 : 1200);
  }

  setInterval(() => { if (S) renderGlass(S); }, 250);
  // fonts arrive after the first paint: re-measure everything that was fitted
  document.fonts?.ready?.then(() => dispatchEvent(new Event('resize')));
  let rz = 0;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (!S) return;
      document.querySelectorAll('.plate .tn').forEach((el) => fit(el, 0.83));
      document.querySelectorAll('.plate .val').forEach((el) => fit(el, 0.75));
      fitTitle($('ph'));
      renderBoardScreen(S); renderSeats(S, false);
    }, 150);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    if (e.key === 'b') { localBoard = localBoard === null ? !(S && boardOn(S)) : null; if (S) renderBoardScreen(S); }
  });
  loop();
})();
