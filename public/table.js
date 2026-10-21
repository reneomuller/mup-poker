(function () {
  const { esc, fmtM, sign, get, timeLeft, clock, poll, PHASES, glassHTML, setGlass, t: tx } = MUP;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const PLATE = [[24.5, 8.6], [75.5, 8.6], [92.4, 49], [75.5, 91.4], [24.5, 91.4], [7.6, 49]];
  const SPOT = [[30, 27.6], [70, 27.6], [78.4, 49], [70, 70.6], [30, 70.6], [21.6, 49]];
  const SUITS = ['♠', '♥', '♦', '♣', '♠'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let S = null, built = false, busy = false, lastSeq = 0, potShown = 0, localBoard = null;
  const shown = {}; // team -> displayed valuation
  const seatEls = {};

  function playUrl() { return location.origin + '/play'; }
  function qrSvg(text) {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag(4, 0); } catch { return ''; }
  }

  function build(s) {
    s.teams.forEach((t, i) => {
      const plate = document.createElement('div');
      plate.className = 'abs plate';
      plate.style.left = PLATE[i][0] + '%'; plate.style.top = PLATE[i][1] + '%';
      plate.innerHTML = `<div class="badge">PITCHUJE</div><div class="delta"></div>
        <div class="nm"><span class="dot"></span><span class="tn"></span></div>
        <div class="val">—</div><div class="sub"></div>`;
      stage.appendChild(plate);
      const spot = document.createElement('div');
      spot.className = 'abs spot';
      spot.style.left = SPOT[i][0] + '%'; spot.style.top = SPOT[i][1] + '%';
      spot.innerHTML = `<div class="stack"></div><div class="rjcards">
        <div class="pcard"><div class="back"></div><div class="face"></div></div>
        <div class="pcard"><div class="back"></div><div class="face"><span>RJ</span></div></div></div>`;
      stage.appendChild(spot);
      seatEls[t.id] = { plate, spot, i };
    });
    $('board').innerHTML = [1, 2, 3, 4, 5].map((n) => `
      <div class="pcard ${n === 2 || n === 3 ? 'red' : ''}" data-n="${n}"><div class="back"></div>
        <div class="face"><span class="r">${n}<br>${SUITS[n - 1]}</span><div><div class="s">${SUITS[n - 1]}</div><div class="c">Blok ${n}</div></div><span class="r r2">${n}<br>${SUITS[n - 1]}</span></div>
      </div>`).join('');
    $('glass').innerHTML = glassHTML() + '<div class="clock"></div><div class="tl"></div>';
    $('qr').innerHTML = qrSvg(playUrl());
    $('qrmini').innerHTML = qrSvg(playUrl());
    $('joinurl').textContent = playUrl().replace(/^https?:\/\//, '');
    renderQrLabel();
    built = true;
  }

  function renderQrLabel() {
    $('qrminil').innerHTML = `<b>${esc(tx('table.qr'))}</b><br>${esc(playUrl().replace(/^https?:\/\//, ''))}`;
  }

  function renderStack(el, cls, rj) {
    const g = Math.min(30, Math.ceil(cls / 200000)), p = Math.min(15, Math.ceil(rj / 500000));
    const chips = [...Array(g).fill('g'), ...Array(p).fill('p')];
    const per = 9, cols = Math.ceil(chips.length / per);
    let html = '';
    for (let c = 0; c < cols; c++) {
      html += `<div class="col" style="left:${c * 2.25}cqw">` +
        chips.slice(c * per, (c + 1) * per).map((k, j) => `<div class="chip ${k}" style="bottom:${j * 0.42}cqw"></div>`).join('') + '</div>';
    }
    el.innerHTML = html;
  }

  function countTo(t, to, ms = 900) {
    const el = seatEls[t].plate.querySelector('.val');
    const from = shown[t] ?? to;
    shown[t] = to;
    if (from === to || ms === 0) { el.textContent = fmtM(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmtM(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function badge(t, text, cls) {
    const d = seatEls[t].plate.querySelector('.delta');
    d.className = 'delta ' + (cls || '');
    d.textContent = text;
    requestAnimationFrame(() => d.classList.add('on'));
    clearTimeout(d._t);
    d._t = setTimeout(() => d.classList.remove('on'), 9000);
  }

  function pt(xPct, yPct) {
    const r = stage.getBoundingClientRect();
    return [xPct / 100 * r.width, yPct / 100 * r.height];
  }
  function fly(from, to, kind, n, spread = 1) {
    const r = stage.getBoundingClientRect();
    const size = r.width * 0.021;
    for (let k = 0; k < n; k++) {
      const el = document.createElement('div');
      el.className = 'fly';
      el.innerHTML = `<div class="chip ${kind}"></div>`;
      const jx = (Math.random() - 0.5) * size * 2 * spread, jy = (Math.random() - 0.5) * size * spread;
      el.style.left = from[0] - size / 2 + jx + 'px';
      el.style.top = from[1] - size / 2 + jy + 'px';
      stage.appendChild(el);
      const dx = to[0] - from[0] - jx, dy = to[1] - from[1] - jy;
      el.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 0 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - r.height * 0.08}px) scale(1.25)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
      ], { duration: 750, delay: k * 70, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' }).finished.then(() => el.remove());
    }
  }

  async function revealClass(s) {
    busy = true;
    const d = s.reveal.delta || {};
    const potPt = pt(50, 61);
    for (const t of s.teams) {
      const x = d[t.id] || 0;
      if (!x) continue;
      const e = seatEls[t.id], sp = pt(...SPOT[e.i]);
      const n = Math.max(2, Math.min(12, Math.round(Math.abs(x) / 250000)));
      if (x > 0) fly(potPt, [sp[0] - stage.clientWidth * 0.025, sp[1]], 'g', n); else fly(sp, potPt, 'k', n);
      await sleep(820);
      const nt = s.teams.find((q) => q.id === t.id);
      renderStack(e.spot.querySelector('.stack'), nt.cls, nt.rj);
      countTo(t.id, nt.V, 1100);
      badge(t.id, sign(x), x < 0 ? 'neg' : '');
      await sleep(380);
    }
    $('pile').innerHTML = ''; potShown = 0;
    busy = false;
  }

  function rjFace(x) {
    if (!x) return '<span>RJ</span><b>—</b>';
    const a = Math.abs(x), v = a >= 1e6 ? (a / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + 'M' : Math.round(a / 1e3) + 'k';
    return `<span>RJ</span><b>${x > 0 ? '+' : '−'}${v}</b><span>$</span>`;
  }

  async function revealRJ(s) {
    busy = true;
    const d = s.reveal.delta || {};
    for (const t of s.teams) {
      const x = d[t.id] || 0;
      const e = seatEls[t.id];
      const card = e.spot.querySelector('.rjcards .pcard:last-child');
      card.querySelector('.face').innerHTML = rjFace(x);
      card.classList.add('up');
      if (x) {
        await sleep(450);
        const sp = pt(...SPOT[e.i]);
        fly([sp[0] + stage.clientWidth * 0.04, sp[1]], [sp[0] - stage.clientWidth * 0.02, sp[1]], x > 0 ? 'p' : 'k', Math.max(2, Math.min(8, Math.round(Math.abs(x) / 500000))), 0.4);
        await sleep(650);
        const nt = s.teams.find((q) => q.id === t.id);
        renderStack(e.spot.querySelector('.stack'), nt.cls, nt.rj);
        countTo(t.id, nt.V, 1000);
        badge(t.id, sign(x), x < 0 ? 'neg' : 'pink');
      }
      await sleep(250);
    }
    busy = false;
  }

  function revealRevalue(s) {
    busy = false;
    const d = s.reveal.delta || {};
    for (const t of s.teams) {
      countTo(t.id, t.V, 1600);
      if (d[t.id]) badge(t.id, sign(d[t.id]), d[t.id] < 0 ? 'neg' : '');
    }
  }

  function renderBoardCards(s) {
    document.querySelectorAll('#board .pcard').forEach((c) => {
      const n = +c.dataset.n;
      const up = s.phase === 'final' || n < s.block || (n === s.block && s.phase !== 'lobby');
      c.classList.toggle('up', up);
      c.classList.toggle('cur', n === s.block && s.phase !== 'final');
    });
  }

  function renderPot(s) {
    const show = s.phase === 'betting' || s.phase === 'closed';
    $('pot').classList.toggle('hidden', !show);
    if (!show) { if (!busy) { $('pile').innerHTML = ''; potShown = 0; } return; }
    const pile = $('pile');
    if (s.betCount < potShown) { pile.innerHTML = ''; potShown = 0; }
    while (potShown < Math.min(s.betCount, 30)) {
      const i = potShown++;
      const m = document.createElement('div');
      m.className = 'mini';
      const r = ((i * 37) % 34) - 17, x = ((i * 53) % 16) - 8, y = ((i * 29) % 10) - 5;
      m.style.setProperty('--r', r + 'deg');
      m.style.marginLeft = x * 0.4 + 'cqw'; m.style.marginTop = y * 0.25 + 'cqw';
      pile.appendChild(m);
    }
    $('potlab').innerHTML = esc(tx('table.pot', { n: '\u0001', total: s.playerCount })).replace('\u0001', `<b>${s.betCount}</b>`);
  }

  function renderGlass(s) {
    const w = $('glass'), left = timeLeft(s), svg = w.querySelector('svg');
    if (left === null) { setGlass(svg, 0.66); w.querySelector('.clock').textContent = ''; w.querySelector('.tl').textContent = ''; w.classList.remove('over'); return; }
    setGlass(svg, s.timerTotal ? left / s.timerTotal : 0);
    w.querySelector('.clock').textContent = left > 0 ? clock(left) : tx('table.timeUp');
    w.querySelector('.tl').textContent = s.timerLabel || (PHASES[s.phase] || '');
    w.classList.toggle('over', left <= 0);
  }

  function renderBanner(s) {
    $('blk').textContent = s.phase === 'final' ? tx('table.final') : tx('table.block', { block: s.block, max: s.maxBlock });
    let ph = PHASES[s.phase] || '';
    if (s.phase === 'pitch' && s.presenting) ph = tx('table.pitchTitle', { team: s.teams.find((t) => t.id === s.presenting)?.name || '' });
    $('ph').textContent = ph;
  }

  function renderSeats(s, animateValues) {
    const leader = [...s.teams].sort((a, b) => b.V - a.V)[0]?.id;
    s.teams.forEach((t) => {
      const e = seatEls[t.id];
      if (!e) return;
      e.plate.querySelector('.dot').style.background = t.color;
      e.plate.querySelector('.tn').textContent = t.name;
      const inv = t.cls + t.rj;
      e.plate.querySelector('.sub').textContent = inv > 0 ? tx('table.seat.invested', { amount: fmtM(inv) }) + (t.id === leader ? ' · ' + tx('table.seat.leader') : '') : tx('table.seat.valuation');
      e.plate.querySelector('.badge').textContent = tx('table.badge');
      e.plate.classList.toggle('presenting', s.phase === 'pitch' && s.presenting === t.id);
      if (!busy) {
        countTo(t.id, t.V, animateValues ? 900 : 0);
        renderStack(e.spot.querySelector('.stack'), t.cls, t.rj);
      }
      const rjUp = s.reveal && s.reveal.kind === 'rj' && s.reveal.block === s.block;
      const card = e.spot.querySelector('.rjcards .pcard:last-child');
      if (!rjUp && !busy) card.classList.remove('up');
      if (rjUp && !busy && !card.classList.contains('up')) {
        const x = s.reveal.delta?.[t.id] || 0;
        card.querySelector('.face').innerHTML = rjFace(x);
        card.classList.add('up');
      }
    });
    const p = s.phase === 'pitch' && s.presenting ? seatEls[s.presenting] : null;
    $('light').style.background = p
      ? `radial-gradient(ellipse 30% 40% at ${(SPOT[p.i][0] - 7.5) / 85 * 100}% ${(SPOT[p.i][1] - 13) / 73 * 100}%, rgba(255,236,190,.28), transparent 70%)`
      : 'none';
  }

  function renderJoin(s) {
    const lobby = s.phase === 'lobby';
    $('join').classList.toggle('hidden', !lobby);
    const mini = !lobby && ['pitch', 'betting', 'closed'].includes(s.phase);
    $('qrmini').classList.toggle('hidden', !mini);
    $('qrminil').classList.toggle('hidden', !mini);
  }

  function renderBoardScreen(s) {
    const on = localBoard !== null ? localBoard : (s.screen === 'board' || s.phase === 'final');
    $('boardscreen').classList.toggle('on', on);
    if (!on) return;
    $('bkick').textContent = s.phase === 'final' ? tx('phase.final') : tx('table.board.kick', { block: s.block });
    const H = s.history.length ? s.history : [{ label: 'Start', V: {} }];
    const all = H.flatMap((h) => Object.values(h.V));
    const max = Math.max(1, ...all) * 1.12;
    const W = 1000, Ht = 560, padL = 70, padR = 150, padT = 20, padB = 50;
    const x = (i) => padL + (H.length === 1 ? 0 : (i / (H.length - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - v / max) * (Ht - padT - padB);
    let svg = '';
    const step = Math.pow(10, Math.floor(Math.log10(max / 4)));
    const nice = [1, 2, 5, 10].map((k) => k * step).find((k) => max / k <= 6) || step * 10;
    for (let v = 0; v <= max; v += nice) {
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(242,234,214,.09)"/>`;
      svg += `<text x="${padL - 10}" y="${y(v) + 5}" text-anchor="end" fill="rgba(242,234,214,.45)" font-size="15">${esc(fmtM(v).replace(' $', ''))}</text>`;
    }
    H.forEach((h, i) => {
      if (H.length > 8 && i % 2 && i !== H.length - 1) return;
      svg += `<text x="${x(i)}" y="${Ht - 18}" text-anchor="middle" fill="rgba(242,234,214,.5)" font-size="14">${esc(h.label)}</text>`;
    });
    const ends = [];
    for (const t of s.teams) {
      const pts = H.map((h, i) => [x(i), y(h.V[t.id] ?? 0)]);
      svg += `<polyline fill="none" stroke="${t.color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
      pts.forEach((p) => { svg += `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${t.color}"/>`; });
      const last = pts[pts.length - 1];
      ends.push({ t, y: last[1], x: last[0] });
    }
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 24) ends[i].y = ends[i - 1].y + 24;
    for (const e of ends) svg += `<text x="${e.x + 14}" y="${e.y + 6}" fill="${e.t.color}" font-size="17" font-weight="700">${esc(e.t.name)}</text>`;
    $('chart').innerHTML = svg;
    const prev = H.length > 1 ? H[H.length - 2].V : null;
    $('rank').innerHTML = [...s.teams].sort((a, b) => b.V - a.V).map((t, i) => {
      const p = prev?.[t.id];
      const ch = p ? ((t.V - p) / p) * 100 : 0;
      const chs = p && Math.abs(ch) >= 0.05 ? `<small class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %</small>` : `<small class="muted">${esc(tx('table.board.same'))}</small>`;
      return `<li><span class="pos">${i + 1}</span><span class="tn"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</span><span class="tv">${esc(fmtM(t.V))}${chs}</span></li>`;
    }).join('');
    $('inv').innerHTML = s.leaders.length
      ? s.leaders.map((l, i) => `<div class="row"><span>${i + 1}. ${esc(l.name)}</span><span>${esc(fmtM(l.value))}</span></div>`).join('')
      : `<div class="row muted">${esc(tx('table.board.noInvestors'))}</div>`;
  }

  // answers the dealer puts on the shared screen (team, question, answer; no names)
  const SLOTS = [[27, 33], [73, 33], [27, 66], [73, 66], [50, 66], [50, 23], [15, 49], [85, 49], [38, 80], [62, 80], [38, 21], [62, 21]];
  const cloudEls = new Map();
  function cloudSize(p) {
    const a = Math.abs(p.amt || 0), n = (p.a || '').length;
    if (a >= 400000 || n > 160) return 'l';
    if (a >= 150000 || n > 70) return 'm';
    return 's';
  }
  function renderClouds(s) {
    const pins = s.pins || [], box = $('clouds');
    const ids = new Set(pins.map((p) => p.id));
    for (const [id, el] of cloudEls) if (!ids.has(id)) { el.classList.add('out'); setTimeout(() => el.remove(), 400); cloudEls.delete(id); }
    pins.forEach((p, i) => {
      let el = cloudEls.get(p.id);
      const t = s.teams.find((x) => x.id === p.team) || { name: '', color: '#888' };
      if (!el) {
        el = document.createElement('div');
        el.className = 'cloud ' + cloudSize(p);
        const amt = p.amt ? `<span class="camt ${p.amt < 0 ? 'neg' : ''}">${p.amt < 0 ? '−' : '+'}${esc(fmtM(Math.abs(p.amt)))}</span>` : '';
        el.innerHTML = `<div class="ch"><span class="dot" style="background:${t.color}"></span><b>${esc(t.name)}</b>${amt}</div>
          <div class="cq">${esc(p.q)}</div><div class="ca">${esc(p.a)}</div>`;
        el.style.setProperty('--tc', t.color);
        el.style.setProperty('--r', ((((p.id.charCodeAt(0) + p.id.charCodeAt(1)) % 7) - 3) * 0.8) + 'deg');
        box.appendChild(el);
        cloudEls.set(p.id, el);
      }
      const [x, y] = SLOTS[i % SLOTS.length];
      el.style.left = x + '%'; el.style.top = y + '%';
    });
  }

  async function tick() {
    const s = await get();
    const first = !built;
    if (first) { build(s); lastSeq = s.reveal?.seq || 0; }
    S = s;
    if (s.storage === 'memory' && !/localhost|127\.0\.0\.1/.test(location.hostname) && !$('warn')) {
      const w = document.createElement('div'); w.id = 'warn'; w.className = 'warn';
      w.textContent = 'Chybí databáze: ve Vercelu připojte Upstash Redis (Storage) a nasaďte znovu.';
      stage.appendChild(w);
    }
    renderBanner(s); renderBoardCards(s); renderJoin(s); renderGlass(s); renderBoardScreen(s); renderQrLabel();
    if (!first && s.reveal && s.reveal.seq > lastSeq && !busy) {
      lastSeq = s.reveal.seq;
      busy = true;
      renderSeats(s, false);
      if (s.reveal.kind === 'class') revealClass(s);
      else if (s.reveal.kind === 'rj') revealRJ(s);
      else revealRevalue(s);
    } else {
      if (s.reveal) lastSeq = Math.max(lastSeq, s.reveal.seq);
      renderSeats(s, !first);
    }
    renderPot(s);
    renderClouds(s);
  }

  setInterval(() => { if (S) renderGlass(S); }, 250);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    if (e.key === 'b') { localBoard = localBoard === null ? !(S && (S.screen === 'board' || S.phase === 'final')) : null; if (S) renderBoardScreen(S); }
  });
  poll(tick, 1200);
})();
