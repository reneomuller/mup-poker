// One endpoint for the whole game. GET = state, POST = action.
import crypto from 'node:crypto';
import * as S from './_lib/store.js';
import * as G from './_lib/game.js';

const DEALER_PW = process.env.DEALER_PASSWORD || 'mup-dealer';
const DEALER_DEFAULT = !process.env.DEALER_PASSWORD;

let cache = { t: 0, data: null };

async function load(fresh) {
  if (!fresh && cache.data && Date.now() - cache.t < 700) return cache.data;
  let meta = await S.getJSON('meta');
  if (!meta) { meta = G.newMeta(); await S.setJSON('meta', meta); }
  const [players, slips] = await Promise.all([S.hgetall('players'), S.hgetall('slip:' + meta.block)]);
  const data = { meta, players, slips };
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

// ---------- views ----------
function publicState(meta, players, slips) {
  const r = G.raised(meta);
  const teams = meta.teams.map((t) => ({ ...t, V: r0(G.valuation(meta, t.id)), cls: r0(r[t.id].cls), rj: r0(r[t.id].rj) }));
  const plist = Object.values(players).map((p) => ({ id: p.id, name: p.name, team: p.team }));
  const betCount = Object.entries(slips).filter(([k, s]) => k !== G.RJ && players[k] && s?.submitted).length;
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
  };
}

function meState(meta, p, slips) {
  const st = G.stakes(meta, p.id);
  const stakes = {};
  for (const [t, v] of Object.entries(st)) stakes[t] = r0(v);
  return { id: p.id, name: p.name, team: p.team, stakes, portfolio: r0(G.portfolio(meta, p.id)), rules: G.rules(meta, p.id), slip: slips[p.id] || null };
}

function callList(meta, players, slips) {
  const tname = (t) => meta.teams.find((x) => x.id === t)?.name || t;
  const bets = [], outs = [], backers = {}, conc = [];
  for (const [sid, s] of Object.entries(slips)) {
    const p = players[sid];
    if (!p || !s?.submitted) continue;
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

function dealerState(meta, players, slips) {
  const rows = Object.values(players).map((p) => ({
    id: p.id, name: p.name, team: p.team, hasPin: !!p.pin,
    portfolio: r0(G.portfolio(meta, p.id)), holdings: G.hasHoldings(meta, p.id), slip: slips[p.id] || null,
  }));
  const st = G.stakes(meta, G.RJ);
  const stakes = {};
  for (const [t, v] of Object.entries(st)) stakes[t] = r0(v);
  return {
    rows, dealerDefault: DEALER_DEFAULT, settled: meta.settled,
    rj: { stakes, portfolio: r0(G.portfolio(meta, G.RJ)), rules: G.rules(meta, G.RJ), slip: slips[G.RJ] || null },
    calls: callList(meta, players, slips),
  };
}

// ---------- actions ----------
async function backup(meta) {
  const b = (await S.getJSON('backups')) || [];
  b.push(meta);
  while (b.length > 15) b.shift();
  await S.setJSON('backups', b);
}

function cleanNotes(notes, meta) {
  const out = {};
  if (notes && typeof notes === 'object') {
    for (const t of meta.teams) if (notes[t.id]) out[t.id] = String(notes[t.id]).slice(0, 1000);
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
  const p = players[b.sid];
  if (!p) return fail('Hráč nenalezen. Přihlas se znovu.', { relogin: true });
  if (!/^\d{4}$/.test(String(b.pin || ''))) return fail('PIN musí mít 4 číslice.');
  if (!p.pin) { p.pin = pinHash(p.id, b.pin); await S.hset('players', p.id, p); invalidate(); }
  else if (p.pin !== pinHash(p.id, b.pin)) return fail('Špatný PIN.', { relogin: true });

  if (b.op === 'login') return ok({ sid: p.id });

  if (b.op === 'notes') {
    const slip = slips[p.id] || {};
    slip.notes = cleanNotes(b.notes, meta);
    await S.hset('slip:' + meta.block, p.id, slip);
    invalidate();
    return ok();
  }
  if (b.op === 'submit') {
    if (meta.phase !== 'betting') return fail('Sázky teď nejsou otevřené.');
    const v = G.validate(meta, p.id, p.team, { out: b.out, in: b.in });
    if (!v.ok) return fail(v.errors[0], { errors: v.errors });
    const prev = slips[p.id] || {};
    await S.hset('slip:' + meta.block, p.id, {
      out: v.out, in: v.in, notes: b.notes ? cleanNotes(b.notes, meta) : prev.notes || {}, submitted: true, ts: Date.now(),
    });
    invalidate();
    return ok();
  }
  return fail('Neznámá akce.');
}

async function dealerAction(b) {
  const { meta, players, slips } = await load(true);
  const blk = meta.block;
  const save = async () => { await S.setJSON('meta', meta); invalidate(); };

  switch (b.op) {
    case 'auth': return ok();

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
      if (!['betting', 'closed'].includes(meta.phase)) return fail('Nejdřív otevři a zavři sázky.');
      await backup(structuredClone(meta));
      const delta = {}, skipped = [];
      let n = 0;
      for (const [sid, s] of Object.entries(slips)) {
        const p = players[sid];
        if (sid === G.RJ || !p || !s?.submitted) continue;
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
      if (['betting', 'closed'].includes(meta.phase)) return fail('Během sázek nelze přeceňovat.');
      await backup(structuredClone(meta));
      const before = {};
      for (const t of meta.teams) before[t.id] = G.valuation(meta, t.id);
      G.revalue(meta, b.V || {});
      const delta = {};
      for (const t of meta.teams) delta[t.id] = r0(G.valuation(meta, t.id) - before[t.id]);
      const d = new Date();
      meta.history.push(G.snapshot(meta, `Přecenění ${d.getDate()}. ${d.getMonth() + 1}.`));
      meta.reveal = { seq: ++meta.seq, block: blk, kind: 'revalue', delta };
      await save();
      return ok();
    }
    case 'nextBlock': {
      if (blk >= G.CFG.MAX_BLOCK) return fail('Toto je poslední blok. Použij Demo Day.');
      await backup(structuredClone(meta));
      meta.block = blk + 1;
      meta.phase = 'lobby'; meta.presenting = null; meta.reveal = null;
      setTimer(meta, 0);
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
      invalidate();
      return ok();
    }
    case 'undo': {
      const bk = (await S.getJSON('backups')) || [];
      const prev = bk.pop();
      if (!prev) return fail('Není co vracet.');
      await S.setJSON('backups', bk);
      await S.setJSON('meta', prev);
      invalidate();
      return ok();
    }
    case 'reset': {
      if (b.confirm !== 'RESET') return fail('Potvrď napsáním RESET.');
      const fresh = G.newMeta(meta.teams);
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
      const { meta, players, slips } = await load(false);
      const out = publicState(meta, players, slips);
      const sid = req.headers['x-sid'], pin = req.headers['x-pin'];
      if (sid && pin) {
        const p = players[sid];
        if (p && p.pin && p.pin === pinHash(p.id, pin)) out.me = meState(meta, p, slips);
        else out.meError = true;
      }
      if (url.searchParams.get('view') === 'dealer' && req.headers['x-dealer'] === DEALER_PW) {
        out.dealer = dealerState(meta, players, slips);
        if (url.searchParams.get('all') === '1') {
          const all = {};
          for (let i = 1; i <= meta.block; i++) all[i] = await S.hgetall('slip:' + i);
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
      const studentOps = ['register', 'login', 'notes', 'submit'];
      let r;
      if (studentOps.includes(b.op)) r = await studentAction(b);
      else {
        if (req.headers['x-dealer'] !== DEALER_PW) return send(res, 401, { ok: false, error: 'Špatné heslo dealera.' });
        r = await dealerAction(b);
      }
      return send(res, r.status, r.body);
    }
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { ok: false, error: 'Chyba serveru: ' + e.message });
  }
}
