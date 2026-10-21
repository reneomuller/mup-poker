(function () {
  const { esc, fmt, fmtM, get, post, timeLeft, clock, poll, PHASES, billHTML, glassHTML, setGlass, loadPortraits, t: tx } = MUP;
  const E = (k, v) => esc(tx(k, v));
  const $ = (id) => document.getElementById(id);
  const STEP = 10000;
  let sid = localStorage.getItem('mup.sid'), pin = localStorage.getItem('mup.pin');
  let S = null, me = null, meFail = 0, formKey = null, draft = null, loginKey = null, notesKey = null, tab = 'new';

  const auth = () => (sid && pin ? { 'x-sid': sid, 'x-pin': pin } : {});
  const team = (id) => S.teams.find((t) => t.id === id) || { name: id, color: '#888' };
  const parseAmt = (v) => Math.max(0, Math.round(Number(String(v).replace(/[^\d]/g, '')) || 0));
  const plain = (n) => Math.round(n).toLocaleString('cs-CZ');
  const sumOf = (m) => Object.values(m).reduce((a, e) => a + (e.amt || 0), 0);

  // ---------- login ----------
  function showLogin() {
    $('game').classList.add('hidden');
    $('fan').classList.add('hidden');
    const el = $('login');
    el.classList.remove('hidden');
    const key = JSON.stringify([S.teams, S.players.length, S.regOpen, tab, MUP.cv()]);
    if (key === loginKey) return;
    loginKey = key;
    if (!S.regOpen) tab = 'old';
    const teamOpts = S.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    const byTeam = S.teams.map((t) => {
      const ps = S.players.filter((p) => p.team === t.id);
      return ps.length ? `<optgroup label="${esc(t.name)}">${ps.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>` : '';
    }).join('');
    el.innerHTML = `
      <div class="hero"><div class="bills">${[0, 1, 2, 3, 4].map((i) => billHTML(i)).join('')}</div>
        <h1>${E('play.login.title')}</h1><p>${E('play.login.sub')}</p></div>
      <div class="card">
        <div class="tabs">${S.regOpen ? `<button data-tab="new" class="${tab === 'new' ? 'on' : ''}">${E('play.login.tabNew')}</button>` : ''}<button data-tab="old" class="${tab === 'old' ? 'on' : ''}">${E('play.login.tabOld')}</button></div>
        ${tab === 'new' ? `
          <div class="field"><label class="lbl">${E('play.login.name')}</label><input class="input" id="lname" autocomplete="name" maxlength="40"></div>
          <div class="field"><label class="lbl">${E('play.login.team')}</label><select class="input" id="lteam"><option value="">Vyber tým…</option>${teamOpts}</select></div>
          <div class="field"><label class="lbl">${E('play.login.pinNew')}</label><input class="input pin" id="lpin" inputmode="numeric" maxlength="4" autocomplete="off"></div>
          <button class="btn" id="lgo" style="width:100%">${E('play.login.goNew')}</button>` : `
          <div class="field"><label class="lbl">${E('play.login.who')}</label><select class="input" id="lwho"><option value="">Vyber své jméno…</option>${byTeam}</select></div>
          <div class="field"><label class="lbl">${E('play.login.pin')}</label><input class="input pin" id="lpin" inputmode="numeric" maxlength="4" autocomplete="off"></div>
          <button class="btn" id="lgo" style="width:100%">${E('play.login.goOld')}</button>`}
        <div class="err msg" id="lerr"></div>
      </div>`;
    el.querySelectorAll('.hero .bill').forEach((b, i) => { b.style.transform = `translateX(-50%) rotate(${(i - 2) * 9}deg)`; });
    el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; loginKey = null; showLogin(); }));
    $('lgo').onclick = async () => {
      const p = $('lpin').value.trim();
      $('lerr').textContent = '';
      let r;
      if (tab === 'new') r = await post({ op: 'register', name: $('lname').value, team: $('lteam').value, pin: p });
      else r = await post({ op: 'login', sid: $('lwho').value, pin: p });
      if (!r.ok) { $('lerr').textContent = r.error; return; }
      sid = r.sid; pin = p;
      localStorage.setItem('mup.sid', sid); localStorage.setItem('mup.pin', pin);
      meFail = 0; loginKey = null; formKey = null; notesKey = null;
      setTimeout(tick, 300);
    };
  }
  function logout() {
    sid = pin = null; localStorage.removeItem('mup.sid'); localStorage.removeItem('mup.pin');
    me = null; loginKey = null; formKey = null; notesKey = null; tab = 'old';
    showLogin();
  }
  $('logout').onclick = (e) => { e.preventDefault(); logout(); };

  // ---------- game ----------
  function renderHeader() {
    $('who').textContent = me.name;
    const t = team(me.team);
    $('myteam').innerHTML = `<span class="dot" style="background:${t.color}"></span>${esc(t.name)}`;
    $('pfv').textContent = me.portfolio ? fmtM(me.portfolio) : fmtM(me.rules.capital || 0);
  }

  function renderStatus() {
    const s = S;
    let t1 = PHASES[s.phase] || '', t2 = tx('play.status.block', { block: s.block, max: s.maxBlock });
    if (s.phase === 'pitch' && s.presenting) { t1 = tx('play.status.pitch', { team: team(s.presenting).name }); t2 = tx('play.status.pitchHint'); }
    if (s.phase === 'lobby') { t1 = tx('play.status.lobby'); t2 = tx('play.status.lobbyHint'); }
    if (s.phase === 'closed') t2 = tx('play.status.closedHint');
    if (s.phase === 'showdown') t2 = tx('play.status.showdownHint');
    if (s.phase === 'rj') t2 = tx('play.status.rjHint');
    const left = timeLeft(s);
    const el = $('status');
    if (!el.querySelector('.glass')) el.innerHTML = glassHTML() + '<div><div class="st1"></div><div class="st2"></div></div><div class="clk"></div>';
    el.querySelector('.st1').textContent = t1;
    el.querySelector('.st2').textContent = t2;
    el.querySelector('.clk').textContent = left === null ? '' : left > 0 ? clock(left) : tx('table.timeUp');
    setGlass(el.querySelector('.glass'), left === null ? 0.66 : s.timerTotal ? left / s.timerTotal : 0);
  }

  let pfKey = null;
  const dayLabel = (ts) => { const d = new Date(ts); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
  function sparkHTML() {
    const raw = me.series.map(([ts, v]) => ({ ts, v }));
    raw.push({ ts: MUP.now(), v: me.portfolio });
    const days = [];
    for (const p of raw) {
      const key = new Date(p.ts).toDateString(), last = days[days.length - 1];
      if (last && last.key === key) { last.v = p.v; last.ts = p.ts; } else days.push({ key, ...p });
    }
    let pts = days.length >= 2 ? days : raw;
    if (pts.length < 2) pts = [pts[0], pts[0]];
    const W = 320, Hh = 92, pad = 6;
    const vals = pts.map((p) => p.v).concat(me.start);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 40000) { const m = (hi + lo) / 2; lo = m - 20000; hi = m + 20000; }
    const x = (i) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
    const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (Hh - 2 * pad);
    const up = me.portfolio >= me.start, col = up ? '#3fbf7a' : '#e8505b';
    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const base = y(me.start).toFixed(1);
    return `<svg class="spark" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-label="Vývoj portfolia">
        <defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
        <polygon points="${x(0)},${Hh} ${line} ${x(pts.length - 1)},${Hh}" fill="url(#sg)"/>
        <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="rgba(242,234,214,.35)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
        <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="sparkx"><span>${esc(dayLabel(pts[0].ts))}</span><span>čárkovaně: vklad ${esc(fmtM(me.start))}</span><span>dnes</span></div>`;
  }

  function renderPortfolio() {
    const key = JSON.stringify([me.portfolio, me.stakes, me.series.length, S.teams.map((t) => t.V), new Date().toDateString(), MUP.cv()]);
    if (key === pfKey) return;
    pfKey = key;
    const rows = S.teams.filter((t) => t.id !== me.team).map((t) => {
      const v = me.stakes[t.id] || 0;
      const own = t.V ? (v / t.V) * 100 : 0;
      return `<div class="prow"><span class="pn"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</span>
        <span class="pv">${v ? esc(fmt(v)) : '—'}</span>
        <span class="ps">ocenění ${esc(fmtM(t.V))}${v ? ` · vlastníš ${own.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} %` : ''}</span></div>`;
    }).join('');
    let head = `<h3>${E('play.pf.title')}</h3><p class="hint">${E('play.pf.empty')}</p>`;
    if (me.invested) {
      const pl = me.portfolio - me.start, pct = (pl / me.start) * 100, up = pl >= 0;
      head = `<div class="pfhead"><div><div class="lbl">${E('play.pf.title')}</div><div class="pfbig serif">${esc(fmt(me.portfolio))}</div>
          <div class="pl ${up ? 'up' : 'down'}">${up ? '+' : '−'}${esc(fmt(Math.abs(pl)))} · ${up ? '+' : '−'}${Math.abs(pct).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %</div></div>
          <img class="meme" src="/img/${up ? 'stonks' : 'not-stonks'}.webp" alt="${up ? 'stonks' : 'not stonks'}"></div>${sparkHTML()}`;
    }
    $('portfolio').innerHTML = head + rows;
  }

  // ----- private messages from RainbowJet to my team -----
  let msgKey = null;
  function renderMsgs() {
    const m = me.msgs || [];
    const key = me.team + JSON.stringify(m.map((x) => x.ts)) + MUP.cv();
    if (key === msgKey) return;
    msgKey = key;
    $('msgs').classList.toggle('hidden', !m.length);
    if (!m.length) return;
    $('msgs').innerHTML = `<h3>${E('play.msgs.title')}</h3><p class="hint">${E('play.msgs.hint')}</p>` + m.map((x) => {
      const head = x.kind === 'revalue' ? `Přecenění: ${fmtM(x.from)} → ${fmtM(x.to)}`
        : x.kind === 'smart' ? `Smart money: ${x.amt > 0 ? '+' : '−'}${fmtM(Math.abs(x.amt))}` : 'Zpráva';
      const d = new Date(x.ts);
      return `<div class="msg1"><div class="mh"><b>${esc(head)}</b><span>Blok ${x.block} · ${d.getDate()}. ${d.getMonth() + 1}.</span></div>${x.text ? `<div class="mt">${esc(x.text)}</div>` : ''}</div>`;
    }).join('');
  }

  // ----- notes: they feed the discussion after each round -----
  let noteTimer = null, notesDraft = {};
  const NOTE_Q = { like: ['play.notes.like', 'play.notes.likePh'], doubt: ['play.notes.doubt', 'play.notes.doubtPh'] };
  function noteFields(t) {
    const n = notesDraft[t] || {};
    return ['like', 'doubt'].map((k) => `<div class="nk">${E(NOTE_Q[k][0])}</div><textarea class="input note" data-n="${t}" data-k="${k}" rows="2" placeholder="${E(NOTE_Q[k][1])}">${esc(n[k] || '')}</textarea>`).join('');
  }
  const setSaved = (txt) => document.querySelectorAll('.nsaved').forEach((e) => { e.textContent = txt; });
  function wireNotes(root) {
    root.querySelectorAll('textarea.note').forEach((ta) => ta.addEventListener('input', () => {
      const t = ta.dataset.n, k = ta.dataset.k;
      (notesDraft[t] = notesDraft[t] || { like: '', doubt: '' })[k] = ta.value;
      document.querySelectorAll(`textarea.note[data-n="${t}"][data-k="${k}"]`).forEach((o) => { if (o !== ta) o.value = ta.value; });
      setSaved('Ukládám…');
      clearTimeout(noteTimer);
      noteTimer = setTimeout(saveNotes, 1200);
    }));
  }
  function renderNotes() {
    const key = S.block + '|' + me.id + '|' + MUP.cv();
    if (key !== notesKey) {
      notesKey = key;
      notesDraft = {};
      for (const [t, n] of Object.entries(me.slip?.notes || {})) notesDraft[t] = typeof n === 'string' ? { like: n, doubt: '' } : { like: n.like || '', doubt: n.doubt || '' };
      $('notes').innerHTML = `<h3>${E('play.notes.title')}</h3><p class="hint">${E('play.notes.hint')}</p>` +
        S.teams.filter((t) => t.id !== me.team).map((t) => `<div class="nrow"><div class="lbl"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</div>${noteFields(t.id)}</div>`).join('') +
        '<div class="saved nsaved"></div>';
      wireNotes($('notes'));
    }
    // in the first investing round the notes sit inside the investing form
    $('notes').classList.toggle('hidden', S.phase === 'betting' && me.rules.mode === 'initial');
  }
  const collectNotes = () => {
    const n = {};
    for (const [t, v] of Object.entries(notesDraft)) if ((v.like || '').trim() || (v.doubt || '').trim()) n[t] = v;
    return n;
  };
  async function saveNotes() {
    const r = await post({ op: 'notes', sid, pin, notes: collectNotes() });
    setSaved(r.ok ? 'Uloženo' : r.error);
  }

  // ----- allocation -----
  function draftKey() { return `mup.draft.${me.id}.${S.block}`; }
  function loadDraft() {
    if (me.slip?.submitted) return { out: structuredClone(me.slip.out || {}), in: structuredClone(me.slip.in || {}) };
    try { const d = JSON.parse(localStorage.getItem(draftKey()) || 'null'); if (d) return d; } catch {}
    return { out: {}, in: {} };
  }
  const saveDraft = () => { try { localStorage.setItem(draftKey(), JSON.stringify(draft)); } catch {} };

  function rowHTML(kind, t, e, extra = '', withNotes = false) {
    return `<div class="arow ${e.amt ? 'has' : ''}" data-k="${kind}" data-t="${t.id}">
      <div class="ahead"><span class="dot" style="background:${t.color}"></span><span class="an">${esc(t.name)}${extra}</span>
        <input class="amt" inputmode="numeric" value="${plain(e.amt || 0)}" aria-label="Částka"></div>
      <input type="range" min="0" max="1000000" step="${STEP}" value="${e.amt || 0}">
      <div class="qbtns"><button data-q="0">0</button><button data-q="-50000">−50 tis.</button><button data-q="50000">+50 tis.</button><button data-q="rest">+ zbytek</button></div>
      <textarea class="input why" rows="2" placeholder="${kind === 'out' ? E('play.form.whyOut') : E('play.form.whyIn')}">${esc(e.why || '')}</textarea>
      ${withNotes ? `<div class="rnotes">${noteFields(t.id)}</div>` : ''}
    </div>`;
  }

  function buildForm() {
    const R = me.rules;
    const others = S.teams.filter((t) => t.id !== me.team);
    draft = loadDraft();
    let html = '';
    if (R.mode === 'initial') {
      html = `<div class="card"><h3>${E('play.form.initTitle', { capital: fmt(R.capital) })}</h3>
        <p class="hint">${E('play.form.initHint')}</p>
        <div id="done"></div>
        ${others.map((t) => rowHTML('in', t, draft.in[t.id] || {}, '', true)).join('')}
        <div class="saved nsaved"></div>
        <div class="sum" id="sum"></div>
        <div class="actions"><button class="btn" id="go">${E('play.form.go')}</button></div>
        <div class="err msg" id="ferr"></div></div>`;
    } else {
      const held = others.filter((t) => (me.stakes[t.id] || 0) > 0);
      html = `<div class="card"><h3>${E('play.form.rebTitle')}</h3>
        <p class="hint">${E('play.form.rebHint', { max: fmt(R.cashoutMax) })}</p>
        <div id="done"></div>
        <div class="lbl sec">${E('play.form.outLabel')}</div>
        ${held.length ? held.map((t) => rowHTML('out', t, draft.out[t.id] || {}, ` <span class="have">máš ${esc(fmtM(me.stakes[t.id]))}</span>`)).join('') : '<p class="hint">Nemáš z čeho vybírat.</p>'}
        <div class="lbl sec">${E('play.form.inLabel')}</div>
        ${others.map((t) => rowHTML('in', t, draft.in[t.id] || {})).join('')}
        <div class="sum" id="sum"></div>
        <div class="actions"><button class="btn" id="go">${E('play.form.confirm')}</button><button class="btn ghost" id="hold">${E('play.form.hold')}</button></div>
        <div class="err msg" id="ferr"></div></div>`;
    }
    $('main').innerHTML = html;
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

  function setAmt(kind, t, v) {
    v = Math.max(0, Math.min(Math.round(v), Math.max(0, limitFor(kind, t))));
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
    row.querySelector('input[type=range]').value = e.amt;
    row.classList.toggle('has', e.amt > 0);
  }

  function wireRow(row) {
    const kind = row.dataset.k, t = row.dataset.t;
    const rng = row.querySelector('input[type=range]'), inp = row.querySelector('.amt'), why = row.querySelector('.why');
    rng.addEventListener('input', () => setAmt(kind, t, +rng.value));
    inp.addEventListener('input', () => setAmt(kind, t, parseAmt(inp.value)));
    inp.addEventListener('blur', () => syncRow(row));
    inp.addEventListener('focus', () => inp.select());
    why.addEventListener('input', () => { (draft[kind][t] || (draft[kind][t] = { amt: 0, why: '' })).why = why.value; saveDraft(); updateForm(); });
    row.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => {
      const cur = draft[kind][t]?.amt || 0, q = b.dataset.q;
      setAmt(kind, t, q === 'rest' ? limitFor(kind, t) : q === '0' ? 0 : cur + Number(q));
    }));
  }

  function clientErrors() {
    const R = me.rules, errs = [];
    const inT = sumOf(draft.in), outT = sumOf(draft.out);
    for (const k of ['out', 'in']) for (const [t, e] of Object.entries(draft[k])) if (e.amt > 0 && (e.why || '').trim().length < 3) errs.push(`Napiš proč u týmu ${team(t).name}.`);
    if (R.mode === 'initial' && inT !== R.capital) errs.unshift(`Zbývá rozdělit ${fmt(R.capital - inT)}.`);
    if (R.mode !== 'initial' && inT !== outT) errs.unshift(inT < outT ? `Zbývá vložit ${fmt(outT - inT)}.` : 'Vkládáš víc, než vybíráš.');
    return errs;
  }

  function updateForm() {
    if (!$('sum')) return;
    $('main').querySelectorAll('.arow').forEach((row) => {
      syncRow(row);
      if (row.dataset.k === 'in') row.classList.toggle('off', !!(draft.out[row.dataset.t]?.amt));
    });
    const R = me.rules, inT = sumOf(draft.in), outT = sumOf(draft.out);
    const errs = clientErrors();
    if (R.mode === 'initial') {
      $('sum').innerHTML = `<span>Rozděleno</span><b>${esc(fmt(inT))} / ${esc(fmtM(R.capital))}</b>`;
      renderFan(R.capital - inT, tx('play.fan.left'), R.capital);
    } else {
      $('sum').innerHTML = `<span>Vybráno ${esc(fmt(outT))}</span><b>vloženo ${esc(fmt(inT))}</b>`;
      renderFan(outT - inT, outT ? 'Zbývá vložit' : 'Max. výběr', outT ? outT : R.cashoutMax, !outT);
    }
    $('sum').classList.toggle('good', !errs.length);
    $('go').disabled = errs.length > 0 || (R.mode !== 'initial' && outT === 0);
    $('ferr').textContent = errs[0] && (inT > 0 || outT > 0) ? errs[0] : '';
    const sub = me.slip?.submitted;
    $('done').innerHTML = sub ? `<div class="done">${E('play.form.sent')}</div>` : '';
  }

  async function submit(hold) {
    $('ferr').textContent = '';
    const body = { op: 'submit', sid, pin, notes: collectNotes(), out: hold ? {} : draft.out, in: hold ? {} : draft.in };
    $('go').disabled = true;
    const r = await post(body);
    if (!r.ok) { $('ferr').textContent = r.error; updateForm(); return; }
    me.slip = { ...(me.slip || {}), out: body.out, in: body.in, submitted: true };
    if (hold) { draft = { out: {}, in: {} }; $('main').querySelectorAll('.arow').forEach(syncRow); }
    updateForm();
    $('done').innerHTML = `<div class="done">${hold ? 'Nic neměníš ✓' : E('play.form.invested')}</div>`;
  }

  function renderSummary() {
    const s = me.slip;
    let html = '';
    if (s?.submitted && (Object.keys(s.in || {}).length || Object.keys(s.out || {}).length)) {
      html = `<div class="card"><h3>Tvoje rozhodnutí v bloku ${S.block}</h3>` +
        Object.entries(s.out || {}).map(([t, e]) => `<div class="slipline">Vybráno z ${esc(team(t).name)}: <b>${esc(fmt(e.amt))}</b><br><span>${esc(e.why)}</span></div>`).join('') +
        Object.entries(s.in || {}).map(([t, e]) => `<div class="slipline">${esc(team(t).name)}: <b>${esc(fmt(e.amt))}</b><br><span>${esc(e.why)}</span></div>`).join('') + '</div>';
    } else if (S.phase === 'lobby' || S.phase === 'pitch') {
      html = `<div class="card"><h3>${me.rules.mode === 'initial' ? E('play.wait.initTitle', { capital: fmt(me.rules.capital) }) : E('play.wait.rebTitle')}</h3>
        <p class="hint">${me.rules.mode === 'initial' ? E('play.wait.initHint') : E('play.wait.rebHint', { max: fmt(me.rules.cashoutMax) })}</p></div>`;
    }
    $('main').innerHTML = html;
    $('fan').classList.add('hidden');
  }

  function renderFan(remaining, label, total, idle) {
    const fan = $('fan');
    fan.classList.remove('hidden');
    const n = Math.max(0, Math.min(10, Math.ceil(remaining / 100000)));
    const bills = $('bills');
    if (bills.children.length !== 10) bills.innerHTML = Array.from({ length: 10 }, (_, i) => billHTML(i)).join('');
    [...bills.children].forEach((b, i) => {
      const on = i < n, k = n > 1 ? i - (n - 1) / 2 : 0;
      b.style.opacity = on ? 1 : 0;
      b.style.transform = on ? `rotate(${k * 7}deg)` : 'rotate(0deg) translateY(140px)';
    });
    $('fanlab').innerHTML = remaining > 0 ? `${esc(label)}: <b>${esc(fmt(remaining))}</b>` : idle ? '' : E('play.fan.done');
  }

  function renderMain() {
    const key = `${S.block}|${S.phase === 'betting' ? 'bet' : 'view'}|${me.rules.mode}|${me.id}|${MUP.cv()}`;
    if (key === formKey && S.phase === 'betting') return;
    formKey = key;
    if (S.phase === 'betting') buildForm(); else renderSummary();
  }

  async function tick() {
    const s = await get(auth());
    S = s;
    if (s.me) {
      me = s.me; meFail = 0;
      $('login').classList.add('hidden');
      $('game').classList.remove('hidden');
      renderHeader(); renderStatus(); renderMsgs(); renderNotes(); renderMain(); renderPortfolio();
    } else if (sid && s.meError) {
      if (++meFail >= 3) logout();
    } else if (!sid) showLogin();
  }

  loadPortraits();
  setInterval(() => { if (S && me) renderStatus(); }, 500);
  poll(tick, 2500);
})();
