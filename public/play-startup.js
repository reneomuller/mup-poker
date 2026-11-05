// v4 startup lane: the startup detail sheet on the phone's Startupy tab (feature `startupPage`).
// Tapping a startup card opens a stock-page-like sheet for „due diligence“ before investing: live valuation,
// a valuation chart per block, key numbers, the team's card, what moved the valuation, and why classmates
// invested (GET ?view=startup&team=<id>, settled blocks only). On a laptop (≥ 1024 px) it is a right-side panel.
// play.js hands over its state and helpers with PlayStartup.init(ctx) and calls PlayStartup.render() after each render.
(function () {
  const { esc, fmt, fmtM } = MUP;
  const NB = ' ';
  const num = (n, d = 0) => (Number(n) || 0).toLocaleString('cs-CZ', { maximumFractionDigits: d, minimumFractionDigits: 0 }).replace(/\s/g, NB);
  const numF = (n, d) => (Number(n) || 0).toLocaleString('cs-CZ', { maximumFractionDigits: d, minimumFractionDigits: d }).replace(/\s/g, NB);
  const pct = (n, d = 1) => num(n, d) + NB + '%';
  const spct = (n, d = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + pct(Math.abs(n), d);
  const smoney = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtM(Math.abs(n));
  const xmult = (m) => '×' + numF(m, 2);
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  const investorWord = (n) => (n === 1 ? 'investor' : n >= 2 && n <= 4 ? 'investoři' : 'investorů');
  const DRIVER = { class: 'Peníze třídy', rj: 'RainbowJet', revalue: 'Přecenění', round: 'Kolo', market: 'Trh', exit: 'Exit', demand: 'Poptávka' };
  const WIDE = window.matchMedia('(min-width: 1024px)');
  const reduced = () => !!(window.PK && PK.reduced && PK.reduced());
  const tap = () => { try { PK.haptic.tap(); } catch {} };

  let X = null; // play.js context
  let openId = null, data = null, dataFor = null, dataKey = null, loadErr = false, reqSeq = 0;
  let lastFocus = null, tip = null, moreOpen = new Set(), wrap = null, sheet = null, body = null;

  const st = () => (X ? X.state() : {});
  const on = () => { const { S } = st(); return !!(S && S.features && S.features.startupPage !== false); };
  const teamOf = (id) => (st().S?.teams || []).find((t) => t.id === id) || null;
  const Vn = (t) => (t && (t.Vnow ?? t.V)) || 0;
  const pendingLive = () => { const { S } = st(); return !!S && (S.phase === 'betting' || S.phase === 'closed') && S.teams.some((t) => t.Vnow != null && t.Vnow !== t.V); };
  const dot = (c) => `<span class="s-dot" style="background:${esc(c)}"></span>`;

  // ---------- DOM ----------
  function build() {
    wrap = document.createElement('div');
    wrap.className = 'sd-wrap';
    wrap.id = 'sdwrap';
    wrap.hidden = true;
    wrap.innerHTML = `<div class="sd-scrim" data-sd="close" aria-hidden="true"></div>
      <section class="sd" id="sdsheet" role="dialog" aria-modal="true" aria-labelledby="sdtitle" tabindex="-1">
        <div class="sd-grab" aria-hidden="true"><i></i></div>
        <div class="sd-body" id="sdbody"></div>
      </section>`;
    (document.getElementById('game') || document.body).appendChild(wrap);
    sheet = wrap.querySelector('.sd');
    body = wrap.querySelector('.sd-body');
    wrap.addEventListener('click', onClick);
    wrap.addEventListener('keydown', onKey);
    swipe();
    WIDE.addEventListener?.('change', () => { if (openId) layout(); });
  }

  function layout() {
    const wide = WIDE.matches;
    sheet.setAttribute('aria-modal', wide ? 'false' : 'true');
    document.body.classList.toggle('sd-open', !!openId);
    document.body.classList.toggle('sd-lock', !!openId && !wide);
  }

  // ---------- open / close ----------
  function open(id) {
    if (!on() || !teamOf(id)) return;
    const was = openId;
    openId = id;
    tip = null;
    if (was !== id) { data = null; dataFor = null; dataKey = null; loadErr = false; moreOpen = new Set(); }
    if (!was) lastFocus = document.activeElement;
    wrap.hidden = false;
    layout();
    paint();
    requestAnimationFrame(() => {
      wrap.classList.add('in');
      if (was !== id) body.scrollTop = 0;
      sheet.focus({ preventScroll: true });
    });
    fetchData(true);
  }
  function close(restore = true) {
    if (!openId) return;
    const id = openId;
    openId = null; tip = null;
    wrap.classList.remove('in');
    sheet.style.transform = '';
    layout();
    markCards();
    const done = () => { if (!openId) { wrap.hidden = true; body.innerHTML = ''; } };
    if (reduced() || WIDE.matches) done(); else setTimeout(done, 220);
    if (restore) {
      const card = document.querySelector(`#startups .p-su[data-key="su${CSS.escape(id)}"]`);
      const f = lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : card;
      try { f && f.focus({ preventScroll: true }); } catch {}
    }
    lastFocus = null;
  }

  // ---------- server view: settled investors with reasons, the viewer's position ----------
  async function fetchData(force) {
    const { S } = st();
    if (!openId || !S) return;
    const key = [openId, S.block, S.phase, S.rev, S.betCount, S.now ? Math.floor(S.now / 15000) : 0].join('|');
    if (!force && key === dataKey) return;
    dataKey = key;
    const id = openId, seq = ++reqSeq;
    let r = null;
    try { r = await X.get('?view=startup&team=' + encodeURIComponent(id)); } catch { r = null; }
    if (seq !== reqSeq || openId !== id) return;
    if (r && r.ok) { data = r; dataFor = id; loadErr = false; } else { loadErr = !(data && dataFor === id); }
    paint();
  }

  // ---------- chart ----------
  function points(t) {
    const { S } = st();
    const pts = (S.history || []).map((h) => ({ label: h.label, block: h.block, V: h.V?.[t.id] })).filter((p) => p.V != null && p.V > 0);
    const now = Vn(t), last = pts[pts.length - 1];
    if (!last || Math.abs(last.V - now) > 0.5) pts.push({ label: 'Teď', block: S.block, V: now, live: pendingLive() });
    else if (pendingLive()) last.live = true;
    return pts;
  }
  function chartHTML(t) {
    const pts = points(t);
    if (!pts.length) return '';
    const W = 340, H = 150, pl = 58, pr = 12, pt = 14, pb = 10;
    const vals = pts.map((p) => p.V);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < Math.max(1, hi * 0.04)) { const m = (hi + lo) / 2, d = Math.max(1, hi * 0.04); lo = m - d; hi = m + d; }
    const span = hi - lo; lo -= span * 0.12; hi += span * 0.12; if (lo < 0) lo = 0;
    const n = pts.length;
    const x = (i) => (n === 1 ? (pl + W - pr) / 2 : pl + (i * (W - pl - pr)) / (n - 1));
    const y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    const up = vals[n - 1] >= vals[0];
    const col = up ? 'var(--s-green)' : 'var(--s-red)';
    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.V).toFixed(1)}`).join(' ');
    const grid = [hi - (hi - lo) * 0.12, (hi + lo) / 2, lo + (hi - lo) * 0.12];
    const area = n > 1 ? `<polygon class="sd-area" points="${x(0).toFixed(1)},${H - pb} ${line} ${x(n - 1).toFixed(1)},${H - pb}" fill="url(#sdg)"/>` : '';
    const svg = `<svg class="sd-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Graf ocenění ${esc(t.name)}: od ${esc(fmtM(vals[0]))} do ${esc(fmtM(vals[n - 1]))}" focusable="false">
      <defs><linearGradient id="sdg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${up ? '#3FCF8E' : '#FF5C6C'}" stop-opacity=".30"/><stop offset="1" stop-color="${up ? '#3FCF8E' : '#FF5C6C'}" stop-opacity="0"/></linearGradient></defs>
      ${grid.map((g) => `<line class="sd-gl" x1="${pl}" x2="${W - pr}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}"/>`).join('')}
      ${area}
      ${n > 1 ? `<polyline points="${line}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      ${pts.map((p, i) => `<circle class="sd-pt ${p.live ? 'live' : ''} ${tip === i ? 'on' : ''}" cx="${x(i).toFixed(1)}" cy="${y(p.V).toFixed(1)}" r="${tip === i ? 5.5 : 4}" stroke="${col}"/>`).join('')}
    </svg>`;
    const yl = grid.map((g) => `<span style="top:${((y(g) / H) * 100).toFixed(2)}%">${esc(fmtM(g))}</span>`).join('');
    // one button per point (tap / keyboard): opens the tooltip
    const hits = pts.map((p, i) => {
      const prev = i ? pts[i - 1].V : null;
      const ch = prev ? (p.V / prev - 1) * 100 : null;
      const lab = `${p.label}${p.live ? ' (živě)' : ''}: ${fmtM(p.V)}${ch != null ? `, ${spct(ch)} proti předchozímu bodu` : ''}`;
      return `<button type="button" class="sd-hit ${tip === i ? 'on' : ''}" data-sd="tip" data-i="${i}" style="left:${((x(i) / W) * 100).toFixed(2)}%;top:${((y(p.V) / H) * 100).toFixed(2)}%" aria-label="${esc(lab)}" aria-pressed="${tip === i}"></button>`;
    }).join('');
    let tipH = '';
    if (tip != null && pts[tip]) {
      const p = pts[tip], prev = tip ? pts[tip - 1].V : null, ch = prev ? (p.V / prev - 1) * 100 : null;
      const lx = (x(tip) / W) * 100, ly = (y(p.V) / H) * 100;
      tipH = `<div class="sd-tip ${lx > 62 ? 'r' : lx < 38 ? 'l' : ''} ${ly < 40 ? 'below' : ''}" style="left:${lx.toFixed(2)}%;top:${ly.toFixed(2)}%" role="status">
        <span class="s-label">${esc(p.label)}${p.live ? ' · živě' : ''}</span><b class="s-num">${esc(fmtM(p.V))}</b>${ch != null && Math.abs(ch) >= 0.05 ? `<span class="${ch > 0 ? 's-up' : 's-down'}">${ch > 0 ? '▲' : '▼'}${NB}${esc(pct(Math.abs(ch)))}</span>` : ''}</div>`;
    }
    const table = `<table class="sd-vh"><caption>Ocenění ${esc(t.name)} po blocích</caption><thead><tr><th scope="col">Bod</th><th scope="col">Ocenění</th></tr></thead>
      <tbody>${pts.map((p) => `<tr><th scope="row">${esc(p.label)}${p.live ? ' (živě)' : ''}</th><td>${esc(fmt(p.V))}</td></tr>`).join('')}</tbody></table>`;
    const xl = n > 1 ? `<div class="sd-xl"><span>${esc(pts[0].label)}</span>${n > 2 ? `<span>${esc(pts[Math.floor((n - 1) / 2)].label)}</span>` : ''}<span>${esc(pts[n - 1].label)}</span></div>` : '';
    return `<div class="sd-chart" data-key="chart"><div class="sd-plot">${svg}<div class="sd-yl" aria-hidden="true">${yl}</div>${hits}${tipH}</div>${xl}${table}</div>`;
  }

  // ---------- content ----------
  function sheetHTML(t) {
    const { S, me } = st();
    const live = pendingLive();
    const d = data && dataFor === t.id ? data : null;
    const mine = t.id === me.team;
    const chgP = t.chg != null ? t.chg * 100 : null;
    const rank = t.rank ?? S.teams.slice().sort((a, b) => Vn(b) - Vn(a)).findIndex((x) => x.id === t.id) + 1;
    const founders = t.cap?.founders ?? d?.founders;
    const showDemand = live && t.mult != null && S.features?.demand !== false;
    const cards = S.features?.cards ? S.cards || {} : null;
    const c = cards?.[t.id] || {};
    const defs = (S.milestoneDefs || []).filter((x) => !x.block || x.block <= S.block);
    const stake = (me.stakesNow || me.stakes || {})[t.id] || 0;
    const P = d ? d.Pnow : founders > 0 ? Vn(t) / (1e6 / (founders / 100)) : null;
    const invN = d?.investorsNow ?? t.cap?.investors;
    const blockMoney = live ? t.live || 0 : null;
    const lastSettled = d?.blocks?.[0];
    const canInvest = S.phase === 'betting' && !mine && !X.readOnly();

    let h = `<header class="sd-h" style="--tc:${esc(t.color)}">
      <button type="button" class="sd-x" data-sd="close" aria-label="Zavřít detail"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
      <span class="p-su-ic sd-ic">${esc(initials(t.name))}</span>
      <div class="sd-hn"><h2 class="sd-t" id="sdtitle">${esc(t.name)}</h2><div class="sd-hs">${mine ? '<span class="s-badge">Tvůj tým</span>' : ''}${rank ? `<span class="sd-rank">#${esc(rank)}${NB}z${NB}${esc(S.teams.length)}</span>` : ''}${founders != null ? `<span>Zakladatelé ${esc(pct(founders))}</span>` : ''}</div></div>
    </header>
    <div class="sd-price">
      <div class="sd-big">${X.tw('sdV' + t.id, Vn(t))}</div>
      <div class="sd-chg">${chgP != null && Math.abs(chgP) >= 0.05 ? `<span class="sd-ch ${chgP > 0 ? 's-up' : 's-down'}">${chgP > 0 ? '▲' : '▼'}${NB}${esc(pct(Math.abs(chgP), Math.abs(chgP) < 10 ? 1 : 0))}</span>` : '<span class="sd-ch s-faint">±0 %</span>'}<span class="s-faint">${live ? 'v tomto bloku' : 'od začátku bloku'}</span>
        ${showDemand ? `<span class="p-mx sd-dm ${t.mult > 1 ? 's-up' : t.mult < 1 ? 's-down' : ''}" title="Poptávka v tomto bloku">Poptávka ${esc(xmult(t.mult))}</span>` : ''}</div>
      ${live ? '<div class="sd-live"><span class="p-lv"><i></i>živě</span><span>ocenění po tomto bloku, jak to teď vypadá</span></div>' : ''}
    </div>`;
    h += chartHTML(t);
    h += `<div class="sd-kn" role="list" aria-label="Klíčová čísla">
      <div class="sd-k" role="listitem"><span class="s-label">Cena akcie</span><b class="s-num">${P != null && P > 0 ? esc(numF(P, 2)) + NB + '$' : '–'}</b></div>
      <div class="sd-k" role="listitem"><span class="s-label">Investoři</span><b class="s-num">${invN != null ? esc(num(invN)) : '–'}</b></div>
      <div class="sd-k" role="listitem"><span class="s-label">${live ? `Blok ${esc(S.block)} živě` : lastSettled ? `Blok ${esc(lastSettled.block)}` : 'Tento blok'}</span><b class="s-num ${(live ? blockMoney : lastSettled ? lastSettled.totalIn - lastSettled.totalOut : 0) > 0 ? 's-up' : (live ? blockMoney : lastSettled ? lastSettled.totalIn - lastSettled.totalOut : 0) < 0 ? 's-down' : ''}">${live ? esc(smoney(blockMoney)) : lastSettled ? esc(smoney(lastSettled.totalIn - lastSettled.totalOut)) : '–'}</b></div>
      <div class="sd-k" role="listitem"><span class="s-label">${mine ? 'Tvůj tým' : 'Tvůj podíl'}</span>${mine ? `<b class="s-num">${founders != null ? esc(pct(founders)) : '–'}</b><small>zakladatelé</small>` : stake > 0 ? `<b>${X.tw('sdS' + t.id, stake)}</b>${d?.mine?.returnPct != null ? `<small class="${d.mine.returnPct >= 0 ? 's-up' : 's-down'}">${esc(spct(d.mine.returnPct))} výnos</small>` : ''}` : '<b class="s-num">–</b><small>zatím nic</small>'}</div>
    </div>`;
    if (canInvest) {
      h += `<div class="sd-act sd-act-top"><button type="button" class="s-btn s-primary sd-go" data-sd="invest">Investovat sem</button></div>`;
    }
    if (cards) {
      const ms = defs.map((m) => `<li class="p-ms ${c.milestones?.[m.key] ? 'done' : ''}">${c.milestones?.[m.key] ? '✓' : '○'} ${esc(m.label)}<span class="sd-vh">${c.milestones?.[m.key] ? ' (splněno)' : ' (zatím ne)'}</span></li>`).join('');
      h += `<section class="sd-sec" aria-labelledby="sdcard"><h3 class="s-h3" id="sdcard">Karta startupu</h3>
        ${c.oneLiner ? `<p class="sd-one">${esc(c.oneLiner)}</p>` : '<p class="sd-one s-faint">Tým zatím nenapsal one-liner.</p>'}
        ${c.sub ? `<p class="sd-sub">${esc(c.sub)}</p>` : ''}
        ${ms ? `<div class="s-label sd-msl">Milníky</div><ul class="p-mss sd-mss">${ms}</ul>` : ''}</section>`;
    }
    const dr = S.features?.drivers ? (S.drivers?.[t.id] || []) : [];
    if (S.features?.drivers) {
      h += `<section class="sd-sec" aria-labelledby="sddr"><h3 class="s-h3" id="sddr">Co hýbalo oceněním</h3>
        ${dr.length ? `<ul class="sd-drs">${dr.map((x, i) => `<li class="sd-dr" data-key="dr${x.ts}${i}"><span class="sd-dr-k">${esc(DRIVER[x.kind] || x.kind)}${x.block ? `<small>Blok ${esc(x.block)}</small>` : ''}</span><span class="sd-dr-n">${esc(driverNote(x))}</span><b class="s-num ${x.delta > 0 ? 's-up' : x.delta < 0 ? 's-down' : ''}">${esc(smoney(x.delta))}</b></li>`).join('')}</ul>` : '<p class="p-hint">Zatím se ocenění nehnulo.</p>'}</section>`;
    }
    h += whyHTML(t, d);
    h += `<div class="sd-act">${canInvest ? '<button type="button" class="s-btn s-primary sd-go" data-sd="invest">Investovat sem</button>' : ''}<button type="button" class="s-btn s-ghost" data-sd="close">Zpět</button></div>`;
    return h;
  }

  function driverNote(x) {
    if (x.kind === 'demand') { const m = /×\s?([\d,.]+)/.exec(x.note || ''); return m ? `Poptávka ×${m[1]}` : x.note || 'Poptávka'; }
    return x.note || '';
  }

  function whyHTML(t, d) {
    const { S } = st();
    let h = `<section class="sd-sec sd-why" aria-labelledby="sdwhy"><div class="sd-sec-h"><h3 class="s-h3" id="sdwhy">Proč investovali</h3>${d ? `<span class="s-label">${esc(num(d.investorsNow || 0))} ${investorWord(d.investorsNow || 0)} teď</span>` : ''}</div>`;
    if (!d) return h + (loadErr ? '<p class="p-hint">Investory se nepodařilo načíst. Zkusím to znovu.</p>' : '<div class="sd-skel" aria-label="Načítám"><i></i><i></i><i></i></div>') + '</section>';
    if (d.current) {
      const cu = d.current;
      h += `<div class="sd-cur"><span class="p-lv"><i></i>Blok ${esc(cu.block)} běží</span><span>${cu.count ? `${esc(num(cu.count))} ${investorWord(cu.count)} · ${cu.totalIn ? `<b class="s-up">+${esc(fmtM(cu.totalIn))}</b>` : ''}${cu.totalOut ? ` <b class="s-down">−${esc(fmtM(cu.totalOut))}</b>` : ''}` : 'Zatím sem nikdo neposlal peníze.'}</span><small>Jména a důvody uvidíš po showdownu.</small></div>`;
    }
    const bl = d.blocks || [];
    if (!bl.length) return h + (d.current ? '' : '<p class="p-hint">Zatím tu nikdo neinvestoval. Po prvním showdownu tu uvidíš, kdo a proč.</p>') + '</section>';
    bl.forEach((b, bi) => {
      const inv = b.investors || [];
      const withWhy = inv.filter((v) => v.whyIn || v.whyOut);
      const rest = inv.filter((v) => !v.whyIn && !v.whyOut);
      const list = withWhy.concat(rest);
      const k = 'b' + b.block, all = moreOpen.has(k), LIM = bi === 0 ? 6 : 3;
      const shown = all ? list : list.slice(0, LIM);
      h += `<div class="sd-bl" data-key="bl${esc(b.block)}"><div class="sd-bl-h"><b>Blok ${esc(b.block)}</b><span class="s-num">${b.totalIn ? `<span class="s-up">+${esc(fmtM(b.totalIn))}</span>` : ''}${b.totalOut ? ` <span class="s-down">−${esc(fmtM(b.totalOut))}</span>` : ''}${b.mult != null && b.mult !== 1 ? ` <span class="p-mx ${b.mult > 1 ? 's-up' : 's-down'}">${esc(xmult(b.mult))}</span>` : ''}</span></div>
        ${list.length ? `<ul class="sd-ivs">${shown.map((v) => ivHTML(v, b.block)).join('')}</ul>${list.length > LIM ? `<button type="button" class="sd-more" data-sd="more" data-k="${esc(k)}" aria-expanded="${all}">${all ? 'Méně' : `Všichni investoři (${esc(list.length)})`}</button>` : ''}` : '<p class="p-hint">V tomhle bloku sem nikdo neinvestoval.</p>'}</div>`;
    });
    return h + '</section>';
  }
  function ivHTML(v, block) {
    const rj = v.id === 'rj';
    const tm = rj ? null : teamOf(v.team);
    const q = (label, text) => (text ? `<p class="sd-q">${label ? `<span class="s-label">${esc(label)}</span> ` : ''}„${esc(text)}“</p>` : '');
    return `<li class="sd-iv" data-key="iv${esc(block)}:${esc(v.id)}"><div class="sd-iv-h"><span class="p-iv-ava" style="--tc:${esc(rj ? '#6754DF' : tm?.color || '#7E86A8')}">${esc(initials(v.name))}</span>
      <div class="sd-iv-n"><b>${esc(v.name)}</b>${rj ? '<span class="s-badge">Smart money</span>' : tm ? `<span class="p-tt">${dot(tm.color)}${esc(tm.name)}</span>` : ''}</div>
      <span class="s-num sd-iv-a">${v.in ? `<span class="s-up">+${esc(fmtM(v.in))}</span>` : ''}${v.out ? ` <span class="s-down">−${esc(fmtM(v.out))}</span>` : ''}</span></div>
      ${q(v.whyIn && v.whyOut ? 'Nákup' : '', v.whyIn)}${q('Prodej', v.whyOut)}${!v.whyIn && !v.whyOut ? '<p class="sd-q s-faint">Bez zdůvodnění.</p>' : ''}</li>`;
  }

  function paint() {
    if (!openId) return;
    const t = teamOf(openId);
    if (!t) { close(false); return; }
    sheet.style.setProperty('--tc', t.color);
    PK.morph(body, sheetHTML(t));
    X.runTweens();
  }

  // the Startupy cards: tappable, keyboard-reachable, the selected one marked
  function markCards() {
    const cards = document.querySelectorAll('#startups .p-su');
    const enabled = on();
    cards.forEach((el) => {
      const id = (el.getAttribute('data-key') || '').slice(2);
      if (!enabled) return;
      if (el.getAttribute('tabindex') !== '0') { el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); el.setAttribute('aria-haspopup', 'dialog'); }
      const t = teamOf(id);
      const lab = `Detail startupu ${t ? t.name : id}`;
      if (el.getAttribute('aria-label') !== lab) el.setAttribute('aria-label', lab);
      el.classList.add('sd-card');
      el.classList.toggle('sd-sel', id === openId);
      el.setAttribute('aria-expanded', id === openId ? 'true' : 'false');
    });
  }

  // ---------- events ----------
  function onClick(e) {
    const a = e.target.closest('[data-sd]');
    if (!a) { if (tip != null && !e.target.closest('.sd-plot')) { tip = null; paint(); } return; }
    const k = a.dataset.sd;
    if (k === 'close') { tap(); close(); }
    else if (k === 'tip') { const i = +a.dataset.i; tip = tip === i ? null : i; tap(); paint(); const b = body.querySelector(`.sd-hit[data-i="${i}"]`); if (b) b.focus({ preventScroll: true }); }
    else if (k === 'more') { const key = a.dataset.k; if (moreOpen.has(key)) moreOpen.delete(key); else moreOpen.add(key); tap(); paint(); }
    else if (k === 'invest') invest();
  }
  function invest() {
    const id = openId;
    const { S } = st();
    if (!id || S.phase !== 'betting') return;
    tap();
    close(false);
    X.go('invest');
    const row = document.querySelector(`#main .arow[data-k="in"][data-t="${CSS.escape(id)}"]`);
    const inp = row && row.querySelector('.amt');
    if (inp) {
      row.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
      inp.focus({ preventScroll: true });
      row.classList.add('sd-flash'); setTimeout(() => row.classList.remove('sd-flash'), 1400);
    }
  }
  function focusables() {
    return Array.from(sheet.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null || el === document.activeElement);
  }
  function onKey(e) {
    if (!openId) return;
    if (e.key === 'Escape') {
      if (tip != null) { tip = null; paint(); } else close();
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (e.key === 'Tab' && !WIDE.matches) {
      const f = focusables();
      if (!f.length) { e.preventDefault(); sheet.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.classList?.contains('sd-hit')) {
      const hits = Array.from(body.querySelectorAll('.sd-hit'));
      const i = Math.max(0, Math.min(hits.length - 1, +e.target.dataset.i + (e.key === 'ArrowRight' ? 1 : -1)));
      tip = i; paint(); const b = body.querySelector(`.sd-hit[data-i="${i}"]`); if (b) b.focus({ preventScroll: true });
      e.preventDefault();
    }
  }
  // Esc on a laptop also works when focus is outside the panel (e.g. on a card)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openId && !wrap.contains(e.target) && !e.defaultPrevented) close(); });

  // swipe down on the phone sheet closes it (only when its content is scrolled to the top)
  function swipe() {
    let y0 = null, dy = 0, t0 = 0;
    sheet.addEventListener('touchstart', (e) => {
      if (WIDE.matches || e.touches.length !== 1) return;
      const onGrab = !!e.target.closest('.sd-grab, .sd-h');
      if (!onGrab && body.scrollTop > 0) return;
      y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (dy > 0 && body.scrollTop <= 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; if (e.cancelable) e.preventDefault(); }
      else if (dy < 0) { y0 = null; sheet.style.transform = ''; }
    }, { passive: false });
    const end = () => {
      if (y0 == null) return;
      sheet.style.transition = '';
      const fast = dy > 40 && Date.now() - t0 < 250;
      y0 = null;
      if (dy > 110 || fast) { sheet.style.transform = ''; close(); } else sheet.style.transform = '';
    };
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
  }

  function cardClick(e) {
    if (!on()) return;
    const card = e.target.closest('#startups .p-su');
    if (!card || e.target.closest('a, button, input, textarea, select, [data-why]')) return;
    if (window.getSelection && String(window.getSelection()).length > 2) return; // selecting text, not tapping
    const id = (card.getAttribute('data-key') || '').slice(2);
    tap();
    if (openId === id && WIDE.matches) { close(); return; }
    open(id);
  }

  window.PlayStartup = {
    init(ctx) {
      X = ctx;
      build();
      const host = document.getElementById('startups');
      host.addEventListener('click', cardClick);
      host.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('p-su')) { e.preventDefault(); cardClick(e); } });
      // switching tabs (bottom bar / laptop sidebar) closes the detail
      document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.nav !== 'startups') close(false); }));
    },
    // called by play.js after every render (each poll)
    render() {
      if (!X) return;
      const { S, me, view } = st();
      if (!S || !me) { if (openId) close(false); return; }
      if (openId && (!on() || view !== 'startups' || !teamOf(openId))) close(false);
      markCards();
      if (openId) { paint(); fetchData(false); }
    },
    open, close, isOpen: () => openId,
  };
})();
