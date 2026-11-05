// v4 recap on the phone (flag `recap`): „Můj rok v MUP pokeru“ – a swipeable story of full-screen cards
// from GET ?view=recap, an entry card on the Tým tab, an auto-open once at the final phase, and a
// „Sdílet“ button that draws the summary card to a PNG (canvas, no dependencies) for the Web Share API.
// play.js calls PlayRecap.update(S, me, headers) after every render. Nothing here polls the server.
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NB = '\u00a0';
  const num = (n, d = 0) => (Number(n) || 0).toLocaleString('cs-CZ', { maximumFractionDigits: d, minimumFractionDigits: d }).replace(/\s/g, NB);
  const money = (n) => num(Math.round(n || 0)) + NB + '$';
  const short = (n) => (window.MUP && MUP.fmtM ? MUP.fmtM(n) : money(n));
  const pct = (n, d = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n), Math.abs(n) >= 100 ? 0 : d) + NB + '%';
  const mult = (x) => '×' + num(x, 2);
  const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PA = window.PA || { on: false };
  const LSK = (S, me) => `mup.recap.${S.gid || ''}.${me.id}`;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { if (PA.on) return; try { localStorage.setItem(k, v); } catch {} };

  let S = null, me = null, H = {}, data = null, cards = [], idx = 0, root = null, lastFocus = null, entryHTML = '', loading = false;
  const isOn = () => !!(S && S.features && S.features.recap !== false);
  const isFinal = () => !!(S && (S.phase === 'final' || S.exit));
  const settledBlock = () => {
    let b = 0;
    for (const h of (S && S.history) || []) { const m = /^Blok (\d+)/.exec(h.label || ''); if (m) b = Math.max(b, Number(m[1])); }
    return b;
  };
  const team = (id) => (S && S.teams.find((t) => t.id === id)) || { id, name: id || '?', color: '#7E86A8' };
  const tchip = (id, name) => { const t = team(id); return `<span class="rc-team" style="--tc:${esc(t.color)}"><i></i>${esc(name || t.name)}</span>`; };

  // ---------- entry card on the Tým tab ----------
  function renderEntry() {
    const view = document.querySelector('[data-view="profile"]');
    if (!view) return;
    let el = document.getElementById('rc-entry');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rc-entry';
      el.setAttribute('data-own', '');
      view.insertBefore(el, view.firstChild);
      el.addEventListener('click', (e) => { if (e.target.closest('[data-rc-open]')) open(); });
    }
    const avail = isOn() && me && (settledBlock() > 0 || isFinal());
    let h = '';
    if (avail) {
      const tr = me.track || {};
      const fin = isFinal();
      h = `<button type="button" class="rc-entry pa-keep" data-rc-open aria-label="Otevřít tvoji rekapitulaci">
        <span class="rc-entry-l"><span class="s-label">${fin ? 'Konec hry' : `Zatím po bloku${NB}${esc(settledBlock())}`}</span>
          <b>Tvoje rekapitulace</b>
          <small>${fin ? 'Tvůj rok v MUP pokeru v pár kartách' : 'Průběžný přehled tvých investic'}${tr.rank ? ` · ${esc(tr.rank)}.${NB}místo` : ''}${Number.isFinite(tr.returnPct) ? ` · ${esc(pct(tr.returnPct))}` : ''}</small></span>
        <span class="rc-entry-go" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5l8 7-8 7"/></svg></span>
      </button>`;
    }
    if (h !== entryHTML) { el.innerHTML = h; entryHTML = h; }
  }

  // ---------- data → cards ----------
  function spark(series) {
    const pts = (series || []).map((p) => p[1]).filter((v) => Number.isFinite(v));
    if (pts.length < 2) return '';
    const W = 300, Hh = 90, lo = Math.min(...pts, 1e6), hi = Math.max(...pts, 1e6), span = hi - lo || 1;
    const xy = pts.map((v, i) => [(i / (pts.length - 1)) * W, Hh - 6 - ((v - lo) / span) * (Hh - 12)]);
    const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const base = Hh - 6 - ((1e6 - lo) / span) * (Hh - 12);
    const up = pts[pts.length - 1] >= 1e6;
    return `<svg class="rc-spark ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="${W}" y1="${base.toFixed(1)}" y2="${base.toFixed(1)}" class="rc-spark-base"/>
      <path d="${d} L${W} ${Hh} L0 ${Hh} Z" class="rc-spark-fill"/><path d="${d}" class="rc-spark-line"/>
      <circle cx="${xy[xy.length - 1][0].toFixed(1)}" cy="${xy[xy.length - 1][1].toFixed(1)}" r="5" class="rc-spark-dot"/></svg>`;
  }
  const why = (w) => { const s = String(w || '').trim(); return s.length >= 3 ? `<blockquote class="rc-why rc-in">„${esc(s.length > 220 ? s.slice(0, 217) + '…' : s)}“</blockquote>` : ''; };
  const big = (v, cls = '') => `<div class="rc-big ${cls} rc-in" data-count="${Math.round(v)}">${esc(money(v))}</div>`;

  function build(r) {
    const out = [];
    const nStart = r.diversification.startups, nBlocks = (data.blocks || []).length;
    out.push({ id: 'intro', tone: 'a', html: `
      <div class="s-label rc-in">MUP poker · rekapitulace</div>
      <h1 class="rc-title rc-in">Můj rok v${NB}MUP pokeru</h1>
      <p class="rc-who rc-in"><b>${esc(r.name)}</b>${r.myTeam ? tchip(r.myTeam.id, r.myTeam.name) : ''}</p>
      <div class="rc-pills rc-in">
        <span><b>${esc(num(r.trades))}</b> ${plural(r.trades, 'investice', 'investice', 'investic')}</span>
        <span><b>${esc(num(nStart))}</b> ${plural(nStart, 'startup', 'startupy', 'startupů')}</span>
        <span><b>${esc(num(nBlocks))}</b> ${plural(nBlocks, 'blok', 'bloky', 'bloků')}</span>
      </div>
      <p class="rc-hint rc-in">${data.final ? 'Hra skončila. Pojď se podívat, jak se ti dařilo.' : 'Hra ještě běží – tohle je průběžný stav.'}</p>` });
    out.push({ id: 'portfolio', tone: r.returnPct >= 0 ? 'g' : 'r', html: `
      <div class="s-label rc-in">Tvoje portfolio</div>
      <p class="rc-sub rc-in">Start: ${esc(money(r.start))}</p>
      ${big(r.value)}
      <div class="rc-ret ${r.returnPct >= 0 ? 'up' : 'down'} rc-in">${esc(pct(r.returnPct))}</div>
      <div class="rc-in">${spark(r.series)}</div>
      <p class="rc-sub rc-in">${r.gain >= 0 ? `Zisk <b class="s-up">+${esc(short(r.gain))}</b>` : `Ztráta <b class="s-down">−${esc(short(-r.gain))}</b>`} ${data.final ? `za${NB}celou hru` : 'zatím'}</p>` });
    if (r.rank) {
      const beat = r.beatPct ?? 0;
      out.push({ id: 'rank', tone: 'b', html: `
        <div class="s-label rc-in">Ve třídě</div>
        <div class="rc-rank rc-in"><span>#</span>${esc(r.rank)}</div>
        <p class="rc-sub rc-in">z${NB}${esc(r.of)} ${plural(r.of, 'investora', 'investorů', 'investorů')}</p>
        <div class="rc-meter rc-in" role="img" aria-label="Lepší než ${esc(beat)} % třídy"><i style="width:${Math.max(4, Math.min(100, beat))}%"></i></div>
        <p class="rc-lead rc-in">${r.of > 1 ? `Lepší než <b>${esc(num(beat))}${NB}%</b> třídy` : 'Celá třída jsi ty.'}</p>
        <p class="rc-sub rc-in">Průměr třídy: ${esc(pct(r.class?.avgReturn || 0))} · ty: <b class="${r.returnPct >= 0 ? 's-up' : 's-down'}">${esc(pct(r.returnPct))}</b></p>` });
    }
    if (r.best) {
      const b = r.best, w = r.worst;
      out.push({ id: 'best', tone: 'o', html: `
        <div class="s-label rc-in">Nejlepší tah</div>
        <div class="rc-in">${tchip(b.team, b.teamName)}</div>
        <div class="rc-mult rc-in ${b.multiple >= 1 ? 'up' : 'down'}">${esc(mult(b.multiple))}</div>
        <p class="rc-sub rc-in">Blok ${esc(b.block)} · ${esc(short(b.amt))} → ${esc(short(b.amt + (b.gain ?? b.amt * (b.multiple - 1))))}</p>
        ${why(b.why)}
        ${w ? `<div class="rc-worst rc-in"><span class="s-label">Nejhorší tah</span><div>${tchip(w.team, w.teamName)} <b class="${w.multiple >= 1 ? 's-up' : 's-down'}">${esc(mult(w.multiple))}</b> <small>Blok ${esc(w.block)} · ${esc(short(w.amt))}</small></div></div>` : ''}` });
    }
    if (r.trades) {
      const f = r.favourite, bg = r.biggest, c = r.contrarian, dv = r.diversification;
      out.push({ id: 'style', tone: 'v', html: `
        <div class="s-label rc-in">Tvůj styl</div>
        <h2 class="rc-h rc-in">Jak investuješ</h2>
        <div class="rc-tiles">
          ${f ? `<div class="rc-tile rc-in"><span class="s-label">Oblíbený startup</span>${tchip(f.team, f.teamName)}<b>${esc(short(f.amt))}</b><small>v${NB}${esc(f.blocks)} ${plural(f.blocks, 'bloku', 'blocích', 'blocích')}</small></div>` : ''}
          ${bg ? `<div class="rc-tile rc-in"><span class="s-label">Největší sázka</span><b>${esc(short(bg.amt))}</b><small>${esc(num(bg.share * 100))}${NB}% kapitálu · ${esc(bg.teamName)}</small></div>` : ''}
          <div class="rc-tile rc-in"><span class="s-label">Diverzifikace</span><b>${esc(dv.startups)} z${NB}${esc(dv.of)}</b><small>${plural(dv.of, 'startupu', 'startupů', 'startupů')} ve hře</small></div>
          <div class="rc-tile rc-in"><span class="s-label">Proti proudu</span><b>${esc(c.count)}${NB}×</b><small>${c.count ? `tam, kam třída nešla${c.hits ? ` · ${esc(c.hits)} v${NB}plusu` : ''}` : 'vždy s' + NB + 'třídou'}</small></div>
        </div>` });
    }
    const q = r.quiz;
    if (q && (q.asked > 0 || q.points > 0)) {
      out.push({ id: 'quiz', tone: 'p', html: `
        <div class="s-label rc-in">Kvíz</div>
        <div class="rc-big rc-in" data-count="${Math.round(q.points)}" data-unit="b">${esc(num(q.points))}${NB}b.</div>
        <p class="rc-sub rc-in">${esc(q.correct)} z${NB}${esc(q.asked)} správně${r.quizRank ? ` · ${esc(r.quizRank)}.${NB}místo v${NB}kvízu` : ''}</p>
        <div class="rc-tiles">
          <div class="rc-tile rc-in"><span class="s-label">Nejdelší série</span><b>${esc(q.bestStreak)}</b><small>${plural(q.bestStreak, 'správná', 'správné', 'správných')} v${NB}řadě</small></div>
          <div class="rc-tile rc-in"><span class="s-label">Nejrychlejší</span><b>${q.fastest ? (q.fastest.ms < 100 ? '&lt;' + NB + esc(num(0.1, 1)) : esc(num(q.fastest.ms / 1000, 1))) + NB + 's' : '–'}</b><small>${q.fastest ? 'správná odpověď' : 'zatím žádná správná'}</small></div>
        </div>
        ${q.fastest && q.fastest.q ? `<p class="rc-qq rc-in">„${esc(q.fastest.q)}“</p>` : ''}` });
    }
    if ((r.awards || []).length || (r.badges || []).length) {
      out.push({ id: 'awards', tone: 'a', html: `
        <div class="s-label rc-in">Ocenění a${NB}odznaky</div>
        ${(r.awards || []).map((a) => `<div class="rc-award rc-in"><span class="rc-medal" aria-hidden="true">★</span><div><b>${esc(a.label)}</b>${a.note ? `<small>${esc(a.note)}</small>` : ''}</div></div>`).join('')}
        <div class="rc-badges rc-in">${(r.badges || []).map((b) => `<span class="rc-badge" data-b="${esc(b.id)}">${esc(b.label)}</span>`).join('')}</div>` });
    }
    out.push({ id: 'type', tone: 'g2', html: `
      <div class="s-label rc-in">Tvůj investorský typ</div>
      <h1 class="rc-type rc-in">${esc(r.type.label)}</h1>
      <p class="rc-lead rc-in">${esc(r.type.line)}</p>
      <div class="rc-sum rc-in">
        <div><span class="s-label">Portfolio</span><b>${esc(short(r.value))}</b></div>
        <div><span class="s-label">Výnos</span><b class="${r.returnPct >= 0 ? 's-up' : 's-down'}">${esc(pct(r.returnPct))}</b></div>
        <div><span class="s-label">Pořadí</span><b>${r.rank ? `${esc(r.rank)}.${NB}z${NB}${esc(r.of)}` : '–'}</b></div>
        <div><span class="s-label">Nejlepší tah</span><b>${r.best ? `${esc(r.best.teamName)} ${esc(mult(r.best.multiple))}` : '–'}</b></div>
      </div>
      <div class="rc-actions rc-in">
        <button type="button" class="s-btn rc-share pa-keep" data-rc="share"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>Sdílet</button>
        <button type="button" class="s-btn s-ghost pa-keep" data-rc="again">Znovu</button>
        <button type="button" class="s-btn s-ghost pa-keep" data-rc="close">Zavřít</button>
      </div>` });
    return out;
  }

  // ---------- overlay ----------
  function shell() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'rc hidden';
    root.id = 'recap';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Tvoje rekapitulace');
    root.tabIndex = -1;
    root.innerHTML = `<div class="rc-frame">
      <div class="rc-bar" aria-hidden="true"></div>
      <button type="button" class="rc-x pa-keep" data-rc="close" aria-label="Zavřít rekapitulaci"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="rc-stage" aria-live="polite"></div>
      <button type="button" class="rc-nav rc-prev pa-keep" data-rc="prev" aria-label="Předchozí karta"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button type="button" class="rc-nav rc-next pa-keep" data-rc="next" aria-label="Další karta"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>`;
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    let x0 = null, y0 = null, t0 = 0;
    root.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); });
    root.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - t0 < 800) { root.dataset.swiped = '1'; go(idx + (dx < 0 ? 1 : -1)); }
      else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5) { root.dataset.swiped = '1'; close(); }
    });
    return root;
  }

  function onClick(e) {
    if (root.dataset.swiped) { delete root.dataset.swiped; return; }
    const b = e.target.closest('[data-rc]');
    if (b) {
      const a = b.dataset.rc;
      if (a === 'close') close();
      else if (a === 'next') go(idx + 1);
      else if (a === 'prev') go(idx - 1);
      else if (a === 'again') go(0);
      else if (a === 'share') share(b);
      else if (a === 'retry') load();
      return;
    }
    if (e.target.closest('a, button, input, blockquote')) return;
    if (!cards.length) return;
    const frame = root.querySelector('.rc-frame').getBoundingClientRect();
    // tap the left third to go back, anywhere else to go on (like stories)
    go(e.clientX < frame.left + frame.width / 3 ? idx - 1 : idx + 1);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight' || (e.key === ' ' && !e.target.closest('button'))) { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
    else if (e.key === 'Tab') {
      const f = [...root.querySelectorAll('button:not([disabled])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }

  function countUp(el) {
    const v = Number(el.dataset.count);
    if (!Number.isFinite(v) || reduced() || Math.abs(v) < 10) return;
    const unit = el.dataset.unit === 'b' ? NB + 'b.' : null;
    const t0 = performance.now(), D = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
      el.textContent = unit ? num(Math.round(v * e)) + unit : money(v * e);
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function paint() {
    const st = root.querySelector('.rc-stage');
    const bar = root.querySelector('.rc-bar');
    bar.innerHTML = cards.map((c, i) => `<i class="${i < idx ? 'done' : i === idx ? 'on' : ''}"></i>`).join('');
    const c = cards[idx];
    root.dataset.tone = c ? c.tone : 'a';
    st.innerHTML = c ? `<section class="rc-card on" data-card="${esc(c.id)}" aria-label="Karta ${idx + 1} z ${cards.length}">${c.html}</section>` : '';
    root.querySelector('.rc-prev').disabled = idx <= 0;
    root.querySelector('.rc-next').disabled = idx >= cards.length - 1;
    st.querySelectorAll('[data-count]').forEach(countUp);
    root.dataset.card = c ? c.id : '';
  }
  function go(i) {
    if (!cards.length) return;
    if (i >= cards.length) { if (idx === cards.length - 1) return; i = cards.length - 1; }
    idx = Math.max(0, i);
    paint();
  }
  function message(html) {
    cards = [];
    root.querySelector('.rc-bar').innerHTML = '';
    root.querySelector('.rc-stage').innerHTML = `<section class="rc-card on rc-msg">${html}</section>`;
    root.dataset.card = 'msg';
  }

  async function load() {
    if (loading) return;
    loading = true;
    message('<div class="rc-spin" aria-hidden="true"></div><p class="rc-sub">Počítám tvoji rekapitulaci…</p>');
    let j = null;
    try { j = await MUP.get(H, '?view=recap'); } catch (e) { j = null; }
    loading = false;
    if (!root || root.classList.contains('hidden')) return;
    if (!j || !j.ok || !j.recap) {
      message(`<p class="rc-lead">${esc(j && j.error ? j.error : 'Rekapitulaci se nepodařilo načíst.')}</p><div class="rc-actions"><button type="button" class="s-btn pa-keep" data-rc="retry">Zkusit znovu</button><button type="button" class="s-btn s-ghost pa-keep" data-rc="close">Zavřít</button></div>`);
      return;
    }
    data = j;
    cards = build(j.recap);
    const want = /[#&]recap=(\d+)/.exec(location.hash);
    idx = want ? Math.min(cards.length - 1, Math.max(0, Number(want[1]) - 1)) : 0;
    paint();
  }

  function open() {
    shell();
    lastFocus = document.activeElement;
    root.classList.remove('hidden');
    document.documentElement.classList.add('rc-open');
    root.focus({ preventScroll: true });
    if (S && me) lsSet(LSK(S, me), '1');
    load();
  }
  function close() {
    if (!root) return;
    root.classList.add('hidden');
    document.documentElement.classList.remove('rc-open');
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch {}
  }

  // ---------- share: the summary card drawn on a canvas ----------
  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/), lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  async function drawPNG(r) {
    const W = 1080, Hh = 1350;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = Hh;
    const ctx = cv.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const v = (k, d) => (css.getPropertyValue(k) || '').trim() || d;
    const DISPLAY = "'Archivo Expanded', 'Archivo', system-ui, sans-serif", FONT = "'Archivo', system-ui, sans-serif", MONO = "'JetBrains Mono', ui-monospace, monospace";
    try { await Promise.all(['800 80px "Archivo Expanded"', '700 40px "Archivo"', '400 30px "Archivo"', '500 26px "JetBrains Mono"'].map((f) => document.fonts.load(f))); } catch {}
    ctx.fillStyle = v('--s-bg', '#0B1030');
    ctx.fillRect(0, 0, W, Hh);
    const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 900);
    g1.addColorStop(0, 'rgba(53,134,209,.55)'); g1.addColorStop(1, 'rgba(53,134,209,0)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, Hh);
    const g2 = ctx.createRadialGradient(W, Hh, 0, W, Hh, 900);
    g2.addColorStop(0, 'rgba(255,85,116,.45)'); g2.addColorStop(1, 'rgba(255,85,116,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, Hh);
    const grad = ctx.createLinearGradient(80, 0, W - 80, 0);
    [['#3586D1', 0], ['#6754DF', 0.35], ['#FF5574', 0.7], ['#FF8A47', 1]].forEach(([c, s]) => grad.addColorStop(s, c));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, 14);
    const X = 90;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#9FB4FF'; ctx.font = `500 26px ${MONO}`;
    ctx.fillText('MUP POKER · REKAPITULACE', X, 120);
    ctx.fillStyle = grad; ctx.font = `800 76px ${DISPLAY}`;
    ctx.fillText('MŮJ ROK', X, 215); ctx.fillText('V MUP POKERU', X, 300);
    ctx.fillStyle = '#F4F5FA'; ctx.font = `700 44px ${FONT}`;
    ctx.fillText(r.name, X, 390);
    if (r.myTeam) {
      const tw = ctx.measureText(r.name).width;
      ctx.fillStyle = r.myTeam.color || '#7E86A8';
      ctx.beginPath(); ctx.arc(X + tw + 34, 375, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#B8BED6'; ctx.font = `400 34px ${FONT}`;
      ctx.fillText(r.myTeam.name, X + tw + 56, 388);
    }
    // value + return
    ctx.fillStyle = '#B8BED6'; ctx.font = `500 24px ${MONO}`; ctx.fillText('PORTFOLIO', X, 480);
    ctx.fillStyle = '#F4F5FA'; ctx.font = `800 104px ${DISPLAY}`;
    ctx.fillText(money(r.value).replace(/ /g, ' '), X, 590);
    const ret = pct(r.returnPct).replace(/ /g, ' ');
    ctx.font = `800 52px ${DISPLAY}`;
    const rw = ctx.measureText(ret).width + 56;
    ctx.fillStyle = r.returnPct >= 0 ? 'rgba(63,207,142,.16)' : 'rgba(255,92,108,.16)';
    roundRect(ctx, X, 625, rw, 84, 42); ctx.fill();
    ctx.fillStyle = r.returnPct >= 0 ? '#3FCF8E' : '#FF5C6C';
    ctx.fillText(ret, X + 28, 687);
    if (r.rank) { ctx.fillStyle = '#F4F5FA'; ctx.font = `700 44px ${FONT}`; ctx.fillText(`${r.rank}. místo z ${r.of}`, X + rw + 36, 684); }
    // type
    ctx.fillStyle = '#9FB4FF'; ctx.font = `500 24px ${MONO}`; ctx.fillText('INVESTORSKÝ TYP', X, 800);
    ctx.fillStyle = grad; ctx.font = `800 72px ${DISPLAY}`;
    let y = 880;
    for (const line of wrap(ctx, r.type.label.toUpperCase(), W - 2 * X)) { ctx.fillText(line, X, y); y += 80; }
    ctx.fillStyle = '#B8BED6'; ctx.font = `400 34px ${FONT}`;
    for (const line of wrap(ctx, r.type.line, W - 2 * X).slice(0, 2)) { ctx.fillText(line, X, y); y += 46; }
    // best call + badges
    y += 30;
    if (r.best) {
      ctx.fillStyle = '#F4F5FA'; ctx.font = `700 36px ${FONT}`;
      ctx.fillText(`Nejlepší tah: ${r.best.teamName} ${mult(r.best.multiple).replace(/ /g, ' ')}`, X, y); y += 70;
    }
    let bx = X;
    ctx.font = `700 28px ${FONT}`;
    for (const b of (r.badges || []).slice(0, 4)) {
      const w = ctx.measureText(b.label).width + 44;
      if (bx + w > W - X) break;
      ctx.fillStyle = 'rgba(103,84,223,.32)'; roundRect(ctx, bx, y - 40, w, 58, 29); ctx.fill();
      ctx.fillStyle = '#F4F5FA'; ctx.fillText(b.label, bx + 22, y);
      bx += w + 16;
    }
    ctx.fillStyle = '#7E86A8'; ctx.font = `500 24px ${MONO}`;
    ctx.fillText('MUP × RAINBOWJET · INVESTIČNÍ STŮL', X, Hh - 70);
    return cv;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  async function share(btn) {
    if (!data || !data.recap) return;
    const r = data.recap;
    btn.disabled = true;
    try {
      const cv = await drawPNG(r);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
      if (!blob) throw new Error('png');
      const name = 'mup-poker-rekapitulace.png';
      const text = `Můj rok v MUP pokeru: ${r.type.label}, ${pct(r.returnPct).replace(/ /g, ' ')}${r.rank ? `, ${r.rank}. místo z ${r.of}` : ''}.`;
      let file = null;
      try { file = new File([blob], name, { type: 'image/png' }); } catch {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        try { await navigator.share({ files: [file], title: 'Můj rok v MUP pokeru', text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      if (window.PK && PK.toast) PK.toast('Obrázek je stažený.');
    } catch (e) {
      if (window.PK && PK.toast) PK.toast('Obrázek se nepodařilo vytvořit.', 'err');
    } finally { btn.disabled = false; }
  }

  // ---------- hook from play.js ----------
  function update(s, m, headers) {
    S = s; me = m; H = headers || {};
    if (!S || !me) return;
    renderEntry();
    if (!isOn()) { if (root && !root.classList.contains('hidden')) close(); return; }
    const quizUp = !document.getElementById('quiz') || !document.getElementById('quiz').classList.contains('hidden');
    const ask = /[#&]recap(=|$)/.test(location.hash);
    if (root && !root.classList.contains('hidden')) { if (quizUp) close(); return; } // a quiz question always wins
    if (ask && !update.asked) { update.asked = true; open(); return; }
    if (isFinal() && !PA.on && !quizUp && !lsGet(LSK(S, me))) open();
  }
  window.PlayRecap = { update, open, close, drawPNG: () => (data ? drawPNG(data.recap) : null) };
})();
