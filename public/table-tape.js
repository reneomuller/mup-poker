// v4 projector polish: the live market tape (flag `tape`), the „Burza uzavřena“ banner at the showdown,
// board-row sparklines, and the pinned-notes layout that keeps clouds off the plates.
(function () {
  const T = window.TBL;
  if (!T) return;
  const { $, esc, fmtM, mult2, vnow, team, on, rem, sleep, stage } = T;
  const tx = MUP.t;
  MUP.addTexts({
    'table.tape.label': 'Burza',
    'table.tape.live': 'živě',
    'table.tape.closed': 'zavřeno',
    'table.tape.empty': 'Čekáme na první obchod…',
    'table.tape.someone': 'Investor',
    'table.close.title': 'Burza uzavřena',
    'table.close.kick': 'Blok {block} · násobky poptávky',
  });
  const pending = (s) => s.phase === 'betting' || s.phase === 'closed';
  const tapeOn = (s) => on(s, 'tape') && Array.isArray(s.tape);

  // ---------- live market tape ----------
  const bar = document.createElement('div');
  bar.className = 'tape';
  bar.id = 'tape';
  bar.setAttribute('aria-live', 'off');
  bar.innerHTML = `<div class="tp-lab"><b></b><span></span></div><div class="tp-win"><div class="tp-empty"></div></div>`;
  document.body.appendChild(bar);
  const win = bar.querySelector('.tp-win'), empty = bar.querySelector('.tp-empty');
  const items = []; // { key, el, x, w, live }
  let tapeBlock = null, primed = false, rafId = 0, lastT = 0;

  const keyOf = (r) => [r.ts, r.team, r.who, JSON.stringify(r.in), JSON.stringify(r.out)].join('|');
  const chip = (s, id) => { const t = team(s, id); return `<span class="tp-t"><i style="background:${t.color}"></i>${esc(t.name)}</span>`; };
  function rowHTML(s, r) {
    const inn = Object.entries(r.in || {}), out = Object.entries(r.out || {});
    const who = r.who ? `<span class="tp-who"><i style="background:${team(s, r.team).color}"></i>${esc(r.who)}</span>` : '';
    if (out.length) {
      const moved = inn.reduce((a, [, v]) => a + v, 0) || out.reduce((a, [, v]) => a + v, 0);
      return `${who}<span class="tp-ar">⇄</span>${out.map(([t]) => chip(s, t)).join('<span class="tp-sep">,</span>')}`
        + (inn.length ? `<span class="tp-ar">→</span>${inn.map(([t]) => chip(s, t)).join('<span class="tp-sep">,</span>')}` : '')
        + `<b class="tp-amt ${inn.length ? '' : 'down'}">${inn.length ? '' : '−'}${esc(fmtM(moved))}</b>`;
    }
    return `${who}${who ? '<span class="tp-ar">→</span>' : ''}${inn.map(([t, v]) => `${chip(s, t)}<b class="tp-amt up">+${esc(fmtM(v))}</b>`).join('<span class="tp-gap"></span>')}`;
  }
  const gap = () => rem() * 4;
  const speed = () => {
    const W = win.clientWidth, queued = items.reduce((a, it) => a + (it.x > W ? it.w + gap() : 0), 0);
    return rem() * 6.5 * Math.min(2.6, 1 + queued / Math.max(1, W) * 0.6);
  };
  function place(it) { it.el.style.transform = `translate3d(${Math.round(it.x)}px,0,0)`; }
  function addItem(s, r, x) {
    const el = document.createElement('div');
    el.className = 'tp-i';
    el.innerHTML = rowHTML(s, r);
    win.appendChild(el);
    const it = { key: keyOf(r), el, x: 0, w: el.offsetWidth, live: true };
    it.x = x;
    place(it);
    items.push(it);
    return it;
  }
  function flash(r) {
    const kinds = [...Object.keys(r.in || {}).map((t) => [t, 'up']), ...Object.keys(r.out || {}).map((t) => [t, 'dn'])];
    for (const [t, k] of kinds) {
      const p = document.querySelector(`.plate[data-seat="${CSS.escape(t)}"]`);
      if (!p) continue;
      p.classList.remove('tf-up', 'tf-dn');
      void p.offsetWidth;
      p.classList.add('tf-' + k);
      clearTimeout(p._tf); p._tf = setTimeout(() => p.classList.remove('tf-up', 'tf-dn'), 1500);
    }
  }
  function clearTape() { for (const it of items) it.el.remove(); items.length = 0; primed = false; }
  function frame(now) {
    rafId = 0;
    if (!bar.classList.contains('on')) return;
    const dt = Math.min(0.1, (now - (lastT || now)) / 1000);
    lastT = now;
    const W = win.clientWidth, v = speed();
    for (const it of items) { it.x -= v * dt; }
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.x + it.w >= 0) continue;
      if (!it.live) { it.el.remove(); items.splice(i, 1); continue; }
      it.el.classList.remove('fresh');
      const end = Math.max(0, ...items.map((o) => o.x + o.w));
      it.x = Math.max(W, end + gap());
    }
    for (const it of items) place(it);
    rafId = requestAnimationFrame(frame);
  }
  function renderTape(s) {
    const blocked = ['boardscreen'].some((id) => $(id)?.classList.contains('on'))
      || ['quiz', 'qzpodium', 'exit', 'award'].some((id) => $(id) && !$(id).classList.contains('hidden')); // qzpodium: the quiz+ finale
    const show = tapeOn(s) && pending(s) && !blocked;
    T.toggle(bar, 'on', show);
    T.toggle(document.body, 'tapeon', show);
    if (s.block !== tapeBlock) { tapeBlock = s.block; clearTape(); }
    if (!show) { if (!pending(s)) clearTape(); return; }
    T.setText(bar.querySelector('.tp-lab b'), tx('table.tape.label'));
    T.setText(bar.querySelector('.tp-lab span'), tx(s.phase === 'closed' ? 'table.tape.closed' : 'table.tape.live'));
    T.toggle(bar, 'closed', s.phase === 'closed');
    const rows = s.tape || [];
    const keys = new Set(rows.map(keyOf));
    for (const it of items) it.live = keys.has(it.key);
    const have = new Set(items.map((it) => it.key));
    const fresh = rows.filter((r) => !have.has(keyOf(r))).reverse(); // oldest first, so the newest ends up last
    const W = win.clientWidth;
    if (!primed) {
      // first sight: lay the current tape out from the left edge, no flashes
      let x = rem() * 1.5;
      for (const r of fresh) { const it = addItem(s, r, x); x += it.w + gap(); }
      primed = true;
    } else {
      for (const r of fresh) {
        const visEnd = Math.max(0, ...items.filter((o) => o.x < W).map((o) => o.x + o.w + gap()));
        const at = Math.max(W, visEnd);
        const it = addItem(s, r, at);
        it.el.classList.add('fresh');
        // queued items sit exactly at `at` up to float drift from the frame loop: compare with a tolerance
        for (const o of items) if (o !== it && o.x >= at - 2) { o.x += it.w + gap(); place(o); }
        flash(r);
      }
    }
    T.setText(empty, tx('table.tape.empty'));
    T.toggle(empty, 'hidden', items.length > 0);
    if (!rafId) { lastT = 0; rafId = requestAnimationFrame(frame); }
  }
  addEventListener('resize', () => { for (const it of items) it.w = it.el.offsetWidth; });

  // ---------- „Burza uzavřena“: the block's multiples, ranked, for ~4 s at the showdown ----------
  const closeEl = document.createElement('div');
  closeEl.className = 'mclose hidden';
  closeEl.id = 'mclose';
  stage.appendChild(closeEl);
  T.marketClose = async (s, blk) => {
    if (!on(s, 'tape') || !on(s, 'demand') || !T.blockMult) return;
    const list = (s.teams || []).map((t) => ({ t, m: T.blockMult(s, t.id, blk) })).filter((x) => x.m != null);
    if (!list.length || list.every((x) => Math.abs(x.m - 1) <= 0.004)) return;
    list.sort((a, b) => b.m - a.m);
    closeEl.innerHTML = `<div class="mc-band"><div class="mc-kick">${esc(tx('table.close.kick', { block: blk }))}</div>
      <div class="mc-title">${esc(tx('table.close.title'))}</div>
      <ol class="mc-row" data-n="${list.length}">${list.map(({ t, m }, i) => `<li class="mc-t ${m > 1.004 ? 'up' : m < 0.996 ? 'down' : ''}" style="--tc:${t.color};--d:${0.35 + i * 0.12}s">
        <span class="mc-pos">${i + 1}.</span><span class="mc-n">${esc(t.name)}</span><b class="mc-m">${esc(mult2(m))}</b></li>`).join('')}</ol></div>`;
    closeEl.classList.remove('hidden', 'out');
    // one long word (CamelCase names) never breaks mid-word: it shrinks a little instead
    closeEl.querySelectorAll('.mc-n').forEach((n) => {
      const base = parseFloat(getComputedStyle(n).fontSize), floor = Math.max(innerHeight * 0.018, base * 0.7);
      for (let f = base; n.scrollWidth > n.clientWidth + 1 && f > floor; f -= base * 0.04) n.style.fontSize = Math.max(floor, f - base * 0.04) + 'px';
    });
    await sleep(4200);
    closeEl.classList.add('out');
    await sleep(500);
    closeEl.classList.add('hidden');
  };

  // ---------- sparklines on the board's rank rows ----------
  T.spark = (s, t) => {
    if (!on(s, 'tape')) return '';
    const H = (s.history || []).map((h) => Number(h.V?.[t.id]) || 0);
    const v = vnow(t);
    if (pending(s) && Math.abs(v - (Number(t.V) || 0)) >= 1) H.push(v);
    else if (!H.length || Math.abs(H[H.length - 1] - v) >= 1) H.push(v);
    if (H.length < 2) return '';
    const W = 100, Ht = 34, p = 4;
    const lo = Math.min(...H), hi = Math.max(...H), span = hi - lo || 1;
    const pts = H.map((y, i) => [p + (i / (H.length - 1)) * (W - 2 * p), Ht - p - ((y - lo) / span) * (Ht - 2 * p)]);
    const d = pts.map((q) => q.map((n) => n.toFixed(1)).join(',')).join(' ');
    const [lx, ly] = pts[pts.length - 1];
    const up = H[H.length - 1] >= H[H.length - 2];
    return `<svg class="spk ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${Ht}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="${p},${Ht - p} ${d} ${(W - p).toFixed(1)},${Ht - p}" fill="${t.color}" fill-opacity=".16"/>
      <polyline points="${d}" fill="none" stroke="${t.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" class="spk-end" vector-effect="non-scaling-stroke"/></svg>`;
  };

  // ---------- pinned notes: keep the clouds off the plates (and off each other) ----------
  const rectIn = (el, sr, pad) => {
    const r = el.getBoundingClientRect();
    return r.width ? { l: r.left - sr.left - pad, t: r.top - sr.top - pad, r: r.right - sr.left + pad, b: r.bottom - sr.top + pad } : null;
  };
  const over = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  let cloudKey = '';
  T.placeClouds = (els, slots) => {
    const box = $('clouds');
    const sr = stage.getBoundingClientRect(), W = sr.width, Hh = sr.height, u = rem();
    const key = [els.map((e) => e._pid).join(), W, Hh].join('|');
    if (key === cloudKey) return;
    cloudKey = key;
    const hard = [], soft = [];
    document.querySelectorAll('.plate').forEach((p) => { const r = rectIn(p, sr, u * 0.8); if (r) hard.push(r); });
    for (const id of ['banner', 'glass', 'qrmini']) { const el = $(id); if (el && !el.classList.contains('hidden')) { const r = rectIn(el, sr, u * 0.5); if (r) hard.push(r); } }
    for (const sel of ['#board', '#pot:not(.hidden)', '.spot']) document.querySelectorAll(sel).forEach((el) => { const r = rectIn(el, sr, 0); if (r) soft.push(r); });
    const m = u * 0.6, step = u;
    // greedy placement: 'slots' keeps each cloud near its classic slot, 'pack' fills first-fit from the top left, largest first
    const run = (cs, how) => {
      box.style.setProperty('--cs', cs);
      const dims = els.map((el, i) => ({ el, i, w: el.offsetWidth + u * 0.8, h: el.offsetHeight + u * 1.6 })); // a little air + the speech tail
      const order = how === 'pack' ? [...dims].sort((a, b) => b.w * b.h - a.w * a.h) : dims;
      const placed = [];
      let bad = 0, total = 0;
      for (const { el, i, w, h } of order) {
        const [px, py] = slots[i % slots.length];
        const prefX = (px / 100) * W, prefY = (py / 100) * Hh;
        let best = null;
        for (let cy = m + h / 2; cy <= Hh - m - h / 2; cy += step) {
          for (let cx = m + w / 2; cx <= W - m - w / 2; cx += step) {
            const r = { l: cx - w / 2, t: cy - h / 2, r: cx + w / 2, b: cy + h / 2 };
            let ov = 0, cost = 0;
            for (const o of hard) ov += over(r, o) * 60;
            for (const o of placed) ov += over(r, o) * 25;
            cost = ov;
            for (const o of soft) cost += over(r, o) * 1.5;
            cost += how === 'pack' ? (cy + cx * 0.3) * u * 0.05 : Math.hypot(cx - prefX, cy - prefY) * u * 0.6;
            if (!best || cost < best.cost) best = { cost, ov, cx, cy, r };
          }
        }
        if (!best) best = { cx: prefX, cy: prefY, ov: 1e9, r: { l: prefX, t: prefY, r: prefX, b: prefY } };
        placed.push(best.r);
        if (best.ov > u * u * 30) bad++;
        total += best.ov;
        el._pos = [(best.cx / W) * 100, ((best.cy - u * 0.4) / Hh) * 100];
      }
      return { cs, bad, total, pos: els.map((el) => el._pos) };
    };
    let pick = null;
    outer: for (const cs of [1, 0.92, 0.84, 0.76, 0.68, 0.6]) {
      for (const how of ['slots', 'pack']) {
        const r = run(cs, how);
        if (!pick || r.total < pick.total) pick = r;
        if (!r.bad) { pick = r; break outer; }
      }
    }
    box.style.setProperty('--cs', pick.cs);
    els.forEach((el, i) => { el.style.left = pick.pos[i][0].toFixed(2) + '%'; el.style.top = pick.pos[i][1].toFixed(2) + '%'; });
  };
  addEventListener('resize', () => { cloudKey = ''; });

  T.screens.push((s) => renderTape(s));
})();
