// v4 regie (flag `regie`, default on): the stage-manager layer of /dealer.
// - „Režie“ tab: the class plan as a checklist (derived from the game state), the next step highlighted with its
//   one-click action (the dealer's own functions, so every confirm stays), planned minutes, „čas navíc“, an editor
//   (stored in meta.regie via op regiePlan), the last dealer actions and „Vrátit poslední“ (names what undo reverts).
// - Top bar badges + a drawer „Zdraví třídy“ from GET ?view=presence: who has not invested yet (by team, with
//   „Připomenout“ → op nudge), who is connected / dropped, empty teams, PIN-less accounts, open wall tasks.
// - Shortcuts on a laptop (N next step, T timer +1 min, Q quiz, R Režie, Z health, ? help, Esc) and a big
//   „Další krok ▶“ button at the bottom of a phone.
// dealer.js exposes window.MUPD (state + its flow functions) and calls MUPRegie.tick() / .render().
(function () {
  'use strict';
  const { esc, get, timeLeft } = MUP;
  const $ = (id) => document.getElementById(id);
  const M = () => window.MUPD;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const mins = (n) => (Number(n) || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  const ago = (ts) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? `před ${s} s` : `před ${Math.round(s / 60)} min`; };
  const mmss = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const pl = (n, a, b, c) => (n === 1 ? a : n >= 2 && n <= 4 ? b : c);
  const on = () => !!(M() && M().S && M().F('regie'));
  const tName = (id) => (M().team(id) || {}).name || id;
  const dot = (id) => `<span class="s-dot" style="background:${esc((M().team(id) || {}).color || '#7E86A8')}"></span>`;

  // ---------- plan ----------
  const KIND = {
    lobby: 'Lobby', pitch: 'Pitche týmů', bet: 'Investování', close: 'Uzavřít investování', showdown: 'Showdown',
    rj: 'Smart money RJ', quiz: 'Kvíz', next: 'Další blok', exit: 'Exit', final: 'Demo Day a rekapitulace', custom: 'Vlastní krok',
  };
  const BLOCKED = ['lobby', 'pitch', 'bet', 'close', 'showdown', 'rj', 'quiz', 'next'];
  function defaultPlan(from, to) {
    const S = M().S, F = M().F, n = Math.max(1, S.teams.length), out = [];
    from = Math.max(1, from || 1); to = Math.min(S.maxBlock, Math.max(from, to || S.maxBlock));
    for (let b = from; b <= to; b++) {
      out.push({ id: 'l' + b, k: 'lobby', b, min: b === from ? 5 : 2, ...(b === from ? { label: 'Lobby a registrace' } : {}) });
      out.push({ id: 'p' + b, k: 'pitch', b, min: 2 * n });
      out.push({ id: 'i' + b, k: 'bet', b, min: 6 });
      out.push({ id: 'c' + b, k: 'close', b, min: 0.5 });
      out.push({ id: 's' + b, k: 'showdown', b, min: 3 });
      out.push({ id: 'r' + b, k: 'rj', b, min: 3 });
      if (b === from && F('quiz')) out.push({ id: 'q' + b, k: 'quiz', b, min: 8 });
      if (b < to) out.push({ id: 'n' + b, k: 'next', b, min: 1 });
    }
    if (F('exit')) out.push({ id: 'ex', k: 'exit', min: 5 });
    out.push({ id: 'fin', k: 'final', min: 5 });
    return out;
  }
  let planCache = null; // the last plan the server confirmed (meta.regie.plan) – the dump carries it every 3rd tick
  function plan() {
    const D = M().D, m = D?.dump?.meta;
    if (m) planCache = m.regie && Array.isArray(m.regie.plan) ? m.regie.plan : null;
    if (planCache && planCache.length) return planCache;
    // no saved plan: today's class = the block it started in and the next one, then exit / Demo Day
    // (pinned per game on this laptop, so the plan does not shift when the block changes)
    const S = M().S, l = local();
    if (!(l.from >= 1) || S.block > l.from + 1 || S.block < l.from) { l.from = S.block; saveLocal(l); }
    return defaultPlan(l.from, Math.min(S.maxBlock, l.from + 1));
  }

  // local per-game state: manual ticks and when each step started
  const lkey = () => 'mup.regie.' + (M().S.gid || 'x');
  const local = () => ls.get(lkey()) || { ticks: [], started: {} };
  const saveLocal = (l) => ls.set(lkey(), l);
  function tick(id, v) { const l = local(); l.ticks = l.ticks.filter((x) => x !== id); if (v) l.ticks.push(id); saveLocal(l); }

  const quizLive = () => { const q = M().S.quiz || {}; return M().F('quiz') && ['question', 'reveal', 'board'].includes(q.state); };
  function status(st, ticks) {
    const S = M().S, D = M().D, blk = S.block, ph = S.phase;
    const sc = !!D.settled[blk + 'c'], sr = !!D.settled[blk + 'r'];
    // a running quiz is "now"; model() then ticks it, so it counts as done once the quiz is over
    if (st.k === 'quiz' && quizLive() && (st.b || blk) === blk && ph !== 'final') return 'now';
    if (ticks.includes(st.id)) return 'done';
    if (st.k === 'final') return ph === 'final' ? 'now' : 'todo';
    if (ph === 'final') return 'done';
    if (st.k === 'custom' || st.k === 'exit') return 'todo';
    const b = st.b || blk;
    if (st.k === 'quiz') return b < blk ? 'done' : 'todo';
    if (b < blk) return 'done';
    if (b > blk) return 'todo';
    const started = sc || ['betting', 'closed'].includes(ph);
    switch (st.k) {
      case 'lobby': return ph === 'lobby' && !sc ? 'now' : 'done';
      case 'pitch': return ph === 'pitch' && M().nextPitchTeam() ? 'now' : started || ph === 'pitch' ? 'done' : 'todo';
      case 'bet': return ph === 'betting' && !sc ? 'now' : started ? 'done' : 'todo';
      case 'close': return ph === 'closed' || sc ? 'done' : 'todo';
      case 'showdown': return sc ? 'done' : 'todo';
      case 'rj': return sr ? 'done' : 'todo';
      case 'next': return 'todo';
    }
    return 'todo';
  }
  function actionOf(st) {
    const m = M(), S = m.S, D = m.D;
    switch (st.k) {
      case 'lobby': return { label: 'Lobby', run: () => m.act('phase', { phase: 'lobby' }) };
      case 'pitch': { const t = m.nextPitchTeam(); return t ? { label: `Pitch: ${t.name}`, run: () => m.startPitch(t.id) } : { label: 'Pitche hotové', run: () => tickRun(st) }; }
      case 'bet': return { label: 'Otevřít investování', run: m.openBetting, off: !!D.settled[S.block + 'c'] };
      case 'close': return { label: 'Zavřít investování', run: m.closeBetting, off: S.phase !== 'betting' };
      case 'showdown': return { label: 'Showdown', run: m.doShowdown, off: !['betting', 'closed'].includes(S.phase) || !!D.settled[S.block + 'c'] };
      case 'rj': return D.rj?.slip?.submitted
        ? { label: 'Odhalit smart money', run: m.doRjReveal, off: !D.settled[S.block + 'c'] || !!D.settled[S.block + 'r'] }
        : { label: 'Zadat smart money', run: () => m.setTab('rj') };
      case 'quiz': if (quizLive()) { const ns = m.nextStep(); return { label: ns.label, run: ns.run }; }
        return { label: 'Spustit kvíz', run: () => { m.setTab('kviz'); return m.quiz('quizStart'); }, off: !m.F('quiz') };
      case 'next': return { label: 'Další blok', run: m.doNext, off: S.block >= S.maxBlock };
      case 'exit': return { label: 'Otevřít exit', run: () => { m.setTab('oceneni'); tick(st.id, true); } };
      case 'final': return { label: 'Demo Day', run: m.doFinal, off: S.phase === 'final' };
      default: return { label: 'Hotovo ✓', run: () => tickRun(st) };
    }
  }
  function tickRun(st) { tick(st.id, true); paint(true); }
  function stepLabel(st) { return st.label || (st.k === 'lobby' && st.b === 1 ? 'Lobby a registrace' : KIND[st.k] || st.k); }

  // everything the views need, computed once per tick
  function model() {
    const P = plan(), l = local(), ticks = l.ticks || [];
    const rows = P.map((st, i) => ({ st, i, s: status(st, ticks) }));
    let last = -1;
    rows.forEach((r) => { if (r.s !== 'todo') last = r.i; });
    const now = rows.find((r) => r.s === 'now') || null;
    if (now && now.st.k === 'quiz' && !ticks.includes(now.st.id)) { l.ticks = [...ticks, now.st.id]; saveLocal(l); }
    let sug = now && ['pitch', 'quiz'].includes(now.st.k) ? now : rows.find((r) => r.i > last && r.s === 'todo') || null;
    if (!sug && now) sug = now;
    const cur = now || sug;
    // when did the current step start? (first time this session saw it as current; kept in localStorage)
    if (cur && !l.started[cur.st.id]) { l.started[cur.st.id] = Date.now(); saveLocal(l); }
    const startedAt = cur ? l.started[cur.st.id] : null;
    const rest = rows.filter((r) => r.s === 'todo' && r !== cur).reduce((a, r) => a + (Number(r.st.min) || 0), 0);
    return { P, rows, now, sug, cur, startedAt, rest, ticks };
  }
  function overtime(m) {
    if (!m.cur || !m.startedAt) return { el: 0, over: 0, plan: 0 };
    const el = Date.now() - m.startedAt, planMs = (Number(m.cur.st.min) || 0) * 60000;
    return { el, plan: planMs, over: planMs > 0 ? el - planMs : 0 };
  }

  // ---------- health (GET ?view=presence) ----------
  let HL = null, hlAt = 0, hlBusy = false;
  async function loadHealth() {
    if (!on() || hlBusy) return;
    hlBusy = true;
    try {
      const j = await get(M().H(), '?view=presence');
      if (j && j.ok) { HL = j; hlAt = Date.now(); }
      else if (j && j.error) HL = null;
    } catch {} finally { hlBusy = false; }
    paint();
  }
  const pendingBets = () => { const S = M().S; return ['betting', 'closed'].includes(S.phase) && !M().D.settled[S.block + 'c']; };

  // ---------- top bar badges ----------
  function badges(m) {
    let box = $('rghb');
    if (!on()) { if (box) box.hidden = true; return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'rghb'; box.className = 'rg-hb';
      const st = document.querySelector('.bar-st');
      if (!st) return;
      st.appendChild(box);
      box.addEventListener('click', (e) => { if (e.target.closest('button')) openDrawer(); });
    }
    box.hidden = false;
    const ot = overtime(m), out = [];
    if (ot.over > 0) out.push(`<button type="button" class="rg-b bad" title="Aktuální krok trvá déle, než je v plánu">čas navíc +${mmss(ot.over)}</button>`);
    if (HL) {
      const miss = HL.notSubmitted.length, n = HL.players.length;
      if (pendingBets() && n) out.push(`<button type="button" class="rg-b ${miss ? 'warn' : 'ok'}" title="Kdo ještě neinvestoval">${miss ? `chybí ${miss}` : 'všichni investovali'}</button>`);
      out.push(`<button type="button" class="rg-b" title="Mobily s otevřenou hrou (posledních ${HL.window} s)"><span class="rg-live"></span>online ${HL.online}/${n}</button>`);
      if (HL.dropped.length) out.push(`<button type="button" class="rg-b bad" title="Byli připojení, ale teď se nehlásí">vypadlo ${HL.dropped.length}</button>`);
      const iss = HL.emptyTeams.length + HL.noPin.length;
      if (iss) out.push(`<button type="button" class="rg-b warn" title="Týmy bez členů a účty bez PINu">⚠ ${iss}</button>`);
    } else out.push('<button type="button" class="rg-b" title="Zdraví třídy">zdraví třídy</button>');
    const html = out.join('');
    if (box.innerHTML !== html) box.innerHTML = html;
    const tb = document.querySelector('[data-badge="regie"]');
    if (tb) { tb.textContent = ot.over > 0 ? '+' + mmss(ot.over) : ''; tb.className = 'tb ' + (ot.over > 0 ? 'rg-over' : ''); }
  }

  // ---------- drawer ----------
  let drawerOpen = false, via = ls.get('mup.regie.via') || 'wall';
  function openDrawer() { drawerOpen = true; loadHealth(); paintDrawer(true); setTimeout(() => $('rgdclose')?.focus(), 30); }
  function closeDrawer() { drawerOpen = false; const d = $('rgdrawer'); if (d) d.hidden = true; }
  function paintDrawer(force) {
    let d = $('rgdrawer');
    if (!drawerOpen) { if (d) d.hidden = true; return; }
    if (!d) {
      d = document.createElement('div');
      d.id = 'rgdrawer'; d.className = 'rg-drawer';
      d.innerHTML = '<div class="rg-scrim" data-rgclose></div><aside class="rg-sheet" role="dialog" aria-modal="true" aria-labelledby="rgdh"><div class="rg-sh"><h3 id="rgdh">Zdraví třídy</h3><button type="button" class="s-btn s-sm s-ghost" id="rgdclose" data-rgclose aria-label="Zavřít">✕</button></div><div class="rg-sb" id="rgdbody"></div></aside>';
      document.body.appendChild(d);
      d.addEventListener('click', onDrawerClick);
      d.addEventListener('change', (e) => { if (e.target.id === 'rgvia') { via = e.target.value; ls.set('mup.regie.via', via); } });
    }
    d.hidden = false;
    const body = $('rgdbody');
    const html = healthHTML(true);
    if (force || body.dataset.sig !== html) { body.innerHTML = html; body.dataset.sig = html; }
  }
  function healthHTML(full) {
    if (!HL) return '<p class="s-muted">Načítám…</p>';
    const S = M().S, wallOn = HL.wall;
    const miss = HL.teams.filter((t) => t.missing.length);
    const live = pendingBets();
    const names = (a) => a.map((x) => esc(x)).join(', ');
    const sec = (title, n, body, cls = '') => `<section class="rg-sec ${cls}"><div class="rg-st"><b>${title}</b>${n !== null ? `<span class="rg-n">${n}</span>` : ''}</div>${body}</section>`;
    const viaSel = wallOn ? `<label class="rg-via">Připomínka jako <select id="rgvia" class="s-input sm"><option value="wall" ${via === 'wall' ? 'selected' : ''}>úkol na nástěnce</option><option value="msg" ${via === 'msg' ? 'selected' : ''}>zpráva týmu</option></select></label>` : '<span class="s-faint">Připomínka přijde jako zpráva týmu.</span>';
    const settled = !!M().D.settled[S.block + 'c'];
    const missBody = !HL.players.length ? '<p class="s-faint">Zatím se nikdo nepřihlásil.</p>'
      : settled ? `<p class="s-faint">Showdown bloku ${S.block} už proběhl${miss.length ? ` – neinvestovalo ${HL.notSubmitted.length} ${pl(HL.notSubmitted.length, 'student', 'studenti', 'studentů')}` : ''}. Připomínky se pošlou v\u00a0dalším bloku.</p>`
      : !miss.length ? '<p class="s-up">Všichni v tomto bloku investovali.</p>'
        : `${live ? '' : '<p class="s-faint">Investování teď neběží – seznam je pro blok ' + S.block + '.</p>'}
          <div class="rg-nudgebar">${viaSel}<button type="button" class="s-btn s-sm" data-nudge="*">Připomenout všem</button></div>
          ${miss.map((t) => `<div class="rg-team"><div class="rg-tn">${dot(t.id)}<b>${esc(t.name)}</b><span class="s-faint">${t.missing.length}/${t.members}</span></div><div class="rg-names">${names(t.missing)}</div><button type="button" class="s-btn s-sm s-ghost" data-nudge="${esc(t.id)}">Připomenout</button></div>`).join('')}`;
    const byTeam = (a) => a.map((r) => `<span class="rg-chip">${dot(r.team)}${esc(r.name)}${r.seen ? ` <span class="s-faint">${esc(ago(r.seen))}</span>` : ''}</span>`).join('');
    const conn = `<p class="rg-big"><b>${HL.online}</b> z ${HL.players.length} ${pl(HL.players.length, 'mobilu', 'mobilů', 'mobilů')} má hru otevřenou</p>
      ${HL.dropped.length ? `<div class="rg-lab">Vypadli (${HL.dropped.length})</div><div class="rg-chips">${byTeam(HL.dropped)}</div>` : ''}
      ${HL.never.length ? `<div class="rg-lab">Bez spojení (${HL.never.length})</div><div class="rg-chips">${byTeam(HL.never)}</div>` : ''}
      <p class="s-faint rg-note">Mobil se ozve každých 30 s, když je hra na obrazovce. Zamčený telefon se počítá jako vypadlý.</p>`;
    const empty = HL.emptyTeams.length ? `<div class="rg-chips">${HL.emptyTeams.map((id) => `<span class="rg-chip">${dot(id)}${esc(tName(id))}</span>`).join('')}</div>` : '<p class="s-faint">Každý tým má aspoň jednoho člena.</p>';
    const nopin = HL.noPin.length ? `<div class="rg-chips">${byTeam(HL.noPin)}</div><p class="s-faint rg-note">Účty z doby před PINy. PIN si nastaví při příštím přihlášení, nebo jim pošlete QR v <button type="button" class="linkb" data-goto="hraci" data-rgclose>Hráčích</button>.</p>` : '<p class="s-faint">Všechny účty mají PIN.</p>';
    const tasks = wallOn ? (HL.teams.some((t) => t.tasks) ? HL.teams.filter((t) => t.tasks).map((t) => `<div class="rg-team"><div class="rg-tn">${dot(t.id)}<b>${esc(t.name)}</b><span class="rg-n">${t.tasks}</span></div><div class="rg-names s-faint">${t.taskTexts.map((x) => esc(x)).join(' · ')}</div></div>`).join('') + '<button type="button" class="linkb" data-goto="walls" data-rgclose>Otevřít nástěnky →</button>' : '<p class="s-faint">Žádné otevřené úkoly.</p>') : '<p class="s-faint">Nástěnky jsou vypnuté.</p>';
    return sec(`Neinvestovali · blok ${S.block}`, HL.notSubmitted.length, missBody, live && HL.notSubmitted.length ? 'hot' : '')
      + sec('Připojení', null, conn)
      + (full || HL.emptyTeams.length ? sec('Týmy bez členů', HL.emptyTeams.length, empty) : '')
      + (full || HL.noPin.length ? sec('Staré účty bez PINu', HL.noPin.length, nopin) : '')
      + sec('Otevřené úkoly na nástěnkách', wallOn ? HL.teams.reduce((a, t) => a + t.tasks, 0) : null, tasks)
      + `<p class="s-faint rg-note">Aktualizováno ${hlAt ? esc(ago(hlAt)) : '–'}.</p>`;
  }
  async function nudge(team) {
    if (!HL) return;
    const v = HL.wall ? via : 'msg';
    const teams = team === '*' ? HL.teams.filter((t) => t.missing.length) : HL.teams.filter((t) => t.id === team);
    if (!teams.length) return;
    const how = v === 'wall' ? 'jako úkol na nástěnku' : 'jako soukromou zprávu týmu';
    const txt = team === '*' ? `Poslat připomínku ${teams.length} ${pl(teams.length, 'týmu', 'týmům', 'týmům')} ${how}?\n\n` + teams.map((t) => `${t.name}: „Ještě vám chybí investice od: ${t.missing.join(', ')}“`).join('\n')
      : `Poslat týmu ${teams[0].name} ${how}:\n\n„Ještě vám chybí investice od: ${teams[0].missing.join(', ')}“`;
    if (!confirm(txt)) return;
    const r = await M().act('nudge', team === '*' ? { all: true, via: v } : { team, via: v });
    if (r.ok) M().toast(`Připomínka odeslána (${r.sent.length} ${pl(r.sent.length, 'tým', 'týmy', 'týmů')})`);
    loadHealth();
  }
  function onDrawerClick(e) {
    const n = e.target.closest('[data-nudge]');
    if (n) { nudge(n.dataset.nudge); return; }
    if (e.target.closest('[data-rgclose]')) closeDrawer();
  }

  // ---------- recent actions + undo ----------
  const PHL = { lobby: 'Lobby', pitch: 'Pitch', betting: 'Otevřít investování', closed: 'Zavřít investování', final: 'Demo Day' };
  const OPL = {
    showdown: 'Showdown', rjReveal: 'Odhalení smart money', rjSave: 'Uložení smart money', revalue: 'Přecenění', nextBlock: 'Další blok',
    reg: 'Registrace', features: 'Funkce', quizStart: 'Start kvízu', quizNext: 'Další otázka', quizReveal: 'Odhalení odpovědi', quizBoard: 'Žebříček kvízu',
    quizEnd: 'Konec kvízu', quizAdvance: 'Kvíz – další krok', quizSave: 'Uložení kvízu', quizDelete: 'Smazání kvízu', pointsAdd: 'Přidání bodů', pointsRemove: 'Odebrání bodů',
    award: 'Ocenění', awardRemove: 'Odebrání ocenění', marketCard: 'Karta trhu', trancheAdd: 'Nová tranše RJ', trancheCancel: 'Zrušení tranše', trancheRelease: 'Uvolnění tranše',
    exitSet: 'Exit', wallPost: 'Lísteček na nástěnku', wallReply: 'Odpověď na nástěnce', wallDone: 'Úkol na nástěnce', wallDelete: 'Smazání lístečku', ghost: 'Ghost účet',
    reset: 'Nová hra', nudge: 'Připomínka týmu', card: 'Karta startupu', milestoneDefs: 'Milníky', roundTerms: 'Podmínky kola', teams: 'Týmy', content: 'Texty',
    startValuation: 'Startovní ocenění', archive: 'Archiv', archiveDelete: 'Smazání archivu', clearBoard: 'Vyčištění otázek', loginLink: 'QR přihlášení', resetPin: 'Reset PINu',
    movePlayer: 'Přesun hráče', removePlayer: 'Odebrání hráče', pin: 'Připnutí otázky', qpin: 'Otázka na plátno', qhide: 'Skrytí otázky', unpin: 'Odepnutí', undo: 'Vrácení kroku',
  };
  function opLabel(a) {
    if (!a) return '';
    if (a.label) return a.label; // the server names it (meta.regieLog)
    if (a.op === 'phase') return (PHL[a.phase] || a.phase) + (a.phase === 'pitch' && a.team ? ': ' + tName(a.team) : '');
    if (a.op === 'timer') return Number(a.minutes) > 0 ? `Časovač ${mins(a.minutes)} min${a.label ? ' (' + a.label + ')' : ''}` : 'Zastavení časovače';
    if (a.op === 'screen') return a.screen === 'board' ? 'Plátno: žebříček' : 'Plátno: stůl';
    if (a.op === 'undo') return 'Vráceno: ' + (a.of ? opLabel(a.of) : 'poslední krok');
    if (a.op === 'nudge') return 'Připomínka ' + (a.all ? 'všem týmům' : a.team ? 'týmu ' + tName(a.team) : '');
    return OPL[a.op] || a.op;
  }
  const ORIG_UNDO = 'Vrátit poslední krok? Zruší se poslední showdown, odhalení, přecenění nebo přechod na další blok.';
  async function undo() {
    const top = HL && HL.undoTop;
    const q = top ? `Vrátit poslední krok: ${opLabel(top)} (${hhmm(top.ts)})?\n\nVrátí se peníze, valuace a fáze hry do stavu před ním. Kvíz, body, udělená ocenění a nastavení zůstanou.` : ORIG_UNDO;
    if (!confirm(q)) return;
    const r = await M().act('undo', {}, top ? 'Vráceno: ' + opLabel(top) : 'Vráceno');
    if (r.ok) loadHealth();
  }
  let undoHooked = false, origUndo = null;
  function hookUndo() {
    const b = $('bundo');
    if (!b) return;
    if (on() && !undoHooked) { origUndo = b.onclick; b.onclick = undo; undoHooked = true; }
    else if (!on() && undoHooked) { b.onclick = origUndo; undoHooked = false; }
    if (undoHooked) b.title = HL && HL.undoTop ? `Vrátit: ${opLabel(HL.undoTop)} (${hhmm(HL.undoTop.ts)})` : 'Vrátit poslední krok';
  }

  // ---------- next step ----------
  async function runNext() {
    if (!on()) return;
    const m = model();
    if (!m.sug) return M().toast('Plán je hotový.');
    const a = actionOf(m.sug.st);
    if (a.off || !a.run) return M().toast(`„${a.label}“ teď nejde – zkontrolujte stav hry.`, true);
    await a.run();
    setTimeout(loadHealth, 400);
  }
  async function timerPlus() {
    const S = M().S, left = timeLeft(S) || 0;
    const r = await M().act('timer', { minutes: left / 60000 + 1, label: S.timerLabel || 'Časovač' });
    if (r.ok) M().toast(left ? 'Časovač +1 min' : 'Časovač 1 min');
  }

  // ---------- Režie tab ----------
  let editing = null; // a draft copy of the plan while the editor is open
  function panelHTML(m) {
    const S = M().S;
    const ot = overtime(m);
    const a = m.sug ? actionOf(m.sug.st) : null;
    const pct = ot.plan ? Math.min(100, (ot.el / ot.plan) * 100) : 0;
    const endAt = Date.now() + Math.max(0, ot.plan - ot.el) + m.rest * 60000;
    const head = `<div class="s-card rg-next">
      <div class="rg-nk"><span class="s-label">${m.now ? 'Teď' : 'Na řadě'}</span><b>${m.cur ? esc(stepLabel(m.cur.st)) + (m.cur.st.b ? ` <span class="s-faint">· blok ${m.cur.st.b}</span>` : '') : 'Plán je hotový'}</b></div>
      ${m.cur ? `<div class="rg-clock"><span id="rgel">${mmss(ot.el)}</span><span class="s-faint"> / ${ot.plan ? mmss(ot.plan) : '–'}</span><span id="rgover" class="rg-over" ${ot.over > 0 ? '' : 'hidden'}>čas navíc +${mmss(Math.max(0, ot.over))}</span></div>
      <div class="rg-bar" aria-hidden="true"><i id="rgbar" style="width:${pct}%" class="${ot.over > 0 ? 'over' : ''}"></i></div>` : ''}
      <button type="button" class="s-btn s-primary s-block rg-go" id="rgnext" ${a && !a.off ? '' : 'disabled'}>${a ? 'Další krok ▶ ' + esc(a.label) : 'Hotovo'}</button>
      <div class="rg-meta s-faint">${m.rest || ot.plan ? `Podle plánu zbývá ~${mins(Math.round((Math.max(0, ot.plan - ot.el) / 60000 + m.rest) * 2) / 2)} min · konec kolem ${hhmm(endAt)}` : ''}<span class="rg-keys">Zkratky: <kbd>N</kbd> další krok · <kbd>T</kbd> +1 min · <kbd>?</kbd> nápověda</span></div>
    </div>`;
    const list = editing ? editorHTML() : planHTML(m);
    const acts = HL ? HL.actions.slice(0, 5) : [];
    const side = `<div class="s-card rg-health"><div class="ch"><h3>Zdraví třídy</h3><button type="button" class="s-btn s-sm s-ghost" id="rgopen">Podrobně</button></div>${healthHTML(false)}</div>
      <div class="s-card rg-acts"><div class="ch"><h3>Poslední akce</h3></div>
        ${acts.length ? `<ol class="rg-al">${acts.map((x) => `<li><span class="rg-t">${hhmm(x.ts)}</span><span>${esc(opLabel(x))}</span></li>`).join('')}</ol>` : '<p class="s-faint">Zatím žádné akce.</p>'}
        <button type="button" class="s-btn s-sm s-danger" id="rgundo">↶ Vrátit poslední${HL && HL.undoTop ? `: ${esc(opLabel(HL.undoTop))} (${hhmm(HL.undoTop.ts)})` : ''}</button>
        <p class="s-faint rg-note">Vrátit jde showdown, smart money, přecenění, karta trhu, tranše a další blok. Kvíz, body a nastavení zůstanou.</p>
      </div>`;
    return `${head}<div class="rg-cols"><div class="s-card rg-plan">${list}</div><div class="rg-side">${side}</div></div>`;
  }
  function planHTML(m) {
    const S = M().S;
    const groups = [];
    for (const r of m.rows) {
      const g = r.st.b ? 'Blok ' + r.st.b : 'Závěr';
      if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, b: r.st.b, rows: [] });
      groups[groups.length - 1].rows.push(r);
    }
    const total = m.P.reduce((a, s) => a + (Number(s.min) || 0), 0);
    const row = (r) => {
      const isSug = m.sug === r, a = actionOf(r.st);
      const icon = r.s === 'done' ? '✓' : r.s === 'now' ? '●' : r.i + 1;
      return `<li class="rg-row ${r.s} ${isSug ? 'sug' : ''}" data-step="${esc(r.st.id)}">
        <span class="rg-i" aria-hidden="true">${icon}</span>
        <span class="rg-l">${esc(stepLabel(r.st))}${r.s === 'now' ? ' <span class="s-badge s-ok">teď</span>' : ''}${isSug && r.s !== 'now' ? ' <span class="s-badge">další</span>' : ''}</span>
        <span class="rg-m">${r.st.min ? mins(r.st.min) + ' min' : ''}</span>
        <span class="rg-c">${r.s === 'todo' || (r.s === 'now' && isSug) ? `<button type="button" class="s-btn s-sm ${isSug ? 's-primary' : 's-ghost'}" data-run="${esc(r.st.id)}" ${a.off ? 'disabled' : ''}>${esc(a.label)}</button>` : ''}
          <button type="button" class="rg-tick" data-tick="${esc(r.st.id)}" aria-label="${r.s === 'done' ? 'Označit jako nehotové' : 'Označit jako hotové'}" title="${r.s === 'done' ? 'Zrušit ruční odškrtnutí' : 'Odškrtnout ručně'}">${m.ticks.includes(r.st.id) ? '↺' : '✓'}</button></span>
      </li>`;
    };
    return `<div class="ch"><h3>Plán hodiny</h3><span class="s-label">${m.P.length} kroků · ${mins(total)} min</span><button type="button" class="s-btn s-sm s-ghost" id="rgedit">Upravit plán</button></div>
      ${groups.map((g) => {
        const doneAll = g.rows.every((r) => r.s === 'done');
        const cur = g.b === S.block || g.rows.some((r) => r === m.sug || r.s === 'now');
        return `<details class="rg-g" ${!doneAll || cur ? 'open' : ''}><summary><b>${esc(g.g)}</b>${doneAll ? ' <span class="s-up">✓ hotovo</span>' : ''}<span class="s-faint"> · ${mins(g.rows.reduce((a, r) => a + (Number(r.st.min) || 0), 0))} min</span></summary><ol class="rg-steps">${g.rows.map(row).join('')}</ol></details>`;
      }).join('')}`;
  }
  function editorHTML() {
    const S = M().S;
    const blocks = Array.from({ length: S.maxBlock }, (_, i) => i + 1);
    const opt = (v, cur) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${v}</option>`;
    return `<div class="ch"><h3>Upravit plán</h3><span class="s-label">${editing.length} kroků · ${mins(editing.reduce((a, s) => a + (Number(s.min) || 0), 0))} min</span></div>
      <div class="rg-gen"><span>Výchozí plán pro bloky</span><select class="s-input sm" id="rggf" aria-label="Od bloku">${blocks.map((b) => opt(b, S.block)).join('')}</select>–<select class="s-input sm" id="rggt" aria-label="Do bloku">${blocks.map((b) => opt(b, Math.min(S.maxBlock, S.block + 1))).join('')}</select><button type="button" class="s-btn s-sm s-ghost" id="rggen">Vygenerovat</button></div>
      <ol class="rg-ed">${editing.map((s, i) => `<li data-ei="${i}">
        <span class="rg-ek">${esc(KIND[s.k] || s.k)}${s.b ? ' · ' + s.b : ''}</span>
        <input class="s-input sm" data-ef="label" value="${esc(s.label || '')}" placeholder="${esc(stepLabel({ ...s, label: '' }))}" maxlength="60" aria-label="Název kroku ${i + 1}">
        <span class="unit"><input class="s-input sm num" data-ef="min" value="${esc(mins(s.min))}" inputmode="decimal" aria-label="Minuty kroku ${i + 1}"> min</span>
        <span class="rg-eb"><button type="button" class="s-btn s-sm s-ghost" data-em="-1" aria-label="Posunout nahoru" ${i ? '' : 'disabled'}>↑</button><button type="button" class="s-btn s-sm s-ghost" data-em="1" aria-label="Posunout dolů" ${i < editing.length - 1 ? '' : 'disabled'}>↓</button><button type="button" class="s-btn s-sm s-ghost" data-ed aria-label="Smazat krok">✕</button></span>
      </li>`).join('')}</ol>
      <div class="rg-add"><select class="s-input sm" id="rgak" aria-label="Druh kroku">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${k === 'custom' ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <select class="s-input sm" id="rgab" aria-label="Blok">${blocks.map((b) => opt(b, S.block)).join('')}</select>
        <button type="button" class="s-btn s-sm s-ghost" id="rgadd">+ Přidat krok</button></div>
      <div class="rg-eact"><button type="button" class="s-btn s-sm s-primary" id="rgsave">Uložit plán</button><button type="button" class="s-btn s-sm s-ghost" id="rgcancel">Zrušit</button><button type="button" class="s-btn s-sm s-ghost" id="rgdef">Obnovit výchozí</button></div>`;
  }
  function readEditor() {
    document.querySelectorAll('#rgpanel [data-ei]').forEach((li) => {
      const s = editing[Number(li.dataset.ei)];
      if (!s) return;
      s.label = li.querySelector('[data-ef="label"]').value.trim();
      s.min = Math.max(0, Number(String(li.querySelector('[data-ef="min"]').value).replace(',', '.')) || 0);
    });
  }
  async function onPanelClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const m = model();
    if (b.id === 'rgnext') return runNext();
    if (b.id === 'rgopen') return openDrawer();
    if (b.id === 'rgundo') return undo();
    if (b.dataset.nudge) return nudge(b.dataset.nudge);
    if (b.dataset.run) { const r = m.rows.find((x) => x.st.id === b.dataset.run); if (r) { const a = actionOf(r.st); if (!a.off) { await a.run(); setTimeout(loadHealth, 400); } } return; }
    if (b.dataset.tick) { const id = b.dataset.tick; tick(id, !m.ticks.includes(id)); return paint(true); }
    if (b.id === 'rgedit') { editing = structuredClone(m.P); return paint(true); }
    if (!editing) return;
    readEditor();
    if (b.id === 'rgcancel') editing = null;
    else if (b.id === 'rggen') { if (confirm('Nahradit rozpracovaný plán výchozím pro vybrané bloky?')) editing = defaultPlan(Number($('rggf').value), Number($('rggt').value)); }
    else if (b.id === 'rgadd') {
      const k = $('rgak').value, blk = Number($('rgab').value);
      editing.push({ id: k[0] + Date.now().toString(36).slice(-5), k, ...(BLOCKED.includes(k) ? { b: blk } : {}), min: 5, ...(k === 'custom' ? { label: 'Vlastní krok' } : {}) });
    } else if (b.dataset.em) {
      const i = Number(b.closest('[data-ei]').dataset.ei), j = i + Number(b.dataset.em);
      if (editing[j]) [editing[i], editing[j]] = [editing[j], editing[i]];
    } else if (b.dataset.ed !== undefined) editing.splice(Number(b.closest('[data-ei]').dataset.ei), 1);
    else if (b.id === 'rgsave' || b.id === 'rgdef') {
      if (b.id === 'rgdef' && !confirm('Obnovit výchozí plán? Vaše úpravy plánu se smažou.')) return;
      const r = await M().act('regiePlan', { plan: b.id === 'rgdef' ? null : editing }, b.id === 'rgdef' ? 'Výchozí plán obnoven' : 'Plán uložen');
      if (!r.ok) return;
      planCache = b.id === 'rgdef' ? null : r.plan;
      editing = null;
    }
    paint(true);
  }

  let panelSig = '';
  function paintPanel(m, force) {
    const el = $('rgpanel');
    if (!el || M().tab !== 'regie') return;
    if (!on()) {
      const html = `<div class="s-card"><div class="off"><div><b>Režie je vypnutá.</b> Plán hodiny, zdraví třídy a připomínky se zapínají v Funkcích.</div><button class="s-btn s-sm" data-enable="regie">Zapnout</button></div></div>`;
      if (el.innerHTML !== html) el.innerHTML = html;
      panelSig = '';
      return;
    }
    if (editing && !force) return; // never re-render under the organiser's hands
    const a = document.activeElement;
    if (!force && a && el.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    const html = panelHTML(m);
    const sig = html.replace(/id="rgel">[^<]*|id="rgover"[^>]*>[^<]*|width:[\d.]+%|Podle plánu zbývá[^<]*|Aktualizováno[^<]*|před \d+ (s|min)/g, '');
    if (!force && sig === panelSig) return;
    panelSig = sig;
    const open = [...el.querySelectorAll('details.rg-g')].map((d) => d.open);
    el.innerHTML = html;
    if (!force && open.length) el.querySelectorAll('details.rg-g').forEach((d, i) => { if (open[i] !== undefined && !d.querySelector('.sug, .now')) d.open = open[i]; });
  }
  function tickClock() {
    if (!on()) return;
    const m = model(), ot = overtime(m);
    const el = $('rgel');
    if (el) {
      el.textContent = mmss(ot.el);
      const ov = $('rgover');
      if (ov) { ov.hidden = !(ot.over > 0); ov.textContent = 'čas navíc +' + mmss(Math.max(0, ot.over)); }
      const bar = $('rgbar');
      if (bar) { bar.style.width = (ot.plan ? Math.min(100, (ot.el / ot.plan) * 100) : 0) + '%'; bar.classList.toggle('over', ot.over > 0); }
    }
    badges(m);
    fab(m);
  }

  // ---------- phone: big next-step button ----------
  function fab(m) {
    let f = $('rgfab');
    const show = on() && !editing;
    if (!f) {
      if (!show) return;
      f = document.createElement('div');
      f.id = 'rgfab'; f.className = 'rg-fab';
      f.innerHTML = '<button type="button" class="s-btn s-primary" id="rgfabb"></button>';
      document.body.appendChild(f);
      f.querySelector('button').onclick = runNext;
    }
    f.hidden = !show;
    document.body.classList.toggle('rg-hasfab', show);
    if (!show) return;
    const a = m.sug ? actionOf(m.sug.st) : null;
    const b = $('rgfabb');
    const t = a ? 'Další krok ▶ ' + a.label : 'Plán je hotový';
    if (b.textContent !== t) b.textContent = t;
    b.disabled = !a || !!a.off;
  }

  // ---------- help overlay + shortcuts ----------
  function help(open) {
    let h = $('rghelp');
    if (!open) { if (h) h.hidden = true; return; }
    if (!h) {
      h = document.createElement('div');
      h.id = 'rghelp'; h.className = 'rg-drawer rg-help';
      h.innerHTML = `<div class="rg-scrim" data-rgh></div><div class="rg-hcard s-card" role="dialog" aria-modal="true" aria-labelledby="rghh">
        <div class="rg-sh"><h3 id="rghh">Klávesové zkratky</h3><button type="button" class="s-btn s-sm s-ghost" data-rgh aria-label="Zavřít">✕</button></div>
        <dl class="rg-kl">
          <dt><kbd>N</kbd></dt><dd>Další krok podle plánu (potvrzení zůstávají)</dd>
          <dt><kbd>T</kbd></dt><dd>Časovač +1 minuta (bez časovače spustí 1 minutu)</dd>
          <dt><kbd>Q</kbd></dt><dd>Záložka Kvíz</dd>
          <dt><kbd>R</kbd></dt><dd>Záložka Režie</dd>
          <dt><kbd>Z</kbd></dt><dd>Zdraví třídy (kdo chybí, kdo je připojený)</dd>
          <dt><kbd>?</kbd></dt><dd>Tahle nápověda</dd>
          <dt><kbd>Esc</kbd></dt><dd>Zavřít okno</dd>
          <dt><kbd>Mezerník</kbd> <kbd>→</kbd></dt><dd>V Kvízu: další krok kvízu</dd>
        </dl></div>`;
      document.body.appendChild(h);
      h.addEventListener('click', (e) => { if (e.target.closest('[data-rgh]')) help(false); });
    }
    h.hidden = false;
  }
  document.addEventListener('keydown', (e) => {
    if (!on() || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'Escape') { if ($('rghelp') && !$('rghelp').hidden) help(false); else if (drawerOpen) closeDrawer(); return; }
    const k = e.key.toLowerCase();
    if (e.key === '?') { e.preventDefault(); help(true); }
    else if (k === 'n') { e.preventDefault(); runNext(); }
    else if (k === 't') { e.preventDefault(); timerPlus(); }
    else if (k === 'q') { e.preventDefault(); M().setTab('kviz'); }
    else if (k === 'r') { e.preventDefault(); M().setTab('regie'); }
    else if (k === 'z') { e.preventDefault(); drawerOpen ? closeDrawer() : openDrawer(); }
  });

  // ---------- wiring ----------
  let wired = false, pollT = null;
  function wire() {
    if (wired) return;
    wired = true;
    $('rgpanel')?.addEventListener('click', onPanelClick);
    const poll = async () => { await loadHealth(); pollT = setTimeout(poll, document.hidden ? 15000 : 5000); };
    poll();
    setInterval(tickClock, 1000);
  }
  function paint(force) {
    if (!M() || !M().S || !M().D) return;
    const tabBtn = document.querySelector('[data-atab="regie"]');
    if (tabBtn) tabBtn.hidden = !on();
    hookUndo();
    if (!on()) { badges(null); fab(null); closeDrawer(); paintPanel(null); return; }
    const m = model();
    badges(m);
    fab(m);
    paintPanel(m, force);
    if (drawerOpen) paintDrawer();
  }
  window.MUPRegie = {
    tick() { wire(); paint(); },
    render() { paint(); },
    // for tests / the console
    _model: () => model(), _health: () => HL,
  };
})();
