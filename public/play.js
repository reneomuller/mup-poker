(function () {
  const { esc, fmt, fmtM, get, timeLeft, clock, PHASES, billHTML, loadPortraits, t: tx } = MUP;
  const { morph, haptic, toast } = PK;
  const E = (k, v) => esc(tx(k, v));
  const $ = (id) => document.getElementById(id);
  const STEP = 10000;
  const DEMO = /[?&]demo=1(&|$)/.test(location.search);
  const PA = window.PA || { on: false }; // play-access.js: ?as= dealer preview (GETs get as= + x-dealer, POSTs blocked), #login= token
  const post = (body) => (!PA.on && DEMO && window.PlayDemo ? window.PlayDemo.post(body, MUP.post) : MUP.post(body));

  MUP.addTexts({
    'play.nav.invest': 'Investovat',
    'play.nav.portfolio': 'Portfolio',
    'play.nav.startups': 'Startupy',
    'play.nav.profile': 'Tým',
    'play.chip.lobby': 'Čekáme na start',
    'play.chip.pitch': 'Pitch',
    'play.chip.betting': 'Investování',
    'play.chip.closed': 'Uzavřeno',
    'play.chip.showdown': 'Showdown',
    'play.chip.rj': 'Smart money',
    'play.chip.final': 'Demo Day',
    'play.offline': 'Bez spojení – zkouším to znovu…',
    'play.quiz.sent': 'Odesláno',
    'play.quiz.wait': 'Počkej na vyhodnocení na plátně.',
    'play.quiz.lobby': 'Kvíz začíná',
    'play.quiz.lobbyHint': 'Otázky běží na plátně, odpovídáš tady na mobilu. Rychlost se počítá.',
    'play.card.title': 'Karta vašeho týmu',
    'play.card.hint': 'Tohle uvidí všichni na kartě vašeho startupu. Měnit ji může kdokoli z týmu.',
    'play.round.title': 'Podmínky kola',
    'play.round.hint': 'Před otevřením investování nastavíte pre-money ocenění vašeho kola. Investice bloku proběhnou za tuto cenu.',
  });

  let sid = PA.on ? PA.sid : localStorage.getItem('mup.sid'), pin = PA.on ? null : localStorage.getItem('mup.pin');
  let S = null, me = null, meFail = 0, formKey = null, draft = null, loginKey = null, notesKey = null, tab = 'new';
  let view = 'invest', lastPhase = null, firstRender = true;

  // The dealer's "Ghost" button opens /play#ghost=<sid>:<pin>
  const gh = /^#ghost=([\w-]+):(\d{4})$/.exec(location.hash);
  if (gh && !PA.on) {
    sid = gh[1]; pin = gh[2];
    localStorage.setItem('mup.sid', sid); localStorage.setItem('mup.pin', pin);
    localStorage.removeItem('mup.profile');
    history.replaceState(null, '', location.pathname + location.search);
  }

  // This phone keeps its own copy of the account and decisions. If the server forgets them
  // (no database, new server instance), the phone quietly pushes them back.
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { if (PA.on) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const slipsKey = () => 'mup.slips.' + sid;
  function rememberSlip(slip) {
    if (!slip || !S) return;
    let all = LS.get(slipsKey()) || {};
    if (all.gid !== S.gid) all = { gid: S.gid, blocks: {} };
    const cur = all.blocks[S.block];
    if (!cur || (slip.ts || 0) >= (cur.ts || 0)) all.blocks[S.block] = slip;
    LS.set(slipsKey(), all);
  }
  let lastRestore = 0;
  async function restore() {
    if (Date.now() - lastRestore < 3000) return null;
    lastRestore = Date.now();
    const prof = LS.get('mup.profile');
    if (!prof || prof.sid !== sid) return null;
    const all = LS.get(slipsKey()) || {};
    return post({ op: 'restore', sid, pin, name: prof.name, team: prof.team, gid: prof.gid, slips: all.gid === prof.gid ? all.blocks || {} : {} });
  }

  // ---------- small helpers ----------
  const auth = () => (sid && pin ? { 'x-sid': sid, 'x-pin': pin } : {});
  const team = (id) => S.teams.find((t) => t.id === id) || { id, name: id || '?', color: '#7E86A8' };
  const parseAmt = (v) => Math.max(0, Math.round(Number(String(v).replace(/[^\d]/g, '')) || 0));
  const plain = (n) => Math.round(n).toLocaleString('cs-CZ');
  const sumOf = (m) => Object.values(m).reduce((a, e) => a + (e.amt || 0), 0);
  const feat = (k) => !!(S && S.features && S.features[k]);
  const NB = ' ';
  const num = (n, d = 0) => (Number(n) || 0).toLocaleString('cs-CZ', { maximumFractionDigits: d, minimumFractionDigits: 0 }).replace(/\s/g, NB);
  const pct = (n, d = 1) => num(n, d) + NB + '%';
  const spct = (n, d = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + pct(Math.abs(n), d);
  const smoney = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtM(Math.abs(n));
  const mult = (n) => num(n, 2) + '×';
  const ptsWord = (n) => { const a = Math.abs(Math.round(n)); return a === 1 ? 'bod' : a >= 2 && a <= 4 ? 'body' : 'bodů'; };
  const pts = (n) => num(n) + NB + ptsWord(n);
  const day = (ts) => { const d = new Date(ts); return `${d.getDate()}.${NB}${d.getMonth() + 1}.`; };
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  const dot = (c) => `<span class="s-dot" style="background:${esc(c)}"></span>`;
  // v3 live numbers: projected (…Now) fields while class trades are pending, v2 fields as a fallback
  const Vn = (t) => (t && (t.Vnow ?? t.V)) || 0;
  const PF = () => me.portfolioNow ?? me.portfolio;
  // live return (v3 §2: portfolio numbers during investing use portfolioNow); server returnPct is the settled one
  const RET = (tr) => (me.portfolioNow != null && me.start ? Math.round(((me.portfolioNow - me.start) / me.start) * 1000) / 10 : tr.returnPct);
  const INV = () => !!(me.invested || Object.values(me.stakesNow || {}).some((v) => v > 0));
  const SK = (id) => ((me.stakesNow || me.stakes || {})[id] || 0);
  const pendingLive = () => (S.phase === 'betting' || S.phase === 'closed') && S.teams.some((t) => t.Vnow != null && t.Vnow !== t.V);
  // tweened numbers: render with tw(), runTweens() animates from the last shown value after each render
  const twLast = {};
  const twF = { M: (v) => fmtM(v), F: (v) => fmt(v) };
  const tw = (key, v, f = 'M') => `<span class="s-num p-tw" data-tw="${esc(key)}" data-v="${Math.round(v)}" data-f="${f}">${esc(twF[f](v))}</span>`;
  function runTweens() {
    document.querySelectorAll('[data-tw]').forEach((el) => {
      const key = el.dataset.tw, to = +el.dataset.v, f = twF[el.dataset.f] || twF.M, from = twLast[key];
      twLast[key] = to;
      if (from == null || from === to || PK.reduced() || el.offsetParent === null) { if (!el._tw || from !== to) { el._tw = null; el.textContent = f(to); } return; }
      const t0 = performance.now(), dur = 700, run = el._tw = {};
      el.classList.remove('p-tw-up', 'p-tw-down'); void el.offsetWidth; el.classList.add(to > from ? 'p-tw-up' : 'p-tw-down');
      const step = (now) => {
        if (el._tw !== run) return;
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = f(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(step); else el._tw = null;
      };
      requestAnimationFrame(step);
    });
  }
  const teamTag = (id) => { const t = team(id); return `<span class="p-tt">${dot(t.color)}${esc(t.name)}</span>`; };

  // ---------- network status ----------
  let netFails = 0;
  function netState(okNow) {
    netFails = okNow ? 0 : netFails + 1;
    $('net').classList.toggle('hidden', netFails < 2);
    $('nettxt').textContent = tx('play.offline');
  }
  $('netretry').onclick = () => { haptic.tap(); kick(0); };
  // posts that fail on the network show the banner straight away
  async function send(body) {
    const r = await post(body);
    if (r && r.net) { netFails = Math.max(netFails, 1); netState(false); }
    return r || { ok: false, error: 'Něco se pokazilo.' };
  }

  // ---------- login ----------
  function showLogin() {
    $('boot').classList.add('hidden');
    $('game').classList.add('hidden');
    $('quiz').classList.add('hidden');
    document.body.classList.remove('p-ingame');
    const el = $('login');
    el.classList.remove('hidden');
    if (!S.regOpen) tab = 'old';
    // the "new" form doesn't depend on who else is playing, so classmates joining never rebuild it
    const key = JSON.stringify([S.teams.map((t) => [t.id, t.name]), tab === 'old' ? S.players.map((p) => [p.id, p.name, p.team]) : 0, S.regOpen, tab, MUP.cv()]);
    if (key === loginKey) return;
    // never rebuild under someone's fingers (it rebuilds on the next poll after they leave the field)
    const a = document.activeElement;
    if (loginKey && a && el.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
    loginKey = key;
    const keep = { name: $('lname')?.value, team: $('lteam')?.value, who: $('lwho')?.value, pin: $('lpin')?.value };
    const teamOpts = S.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    const byTeam = S.teams.map((t) => {
      const ps = S.players.filter((p) => p.team === t.id);
      return ps.length ? `<optgroup label="${esc(t.name)}">${ps.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>` : '';
    }).join('');
    el.innerHTML = `
      <div class="p-hero-login">
        <div class="p-bills">${[0, 1, 2, 3, 4].map((i) => billHTML(i)).join('')}</div>
        <div class="s-label">${E('play.login.sub')}</div>
        <h1 class="s-h1">${E('play.login.title')}</h1>
      </div>
      <div class="s-card p-card p-login-card">
        <div class="s-tabs">${S.regOpen ? `<button type="button" data-tab="new" class="${tab === 'new' ? 's-on' : ''}">${E('play.login.tabNew')}</button>` : ''}<button type="button" data-tab="old" class="${tab === 'old' ? 's-on' : ''}">${E('play.login.tabOld')}</button></div>
        <form id="lform" novalidate>
        ${tab === 'new' ? `
          <label class="s-field"><span class="s-label">${E('play.login.name')}</span><input class="s-input" id="lname" autocomplete="name" autocapitalize="words" maxlength="40" enterkeyhint="next"></label>
          <label class="s-field"><span class="s-label">${E('play.login.team')}</span><select class="s-input p-select" id="lteam"><option value="">Vyber tým…</option>${teamOpts}</select></label>
          <label class="s-field"><span class="s-label">${E('play.login.pinNew')}</span><input class="s-input p-pin" id="lpin" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" enterkeyhint="go"></label>
          <button class="s-btn s-primary s-block" id="lgo" type="submit">${E('play.login.goNew')}</button>` : `
          <label class="s-field"><span class="s-label">${E('play.login.who')}</span><select class="s-input p-select" id="lwho"><option value="">Vyber své jméno…</option>${byTeam}</select></label>
          <label class="s-field"><span class="s-label">${E('play.login.pin')}</span><input class="s-input p-pin" id="lpin" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" enterkeyhint="go"></label>
          <button class="s-btn s-primary s-block" id="lgo" type="submit">${E('play.login.goOld')}</button>`}
        </form>
        <div class="p-err" id="lerr" role="alert"></div>
      </div>
      <p class="p-foot s-faint">Investiční hra kurzu Digitální podnikání v éře AI</p>`;
    if ($('lname') && keep.name) $('lname').value = keep.name;
    if ($('lteam') && keep.team) $('lteam').value = keep.team;
    if ($('lwho') && keep.who) $('lwho').value = keep.who;
    if (keep.pin) $('lpin').value = keep.pin;
    el.querySelectorAll('.p-bills .bill').forEach((b, i) => { b.style.transform = `translateX(-50%) rotate(${(i - 2) * 9}deg)`; });
    el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { haptic.tap(); tab = b.dataset.tab; loginKey = null; showLogin(); }));
    $('lpin').addEventListener('input', () => { $('lpin').value = $('lpin').value.replace(/\D/g, '').slice(0, 4); });
    $('lform').onsubmit = (e) => { e.preventDefault(); doLogin(); };
    if (PA.loginError) { $('lerr').textContent = PA.loginError; PA.loginError = null; }
  }
  let logging = false;
  async function doLogin() {
    if (logging) return;
    const p = $('lpin').value.trim();
    $('lerr').textContent = '';
    logging = true;
    const btn = $('lgo');
    btn.classList.add('p-busy'); btn.setAttribute('aria-busy', 'true');
    let r;
    if (tab === 'new') r = await send({ op: 'register', name: $('lname').value, team: $('lteam').value, pin: p });
    else r = await send({ op: 'login', sid: $('lwho').value, pin: p });
    logging = false;
    btn.classList.remove('p-busy'); btn.removeAttribute('aria-busy');
    if (!r.ok) { $('lerr').textContent = r.error; haptic.err(); shake($('lerr')); return; }
    haptic.ok();
    sid = r.sid; pin = p;
    localStorage.setItem('mup.sid', sid); localStorage.setItem('mup.pin', pin); localStorage.removeItem('mup.profile');
    meFail = 0; loginKey = null; formKey = null; notesKey = null; firstRender = true; view = 'invest';
    $('login').classList.add('hidden');
    $('boot').classList.remove('hidden');
    kick(0);
  }
  function logout() {
    if (PA.on) return;
    sid = pin = null; localStorage.removeItem('mup.sid'); localStorage.removeItem('mup.pin'); localStorage.removeItem('mup.profile');
    me = null; loginKey = null; formKey = null; notesKey = null; tab = 'old'; firstRender = true;
    pfShown = null; msgSeenTs = null; revealSeq = null; cardDirty = false; roundDraft = null; quizKey = null;
    for (const k of Object.keys(seen)) delete seen[k];
    resetViews();
    showLogin();
  }
  function shake(el) { if (!el || PK.reduced()) return; el.classList.remove('p-shake'); void el.offsetWidth; el.classList.add('p-shake'); }

  // ---------- navigation ----------
  const VIEWS = ['invest', 'portfolio', 'startups', 'profile'];
  const scrollPos = {};
  try { const v = sessionStorage.getItem('mup.view'); if (VIEWS.includes(v)) view = v; } catch {}
  function go(v, { silent } = {}) {
    if (!VIEWS.includes(v)) return;
    if (v === view && !silent) { window.scrollTo({ top: 0, behavior: PK.reduced() ? 'auto' : 'smooth' }); return; }
    scrollPos[view] = window.scrollY;
    view = v;
    try { sessionStorage.setItem('mup.view', v); } catch {}
    applyView();
    window.scrollTo(0, scrollPos[v] || 0);
    if (me) { markSeen(); renderDock(); syncWall(); runTweens(); }
  }
  function applyView() {
    document.querySelectorAll('[data-view]').forEach((s) => s.classList.toggle('on', s.dataset.view === view));
    document.querySelectorAll('[data-nav]').forEach((b) => { const on = b.dataset.nav === view; b.classList.toggle('s-on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  }
  function resetViews() { ['hero', 'msgs', 'main', 'exitbox', 'portfolio', 'captable', 'startups', 'teamv', 'profile'].forEach((id) => { $(id).innerHTML = ''; }); $('dock').innerHTML = ''; dockBuilt = false; }
  document.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => { haptic.tap(); go(b.dataset.nav); }));

  // "new" dots on tabs: each tab has a signature; when it changes while you're elsewhere, a dot shows
  const seen = {}, sigs = {};
  function tabSigs() {
    const m = me.msgs || [];
    return {
      invest: [m[0]?.ts || 0, S.phase === 'betting' && !me.slip?.submitted ? 'bet' + S.block : ''].join('|'),
      portfolio: [Math.round((PF() || 0) / 1000), feat('captable') ? me.myTeamCap?.founders : ''].join('|'),
      startups: JSON.stringify([feat('cards') ? S.cards : 0, feat('drivers') ? Object.values(S.drivers || {}).map((d) => d[0]?.ts || 0) : 0, feat('market') ? (S.market?.flipped || []).length : 0, feat('rounds') ? S.rounds : 0]),
      profile: [feat('points') ? me.points?.total : '', feat('track') ? (me.track?.awards || []).length : '', wallOn() ? me.wallRev || 0 : ''].join('|'),
    };
  }
  function markSeen() { if (sigs[view] !== undefined) seen[view] = sigs[view]; renderDots(); }
  function renderDots() {
    Object.assign(sigs, tabSigs());
    for (const v of VIEWS) {
      if (seen[v] === undefined || v === view) seen[v] = sigs[v];
      document.querySelector(`[data-nav="${v}"]`).classList.toggle('p-new', seen[v] !== sigs[v]);
    }
  }

  // ---------- header + phase ----------
  let pfShown = null;
  function renderHeader() {
    const t = team(me.team);
    const ava = $('ava');
    ava.textContent = initials(me.name);
    ava.style.setProperty('--tc', t.color);
    morph($('who'), `${esc(me.name)}${me.ghost ? ' <span class="s-badge s-warn">Ghost</span>' : ''}`);
    morph($('myteam'), `${dot(t.color)}<span>${esc(t.name)}</span>`);
    const v = PF() || (INV() ? 0 : me.rules.capital || 0);
    const pf = $('pfv');
    if (pfShown !== null && pfShown !== v) { pf.classList.remove('p-bump'); void pf.offsetWidth; pf.classList.add('p-bump'); }
    pfShown = v;
    pf.dataset.tw = 'hdrpf'; pf.dataset.v = Math.round(v); pf.dataset.f = 'M';
    if (twLast.hdrpf == null) pf.textContent = fmtM(v);
    const up = INV() && PF() >= me.start;
    pf.classList.toggle('s-up', !!(INV() && up && PF() > me.start));
    pf.classList.toggle('s-down', !!(INV() && !up));
  }

  function phaseTexts() {
    const s = S;
    let t1 = PHASES[s.phase] || '', t2 = tx('play.status.block', { block: s.block, max: s.maxBlock });
    if (s.phase === 'pitch' && s.presenting) { t1 = tx('play.status.pitch', { team: team(s.presenting).name }); t2 = tx('play.status.pitchHint'); }
    if (s.phase === 'lobby') { t1 = tx('play.status.lobby'); t2 = tx('play.status.lobbyHint'); }
    if (s.phase === 'closed') t2 = tx('play.status.closedHint');
    if (s.phase === 'showdown') t2 = tx('play.status.showdownHint');
    if (s.phase === 'rj') t2 = tx('play.status.rjHint');
    return [t1, t2];
  }

  function renderStatus() {
    const s = S;
    const el = $('status');
    if (!el.querySelector('.p-chip')) el.innerHTML = '<span class="p-chip"><i class="p-live"></i><b class="st1"></b><span class="clk s-num"></span></span><span class="p-blk s-label"></span>';
    const chip = el.querySelector('.p-chip');
    chip.dataset.ph = s.phase;
    let label = tx('play.chip.' + s.phase);
    if (s.phase === 'pitch' && s.presenting) label = team(s.presenting).name;
    el.querySelector('.st1').textContent = label;
    const left = timeLeft(s);
    const clk = el.querySelector('.clk');
    clk.textContent = left === null ? '' : left > 0 ? clock(left) : tx('table.timeUp');
    chip.classList.toggle('p-urgent', left !== null && left > 0 && left <= 30000);
    chip.classList.toggle('p-hasclk', left !== null);
    el.querySelector('.p-blk').textContent = s.phase === 'final' ? 'Finále' : `Blok ${s.block}/${s.maxBlock}`;
    const bar = $('tbar');
    const frac = left === null || !s.timerTotal ? 0 : Math.max(0, Math.min(1, left / s.timerTotal));
    bar.style.transform = `scaleX(${frac})`;
    bar.classList.toggle('on', left !== null && left > 0);
  }

  function renderHero() {
    const el = $('hero');
    if (S.phase === 'betting' || (feat('exit') && S.exit)) { el.innerHTML = ''; return; }
    const [t1, t2] = phaseTexts();
    const pres = S.phase === 'pitch' && S.presenting ? team(S.presenting) : null;
    const left = timeLeft(S);
    morph(el, `<div class="s-card p-card p-hero" data-ph="${esc(S.phase)}" ${pres ? `style="--tc:${esc(pres.color)}"` : ''}>
      <div class="s-label">${S.phase === 'final' ? 'Finále' : `Blok ${S.block} z ${S.maxBlock}`}${S.timerLabel && left ? ` · ${esc(S.timerLabel)}` : ''}</div>
      <h2 class="p-hero-t">${pres ? dot(pres.color) : ''}${esc(t1)}</h2>
      <p class="p-hero-s">${esc(t2)}</p>
      ${pres && pres.id !== me.team ? `<button type="button" class="s-btn s-ghost s-sm p-hero-btn" data-act="note-jump" data-team="${esc(pres.id)}">Psát poznámky k pitchi</button>` : ''}
    </div>`);
  }

  // ---------- private messages from RainbowJet to my team ----------
  let msgsOpen = false, msgSeenTs = null;
  function msgHead(x) {
    if (x.kind === 'revalue') return ['Přecenění', `${fmtM(x.from)} → ${fmtM(x.to)}`, x.to >= x.from ? 'up' : 'down'];
    if (x.kind === 'smart') return ['Smart money', `${x.amt > 0 ? '+' : '−'}${fmtM(Math.abs(x.amt))}`, x.amt > 0 ? 'up' : 'down'];
    if (x.kind === 'market') return ['Karta trhu', `${x.title || ''}${x.pct ? ` · ${spct(x.pct, 0)}` : ''}`, x.pct > 0 ? 'up' : x.pct < 0 ? 'down' : ''];
    if (x.kind === 'tranche') return ['Tranše od RainbowJet', `+${fmtM(x.amt)}`, 'up'];
    return ['Zpráva', '', ''];
  }
  function renderMsgs() {
    const m = me.msgs || [];
    const el = $('msgs');
    if (!m.length) { el.innerHTML = ''; return; }
    if (msgSeenTs === null) msgSeenTs = m[0].ts;
    if (m[0].ts > msgSeenTs) {
      const fresh = m.filter((x) => x.ts > msgSeenTs);
      msgSeenTs = m[0].ts;
      const [k, v] = msgHead(fresh[0]);
      toast(`<b>${esc(k)}</b>${v ? ' · ' + esc(v) : ''}`, 'msg');
      haptic.ok();
    }
    const shown = msgsOpen ? m : m.slice(0, 3);
    morph(el, `<div class="s-card p-card p-msgs">
      <div class="p-card-h"><h3 class="s-h3">${E('play.msgs.title')}</h3><span class="p-sub">${E('play.msgs.hint')}</span></div>
      ${shown.map((x) => {
        const [k, v, dir] = msgHead(x);
        const extra = x.kind === 'tranche' && x.cond ? `<div class="p-msg-t"><span class="s-faint">Podmínka:</span> ${esc(x.cond)}</div>` : '';
        return `<div class="p-msg" data-key="m${x.ts}"><div class="p-msg-h"><span class="s-badge ${x.kind === 'market' ? 's-warn' : x.kind === 'tranche' || x.kind === 'smart' ? 's-ok' : ''}">${esc(k)}</span><span class="s-faint p-msg-d">Blok ${x.block} · ${day(x.ts)}</span></div>
          ${v ? `<div class="p-msg-v ${dir ? 's-' + dir : ''}">${esc(v)}</div>` : ''}
          ${x.text ? `<div class="p-msg-t">${esc(x.text)}</div>` : ''}${extra}</div>`;
      }).join('')}
      ${m.length > 3 ? `<button type="button" class="p-more" data-act="msgs-toggle">${msgsOpen ? 'Skrýt starší' : `Starší zprávy (${m.length - 3})`}</button>` : ''}
    </div>`);
  }

  // ----- notes: they feed the discussion after each round -----
  let noteTimer = null, notesDraft = {};
  const NOTE_Q = { like: ['play.notes.like', 'play.notes.likePh'], doubt: ['play.notes.doubt', 'play.notes.doubtPh'] };
  function noteFields(t) {
    const n = notesDraft[t] || {};
    return ['like', 'doubt'].map((k) => `<label class="p-nk"><span>${E(NOTE_Q[k][0])}</span><textarea class="s-input note" data-n="${t}" data-k="${k}" rows="2" placeholder="${E(NOTE_Q[k][1])}">${esc(n[k] || '')}</textarea></label>`).join('');
  }
  const setSaved = (txt, cls = '') => document.querySelectorAll('.nsaved').forEach((e) => { e.textContent = txt; e.dataset.st = cls; });
  function wireNotes(root) {
    root.querySelectorAll('textarea.note').forEach((ta) => ta.addEventListener('input', () => {
      const t = ta.dataset.n, k = ta.dataset.k;
      (notesDraft[t] = notesDraft[t] || { like: '', doubt: '' })[k] = ta.value;
      document.querySelectorAll(`textarea.note[data-n="${t}"][data-k="${k}"]`).forEach((o) => { if (o !== ta) o.value = ta.value; });
      setSaved('Ukládám…', 'busy');
      clearTimeout(noteTimer);
      noteTimer = setTimeout(saveNotes, 1200);
    }));
  }
  function renderNotes() {
    const key = S.block + '|' + me.id + '|' + MUP.cv();
    const el = $('notes');
    if (key !== notesKey) {
      notesKey = key;
      notesDraft = {};
      for (const [t, n] of Object.entries(me.slip?.notes || {})) notesDraft[t] = typeof n === 'string' ? { like: n, doubt: '' } : { like: n.like || '', doubt: n.doubt || '' };
      el.innerHTML = `<div class="p-card-h"><h3 class="s-h3">${E('play.notes.title')}</h3></div><p class="p-hint">${E('play.notes.hint')}</p>` +
        S.teams.filter((t) => t.id !== me.team).map((t) => `<div class="p-nrow" data-nt="${t.id}" style="--tc:${esc(t.color)}"><div class="p-nrow-h">${dot(t.color)}<b>${esc(t.name)}</b><span class="s-badge p-now">Pitchuje</span></div>${noteFields(t.id)}</div>`).join('') +
        '<div class="p-saved nsaved" aria-live="polite"></div>';
      wireNotes(el);
    }
    el.querySelectorAll('.p-nrow').forEach((r) => r.classList.toggle('on', S.phase === 'pitch' && S.presenting === r.dataset.nt));
    // in the first investing round the notes sit inside the investing form
    el.classList.toggle('hidden', (S.phase === 'betting' && me.rules.mode === 'initial') || !!(feat('exit') && S.exit));
  }
  const collectNotes = () => {
    const n = {};
    for (const [t, v] of Object.entries(notesDraft)) if ((v.like || '').trim() || (v.doubt || '').trim()) n[t] = v;
    return n;
  };
  async function saveNotes() {
    const notes = collectNotes();
    const r = await send({ op: 'notes', sid, pin, notes });
    if (r.ok) rememberSlip({ ...(me.slip || {}), notes, ts: Date.now() });
    setSaved(r.ok ? 'Uloženo ✓' : r.error, r.ok ? 'ok' : 'err');
    if (!r.ok) { clearTimeout(noteTimer); noteTimer = setTimeout(saveNotes, 4000); }
  }

  // ---------- question board (switched off) ----------
  const BOARD_ON = false; // question board switched off for now (Block 2 uses "Swap the markets" instead)
  function renderBoard() { $('board').classList.add('hidden'); if (!BOARD_ON) return; }

  // ----- allocation -----
  function draftKey() { return `mup.draft.${me.id}.${S.block}`; }
  function loadDraft() {
    if (me.slip?.submitted) return { out: structuredClone(me.slip.out || {}), in: structuredClone(me.slip.in || {}) };
    try { const d = JSON.parse(localStorage.getItem(draftKey()) || 'null'); if (d) return d; } catch {}
    return { out: {}, in: {} };
  }
  const saveDraft = () => { try { localStorage.setItem(draftKey(), JSON.stringify(draft)); } catch {} };

  function sliderMax(kind, t) {
    const R = me.rules;
    if (R.mode === 'initial') return R.capital;
    if (kind === 'out') return Math.max(STEP, Math.min(me.stakes[t] || 0, R.cashoutMax));
    return Math.max(STEP, R.cashoutMax);
  }

  function rowHTML(kind, t, e, extra = '', withNotes = false) {
    const max = sliderMax(kind, t.id);
    return `<div class="arow ${e.amt ? 'has' : ''}" data-k="${kind}" data-t="${t.id}" style="--tc:${esc(t.color)}">
      <div class="ahead"><span class="s-dot" style="background:${esc(t.color)}"></span><span class="an"><b>${esc(t.name)}</b>${extra}</span>
        <label class="amtwrap"><input class="amt s-num" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" value="${plain(e.amt || 0)}" aria-label="${kind === 'out' ? 'Vybrat z' : 'Vložit do'} ${esc(t.name)}, částka v dolarech"><span>$</span></label></div>
      <div class="p-cap" aria-live="polite"></div>
      <input type="range" class="p-range" min="0" max="${max}" step="${STEP}" value="${Math.min(e.amt || 0, max)}" aria-label="Posuvník částky ${esc(t.name)}">
      <div class="qbtns"><button type="button" data-q="0">0</button><button type="button" data-q="-50000">−50 tis.</button><button type="button" data-q="50000">+50 tis.</button><button type="button" data-q="rest">+ zbytek</button></div>
      <textarea class="s-input why" rows="2" placeholder="${kind === 'out' ? E('play.form.whyOut') : E('play.form.whyIn')} (nepovinné)">${esc(e.why || '')}</textarea>
      ${withNotes ? `<div class="rnotes">${noteFields(t.id)}</div>` : ''}
    </div>`;
  }

  let dockBuilt = false;
  function buildForm() {
    const R = me.rules;
    const others = S.teams.filter((t) => t.id !== me.team);
    draft = loadDraft();
    let html = '';
    if (R.mode === 'initial') {
      html = `<div class="s-card p-card p-form"><div class="s-label">Blok ${S.block} · první investice</div><h2 class="p-form-t">${E('play.form.initTitle', { capital: fmt(R.capital) })}</h2>
        <p class="p-hint">${E('play.form.initHint')}</p>
        <div id="done"></div>
        ${others.map((t) => rowHTML('in', t, draft.in[t.id] || {}, '', true)).join('')}
        <div class="p-saved nsaved" aria-live="polite"></div></div>`;
    } else {
      const held = others.filter((t) => (me.stakes[t.id] || 0) > 0);
      html = `<div class="s-card p-card p-form"><div class="s-label">Blok ${S.block} · přesun</div><h2 class="p-form-t">${E('play.form.rebTitle')}</h2>
        <p class="p-hint">${E('play.form.rebHint', { max: fmt(R.cashoutMax) })}</p>
        <div id="done"></div>
        <div class="p-sec"><span class="p-step">1</span><span class="s-label">${E('play.form.outLabel')}</span><span class="p-sec-v s-num" id="outsum"></span></div>
        ${held.length ? held.map((t) => rowHTML('out', t, draft.out[t.id] || {}, ` <span class="have">máš ${esc(fmtM(me.stakes[t.id]))}</span>`)).join('') : '<p class="p-hint">Nemáš z čeho vybírat.</p>'}
        <div class="p-sec"><span class="p-step">2</span><span class="s-label">${E('play.form.inLabel')}</span><span class="p-sec-v s-num" id="insum"></span></div>
        ${others.map((t) => rowHTML('in', t, draft.in[t.id] || {})).join('')}
      </div>`;
    }
    $('main').innerHTML = html;
    $('dock').innerHTML = `<div class="p-dock-in">
        <div class="p-sum" id="sum"></div>
        <div class="p-dock-row"><div class="p-ferr" id="ferr" role="alert"></div></div>
        <div class="p-dock-btns">${R.mode !== 'initial' && !R.exact ? `<button type="button" class="s-btn s-ghost" id="hold">${E('play.form.hold')}</button>` : ''}<button type="button" class="s-btn s-primary p-go" id="go">${R.mode === 'initial' ? E('play.form.go') : E('play.form.confirm')}</button></div>
      </div>`;
    dockBuilt = true;
    $('main').querySelectorAll('.arow').forEach(wireRow);
    wireNotes($('main'));
    $('go').onclick = () => submit(false);
    if ($('hold')) $('hold').onclick = () => submit(true);
    updateForm();
  }

  function limitFor(kind, t) {
    const R = me.rules;
    const cur = draft[kind][t]?.amt || 0;
    if (R.mode === 'initial') return cur + (R.capital - sumOf(draft.in));
    if (kind === 'out') return Math.min(me.stakes[t] || 0, cur + (R.cashoutMax - sumOf(draft.out)));
    return cur + (sumOf(draft.out) - sumOf(draft.in));
  }

  function setAmt(kind, t, v, typed) {
    const lim = Math.max(0, limitFor(kind, t));
    const want = Math.max(0, Math.round(v));
    v = Math.min(want, lim);
    const row = $('main').querySelector(`.arow[data-k="${kind}"][data-t="${t}"]`);
    if (row) {
      const cap = row.querySelector('.p-cap');
      const over = typed && want > lim;
      cap.textContent = over ? (lim > 0 ? `Víc tu teď nejde – nejvýš ${fmt(lim)}.` : kind === 'in' && me.rules.mode !== 'initial' ? 'Nejdřív vyber peníze z jiného týmu.' : 'Víc už rozdělit nejde.') : '';
      row.classList.toggle('over', !!over);
    }
    const e = draft[kind][t] || (draft[kind][t] = { amt: 0, why: '' });
    e.amt = v;
    if (kind === 'out' && v > 0 && draft.in[t]) { delete draft.in[t]; const r = $('main').querySelector(`.arow[data-k="in"][data-t="${t}"]`); if (r) syncRow(r); }
    saveDraft();
    updateForm();
  }

  function syncRow(row) {
    const kind = row.dataset.k, t = row.dataset.t, e = draft[kind][t] || { amt: 0, why: '' };
    const inp = row.querySelector('.amt');
    if (document.activeElement !== inp) inp.value = plain(e.amt);
    const rng = row.querySelector('input[type=range]');
    rng.value = e.amt;
    rng.style.setProperty('--pct', Math.min(100, (e.amt / (+rng.max || 1)) * 100) + '%');
    const why = row.querySelector('.why');
    if (document.activeElement !== why && why.value !== (e.why || '')) why.value = e.why || '';
    row.classList.toggle('has', e.amt > 0);
  }

  function wireRow(row) {
    const kind = row.dataset.k, t = row.dataset.t;
    const rng = row.querySelector('input[type=range]'), inp = row.querySelector('.amt'), why = row.querySelector('.why');
    rng.addEventListener('input', () => setAmt(kind, t, +rng.value));
    rng.addEventListener('change', () => haptic.tap());
    inp.addEventListener('focus', () => {
      inp.dataset.prev = draft[kind][t]?.amt || 0;
      inp.placeholder = plain(+inp.dataset.prev);
      inp.value = '';
      row.classList.add('typing');
    });
    inp.addEventListener('input', () => { if (inp.value.trim() !== '') setAmt(kind, t, parseAmt(inp.value), true); });
    inp.addEventListener('blur', () => {
      if (inp.value.trim() === '') setAmt(kind, t, +inp.dataset.prev || 0);
      inp.placeholder = '0';
      row.classList.remove('typing', 'over');
      row.querySelector('.p-cap').textContent = '';
      syncRow(row);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { inp.value = ''; inp.blur(); }
      if (e.key === 'Enter') inp.blur();
    });
    why.addEventListener('input', () => {
      (draft[kind][t] || (draft[kind][t] = { amt: 0, why: '' })).why = why.value;
      saveDraft();
      updateForm();
      autosaveWhy();
    });
    row.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => {
      haptic.tap();
      const cur = draft[kind][t]?.amt || 0, q = b.dataset.q;
      setAmt(kind, t, q === 'rest' ? limitFor(kind, t) : q === '0' ? 0 : cur + Number(q));
    }));
  }

  // after submitting, reasons typed into the form are saved on their own (amounts unchanged)
  let whyT = null;
  function autosaveWhy() {
    const s = me.slip;
    if (!s?.submitted || !sameAsSlip()) return;
    clearTimeout(whyT);
    whyT = setTimeout(async () => {
      const body = { op: 'reasons', sid, pin, in: {}, out: {} };
      for (const k of ['in', 'out']) for (const [t, e] of Object.entries(draft[k])) if (e.amt > 0) body[k][t] = e.why || '';
      const r = await send(body);
      if (r.ok) {
        for (const k of ['in', 'out']) for (const [t, w] of Object.entries(body[k])) if (s[k]?.[t]) s[k][t].why = w;
        s.ts = Date.now(); rememberSlip(s);
      }
      setSaved(r.ok ? 'Důvody uloženy ✓' : r.error, r.ok ? 'ok' : 'err');
    }, 1000);
  }

  const amtsOf = (m) => JSON.stringify(Object.entries(m || {}).filter(([, e]) => e.amt > 0).map(([t, e]) => [t, e.amt]).sort());
  const sameAsSlip = () => !!me.slip?.submitted && amtsOf(me.slip.in) === amtsOf(draft.in) && amtsOf(me.slip.out) === amtsOf(draft.out);

  function clientErrors() {
    const R = me.rules, errs = [];
    const inT = sumOf(draft.in), outT = sumOf(draft.out);
    if (R.mode === 'initial' && inT !== R.capital) errs.unshift(`Zbývá rozdělit ${fmt(R.capital - inT)}.`);
    if (R.mode !== 'initial' && inT !== outT) errs.unshift(inT < outT ? `Zbývá vložit ${fmt(outT - inT)}.` : 'Vkládáš víc, než vybíráš.');
    if (R.mode !== 'initial' && R.exact && outT !== R.cashoutMax) errs.unshift(`Vyber ještě ${fmt(R.cashoutMax - outT)}.`);
    if (R.mode !== 'initial' && !R.exact && outT === 0) errs.unshift('Nejdřív vyber, z čeho bereš.');
    return errs;
  }

  let sending = false;
  function updateForm() {
    if (!$('sum') || !draft) return;
    $('main').querySelectorAll('.arow').forEach((row) => {
      syncRow(row);
      if (row.dataset.k === 'in') row.classList.toggle('off', !!(draft.out[row.dataset.t]?.amt));
    });
    const R = me.rules, inT = sumOf(draft.in), outT = sumOf(draft.out);
    const errs = clientErrors();
    const bar = (v, max, cls = '') => `<div class="s-progress p-prog ${cls}"><i style="width:${Math.min(100, max ? (v / max) * 100 : 0)}%"></i></div>`;
    let html;
    if (R.mode === 'initial') {
      html = `<div class="p-sum-l"><span>Rozděleno <b class="s-num">${esc(fmt(inT))}</b> z ${esc(fmt(R.capital))}</span></div>${bar(inT, R.capital, inT === R.capital ? 'full' : '')}`;
    } else {
      const max = R.cashoutMax;
      html = `<div class="p-sum-l"><span>Vybráno <b class="s-num">${esc(fmt(outT))}</b>${R.exact ? ' z ' + esc(fmt(max)) : ''}</span><span>vloženo <b class="s-num">${esc(fmt(inT))}</b></span></div>
        <div class="p-bars">${bar(outT, max, outT === max ? 'full' : '')}${bar(inT, max, 'in' + (inT === outT && outT ? ' full' : ''))}</div>`;
      if ($('outsum')) $('outsum').textContent = `${fmt(outT)}${R.exact ? ' / ' + fmt(max) : ''}`;
      if ($('insum')) $('insum').textContent = `${fmt(inT)} / ${fmt(outT)}`;
    }
    morph($('sum'), html);
    $('sum').classList.toggle('good', !errs.length);
    const go = $('go');
    const same = sameAsSlip();
    const blocked = errs.length > 0 || same;
    go.dataset.blocked = blocked ? '1' : '';
    go.classList.toggle('p-dim', blocked && !sending);
    go.classList.toggle('p-sent', same && !sending);
    go.classList.toggle('p-busy', sending);
    go.textContent = sending ? 'Odesílám…' : same ? 'Odesláno ✓' : me.slip?.submitted ? 'Odeslat změnu' : R.mode === 'initial' ? tx('play.form.go') : tx('play.form.confirm');
    const ferr = $('ferr');
    if (!ferr.dataset.sticky) { ferr.textContent = errs.length ? errs[0] : ''; ferr.dataset.st = errs.length ? 'hint' : ''; }
    const sub = me.slip?.submitted;
    morph($('done'), sub ? `<div class="p-done">${same ? E('play.form.invested') : 'Máš rozpracovanou změnu. Platí odeslaná verze, dokud ji neodešleš znovu.'}</div>` : '');
  }

  function formErr(msg) {
    const f = $('ferr');
    f.textContent = msg; f.dataset.st = 'err'; f.dataset.sticky = '1';
    shake(f);
    haptic.err();
    clearTimeout(formErr.t);
    formErr.t = setTimeout(() => { delete f.dataset.sticky; updateForm(); }, 3500);
  }

  async function submit(hold) {
    if (sending) return;
    if (!hold) {
      if (sameAsSlip()) { haptic.tap(); toast('Tohle už máš odeslané ✓'); return; }
      const errs = clientErrors();
      if (errs.length) { formErr(errs[0]); return; }
    }
    const body = { op: 'submit', sid, pin, notes: collectNotes(), out: hold ? {} : draft.out, in: hold ? {} : draft.in };
    const prev = me.slip;
    // optimistic: the slip counts as sent right away, rolled back if the server says no
    sending = true;
    me.slip = { ...(me.slip || {}), out: structuredClone(body.out), in: structuredClone(body.in), notes: body.notes, submitted: true, ts: Date.now() };
    updateForm();
    const r = await send(body);
    sending = false;
    if (!r.ok) {
      me.slip = prev;
      updateForm();
      formErr(r.error || 'Nepodařilo se odeslat.');
      return;
    }
    rememberSlip(me.slip);
    if (hold) { draft = { out: {}, in: {} }; $('main').querySelectorAll('.arow').forEach(syncRow); }
    delete $('ferr').dataset.sticky;
    updateForm();
    haptic.ok();
    toast(hold ? 'Nic neměníš ✓' : 'Investováno ✓ Do uzavření to můžeš ještě změnit.', 'ok');
    renderDots();
  }

  function renderSummary() {
    const s = me.slip;
    let html = '';
    if (s?.submitted && (Object.keys(s.in || {}).length || Object.keys(s.out || {}).length)) {
      const line = (k, t, e) => `<div class="p-slip" style="--tc:${esc(team(t).color)}"><div class="p-slip-h"><span class="s-badge ${k === 'out' ? 's-bad' : 's-ok'}">${k === 'out' ? 'Výběr' : 'Vklad'}</span>${teamTag(t)}<b class="s-num">${esc(fmt(e.amt))}</b></div>
        <textarea class="s-input rwhy" rows="2" data-rk="${k}" data-rt="${t}" placeholder="${k === 'out' ? E('play.form.whyOut') : E('play.form.whyIn')} (nepovinné)">${esc(e.why || '')}</textarea></div>`;
      html = `<div class="s-card p-card"><div class="p-card-h"><h3 class="s-h3">Tvoje rozhodnutí v bloku ${S.block}</h3><span class="s-badge s-ok">Odesláno</span></div><p class="p-hint">Částky už jsou dané, důvody můžeš ještě doplnit nebo opravit.</p>` +
        Object.entries(s.out || {}).map(([t, e]) => line('out', t, e)).join('') +
        Object.entries(s.in || {}).map(([t, e]) => line('in', t, e)).join('') + '<div class="p-saved rsaved" aria-live="polite"></div></div>';
    } else if (S.phase === 'lobby' || S.phase === 'pitch') {
      const R = me.rules;
      html = `<div class="s-card p-card p-wait"><div class="p-wait-ic">${R.mode === 'initial' ? '$' : '⇄'}</div><div><h3 class="s-h3">${R.mode === 'initial' ? E('play.wait.initTitle', { capital: fmt(R.capital) }) : E('play.wait.rebTitle')}</h3>
        <p class="p-hint">${R.mode === 'initial' ? E('play.wait.initHint') : E('play.wait.rebHint', { max: fmt(R.cashoutMax) })}</p></div></div>`;
    } else if (['closed', 'showdown', 'rj'].includes(S.phase)) {
      html = `<div class="s-card p-card p-wait p-wait-dim"><div class="p-wait-ic">–</div><div><h3 class="s-h3">${s?.submitted ? 'V tomto bloku nic neměníš' : 'V tomto bloku jsi nic neodeslal(a)'}</h3><p class="p-hint">Tvoje investice zůstávají, jak byly.</p></div></div>`;
    }
    $('main').innerHTML = html;
    let rt = null;
    $('main').querySelectorAll('.rwhy').forEach((ta) => ta.addEventListener('input', () => {
      const e = me.slip?.[ta.dataset.rk]?.[ta.dataset.rt];
      if (e) e.why = ta.value;
      const sv = $('main').querySelector('.rsaved');
      sv.textContent = 'Ukládám…'; sv.dataset.st = 'busy';
      clearTimeout(rt);
      rt = setTimeout(async () => {
        const body = { op: 'reasons', sid, pin, in: {}, out: {} };
        $('main').querySelectorAll('.rwhy').forEach((x) => { body[x.dataset.rk][x.dataset.rt] = x.value; });
        const r = await send(body);
        if (r.ok && me.slip) rememberSlip({ ...me.slip, ts: Date.now() });
        const el = $('main').querySelector('.rsaved');
        if (el) { el.textContent = r.ok ? 'Uloženo ✓' : r.error; el.dataset.st = r.ok ? 'ok' : 'err'; }
      }, 1000);
    }));
  }

  function renderMain() {
    const amounts = JSON.stringify([me.slip?.submitted, Object.entries(me.slip?.in || {}).map(([t, e]) => [t, e.amt]), Object.entries(me.slip?.out || {}).map(([t, e]) => [t, e.amt])]);
    const key = S.phase === 'betting'
      ? `${S.block}|bet|${me.rules.mode}|${me.id}|${MUP.cv()}`
      : `${S.block}|view|${S.phase}|${me.rules.mode}|${me.id}|${MUP.cv()}|${amounts}|${feat('exit') && S.exit ? 'x' : ''}`;
    if (key === formKey) return;
    // never rebuild while someone is typing a reason into the summary (it rebuilds after they leave the field)
    const a = document.activeElement;
    if (a && $('main').contains(a) && a.classList.contains('rwhy')) return;
    formKey = key;
    if (S.phase === 'betting') buildForm();
    else { dockBuilt = false; $('dock').innerHTML = ''; draft = null; if (feat('exit') && S.exit) $('main').innerHTML = ''; else renderSummary(); }
  }

  function renderDock() {
    const show = !!(dockBuilt && S.phase === 'betting' && view === 'invest' && !kbOpen);
    $('dock').classList.toggle('hidden', !show);
    document.body.classList.toggle('p-hasdock', show);
  }
  // hide the sticky bar while the on-screen keyboard is up
  let kbOpen = false;
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const chk = () => { const o = vv.height < window.innerHeight * 0.72; if (o !== kbOpen) { kbOpen = o; document.body.classList.toggle('p-kb', o); if (me && S) renderDock(); } };
    vv.addEventListener('resize', chk);
  }

  // ---------- portfolio + stonks ----------
  function sparkHTML() {
    const raw = me.series.map(([ts, v]) => ({ ts, v }));
    raw.push({ ts: MUP.now(), v: PF() });
    const days = [];
    for (const p of raw) {
      const key = new Date(p.ts).toDateString(), last = days[days.length - 1];
      if (last && last.key === key) { last.v = p.v; last.ts = p.ts; } else days.push({ key, ...p });
    }
    let pts0 = days.length >= 2 ? days : raw;
    if (pts0.length < 2) pts0 = [pts0[0], pts0[0]];
    const W = 320, Hh = 168, pad = 10, padL = 112, padT = 92;
    const vals = pts0.map((p) => p.v).concat(me.start);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 40000) { const m = (hi + lo) / 2; lo = m - 20000; hi = m + 20000; }
    const x = (i) => padL + (i * (W - padL - pad)) / (pts0.length - 1);
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (Hh - padT - pad);
    const up = PF() >= me.start, col = up ? '#3FCF8E' : '#FF5C6C';
    const line = pts0.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const base = y(me.start).toFixed(1);
    const lx = x(pts0.length - 1).toFixed(1), ly = y(pts0[pts0.length - 1].v).toFixed(1);
    return [`<svg class="p-spark" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-label="Vývoj portfolia">
        <defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".38"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
        <polygon points="${x(0)},${Hh} ${line} ${x(pts0.length - 1)},${Hh}" fill="url(#sg)"/>
        <line x1="${padL}" x2="${W}" y1="${base}" y2="${base}" stroke="rgba(184,190,214,.45)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
        <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg><span class="p-spark-end" style="left:${(lx / W) * 100}%;top:${(ly / Hh) * 100}%;background:${col}"></span>`,
    `<div class="p-sparkx"><span>${esc(day(pts0[0].ts))}</span><span>čárkovaně: vklad ${esc(fmtM(me.start))}</span><span>dnes</span></div>`];
  }

  function renderPortfolio() {
    const others = S.teams.filter((t) => t.id !== me.team);
    let head;
    if (INV()) {
      const pl = PF() - me.start, p = (pl / me.start) * 100, up = pl >= 0;
      const [svg, labels] = sparkHTML();
      head = `<div class="s-card p-card p-pfcard"><div class="p-pfpanel ${up ? 'up' : 'down'}">${svg}
          <img class="p-man" src="/img/${up ? 'stonks' : 'not-stonks'}-cut.webp" alt="${up ? 'stonks' : 'not stonks'}" width="130" height="168">
          <div class="p-pfnums"><div class="s-label">${E('play.pf.title')}</div><div class="p-pfbig s-num">${tw('pfbig', PF(), 'F')}</div>
          <div class="p-pl ${up ? 's-up' : 's-down'}">${up ? '+' : '−'}${esc(fmt(Math.abs(pl)))} · ${esc(spct(p))}</div></div></div>${labels}</div>`;
    } else {
      head = `<div class="s-card p-card p-empty"><div class="s-label">${E('play.pf.title')}</div><h3 class="s-h3">${E('play.pf.empty')}</h3><p class="p-hint">Až investuješ, uvidíš tady, jak se tvým startupům daří.</p></div>`;
    }
    const total = PF() || 1;
    const rows = others.map((t) => {
      const v = SK(t.id);
      const own = Vn(t) ? (v / Vn(t)) * 100 : 0;
      return `<div class="p-hold ${v ? '' : 'none'}" data-key="h${t.id}" style="--tc:${esc(t.color)}">
        <div class="p-hold-h">${dot(t.color)}<b>${esc(t.name)}</b><span class="p-hold-v s-num">${v ? tw('hv' + t.id, v, 'F') : '—'}</span></div>
        <div class="p-hold-bar"><i style="width:${v ? Math.max(2, (v / total) * 100) : 0}%"></i></div>
        <div class="p-hold-s s-faint">ocenění ${tw('hV' + t.id, Vn(t))}${multChip(t)}${v ? ` · vlastníš ${esc(pct(own, 2))}` : ''}</div></div>`;
    }).join('');
    const tr = feat('track') && me.track;
    const trackHTML = tr ? `<div class="p-stats">
        <div class="s-stat p-stat"><span class="s-label">Návratnost</span><span class="s-v ${RET(tr) >= 0 ? 's-up' : 's-down'}">${esc(spct(RET(tr)))}</span></div>
        <div class="s-stat p-stat"><span class="s-label">Pořadí</span><span class="s-v">${(me.rankNow ?? tr.rank) ? esc((me.rankNow ?? tr.rank) + '.') : '–'}<small> z ${esc(tr.of || S.playerCount)}</small></span></div>
      </div>` : '';
    morph($('portfolio'), head + trackHTML + `<div class="s-card p-card"><div class="p-card-h"><h3 class="s-h3">Podíly ve startupech</h3><span class="s-label">${others.filter((t) => SK(t.id) > 0).length} z ${others.length}</span></div>${rows}</div>`);
  }

  // ----- cap table of my own team -----
  function renderCap() {
    const c = feat('captable') ? me.myTeamCap : null;
    const el = $('captable');
    if (!c) { el.innerHTML = ''; return; }
    const t = team(me.team);
    const f = +c.founders || 0, cl = +c.cls || 0, rj = +c.rj || 0, other = Math.max(0, 100 - f - cl - rj);
    const seg = (v, cls, label) => (v > 0.05 ? `<i class="${cls}" style="width:${v}%" title="${esc(label)}"></i>` : '');
    const hist = (c.history || []).filter((h) => h && h.founders != null);
    let chart = '';
    if (hist.length >= 2) {
      const W = 300, H = 90, pl = 4, pr = 4, pt = 10, pb = 18;
      const x = (i) => pl + (i * (W - pl - pr)) / (hist.length - 1);
      const lo = Math.max(0, Math.floor((Math.min(...hist.map((h) => h.founders)) - 8) / 10) * 10);
      const y = (v) => pt + (1 - (v - lo) / (100 - lo || 1)) * (H - pt - pb);
      const line = hist.map((h, i) => `${x(i).toFixed(1)},${y(h.founders).toFixed(1)}`).join(' ');
      chart = `<svg class="p-dil" viewBox="0 0 ${W} ${H}" aria-label="Ředění zakladatelů">
        <polyline points="${line}" fill="none" stroke="url(#dg)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        <defs><linearGradient id="dg" x1="0" x2="1"><stop offset="0" stop-color="#3586D1"/><stop offset=".5" stop-color="#6754DF"/><stop offset="1" stop-color="#FF5574"/></linearGradient></defs>
        ${hist.map((h, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(h.founders).toFixed(1)}" r="3" fill="#F4F5FA"/>`).join('')}
      </svg>`;
    }
    morph(el, `<div class="s-card p-card p-cap-card" style="--tc:${esc(t.color)}">
      <div class="p-card-h"><h3 class="s-h3">Cap table · ${esc(t.name)}</h3><span class="s-label">${esc(num(c.investors || 0))} ${c.investors === 1 ? 'investor' : c.investors >= 2 && c.investors <= 4 ? 'investoři' : 'investorů'}</span></div>
      <div class="p-captbar">${seg(f, 'f', 'Zakladatelé')}${seg(cl, 'c', 'Třída')}${seg(rj, 'r', 'RainbowJet')}${seg(other, 'o', 'Ostatní')}</div>
      <div class="p-caplg">
        <span><i class="f"></i>Zakladatelé <b class="s-num">${esc(pct(f))}</b></span>
        <span><i class="c"></i>Třída <b class="s-num">${esc(pct(cl))}</b></span>
        <span><i class="r"></i>RainbowJet <b class="s-num">${esc(pct(rj))}</b></span>
      </div>
      ${hist.length ? `<div class="p-dilh"><span class="s-label">Ředění zakladatelů</span></div>${chart}
        <div class="p-dil-list">${hist.slice(-6).map((h, i, a) => { const prev = i ? a[i - 1].founders : null; const d = prev == null ? null : h.founders - prev; return `<div class="p-dil-row" data-key="d${esc(h.label)}${i}"><span>${esc(h.label)}</span><b class="s-num">${esc(pct(h.founders))}</b><span class="p-dil-d ${d < 0 ? 's-down' : 's-faint'}">${d == null ? '' : d === 0 ? '±0' : esc(spct(d))}</span></div>`; }).join('')}</div>` : ''}
    </div>`);
  }

  // ---------- startups ----------
  const DRIVER = { class: 'Peníze třídy', rj: 'RainbowJet', revalue: 'Přecenění', round: 'Kolo', market: 'Trh', exit: 'Exit', demand: 'Poptávka' };
  const ROUND = { up: 'Up round', down: 'Down round', flat: 'Flat round' };
  const EXITK = { acquired: 'Akvizice', ipo: 'IPO', hold: 'Bez exitu', writeoff: 'Odpis' };
  function renderStartups() {
    const cards = feat('cards') ? S.cards || {} : null;
    const defs = (S.milestoneDefs || []).filter((d) => !d.block || d.block <= S.block);
    const flipped = feat('market') ? (S.market?.flipped || []) : [];
    const market = flipped.length ? `<div class="p-sec-h"><span class="s-label">Karty trhu</span><span class="s-faint">${flipped.length}</span></div>
      <div class="p-mkts">${flipped.slice().reverse().map((c) => `<div class="p-mkt" data-key="k${esc(c.id)}"><div class="s-label">Blok ${esc(c.block)}</div><b class="p-mkt-t">${esc(c.title)}</b><p>${esc(c.text)}</p>
        <div class="p-mkt-fx">${Object.entries(c.effects || {}).filter(([, v]) => v).map(([t, v]) => `<span class="p-fx ${v > 0 ? 's-up' : 's-down'}">${dot(team(t).color)}${esc(team(t).name)} ${esc(spct(v, 0))}</span>`).join('')}</div></div>`).join('')}</div>` : '';
    const tr = feat('tranches') ? S.tranches || [] : [];
    const list = S.teams.map((t) => {
      const c = cards?.[t.id] || {};
      const r = feat('rounds') ? S.rounds?.[t.id] : null;
      const dr = feat('drivers') ? (S.drivers?.[t.id] || []).slice(0, 3) : [];
      const mine = SK(t.id);
      const ms = cards ? defs.map((d) => `<span class="p-ms ${c.milestones?.[d.key] ? 'done' : ''}" data-key="ms${esc(d.key)}">${c.milestones?.[d.key] ? '✓' : '○'} ${esc(d.label)}</span>`).join('') : '';
      const locked = tr.filter((x) => x.team === t.id && x.status === 'locked');
      // own team: the live founders % from myTeam, so Startupy matches the Tým header while trades are pending
      const capF = feat('captable') && t.cap ? (t.id === me.team && me.myTeam?.founders != null ? me.myTeam.founders : t.cap.founders) : null;
      return `<article class="s-card p-card p-su ${t.id === me.team ? 'mine' : ''}" data-key="su${t.id}" style="--tc:${esc(t.color)}">
        <div class="p-su-h"><span class="p-su-ic">${esc(initials(t.name))}</span><div class="p-su-n"><b>${esc(t.name)}</b>${t.id === me.team ? '<span class="s-badge">Tvůj tým</span>' : ''}</div>
          <div class="p-su-v">${tw('suV' + t.id, Vn(t))}${multChip(t, true)}${r && r.kind && r.kind !== 'flat' ? `<span class="s-badge ${r.kind === 'up' ? 's-ok' : r.kind === 'down' ? 's-bad' : ''}">${esc(ROUND[r.kind] || '')}${r.pct ? ' ' + esc(spct(r.pct)) : ''}</span>` : '<span class="s-label">ocenění</span>'}</div></div>
        ${c.oneLiner ? `<p class="p-su-one">${esc(c.oneLiner)}</p>` : cards ? '<p class="p-su-one s-faint">Tým zatím nenapsal one-liner.</p>' : ''}
        ${c.sub ? `<p class="p-su-sub">${esc(c.sub)}</p>` : ''}
        ${ms ? `<div class="p-mss">${ms}</div>` : ''}
        ${mine || capF != null ? `<div class="p-su-meta">${mine ? `<span>Tvůj podíl <b>${tw('suS' + t.id, mine)}</b></span>` : ''}${capF != null ? `<span>Zakladatelé <b class="s-num">${esc(pct(capF))}</b></span>` : ''}</div>` : ''}
        ${locked.length ? `<div class="p-trs">${locked.map((x) => `<span class="p-tr" data-key="tr${esc(x.id)}"><b>${esc(fmtM(x.amt))}</b> čeká na: ${esc(x.cond)}</span>`).join('')}</div>` : ''}
        ${dr.length ? `<div class="p-drs"><span class="s-label">Co hýbalo oceněním</span>${dr.map((d, i) => `<div class="p-dr" data-key="dr${d.ts}${i}"><span class="p-dr-k">${esc(DRIVER[d.kind] || d.kind)}</span><span class="p-dr-n">${esc(d.note || '')}</span><b class="s-num ${d.delta > 0 ? 's-up' : d.delta < 0 ? 's-down' : ''}">${esc(smoney(d.delta))}</b></div>`).join('')}</div>` : ''}
      </article>`;
    }).join('');
    morph($('startups'), market + list);
  }

  // ---------- Tým: live team header, valuation chart, investors, team wall ----------
  // the share price move this block in %, i.e. what the investors' money did (demand multiple − 1): „▲ 63 %“
  const movePct = (m) => { const p = Math.abs((m - 1) * 100); return pct(p, p < 10 ? 1 : 0); };
  function multChip(t, block) {
    const m = t.mult;
    if (m == null || m === 1 || !pendingLive()) return '';
    return `${block ? '' : ' '}<span class="p-mx ${m > 1 ? 's-up' : 's-down'}">${m > 1 ? '▲' : '▼'}${NB}${esc(movePct(m))}</span>`;
  }
  function valChart(hist) {
    const pts = hist.filter((h) => h && h.V != null);
    if (pts.length < 2) return '';
    const W = 320, H = 96, pl = 4, pr = 8, pt = 10, pb = 8;
    const vals = pts.map((h) => h.V);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1) { lo -= 1; hi += 1; }
    const x = (i) => pl + (i * (W - pl - pr)) / (pts.length - 1);
    const y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    const up = vals[vals.length - 1] >= vals[0], col = up ? '#3FCF8E' : '#FF5C6C';
    const line = pts.map((h, i) => `${x(i).toFixed(1)},${y(h.V).toFixed(1)}`).join(' ');
    const last = pts.length - 1;
    return `<svg class="p-vch" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Vývoj ocenění">
      <defs><linearGradient id="vg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".32"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <polygon points="${x(0)},${H} ${line} ${x(last)},${H}" fill="url(#vg)"/>
      <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg><div class="p-vchx"><span>${esc(pts[0].label || '')}</span><span>${esc(pts[last].label || '')}</span></div>`;
  }
  const whyOpen = new Set();
  function whyHTML(key, label, text) {
    if (!text) return '';
    const long = text.length > 90, open = whyOpen.has(key);
    return `<div class="p-iv-w" ${long ? `data-why="${esc(key)}" role="button" tabindex="0" aria-expanded="${open}"` : ''}><p class="p-iv-why ${long && !open ? 'clamp' : ''}">${label ? `<span class="s-label">${esc(label)}</span> ` : ''}„${esc(text)}“</p>${long ? `<span class="p-iv-more">${open ? 'méně' : 'celé zdůvodnění'}</span>` : ''}</div>`;
  }
  function investorWord(n) { return n === 1 ? 'investor' : n >= 2 && n <= 4 ? 'investoři' : 'investorů'; }
  function renderTeam() {
    const el = $('teamv');
    const m = me.myTeam || null;
    const t = team(me.team);
    const ranked = S.teams.slice().sort((a, b) => Vn(b) - Vn(a));
    const Vnow = m?.Vnow ?? Vn(t);
    const rank = m?.rank ?? t.rank ?? ranked.findIndex((x) => x.id === t.id) + 1;
    const of = m?.of ?? S.teams.length;
    const founders = m?.founders ?? me.myTeamCap?.founders ?? t.cap?.founders;
    const invN = m?.investorsNow ?? me.myTeamCap?.investors ?? t.cap?.investors;
    const mx = m?.mult ?? t.mult;
    const live = pendingLive();
    const mxs = live ? mx : (m?.flows || []).filter((f) => f.settled && f.mult != null).sort((a, b) => b.block - a.block)[0]?.mult;
    const mvP = mxs != null && Math.abs(mxs - 1) > 0.0005 ? (mxs - 1) * 100 : null; // share price move, not the valuation incl. new money
    const fl0 = (m?.flows || []).slice().sort((a, b) => b.block - a.block)[0];
    const net = fl0 ? (fl0.totalIn || 0) - (fl0.totalOut || 0) : null;
    let h = `<div class="s-card p-card p-tm" style="--tc:${esc(t.color)}">
      <div class="p-tm-h"><span class="p-su-ic">${esc(initials(t.name))}</span><div class="p-tm-n"><div class="s-label">Tvůj tým</div><h2 class="s-h2">${esc(m?.name || t.name)}</h2></div>
        ${rank ? `<span class="p-tm-rank"><b class="s-num">#${esc(rank)}</b><small> z${NB}${esc(of)}</small></span>` : ''}</div>
      <div class="p-tm-v"><span class="p-tm-big">${tw('tmV', Vnow)}</span>${mvP != null ? `<span class="p-tm-chg ${mvP > 0 ? 's-up' : 's-down'}" title="Změna ceny podílu v${NB}bloku">${mvP > 0 ? '▲' : '▼'}${NB}${esc(movePct(mxs))}</span>` : ''}</div>
      <div class="p-tm-sub">${live ? '<span class="p-lv"><i></i>živě</span><span>ocenění po tomto bloku, jak to teď vypadá</span>' : '<span>ocenění</span>'}</div>
      <div class="p-stats p-stats-3">
        <div class="s-stat p-stat"><span class="s-label">Zakladatelé</span><span class="s-v">${founders != null ? esc(pct(founders)) : '–'}</span></div>
        <div class="s-stat p-stat"><span class="s-label">Investoři</span><span class="s-v">${invN != null ? esc(num(invN)) : '–'}</span></div>
        <div class="s-stat p-stat"><span class="s-label">${live ? 'Peníze teď' : 'Peníze v\u00a0bloku'}</span><span class="s-v ${net > 0 ? 's-up' : net < 0 ? 's-down' : ''}">${net ? (net > 0 ? '+' : '−') + esc(fmtM(Math.abs(net))) : '–'}</span></div>
      </div>
      ${m?.history ? valChart(m.history) : ''}
    </div>`;
    const flows = (m?.flows || []).slice().sort((a, b) => b.block - a.block);
    if (m && flows.length) {
      h += `<div class="s-card p-card p-invs"><div class="p-card-h"><h3 class="s-h3">Investoři</h3><span class="s-label">${invN != null ? `${esc(num(invN))} ${investorWord(invN)}` : ''}</span></div>
        ${flows.map((f) => {
          const inv = f.investors || [];
          return `<div class="p-fl ${f.settled ? '' : 'now'}" data-key="fl${esc(f.block)}">
            <div class="p-fl-h"><b>Blok ${esc(f.block)}</b>${f.settled ? '<span class="s-label">uzavřeno</span>' : '<span class="p-lv"><i></i>plní se živě</span>'}
              <span class="p-fl-sum s-num">${f.totalIn ? `<span class="s-up">+${esc(fmtM(f.totalIn))}</span>` : ''}${f.totalOut ? ` <span class="s-down">−${esc(fmtM(f.totalOut))}</span>` : ''}${f.mult != null && Math.abs(f.mult - 1) > 0.0005 ? ` <span class="p-mx ${f.mult > 1 ? 's-up' : 's-down'}" title="Změna ceny podílu v${NB}bloku">${f.mult > 1 ? '▲' : '▼'}${NB}${esc(movePct(f.mult))}</span>` : ''}</span></div>
            ${inv.length ? inv.map((v) => {
              const k = `${f.block}:${v.id}`, rj = v.id === 'rj';
              return `<div class="p-iv" data-key="iv${esc(k)}">
                <div class="p-iv-h"><span class="p-iv-ava" style="--tc:${esc(rj ? '#6754DF' : team(v.team).color)}">${esc(initials(v.name))}</span>
                  <div class="p-iv-n"><b>${esc(v.name)}</b>${rj ? '<span class="s-badge">Smart money</span>' : v.team ? teamTag(v.team) : ''}</div>
                  <span class="p-iv-amt s-num">${v.in ? `<span class="s-up">+${esc(fmtM(v.in))}</span>` : ''}${v.out ? `<span class="s-down">−${esc(fmtM(v.out))}</span>` : ''}</span></div>
                ${whyHTML(k + ':i', v.whyIn && v.whyOut ? 'Nákup' : '', v.whyIn)}${whyHTML(k + ':o', v.whyIn && v.whyOut ? 'Prodej' : 'Prodej', v.whyOut)}
              </div>`;
            }).join('') : `<p class="p-hint">${f.settled ? 'V tomhle bloku do vás nikdo neinvestoval.' : 'Zatím nikdo neodeslal. Seznam se plní živě, jak spolužáci odesílají.'}</p>`}
          </div>`;
        }).join('')}
      </div>`;
    }
    morph(el, h);
  }
  $('teamv').addEventListener('click', (e) => {
    const w = e.target.closest('[data-why]');
    if (!w) return;
    const k = w.dataset.why;
    if (whyOpen.has(k)) whyOpen.delete(k); else whyOpen.add(k);
    haptic.tap(); renderTeam();
  });

  // ----- team sticker wall (component from /wall.js, §6) -----
  const wallOn = () => !!(S && (!S.features || S.features.wall !== false) && me && window.MupWall);
  async function wallOp(body) {
    const r = await send({ ...body, sid, pin });
    if (!r.ok) throw Object.assign(new Error(r.error || 'Něco se pokazilo.'), { ok: false, error: r.error });
    return r;
  }
  const wallApi = {
    async list() {
      const r = DEMO && window.PlayDemo?.wallList ? await window.PlayDemo.wallList() : await get(auth(), '?view=wall');
      if (!r || r.ok === false) throw Object.assign(new Error(r?.error || 'Nástěnku se nepodařilo načíst.'), { ok: false, error: r?.error });
      return r.stickers || [];
    },
    post: (b) => (DEMO && window.PlayDemo?.wallOp ? window.PlayDemo.wallOp('post', b) : wallOp({ op: 'wallPost', kind: b.kind, text: b.text })),
    reply: (b) => (DEMO && window.PlayDemo?.wallOp ? window.PlayDemo.wallOp('reply', b) : wallOp({ op: 'wallReply', id: b.id, text: b.text })),
    done: (b) => (DEMO && window.PlayDemo?.wallOp ? window.PlayDemo.wallOp('done', b) : wallOp({ op: 'wallDone', id: b.id, done: !!b.done })),
    del: (b) => (DEMO && window.PlayDemo?.wallOp ? window.PlayDemo.wallOp('del', b) : wallOp({ op: 'wallDelete', id: b.id, ...(b.reply ? { reply: b.reply } : {}) })),
  };
  let wallW = null, wallKey = null;
  function syncWall() {
    const on = wallOn();
    $('wallcard').classList.toggle('hidden', !on);
    const want = on && view === 'profile' ? `${me.id}|${me.team}` : null;
    if (want === wallKey) return;
    if (wallW) { try { wallW.destroy(); } catch {} wallW = null; $('wallbox').innerHTML = ''; }
    wallKey = want;
    if (want) {
      try { wallW = window.MupWall.mount($('wallbox'), { role: 'student', team: me.team, api: wallApi, pollMs: 4000 }); } catch (e) { console.warn(e); wallW = null; }
    }
  }

  // ---------- profile ----------
  const AWARD = { sharpest: 'Nejlepší investor', analyst: 'Nejlepší analytik', contrarian: 'Proti proudu', custom: 'Ocenění' };
  const PTK = { quiz: 'Kvíz', award: 'Ocenění', milestone: 'Milník', manual: 'Bonus' };
  let cardDirty = false, cardBusy = false, roundDraft = null;
  function renderProfile() {
    const t = team(me.team);
    const tr = feat('track') && me.track;
    const P = feat('points') && me.points;
    let h = `<div class="s-card p-card p-me" style="--tc:${esc(t.color)}">
      <div class="p-me-h"><span class="p-ava p-ava-lg" style="--tc:${esc(t.color)}">${esc(initials(me.name))}</span><div><h2 class="s-h2">${esc(me.name)}</h2><div class="p-team">${dot(t.color)}<span>${esc(t.name)}</span>${me.ghost ? ' <span class="s-badge s-warn">Ghost</span>' : ''}</div></div></div>
      ${tr ? `<div class="p-stats p-stats-3">
        <div class="s-stat p-stat"><span class="s-label">Návratnost</span><span class="s-v ${RET(tr) >= 0 ? 's-up' : 's-down'}">${esc(spct(RET(tr)))}</span></div>
        <div class="s-stat p-stat"><span class="s-label">Pořadí</span><span class="s-v">${(me.rankNow ?? tr.rank) ? esc((me.rankNow ?? tr.rank) + '.') : '–'}<small> z ${esc(tr.of || '–')}</small></span></div>
        <div class="s-stat p-stat"><span class="s-label">Nejlepší tah</span><span class="s-v p-best">${tr.bestCall ? `${esc(mult(tr.bestCall.multiple))}` : '–'}</span>${tr.bestCall ? `<span class="p-best-t">${teamTag(tr.bestCall.team)}</span>` : ''}</div>
      </div>` : me.invested ? `<div class="p-stats p-stats-3">
        <div class="s-stat p-stat"><span class="s-label">Portfolio</span><span class="s-v">${tw('prpf', PF())}</span></div>
        <div class="s-stat p-stat"><span class="s-label">Výnos</span><span class="s-v ${PF() >= me.start ? 's-up' : 's-down'}">${esc(spct(((PF() - me.start) / me.start) * 100))}</span></div>
        <div class="s-stat p-stat"><span class="s-label">Startupy</span><span class="s-v">${Object.values(me.stakesNow || me.stakes).filter((v) => v > 0).length}</span></div>
      </div>` : ''}
    </div>`;
    if (P) {
      h += `<div class="s-card p-card p-points"><div class="p-card-h"><h3 class="s-h3">Body</h3><span class="s-label">${P.rank ? `${esc(P.rank)}. místo z ${esc(P.of || '–')}` : ''}</span></div>
        <div class="p-pts-big"><span class="s-num s-grad-text">${esc(num(P.total || 0))}</span><small>${esc(ptsWord(P.total || 0))}</small></div>
        ${(P.recent || []).length ? `<div class="p-pts-list">${P.recent.map((e) => `<div class="p-pt" data-key="pt${esc(e.id || e.ts)}"><span class="s-badge">${esc(PTK[e.kind] || e.kind || 'Body')}</span><span class="p-pt-n">${esc(e.note || '')}</span><b class="s-num ${e.amt < 0 ? 's-down' : 's-up'}">${e.amt > 0 ? '+' : '−'}${esc(num(Math.abs(e.amt)))}</b></div>`).join('')}</div>` : '<p class="p-hint">Body získáš v kvízu, za ocenění a za splněné milníky týmu.</p>'}
      </div>`;
    }
    if (tr && (tr.awards || []).length) {
      h += `<div class="s-card p-card"><div class="p-card-h"><h3 class="s-h3">Ocenění</h3></div>${tr.awards.map((a) => `<div class="p-award" data-key="aw${esc(a.id)}"><span class="p-award-ic">★</span><div><b>${esc(AWARD[a.kind] || 'Ocenění')}</b>${a.note ? `<div class="s-muted">${esc(a.note)}</div>` : ''}</div><span class="s-label">Blok ${esc(a.block)}</span></div>`).join('')}</div>`;
    }
    const cardOn = feat('cards') && !me.ghost;
    if (cardOn) {
      h += `<div class="s-card p-card p-editor" id="cardbox"><div class="p-card-h"><h3 class="s-h3">${E('play.card.title')}</h3><span class="s-label">${esc(t.name)}</span></div><p class="p-hint">${E('play.card.hint')}</p>
        <div data-own="1" id="cardform"></div></div>`;
    }
    const roundOn = feat('rounds') && !me.ghost;
    if (roundOn) h += `<div class="s-card p-card" id="roundbox" data-own="1"></div>`;
    h += `<div class="p-logout"><button type="button" class="s-btn s-ghost s-block" id="logout">Změnit hráče · odhlásit</button></div>`;
    morph($('profile'), h);
    if (cardOn) renderCardForm();
    if (roundOn) renderRound();
  }

  function renderCardForm() {
    const box = $('cardform');
    const c = (S.cards || {})[me.team] || {};
    if (!box.firstChild) {
      box.innerHTML = `<label class="s-field"><span class="p-lab"><span class="s-label">One-liner</span><span class="p-cnt" id="c1n"></span></span><textarea class="s-input" id="c1" rows="2" maxlength="90" placeholder="Jednou větou: co děláte a pro koho"></textarea></label>
        <label class="s-field"><span class="p-lab"><span class="s-label">Podtitul</span><span class="p-cnt" id="c2n"></span></span><textarea class="s-input" id="c2" rows="3" maxlength="220" placeholder="Jak to funguje, čím se lišíte, co už máte"></textarea></label>
        <div class="p-ed-row"><span class="p-saved" id="csaved" aria-live="polite"></span><button type="button" class="s-btn s-primary s-sm" id="csave">Uložit kartu</button></div>`;
      const upd = () => { $('c1n').textContent = `${$('c1').value.length}/90`; $('c2n').textContent = `${$('c2').value.length}/220`; };
      ['c1', 'c2'].forEach((id) => $(id).addEventListener('input', () => { cardDirty = true; upd(); $('csaved').textContent = 'Neuloženo'; $('csaved').dataset.st = 'busy'; }));
      $('csave').onclick = saveCard;
      box._upd = upd;
    }
    if (!cardDirty && !cardBusy) {
      for (const [id, v] of [['c1', c.oneLiner || ''], ['c2', c.sub || '']]) if (document.activeElement !== $(id) && $(id).value !== v) $(id).value = v;
    }
    box._upd();
  }
  async function saveCard() {
    if (cardBusy) return;
    const oneLiner = $('c1').value.trim(), sub = $('c2').value.trim();
    const prev = S.cards?.[me.team];
    cardBusy = true;
    $('csave').classList.add('p-busy');
    $('csaved').textContent = 'Ukládám…'; $('csaved').dataset.st = 'busy';
    // optimistic: the card shows the new text immediately
    if (S.cards) S.cards[me.team] = { ...(prev || {}), oneLiner, sub };
    renderStartups();
    const r = await send({ op: 'card', sid, pin, oneLiner, sub });
    cardBusy = false;
    $('csave').classList.remove('p-busy');
    if (!r.ok) {
      if (S.cards) S.cards[me.team] = prev;
      renderStartups();
      $('csaved').textContent = r.error; $('csaved').dataset.st = 'err';
      haptic.err();
      return;
    }
    cardDirty = false;
    $('csaved').textContent = 'Uloženo ✓'; $('csaved').dataset.st = 'ok';
    haptic.ok();
    toast('Karta týmu uložena ✓', 'ok');
    kick(400);
  }

  function roundRange() {
    const V = team(me.team).V || 0;
    const r10 = (v) => Math.round(v / 10000) * 10000;
    const b = me.roundBounds;
    return b && b.max ? [b.min, b.max, V] : [r10(V * 0.5), r10(V * 2), V];
  }
  // a team without terms gets { pre = prev = V, kind 'flat' } from the server: that's "no terms yet"
  const hasTerms = (r) => !!(r && r.pre && (r.pre !== r.prev || r.kind !== 'flat'));
  function renderRound() {
    const box = $('roundbox');
    const r = S.rounds?.[me.team];
    const open = me.roundTermsOpen !== undefined ? !!me.roundTermsOpen : ['lobby', 'pitch'].includes(S.phase);
    const [lo, hi, V] = roundRange();
    if (!open) {
      roundDraft = null;
      morph(box, `<div class="p-card-h"><h3 class="s-h3">${E('play.round.title')}</h3><span class="s-badge">${S.phase === 'betting' ? 'Zamčeno' : 'Uzavřeno'}</span></div>
        ${hasTerms(r) ? `<div class="p-round"><div><span class="s-label">Pre-money</span><b class="s-num">${esc(fmt(r.pre))}</b></div><span class="s-badge ${r.kind === 'up' ? 's-ok' : r.kind === 'down' ? 's-bad' : ''}">${esc(ROUND[r.kind] || '')} ${esc(spct(r.pct || 0))}</span></div>` : '<p class="p-hint">Podmínky kola nastavíte před otevřením investování v dalším bloku. Bez nich proběhne flat round.</p>'}`);
      return;
    }
    if (!box.querySelector('#rform')) {
      box.innerHTML = `<div class="p-card-h"><h3 class="s-h3">${E('play.round.title')}</h3><span class="s-badge s-warn">Otevřené</span></div><p class="p-hint">${E('play.round.hint')}</p>
        <div id="rcur"></div>
        <div id="rform" data-own="1">
          <label class="s-field"><span class="p-lab"><span class="s-label">Pre-money ocenění</span><span class="p-cnt" id="rkind"></span></span>
            <span class="amtwrap amtwrap-lg"><input class="amt s-num" id="rpre" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done"><span>$</span></span></label>
          <input type="range" class="p-range" id="rrng" step="10000">
          <div class="p-range-l s-faint"><span id="rlo"></span><span id="rhi"></span></div>
          <div class="p-ed-row"><span class="p-saved" id="rsaved" aria-live="polite"></span><button type="button" class="s-btn s-primary s-sm" id="rsave">Nastavit kolo</button></div>
        </div>`;
      const inp = $('rpre'), rng = $('rrng');
      const sync = (fromInput) => {
        const [lo2, hi2, V2] = roundRange();
        rng.min = lo2; rng.max = hi2;
        $('rlo').textContent = fmtM(lo2); $('rhi').textContent = fmtM(hi2);
        const v = roundDraft ?? (hasTerms(S.rounds?.[me.team]) ? S.rounds[me.team].pre : V2);
        if (!fromInput && document.activeElement !== inp) inp.value = plain(v);
        rng.value = v;
        rng.style.setProperty('--pct', ((v - lo2) / Math.max(1, hi2 - lo2)) * 100 + '%');
        const p = V2 ? ((v - V2) / V2) * 100 : 0;
        const kind = Math.abs(p) < 0.5 ? 'flat' : p > 0 ? 'up' : 'down';
        const k = $('rkind');
        k.textContent = `${ROUND[kind]} ${spct(p)}`;
        k.className = 'p-cnt ' + (kind === 'up' ? 's-up' : kind === 'down' ? 's-down' : '');
      };
      rng.addEventListener('input', () => { roundDraft = +rng.value; sync(); });
      inp.addEventListener('focus', () => { inp.dataset.prev = roundDraft ?? ''; inp.placeholder = inp.value; inp.value = ''; });
      inp.addEventListener('input', () => { if (inp.value.trim()) { roundDraft = parseAmt(inp.value); sync(true); } });
      inp.addEventListener('blur', () => { if (!inp.value.trim()) roundDraft = inp.dataset.prev === '' ? null : +inp.dataset.prev; sync(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      $('rsave').onclick = saveRound;
      box._sync = sync;
    }
    morph($('rcur'), hasTerms(r) ? `<div class="p-round"><div><span class="s-label">Nastaveno</span><b class="s-num">${esc(fmt(r.pre))}</b></div><span class="s-badge ${r.kind === 'up' ? 's-ok' : r.kind === 'down' ? 's-bad' : ''}">${esc(ROUND[r.kind] || '')} ${esc(spct(r.pct || 0))}</span></div>` : '');
    box._sync();
  }
  async function saveRound() {
    const [lo, hi] = roundRange();
    const v = Math.round((roundDraft ?? parseAmt($('rpre').value)) / 10000) * 10000;
    const sv = $('rsaved');
    if (!(v >= lo && v <= hi)) { sv.textContent = `Ocenění kola musí být mezi ${fmt(lo)} a ${fmt(hi)}.`; sv.dataset.st = 'err'; haptic.err(); return; }
    $('rsave').classList.add('p-busy');
    sv.textContent = 'Ukládám…'; sv.dataset.st = 'busy';
    const r = await send({ op: 'roundTerms', sid, pin, pre: v });
    $('rsave').classList.remove('p-busy');
    if (!r.ok) { sv.textContent = r.error; sv.dataset.st = 'err'; haptic.err(); return; }
    roundDraft = null;
    sv.textContent = 'Uloženo ✓'; sv.dataset.st = 'ok';
    haptic.ok();
    kick(300);
  }

  // ---------- exit result ----------
  function renderExit() {
    const x = feat('exit') ? S.exit : null;
    const el = $('exitbox');
    if (!x) { el.innerHTML = ''; return; }
    const tr = me.track;
    const val = tr?.value ?? me.portfolio;
    const ret = tr?.returnPct ?? (me.start ? ((me.portfolio - me.start) / me.start) * 100 : 0);
    const myRank = tr?.rank;
    const teams = (x.teams || []).slice().sort((a, b) => (b.multiple || 0) - (a.multiple || 0));
    morph(el, `<div class="s-card p-card p-exit">
      <div class="s-label">Exit · konec hry</div>
      <h2 class="p-exit-t">Tvoje portfolio</h2>
      <div class="p-exit-v s-num">${esc(fmt(val))}</div>
      <div class="p-exit-r"><span class="${ret >= 0 ? 's-up' : 's-down'}">${esc(spct(ret))}</span>${myRank ? `<span>${esc(myRank)}. místo${tr.of ? ` z ${esc(tr.of)}` : ''}</span>` : ''}</div>
    </div>
    <div class="s-card p-card"><div class="p-card-h"><h3 class="s-h3">Jak dopadly startupy</h3></div>
      ${teams.map((o) => `<div class="p-xo" data-key="xo${esc(o.team)}">${teamTag(o.team)}<span class="s-badge ${o.kind === 'writeoff' ? 's-bad' : o.kind === 'hold' ? '' : 's-ok'}">${esc(EXITK[o.kind] || o.kind)}</span><b class="s-num">${o.kind === 'acquired' || o.kind === 'ipo' ? esc(mult(o.multiple)) : o.kind === 'writeoff' ? '0×' : '1×'}</b><span class="s-faint s-num">${esc(fmtM(o.V))}</span></div>`).join('')}
    </div>
    ${(x.ranking || []).length ? `<div class="s-card p-card"><div class="p-card-h"><h3 class="s-h3">Nejlepší investoři</h3></div>
      ${x.ranking.map((p, i) => `<div class="p-rk ${p.name === me.name && p.team === me.team ? 'me' : ''}" data-key="rk${i}"><span class="p-rk-i">${i + 1}</span><span class="p-rk-n"><b>${esc(p.name)}</b>${teamTag(p.team)}</span><span class="p-rk-v"><b class="s-num">${esc(fmtM(p.value))}</b><small class="${p.returnPct >= 0 ? 's-up' : 's-down'}">${esc(spct(p.returnPct))}</small></span></div>`).join('')}
      ${x.contrarian ? `<div class="p-contra"><span class="s-label">Proti proudu</span><b>${esc(x.contrarian.name)}</b> ${teamTag(x.contrarian.team)} <b class="s-num">${esc(mult(x.contrarian.multiple))}</b></div>` : ''}
    </div>` : ''}`);
  }

  // ---------- quiz takeover ----------
  const QCOL = ['#3586D1', '#6754DF', '#FF5574', '#FF8A47'];
  const LET = ['A', 'B', 'C', 'D'];
  const picks = {}; // question key -> { choice, st: 'sending'|'sent'|'late'|'err' }
  let quizDone = null, quizKey = null;
  const qKey = (q) => `${q.setTitle}|${q.idx}|${q.startedAt}`;
  function quizMode() {
    const q = feat('quiz') ? S.quiz : null;
    if (!q) return null;
    if (['question', 'reveal', 'board'].includes(q.state)) return q.state;
    if (q.state === 'done' && quizDone !== q.seq) return 'done';
    return null;
  }
  function renderQuiz() {
    const el = $('quiz');
    const mode = quizMode();
    const wasOn = !el.classList.contains('hidden');
    if (!mode) {
      if (wasOn) { el.classList.add('p-out'); setTimeout(() => { if (!quizMode()) { el.classList.add('hidden'); el.classList.remove('p-out'); document.body.classList.remove('p-noscroll'); } }, 180); }
      return;
    }
    if (!wasOn) { el.classList.remove('hidden', 'p-out'); document.body.classList.add('p-noscroll'); haptic.tap(); }
    const q = S.quiz, mq = me.quiz || {};
    const k = q.state === 'question' ? qKey(q) : null;
    const local = k ? picks[k] : null;
    const myChoice = local ? local.choice : mq.myChoice ?? null;
    const left = q.endsAt ? q.endsAt - MUP.now() : 0;
    const head = `<div class="qz-top"><span class="s-label">Kvíz${q.setTitle ? ' · ' + esc(q.setTitle) : ''}</span><span class="s-label">${q.idx >= 0 ? `Otázka ${q.idx + 1} z ${q.total}` : ''}</span></div>`;
    let body = '';
    const streak = mq.streak ?? 0, bonus = mq.myBonus ?? 0;
    if (mode === 'question') {
      const n = (q.a || []).length;
      const locked = myChoice !== null && myChoice !== undefined;
      const late = !locked && left <= -1500;
      const st = local?.st || (locked ? 'sent' : '');
      body = `${head}
        ${streak >= 2 ? `<div class="qz-stk"><span class="qz-fl" aria-hidden="true">🔥</span>Série${NB}${esc(streak)} · další správná +${esc(num(Math.min(250, 50 * streak)))}</div>` : ''}
        <div class="qz-q"><div class="qz-ring" id="qzring"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" class="bg"/><circle cx="22" cy="22" r="19" class="fg" id="qzfg"/></svg><b id="qzsec" class="s-num"></b></div><p>${esc(q.q || '')}</p></div>
        <div class="qz-tiles n${n} ${locked ? 'locked' : ''} ${late ? 'late' : ''}">${(q.a || []).map((a, i) => `<button type="button" class="qz-tile ${myChoice === i ? 'pick' : ''}" data-quiz="${i}" style="--qc:${QCOL[i]}" ${locked || late ? 'data-off="1"' : ''}><b>${LET[i]}</b><span>${esc(a)}</span>${myChoice === i ? `<em class="qz-sent">${st === 'sending' ? 'Odesílám…' : '✓ ' + E('play.quiz.sent')}</em>` : ''}</button>`).join('')}</div>
        <div class="qz-foot"><span>${locked ? `<b class="qz-ok">✓ ${E('play.quiz.sent')}</b> · ${E('play.quiz.wait')}` : late ? 'Čas vypršel.' : local?.st === 'err' ? `<b class="s-down">${esc(local.msg || 'Nepodařilo se odeslat, zkus to znovu.')}</b>` : 'Vyber jednu odpověď. Změnit ji už nepůjde.'}</span><span class="qz-cnt s-faint">${q.answered != null ? `odpovědělo ${esc(q.answered)}` : ''}</span></div>`;
    } else if (mode === 'reveal') {
      const right = mq.myCorrect === true, none = myChoice === null || myChoice === undefined;
      body = `${head}
        <div class="qz-res ${right ? 'ok' : 'bad'}"><div class="qz-res-ic">${right ? '✓' : none ? '–' : '✕'}</div><h2>${right ? 'Správně!' : none ? 'Bez odpovědi' : 'Tentokrát ne'}</h2>
          <div class="qz-res-p s-num">${right ? '+' + esc(bonus > 0 ? num(mq.myPoints || 0) : pts(mq.myPoints || 0)) : '0 bodů'}${right && bonus > 0 ? `<span class="qz-bonus"> · série${NB}${esc(streak)} 🔥 +${esc(num(bonus))}</span>` : ''}</div></div>
        <p class="qz-qs">${esc(q.q || '')}</p>
        <div class="qz-list">${(q.a || []).map((a, i) => `<div class="qz-li ${i === q.correct ? 'right' : ''} ${i === myChoice ? 'mine' : ''}" style="--qc:${QCOL[i]}"><b>${LET[i]}</b><span>${esc(a)}</span><em class="s-num">${q.counts ? esc(q.counts[i] || 0) : ''}</em>${i === q.correct ? '<i>✓</i>' : i === myChoice ? '<i>✕</i>' : ''}</div>`).join('')}</div>
        <div class="qz-foot"><span>${q.fastest ? `Nejrychlejší: <b>${esc(q.fastest.name)}</b> · ${esc(num(q.fastest.ms / 1000, 1))}${NB}s` : ''}</span><span class="qz-cnt">V kvízu máš <b class="s-num">${esc(pts(mq.runPoints || 0))}</b></span></div>`;
    } else {
      const lobby = mode === 'board' && q.idx < 0;
      const L = q.leaders || [];
      body = `${head}
        ${lobby ? `<div class="qz-lobby"><h2 class="s-h1">${E('play.quiz.lobby')}</h2><p>${E('play.quiz.lobbyHint')}</p><div class="qz-dots"><i style="--qc:${QCOL[0]}"></i><i style="--qc:${QCOL[1]}"></i><i style="--qc:${QCOL[2]}"></i><i style="--qc:${QCOL[3]}"></i></div></div>` :
        `<div class="qz-rank"><span class="s-label">${mode === 'done' ? 'Konečné pořadí' : 'Průběžné pořadí'}</span><div class="qz-rank-v s-num">${mq.rank && mq.runPoints > 0 ? esc(mq.rank) + '.' : '–'}</div><div class="s-muted">${mq.rank && mq.runPoints > 0 ? `místo z ${esc(S.playerCount)} · <b class="s-num">${esc(pts(mq.runPoints))}</b>` : (mode === 'done' ? 'V\u00a0tomto kvízu bez bodů.' : 'Zatím bez bodů – další otázka je tvoje šance.')}</div></div>
        ${L.length ? `<div class="qz-board">${L.map((p, i) => `<div class="p-rk ${p.name === me.name && p.team === me.team ? 'me' : ''}" data-key="ql${i}"><span class="p-rk-i">${i + 1}</span><span class="p-rk-n"><b>${esc(p.name)}</b>${teamTag(p.team)}</span><span class="p-rk-v"><b class="s-num">${esc(num(p.quizPoints))}</b></span></div>`).join('')}</div>` : ''}`}
        ${mode === 'done' ? '<button type="button" class="s-btn s-primary s-block qz-close" data-act="quiz-close">Zpět do hry</button>' : ''}`;
    }
    const key = mode + '|' + body;
    if (key !== quizKey) { quizKey = key; morph(el, `<div class="qz-in" data-mode="${mode}">${body}</div>`); }
    tickQuiz();
  }
  function tickQuiz() {
    const q = S?.quiz;
    if (!q || q.state !== 'question' || !$('qzfg')) return;
    const total = (q.time || ((q.endsAt - q.startedAt) / 1000) || 1) * 1000;
    const left = Math.max(0, q.endsAt - MUP.now());
    const C = 2 * Math.PI * 19;
    $('qzfg').style.strokeDasharray = C;
    $('qzfg').style.strokeDashoffset = C * (1 - left / total);
    $('qzsec').textContent = Math.ceil(left / 1000);
    $('qzring').classList.toggle('low', left <= 5000);
  }
  async function answerQuiz(choice) {
    const q = S.quiz;
    if (!q || q.state !== 'question') return;
    const k = qKey(q);
    if (picks[k] && picks[k].st !== 'err') return;
    if (me.quiz?.myChoice != null) return;
    if (q.endsAt && MUP.now() > q.endsAt + 1500) return;
    picks[k] = { choice, st: 'sending' };
    haptic.tap();
    renderQuiz();
    const r = await send({ op: 'quizAnswer', sid, pin, choice });
    if (r.ok || /už máš/i.test(r.error || '')) { picks[k].st = 'sent'; if (r.ok) haptic.ok(); }
    else { picks[k] = { choice: null, st: 'err', msg: r.net ? 'Spojení vypadlo – zkus to znovu.' : r.error }; haptic.err(); }
    quizKey = null;
    renderQuiz();
    kick(200);
  }
  $('quiz').addEventListener('click', (e) => {
    const t = e.target.closest('[data-quiz]');
    if (t) { if (!t.dataset.off) answerQuiz(+t.dataset.quiz); return; }
    if (e.target.closest('[data-act="quiz-close"]')) { quizDone = S.quiz.seq; haptic.tap(); renderQuiz(); }
  });

  // ---------- delegated actions ----------
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'msgs-toggle') { msgsOpen = !msgsOpen; haptic.tap(); renderMsgs(); }
      if (act === 'note-jump') {
        const r = document.querySelector(`#notes .p-nrow[data-nt="${a.dataset.team}"]`);
        if (r) { r.scrollIntoView({ behavior: PK.reduced() ? 'auto' : 'smooth', block: 'start' }); haptic.tap(); }
      }
    }
    if (e.target.closest('#logout')) { e.preventDefault(); haptic.tap(); logout(); }
  });

  // ---------- reveals: a short toast when something happens on the projector ----------
  let revealSeq = null;
  function renderReveal() {
    const r = S.reveal;
    const seq = r ? r.seq : 0;
    if (revealSeq === null || seq <= revealSeq) { revealSeq = Math.max(revealSeq || 0, seq); return; }
    revealSeq = seq;
    const myD = r.delta && r.delta[me.team];
    const msg = {
      class: 'Showdown! Peníze třídy jsou na stole.',
      rj: 'RainbowJet odhalil smart money.',
      revalue: 'Startupy se přecenily.',
      market: `Karta trhu: ${r.title || ''}`,
      tranche: `RainbowJet uvolnil tranši týmu ${team(r.team).name}.`,
      exit: 'Exit! Hra skončila – podívej se, jak jsi dopadl(a).',
    }[r.kind];
    if (!msg) return;
    toast(`${esc(msg)}${me.invested && r.kind !== 'exit' ? `<br><span class="s-muted">Tvoje portfolio: <b>${esc(fmtM(me.portfolio))}</b></span>` : ''}${myD && r.kind !== 'class' ? `<br><span class="${myD > 0 ? 's-up' : 's-down'}">${esc(team(me.team).name)}: ${esc(smoney(myD))}</span>` : ''}`, 'msg');
    haptic.ok();
  }

  // ---------- main loop ----------
  function renderAll() {
    if (S.phase !== lastPhase) {
      // investing is the default view whenever betting opens
      if (S.phase === 'betting' && (lastPhase !== null || firstRender)) { if (view !== 'invest') go('invest', { silent: true }); }
      lastPhase = S.phase;
    }
    if (firstRender) { applyView(); firstRender = false; }
    document.body.classList.toggle('p-bet', S.phase === 'betting');
    renderHeader(); renderStatus(); renderExit(); renderHero(); renderMsgs(); renderNotes(); renderMain(); renderDock();
    renderPortfolio(); renderCap(); renderStartups(); renderTeam(); renderProfile(); renderBoard(); renderQuiz(); renderDots(); renderReveal();
    syncWall(); runTweens();
  }

  async function tick() {
    let s;
    try { s = await get(auth()); } catch (e) { netState(false); return; }
    if (!s || !Array.isArray(s.teams)) { netState(false); return; }
    netState(true);
    if (DEMO && window.PlayDemo) s = window.PlayDemo.patch(s, sid);
    S = s;
    if (PA.on) { if (!s.me) return PA.noMe(s); PA.update(s); }
    if (s.me) {
      me = s.me; meFail = 0;
      LS.set('mup.profile', { sid, pin, name: me.name, team: me.team, gid: s.gid });
      const local = LS.get(slipsKey()) || {};
      const mine = local.gid === s.gid ? local.blocks?.[s.block] : null;
      if (mine && (mine.ts || 0) > (me.slip?.ts || 0)) restore(); // server is missing something this phone has
      else if (me.slip) rememberSlip(me.slip);
      $('boot').classList.add('hidden');
      $('login').classList.add('hidden');
      $('game').classList.remove('hidden');
      document.body.classList.add('p-ingame');
      renderAll();
    } else if (sid && pin && s.meError) {
      if (s.meError === 'unknown' && LS.get('mup.profile')?.sid === sid) {
        const r = await restore();
        if (r?.ok) kick(300);
        else if (r?.relogin) logout();
        return; // keep the last screen while reconnecting
      }
      if (++meFail >= 3) logout();
    } else if (!sid || !pin) showLogin();
  }

  let loopT = null, running = false, again = false;
  async function loop() {
    clearTimeout(loopT);
    if (running) { again = true; return; }
    running = true;
    try { await tick(); } catch (e) { console.warn(e); }
    running = false;
    if (again) { again = false; loopT = setTimeout(loop, 30); return; }
    const fast = feat('quiz') && S?.quiz?.state === 'question';
    let ms = fast ? 1000 : 2500;
    if (document.hidden) ms *= 3;
    loopT = setTimeout(loop, ms);
  }
  function kick(d = 150) { clearTimeout(loopT); loopT = setTimeout(loop, d); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(0); });
  window.addEventListener('online', () => kick(0));

  setInterval(() => { if (S && me) renderStatus(); }, 500);
  setInterval(() => { if (S && me) tickQuiz(); }, 200);

  async function start() {
    if (DEMO) {
      await new Promise((res) => { const sc = document.createElement('script'); sc.src = '/play-demo.js'; sc.onload = res; sc.onerror = res; document.head.appendChild(sc); });
    }
    if (PA.on && PA.stop) return;
    if (PA.login) { const r = await PA.tokenLogin(); if (r) { sid = r.sid; pin = r.pin; } }
    loadPortraits();
    applyView();
    loop();
  }
  start();
})();
