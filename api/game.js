// One endpoint for the whole game. GET = state, POST = action.
import crypto from 'node:crypto';
import * as S from './_lib/store.js';
import * as G from './_lib/game.js';

// Dealer is open (no password) unless DEALER_LOCK=1 and DEALER_PASSWORD are set in Vercel.
const DEALER_PW = process.env.DEALER_LOCK === '1' ? process.env.DEALER_PASSWORD || 'mup-dealer' : '';
const DEALER_DEFAULT = !DEALER_PW;
const dealerOk = (req) => !DEALER_PW || req.headers['x-dealer'] === DEALER_PW;

let cache = { t: 0, data: null };

async function load(fresh) {
  if (!fresh && cache.data && Date.now() - cache.t < 700) return cache.data;
  let meta = await S.getJSON('meta');
  if (!meta) { meta = G.newMeta(); meta.auto = true; await S.setJSON('meta', meta); }
  else if (!meta.gid) { meta.gid = crypto.randomBytes(5).toString('hex'); meta.rev = meta.rev || 1; meta.removed = meta.removed || []; await S.setJSON('meta', meta); }
  const [players, slips, content, qs, qv, qr] = await Promise.all([
    S.hgetall('players'), S.hgetall('slip:' + meta.block), S.getJSON('content'), S.hgetall('qs'), S.hgetall('qv'), S.hgetall('qr'),
  ]);
  const data = { meta, players, slips, content: content || { v: '0', texts: {}, founders: null }, qs, qv, qr };
  cache = { t: Date.now(), data };
  return data;
}
const invalidate = () => { cache = { t: 0, data: null }; };

const pinHash = (sid, pin) => crypto.createHash('sha256').update(`${sid}:${pin}:mup-poker`).digest('hex');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const r0 = (n) => Math.round(n);

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
    return req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

// ---------- question board ----------
// qs: question id -> { id, block, team, cat, text, by, ts, ghost?, hidden?, answer? { text, ts, by } }
// qv: "qid|sid" -> 1 (upvote) · qr: "qid|sid" -> 'yes' | 'no' (reaction to the team's answer)
const QCATS = { problem: 'Problém', market: 'Trh a čísla', competition: 'Konkurence', distribution: 'Distribuce' };
const Q_MAX = 3, V_MAX = 5;

function boardItems(bd, players, { dealer = false } = {}) {
  const { qs = {}, qv = {}, qr = {} } = bd || {};
  const votes = {}, yes = {}, no = {};
  for (const k of Object.keys(qv)) { const [q, s] = k.split('|'); if (!players[s]?.ghost) votes[q] = (votes[q] || 0) + 1; }
  for (const [k, v] of Object.entries(qr)) { const [q, s] = k.split('|'); if (players[s]?.ghost) continue; if (v === 'yes') yes[q] = (yes[q] || 0) + 1; else if (v === 'no') no[q] = (no[q] || 0) + 1; }
  return Object.values(qs)
    .filter((q) => q && (dealer || (!q.hidden && !q.ghost)))
    .map((q) => ({
      id: q.id, block: q.block, team: q.team, cat: q.cat, text: q.text, ts: q.ts, votes: votes[q.id] || 0,
      answer: q.answer ? { text: q.answer.text, ts: q.answer.ts } : null, yes: yes[q.id] || 0, no: no[q.id] || 0,
      ...(dealer ? { by: players[q.by]?.name || '?', hidden: !!q.hidden, ghost: !!q.ghost } : {}),
    }))
    .sort((a, b) => b.block - a.block || b.votes - a.votes || a.ts - b.ts);
}

function myBoard(meta, p, bd) {
  const { qs = {}, qv = {}, qr = {} } = bd || {};
  const mine = Object.values(qs).filter((q) => q?.by === p.id);
  const voted = Object.keys(qv).filter((k) => k.endsWith('|' + p.id)).map((k) => k.split('|')[0]);
  const reacts = {};
  for (const [k, v] of Object.entries(qr)) if (k.endsWith('|' + p.id)) reacts[k.split('|')[0]] = v;
  return {
    asked: mine.filter((q) => q.block === meta.block && !q.hidden).length, qmax: Q_MAX,
    votesUsed: voted.filter((id) => qs[id]?.block === meta.block).length, vmax: V_MAX,
    mine: mine.map((q) => q.id), voted, reacts,
    // a ghost sees its own (otherwise invisible) questions
    extra: p.ghost ? boardItems({ qs: Object.fromEntries(mine.map((q) => [q.id, { ...q, ghost: false }])), qv, qr }, {}) : [],
  };
}

// ---------- views ----------
function publicState(meta, players, slips, bd) {
  const r = G.raised(meta);
  // money students have sent in this round, shown live on the table before the showdown (RJ stays hidden)
  const live = {};
  if (['betting', 'closed'].includes(meta.phase) && !meta.settled[meta.block + 'c']) {
    for (const [k, sl] of Object.entries(slips)) {
      if (k === G.RJ || !players[k] || players[k].ghost || !sl?.submitted) continue;
      for (const [t, e] of Object.entries(sl.in || {})) live[t] = (live[t] || 0) + (e.amt || 0);
      for (const [t, e] of Object.entries(sl.out || {})) live[t] = (live[t] || 0) - (e.amt || 0);
    }
  }
  const teams = meta.teams.map((t) => ({ ...t, V: r0(G.valuation(meta, t.id)), cls: r0(r[t.id].cls), rj: r0(r[t.id].rj), live: r0(live[t.id] || 0) }));
  const plist = Object.values(players).filter((p) => !p.ghost).map((p) => ({ id: p.id, name: p.name, team: p.team }));
  const betCount = Object.entries(slips).filter(([k, s]) => k !== G.RJ && players[k] && !players[k].ghost && s?.submitted).length;
  const leaders = plist
    .filter((p) => G.hasHoldings(meta, p.id))
    .map((p) => ({ name: p.name, team: p.team, value: r0(G.portfolio(meta, p.id)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  return {
    now: Date.now(), teams, block: meta.block, maxBlock: G.CFG.MAX_BLOCK, phase: meta.phase,
    presenting: meta.presenting, timerEnd: meta.timerEnd, timerTotal: meta.timerTotal, timerLabel: meta.timerLabel,
    screen: meta.screen, regOpen: meta.regOpen, history: meta.history, reveal: meta.reveal,
    betCount, playerCount: plist.length, players: plist, leaders, storage: S.storageMode, cfg: G.CFG,
    startV: meta.startV || Math.round(meta.ledger.P[meta.teams[0].id] * G.CFG.FOUNDER_SHARES), anyHoldings: Object.keys(meta.ledger.H).some((k) => G.hasHoldings(meta, k)),
    pins: meta.pins || [], gid: meta.gid, rev: meta.rev || 0, auto: !!meta.auto,
    board: boardItems(bd, players), qcats: QCATS,
    qpin: meta.qpin ? boardItems(bd, players).find((q) => q.id === meta.qpin) || null : null,
  };
}

// Every student's portfolio value at each showdown and revaluation (for the stonks chart).
function recordPf(meta) {
  const v = {};
  for (const inv of Object.keys(meta.ledger.H)) {
    if (inv !== G.RJ && G.hasHoldings(meta, inv)) v[inv] = r0(G.portfolio(meta, inv));
  }
  meta.pfHist = meta.pfHist || [];
  meta.pfHist.push({ ts: Date.now(), v });
  if (meta.pfHist.length > 250) meta.pfHist.splice(0, meta.pfHist.length - 250);
}

function meState(meta, p, slips, bd) {
  const st = G.stakes(meta, p.id);
  const stakes = {};
  for (const [t, v] of Object.entries(st)) stakes[t] = r0(v);
  const series = (meta.pfHist || []).filter((h) => h.v[p.id] !== undefined).map((h) => [h.ts, h.v[p.id]]);
  return {
    id: p.id, name: p.name, team: p.team, stakes, portfolio: r0(G.portfolio(meta, p.id)), invested: G.hasHoldings(meta, p.id),
    start: G.CFG.STUDENT_CAPITAL, series, rules: G.rules(meta, p.id), slip: slips[p.id] || null,
    msgs: ((meta.fb || {})[p.team] || []).slice().reverse(),
    board: myBoard(meta, p, bd), ghost: !!p.ghost,
  };
}

function callList(meta, players, slips) {
  const tname = (t) => meta.teams.find((x) => x.id === t)?.name || t;
  const bets = [], outs = [], backers = {}, conc = [];
  for (const [sid, s] of Object.entries(slips)) {
    const p = players[sid];
    if (!p || p.ghost || !s?.submitted) continue;
    let total = 0, max = 0, maxT = null;
    for (const [t, e] of Object.entries(s.in || {})) {
      bets.push({ name: p.name, team: tname(p.team), target: tname(t), amt: e.amt, why: e.why });
      (backers[t] = backers[t] || []).push({ name: p.name, amt: e.amt, why: e.why });
      total += e.amt;
      if (e.amt > max) { max = e.amt; maxT = t; }
    }
    for (const [t, e] of Object.entries(s.out || {})) outs.push({ name: p.name, team: tname(p.team), target: tname(t), amt: e.amt, why: e.why });
    if (total > 0) conc.push({ name: p.name, target: tname(maxT), share: max / total, amt: max });
  }
  const lone = [], none = [];
  for (const t of meta.teams) {
    const b = backers[t.id] || [];
    if (b.length === 1) lone.push({ target: t.name, ...b[0] });
    if (b.length === 0) none.push(t.name);
  }
  return {
    big: bets.sort((a, b) => b.amt - a.amt).slice(0, 3),
    outs: outs.sort((a, b) => b.amt - a.amt).slice(0, 3),
    lone, none: bets.length ? none : [],
    conc: conc.sort((a, b) => b.share - a.share).slice(0, 2),
  };
}

function dealerState(meta, players, slips, bd) {
  const rows = Object.values(players).filter((p) => !p.ghost).map((p) => ({
    id: p.id, name: p.name, team: p.team, hasPin: !!p.pin,
    portfolio: r0(G.portfolio(meta, p.id)), holdings: G.hasHoldings(meta, p.id), slip: slips[p.id] || null,
  }));
  const st = G.stakes(meta, G.RJ);
  const stakes = {};
  for (const [t, v] of Object.entries(st)) stakes[t] = r0(v);
  return {
    rows, dealerDefault: DEALER_DEFAULT, settled: meta.settled,
    ghosts: Object.values(players).filter((p) => p.ghost).map((p) => ({ id: p.id, name: p.name, team: p.team })),
    board: boardItems(bd, players, { dealer: true }), qpinId: meta.qpin || null,
    rj: { stakes, portfolio: r0(G.portfolio(meta, G.RJ)), rules: G.rules(meta, G.RJ), slip: slips[G.RJ] || null },
    calls: callList(meta, players, slips),
  };
}

// ---------- actions ----------
// Private feedback from RainbowJet, visible only to members of that team.
function addMsg(meta, team, msg) {
  meta.fb = meta.fb || {};
  (meta.fb[team] = meta.fb[team] || []).push({ ts: Date.now(), block: meta.block, ...msg });
}

async function backup(meta) {
  const b = (await S.getJSON('backups')) || [];
  b.push(meta);
  while (b.length > 15) b.shift();
  await S.setJSON('backups', b);
}

// Full copy of the game for the dealer's laptop. Without a database the server can forget everything
// (new instance, redeploy); the dealer page keeps this copy and pushes it back with op 'restore'.
async function makeDump() {
  const { meta, players, content } = await load(true);
  const slips = {};
  for (let i = 1; i <= G.CFG.MAX_BLOCK; i++) {
    const h = await S.hgetall('slip:' + i);
    if (Object.keys(h).length) slips[i] = h;
  }
  const board = { qs: await S.hgetall('qs'), qv: await S.hgetall('qv'), qr: await S.hgetall('qr') };
  return { meta, players, slips, content, board };
}

function cleanEntries(x, meta) {
  const out = {};
  if (!x || typeof x !== 'object') return out;
  for (const t of meta.teams) {
    const e = x[t.id];
    const amt = Math.round(Number(e?.amt) || 0);
    if (amt > 0) out[t.id] = { amt, why: String(e.why || '').trim().slice(0, 600) };
  }
  return out;
}

// Notes per startup: { like: 'Co mě zaujalo', doubt: 'Čemu nevěřím' }
function cleanNotes(notes, meta) {
  const out = {};
  if (notes && typeof notes === 'object') {
    for (const t of meta.teams) {
      const n = notes[t.id];
      if (!n) continue;
      const like = String(typeof n === 'string' ? n : n.like || '').trim().slice(0, 1000);
      const doubt = String(typeof n === 'string' ? '' : n.doubt || '').trim().slice(0, 1000);
      if (like || doubt) out[t.id] = { like, doubt };
    }
  }
  return out;
}

function setTimer(meta, minutes, label) {
  const m = Number(minutes);
  if (m > 0) {
    meta.timerTotal = Math.round(m * 60000);
    meta.timerEnd = Date.now() + meta.timerTotal;
    meta.timerLabel = String(label || '').slice(0, 40);
  } else { meta.timerEnd = null; meta.timerTotal = 0; meta.timerLabel = ''; }
}

const fail = (msg, extra) => ({ status: 400, body: { ok: false, error: msg, ...extra } });
const ok = (extra) => ({ status: 200, body: { ok: true, ...extra } });

async function studentAction(b) {
  const { meta, players, slips } = await load(true);
  if (b.op === 'register') {
    if (!meta.regOpen) return fail('Registrace je zavřená. Požádej dealera.');
    const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (name.length < 2) return fail('Napiš své jméno.');
    if (!meta.teams.some((t) => t.id === b.team)) return fail('Vyber svůj tým.');
    if (!/^\d{4}$/.test(String(b.pin || ''))) return fail('PIN musí mít 4 číslice.');
    if (Object.values(players).some((p) => norm(p.name) === norm(name))) return fail('Tohle jméno už ve hře je. Přihlas se, nebo požádej dealera o reset PINu.');
    const id = crypto.randomBytes(6).toString('base64url');
    await S.hset('players', id, { id, name, team: b.team, pin: pinHash(id, b.pin), created: Date.now() });
    invalidate();
    return ok({ sid: id });
  }
  if (b.op === 'restore') {
    const sid = String(b.sid || '');
    if (!/^[\w-]{4,24}$/.test(sid) || !/^\d{4}$/.test(String(b.pin || ''))) return fail('Přihlas se znovu.', { relogin: true });
    const sameGame = b.gid === meta.gid || meta.auto;
    if ((meta.removed || []).includes(sid)) return fail('Přihlas se znovu.', { relogin: true });
    let p = players[sid];
    if (p) {
      if (p.pin && p.pin !== pinHash(sid, b.pin)) return fail('Špatný PIN.', { relogin: true });
      if (!p.pin) { p.pin = pinHash(sid, b.pin); await S.hset('players', sid, p); }
    } else {
      const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (name.length < 2 || !meta.teams.some((t) => t.id === b.team)) return fail('Přihlas se znovu.', { relogin: true });
      p = { id: sid, name, team: b.team, pin: pinHash(sid, b.pin), created: Date.now() };
      if (sid.startsWith('g_')) p.ghost = true;
      await S.hset('players', sid, p);
    }
    if (sameGame) {
      for (const [k, sl] of Object.entries(b.slips || {})) {
        const blk = Number(k);
        if (!(blk >= 1 && blk <= G.CFG.MAX_BLOCK) || !sl || typeof sl !== 'object') continue;
        const cur = blk === meta.block ? slips[sid] : (await S.hgetall('slip:' + blk))[sid];
        const ts = Number(sl.ts) || 0;
        if (cur && (Number(cur.ts) || 0) >= ts) continue;
        await S.hset('slip:' + blk, sid, {
          out: cleanEntries(sl.out, meta), in: cleanEntries(sl.in, meta), notes: cleanNotes(sl.notes, meta), submitted: !!sl.submitted, ts: ts || Date.now(),
        });
      }
    }
    invalidate();
    return ok({ sid });
  }
  const p = players[b.sid];
  if (!p) return fail('Hráč nenalezen. Přihlas se znovu.', { relogin: true });
  if (!/^\d{4}$/.test(String(b.pin || ''))) return fail('PIN musí mít 4 číslice.');
  if (!p.pin) { p.pin = pinHash(p.id, b.pin); await S.hset('players', p.id, p); invalidate(); }
  else if (p.pin !== pinHash(p.id, b.pin)) return fail('Špatný PIN.', { relogin: true });

  if (b.op === 'login') return ok({ sid: p.id });

  if (['ask', 'vote', 'answer', 'react'].includes(b.op)) {
    const { qs, qv } = await load(true);
    if (b.op === 'ask') {
      if (!meta.teams.some((t) => t.id === b.team)) return fail('Vyber tým, kterému se ptáš.');
      if (b.team === p.team) return fail('Vlastnímu týmu se ptát nemůžeš.');
      if (!QCATS[b.cat]) return fail('Vyber, čeho se otázka týká.');
      const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (text.length < 8) return fail('Napiš celou otázku.');
      const asked = Object.values(qs).filter((q) => q.by === p.id && q.block === meta.block && !q.hidden).length;
      if (asked >= Q_MAX) return fail(`V tomto bloku můžeš položit nejvýš ${Q_MAX} otázky.`);
      const id = crypto.randomBytes(5).toString('hex');
      await S.hset('qs', id, { id, block: meta.block, team: b.team, cat: b.cat, text, by: p.id, ts: Date.now(), ...(p.ghost ? { ghost: true } : {}) });
      invalidate();
      return ok({ id });
    }
    const q = qs[b.qid];
    if (!q || q.hidden) return fail('Otázka už není k dispozici.');
    if (b.op === 'vote') {
      if (q.team === p.team) return fail('Pro otázky svému týmu nehlasuješ.');
      if (q.by === p.id) return fail('Pro vlastní otázku nehlasuješ.');
      if (q.block !== meta.block) return fail('Hlasovat jde jen pro otázky z tohoto bloku.');
      const key = q.id + '|' + p.id;
      if (qv[key]) { await S.hdel('qv', key); invalidate(); return ok({ voted: false }); }
      const used = Object.keys(qv).filter((k) => k.endsWith('|' + p.id) && qs[k.split('|')[0]]?.block === meta.block).length;
      if (used >= V_MAX) return fail(`Všech ${V_MAX} hlasů už máš rozdaných. Jeden odeber a dej ho jinam.`);
      await S.hset('qv', key, 1);
      invalidate();
      return ok({ voted: true });
    }
    if (b.op === 'answer') {
      if (q.team !== p.team) return fail('Odpovídá jen tým, kterému je otázka položená.');
      if (p.ghost) return fail('Ghost neodpovídá za tým.');
      const text = String(b.text || '').trim().slice(0, 800);
      q.answer = text ? { text, ts: Date.now(), by: p.id } : null;
      await S.hset('qs', q.id, q);
      invalidate();
      return ok();
    }
    if (b.op === 'react') {
      if (!q.answer) return fail('Tým zatím neodpověděl.');
      if (q.team === p.team) return fail('Na odpovědi svého týmu nereaguješ.');
      if (p.ghost) return ok();
      const key = q.id + '|' + p.id;
      if (b.v === 'yes' || b.v === 'no') await S.hset('qr', key, b.v); else await S.hdel('qr', key);
      invalidate();
      return ok();
    }
  }

  if (b.op === 'notes') {
    // re-read right before writing so a notes autosave never undoes an investment sent a moment earlier
    const slip = (await S.hgetall('slip:' + meta.block))[p.id] || {};
    slip.notes = cleanNotes(b.notes, meta);
    slip.ts = Date.now();
    await S.hset('slip:' + meta.block, p.id, slip);
    invalidate();
    return ok();
  }
  if (b.op === 'reasons') {
    const slip = slips[p.id];
    if (!slip?.submitted) return fail('Nejdřív investuj.');
    for (const k of ['in', 'out']) {
      for (const [t, why] of Object.entries(b[k] || {})) if (slip[k]?.[t]) slip[k][t].why = String(why || '').trim().slice(0, 600);
    }
    slip.ts = Date.now();
    await S.hset('slip:' + meta.block, p.id, slip);
    invalidate();
    return ok();
  }
  if (b.op === 'submit') {
    if (meta.phase !== 'betting') return fail('Investování teď není otevřené.');
    const v = G.validate(meta, p.id, p.team, { out: b.out, in: b.in });
    if (!v.ok) return fail(v.errors[0], { errors: v.errors });
    const prev = (await S.hgetall('slip:' + meta.block))[p.id] || {};
    await S.hset('slip:' + meta.block, p.id, {
      out: v.out, in: v.in, notes: b.notes ? cleanNotes(b.notes, meta) : prev.notes || {}, submitted: true, ts: Date.now(),
    });
    invalidate();
    return ok();
  }
  return fail('Neznámá akce.');
}

async function restoreFrom(d) {
  if (!d?.meta?.teams || !d.meta.ledger) return fail('Záloha je neplatná.');
  const { meta, players, content } = await load(true);
  const sameGame = d.meta.gid === meta.gid;
  if (!meta.auto && !sameGame) return ok({ skipped: true });
  let restored = false;
  if (meta.auto || (d.meta.rev || 0) > (meta.rev || 0)) {
    const nm = { ...d.meta, auto: false };
    await S.setJSON('meta', nm);
    restored = true;
  }
  const removed = new Set((restored ? d.meta.removed : meta.removed) || []);
  for (const [id, p] of Object.entries(d.players || {})) {
    if (!players[id] && !removed.has(id) && p && p.id === id) await S.hset('players', id, p);
  }
  for (const [k, map] of Object.entries(d.slips || {})) {
    const blk = Number(k);
    if (!(blk >= 1 && blk <= G.CFG.MAX_BLOCK)) continue;
    const cur = await S.hgetall('slip:' + blk);
    for (const [id, sl] of Object.entries(map || {})) {
      if (!sl || typeof sl !== 'object') continue;
      const c = cur[id];
      if (!c || (Number(sl.ts) || 0) > (Number(c.ts) || 0)) await S.hset('slip:' + blk, id, sl);
    }
  }
  if (d.content && Number(d.content.v || 0) > Number(content.v || 0)) await S.setJSON('content', d.content);
  for (const h of ['qs', 'qv', 'qr']) {
    const cur = await S.hgetall(h);
    for (const [f, v] of Object.entries(d.board?.[h] || {})) if (!(f in cur) && v != null) await S.hset(h, f, v);
  }
  invalidate();
  return ok({ restored });
}

async function dealerAction(b) {
  if (b.op === 'restore') return restoreFrom(b.dump);
  const { meta, players, slips } = await load(true);
  const blk = meta.block;
  const save = async () => { meta.rev = (meta.rev || 0) + 1; meta.auto = false; await S.setJSON('meta', meta); invalidate(); };

  switch (b.op) {
    case 'auth': return ok();

    case 'ghost': {
      // a test account that sees the students' view but never counts anywhere
      const teamId = meta.teams.some((t) => t.id === b.team) ? b.team : meta.teams[0].id;
      let g = Object.values(players).find((p) => p.ghost && p.team === teamId);
      if (!g) g = { id: 'g_' + crypto.randomBytes(6).toString('base64url'), name: 'Ghost', team: teamId, ghost: true, created: Date.now() };
      const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');
      g.pin = pinHash(g.id, pin);
      await S.hset('players', g.id, g);
      invalidate();
      return ok({ sid: g.id, pin });
    }

    case 'phase': {
      const allowed = ['lobby', 'pitch', 'betting', 'closed', 'final'];
      if (!allowed.includes(b.phase)) return fail('Neznámá fáze.');
      if ((b.phase === 'betting' || b.phase === 'closed') && meta.settled[blk + 'c']) return fail('Tento blok je už vyhodnocený. Pokračuj dalším blokem.');
      meta.phase = b.phase;
      if (b.phase === 'pitch') meta.presenting = meta.teams.some((t) => t.id === b.team) ? b.team : meta.presenting;
      if (b.phase !== 'pitch') meta.presenting = null;
      if (b.minutes !== undefined) setTimer(meta, b.minutes, b.label);
      else if (b.phase === 'closed' || b.phase === 'lobby') setTimer(meta, 0);
      await save();
      return ok();
    }
    case 'timer': setTimer(meta, b.minutes, b.label); await save(); return ok();
    case 'screen': meta.screen = b.screen === 'board' ? 'board' : 'table'; await save(); return ok();
    case 'reg': meta.regOpen = !!b.open; await save(); return ok();

    case 'showdown': {
      if (meta.settled[blk + 'c']) return fail('Showdown už proběhl.');
      if (!['betting', 'closed'].includes(meta.phase)) return fail('Nejdřív otevři a zavři investování.');
      await backup(structuredClone(meta));
      const delta = {}, skipped = [];
      let n = 0;
      for (const [sid, s] of Object.entries(slips)) {
        const p = players[sid];
        if (sid === G.RJ || !p || p.ghost || !s?.submitted) continue;
        const v = G.validate(meta, sid, p.team, s);
        if (!v.ok) { skipped.push({ name: p.name, error: v.errors[0] }); continue; }
        const d = G.apply(meta, sid, v);
        for (const [t, x] of Object.entries(d)) delta[t] = (delta[t] || 0) + x;
        n++;
      }
      for (const t in delta) delta[t] = r0(delta[t]);
      meta.settled[blk + 'c'] = true;
      meta.phase = 'showdown';
      setTimer(meta, 0);
      meta.reveal = { seq: ++meta.seq, block: blk, kind: 'class', delta, n };
      meta.history.push(G.snapshot(meta, `Blok ${blk}`));
      recordPf(meta);
      await save();
      return ok({ n, skipped });
    }
    case 'rjSave': {
      if (meta.settled[blk + 'r']) return fail('Smart money v tomto bloku už je odhalené.');
      const v = G.validate(meta, G.RJ, null, { out: b.out, in: b.in });
      if (!v.ok) return fail(v.errors[0], { errors: v.errors });
      await S.hset('slip:' + blk, G.RJ, { out: v.out, in: v.in, submitted: true, ts: Date.now() });
      invalidate();
      return ok();
    }
    case 'rjReveal': {
      if (!meta.settled[blk + 'c']) return fail('Nejdřív showdown třídy.');
      if (meta.settled[blk + 'r']) return fail('Smart money už je odhalené.');
      const s = slips[G.RJ];
      if (!s?.submitted) return fail('Nejdřív ulož rozdělení smart money.');
      const v = G.validate(meta, G.RJ, null, s);
      if (!v.ok) return fail(v.errors[0], { errors: v.errors });
      await backup(structuredClone(meta));
      const d = G.apply(meta, G.RJ, v);
      for (const t in d) d[t] = r0(d[t]);
      for (const t of meta.teams) {
        const i = v.in[t.id], o = v.out[t.id];
        if (i) addMsg(meta, t.id, { kind: 'smart', amt: i.amt, text: i.why });
        if (o) addMsg(meta, t.id, { kind: 'smart', amt: -o.amt, text: o.why });
      }
      meta.settled[blk + 'r'] = true;
      meta.phase = 'rj';
      meta.reveal = { seq: ++meta.seq, block: blk, kind: 'rj', delta: d };
      const last = meta.history[meta.history.length - 1];
      const snap = G.snapshot(meta, `Blok ${blk}`);
      if (last && last.label === `Blok ${blk}`) meta.history[meta.history.length - 1] = snap; else meta.history.push(snap);
      await save();
      return ok();
    }
    case 'revalue': {
      if (['betting', 'closed'].includes(meta.phase)) return fail('Během investování nelze přeceňovat.');
      const V = Object.fromEntries(Object.entries(b.V || {}).filter(([, v]) => Number(v) > 0));
      const why = b.why || {};
      const hasV = Object.keys(V).length > 0;
      if (!hasV && !Object.values(why).some((w) => String(w || '').trim())) return fail('Zadej nové ocenění nebo zprávu pro tým.');
      await backup(structuredClone(meta));
      const before = {};
      for (const t of meta.teams) before[t.id] = G.valuation(meta, t.id);
      if (hasV) G.revalue(meta, V);
      const delta = {};
      for (const t of meta.teams) delta[t.id] = r0(G.valuation(meta, t.id) - before[t.id]);
      for (const t of meta.teams) {
        const text = String(why[t.id] || '').trim().slice(0, 600);
        const moved = V[t.id] !== undefined;
        if (moved || text) addMsg(meta, t.id, moved ? { kind: 'revalue', from: r0(before[t.id]), to: r0(G.valuation(meta, t.id)), text } : { kind: 'note', text });
      }
      if (hasV) {
        const d = new Date();
        meta.history.push(G.snapshot(meta, `Přecenění ${d.getDate()}. ${d.getMonth() + 1}.`));
        recordPf(meta);
        meta.reveal = { seq: ++meta.seq, block: blk, kind: 'revalue', delta };
      }
      await save();
      return ok();
    }
    case 'nextBlock': {
      if (blk >= G.CFG.MAX_BLOCK) return fail('Toto je poslední blok. Použij Demo Day.');
      await backup(structuredClone(meta));
      meta.block = blk + 1;
      meta.phase = 'lobby'; meta.presenting = null; meta.reveal = null; meta.pins = [];
      setTimer(meta, 0);
      await save();
      return ok();
    }
    case 'pin': {
      if (!meta.teams.some((t) => t.id === b.team)) return fail('Neznámý tým.');
      const a = String(b.a || '').trim().slice(0, 600);
      if (!a) return fail('Prázdná odpověď.');
      meta.pins = meta.pins || [];
      if (meta.pins.some((p) => p.team === b.team && p.a === a)) return ok();
      meta.pins.push({ id: crypto.randomBytes(4).toString('hex'), team: b.team, q: String(b.q || '').slice(0, 60), a, amt: Math.round(Number(b.amt) || 0) });
      if (meta.pins.length > 12) meta.pins.shift();
      await save();
      return ok();
    }
    case 'qpin': {
      meta.qpin = b.qid || null;
      await save();
      return ok();
    }
    case 'qhide': {
      const { qs } = await load(true);
      const q = qs[b.qid];
      if (!q) return fail('Otázka nenalezena.');
      q.hidden = !!b.hidden;
      await S.hset('qs', q.id, q);
      if (q.hidden && meta.qpin === q.id) { meta.qpin = null; await save(); }
      invalidate();
      return ok();
    }
    case 'unpin': {
      meta.pins = b.all ? [] : (meta.pins || []).filter((p) => p.id !== b.id);
      await save();
      return ok();
    }
    case 'content': {
      const texts = {};
      for (const [k, v] of Object.entries(b.texts || {})) {
        if (/^[\w.]{1,80}$/.test(k) && typeof v === 'string' && v.trim()) texts[k] = v.slice(0, 2000);
      }
      let founders = null;
      if (Array.isArray(b.founders)) {
        founders = b.founders.slice(0, 12)
          .map((f) => ({ name: String(f?.name || '').trim().slice(0, 40), wiki: String(f?.wiki || '').trim().slice(0, 120), story: String(f?.story || '').trim().slice(0, 200), photo: /^https:\/\//.test(f?.photo || '') ? String(f.photo).slice(0, 500) : '' }))
          .filter((f) => f.name);
        if (!founders.length) founders = null;
      }
      await S.setJSON('content', { v: String(Date.now()), texts, founders });
      invalidate();
      return ok();
    }
    case 'startValuation': {
      const v = Math.round(Number(b.V));
      if (!(v >= 1000)) return fail('Zadej ocenění aspoň 1 000 $.');
      if (Object.keys(meta.ledger.H).some((k) => G.hasHoldings(meta, k))) return fail('Už se investovalo. Výchozí ocenění jde změnit jen před prvním showdownem (nebo po „Nová hra“).');
      for (const t of meta.teams) meta.ledger.P[t.id] = v / meta.ledger.S[t.id];
      meta.startV = v;
      meta.history = [G.snapshot(meta, 'Start')];
      meta.pfHist = [];
      await save();
      return ok();
    }
    case 'teams': {
      for (const t of meta.teams) {
        const u = (b.teams || []).find((x) => x.id === t.id);
        if (u?.name) t.name = String(u.name).slice(0, 30);
        if (u?.color && /^#[0-9a-f]{6}$/i.test(u.color)) t.color = u.color;
      }
      await save();
      return ok();
    }
    case 'resetPin': {
      const p = players[b.sid];
      if (!p) return fail('Hráč nenalezen.');
      p.pin = null;
      await S.hset('players', p.id, p);
      invalidate();
      return ok();
    }
    case 'movePlayer': {
      const p = players[b.sid];
      if (!p || !meta.teams.some((t) => t.id === b.team)) return fail('Hráč nebo tým nenalezen.');
      p.team = b.team;
      await S.hset('players', p.id, p);
      invalidate();
      return ok();
    }
    case 'removePlayer': {
      const p = players[b.sid];
      if (!p) return fail('Hráč nenalezen.');
      if (G.hasHoldings(meta, p.id)) return fail('Hráč už má investice, nejde smazat. Můžeš mu resetovat PIN.');
      await S.hdel('players', p.id);
      await S.hdel('slip:' + blk, p.id);
      meta.removed = [...(meta.removed || []), p.id].slice(-200);
      await save();
      return ok();
    }
    case 'undo': {
      const bk = (await S.getJSON('backups')) || [];
      const prev = bk.pop();
      if (!prev) return fail('Není co vracet.');
      await S.setJSON('backups', bk);
      prev.rev = (meta.rev || 0) + 1; prev.auto = false; prev.gid = meta.gid;
      await S.setJSON('meta', prev);
      invalidate();
      return ok();
    }
    case 'reset': {
      if (b.confirm !== 'RESET') return fail('Potvrď napsáním RESET.');
      const fresh = G.newMeta(meta.teams, meta.startV);
      for (let i = 1; i <= G.CFG.MAX_BLOCK; i++) await S.del('slip:' + i);
      await S.del('backups');
      if (!b.keepPlayers) await S.del('players');
      await S.setJSON('meta', fresh);
      invalidate();
      return ok();
    }
  }
  return fail('Neznámá akce.');
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://local');
    if (req.method === 'GET') {
      const { meta, players, slips, content, qs, qv, qr } = await load(false);
      const bd = { qs, qv, qr };
      const out = publicState(meta, players, slips, bd);
      out.content = content;
      const sid = req.headers['x-sid'], pin = req.headers['x-pin'];
      if (sid && pin) {
        const p = players[sid];
        if (p && p.pin && p.pin === pinHash(p.id, pin)) out.me = meState(meta, p, slips, bd);
        else out.meError = p ? 'pin' : 'unknown';
      }
      if (url.searchParams.get('view') === 'log' && dealerOk(req)) {
        return send(res, 200, { ok: true, storage: S.storageMode, pgEnv: S.pgEnvKey, log: await S.readLog(Number(url.searchParams.get('limit')) || 5000) });
      }
      if (url.searchParams.get('view') === 'dealer' && dealerOk(req)) {
        out.dealer = dealerState(meta, players, slips, bd);
        if (url.searchParams.get('dump') === '1') out.dealer.dump = await makeDump();
        if (url.searchParams.get('all') === '1') {
          const all = {};
          for (let i = 1; i <= meta.block; i++) {
            const h = await S.hgetall('slip:' + i);
            for (const k of Object.keys(h)) if (players[k]?.ghost) delete h[k];
            all[i] = h;
          }
          out.dealer.all = all;
          out.dealer.players = Object.fromEntries(
            Object.entries(players).map(([k, p]) => [k, { id: p.id, name: p.name, team: p.team }]),
          );
        }
      }
      return send(res, 200, out);
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const studentOps = ['register', 'login', 'notes', 'submit', 'reasons', 'restore', 'ask', 'vote', 'answer', 'react'];
      let r;
      const student = studentOps.includes(b.op);
      if (student) r = await studentAction(b);
      else {
        if (!dealerOk(req)) return send(res, 401, { ok: false, error: 'Špatné heslo dealera.' });
        r = await dealerAction(b);
      }
      if (b.op !== 'auth') {
        // action log: what every student / the dealer sent, without PINs and big backup blobs
        const { pin, dump, ...rest } = b;
        await S.logAction({ ts: Date.now(), op: b.op, actor: student ? b.sid || r.body.sid || '' : 'dealer', ok: !!r.body.ok, error: r.body.ok ? undefined : r.body.error, body: rest, sid: r.body.sid });
      }
      if (!student && r.body.ok) r.body.dump = await makeDump();
      return send(res, r.status, r.body);
    }
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { ok: false, error: 'Chyba serveru: ' + e.message });
  }
}
