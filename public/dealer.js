(function () {
  'use strict';
  const { esc, fmt, fmtM, get, post, timeLeft, clock, t: tx } = MUP;
  const E = (k, v) => esc(tx(k, v));
  const $ = (id) => document.getElementById(id);
  const all = (root, sel) => [...(root || document).querySelectorAll(sel)];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let pw = store.get('mup.dealer') || '';
  let S = null, D = null; // public + dealer state (polled)
  let DV = null; // ?view=data
  let ARCH = null; // ?view=archives (array | false when the server has no archives)
  const keys = {}, dirty = {};
  const H = () => ({ 'x-dealer': pw });

  // ---------- small helpers ----------
  const team = (id) => (S && S.teams.find((t) => t.id === id)) || { id, name: id || '—', color: '#7E86A8' };
  const parseAmt = (v) => Math.max(0, Math.round(Number(String(v).replace(/[^\d]/g, '')) || 0));
  const parseNum = (v) => Number(String(v ?? '').replace(/\s/g, '').replace('−', '-').replace(',', '.'));
  const plain = (n) => Math.round(n || 0).toLocaleString('cs-CZ');
  const nb = (s) => String(s).replace(/ | /g, ' ');
  const pct = (n, d = 1) => nb((Number(n) || 0).toLocaleString('cs-CZ', { maximumFractionDigits: d })) + ' %';
  const signPct = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + pct(Math.abs(n));
  const sgnM = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtM(Math.abs(n));
  const mil = (v) => ((v || 0) / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const when = (ts) => (ts ? new Date(ts).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const pl = (n, a, b, c) => (n === 1 ? a : n >= 2 && n <= 4 ? b : c);
  const dot = (c) => `<span class="s-dot" style="background:${esc(c)}"></span>`;
  const tname = (id) => esc(team(id).name);
  const tlabel = (id) => `<span class="tl">${dot(team(id).color)}<span>${tname(id)}</span></span>`;
  const num = (v) => Number(String(v).replace(',', '.')) || 0;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // v3 live numbers (fall back to v2 fields until the server sends them)
  const vNow = (t) => (t && Number.isFinite(t.Vnow) ? t.Vnow : t?.V || 0);
  const pendingNow = () => !!(S && D && ['betting', 'closed'].includes(S.phase) && !(D.settled || {})[S.block + 'c']);
  const multTxt = (m) => '×' + nb((Number(m) || 0).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const rankOf = (t) => {
    if (Number.isFinite(t.rank)) return t.rank;
    return 1 + S.teams.filter((x) => vNow(x) > vNow(t)).length;
  };
  const chgTxt = (c) => (Number.isFinite(c) && Math.abs(c) >= 0.0005 ? `<span class="${c > 0 ? 's-up' : 's-down'}">${c > 0 ? '▲' : '▼'}\u00a0${esc(pct(Math.abs(c) * 100, 0))}</span>` : '');
  const demandOf = (blk) => { const m = (D && (D.demand || D.meta?.demand)) || (S && (S.demand || S.meta?.demand)) || null; return (m && m[blk]) || null; };
  const liveHTML = (t, opt = {}) => {
    const m = Number(t.mult), live = pendingNow();
    return `<span class="lv${live ? ' on' : ''}"><b>${esc(fmtM(vNow(t)))}</b>${live && Number.isFinite(m) ? `<span class="lm" title="Živý násobek poptávky v tomto bloku">${esc(multTxt(m))}</span>` : ''}${opt.rank === false ? '' : `<span class="lr" title="Pořadí podle ocenění">#${rankOf(t)}</span>`}${chgTxt(t.chg)}</span>`;
  };
  const liveDeps = () => (S ? S.teams.map((t) => [t.id, t.V, t.Vnow, t.mult, t.rank, t.chg]) : []);
  const byTeamName = (a, b) => team(a.team).name.localeCompare(team(b.team).name, 'cs') || String(a.name).localeCompare(String(b.name), 'cs');

  function download(name, text, type = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const csvText = (rows) => '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');

  // ---------- labels ----------
  const PH = { lobby: 'Lobby', pitch: 'Pitch', betting: 'Investování', closed: 'Investování zavřeno', showdown: 'Showdown', rj: 'Smart money odhaleno', final: 'Demo Day' };
  const REASONS = { milestone: 'Splněný milník', traction: 'Trakce', team: 'Tým', risk: 'Riziko', market: 'Trh', other: 'Jiné' };
  const reasonLabels = () => ({ ...REASONS, ...((S && S.reasonLabels) || {}) });
  const DRK = { class: 'Třída', rj: 'RJ', revalue: 'Přecenění', round: 'Kolo', market: 'Trh', exit: 'Exit', demand: 'Poptávka' };
  const AWK = { sharpest: 'Nejlepší investor', analyst: 'Nejlepší analytik', contrarian: 'Proti proudu', custom: 'Vlastní ocenění' };
  const EXK = { acquired: 'Akvizice', ipo: 'IPO', hold: 'Bez exitu', writeoff: 'Odpis' };
  const RK = { up: 'Up round', flat: 'Flat round', down: 'Down round' };
  const FEATS = [
    ['captable', 'Cap table', 'Podíl zakladatelů, třídy a RainbowJet u každého týmu – na plátně i v mobilech.'],
    ['cards', 'Karty startupů', 'One-liner, krátký popis a splněné milníky každého týmu.'],
    ['drivers', 'Co hýbe oceněním', 'U každé změny ocenění je vidět důvod: peníze třídy, RJ, přecenění, trh.'],
    ['track', 'Track record a ocenění', 'Studenti vidí svůj výnos, pořadí a nejlepší tah; vy udělujete ocenění.'],
    ['quiz', 'Kvíz', 'Otázky na plátně, odpovědi z mobilů, body za správnost a rychlost.'],
    ['points', 'Body', 'Žebříček bodů z kvízu, ocenění a milníků; body můžete přidat i ručně.'],
    ['rounds', 'Kola financování', 'Před investováním si týmy nastaví pre-money a kurz bloku se podle ní přepočítá.'],
    ['market', 'Tržní karty', 'Události na trhu, které posunou ocenění vybraných týmů.'],
    ['tranches', 'Tranše RJ', 'RainbowJet slíbí peníze, které uvolní až po splnění podmínky.'],
    ['exit', 'Exit', 'Finále: akvizice, IPO nebo odpis a konečné pořadí investorů.'],
    ['demand', 'Cena podle poptávky', 'Jako na burze: po showdownu se cena startupu změní podle toho, kolik peněz přilákal oproti ostatním.'],
    ['quizplus', 'Kvíz+', 'Vysvětlení po odhalení, otázky za ×2, obrázky, stupně vítězů, počítadlo v\u00a0lobby a export výsledků.'],
    ['sound', 'Zvuk na plátně', 'Znělky kvízu, zvonek při otevření trhu a vířivý buben u\u00a0showdownu. Hraje jen projektor (tlačítko 🔊 v\u00a0rohu), mobily jsou vždy potichu.'],
    ['wall', 'Nástěnky týmů', 'Každý tým má soukromou nástěnku s\u00a0otázkami a úkoly od vás i od svých členů.'],
    ['startupPage', 'Detail startupu', 'Klepnutím na startup v\u00a0mobilu se otevře detail: graf ocenění, čísla, karta a proč do něj spolužáci investovali.'],
    ['wallplus', 'Nástěnky+', 'Reakce, připnutí, označená odpověď, termín a řešitel úkolu, šablony a filtry na nástěnkách.'],
    ['regie', 'Režie', 'Plán hodiny s\u00a0dalším krokem, kdo chybí a kdo je připojený, připomínky týmům, klávesové zkratky a historie akcí.'], // v4 regie
    ['tape', 'Burza na plátně', 'Při investování běží dole na plátně páska obchodů (jména jako iniciály), u\u00a0showdownu „Burza uzavřena“ s\u00a0násobky a v\u00a0pořadí malé grafy ocenění.'],
  ];
  const featKnown = () => !!(S && S.features && typeof S.features === 'object');
  const F = (k) => !!(S && S.features && S.features[k]);
  const featName = (k) => (FEATS.find((f) => f[0] === k) || [k, k])[1];

  const PRESETS = [
    { title: 'Velký konkurent vstoupil na trh', text: 'Globální hráč spustil podobný produkt a první rok ho nabízí zdarma. Investoři zpozorněli.', all: -15 },
    { title: 'Nová regulace EU', text: 'Brusel zpřísnil pravidla pro práci s daty a AI. Splnit je stojí čas i peníze.', all: -10 },
    { title: 'Virální kampaň', text: 'Video startupu má za víkend přes milion zhlédnutí. Registrace rostou.', one: 30 },
    { title: 'Výpadek cloudu', text: 'Několikahodinový výpadek velkého cloudu shodil produkty. Zákazníci se ptají, co dál.', all: -8 },
    { title: 'Fondy šetří', text: 'Úroky rostou a fondy zpomalují investice. Ocenění na trhu klesají.', all: -12 },
    { title: 'AI horečka', text: 'Investoři chtějí AI všude. Kdo ji umí ukázat v produktu, roste.', all: 12 },
    { title: 'Velký zákazník podepsal', text: 'Korporace podepsala roční pilot a chce produkt nasadit v dalších zemích.', one: 25 },
    { title: 'Odchod spoluzakladatele', text: 'Jeden ze zakladatelů opouští tým. Investoři chtějí slyšet plán.', one: -25 },
    { title: 'Únik dat', text: 'Bezpečnostní chyba odhalila data uživatelů. Média se ptají a zákazníci odcházejí.', one: -30 },
    { title: 'Grant na vývoj', text: 'Startup získal nevratnou dotaci, která pokryje půl roku vývoje.', one: 15 },
    { title: 'Konkurent skončil', text: 'Hlavní konkurent ukončil provoz. Jeho zákazníci hledají náhradu.', one: 20 },
    { title: 'Spotřebitelé šetří', text: 'Domácnosti utrácejí méně. Prodeje zpomalují napříč trhem.', all: -10 },
  ];

  // ---------- render gate: skip unchanged sections and never overwrite what the organiser is typing ----------
  function gate(id, deps) {
    const el = $(id);
    if (!el) return null;
    const j = JSON.stringify([deps, MUP.cv()]);
    if (keys[id] === j || dirty[id]) return null;
    const a = document.activeElement;
    if (a && a !== document.body && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return null;
    keys[id] = j;
    return el;
  }
  const redraw = (...ids) => ids.forEach((id) => { keys[id] = null; dirty[id] = false; });
  function watchDirty(el, id) {
    el.addEventListener('input', (e) => { if (!e.target.closest('[data-nodirty]')) dirty[id] = true; });
  }
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; return !!on; };

  // ---------- toast ----------
  let toastT = null;
  function toast(msg, bad) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('bad', !!bad);
    el.classList.add('s-show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('s-show'), bad ? 6000 : 2600);
  }
  const flash = (m) => toast(m);

  // ---------- backup on this laptop (keeps the game alive without a database) ----------
  const BK = 'mup.backup';
  const loadBk = () => { try { return JSON.parse(localStorage.getItem(BK) || 'null'); } catch { return null; } };
  const saveBk = (b) => { try { localStorage.setItem(BK, JSON.stringify(b)); } catch {} };
  function mergeBk(d) {
    if (!d?.meta) return;
    const b = loadBk();
    if (b && d.meta.auto && !b.meta.auto && b.meta.gid !== d.meta.gid) return; // server forgot the game: keep ours, guard() pushes it back
    if (!b || b.meta.gid !== d.meta.gid) { saveBk(d); return; }
    if ((d.meta.rev || 0) >= (b.meta.rev || 0)) b.meta = d.meta;
    b.players = { ...(b.players || {}), ...(d.players || {}) };
    for (const id of b.meta.removed || []) delete b.players[id];
    b.slips = b.slips || {};
    for (const [k, map] of Object.entries(d.slips || {})) {
      const cur = (b.slips[k] = b.slips[k] || {});
      for (const [id, sl] of Object.entries(map || {})) if (!cur[id] || (sl.ts || 0) >= (cur[id].ts || 0)) cur[id] = sl;
    }
    if (d.content && Number(d.content.v || 0) >= Number(b.content?.v || 0)) b.content = d.content;
    if (d.board) b.board = d.board;
    if (d.tx && typeof d.tx === 'object') {
      b.tx = b.tx || {};
      for (const [f, v] of Object.entries(d.tx)) { const c = b.tx[f]; if (!c || (v?.updatedAt || v?.ts || 0) >= (c.updatedAt || c.ts || 0)) b.tx[f] = v; }
    }
    saveBk(b);
  }
  let restoring = false;
  async function guard(j) {
    const b = loadBk();
    if (!b || restoring) return;
    const lost = j.auto && !b.meta.auto && b.meta.gid !== j.gid;
    const behind = j.gid === b.meta.gid && (j.rev || 0) < (b.meta.rev || 0);
    if (!lost && !behind) return;
    restoring = true;
    try {
      const r = await post({ op: 'restore', dump: b }, H());
      if (r.ok && r.dump) mergeBk(r.dump);
      if (r.ok && lost) flash('Hra obnovena ze zálohy');
    } finally { restoring = false; }
  }

  async function act(op, extra = {}, okMsg) {
    if (op === 'reset') store.del(BK);
    const r = await post({ op, ...extra }, H());
    if (r.dump) mergeBk(r.dump);
    if (!r.ok) { toast(r.error || 'Něco se nepovedlo.', true); return r; }
    if (okMsg) flash(okMsg);
    setTimeout(tick, 150);
    return r;
  }

  // ---------- login ----------
  async function tryLogin(p) {
    const r = await post({ op: 'auth' }, { 'x-dealer': p });
    if (r.ok) { pw = p; store.set('mup.dealer', p); start(); return true; }
    return false;
  }
  $('dgo').onclick = async () => { if (!(await tryLogin($('dpw').value))) $('derr').textContent = 'Špatné heslo.'; };
  $('dpw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dgo').click(); });

  // ---------- tabs ----------
  const TABS = ['hra', 'regie', 'investice', 'rj', 'oceneni', 'startupy', 'walls', 'kviz', 'body', 'hraci', 'funkce', 'data', 'texty'];
  let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'hra';
  function setTab(k) {
    if (!TABS.includes(k)) return;
    const changed = k !== tab;
    tab = k;
    try { history.replaceState(null, '', '#' + k); } catch {}
    all(document, '[data-atab]').forEach((b) => { b.classList.toggle('on', b.dataset.atab === k); b.setAttribute('aria-current', b.dataset.atab === k ? 'page' : 'false'); });
    all(document, '[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== k; });
    const strip = $('tabs'), btn = strip.querySelector(`[data-atab="${k}"]`);
    if (btn && strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: btn.offsetLeft - 40, behavior: 'smooth' });
    if (changed) window.scrollTo(0, 0);
    if (k !== 'walls') unmountWall();
    if (S) renderPanel();
    if (['hraci', 'body', 'data'].includes(k)) loadData();
    if (k === 'data') loadArchives();
  }
  all(document, '[data-atab]').forEach((b) => (b.onclick = () => setTab(b.dataset.atab)));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) { e.preventDefault(); setTab(g.dataset.goto); }
    const en = e.target.closest('[data-enable]');
    if (en) { e.preventDefault(); act('features', { set: { [en.dataset.enable]: true } }, `${featName(en.dataset.enable)}: zapnuto`); }
  });
  const offCard = (k, what) => `<div class="off"><div><b>${esc(featName(k))} je vypnutý.</b> ${esc(what || '')}</div>${featKnown() ? `<button class="s-btn s-sm" data-enable="${k}">Zapnout</button>` : '<span class="s-badge">server zatím nepodporuje</span>'}</div>`;

  // ---------- game flow ----------
  let pitchMin = store.get('mup.pmin') || '3', betMin = store.get('mup.bmin') || '8', pteamSel = null;
  let tMin = '2', tLab = '';
  const pkey = () => `mup.pitched.${S.gid}.${S.block}`;
  const pitchedList = () => { try { return JSON.parse(store.get(pkey()) || '[]'); } catch { return []; } };
  const markPitched = (id) => { const l = pitchedList(); if (id && !l.includes(id)) { l.push(id); store.set(pkey(), JSON.stringify(l)); } };
  function nextPitchTeam() {
    const done = new Set(pitchedList());
    if (S.presenting) done.add(S.presenting);
    const ids = S.teams.map((t) => t.id);
    const startAt = S.phase === 'pitch' && S.presenting ? ids.indexOf(S.presenting) + 1 : 0;
    for (let i = 0; i < ids.length; i++) { const id = ids[(startAt + i) % ids.length]; if (!done.has(id)) return team(id); }
    return null;
  }
  function startPitch(id) { markPitched(id); return act('phase', { phase: 'pitch', team: id, minutes: num(pitchMin), label: 'Pitch' }); }
  const openBetting = () => act('phase', { phase: 'betting', minutes: num(betMin), label: 'Investování' });
  const closeBetting = () => act('phase', { phase: 'closed' });
  async function doShowdown() {
    const n = S.betCount, m = S.playerCount;
    if (!confirm(`Spustit showdown? Započítá se ${n} ${pl(n, 'investor', 'investoři', 'investorů')} z ${m}. Kdo neinvestoval, v tomto bloku nic nevloží.`)) return;
    const r = await act('showdown', {}, 'Showdown proběhl');
    if (r.ok && r.skipped?.length) alert('Neplatné investice (nezapočítány):\n' + r.skipped.map((x) => `${x.name}: ${x.error}`).join('\n'));
  }
  const doRjReveal = () => act('rjReveal', {}, 'Smart money odhaleno');
  function doNext() {
    const warn = D?.settled && !D.settled[S.block + 'c'] ? `\n\nPozor: showdown bloku ${S.block} ještě neproběhl. Investice studentů z tohoto bloku se nezapočítají. Nejdřív klikněte na „Showdown třídy“.` : '';
    if (confirm(`Uzavřít blok ${S.block} a přejít na blok ${S.block + 1}?${warn}`)) return act('nextBlock', {}, `Blok ${S.block + 1}`);
  }
  function doFinal() {
    if (S.block < S.maxBlock && !confirm(`Přepnout hru na Demo Day? Teprve je blok ${S.block} z ${S.maxBlock}.`)) return;
    return act('phase', { phase: 'final' });
  }
  async function quiz(op) {
    const q = S.quiz || {};
    const running = ['question', 'reveal', 'board'].includes(q.state);
    if (op === 'quizStart' && running && !confirm('Kvíz právě běží. Spustit ho znovu od začátku?')) return;
    if (op === 'quizEnd' && running && (q.idx ?? -1) + 1 < (q.total || 0) && !confirm('Ukončit kvíz ještě před poslední otázkou? Na plátně zůstane konečné pořadí.')) return;
    // seq: a double click on a quiz that already moved on is a no-op on the server
    const extra = op === 'quizStart' ? { setId: qzSel || quizSets()[0]?.id } : { seq: q.seq || 0 };
    const r = await act(op, extra);
    if (r.ok && r.quiz && S) { S.quiz = { ...S.quiz, ...r.quiz }; renderTop(); renderPanel(); }
    if (r.ok && r.stale) toast('Kvíz se mezitím posunul – stav je aktualizovaný.');
    return r;
  }

  // What the organiser most likely wants to do next (one click, top bar).
  function nextStep() {
    const s = S, sc = !!D.settled[s.block + 'c'], sr = !!D.settled[s.block + 'r'];
    const q = s.quiz;
    if (F('quiz') && q && ['question', 'reveal', 'board'].includes(q.state)) {
      const n = (q.idx ?? -1) + 1, total = q.total || 0;
      if (q.state === 'question') return { kick: `Kvíz · otázka ${n}/${total}`, label: 'Odhalit odpověď', run: () => quiz('quizReveal'), quiz: 'qzreveal' };
      if (q.state === 'reveal') return { kick: `Kvíz · otázka ${n}/${total}`, label: 'Ukázat žebříček', run: () => quiz('quizBoard'), quiz: 'qzboard' };
      if (q.idx >= 0 && n >= total) return { kick: 'Kvíz · konec otázek', label: 'Ukončit kvíz', run: () => quiz('quizEnd'), quiz: 'qzend' };
      return { kick: 'Kvíz', label: q.idx < 0 ? 'Spustit 1. otázku' : `Další otázka (${n + 1}/${total})`, run: () => quiz('quizNext'), quiz: 'qznext' };
    }
    if (F('quiz') && q && q.state === 'done') return { kick: 'Kvíz skončil · plátno ukazuje pořadí', label: 'Skrýt kvíz z plátna', run: () => quiz('quizEnd'), quiz: 'qzend' };
    if (s.phase === 'final') return { kick: 'Finále', label: 'Hra je u konce', run: null, step: -1 };
    if (sc && sr) return s.block < s.maxBlock
      ? { kick: `Blok ${s.block} je hotový`, label: tx('dealer.btn.next'), run: doNext, step: 6 }
      : { kick: 'Poslední blok je hotový', label: tx('dealer.btn.final'), run: doFinal, step: 6 };
    if (sc) return D.rj?.slip?.submitted
      ? { kick: 'Showdown proběhl', label: tx('dealer.btn.rj'), run: doRjReveal, step: 5 }
      : { kick: 'Smart money ještě není zadané', label: 'Zadat smart money', run: () => setTab('rj'), step: 5 };
    if (s.phase === 'betting') return { kick: `${s.betCount}/${s.playerCount} investovalo`, label: tx('dealer.btn.close'), run: closeBetting, step: 3 };
    if (s.phase === 'closed') return { kick: 'Investování je zavřené', label: tx('dealer.btn.showdown'), run: doShowdown, step: 4 };
    const nt = nextPitchTeam();
    if (nt) return { kick: s.phase === 'pitch' ? `Pitchuje ${team(s.presenting).name}` : 'Začátek bloku', label: `Pitch: ${nt.name}`, run: () => startPitch(nt.id), step: 1, team: nt.id };
    return { kick: 'Všechny týmy pitchovaly', label: tx('dealer.btn.open'), run: openBetting, step: 2 };
  }

  // ---------- top bar ----------
  function renderTop() {
    const s = S;
    $('tbBlock').textContent = `Blok ${s.block}/${s.maxBlock}`;
    const ph = $('tbPhase');
    ph.textContent = s.phase === 'pitch' ? `Pitch · ${team(s.presenting).name}` : PH[s.phase] || s.phase;
    ph.className = 'ph ph-' + s.phase;
    $('tbPlayers').textContent = s.playerCount;
    $('tbPlayersL').textContent = pl(s.playerCount, 'hráč', 'hráči', 'hráčů');
    $('tbBets').textContent = `${s.betCount}/${s.playerCount}`;
    const ns = nextStep();
    const b = $('bprimary');
    b.textContent = ns.label;
    b.disabled = !ns.run;
    b.onclick = ns.run ? () => ns.run() : null;
    $('tbKick').textContent = ns.kick || 'Další krok';
    const q = s.quiz || {};
    const badge = (k, txt, cls = '') => { const el = document.querySelector(`[data-badge="${k}"]`); if (el) { el.textContent = txt || ''; el.className = 'tb ' + cls; } };
    badge('investice', ['betting', 'closed'].includes(s.phase) ? `${s.betCount}/${s.playerCount}` : '', s.phase === 'betting' ? 'live' : '');
    badge('kviz', F('quiz') && ['question', 'reveal', 'board'].includes(q.state) ? 'živě' : featKnown() && !F('quiz') ? 'vyp.' : '', F('quiz') && ['question', 'reveal', 'board'].includes(q.state) ? 'live' : 'dim');
    badge('body', featKnown() && !F('points') ? 'vyp.' : '', 'dim');
    badge('hraci', String(s.playerCount));
    badge('rj', D.settled[s.block + 'r'] ? '✓' : D.rj?.slip?.submitted ? 'uloženo' : '', 'dim');
    { const n = wallUnreadTotal(); badge('walls', wallOff() ? 'vyp.' : n ? String(n) : '', wallOff() ? 'dim' : n ? 'live' : ''); }
    tickClock();
  }
  function tickClock() {
    const cn = $('tbConn');
    if (cn) cn.hidden = Date.now() - lastOk < 9000;
    if (!S) return;
    const left = timeLeft(S);
    const el = $('tbTimer');
    if (left === null) el.hidden = true;
    else {
      el.hidden = false;
      el.textContent = (S.timerLabel ? S.timerLabel + ' · ' : '') + (left > 0 ? clock(left) : 'čas!');
      el.classList.toggle('warn', left > 0 && left <= 30000);
      el.classList.toggle('over', left <= 0);
    }
    const tl = $('tleft');
    if (tl) tl.textContent = left === null ? '' : left > 0 ? clock(left) : '0:00';
    const tll = $('tleftl');
    if (tll) tll.textContent = left === null ? 'Bez časovače' : (S.timerLabel || 'Časovač') + (left > 0 ? '' : ' · čas vypršel');
    const qt = $('qztime');
    if (qt) {
      const q = S.quiz || {};
      qt.textContent = q.state === 'question' && q.endsAt ? Math.ceil(Math.max(0, q.endsAt - MUP.now()) / 1000) + ' s' : '';
    }
  }
  $('bundo').onclick = () => confirm('Vrátit poslední krok? Zruší se poslední showdown, odhalení, přecenění nebo přechod na další blok.') && act('undo', {}, 'Vráceno');

  // ---------- Hra ----------
  function renderFlow() {
    const s = S, sc = !!D.settled[s.block + 'c'], sr = !!D.settled[s.block + 'r'];
    const ns = nextStep();
    const pitched = pitchedList();
    const el = gate('ctrl', [s.phase, s.block, s.maxBlock, s.presenting, sc, sr, s.teams.map((t) => [t.id, t.name, t.color]), !!D.rj?.slip?.submitted, pitched, s.betCount, s.playerCount, ns.label, ns.step]);
    if (!el) return;
    const ph = s.phase;
    const now = { lobby: 0, pitch: 1, betting: 2, closed: 3, showdown: 4, rj: 5, final: 6 }[ph] ?? -1;
    const mid = now >= 2 && now <= 5;
    const done = (i) => ({ 2: (mid && now >= 2) || sc, 3: (mid && now >= 3) || sc, 4: sc, 5: sr }[i] || false);
    const pc = (i) => (i === ns.step ? 's-primary' : 's-ghost');
    if (!pteamSel || !s.teams.some((t) => t.id === pteamSel)) pteamSel = null;
    const selTeam = ns.team || pteamSel || s.presenting || s.teams[0]?.id;
    const step = (i, title, desc, ctl) => `<div class="step ${i === 1 ? 'wide' : ''} ${i === ns.step ? 'next' : ''} ${now === i ? 'now' : ''} ${done(i) ? 'done' : ''}">
      <span class="n">${done(i) ? '✓' : i + 1}</span>
      <div class="sx"><div class="stt">${title}${now === i ? ' <span class="s-badge s-ok">teď</span>' : ''}</div>${desc ? `<div class="sd">${desc}</div>` : ''}</div>
      <div class="ctl">${ctl}</div></div>`;
    el.innerHTML = `<div class="ch"><h3>Průběh bloku ${s.block}</h3><span class="s-label">${esc(PH[ph] || ph)}</span></div>
      <div class="steps">
        ${step(0, 'Lobby', 'Na plátně je QR kód, studenti se připojují.', `<button class="s-btn s-sm ${pc(0)}" id="blobby">${E('dealer.btn.lobby')}</button>`)}
        ${step(1, 'Pitche týmů', `${ph === 'pitch' ? `Teď pitchuje <b>${tname(s.presenting)}</b>.` : 'Vyberte tým a délku pitche.'}
            <div class="pchips">${s.teams.map((t) => `<button class="pchip ${pitched.includes(t.id) || s.presenting === t.id ? 'did' : ''} ${t.id === selTeam ? 'sel' : ''}" data-pt="${t.id}">${dot(t.color)}${esc(t.name)}${pitched.includes(t.id) || s.presenting === t.id ? ' ✓' : ''}</button>`).join('')}${pitched.length ? '<button class="linkb" id="preset">vynulovat</button>' : ''}</div>`,
          `<select class="s-input sm" id="pteam" aria-label="Tým">${s.teams.map((t) => `<option value="${t.id}" ${t.id === selTeam ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
           <span class="unit"><input class="s-input sm num" id="pmin" value="${esc(pitchMin)}" inputmode="decimal" aria-label="Minuty pitche"> min</span>
           <button class="s-btn s-sm ${pc(1)}" id="bpitch">${E('dealer.btn.pitch')}</button>
           <button class="s-btn s-sm s-ghost" id="bqa">${E('dealer.btn.qa')}</button>
           <button class="s-btn s-sm s-ghost" id="bstop">${E('dealer.btn.stop')}</button>`)}
        ${step(2, 'Otevřít investování', sc ? 'V tomto bloku už proběhl showdown.' : 'Studenti posílají investice z mobilů. Časovač je jen orientační.',
          `<span class="unit"><input class="s-input sm num" id="bmin" value="${esc(betMin)}" inputmode="decimal" aria-label="Minuty investování"> min</span>
           <button class="s-btn s-sm ${pc(2)}" id="bbet" ${sc ? 'disabled' : ''}>${E('dealer.btn.open')}</button>`)}
        ${step(3, 'Zavřít investování', `Investovalo <b>${s.betCount}</b> z ${s.playerCount}.`,
          `<button class="s-btn s-sm ${pc(3)}" id="bclose" ${sc || ph !== 'betting' ? 'disabled' : ''}>${E('dealer.btn.close')}</button>`)}
        ${step(4, 'Showdown třídy', 'Peníze třídy dopadnou na stůl a pohnou oceněním.',
          `<button class="s-btn s-sm ${pc(4)}" id="bshow" ${sc || !['betting', 'closed'].includes(ph) ? 'disabled' : ''}>${E('dealer.btn.showdown')}</button>`)}
        ${step(5, 'Smart money RainbowJet', sr ? 'Odhaleno.' : D.rj?.slip?.submitted ? 'Rozdělení je uložené, čeká na odhalení.' : 'Rozdělení zatím chybí. <button class="linkb" data-goto="rj">Zadat v záložce RJ →</button>',
          `<button class="s-btn s-sm ${pc(5)}" id="brj" ${!sc || sr ? 'disabled' : ''}>${E('dealer.btn.rj')}</button>`)}
        ${step(6, ph === 'final' ? 'Demo Day' : s.block < s.maxBlock ? 'Další blok' : 'Demo Day', ph === 'final' ? 'Hra je ve finále. Tlačítkem Lobby ji vrátíte zpět.' : s.block < s.maxBlock ? `Začne blok ${s.block + 1} v lobby.` : 'Poslední blok – zbývá finále.',
          `<button class="s-btn s-sm ${s.block < s.maxBlock ? pc(6) : 's-ghost'}" id="bnext" ${s.block >= s.maxBlock ? 'disabled' : ''}>${E('dealer.btn.next')}</button>
           <button class="s-btn s-sm ${s.block >= s.maxBlock ? pc(6) : 's-ghost'}" id="bfinal">${E('dealer.btn.final')}</button>`)}
      </div>`;
    $('pteam').onchange = (e) => { pteamSel = e.target.value; };
    $('pmin').oninput = (e) => { pitchMin = e.target.value; store.set('mup.pmin', pitchMin); };
    $('bmin').oninput = (e) => { betMin = e.target.value; store.set('mup.bmin', betMin); };
    all(el, '[data-pt]').forEach((b) => (b.onclick = () => { pteamSel = b.dataset.pt; $('pteam').value = pteamSel; all(el, '[data-pt]').forEach((x) => x.classList.toggle('sel', x === b)); }));
    if ($('preset')) $('preset').onclick = () => { store.del(pkey()); redraw('ctrl'); renderTop(); renderFlow(); };
    $('bpitch').onclick = () => startPitch($('pteam').value);
    $('bqa').onclick = () => act('timer', { minutes: 2, label: 'Otázky' });
    $('bstop').onclick = () => act('timer', { minutes: 0 });
    $('blobby').onclick = () => act('phase', { phase: 'lobby' });
    $('bbet').onclick = openBetting;
    $('bclose').onclick = closeBetting;
    $('bshow').onclick = doShowdown;
    $('brj').onclick = doRjReveal;
    $('bnext').onclick = doNext;
    $('bfinal').onclick = doFinal;
  }

  function renderClock() {
    const s = S;
    const el = gate('clockbox', [s.screen, s.timerEnd, s.timerLabel]);
    if (!el) return;
    el.innerHTML = `<div class="ch"><h3>Časovač a plátno</h3></div>
      <div class="bigclock"><span id="tleft"></span><span class="s-muted" id="tleftl"></span></div>
      <div class="inl">
        <span class="unit"><input class="s-input sm num" id="tmin" value="${esc(tMin)}" inputmode="decimal" aria-label="Minuty"> min</span>
        <input class="s-input sm grow" id="tlab" value="${esc(tLab)}" placeholder="Popisek, např. Diskuse" maxlength="40">
      </div>
      <div class="inl">
        <button class="s-btn s-sm" id="tgo">Spustit časovač</button>
        <button class="s-btn s-sm s-ghost" id="tplus">+1 min</button>
        <button class="s-btn s-sm s-ghost" id="tstop">Zastavit</button>
      </div>
      <div class="sep"></div>
      <div class="lab">Plátno ukazuje</div>
      <div class="seg"><button id="sct" class="${s.screen === 'board' ? '' : 'on'}">Stůl</button><button id="scb" class="${s.screen === 'board' ? 'on' : ''}">Žebříček</button></div>`;
    $('tmin').oninput = (e) => { tMin = e.target.value; };
    $('tlab').oninput = (e) => { tLab = e.target.value; };
    $('tgo').onclick = () => { if (!(num(tMin) > 0)) return toast('Zadejte počet minut.', true); act('timer', { minutes: num(tMin), label: tLab.trim() || 'Časovač' }); };
    $('tplus').onclick = () => { const left = timeLeft(S) || 0; act('timer', { minutes: left / 60000 + 1, label: S.timerLabel || 'Časovač' }); };
    $('tstop').onclick = () => act('timer', { minutes: 0 });
    $('sct').onclick = () => act('screen', { screen: 'table' });
    $('scb').onclick = () => act('screen', { screen: 'board' });
    tickClock();
  }

  function renderReg() {
    const el = gate('regbox', [S.regOpen, S.playerCount, S.teams.map((t) => [t.id, t.name])]);
    if (!el) return;
    el.innerHTML = `<div class="ch"><h3>Studenti</h3><span class="s-badge ${S.regOpen ? 's-ok' : 's-warn'}">${S.regOpen ? 'registrace otevřená' : 'registrace zavřená'}</span></div>
      <p class="hint">Až jsou všichni u stolu, registraci zavřete. Kdo už hraje, se přihlásí dál, nové jméno ale nepřibude.</p>
      <div class="seg"><button id="regon" class="${S.regOpen ? 'on' : ''}">Otevřená</button><button id="regoff" class="${S.regOpen ? '' : 'on'}">Zavřená</button></div>
      <div class="sep"></div>
      <div class="lab">Odkazy</div>
      <div class="inl">
        <a class="s-btn s-sm s-ghost" href="/table" target="_blank" rel="noopener">Stůl ↗</a>
        <a class="s-btn s-sm s-ghost" href="/play" target="_blank" rel="noopener">Mobil studenta ↗</a>
        <button class="s-btn s-sm s-ghost" id="ghosthdr" title="Testovací účet, který se nikde nepočítá">Ghost ↗</button>
        <a class="s-btn s-sm s-ghost" href="/cms">Texty</a>
      </div>`;
    $('regon').onclick = () => act('reg', { open: true }, 'Registrace otevřena');
    $('regoff').onclick = () => act('reg', { open: false }, 'Registrace zavřena');
    $('ghosthdr').onclick = (e) => { e.preventDefault(); openGhost(); };
  }

  async function openGhost(teamId) {
    const w = window.open('about:blank', '_blank');
    const r = await act('ghost', { team: teamId || S.teams[0].id });
    if (r.ok && w) w.location.href = '/play#ghost=' + r.sid + ':' + r.pin;
    else if (w) w.close();
    return r;
  }

  // ---------- Investice ----------
  function renderLive() {
    const rows = D.rows || [];
    const sc = !!D.settled[S.block + 'c'];
    const dem = sc ? demandOf(S.block) : null;
    const el = gate('live', [S.block, S.phase, sc, S.teams.map((t) => [t.id, t.name, t.color, t.live]), liveDeps(), dem, rows.map((r) => [r.id, r.name, r.team, !!r.slip?.submitted, r.slip?.ts])]);
    if (!el) return;
    const agg = {};
    for (const t of S.teams) agg[t.id] = { in: 0, out: 0, n: 0 };
    const subs = rows.filter((r) => r.slip?.submitted);
    for (const r of subs) {
      for (const [t, e] of Object.entries(r.slip.in || {})) if (agg[t]) { agg[t].in += e.amt || 0; agg[t].n++; }
      for (const [t, e] of Object.entries(r.slip.out || {})) if (agg[t]) agg[t].out += e.amt || 0;
    }
    const max = Math.max(1, ...S.teams.map((t) => Math.max(agg[t.id].in, agg[t.id].out)));
    const missing = rows.filter((r) => !r.slip?.submitted).sort(byTeamName);
    const note = sc ? 'po showdownu' : S.phase === 'betting' ? 'investování běží' : S.phase === 'closed' ? 'zavřeno, čeká na showdown' : 'investování ještě neběží';
    const totIn = S.teams.reduce((a, t) => a + agg[t.id].in, 0);
    el.innerHTML = `<div class="ch"><h3>Peníze třídy · blok ${S.block}</h3><span class="s-badge ${S.phase === 'betting' ? 's-ok' : ''}">${esc(note)}</span></div>
      <div class="pline"><div class="s-progress"><i style="width:${rows.length ? (subs.length / rows.length) * 100 : 0}%"></i></div><span><b>${subs.length}</b>/${rows.length} odeslalo</span></div>
      <div class="fbars">${S.teams.map((t) => {
        const a = agg[t.id], net = a.in - a.out;
        return `<div class="fb"><div class="fbh">${tlabel(t.id)}<b class="${net > 0 ? 's-up' : net < 0 ? 's-down' : ''}">${net ? sgnM(net) : '0 $'}</b></div>
          <div class="fbbar"><i style="width:${(a.in / max) * 100}%;background:${esc(t.color)}"></i></div>
          ${a.out ? `<div class="fbbar out"><i style="width:${(a.out / max) * 100}%"></i></div>` : ''}
          <div class="fbm">${a.in ? `+${fmtM(a.in)} od ${a.n} ${pl(a.n, 'investora', 'investorů', 'investorů')}` : 'zatím nic'}${a.out ? ` · −${fmtM(a.out)} vybráno` : ''}</div>
          <div class="fbv"><span class="s-label">${pendingNow() ? 'ocenění živě' : 'ocenění'}</span>${liveHTML(t)}${dem && dem.mult && Number.isFinite(Number(dem.mult[t.id])) ? `<span class="dm" title="Násobek poptávky v bloku ${S.block}">poptávka ${esc(multTxt(dem.mult[t.id]))}</span>` : ''}</div></div>`;
      }).join('')}</div>
      <div class="fbt">Celkem vloženo <b>${fmtM(totIn)}</b>${pendingNow() && F('demand') ? ' · ceny se po showdownu přepočítají podle poptávky (živý odhad)' : ''}</div>
      <div class="sep"></div>
      <div class="lab">${missing.length ? `Ještě neinvestovali (${missing.length})` : 'Všichni odeslali ✓'}</div>
      <div class="chips">${missing.map((r) => `<span class="nchip">${dot(team(r.team).color)}${esc(r.name)}</span>`).join('')}</div>`;
  }

  const Q = { get in() { return tx('q.in'); }, get out() { return tx('q.out'); }, get like() { return tx('q.like'); }, get doubt() { return tx('q.doubt'); } };
  let pinData = [];
  const pinBtn = (t, q, a, amt) => {
    pinData.push({ team: t, q, a, amt: amt || 0 });
    return ` <button class="pinb" data-pin="${pinData.length - 1}" title="Ukázat na plátně (bez jména)">Na plátno</button>`;
  };
  function renderBets() {
    const rows = (D.rows || []).slice().sort(byTeamName);
    const c = D.calls || { big: [], lone: [], conc: [], outs: [], none: [] }, pins = S.pins || [];
    const el = gate('bets', [rows.map((r) => [r.id, r.name, r.team, r.slip?.ts, r.slip?.submitted, r.slip?.notes, r.slip?.in, r.slip?.out]), c, S.phase, S.block, pins, S.teams.map((t) => [t.id, t.name, t.color])]);
    if (!el) return;
    pinData = [];
    const line = (r) => {
      const s = r.slip, sub = s?.submitted;
      const parts = [...Object.entries(s?.out || {}).map(([t, e]) => `−${fmtM(e.amt)} ${team(t).name}`), ...Object.entries(s?.in || {}).map(([t, e]) => `+${fmtM(e.amt)} ${team(t).name}`)];
      const reasons = [
        ...Object.entries(s?.out || {}).map(([t, e]) => `<div class="reason"><span class="rk">Vybral z ${tname(t)} · ${esc(fmt(e.amt))}</span>${esc(e.why) || '<i>bez důvodu</i>'}${e.why ? pinBtn(t, Q.out, e.why, -e.amt) : ''}</div>`),
        ...Object.entries(s?.in || {}).map(([t, e]) => `<div class="reason"><span class="rk">${tname(t)} · ${esc(fmt(e.amt))}</span>${esc(e.why) || '<i>bez důvodu</i>'}${e.why ? pinBtn(t, Q.in, e.why, e.amt) : ''}</div>`),
        ...Object.entries(s?.notes || {}).flatMap(([t, n]) => {
          const o = typeof n === 'string' ? { like: n } : n;
          return [
            o.like ? `<div class="reason"><span class="rk">${tname(t)} · zaujalo</span>${esc(o.like)}${pinBtn(t, Q.like, o.like)}</div>` : '',
            o.doubt ? `<div class="reason"><span class="rk">${tname(t)} · nevěří</span>${esc(o.doubt)}${pinBtn(t, Q.doubt, o.doubt)}</div>` : '',
          ];
        }),
      ].join('');
      return `<details class="brow" data-k="${r.id}"><summary><span class="bn">${dot(team(r.team).color)}${esc(r.name)}</span>
        <span class="${sub ? 'ok' : 'no'}">${sub ? (parts.length ? esc(parts.join(', ')) : 'beze změny') : 'ještě neinvestoval'}</span></summary>${reasons || '<div class="reason"><i>Nic nenapsal.</i></div>'}</details>`;
    };
    const call = (title, items) => (items.length ? `<div class="lab sec">${title}</div>` + items.join('') : '');
    const onScreen = pins.length
      ? `<div class="lab sec">Na plátně (${pins.length})</div>` + pins.map((p) => `<div class="pinrow"><span>${dot(team(p.team).color)} <b>${tname(p.team)}</b> · ${esc(p.q)} ${esc(p.a)}</span><button class="s-btn s-sm s-ghost" data-unpin="${esc(p.id)}" title="Sundat z plátna">✕</button></div>`).join('') + '<button class="s-btn s-sm s-ghost" id="unpinall">Smazat vše z plátna</button>'
      : '';
    const open = new Set(all(el, 'details[open]').map((d) => d.dataset.k));
    el.innerHTML = `<div class="ch"><h3>${E('dealer.sec.bets', { block: S.block })}</h3></div>
      <p class="hint">Rozklikněte hráče a tlačítkem „Na plátno“ pošlete odpověď na stůl. Jméno se nezobrazí.</p>
      ${onScreen}
      ${call('Koho vyvolat', [
        ...c.big.map((b) => `<div class="call"><b>${esc(b.name)}</b> (${esc(b.team)}) dal <b>${esc(fmtM(b.amt))}</b> do ${esc(b.target)}${b.why ? `<div class="why">„${esc(b.why)}“</div>` : ''}</div>`),
        ...c.lone.map((b) => `<div class="call">Jediný, kdo věří týmu <b>${esc(b.target)}</b>: <b>${esc(b.name)}</b> (${esc(fmtM(b.amt))})${b.why ? `<div class="why">„${esc(b.why)}“</div>` : ''}</div>`),
        ...c.conc.filter((x) => x.share >= 0.5).map((x) => `<div class="call"><b>${esc(x.name)}</b> dal ${Math.round(x.share * 100)} % do ${esc(x.target)}</div>`),
        ...c.outs.map((b) => `<div class="call"><b>${esc(b.name)}</b> vybral ${esc(fmtM(b.amt))} z ${esc(b.target)}${b.why ? `<div class="why">„${esc(b.why)}“</div>` : ''}</div>`),
        ...(c.none.length ? [`<div class="call">Od třídy nedostal nic: <b>${esc(c.none.join(', '))}</b></div>`] : []),
      ])}
      <div class="lab sec">Všichni hráči</div>${rows.map(line).join('') || '<p class="hint">Zatím nikdo není u stolu.</p>'}`;
    all(el, 'details').forEach((d) => { if (open.has(d.dataset.k)) d.open = true; });
    all(el, '[data-pin]').forEach((btn) => (btn.onclick = (e) => {
      e.preventDefault();
      const p = pinData[+btn.dataset.pin];
      btn.textContent = 'Na plátně ✓';
      act('pin', p);
    }));
    all(el, '[data-unpin]').forEach((btn) => (btn.onclick = () => act('unpin', { id: btn.dataset.unpin })));
    if ($('unpinall')) $('unpinall').onclick = () => confirm('Sundat z plátna všechny odpovědi?') && act('unpin', { all: true });
  }

  // question board: switched off for students; the dealer still sees old questions and can pin or hide them
  function renderQBoard() {
    const qs = D.board || [];
    if (!show('qboard', qs.length > 0)) return;
    const el = gate('qboard', [qs, D.qpinId, S.block, S.teams.map((t) => t.name)]);
    if (!el) return;
    const cats = S.qcats || {};
    const pinned = qs.find((q) => q.id === D.qpinId);
    const wasOpen = el.querySelector('details')?.open;
    el.innerHTML = `<details ${wasOpen || pinned ? 'open' : ''}><summary class="ch sum"><h3>Tabule otázek (${qs.length})</h3><span class="s-badge">studentům skrytá</span></summary>
      <p class="hint">Otázky studentů z dřívějška. Celá tabule je i v archivu „Stav před v2“. „Na plátno“ ukáže otázku velkou na stole.</p>
      ${pinned ? `<div class="inl"><span>Na plátně: <b>${tname(pinned.team)}</b> · ${esc(pinned.text)}</span><button class="s-btn s-sm s-ghost" id="qunpin">Sundat z plátna</button></div>` : ''}
      ${S.teams.map((t) => {
        const list = qs.filter((q) => q.team === t.id);
        if (!list.length) return '';
        return `<div class="lab sec">${dot(t.color)} ${esc(t.name)} · ${list.length}</div>
          ${list.map((q) => `<div class="qrow ${q.hidden ? 'hid' : ''}" data-q="${esc(q.id)}">
            <div><span class="qc">${esc(cats[q.cat] || q.cat)}</span> ${esc(q.text)}
              <span class="s-faint sm"> — ${esc(q.by)}${q.ghost ? ' (ghost)' : ''} · blok ${q.block} · ▲ ${q.votes}</span>
              ${q.answer ? `<div class="sm s-muted">↳ ${esc(q.answer.text)} · přesvědčilo ${q.yes}, nepřesvědčilo ${q.no}</div>` : ''}</div>
            <span class="btns"><button class="s-btn s-sm" data-qpin>${q.id === D.qpinId ? 'Na plátně ✓' : 'Na plátno'}</button><button class="s-btn s-sm s-ghost" data-qhide>${q.hidden ? 'Vrátit' : 'Skrýt'}</button></span></div>`).join('')}`;
      }).join('')}</details>`;
    if ($('qunpin')) $('qunpin').onclick = () => act('qpin', { qid: null });
    all(el, '.qrow').forEach((row) => {
      const id = row.dataset.q, q = qs.find((x) => x.id === id);
      row.querySelector('[data-qpin]').onclick = () => act('qpin', { qid: id === D.qpinId ? null : id });
      row.querySelector('[data-qhide]').onclick = () => act('qhide', { qid: id, hidden: !q.hidden });
    });
  }

  // ---------- RJ ----------
  function renderFund() {
    const f = D.rjFund || S.rjFund, rj = D.rj || {};
    const el = gate('rjfund', [f, rj.portfolio, rj.stakes, rj.rules, S.teams.map((t) => [t.id, t.name, t.color, t.rj]), F('tranches')]);
    if (!el) return;
    const R = rj.rules || {};
    const last = R.mode === 'initial' ? ['Teď rozdělit', fmtM(R.capital), 'hi'] : R.mode === 'fund' ? ['K dispozici', fmtM(f?.available ?? R.capital), 'hi'] : ['Lze přesunout (30 %)', fmtM(R.cashoutMax), 'hi'];
    const tiles = [
      ['Fond', fmtM(f?.capital ?? (S.cfg?.RJ_CAPITAL || 10e6))],
      ...(f ? [['Vloženo celkem', fmtM(f.invested)]] : []),
      ['Hodnota podílů RJ', fmtM(rj.portfolio)],
      ...(f && F('tranches') ? [['V tranších', fmtM(f.locked)]] : []),
      last,
    ];
    const max = Math.max(1, ...S.teams.map((t) => rj.stakes?.[t.id] || 0));
    el.innerHTML = `<div class="ch"><h3>${E('dealer.sec.rj')}</h3><span class="s-label">fond RainbowJet</span></div>
      <div class="tiles">${tiles.map(([k, v, c]) => `<div class="tile ${c || ''}"><span class="s-label">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
      <div class="lab sec">Podíly RJ podle týmů (dnešní hodnota)</div>
      <div class="hbars">${S.teams.map((t) => `<div class="hb">${tlabel(t.id)}<div class="hbbar"><i style="width:${((rj.stakes?.[t.id] || 0) / max) * 100}%;background:${esc(t.color)}"></i></div><b>${fmtM(rj.stakes?.[t.id] || 0)}</b></div>`).join('')}</div>`;
  }

  function renderRJ() {
    const rj = D.rj || {}, R = rj.rules || { mode: 'initial', capital: 0 }, settledR = !!D.settled[S.block + 'r'], settledC = !!D.settled[S.block + 'c'];
    const el = gate('rj', [S.block, R, rj.slip?.ts, rj.slip?.submitted, settledR, settledC, rj.stakes, S.teams.map((t) => [t.id, t.name, t.color])]);
    if (!el) return;
    const init = R.mode === 'initial', fund = R.mode === 'fund';
    const showOut = !init && (R.cashoutMax || 0) > 0;
    const sl = rj.slip || {};
    const hint = init ? `Rozdělte ${esc(fmt(R.capital))} (např. 5 × 2 mil.).`
      : fund ? `Můžete investovat až ${esc(fmt(R.capital))}${showOut ? ` a vybrat až ${esc(fmt(R.cashoutMax))}` : ''}.`
      : `Fond má ${esc(fmt(rj.portfolio))}. Můžete vybrat až ${esc(fmt(R.cashoutMax))} (30 %) a vložit jinam.`;
    el.innerHTML = `<div class="ch"><h3>Rozdělení smart money · blok ${S.block}</h3>${settledR ? '<span class="s-badge s-ok">odhaleno</span>' : sl.submitted ? '<span class="s-badge s-ok">uloženo</span>' : '<span class="s-badge s-warn">neuloženo</span>'}</div>
      <p class="hint">${hint} Částky uvidí všichni až po odhalení. Důvod je zpráva, kterou uvidí jen daný tým v mobilu.</p>
      <div class="rjrow rjhead"><span>Tým</span><span>${showOut ? 'Vybrat $' : ''}</span><span>Vložit $</span></div>
      ${S.teams.map((t) => `<div class="rjblock" data-t="${t.id}"><div class="rjrow"><span>${tlabel(t.id)}${init ? '' : `<span class="s-faint sm">máte ${esc(fmtM(rj.stakes?.[t.id] || 0))}</span>`}</span>
        ${showOut ? `<input class="s-input sm ro" inputmode="numeric" value="${plain(sl.out?.[t.id]?.amt)}" aria-label="Vybrat z ${tname(t.id)}">` : '<span></span>'}
        <input class="s-input sm ri" inputmode="numeric" value="${plain(sl.in?.[t.id]?.amt)}" aria-label="Vložit do ${tname(t.id)}"></div>
        <input class="s-input sm rw" placeholder="Zpráva pro ${tname(t.id)} (uvidí jen oni)" value="${esc(sl.in?.[t.id]?.why || sl.out?.[t.id]?.why || '')}"></div>`).join('')}
      <div class="sum" id="rjsum"></div>
      <div class="inl"><button class="s-btn s-primary" id="rjsave" ${settledR ? 'disabled' : ''}>Uložit smart money</button>
        <button class="s-btn s-ghost" id="rjreveal" ${!settledC || settledR || !sl.submitted ? 'disabled' : ''}>${E('dealer.btn.rj')}</button></div>
      <div class="err" id="rjerr"></div>
      ${!settledC && !settledR ? '<p class="hint">Odhalit jde až po showdownu třídy.</p>' : ''}`;
    watchDirty(el, 'rj');
    const recalc = () => {
      let o = 0, i = 0;
      all(el, '.rjblock').forEach((row) => { o += parseAmt(row.querySelector('.ro')?.value || 0); i += parseAmt(row.querySelector('.ri').value); });
      $('rjsum').innerHTML = init ? `<span>Rozděleno</span><b>${esc(fmt(i))} / ${esc(fmtM(R.capital))}</b>`
        : fund ? `<span>Vloženo ${esc(fmt(i))}${o ? ` · vybráno ${esc(fmt(o))}` : ''}</span><b>max. ${esc(fmtM(R.capital + o))}</b>`
        : `<span>Vybráno ${esc(fmt(o))}</span><b>vloženo ${esc(fmt(i))}</b>`;
      $('rjsum').classList.toggle('good', init ? i === R.capital : fund ? i > 0 && i <= R.capital + o : i === o && o <= R.cashoutMax);
    };
    all(el, 'input.ro, input.ri').forEach((inp) => {
      inp.addEventListener('input', recalc);
      inp.addEventListener('focus', () => { inp.dataset.prev = inp.value; inp.placeholder = inp.value || '0'; inp.value = ''; });
      inp.addEventListener('blur', () => { inp.value = inp.value.trim() === '' ? inp.dataset.prev || '' : plain(parseAmt(inp.value)); recalc(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { inp.value = ''; inp.blur(); } if (e.key === 'Enter') inp.blur(); });
    });
    recalc();
    $('rjsave').onclick = async () => {
      const out = {}, inn = {};
      all(el, '.rjblock').forEach((row) => {
        const t = row.dataset.t, o = parseAmt(row.querySelector('.ro')?.value || 0), i = parseAmt(row.querySelector('.ri').value);
        const why = row.querySelector('.rw').value.trim();
        if (o) out[t] = { amt: o, why };
        if (i) inn[t] = { amt: i, why };
      });
      const r = await post({ op: 'rjSave', out, in: inn }, H());
      if (r.dump) mergeBk(r.dump);
      $('rjerr').textContent = r.ok ? '' : r.error;
      if (r.ok) { flash('Smart money uloženo'); redraw('rj'); tick(); }
    };
    $('rjreveal').onclick = doRjReveal;
  }

  // tranches (feature)
  function renderTranches() {
    if (!show('tranches', F('tranches'))) return;
    const list = S.tranches || D.tranches || [], f = D.rjFund || S.rjFund || {};
    const el = gate('tranches', [list, f, S.teams.map((t) => [t.id, t.name, t.color])]);
    if (!el) return;
    const st = { locked: ['zamčeno', 's-warn'], released: ['uvolněno', 's-ok'], cancelled: ['zrušeno', ''] };
    const empty = !(f.available > 0);
    el.innerHTML = `<div class="ch"><h3>Tranše RJ</h3><span class="s-label">k dispozici ${esc(fmtM(f.available || 0))}</span></div>
      <p class="hint">Slib peněz, které RJ uvolní až po splnění podmínky. Tým tranši uvidí hned, peníze dostane po uvolnění (koupí podíl za aktuální cenu).</p>
      ${empty ? `<div class="off"><div><b>Ve fondu nic nezbývá.</b> RainbowJet už vložil celých ${esc(fmtM(f.capital || 10e6))}. Na tranše musí zůstat část fondu – zapněte je dřív, než RJ poprvé investuje, a nerozdělujte vše.</div></div>` : ''}
      <div class="form2" ${empty ? 'hidden' : ''}>
        <select class="s-input sm" id="trteam" aria-label="Tým">${S.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
        <input class="s-input sm" id="tramt" inputmode="numeric" placeholder="Částka $, např. 500 000" aria-label="Částka">
        <input class="s-input sm span2" id="trcond" maxlength="160" placeholder="Podmínka, např. 50 platících zákazníků" aria-label="Podmínka">
        <input class="s-input sm" id="trdue" type="date" aria-label="Termín">
        <button class="s-btn s-sm s-primary" id="tradd">Přidat tranši</button>
      </div>
      <div class="list">${list.length ? list.slice().reverse().map((x) => `<div class="li" data-id="${esc(x.id)}">
        <div class="lim">${tlabel(x.team)} <b>${esc(fmtM(x.amt))}</b> <span class="s-badge ${st[x.status]?.[1] || ''}">${esc(st[x.status]?.[0] || x.status)}</span>
          <div class="sm s-muted">${esc(x.cond || '')}${x.due ? ` · do ${esc(new Date(x.due).toLocaleDateString('cs-CZ'))}` : ''}</div></div>
        ${x.status === 'locked' ? '<span class="btns"><button class="s-btn s-sm" data-rel>Uvolnit</button><button class="s-btn s-sm s-ghost" data-can>Zrušit</button></span>' : ''}</div>`).join('') : '<p class="hint">Zatím žádné tranše.</p>'}</div>`;
    watchDirty(el, 'tranches');
    $('tradd').onclick = async () => {
      const amt = parseAmt($('tramt').value), cond = $('trcond').value.trim();
      if (!amt) return toast('Zadejte částku.', true);
      if (!cond) return toast('Napište podmínku.', true);
      const r = await act('trancheAdd', { team: $('trteam').value, amt, cond, due: $('trdue').value || null }, 'Tranše přidána');
      if (r.ok) redraw('tranches');
    };
    all(el, '.li').forEach((row) => {
      const x = list.find((y) => y.id === row.dataset.id);
      const rel = row.querySelector('[data-rel]'), can = row.querySelector('[data-can]');
      if (rel) rel.onclick = () => confirm(`Uvolnit ${fmtM(x.amt)} pro ${team(x.team).name}? RJ koupí podíl za aktuální cenu.`) && act('trancheRelease', { id: x.id }, 'Tranše uvolněna').then(() => redraw('tranches'));
      if (can) can.onclick = () => confirm(`Zrušit tranši ${fmtM(x.amt)} pro ${team(x.team).name}?`) && act('trancheCancel', { id: x.id }, 'Tranše zrušena').then(() => redraw('tranches'));
    });
  }

  // ---------- Ocenění ----------
  let vReason = {};
  function renderVals() {
    const locked = ['betting', 'closed'].includes(S.phase);
    const el = gate('vals', [S.teams.map((t) => [t.id, t.name, t.color, t.V, t.cls, t.rj, t.cap]), liveDeps(), S.phase, S.reasonLabels, F('captable')]);
    if (!el) return;
    vReason = {};
    const RL = reasonLabels();
    el.innerHTML = `<div class="ch"><h3>${E('dealer.sec.vals')}</h3>${locked ? '<span class="s-badge s-warn">během investování nelze</span>' : ''}</div>
      <p class="hint">Nové ocenění zadejte v milionech $ (např. 14,5) nebo klikněte na procenta. Zvolte důvod, ten uvidí všichni. Zprávu uvidí jen členové týmu v mobilu; poslat jde i samotná zpráva.</p>
      ${S.teams.map((t) => `<div class="vblock" data-t="${t.id}">
        <div class="vrow"><div>${tlabel(t.id)}<div class="meta">teď <b>${esc(fmtM(t.V))}</b>${pendingNow() ? ` · živě ${liveHTML(t)}` : ` · #${rankOf(t)}`} · třída ${esc(fmtM(t.cls))} · RJ ${esc(fmtM(t.rj))}${F('captable') && t.cap ? ` · zakladatelé ${esc(pct(t.cap.founders))}` : ''}</div></div>
          <div class="vin"><input class="s-input sm vv" inputmode="decimal" placeholder="${esc(mil(t.V))}" aria-label="Nové ocenění ${tname(t.id)} v mil. $"><span class="u">mil. $</span></div></div>
        <div class="vtools">${[-25, -10, 10, 25, 50].map((p) => `<button class="pq" data-p="${p}">${p > 0 ? '+' : '−'}${Math.abs(p)} %</button>`).join('')}<span class="vsep"></span>${Object.entries(RL).map(([k, l]) => `<button class="s-chip rc" data-r="${k}">${esc(l)}</button>`).join('')}</div>
        <textarea class="s-input sm vw" rows="1" placeholder="Zpráva pro ${tname(t.id)}: proč se ocenění hýbe, co zlepšit…"></textarea></div>`).join('')}
      <div class="inl"><button class="s-btn s-primary" id="vsave" ${locked ? 'disabled' : ''}>Přecenit a poslat</button><button class="s-btn s-ghost" id="vclear">Vyčistit</button></div>`;
    watchDirty(el, 'vals');
    all(el, '.vblock').forEach((row) => {
      const t = S.teams.find((x) => x.id === row.dataset.t);
      all(row, '.pq').forEach((b) => (b.onclick = () => {
        row.querySelector('.vv').value = (Math.round((t.V * (1 + Number(b.dataset.p) / 100)) / 1e4) / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
        dirty.vals = true;
      }));
      all(row, '.rc').forEach((b) => (b.onclick = () => {
        const on = vReason[t.id] !== b.dataset.r;
        vReason[t.id] = on ? b.dataset.r : undefined;
        all(row, '.rc').forEach((x) => x.classList.toggle('s-on', on && x === b));
        dirty.vals = true;
      }));
    });
    $('vclear').onclick = () => { redraw('vals'); renderVals(); };
    $('vsave').onclick = () => {
      const V = {}, why = {}, reason = {};
      all(el, '.vblock').forEach((row) => {
        const id = row.dataset.t;
        const v = row.querySelector('.vv').value.trim();
        if (v) V[id] = Math.round(parseNum(v) * 1e6);
        const w = row.querySelector('.vw').value.trim();
        if (w) why[id] = w;
        if (vReason[id]) reason[id] = vReason[id];
      });
      for (const [id, v] of Object.entries(V)) if (!(v > 0)) return toast(`Ocenění pro ${team(id).name} není číslo.`, true);
      if (!Object.keys(V).length && !Object.keys(why).length) return toast('Zadejte nové ocenění nebo zprávu.', true);
      const lines = S.teams.filter((t) => V[t.id] || why[t.id]).map((t) => `${t.name}: ${V[t.id] ? `${fmtM(t.V)} → ${fmtM(V[t.id])}` : 'beze změny'}${reason[t.id] ? ` (${RL[reason[t.id]]})` : ''}${why[t.id] ? ' + zpráva' : ''}`).join('\n');
      if (!confirm('Odeslat?\n' + lines)) return;
      act('revalue', { V, why, reason }, 'Odesláno').then((r) => { if (r.ok) redraw('vals'); });
    };
  }

  function renderDrivers() {
    if (!show('drivers', F('drivers'))) return;
    const dr = S.drivers || {};
    const el = gate('drivers', [dr, S.teams.map((t) => [t.id, t.name, t.color, t.V])]);
    if (!el) return;
    el.innerHTML = `<div class="ch"><h3>Co hýbe oceněním</h3><span class="s-label">posledních 8 změn</span></div>
      <div class="drv">${S.teams.map((t) => {
        const l = dr[t.id] || [];
        return `<div class="dteam"><div class="dth">${tlabel(t.id)}<b>${esc(fmtM(t.V))}</b></div>
          ${l.length ? l.map((d) => `<div class="dr"><span class="s-badge dk-${esc(d.kind)}">${esc(DRK[d.kind] || d.kind)}</span><span class="dn">${esc(d.note || '')}</span><b class="${d.delta > 0 ? 's-up' : d.delta < 0 ? 's-down' : ''}">${d.delta ? sgnM(d.delta) : '±0'}</b><span class="s-faint sm">B${esc(d.block)}</span></div>`).join('') : '<div class="s-faint sm">Zatím beze změny.</div>'}</div>`;
      }).join('')}</div>`;
  }

  let mk = null; // market card being prepared
  function mkFrom(p) {
    const eff = {};
    for (const t of S.teams) eff[t.id] = p && p.all ? p.all : 0;
    return { title: p?.title || '', text: p?.text || '', effects: eff, one: p?.one || null, src: p ? PRESETS.indexOf(p) : -1 };
  }
  function renderMarket() {
    if (!show('market', F('market'))) return;
    const locked = ['betting', 'closed'].includes(S.phase);
    const flipped = (S.market && S.market.flipped) || [];
    const el = gate('market', [flipped, locked, S.teams.map((t) => [t.id, t.name, t.color, t.V])]);
    if (!el) return;
    if (!mk) mk = mkFrom(null);
    const sumEff = (e) => S.teams.filter((t) => Number(e?.[t.id])).map((t) => `${t.name} ${signPct(Number(e[t.id]))}`).join(', ') || 'bez dopadu';
    el.innerHTML = `<div class="ch"><h3>Tržní karty</h3>${locked ? '<span class="s-badge s-warn">během investování nelze</span>' : `<span class="s-label">otočeno ${flipped.length}</span>`}</div>
      <p class="hint">Vyberte připravenou událost, upravte dopad na jednotlivé týmy a kartu otočte. Na plátně se objeví jako karta na stole a pohne oceněním.</p>
      <div class="presets">${PRESETS.map((p, i) => `<button class="preset ${mk.src === i ? 'on' : ''}" data-pi="${i}"><b>${esc(p.title)}</b><span>${esc(p.all ? `všem ${signPct(p.all)}` : `jednomu týmu ${signPct(p.one)}`)}</span></button>`).join('')}
        <button class="preset custom ${mk.src === -1 ? 'on' : ''}" data-pi="-1"><b>Vlastní karta</b><span>napište vlastní událost</span></button></div>
      <div class="mkform">
        <div class="s-field"><label class="lab" for="mktitle">Název karty</label><input class="s-input sm" id="mktitle" maxlength="60" value="${esc(mk.title)}" placeholder="Např. Velký konkurent vstoupil na trh"></div>
        <div class="s-field"><label class="lab" for="mktext">Text karty</label><textarea class="s-input sm" id="mktext" maxlength="240" rows="2" placeholder="Co se stalo, jednou dvěma větami">${esc(mk.text)}</textarea></div>
        <div class="lab">Dopad na ocenění (−60 až +100 %)${mk.one ? ` · doporučeno: jednomu týmu ${signPct(mk.one)}` : ''}</div>
        <div class="effs">${S.teams.map((t) => `<div class="eff" data-t="${t.id}">${tlabel(t.id)}<div class="effin">${mk.one ? `<button class="pq" data-one>${signPct(mk.one)}</button>` : ''}<input class="s-input sm num" inputmode="decimal" value="${mk.effects[t.id] || 0}" aria-label="Dopad na ${tname(t.id)} v %"><span class="u">%</span></div><span class="s-faint sm eprev"></span></div>`).join('')}</div>
        <div class="inl"><button class="s-btn s-primary" id="mkflip" ${locked ? 'disabled' : ''}>Otočit kartu</button><button class="s-btn s-ghost" id="mkclear">Vyčistit</button></div>
      </div>
      ${flipped.length ? `<div class="lab sec">Otočené karty</div><div class="list">${flipped.slice().reverse().map((c) => `<div class="li"><div class="lim"><b>${esc(c.title)}</b> <span class="s-faint sm">blok ${esc(c.block)} · ${esc(when(c.ts))}</span><div class="sm s-muted">${esc(c.text || '')}</div><div class="sm">${esc(sumEff(c.effects))}</div></div></div>`).join('')}</div>` : ''}`;
    watchDirty(el, 'market');
    const prev = () => all(el, '.eff').forEach((row) => {
      const t = S.teams.find((x) => x.id === row.dataset.t), p = parseNum(row.querySelector('input').value) || 0;
      row.querySelector('.eprev').textContent = p ? `${fmtM(t.V)} → ${fmtM(t.V * (1 + p / 100))}` : '';
    });
    prev();
    $('mktitle').oninput = (e) => { mk.title = e.target.value; };
    $('mktext').oninput = (e) => { mk.text = e.target.value; };
    all(el, '.eff').forEach((row) => {
      const inp = row.querySelector('input');
      inp.oninput = () => { mk.effects[row.dataset.t] = parseNum(inp.value) || 0; prev(); };
      const one = row.querySelector('[data-one]');
      if (one) one.onclick = () => { inp.value = mk.one; mk.effects[row.dataset.t] = mk.one; dirty.market = true; prev(); };
    });
    all(el, '[data-pi]').forEach((b) => (b.onclick = () => {
      const i = Number(b.dataset.pi);
      mk = mkFrom(i >= 0 ? PRESETS[i] : null);
      redraw('market'); renderMarket(); dirty.market = true;
    }));
    $('mkclear').onclick = () => { mk = mkFrom(null); redraw('market'); renderMarket(); };
    $('mkflip').onclick = async () => {
      const title = mk.title.trim(), text = mk.text.trim();
      if (!title) return toast('Karta potřebuje název.', true);
      const effects = {};
      for (const t of S.teams) {
        const p = Number(mk.effects[t.id]) || 0;
        if (p < -60 || p > 100) return toast(`Dopad na ${t.name} musí být mezi −60 a +100 %.`, true);
        if (p) effects[t.id] = p;
      }
      if (!confirm(`Otočit kartu „${title}“?\nDopad: ${sumEff(effects)}`)) return;
      const r = await act('marketCard', { title, text, effects }, 'Karta otočena');
      if (r.ok) { mk = mkFrom(null); redraw('market'); }
    };
  }

  let ex = null; // exit outcomes being prepared
  function renderExit() {
    if (!show('exit', F('exit'))) return;
    const el = gate('exit', [S.exit, S.teams.map((t) => [t.id, t.name, t.color, t.V])]);
    if (!el) return;
    if (S.exit) {
      const xe = S.exit;
      el.innerHTML = `<div class="ch"><h3>Exit</h3><span class="s-badge s-ok">vyhlášeno</span></div>
        <div class="tiles">${(xe.teams || []).map((x) => `<div class="tile"><span class="s-label">${tname(x.team)}</span><b>${esc(EXK[x.kind] || x.kind)}${['acquired', 'ipo'].includes(x.kind) ? ` ×${esc(String(x.multiple).replace('.', ','))}` : ''}</b><span class="sm s-muted">${esc(fmtM(x.V))}</span></div>`).join('')}</div>
        ${(xe.ranking || []).length ? `<div class="lab sec">Konečné pořadí investorů</div><ol class="rank">${xe.ranking.map((r) => `<li>${dot(team(r.team).color)}<span>${esc(r.name)}</span><b>${esc(fmtM(r.value))}</b><span class="${r.returnPct >= 0 ? 's-up' : 's-down'}">${esc(signPct(r.returnPct))}</span></li>`).join('')}</ol>` : ''}
        <p class="hint">Exit se dá vrátit tlačítkem Zpět nahoře (před exitem se uložil archiv).</p>`;
      return;
    }
    if (!ex) { ex = {}; for (const t of S.teams) ex[t.id] = { kind: 'hold', multiple: 2 }; }
    for (const t of S.teams) ex[t.id] = ex[t.id] || { kind: 'hold', multiple: 2 };
    el.innerHTML = `<div class="ch"><h3>Exit</h3><span class="s-label">finále hry</span></div>
      <p class="hint">Pro každý tým zvolte výsledek. Akvizice a IPO násobí ocenění (0,5–20×), odpis ho vynuluje, bez exitu zůstává. Před exitem se uloží archiv a jde vrátit tlačítkem Zpět.</p>
      <div class="exits">${S.teams.map((t) => `<div class="exr" data-t="${t.id}">${tlabel(t.id)}
        <select class="s-input sm" data-k aria-label="Výsledek ${tname(t.id)}">${Object.entries(EXK).map(([k, l]) => `<option value="${k}" ${ex[t.id].kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="unit">× <input class="s-input sm num" data-m inputmode="decimal" value="${String(ex[t.id].multiple).replace('.', ',')}" aria-label="Násobek"></span>
        <span class="eprev s-muted sm"></span></div>`).join('')}</div>
      <button class="s-btn s-primary s-block bigbtn" id="exitgo">Vyhlásit exit</button>`;
    watchDirty(el, 'exit');
    const upd = () => all(el, '.exr').forEach((row) => {
      const t = S.teams.find((x) => x.id === row.dataset.t), o = ex[t.id];
      const m = row.querySelector('[data-m]');
      m.disabled = !['acquired', 'ipo'].includes(o.kind);
      row.classList.toggle('mdis', m.disabled);
      const v = o.kind === 'writeoff' ? 0 : ['acquired', 'ipo'].includes(o.kind) ? t.V * o.multiple : t.V;
      row.querySelector('.eprev').textContent = `${fmtM(t.V)} → ${fmtM(v)}`;
    });
    all(el, '.exr').forEach((row) => {
      const id = row.dataset.t;
      row.querySelector('[data-k]').onchange = (e) => { ex[id].kind = e.target.value; upd(); };
      row.querySelector('[data-m]').oninput = (e) => { ex[id].multiple = parseNum(e.target.value) || 0; upd(); };
    });
    upd();
    $('exitgo').onclick = async () => {
      const outcomes = {};
      for (const t of S.teams) {
        const o = ex[t.id];
        if (['acquired', 'ipo'].includes(o.kind) && !(o.multiple >= 0.5 && o.multiple <= 20)) return toast(`Násobek pro ${t.name} musí být mezi 0,5 a 20.`, true);
        outcomes[t.id] = { kind: o.kind, multiple: ['acquired', 'ipo'].includes(o.kind) ? o.multiple : o.kind === 'writeoff' ? 0 : 1 };
      }
      const lines = S.teams.map((t) => `${t.name}: ${EXK[outcomes[t.id].kind]}${['acquired', 'ipo'].includes(outcomes[t.id].kind) ? ` ×${outcomes[t.id].multiple}` : ''}`).join('\n');
      if (!confirm(`Vyhlásit exit a ukončit hru?\n\n${lines}\n\nPlátno přejde na finále.`)) return;
      const r = await act('exitSet', { outcomes }, 'Exit vyhlášen');
      if (r.ok) { ex = null; redraw('exit'); }
    };
  }

  function renderOcNote() {
    const off = ['drivers', 'market', 'exit'].filter((k) => !F(k));
    const el = $('ocnote');
    el.hidden = !off.length;
    el.innerHTML = off.length ? `${off.map(featName).join(', ')} – ${off.length > 1 ? 'vypnuté' : 'vypnuto'}. Zapnete v záložce <button class="linkb" data-goto="funkce">Funkce</button>.` : '';
  }

  // ---------- Startupy ----------
  function renderTeams() {
    const el = gate('teams', [S.teams, S.startV, S.anyHoldings]);
    if (!el) return;
    el.innerHTML = `<div class="ch"><h3>${E('dealer.sec.teams')}</h3></div><p class="hint">Názvy a barvy startupů se ukážou na stole i v mobilech.</p>
      ${S.teams.map((t) => `<div class="trow" data-t="${t.id}"><input type="color" value="${esc(t.color)}" aria-label="Barva"><input class="s-input sm" value="${esc(t.name)}" maxlength="30" aria-label="Název týmu"></div>`).join('')}
      <div class="inl"><button class="s-btn s-sm s-primary" id="tsave">Uložit týmy</button></div>
      <div class="sep"></div>
      <div class="lab">Výchozí ocenění každého týmu</div>
      <p class="hint">Za kolik mil. $ startupy začínají, než do nich kdokoli investuje. Jde změnit jen před prvním showdownem.</p>
      <div class="inl"><span class="unit"><input class="s-input sm num" id="startv" inputmode="decimal" value="${esc(mil(S.startV))}" ${S.anyHoldings ? 'disabled' : ''} aria-label="Výchozí ocenění v mil. $"> mil. $</span>
        <button class="s-btn s-sm" id="startvgo" ${S.anyHoldings ? 'disabled' : ''}>Nastavit</button></div>`;
    watchDirty(el, 'teams');
    $('tsave').onclick = () => {
      const teams = all(el, '.trow').map((row) => ({ id: row.dataset.t, color: row.querySelector('[type=color]').value, name: row.querySelector('.s-input').value.trim() }));
      if (teams.some((t) => !t.name)) return toast('Každý tým potřebuje název.', true);
      redraw('teams');
      act('teams', { teams }, 'Týmy uloženy');
    };
    $('startvgo').onclick = () => {
      const v = Math.round(parseNum($('startv').value) * 1e6);
      if (!(v > 0)) return toast('Zadejte číslo, např. 1 nebo 0,5.', true);
      redraw('teams');
      act('startValuation', { V: v }, 'Výchozí ocenění nastaveno');
    };
  }

  function renderStLive() {
    const dem = D.settled[S.block + 'c'] ? demandOf(S.block) : null;
    const el = gate('stlive', [liveDeps(), S.teams.map((t) => [t.id, t.name, t.color]), S.phase, S.block, dem, pendingNow()]);
    if (!el) return;
    const live = pendingNow();
    const list = [...S.teams].sort((a, b) => rankOf(a) - rankOf(b) || vNow(b) - vNow(a));
    el.innerHTML = `<div class="ch"><h3>Ocenění startupů</h3><span class="s-badge ${live ? 's-ok' : ''}">${live ? 'živě během investování' : dem ? `po showdownu bloku ${S.block}` : `blok ${S.block}`}</span></div>
      ${live && F('demand') ? '<p class="hint">Živý odhad: cena se mění podle poptávky v\u00a0tomto bloku. Po showdownu bude stejná.</p>' : ''}
      <div class="lboard">${list.map((t) => `<div class="lbr"><span class="lbn">#${rankOf(t)}</span>${tlabel(t.id)}${liveHTML(t, { rank: false })}${dem && dem.mult && Number.isFinite(Number(dem.mult[t.id])) ? `<span class="dm">poptávka ${esc(multTxt(dem.mult[t.id]))}</span>` : ''}</div>`).join('')}</div>`;
  }

  function renderCards() {
    if (!show('cardsbox', F('cards'))) return;
    const wrap = $('cards'), sig = S.teams.map((t) => t.id).join();
    if (wrap.dataset.sig !== sig) {
      wrap.innerHTML = S.teams.map((t) => `<div class="tcard" id="card-${t.id}"></div>`).join('');
      wrap.dataset.sig = sig;
      S.teams.forEach((t) => redraw('card-' + t.id));
    }
    const defs = S.milestoneDefs || [];
    for (const t of S.teams) {
      const id = 'card-' + t.id, c = (S.cards || {})[t.id] || {};
      const el = gate(id, [t.name, t.color, c, defs, firstMember(t.id)?.id || '']);
      if (!el) continue;
      const blocks = [...new Set(defs.map((d) => d.block))].sort((a, b) => a - b);
      const prevD = el.querySelector('details'), isOpen = prevD ? prevD.open : window.innerWidth >= 900;
      el.innerHTML = `<details ${isOpen ? 'open' : ''}><summary class="tch">${tlabel(t.id)}<span class="s-faint sm">${c.oneLiner ? '' : 'bez one-lineru · '}${Object.values(c.milestones || {}).filter(Boolean).length}/${defs.length} milníků</span></summary><div class="tcb">
        <label class="lab">One-liner <span class="cnt" data-cnt="oneLiner"></span></label>
        <input class="s-input sm" data-k="oneLiner" maxlength="90" value="${esc(c.oneLiner || '')}" placeholder="Co dělají, jednou větou">
        <label class="lab">Popis <span class="cnt" data-cnt="sub"></span></label>
        <textarea class="s-input sm" data-k="sub" maxlength="220" rows="3" placeholder="Pro koho, jaký problém, čím jsou jiní">${esc(c.sub || '')}</textarea>
        <div class="lab">Milníky</div>
        <div class="ms">${blocks.map((b) => `<div class="msb"><span class="s-label">Blok ${esc(b)}</span>${defs.filter((d) => d.block === b).map((d) => `<label class="mchk"><input type="checkbox" data-m="${esc(d.key)}" ${c.milestones?.[d.key] ? 'checked' : ''}><span>${esc(d.label)}</span></label>`).join('')}</div>`).join('') || '<span class="s-faint sm">Žádné milníky.</span>'}</div>
        <div class="tcf"><span class="s-faint sm" data-st></span><span class="tcfb">${teamPreviewBtn(t.id)}<button class="s-btn s-sm s-primary" data-save>Uložit kartu</button></span></div></div></details>`;
      wireTeamPreview(el);
      watchDirty(el, id);
      const cnt = () => all(el, '[data-cnt]').forEach((s) => { const f = el.querySelector(`[data-k="${s.dataset.cnt}"]`); s.textContent = `${f.value.length}/${f.maxLength}`; });
      cnt();
      el.addEventListener('input', () => { cnt(); el.querySelector('[data-st]').textContent = 'neuloženo'; });
      el.querySelector('[data-save]').onclick = async () => {
        const milestones = {};
        for (const d of defs) milestones[d.key] = !!el.querySelector(`[data-m="${CSS.escape(d.key)}"]`)?.checked;
        const r = await act('card', { team: t.id, oneLiner: el.querySelector('[data-k=oneLiner]').value.trim(), sub: el.querySelector('[data-k=sub]').value.trim(), milestones }, `Karta ${t.name} uložena`);
        if (r.ok) redraw(id);
      };
    }
  }

  function renderRounds() {
    if (!show('rounds', F('rounds'))) return;
    const open = ['lobby', 'pitch'].includes(S.phase) && !D.settled[S.block + 'c'] && !D.settled[S.block + 't'];
    const R = S.rounds || {}, RT = D.roundTerms || {}, locked = !!D.settled[S.block + 't'];
    const has = (id) => (locked ? !!(D.rounds?.[S.block] || {})[id] : !!RT[`rt:${S.block}:${id}`]);
    const el = gate('rounds', [S.teams.map((t) => [t.id, t.name, t.color, t.V]), R, RT, locked, open, S.block]);
    if (!el) return;
    const rng = (V) => [Math.round((V * 0.5) / 1e4) * 1e4, Math.round((V * 2) / 1e4) * 1e4];
    el.innerHTML = `<div class="ch"><h3>Kolo financování · blok ${S.block}</h3>${open ? '<span class="s-badge s-ok">podmínky otevřené</span>' : '<span class="s-badge">uzamčeno</span>'}</div>
      <p class="hint">Pre-money, za kterou tým v tomto bloku prodává podíl. Rozsah 50–200 % dnešního ocenění. Po otevření investování se kurz přepočítá a podmínky se zamknou. Bez podmínek = flat round.</p>
      ${S.teams.map((t) => {
        const r = has(t.id) ? R[t.id] : null, [lo, hi] = rng(t.V);
        return `<div class="rrow" data-t="${t.id}"><div>${tlabel(t.id)}<div class="meta">teď ${esc(fmtM(t.V))} · ${esc(fmtM(lo))}–${esc(fmtM(hi))}</div></div>
          ${r ? `<span class="s-badge ${r.kind === 'up' ? 's-ok' : r.kind === 'down' ? 's-bad' : ''}">${esc(RK[r.kind] || r.kind)} ${esc(signPct(r.pct || 0))}</span>` : '<span class="s-faint sm">bez podmínek</span>'}
          <span class="unit"><input class="s-input sm num" inputmode="decimal" placeholder="${r ? esc(mil(r.pre)) : esc(mil(t.V))}" ${open ? '' : 'disabled'} aria-label="Pre-money ${tname(t.id)} v mil. $"> mil.</span></div>`;
      }).join('')}
      <div class="inl"><button class="s-btn s-sm s-primary" id="rsave" ${open ? '' : 'disabled'}>Uložit podmínky</button></div>`;
    watchDirty(el, 'rounds');
    $('rsave').onclick = async () => {
      const rows = all(el, '.rrow').map((row) => [row.dataset.t, row.querySelector('input').value.trim()]).filter(([, v]) => v);
      if (!rows.length) return toast('Zadejte pre-money aspoň u jednoho týmu.', true);
      let okN = 0;
      for (const [id, v] of rows) {
        const pre = Math.round((parseNum(v) * 1e6) / 1e4) * 1e4;
        const r = await post({ op: 'roundTerms', team: id, pre }, H());
        if (r.dump) mergeBk(r.dump);
        if (!r.ok) { toast(`${team(id).name}: ${r.error || 'chyba'}`, true); break; }
        okN++;
      }
      if (okN) { flash(`Uloženo (${okN})`); redraw('rounds'); tick(); }
    };
  }

  let md = null; // milestone defs being edited
  function renderMdefs() {
    if (!show('mdefs', F('cards'))) return;
    const defs = S.milestoneDefs || [];
    const el = gate('mdefs', [defs]);
    if (!el) return;
    md = defs.map((d) => ({ ...d }));
    drawMdefs();
  }
  function drawMdefs() {
    const el = $('mdefs');
    el.innerHTML = `<div class="ch"><h3>Seznam milníků</h3><span class="s-label">${md.length}</span></div>
      <p class="hint">Milníky, které jde týmům odškrtávat. Klíč se po uložení nemění (drží splněné milníky).</p>
      ${md.map((d, i) => `<div class="mdr" data-i="${i}"><input class="s-input sm key" value="${esc(d.key)}" maxlength="12" aria-label="Klíč" ${d.saved ? 'readonly' : ''}><input class="s-input sm" data-l value="${esc(d.label)}" maxlength="60" aria-label="Název"><select class="s-input sm" data-b aria-label="Blok">${[1, 2, 3, 4, 5].map((b) => `<option ${Number(d.block) === b ? 'selected' : ''}>${b}</option>`).join('')}</select><button class="ib del" data-rm title="Odebrat">✕</button></div>`).join('')}
      <div class="inl"><button class="s-btn s-sm s-ghost" id="mdadd">+ Přidat milník</button><button class="s-btn s-sm s-primary" id="mdsave">Uložit milníky</button></div>`;
    md.forEach((d) => { if (d.saved === undefined) d.saved = !!(S.milestoneDefs || []).some((x) => x.key === d.key); });
    all(el, '.key').forEach((k) => { if (md[+k.closest('.mdr').dataset.i].saved) k.readOnly = true; });
    all(el, '.mdr').forEach((row) => {
      const d = md[+row.dataset.i];
      row.querySelector('.key').oninput = (e) => { d.key = e.target.value.trim(); dirty.mdefs = true; };
      row.querySelector('[data-l]').oninput = (e) => { d.label = e.target.value; dirty.mdefs = true; };
      row.querySelector('[data-b]').onchange = (e) => { d.block = Number(e.target.value); dirty.mdefs = true; };
      row.querySelector('[data-rm]').onclick = () => { md.splice(+row.dataset.i, 1); dirty.mdefs = true; drawMdefs(); };
    });
    $('mdadd').onclick = () => { md.push({ key: 'm' + (md.length + 1) + Math.random().toString(36).slice(2, 4), label: '', block: S.block, saved: false }); dirty.mdefs = true; drawMdefs(); };
    $('mdsave').onclick = async () => {
      const defs = md.map((d) => ({ key: String(d.key).trim(), label: String(d.label).trim(), block: Number(d.block) || 1 }));
      if (defs.some((d) => !d.key || !d.label)) return toast('Každý milník potřebuje klíč i název.', true);
      if (new Set(defs.map((d) => d.key)).size !== defs.length) return toast('Klíče milníků se nesmí opakovat.', true);
      const r = await act('milestoneDefs', { defs }, 'Milníky uloženy');
      if (r.ok) redraw('mdefs');
    };
  }

  function renderStNote() {
    const off = ['cards', 'rounds'].filter((k) => !F(k));
    const el = $('stnote');
    el.hidden = !off.length;
    el.innerHTML = off.length ? `${off.map(featName).join(' a ')} – ${off.length > 1 ? 'vypnuté' : 'vypnuto'}. Zapnete v záložce <button class="linkb" data-goto="funkce">Funkce</button>.` : '';
  }

  // ---------- Kvíz ----------
  let qzSel = store.get('mup.qzset') || null;
  const quizSets = () => (D && Array.isArray(D.quizSets) && D.quizSets) || (S && Array.isArray(S.quizSets) && S.quizSets) || (DV && Array.isArray(DV.quizSets) && DV.quizSets) || [];
  const QST = { idle: 'připraveno', question: 'otázka běží', reveal: 'odhalení', board: 'žebříček', done: 'konec' };
  function renderQuizLive() {
    const q = S.quiz || { state: 'idle' };
    const { serverNow, ...qk } = q;
    const sets = quizSets();
    const dq = D.quiz || {};
    const el = gate('qzlive', [F('quiz'), featKnown(), qk, S.playerCount, sets.map((s) => [s.id, s.title, (s.questions || []).length]), qzSel, dq.answers, dq.question]);
    if (!el) return;
    if (!F('quiz')) { el.innerHTML = `<div class="ch"><h3>Kvíz</h3></div>${offCard('quiz', 'Studenti ho v mobilech neuvidí.')}`; return; }
    if (!qzSel || !sets.some((s) => s.id === qzSel)) qzSel = sets[0]?.id || null;
    const running = ['question', 'reveal', 'board'].includes(q.state);
    const n = (q.idx ?? -1) + 1, total = q.total || 0;
    const ns = nextStep();
    const rec = running || q.state === 'done' ? ns.quiz : 'qzstart';
    const b = (id, label, extra = '') => `<button class="s-btn qzb ${rec === id ? 's-primary' : 's-ghost'}" id="${id}" ${extra}>${label}</button>`;
    const set = sets.find((s) => s.id === dq.setId) || sets.find((s) => s.title === q.setTitle);
    const srcQ = dq.question || set?.questions?.[q.idx];
    const correct = q.state === 'reveal' ? q.correct : srcQ && srcQ.q === q.q ? srcQ.correct : null;
    const answers = (dq.answers || []).filter((a) => !a.ghost);
    const who = answers.length && (q.state === 'question' || q.state === 'reveal')
      ? `<div class="lab sec">Odpověděli (${answers.length}) · od nejrychlejšího</div><div class="chips">${answers.map((a) => `<span class="nchip ${q.state === 'reveal' ? (a.choice === correct ? 'good' : 'bad') : ''}">${dot(team(a.team).color)}${esc(a.name)}<span class="s-faint">${'ABCD'[a.choice] || '?'} · ${esc(nb((a.ms / 1000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })))} s</span></span>`).join('')}</div>`
      : '';
    const counts = q.counts || [];
    const tiles = (q.a || []).map((x, k) => `<div class="qt a${k} ${correct === k ? 'ok' : ''} ${q.state === 'reveal' && correct !== k ? 'dim' : ''}"><span class="L">${'ABCD'[k]}</span><span class="tx">${esc(x)}</span>${q.state === 'reveal' ? `<b class="cnt">${counts[k] || 0}</b>` : correct === k ? '<span class="s-badge">správně</span>' : ''}</div>`).join('');
    const leaders = q.leaders || [];
    let body = '';
    if (q.state === 'question' || q.state === 'reveal') {
      const ans = q.answered || 0;
      body = `<div class="qzlive">
        <div class="qzq"><div class="s-label">Otázka ${n}/${total}${q.time ? ` · ${q.time} s` : ''}</div><div class="qtext">${esc(q.q || '')}</div><div class="qtiles">${tiles}</div>
          ${q.state === 'reveal' && q.fastest ? `<div class="fast">Nejrychlejší správně: <b>${esc(q.fastest.name)}</b> (${tname(q.fastest.team)}) · ${esc(nb((q.fastest.ms / 1000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })))} s</div>` : ''}</div>
        <div class="qzstat"><div class="big"><b>${ans}</b><span>/${S.playerCount}</span></div><div class="s-muted">odpovědělo</div>
          <div class="s-progress"><i style="width:${S.playerCount ? Math.min(100, (ans / S.playerCount) * 100) : 0}%"></i></div>
          <div class="cd" id="qztime"></div></div></div>${who}`;
    } else if (q.state === 'board' || q.state === 'done') {
      body = `<div class="lab sec">${q.state === 'done' ? 'Konečné pořadí kvízu' : n ? `Žebříček po ${n}. otázce` : 'Úvodní obrazovka kvízu – studenti se připravují'}</div>
        ${leaders.length ? `<ol class="rank">${leaders.map((r) => `<li>${dot(team(r.team).color)}<span>${esc(r.name)}</span><b>${plain(r.quizPoints)} b.</b><span class="s-faint">celkem ${plain(r.total)}</span></li>`).join('')}</ol>` : '<p class="hint">Zatím bez bodů.</p>'}`;
    } else {
      body = '<p class="hint">Vyberte sadu a spusťte kvíz. Plátno ukáže úvodní obrazovku, studenti uvidí kvíz v mobilu. Pak už stačí tlačítko „Další krok“ nahoře.</p>';
    }
    el.innerHTML = `<div class="ch"><h3>Kvíz živě</h3><span class="s-badge ${running ? 's-ok' : ''}">${esc(QST[q.state] || q.state)}${q.setTitle && q.state !== 'idle' ? ` · ${esc(q.setTitle)}` : ''}</span></div>
      <div class="inl"><select class="s-input sm grow" id="qzset" aria-label="Sada otázek">${sets.map((s) => `<option value="${esc(s.id)}" ${s.id === qzSel ? 'selected' : ''}>${esc(s.title)} · ${(s.questions || []).length} ${pl((s.questions || []).length, 'otázka', 'otázky', 'otázek')}</option>`).join('') || '<option value="">Žádná sada</option>'}</select>
        ${b('qzstart', running ? 'Spustit znovu' : 'Spustit kvíz', sets.length ? '' : 'disabled')}</div>
      <div class="qzctl">
        ${b('qznext', q.idx < 0 && running ? 'První otázka' : 'Další otázka', running ? '' : 'disabled')}
        ${b('qzreveal', 'Odhalit odpověď', running ? '' : 'disabled')}
        ${b('qzboard', 'Žebříček', running ? '' : 'disabled')}
        ${b('qzend', q.state === 'done' ? 'Skrýt z plátna' : 'Ukončit kvíz', running || q.state === 'done' ? '' : 'disabled')}
      </div>${body}`;
    $('qzset').onchange = (e) => { qzSel = e.target.value; store.set('mup.qzset', qzSel); };
    $('qzstart').onclick = () => quiz('quizStart');
    $('qznext').onclick = () => quiz('quizNext');
    $('qzreveal').onclick = () => quiz('quizReveal');
    $('qzboard').onclick = () => quiz('quizBoard');
    $('qzend').onclick = () => quiz('quizEnd');
    tickClock();
  }

  let qe = null, qeId = null, qeOpen = false;
  const newId = () => 's' + Date.now().toString(36);
  function renderQuizSets() {
    if (!show('qzsets', F('quiz'))) return;
    if (dirty.qzsets) return;
    const sets = quizSets();
    const el = gate('qzsets', [sets, qeId]);
    if (!el) return;
    if (!qeId || !sets.some((s) => s.id === qeId)) qeId = sets[0]?.id || null;
    const src = sets.find((s) => s.id === qeId);
    qe = src ? JSON.parse(JSON.stringify(src)) : { id: newId(), title: 'Nová sada', questions: [], isNew: true };
    drawQe();
  }
  function setQeDirty() {
    dirty.qzsets = true;
    const b = $('qedirty');
    if (b) b.hidden = false;
  }
  function qHTML(q, i) {
    const a = [0, 1, 2, 3].map((k) => (q.a || [])[k] ?? '');
    return `<div class="qe" data-i="${i}">
      <div class="qeh"><span class="qn">${i + 1}</span><textarea class="s-input sm" data-f="q" maxlength="160" rows="2" placeholder="Text otázky">${esc(q.q || '')}</textarea>
        <div class="qeb"><button class="ib" data-mv="-1" ${i === 0 ? 'disabled' : ''} title="Posunout nahoru">↑</button><button class="ib" data-mv="1" ${i === qe.questions.length - 1 ? 'disabled' : ''} title="Posunout dolů">↓</button><button class="ib del" data-rm title="Smazat otázku">✕</button></div></div>
      <div class="qea">${a.map((x, k) => `<label class="qa a${k} ${q.correct === k ? 'ok' : ''}"><input type="radio" name="qc${i}" value="${k}" ${q.correct === k ? 'checked' : ''} title="Správná odpověď"><span class="L">${'ABCD'[k]}</span><input class="s-input sm" data-a="${k}" maxlength="80" value="${esc(x)}" placeholder="Odpověď ${'ABCD'[k]}${k > 1 ? ' (nepovinná)' : ''}"></label>`).join('')}</div>
      <div class="qet"><span class="s-faint sm">Kliknutím na kolečko označíte správnou odpověď.</span><span class="unit">čas <input class="s-input sm num" data-f="time" inputmode="numeric" value="${esc(q.time || 20)}" aria-label="Čas v sekundách"> s</span></div>${window.MupQuizPlusEd ? window.MupQuizPlusEd.fields(q, i) : ''}</div>`;
  }
  function drawQe() {
    const el = $('qzsets'), sets = quizSets();
    el.innerHTML = `<div class="ch"><h3>Sady otázek</h3><span class="s-badge s-warn" id="qedirty" ${dirty.qzsets ? '' : 'hidden'}>neuloženo</span></div>
      <div class="inl"><select class="s-input sm grow" id="qeset" aria-label="Upravovaná sada">${sets.map((s) => `<option value="${esc(s.id)}" ${s.id === qe.id ? 'selected' : ''}>${esc(s.title)} (${(s.questions || []).length})</option>`).join('')}${qe.isNew ? `<option value="" selected>${esc(qe.title)} (nová)</option>` : ''}</select>
        <button class="s-btn s-sm s-ghost" id="qenew">+ Nová sada</button>
        <button class="s-btn s-sm s-ghost" id="qeimp">Importovat JSON</button>
        <button class="s-btn s-sm s-ghost" id="qeexp">Exportovat JSON</button>
        <input type="file" id="qefile" accept=".json,application/json" hidden></div>
      ${qeOpen ? `<div class="s-field"><label class="lab" for="qetitle">Název sady</label><input class="s-input sm" id="qetitle" maxlength="60" value="${esc(qe.title || '')}"></div>
      <div class="qlist">${qe.questions.map(qHTML).join('') || '<p class="hint">Sada je prázdná. Přidejte první otázku.</p>'}</div>
      <div class="inl"><button class="s-btn s-sm s-ghost" id="qeadd">+ Přidat otázku</button><span class="grow"></span>
        ${qe.isNew ? '' : '<button class="s-btn s-sm s-danger" id="qedel">Smazat sadu</button>'}
        <button class="s-btn s-sm s-ghost" id="qedrop">${dirty.qzsets ? 'Zahodit změny' : 'Zavřít'}</button>
        <button class="s-btn s-sm s-primary" id="qesave">Uložit sadu</button></div>`
      : `<ol class="qsum">${qe.questions.map((q) => `<li><span>${esc(q.q)}${window.MupQuizPlusEd?.badges(q) || ''}</span><span class="s-faint sm">${'ABCD'[q.correct] || '?'} · ${esc(q.time)} s</span></li>`).join('') || '<li class="s-faint">Sada je prázdná.</li>'}</ol>
      <div class="inl"><button class="s-btn s-sm" id="qeopen">Upravit otázky</button></div>`}`;
    if (!qeOpen) {
      $('qeset').onchange = (e) => { qeId = e.target.value || null; redraw('qzsets'); renderQuizSets(); };
      $('qeopen').onclick = () => { qeOpen = true; drawQe(); };
      $('qenew').onclick = () => { qeOpen = true; qe = { id: newId(), title: 'Nová sada', isNew: true, questions: [{ q: '', a: ['', '', '', ''], correct: 0, time: 20 }] }; setQeDirty(); drawQe(); };
      $('qeimp').onclick = () => $('qefile').click();
      $('qefile').onchange = async (e) => { const f = e.target.files?.[0]; if (f) { qeOpen = true; importJSON(await f.text()); } e.target.value = ''; };
      $('qeexp').onclick = () => download(`kviz-${(qe.title || 'sada').replace(/[^\w\u00C0-\u017F-]+/g, '-')}.json`, JSON.stringify({ id: qe.id, title: qe.title, questions: qe.questions }, null, 1));
      return;
    }
    $('qeset').onchange = (e) => {
      if (dirty.qzsets && !confirm('Zahodit neuložené změny v sadě?')) { e.target.value = qe.id; return; }
      qeId = e.target.value || null; redraw('qzsets'); renderQuizSets();
    };
    $('qetitle').oninput = (e) => { qe.title = e.target.value; setQeDirty(); };
    $('qenew').onclick = () => {
      if (dirty.qzsets && !confirm('Zahodit neuložené změny v sadě?')) return;
      qe = { id: newId(), title: 'Nová sada', isNew: true, questions: [{ q: '', a: ['', '', '', ''], correct: 0, time: 20 }] };
      setQeDirty(); drawQe();
    };
    $('qeimp').onclick = () => $('qefile').click();
    $('qefile').onchange = async (e) => { const f = e.target.files?.[0]; if (f) importJSON(await f.text()); e.target.value = ''; };
    $('qeexp').onclick = () => download(`kviz-${(qe.title || 'sada').replace(/[^\wÀ-ſ-]+/g, '-')}.json`, JSON.stringify({ id: qe.id, title: qe.title, questions: qe.questions }, null, 1));
    $('qeadd').onclick = () => { qe.questions.push({ q: '', a: ['', '', '', ''], correct: 0, time: 20 }); setQeDirty(); drawQe(); const l = all($('qzsets'), '.qe'); l[l.length - 1]?.querySelector('textarea')?.focus(); };
    if ($('qedel')) $('qedel').onclick = async () => {
      if (!confirm(`Smazat sadu „${qe.title}“? Tohle nejde vrátit.`)) return;
      const r = await act('quizDelete', { id: qe.id }, 'Sada smazána');
      if (r.ok) { qeId = null; redraw('qzsets'); }
    };
    $('qedrop').onclick = () => { if (dirty.qzsets && !confirm('Zahodit neuložené změny?')) return; qeOpen = false; redraw('qzsets'); if (qe.isNew) qeId = null; renderQuizSets(); };
    $('qesave').onclick = async () => {
      const c = cleanSet(qe);
      if (c.error) return toast(c.error, true);
      const r = await act('quizSave', { set: c.set }, 'Sada uložena');
      if (r.ok) { qeId = c.set.id; qeOpen = false; redraw('qzsets'); }
    };
    all(el, '.qe').forEach((box) => {
      const i = +box.dataset.i, q = qe.questions[i];
      box.querySelector('[data-f=q]').oninput = (e) => { q.q = e.target.value; setQeDirty(); };
      box.querySelector('[data-f=time]').oninput = (e) => { q.time = Number(e.target.value.replace(/\D/g, '')) || 0; setQeDirty(); };
      all(box, '[data-a]').forEach((inp) => (inp.oninput = () => { q.a = [0, 1, 2, 3].map((k) => (q.a || [])[k] ?? ''); q.a[+inp.dataset.a] = inp.value; setQeDirty(); }));
      all(box, 'input[type=radio]').forEach((r) => (r.onchange = () => { q.correct = +r.value; all(box, '.qa').forEach((l, k) => l.classList.toggle('ok', k === q.correct)); setQeDirty(); }));
      all(box, '[data-mv]').forEach((b) => (b.onclick = () => { const j = i + Number(b.dataset.mv); [qe.questions[i], qe.questions[j]] = [qe.questions[j], qe.questions[i]]; setQeDirty(); drawQe(); }));
      box.querySelector('[data-rm]').onclick = () => { if ((q.q || '').trim() && !confirm(`Smazat otázku ${i + 1}?`)) return; qe.questions.splice(i, 1); setQeDirty(); drawQe(); };
      window.MupQuizPlusEd?.bind(box, q, setQeDirty, drawQe); // v4 quizplus: why / ×2 / image
    });
  }
  function cleanSet(s) {
    const questions = [];
    for (const [i, q] of (s.questions || []).entries()) {
      const text = String(q.q || '').trim();
      const kept = [];
      let correct = -1;
      (q.a || []).forEach((x, k) => { const v = String(x || '').trim(); if (v) { if (k === q.correct) correct = kept.length; kept.push(v.slice(0, 80)); } });
      if (!text) return { error: `Otázka ${i + 1} nemá text.` };
      if (kept.length < 2) return { error: `Otázka ${i + 1} potřebuje aspoň dvě odpovědi.` };
      if (correct < 0) return { error: `U otázky ${i + 1} označte správnou (vyplněnou) odpověď.` };
      questions.push({ q: text.slice(0, 160), a: kept, correct, time: Math.min(120, Math.max(5, Math.round(Number(q.time) || 20))), ...(window.MupQuizPlusEd?.clean(q) || {}) });
    }
    if (!questions.length) return { error: 'Sada potřebuje aspoň jednu otázku.' };
    return { set: { id: s.id, title: String(s.title || '').trim().slice(0, 60) || 'Kvíz', questions } };
  }
  function importJSON(txt) {
    let j;
    try { j = JSON.parse(txt); } catch { return toast('Soubor není platný JSON.', true); }
    const set = Array.isArray(j) ? { questions: j } : j && Array.isArray(j.questions) ? j : j && Array.isArray(j.quizSets) ? j.quizSets[0] : null;
    if (!set || !Array.isArray(set.questions)) return toast('V JSON chybí seznam otázek.', true);
    qe = {
      id: newId(), title: String(set.title || 'Import'), isNew: true,
      questions: set.questions.map((q) => ({ q: String(q.q ?? q.question ?? ''), a: (q.a || q.answers || []).slice(0, 4).map((x) => String(x ?? '')), correct: Number(q.correct) || 0, time: Number(q.time) || 20, ...(window.MupQuizPlusEd?.clean(q) || {}) })),
    };
    setQeDirty(); drawQe();
    toast(`Načteno ${qe.questions.length} otázek – zkontrolujte a uložte.`);
  }

  // ---------- Body ----------
  const ledger = () => (D && Array.isArray(D.points) ? D.points : DV && Array.isArray(DV.points) ? DV.points : null);
  const pointsTotals = () => {
    const m = {};
    for (const e of ledger() || []) m[e.playerId] = (m[e.playerId] || 0) + (Number(e.amt) || 0);
    return m;
  };
  const pname = (id) => (D.rows || []).find((r) => r.id === id)?.name || (DV?.players || []).find((p) => p.id === id)?.name || id;
  let pAmt = '100';
  function renderPointsAdd() {
    const rows = (D.rows || []).slice().sort(byTeamName);
    const el = gate('ptsadd', [F('points'), featKnown(), S.teams.map((t) => [t.id, t.name]), rows.map((r) => [r.id, r.name, r.team])]);
    if (!el) return;
    if (!F('points')) { el.innerHTML = `<div class="ch"><h3>Body</h3></div>${offCard('points', 'Kvíz a ocenění se pak nesčítají do žebříčku.')}`; return; }
    el.innerHTML = `<div class="ch"><h3>Přidat nebo ubrat body</h3></div>
      <div class="s-field"><label class="lab" for="ptarget">Komu</label><select class="s-input sm" id="ptarget"><optgroup label="Celý tým (každý člen)">${S.teams.map((t) => `<option value="team:${t.id}">${esc(t.name)} – celý tým</option>`).join('')}</optgroup><optgroup label="Hráč">${rows.map((r) => `<option value="p:${r.id}">${esc(r.name)} · ${tname(r.team)}</option>`).join('')}</optgroup></select></div>
      <div class="s-field"><label class="lab" for="pamt">Body (záporné ubírají)</label><div class="inl"><input class="s-input sm num" id="pamt" inputmode="numeric" value="${esc(pAmt)}">${[100, 250, 500, -100].map((v) => `<button class="pq" data-pv="${v}">${v > 0 ? '+' : '−'}${Math.abs(v)}</button>`).join('')}</div></div>
      <div class="s-field"><label class="lab" for="pnote">Za co</label><input class="s-input sm" id="pnote" maxlength="120" placeholder="Např. nejlepší otázka v diskusi"></div>
      <button class="s-btn s-primary" id="padd">Zapsat body</button>`;
    watchDirty(el, 'ptsadd');
    $('pamt').oninput = (e) => { pAmt = e.target.value; };
    all(el, '[data-pv]').forEach((b) => (b.onclick = () => { $('pamt').value = pAmt = b.dataset.pv; }));
    $('padd').onclick = async () => {
      const amt = Math.round(parseNum($('pamt').value));
      if (!amt || amt < -5000 || amt > 5000) return toast('Body musí být mezi −5 000 a 5 000 a nesmí být 0.', true);
      const [kind, id] = $('ptarget').value.split(':');
      const note = $('pnote').value.trim() || 'Body od RainbowJet';
      const r = await act('pointsAdd', { ...(kind === 'team' ? { team: id } : { playerId: id }), amt, note, kind: 'manual' }, `${amt > 0 ? 'Přidáno' : 'Ubráno'} ${Math.abs(amt)} b. – ${kind === 'team' ? team(id).name + ' (celý tým)' : pname(id)}`);
      if (r.ok) { $('pnote').value = ''; dirty.ptsadd = false; }
    };
  }
  function renderPointsTop() {
    if (!show('ptstop', F('points'))) return;
    const P = S.points || {};
    const el = gate('ptstop', [P, S.teams.map((t) => [t.id, t.name, t.color])]);
    if (!el) return;
    const tavg = P.teams || {};
    const maxT = Math.max(1, ...S.teams.map((t) => tavg[t.id] || 0));
    el.innerHTML = `<div class="ch"><h3>Žebříček bodů</h3><span class="s-label">top 10</span></div>
      ${(P.leaders || []).length ? `<ol class="rank">${P.leaders.map((r) => `<li>${dot(team(r.team).color)}<span>${esc(r.name)}</span><b>${plain(r.total)} b.</b></li>`).join('')}</ol>` : '<p class="hint">Zatím nikdo nemá body.</p>'}
      <div class="lab sec">Průměr na člena týmu</div>
      <div class="hbars">${S.teams.map((t) => `<div class="hb">${tlabel(t.id)}<div class="hbbar"><i style="width:${((tavg[t.id] || 0) / maxT) * 100}%;background:${esc(t.color)}"></i></div><b>${plain(tavg[t.id] || 0)}</b></div>`).join('')}</div>`;
  }
  const PK = { quiz: 'kvíz', award: 'ocenění', milestone: 'milník', manual: 'ručně' };
  function renderLedger() {
    if (!show('ptsledger', F('points'))) return;
    const L = ledger();
    const el = gate('ptsledger', [L, (D.rows || []).map((r) => [r.id, r.name, r.team])]);
    if (!el) return;
    el.innerHTML = `<div class="ch"><h3>Záznamy bodů</h3><span class="s-label">${L ? L.length : ''}</span></div>
      ${!L ? '<p class="hint">Načítám…</p>' : !L.length ? '<p class="hint">Zatím žádné záznamy.</p>' : `<div class="ledger">${L.slice().reverse().slice(0, 300).map((e) => {
        const p = (D.rows || []).find((r) => r.id === e.playerId);
        return `<div class="le" data-id="${esc(e.id)}"><span class="lw">${dot(team(p?.team).color)}<b>${esc(pname(e.playerId))}</b><span class="s-faint sm">${esc(PK[e.kind] || e.kind)} · ${esc(when(e.ts))}</span><span class="sm s-muted">${esc(e.note || '')}</span></span><b class="${e.amt > 0 ? 's-up' : 's-down'}">${e.amt > 0 ? '+' : '−'}${plain(Math.abs(e.amt))}</b><button class="ib del" data-rm title="Odebrat záznam">✕</button></div>`;
      }).join('')}</div>`}`;
    all(el, '.le').forEach((row) => (row.querySelector('[data-rm]').onclick = async () => {
      const e = L.find((x) => x.id === row.dataset.id);
      if (!confirm(`Odebrat ${e.amt > 0 ? '+' : ''}${e.amt} b. hráči ${pname(e.playerId)}?`)) return;
      const r = await act('pointsRemove', { id: e.id }, 'Záznam odebrán');
      if (r.ok) redraw('ptsledger');
    }));
  }

  // ---------- student preview (§10) + login QR (§9) ----------
  const IC = {
    eye: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M1.5 10S4.6 4 10 4s8.5 6 8.5 6-3.1 6-8.5 6S1.5 10 1.5 10Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.6" fill="currentColor"/></svg>',
    qr: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 2.5h6v6h-6zM11.5 2.5h6v6h-6zM2.5 11.5h6v6h-6z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4.8 4.8h1.4v1.4H4.8zM13.8 4.8h1.4v1.4h-1.4zM4.8 13.8h1.4v1.4H4.8zM11.5 11.5h2.5V14h-2.5zM15 15h2.5v2.5H15zM11.5 15.5h2v2h-2zM15.5 11.5h2v2h-2z" fill="currentColor"/></svg>',
  };
  const openPreview = (sid) => window.open('/play?as=' + encodeURIComponent(sid), '_blank');
  // first non-ghost member of a team (D.rows never contains ghosts)
  const firstMember = (tid) => (D && D.rows || []).find((r) => r.team === tid) || null;
  function teamPreviewBtn(tid, cls = '') {
    const m = firstMember(tid);
    return m
      ? `<button class="s-btn s-sm s-ghost pbtn ${cls}" data-tprev="${esc(m.id)}" title="Mobil týmu očima hráče ${esc(m.name)} – jen pro čtení">${IC.eye}<span>Náhled týmu</span></button>`
      : `<span class="tpw" title="Tým zatím nemá žádné hráče"><button class="s-btn s-sm s-ghost pbtn ${cls}" disabled>${IC.eye}<span>Náhled týmu</span></button></span>`;
  }
  const wireTeamPreview = (el) => all(el, '[data-tprev]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openPreview(b.dataset.tprev); }));

  function qrSvg(text) {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 8, margin: 0, scalable: true }); } catch (e) { console.warn('qrcode', e); return ''; }
  }
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  let qrm = null;
  function closeLoginQR() {
    if (!qrm) return;
    clearInterval(qrm.t);
    document.removeEventListener('keydown', qrm.key, true);
    qrm.el.remove();
    document.body.classList.remove('qrm-open');
    const f = qrm.focus;
    qrm = null;
    try { f && f.focus(); } catch {}
  }
  async function fetchLoginLink(sid) {
    let r;
    try { r = await post({ op: 'loginLink', sid }, H()); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    if (!r || !r.ok || !r.url) { toast((r && r.error) || 'QR odkaz se nepodařilo vytvořit.', true); return null; }
    let exp = Number(r.exp) || 0;
    if (exp && exp < 1e12) exp *= 1000; // seconds → ms
    if (!exp) exp = Date.now() + 10 * 60e3;
    return { url: location.origin + r.url, exp };
  }
  async function openLoginQR(sid) {
    const p = (D.rows || []).find((r) => r.id === sid) || (D.ghosts || []).find((g) => g.id === sid) || { id: sid, name: pname(sid) };
    const link = await fetchLoginLink(sid);
    if (!link) return;
    const focus = document.activeElement;
    closeLoginQR();
    const el = document.createElement('div');
    el.className = 'qrm';
    el.innerHTML = `<div class="qrm-card" role="dialog" aria-modal="true" aria-labelledby="qrmt">
      <button class="ib qrm-x" data-x aria-label="Zavřít">✕</button>
      <div class="s-label">Přihlášení bez PINu</div>
      <h3 id="qrmt">${dot(team(p.team).color)}${esc(p.name || '')}</h3>
      <div class="s-faint sm">${p.team ? tname(p.team) : ''}</div>
      <div class="qrm-code" data-code></div>
      <div class="qrm-exp" data-exp aria-live="polite"></div>
      <p class="hint">Hráč kód naskenuje telefonem a\u00a0je hned přihlášený. Dostane nový PIN, který mu ukážeme jednou. Kód platí 10\u00a0minut a\u00a0jde použít jen jednou.</p>
      <div class="qrm-url"><input class="s-input sm" data-url readonly aria-label="Odkaz pro přihlášení"><button class="s-btn s-sm" data-copy>Kopírovat</button></div>
      <div class="qrm-f"><button class="s-btn s-sm s-ghost" data-renew>Vytvořit nový</button><button class="s-btn s-sm s-ghost" data-x>Zavřít</button></div>
    </div>`;
    document.body.appendChild(el);
    document.body.classList.add('qrm-open');
    const card = el.querySelector('.qrm-card'), code = el.querySelector('[data-code]'), expEl = el.querySelector('[data-exp]'), urlIn = el.querySelector('[data-url]'), renew = el.querySelector('[data-renew]');
    qrm = { el, focus, link, t: 0, key: null };
    const set = (lk) => {
      qrm.link = lk;
      code.innerHTML = qrSvg(lk.url) || '<span class="s-down sm">QR se nepodařilo vykreslit – použijte odkaz níže.</span>';
      urlIn.value = lk.url;
      tickExp();
    };
    const tickExp = () => {
      if (!qrm) return;
      const left = qrm.link.exp - Date.now(), dead = left <= 0;
      card.classList.toggle('dead', dead);
      expEl.innerHTML = dead ? '<b class="s-down">Platnost vypršela.</b> Vytvořte nový kód.' : `Platí ještě <b>${mmss(left)}</b>`;
      renew.classList.toggle('s-primary', dead);
      renew.classList.toggle('s-ghost', !dead);
    };
    set(link);
    qrm.t = setInterval(tickExp, 1000);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-x]')) closeLoginQR(); });
    qrm.key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeLoginQR(); return; }
      if (e.key === 'Tab') { // keep focus inside the dialog
        const f = all(card, 'button:not([disabled]), input');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', qrm.key, true);
    el.querySelector('[data-copy]').onclick = async () => {
      const u = urlIn.value;
      let ok = false;
      try { await navigator.clipboard.writeText(u); ok = true; } catch {}
      if (!ok) { try { urlIn.select(); ok = document.execCommand('copy'); } catch {} }
      toast(ok ? 'Odkaz zkopírován' : 'Kopírování se nepovedlo – označte odkaz ručně.', !ok);
    };
    urlIn.onfocus = () => urlIn.select();
    renew.onclick = async () => {
      renew.disabled = true;
      const lk = await fetchLoginLink(sid);
      renew.disabled = false;
      if (lk && qrm && qrm.el === el) { set(lk); flash('Nový kód vytvořen'); }
    };
    el.querySelector('.qrm-x').focus();
  }

  // ---------- Hráči ----------
  let awPlayer = null;
  function renderPlayers() {
    const rows = (D.rows || []).slice().sort(byTeamName);
    const dvp = {};
    for (const p of (DV && DV.players) || []) dvp[p.id] = p;
    const pts = pointsTotals();
    const el = gate('players', [rows.map((r) => [r.id, r.name, r.team, r.hasPin, r.holdings, r.portfolio, !!r.locked]), S.teams.map((t) => [t.id, t.name, t.color]), Object.values(dvp).map((p) => [p.id, p.returnPct]), pts, F('points'), F('track'), S.regOpen]);
    if (!el) return;
    el.innerHTML = `<div class="ch"><h3>${E('dealer.sec.players')} (${rows.length})</h3><span class="s-badge ${S.regOpen ? 's-ok' : 's-warn'}">${S.regOpen ? 'registrace otevřená' : 'registrace zavřená'}</span></div>
      <p class="hint">Zapomenutý PIN: nejrychlejší je „QR“ – hráč ho naskenuje telefonem a\u00a0je zpátky přihlášený (dostane nový PIN). „PIN“ ho jen smaže a\u00a0hráč si při dalším přihlášení zvolí nový. „Náhled“ ukáže jeho mobil jen pro čtení. Smazat jde jen hráče bez investic.</p>
      <div class="ptable">
        <div class="pr head ${F('points') ? 'wp' : ''}"><span>Hráč</span><span>Portfolio</span><span>Výnos</span>${F('points') ? '<span>Body</span>' : ''}<span></span></div>
        ${rows.map((r) => {
          const ret = dvp[r.id]?.returnPct ?? (r.holdings ? (r.portfolio / 1e6 - 1) * 100 : null);
          return `<div class="pr ${F('points') ? 'wp' : ''}" data-id="${r.id}">
            <span class="pn"><span class="nm">${dot(team(r.team).color)}${esc(r.name)}</span><span class="s-faint sm">${tname(r.team)}${r.hasPin ? '' : ' · <span class="s-down">PIN resetován</span>'}${r.locked ? ' · <span class="s-down" title="Moc špatných PINů – pomůže QR nebo reset PINu">zamčeno</span>' : ''}</span></span>
            <span class="pv" data-l="Portfolio">${r.holdings ? esc(fmtM(r.portfolio)) : '–'}</span>
            <span class="pv ${ret > 0 ? 's-up' : ret < 0 ? 's-down' : ''}" data-l="Výnos">${ret == null ? '–' : esc(signPct(ret))}</span>
            ${F('points') ? `<span class="pv" data-l="Body">${plain(pts[r.id] || 0)}</span>` : ''}
            <span class="pa"><select class="s-input sm" data-move data-nodirty aria-label="Tým hráče">${S.teams.map((t) => `<option value="${t.id}" ${t.id === r.team ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
              <button class="s-btn s-sm s-ghost pbtn" data-prev title="Otevřít mobil hráče jen pro čtení">${IC.eye}<span>Náhled</span></button>
              <button class="s-btn s-sm s-ghost pbtn" data-qr title="QR kód pro přihlášení bez PINu">${IC.qr}<span>QR</span></button>
              <button class="s-btn s-sm s-ghost" data-reset title="Smazat PIN – hráč si zvolí nový">PIN</button>
              ${F('track') ? '<button class="s-btn s-sm s-ghost" data-award>Ocenit</button>' : ''}
              ${r.holdings ? '' : '<button class="s-btn s-sm s-danger" data-del title="Smazat hráče">✕</button>'}</span></div>`;
        }).join('') || '<p class="hint">Zatím nikdo není u stolu.</p>'}
      </div>`;
    all(el, '.pr[data-id]').forEach((row) => {
      const id = row.dataset.id, name = rows.find((r) => r.id === id)?.name || '';
      row.querySelector('[data-move]').onchange = (e) => {
        if (!confirm(`Přesunout ${name} do týmu ${team(e.target.value).name}?`)) { e.target.value = rows.find((r) => r.id === id).team; return; }
        act('movePlayer', { sid: id, team: e.target.value }, 'Přesunuto');
      };
      row.querySelector('[data-prev]').onclick = () => openPreview(id);
      row.querySelector('[data-qr]').onclick = () => openLoginQR(id);
      row.querySelector('[data-reset]').onclick = () => confirm(`Resetovat PIN hráči ${name}? Při dalším přihlášení si zvolí nový.`) && act('resetPin', { sid: id }, 'PIN resetován');
      const del = row.querySelector('[data-del]');
      if (del) del.onclick = () => confirm(`Smazat hráče ${name}?`) && act('removePlayer', { sid: id }, 'Smazáno');
      const aw = row.querySelector('[data-award]');
      if (aw) aw.onclick = () => { awPlayer = id; redraw('awards'); renderAwards(); $('awards').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('awnote')?.focus(); };
    });
  }

  let awKind = 'sharpest';
  function renderAwards() {
    if (!show('awards', F('track'))) return;
    const rows = (D.rows || []).slice().sort(byTeamName);
    const list = S.awards || [];
    const el = gate('awards', [list, S.contrarian, rows.map((r) => [r.id, r.name, r.team]), awPlayer, awKind, F('points')]);
    if (!el) return;
    if (!awPlayer || !rows.some((r) => r.id === awPlayer)) awPlayer = rows[0]?.id || null;
    const c = S.contrarian;
    el.innerHTML = `<div class="ch"><h3>Ocenění investorů</h3><span class="s-label">${list.length}</span></div>
      <p class="hint">Ocenění uvidí student v profilu a plátno ho ukáže.${F('points') ? ' Každé ocenění přidá 500 bodů.' : ''}</p>
      ${c ? `<div class="call">Kandidát „Proti proudu“: <b>${esc(c.name)}</b> (${tname(c.team)}) – koupil levně, teď ×${esc(nb(Number(c.multiple).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })))}</div>` : ''}
      <div class="s-field"><label class="lab" for="awplayer">Komu</label><select class="s-input sm" id="awplayer">${rows.map((r) => `<option value="${r.id}" ${r.id === awPlayer ? 'selected' : ''}>${esc(r.name)} · ${tname(r.team)}</option>`).join('')}</select></div>
      <div class="lab">Ocenění</div>
      <div class="chips">${Object.entries(AWK).map(([k, l]) => `<button class="s-chip ${k === awKind ? 's-on' : ''}" data-ak="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="s-field"><label class="lab" for="awnote">Proč (uvidí student)</label><input class="s-input sm" id="awnote" maxlength="140" placeholder="Např. jako jediný věřil týmu Vetly už v bloku 1"></div>
      <button class="s-btn s-primary" id="awgo" ${rows.length ? '' : 'disabled'}>Udělit ocenění</button>
      ${list.length ? `<div class="lab sec">Udělená ocenění</div><div class="list">${list.slice().reverse().map((a) => `<div class="li" data-id="${esc(a.id)}"><div class="lim"><span class="s-badge">${esc(AWK[a.kind] || a.kind)}</span> <b>${esc(a.name)}</b> <span class="s-faint sm">${tname(a.team)} · blok ${esc(a.block)}</span>${a.note ? `<div class="sm s-muted">${esc(a.note)}</div>` : ''}</div><button class="ib del" data-rm title="Odebrat ocenění">✕</button></div>`).join('')}</div>` : ''}`;
    watchDirty(el, 'awards');
    $('awplayer').onchange = (e) => { awPlayer = e.target.value; };
    all(el, '[data-ak]').forEach((b) => (b.onclick = () => { awKind = b.dataset.ak; all(el, '[data-ak]').forEach((x) => x.classList.toggle('s-on', x === b)); }));
    $('awgo').onclick = async () => {
      const note = $('awnote').value.trim();
      if (awKind === 'custom' && !note) return toast('U vlastního ocenění napište, za co je.', true);
      const r = await act('award', { kind: awKind, playerId: $('awplayer').value, note }, 'Ocenění uděleno');
      if (r.ok) { redraw('awards', 'players'); loadData(); }
    };
    all(el, '.li').forEach((row) => (row.querySelector('[data-rm]').onclick = () => {
      const a = list.find((x) => x.id === row.dataset.id);
      if (confirm(`Odebrat ocenění „${AWK[a.kind] || a.kind}“ hráči ${a.name}?`)) act('awardRemove', { id: a.id }, 'Ocenění odebráno').then(() => { redraw('awards'); loadData(); });
    }));
  }

  function renderGhost() {
    const el = gate('ghostbox', [S.teams.map((t) => [t.id, t.name]), (D.ghosts || []).length]);
    if (!el) return;
    el.innerHTML = `<div class="ch"><h3>Ghost účet</h3><span class="s-label">${(D.ghosts || []).length} aktivních</span></div>
      <p class="hint">Pohled studenta zvoleného týmu. Ghost se nikde nepočítá – ani v penězích, ani v žebříčcích, kvízu či exportech.</p>
      <div class="inl"><select class="s-input sm grow" id="ghteam" aria-label="Tým ghosta">${S.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
        <button class="s-btn s-sm" id="ghgo">Otevřít jako student ↗</button></div>`;
    $('ghgo').onclick = () => openGhost($('ghteam').value);
  }

  // ---------- Funkce ----------
  function renderFeatures() {
    const el = gate('features', [S.features || null]);
    if (!el) return;
    const known = featKnown();
    el.innerHTML = `<div class="ch"><h3>Funkce hry</h3><span class="s-label">zapnuto ${known ? FEATS.filter(([k]) => F(k)).length : 0}/${FEATS.length}</span></div>
      <p class="hint">${known ? 'Vypnutá funkce zmizí z plátna i z mobilů. Data se neztratí – po zapnutí je vše zpět.' : 'Server zatím přepínání funkcí nepodporuje.'}</p>
      <div class="feats">${FEATS.map(([k, name, desc]) => `<label class="feat ${F(k) ? 'on' : ''}"><span class="fx"><b>${esc(name)}</b><span>${esc(desc)}</span></span><input type="checkbox" class="sw" data-feature="${k}" ${F(k) ? 'checked' : ''} ${known ? '' : 'disabled'} aria-label="${esc(name)}"></label>`).join('')}</div>`;
    all(el, '[data-feature]').forEach((sw) => (sw.onchange = async () => {
      const k = sw.dataset.feature, on = sw.checked;
      sw.closest('.feat').classList.toggle('on', on);
      const r = await act('features', { set: { [k]: on } }, `${featName(k)}: ${on ? 'zapnuto' : 'vypnuto'}`);
      if (!r.ok) { sw.checked = !on; sw.closest('.feat').classList.toggle('on', !on); }
    }));
  }

  // ---------- Data ----------
  let loadingData = false;
  async function loadData() {
    if (loadingData) return;
    loadingData = true;
    try {
      const j = await get(H(), '?view=data');
      DV = j && Array.isArray(j.allocations) ? j : { unsupported: true };
    } catch { /* keep the old copy */ } finally { loadingData = false; }
    if (S) renderPanel();
  }
  async function loadArchives() {
    try {
      const j = await get(H(), '?view=archives');
      ARCH = j && j.ok && Array.isArray(j.archives) ? j.archives : false;
    } catch { ARCH = ARCH || false; }
    keys.archives = null;
    if (S && tab === 'data') renderArchives();
  }

  let dtab = 'teams', dq = '';
  function tableData() {
    if (!DV || !Array.isArray(DV.allocations)) return null;
    const tn = (id) => (DV.teams || []).find((t) => t.id === id)?.name || team(id).name;
    if (dtab === 'teams') return {
      cols: ['Tým', 'Ocenění $', 'Akcie', 'Zakladatelé %', 'Třída $', 'RJ $', 'One-liner', 'Popis'], num: [1, 2, 3, 4, 5],
      rows: (DV.teams || []).map((t) => [t.name, t.V, Math.round(t.S || 0), t.founderPct, t.cls, t.rj, t.oneLiner || '', t.sub || '']),
    };
    if (dtab === 'players') return {
      cols: ['Hráč', 'Tým', 'Registrace', 'Ghost', 'PIN', 'Portfolio $', 'Výnos %', ...(DV.teams || []).map((t) => t.name + ' $')], num: [5, 6, ...(DV.teams || []).map((_, i) => 7 + i)],
      rows: (DV.players || []).map((p) => [p.name, p.teamName || tn(p.team), when(p.created), p.ghost ? 'ano' : '', p.hasPin ? 'ano' : 'ne', p.portfolio, p.returnPct, ...(DV.teams || []).map((t) => p.holdings?.[t.id] || '')]),
    };
    if (dtab === 'alloc') {
      const rows = [];
      for (const a of DV.allocations) {
        const who = a.playerId === 'rj' ? 'RainbowJet' : a.name;
        for (const [t, e] of Object.entries(a.in || {})) rows.push([a.block, who, a.team ? tn(a.team) : '', 'vloženo', tn(t), e.amt, e.why || '', a.submitted ? 'ano' : 'ne']);
        for (const [t, e] of Object.entries(a.out || {})) rows.push([a.block, who, a.team ? tn(a.team) : '', 'vybráno', tn(t), e.amt, e.why || '', a.submitted ? 'ano' : 'ne']);
        for (const [t, n] of Object.entries(a.notes || {})) {
          const o = typeof n === 'string' ? { like: n } : n || {};
          if (o.like) rows.push([a.block, who, a.team ? tn(a.team) : '', 'zaujalo', tn(t), '', o.like, a.submitted ? 'ano' : 'ne']);
          if (o.doubt) rows.push([a.block, who, a.team ? tn(a.team) : '', 'nevěří', tn(t), '', o.doubt, a.submitted ? 'ano' : 'ne']);
        }
      }
      return { cols: ['Blok', 'Investor', 'Tým investora', 'Typ', 'Startup', 'Částka $', 'Důvod / poznámka', 'Odesláno'], num: [5], rows };
    }
    if (dtab === 'points') {
      const pn = (id) => (DV.players || []).find((p) => p.id === id)?.name || id;
      return { cols: ['Čas', 'Blok', 'Hráč', 'Druh', 'Body', 'Poznámka'], num: [4], rows: (DV.points || []).map((e) => [when(e.ts), e.block, pn(e.playerId), PK[e.kind] || e.kind, e.amt, e.note || '']) };
    }
    return null;
  }
  function renderTables() {
    const el = gate('dtables', [DV ? DV.generated || (DV.unsupported ? 'x' : 1) : 0, dtab, dq]);
    if (!el) return;
    const d = tableData();
    const DT = [['teams', 'Týmy'], ['players', 'Hráči'], ['alloc', 'Alokace'], ['points', 'Body']];
    const rows = d ? d.rows.filter((r) => !dq || norm(r.join(' ')).includes(norm(dq))) : [];
    const tw = el.querySelector('.tblwrap'), scroll = tw ? [tw.scrollTop, tw.scrollLeft] : null;
    const cell = (v, i) => (d.num.includes(i) && typeof v === 'number' ? (d.cols[i].endsWith('%') ? esc(pct(v)) : esc(plain(v))) : esc(v));
    el.innerHTML = `<div class="ch"><h3>Data hry</h3><span class="s-label">${DV?.generated ? 'stav ' + esc(when(DV.generated)) : ''}</span></div>
      ${!DV ? '<p class="hint">Načítám…</p>' : !d ? '<p class="hint">Server zatím datový přehled nepodporuje. Investice stáhnete jako CSV níže.</p>' : `
      <div class="inl"><div class="seg">${DT.map(([k, l]) => `<button data-dt="${k}" class="${dtab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <input class="s-input sm grow" id="dsearch" placeholder="Hledat…" value="${esc(dq)}" aria-label="Hledat v tabulce">
        <button class="s-btn s-sm s-ghost" id="dcsv">CSV</button><button class="s-btn s-sm s-ghost" id="djson">JSON (vše)</button><button class="s-btn s-sm s-ghost" id="dreload">Obnovit</button></div>
      <div class="s-faint sm">${rows.length} ${pl(rows.length, 'řádek', 'řádky', 'řádků')}${rows.length > 400 ? ' · zobrazeno prvních 400, CSV obsahuje vše' : ''}</div>
      <div class="tblwrap"><table class="tbl"><thead><tr>${d.cols.map((c, i) => `<th class="${d.num.includes(i) ? 'r' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 400).map((r) => `<tr>${r.map((v, i) => `<td class="${d.num.includes(i) ? 'r' : ''}">${cell(v, i)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${d.cols.length}" class="s-faint">Nic nenalezeno.</td></tr>`}</tbody></table></div>`}`;
    const tw2 = el.querySelector('.tblwrap');
    if (tw2 && scroll && !el.dataset.reset) { tw2.scrollTop = scroll[0]; tw2.scrollLeft = scroll[1]; }
    delete el.dataset.reset;
    all(el, '[data-dt]').forEach((b) => (b.onclick = () => { dtab = b.dataset.dt; el.dataset.reset = '1'; renderTables(); }));
    const s = $('dsearch');
    if (s) s.oninput = () => { dq = s.value; keys.dtables = null; const pos = s.selectionStart; s.blur(); renderTables(); const n = $('dsearch'); n.focus(); n.setSelectionRange(pos, pos); };
    if ($('dcsv')) $('dcsv').onclick = () => download(`investicni-stul-${dtab}-${stamp()}.csv`, csvText([d.cols, ...rows]), 'text/csv;charset=utf-8');
    if ($('djson')) $('djson').onclick = () => download(`investicni-stul-data-${stamp()}.json`, JSON.stringify(DV, null, 1));
    if ($('dreload')) $('dreload').onclick = () => loadData();
  }

  function renderArchives() {
    const el = gate('archives', [ARCH]);
    if (!el) return;
    if (ARCH === false) {
      el.innerHTML = '<div class="ch"><h3>Archivy</h3></div><p class="hint">Server zatím archivy nepodporuje. Zálohu hry máte v tomto notebooku (níže).</p>';
      return;
    }
    const list = ARCH || [];
    const pre = list.filter((a) => a.label === 'Stav před v2');
    const rest = list.filter((a) => a.label !== 'Stav před v2');
    const row = (a) => `<div class="li" data-id="${esc(a.id)}"><div class="lim"><b>${esc(a.label)}</b> ${a.auto ? '<span class="s-badge">automaticky</span>' : ''}<div class="sm s-faint">${esc(when(a.ts))} · blok ${esc(a.block)} · ${esc(nb(Math.round(a.sizeKB || 0).toLocaleString('cs-CZ')))} kB</div></div>
      <span class="btns"><button class="s-btn s-sm s-ghost" data-dl>Stáhnout</button><button class="ib del" data-rm title="Smazat archiv">✕</button></span></div>`;
    el.innerHTML = `<div class="ch"><h3>Archivy</h3><span class="s-label">${list.length}</span></div>
      ${pre.length ? `<div class="pinned"><div><div class="s-label">Blok 1 před nasazením v2</div><b>Stav před v2</b><div class="sm s-muted">Poznámky studentů z bloku 1 a celá tabule otázek, jak byly před nasazením v2.</div></div>
        <div class="btns">${pre.map((a, i) => `<button class="s-btn s-sm s-primary" data-pdl="${esc(a.id)}">Stáhnout${pre.length > 1 ? ` (${i + 1})` : ''}</button>`).join('')}</div></div>` : ''}
      <p class="hint">Archiv je úplná kopie hry (hráči, investice všech bloků, poznámky, texty, tabule otázek). Automaticky vzniká před dalším blokem, novou hrou a exitem.</p>
      <div class="inl"><input class="s-input sm grow" id="arlabel" maxlength="60" placeholder="Název archivu, např. Konec bloku 2"><button class="s-btn s-sm" id="argo">Vytvořit archiv</button></div>
      <div class="list">${ARCH === null ? '<p class="hint">Načítám…</p>' : rest.map(row).join('') || (pre.length ? '' : '<p class="hint">Zatím žádné archivy.</p>')}</div>
      ${pre.length ? `<details class="sm"><summary class="s-faint">Smazat „Stav před v2“</summary><div class="list">${pre.map(row).join('')}</div></details>` : ''}`;
    const dl = async (id) => {
      const j = await get(H(), '?view=archive&id=' + encodeURIComponent(id));
      if (!j.ok || !j.archive) return toast(j.error || 'Archiv se nepodařilo stáhnout.', true);
      download(`archiv-${(j.archive.label || id).replace(/[^\wÀ-ſ-]+/g, '-')}-${new Date(j.archive.ts || Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, JSON.stringify(j.archive, null, 1));
    };
    all(el, '[data-pdl]').forEach((b) => (b.onclick = () => dl(b.dataset.pdl)));
    all(el, '.li').forEach((r) => {
      const a = list.find((x) => x.id === r.dataset.id);
      r.querySelector('[data-dl]').onclick = () => dl(a.id);
      r.querySelector('[data-rm]').onclick = async () => {
        if (!confirm(`Smazat archiv „${a.label}“ (${when(a.ts)})? Tohle nejde vrátit.`)) return;
        const x = await act('archiveDelete', { id: a.id }, 'Archiv smazán');
        if (x.ok) loadArchives();
      };
    });
    $('argo').onclick = async () => {
      const label = $('arlabel').value.trim() || `Ruční archiv ${when(Date.now())}`;
      const x = await act('archive', { label }, 'Archiv vytvořen');
      if (x.ok) { $('arlabel').value = ''; loadArchives(); }
    };
  }

  function renderExports() {
    const b = loadBk();
    const el = gate('tools', [S.block, b?.meta?.rev, b?.meta?.gid, Object.keys(b?.players || {}).length, S.features?.recap]);
    if (!el) return;
    el.innerHTML = `<div class="ch"><h3>${E('dealer.sec.tools')}</h3></div>
      <div class="dlist">
        <button class="s-btn s-sm s-ghost" id="csv">Stáhnout všechny investice (CSV)</button>
        <button class="s-btn s-sm s-ghost" id="logdl">Stáhnout log všech akcí (JSON)</button>
        <button class="s-btn s-sm s-ghost" id="bkdl">Stáhnout zálohu z tohoto notebooku</button>
        ${S.features?.recap !== false ? '<a class="s-btn s-sm s-ghost" href="/report" target="_blank" rel="noopener">Třídní report (tisk / CSV)</a>' : ''}
      </div>
      <p class="hint">Záloha v tomto prohlížeči: ${b ? `revize ${esc(b.meta?.rev ?? '?')}, ${Object.keys(b.players || {}).length} hráčů, ${Object.keys(b.slips || {}).length} ${pl(Object.keys(b.slips || {}).length, 'blok', 'bloky', 'bloků')} investic` : 'zatím žádná'}. Když server hru zapomene, tato stránka ji sama vrátí.</p>`;
    $('csv').onclick = exportCSV;
    $('logdl').onclick = async () => {
      const j = await get(H(), '?view=log&limit=20000');
      download(`investicni-stul-log-${stamp()}.json`, JSON.stringify(j.log || [], null, 1));
    };
    $('bkdl').onclick = () => { const x = loadBk(); if (!x) return toast('Záloha zatím není.', true); download(`investicni-stul-zaloha-${stamp()}.json`, JSON.stringify(x)); };
  }

  async function exportCSV() {
    const j = await get(H(), '?view=dealer&all=1');
    const allS = j.dealer.all, players = j.dealer.players;
    const tn = (id) => j.teams.find((t) => t.id === id)?.name || id;
    const rows = [['Blok', 'Investor', 'Tým investora', 'Typ', 'Startup', 'Částka ($)', 'Důvod / poznámka']];
    for (const [blk, slips] of Object.entries(allS)) {
      for (const [sid, s] of Object.entries(slips)) {
        const p = sid === 'rj' ? { name: 'RainbowJet (smart money)', team: '' } : players[sid];
        if (!p) continue;
        for (const [t, e] of Object.entries(s.in || {})) rows.push([blk, p.name, tn(p.team), 'vloženo', tn(t), e.amt, e.why]);
        for (const [t, e] of Object.entries(s.out || {})) rows.push([blk, p.name, tn(p.team), 'vybráno', tn(t), e.amt, e.why]);
        for (const [t, n] of Object.entries(s.notes || {})) {
          const o = typeof n === 'string' ? { like: n } : n;
          if (o.like) rows.push([blk, p.name, tn(p.team), 'zaujalo', tn(t), '', o.like]);
          if (o.doubt) rows.push([blk, p.name, tn(p.team), 'nevěří', tn(t), '', o.doubt]);
        }
      }
    }
    download(`investicni-stul-blok-${S.block}.csv`, csvText(rows), 'text/csv;charset=utf-8');
  }

  function renderDanger() {
    const el = gate('danger', [(D.board || []).length]);
    if (!el) return;
    el.innerHTML = `<div class="ch"><h3>Opravy a nová hra</h3></div>
      <div class="dlist">
        <button class="s-btn s-sm s-ghost" id="undo">Vrátit poslední krok</button>
        <button class="s-btn s-sm s-ghost" id="clearboard">Vyčistit tabuli otázek${(D.board || []).length ? ` (${D.board.length})` : ''}</button>
        <button class="s-btn s-sm s-danger" id="reset">Nová hra (smaže investice, hráči zůstanou)</button>
        <button class="s-btn s-sm s-danger" id="wipe">Smazat vše včetně hráčů</button>
      </div>
      <p class="hint">„Vrátit poslední krok“ zruší poslední showdown, odhalení, přecenění, kartu, exit nebo přechod na další blok. Před vyčištěním tabule a novou hrou se uloží archiv.</p>`;
    $('undo').onclick = () => confirm('Vrátit poslední krok?') && act('undo', {}, 'Vráceno');
    $('clearboard').onclick = async () => {
      if (!confirm('Vyčistit tabuli otázek? Nejdřív se uloží archiv „Otázky z tabule“, pak se otázky, hlasy i reakce smažou.')) return;
      const r = await act('clearBoard', {}, 'Tabule vyčištěna, archiv uložen');
      if (r.ok) loadArchives();
    };
    $('reset').onclick = () => prompt('Napište RESET pro novou hru (hráči zůstanou):') === 'RESET' && act('reset', { confirm: 'RESET', keepPlayers: true }, 'Nová hra');
    $('wipe').onclick = () => prompt('Napište RESET pro smazání všeho:') === 'RESET' && act('reset', { confirm: 'RESET', keepPlayers: false }, 'Smazáno');
  }

  // ---------- Nástěnky ----------
  let wallW = null, wallTeam = store.get('mup.wallTeam') || 'all', wallSig = '';
  const wallOff = () => !!(S && S.features && S.features.wall === false); // missing key = server without v3 yet: still try
  const wallRevs = () => (D && (D.wallRev || D.meta?.wallRev)) || (S && S.meta?.wallRev) || (S && S.wallRev && typeof S.wallRev === 'object' ? S.wallRev : null)
    || (S && S.teams && S.teams.some((t) => t.wallRev != null) ? Object.fromEntries(S.teams.map((t) => [t.id, t.wallRev || 0])) : null);
  const wallSeen = (() => { try { return JSON.parse(store.get('mup.wallSeen') || '{}') || {}; } catch { return {}; } })();
  const saveSeen = () => store.set('mup.wallSeen', JSON.stringify(wallSeen));
  const wallUnread = (id) => { const r = wallRevs(); if (!r) return 0; return Math.max(0, (Number(r[id]) || 0) - (Number(wallSeen[id]) || 0)); };
  const wallUnreadTotal = () => (S && wallRevs() ? S.teams.reduce((a, t) => a + wallUnread(t.id), 0) : 0);
  function markSeen(ids) {
    const r = wallRevs();
    if (!r) return;
    for (const id of ids) if (r[id] != null) wallSeen[id] = Number(r[id]) || 0;
    saveSeen();
    renderWallChips();
    if (S) renderTop();
  }
  let seenNext = new Set(); // teams the dealer just wrote to: their own write is not "unread"
  const pickTeam = (b) => (b && b.team) || (wallTeam !== 'all' ? wallTeam : undefined);
  async function wcall(op, body) {
    const r = await post({ op, ...body }, H());
    if (!r.ok) { const e = new Error(r.error || 'Něco se nepovedlo.'); e.res = r; throw e; }
    if (body.all) S.teams.forEach((t) => seenNext.add(t.id)); else if (body.team) seenNext.add(body.team);
    return r;
  }
  const wallApi = {
    async list(teamId) {
      const tid = teamId || wallTeam;
      const j = await get(H(), '?view=wall&team=' + encodeURIComponent(tid));
      if (!j || j.ok === false) throw new Error((j && j.error) || 'Nástěnku se nepodařilo načíst.');
      markSeen(tid === 'all' ? S.teams.map((t) => t.id) : [tid]);
      if (tid === 'all') return j.walls ? j : { walls: {} }; // v4: + templates, groups, members
      return j.stickers ? j : [];
    },
    post: (b = {}) => wcall('wallPost', b.all ? { all: true, kind: b.kind, text: b.text } : { team: pickTeam(b), kind: b.kind, text: b.text }),
    reply: (b = {}) => wcall('wallReply', { team: pickTeam(b), id: b.id, text: b.text }),
    done: (b = {}) => wcall('wallDone', { team: pickTeam(b), id: b.id, done: !!b.done }),
    del: (b = {}) => wcall('wallDelete', { team: pickTeam(b), id: b.id, ...(b.reply ? { reply: b.reply } : {}) }),
    op: (b = {}) => wcall(b.op, b.all ? b : { ...b, team: pickTeam(b) }), // v4 wallplus
  };
  function unmountWall() {
    if (!wallW) return;
    try { wallW.destroy(); } catch (e) { console.warn(e); }
    wallW = null;
  }
  function renderWallChips() {
    const box = $('wchips');
    if (!box || !S) return;
    const chips = [{ id: 'all', name: 'Všechny týmy', color: '' }, ...S.teams];
    const sig = JSON.stringify([wallTeam, chips.map((t) => [t.id, t.name, t.color, t.id === 'all' ? wallUnreadTotal() : wallUnread(t.id)]), wallTeam !== 'all' ? firstMember(wallTeam)?.id || '' : '']);
    if (sig === wallSig) return;
    wallSig = sig;
    box.innerHTML = chips.map((t) => {
      const n = t.id === 'all' ? 0 : wallUnread(t.id);
      return `<button class="wchip${t.id === wallTeam ? ' on' : ''}" data-wteam="${esc(t.id)}" role="tab" aria-selected="${t.id === wallTeam}"${t.color ? ` style="--tc:${esc(t.color)}"` : ''}>${t.color ? dot(t.color) : '<span class="wall-ic" aria-hidden="true">▦</span>'}<span>${esc(t.name)}</span>${n ? `<span class="wn" title="Nové od posledního otevření">${n}</span>` : ''}</button>`;
    }).join('');
    const pv = $('wpv');
    if (pv) {
      pv.hidden = wallTeam === 'all';
      pv.innerHTML = wallTeam === 'all' ? '' : teamPreviewBtn(wallTeam);
      wireTeamPreview(pv);
    }
    all(box, '[data-wteam]').forEach((b) => (b.onclick = () => {
      wallTeam = b.dataset.wteam;
      store.set('mup.wallTeam', wallTeam);
      wallSig = '';
      renderWallChips();
      if (wallW) { try { wallW.setTeam(wallTeam); } catch (e) { console.warn(e); } }
    }));
  }
  function renderWalls() {
    if (seenNext.size) { const ids = [...seenNext]; seenNext = new Set(); markSeen(ids); }
    if (wallTeam !== 'all' && !S.teams.some((t) => t.id === wallTeam)) wallTeam = 'all';
    const off = wallOff();
    const note = $('wnote');
    note.hidden = !off;
    if (off) {
      if (!note.dataset.on) { note.innerHTML = '<div class="off"><div><b>Nástěnky týmů jsou vypnuté.</b> Týmy je teď nevidí. Zapnout je můžete tady nebo v\u00a0záložce Funkce.</div><button class="s-btn s-sm" data-enable="wall">Zapnout</button></div>'; note.dataset.on = '1'; }
    } else note.dataset.on = '';
    $('wallbox').hidden = off;
    if (off) { unmountWall(); return; }
    const r = wallRevs();
    $('wallsum').textContent = r ? (wallUnreadTotal() ? `nové: ${wallUnreadTotal()}` : 'vše přečteno') : '';
    renderWallChips();
    const mount = $('wmount');
    if (wallW && wallW.plus !== F('wallplus')) unmountWall(); // v4: remount when wallplus flips
    if (wallW || !mount) return;
    if (!window.MupWall || typeof window.MupWall.mount !== 'function') {
      if (!mount.dataset.miss) { mount.innerHTML = '<div class="wmiss">Nástěnky se nenačetly (chybí <code>/wall.js</code>). Obnovte stránku za chvíli.</div>'; mount.dataset.miss = '1'; }
      return;
    }
    mount.innerHTML = ''; mount.dataset.miss = '';
    try {
      wallW = window.MupWall.mount(mount, {
        role: 'dealer', teams: S.teams.map((t) => ({ id: t.id, name: t.name, color: t.color })), team: wallTeam,
        api: wallApi, canSendAll: true, pollMs: 4000, plus: F('wallplus'), seenKey: 'mup.wseen.dealer',
      });
      wallW.plus = F('wallplus');
    } catch (e) { console.error('MupWall.mount', e); wallW = null; }
  }

  // ---------- panels ----------
  const PANELS = {
    hra: [renderFlow, renderClock, renderReg],
    investice: [renderLive, renderBets, renderQBoard],
    rj: [renderFund, renderRJ, renderTranches],
    oceneni: [renderVals, renderDrivers, renderMarket, renderExit, renderOcNote],
    walls: [renderWalls],
    startupy: [renderStLive, renderCards, renderTeams, renderRounds, renderMdefs, renderStNote],
    kviz: [renderQuizLive, renderQuizSets],
    body: [renderPointsAdd, renderPointsTop, renderLedger],
    hraci: [renderPlayers, renderAwards, renderGhost],
    funkce: [renderFeatures],
    data: [renderArchives, renderTables, renderExports, renderDanger],
    texty: [],
    regie: [() => window.MUPRegie && window.MUPRegie.render()], // v4 regie (public/dealer-regie.js)
  };
  function renderPanel() {
    for (const fn of PANELS[tab] || []) {
      try { fn(); } catch (e) { console.error(fn.name, e); }
    }
    all(document.querySelector(`[data-panel="${tab}"]`), '.cols').forEach((c) => {
      const vis = (x) => !x.hidden && (!x.classList.contains('stack') || [...x.children].some((y) => !y.hidden));
      [...c.children].forEach((x) => { if (x.classList.contains('stack')) x.hidden = !vis(Object.assign(x, { hidden: false })); });
      c.classList.toggle('one', [...c.children].filter(vis).length < 2);
    });
  }

  let dumpN = 0, lastOk = Date.now();
  async function tick() {
    const j = await get(H(), '?view=dealer' + (dumpN++ % 3 === 0 ? '&dump=1' : ''));
    // public state without the dealer part = wrong password; a server error just skips this tick
    if (!j.dealer) { if (Array.isArray(j.teams)) { store.del('mup.dealer'); location.reload(); } return; }
    lastOk = Date.now();
    if (j.dealer.dump) mergeBk(j.dealer.dump);
    await guard(j);
    S = j; D = j.dealer;
    if (S.phase === 'pitch' && S.presenting) markPitched(S.presenting);
    renderTop();
    renderPanel();
    if (window.MUPRegie) window.MUPRegie.tick(); // v4 regie
    if (['hraci', 'body', 'data'].includes(tab) && dumpN % 3 === 1) loadData();
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    $('dlogin').classList.add('hidden');
    $('dgame').classList.remove('hidden');
    setTab(tab);
    const loop = async () => {
      try { await tick(); } catch (e) { console.warn(e); }
      const fast = S?.quiz?.state === 'question';
      setTimeout(loop, (document.hidden ? 3 : 1) * (fast ? 1000 : 2000));
    };
    loop();
    setInterval(tickClock, 250);
  }

  window.MUPD = { get S() { return S; }, get D() { return D; }, get tab() { return tab; }, H, F, act, toast, setTab, team, nextStep, nextPitchTeam, startPitch, openBetting, closeBetting, doShowdown, doRjReveal, doNext, doFinal, quiz, pitchedList }; // v4 regie
  tryLogin(pw || '').then((ok) => { if (!ok) $('dlogin').classList.remove('hidden'); });
})();
