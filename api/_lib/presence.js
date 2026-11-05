// v4 regie (flag `regie`, default on): the dealer's stage-manager layer.
// - Presence: phones POST {op:'hb', sid, pin} every 30 s while the page is visible. Cost per beat: one HGET
//   (players, for the PIN) + one write. With Redis it is `SET mup:seen:<sid> <ts> EX <ttl>` (never mirrored
//   to Postgres, it expires by itself); without Redis it is one field in the hash `seen`, swept on read.
//   Never logged (it would flood the action log). A plain GET reads nothing from here.
// - GET ?view=presence (dealer only): class health – who has not submitted this block (by team), who is
//   connected / dropped / never seen, teams with no members, old PIN-less accounts, open wall tasks per team,
//   the last dealer actions and what `undo` would revert.
// - Dealer ops: `regiePlan` (run-of-show plan in meta.regie, so it travels in dumps and survives undo) and
//   `nudge` (reminder to a team: a wall task when walls are on, otherwise a private team message).
// - track(b): after every successful dealer op, a short list of recent actions + the undo stack (key `regie:acts`).
import { Redis } from '@upstash/redis';
import * as S from './store.js';
import * as F from './features.js';
import * as W from './wall.js';
import * as E from './economy.js';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;

// seconds; the tests shorten them through the environment
const TTL = () => Math.max(1, Number(process.env.MUP_PRESENCE_TTL) || 120);
const WINDOW = () => Math.max(1, Number(process.env.MUP_PRESENCE_WINDOW) || 60);
const KEY = (sid) => 'mup:seen:' + sid;
const fail = (msg, status = 400) => ({ status, body: { ok: false, error: msg } });
const ok = (extra) => ({ status: 200, body: { ok: true, ...extra } });
const SID = /^[\w-]{4,24}$/;

// ---------- heartbeat ----------
export async function hb(b, pinHash) {
  const sid = String(b.sid || '');
  if (!SID.test(sid) || !/^\d{4}$/.test(String(b.pin || ''))) return fail('Přihlas se znovu.');
  const p = await S.hget('players', sid);
  if (!p || !p.pin || p.pin !== pinHash(sid, String(b.pin))) return fail('Přihlas se znovu.', 401);
  if (p.ghost) return ok({ ghost: true }); // a ghost never counts anywhere
  const ts = Date.now();
  if (redis) await redis.set(KEY(sid), String(ts), { ex: TTL() });
  else await S.hset('seen', sid, ts);
  return ok({ ts });
}

// sid -> last heartbeat (ms), only entries younger than the TTL
async function seenMap(ids) {
  const now = Date.now(), ttl = TTL() * 1000, out = {};
  if (!ids.length) return out;
  if (redis) {
    const vals = (await redis.mget(...ids.map(KEY))) || [];
    ids.forEach((id, i) => { const v = Number(vals[i]); if (v > 0 && now - v < ttl) out[id] = v; });
    return out;
  }
  const h = await S.hgetall('seen');
  const stale = [];
  for (const [id, v] of Object.entries(h)) {
    if (Number(v) > 0 && now - Number(v) < ttl) out[id] = Number(v);
    else stale.push(id);
  }
  await Promise.all(stale.slice(0, 50).map((id) => S.hdel('seen', id))); // the sweep: expired beats go away
  return out;
}

// ---------- class health ----------
const tname = (meta, id) => meta.teams.find((t) => t.id === id)?.name || id;
export function missingByTeam(meta, players, slips) {
  const out = {};
  for (const t of meta.teams) out[t.id] = [];
  for (const p of Object.values(players)) {
    if (!p || p.ghost || !out[p.team]) continue;
    if (!slips[p.id]?.submitted) out[p.team].push({ id: p.id, name: p.name });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => String(a.name).localeCompare(String(b.name), 'cs'));
  return out;
}

export async function view(meta, players, slips, dealer) {
  if (!dealer) return fail('Špatné heslo dealera.', 401);
  if (!F.on(meta, 'regie')) return fail(F.OFF);
  const now = Date.now(), win = WINDOW() * 1000;
  const real = Object.values(players).filter((p) => p && !p.ghost && meta.teams.some((t) => t.id === p.team));
  const [seen, walls, acts] = await Promise.all([
    seenMap(real.map((p) => p.id)),
    F.on(meta, 'wall') ? W.dataWalls(meta) : null,
    S.getJSON('regie:acts'),
  ]);
  const miss = missingByTeam(meta, players, slips);
  const rows = real.map((p) => {
    const s = seen[p.id] || null;
    return { id: p.id, name: p.name, team: p.team, hasPin: !!p.pin, seen: s, online: !!s && now - s < win, submitted: !!slips[p.id]?.submitted };
  }).sort((a, b) => tname(meta, a.team).localeCompare(tname(meta, b.team), 'cs') || String(a.name).localeCompare(String(b.name), 'cs'));
  const teams = meta.teams.map((t) => {
    const mem = rows.filter((r) => r.team === t.id);
    const tasks = walls ? (walls[t.id] || []).filter((s) => s.kind === 'task' && !s.done && !s.ghost) : [];
    return {
      id: t.id, name: t.name, members: mem.length, online: mem.filter((r) => r.online).length,
      missing: miss[t.id].map((x) => x.name), missingIds: miss[t.id].map((x) => x.id),
      tasks: tasks.length, taskTexts: tasks.slice(0, 5).map((s) => String(s.text).slice(0, 120)),
    };
  });
  const a = acts && typeof acts === 'object' ? acts : { list: [], stack: [] };
  return ok({
    now, window: WINDOW(), ttl: TTL(), block: meta.block, phase: meta.phase, wall: F.on(meta, 'wall'),
    players: rows,
    teams,
    notSubmitted: rows.filter((r) => !r.submitted).map((r) => ({ id: r.id, name: r.name, team: r.team })),
    online: rows.filter((r) => r.online).length,
    dropped: rows.filter((r) => r.seen && !r.online).map((r) => ({ id: r.id, name: r.name, team: r.team, seen: r.seen })),
    never: rows.filter((r) => !r.seen).map((r) => ({ id: r.id, name: r.name, team: r.team })),
    emptyTeams: teams.filter((t) => !t.members).map((t) => t.id),
    noPin: rows.filter((r) => !r.hasPin).map((r) => ({ id: r.id, name: r.name, team: r.team })),
    actions: (a.list || []).slice(-8).reverse(),
    undoTop: (a.stack || []).slice(-1)[0] || null,
  });
}

// ---------- dealer ops ----------
export const OPS = ['regiePlan', 'nudge'];
export const STEP_KINDS = ['lobby', 'pitch', 'bet', 'close', 'showdown', 'rj', 'quiz', 'next', 'exit', 'final', 'custom'];
export const MAX_STEPS = 80;

export function cleanPlan(plan) {
  if (!Array.isArray(plan)) return null;
  const out = [];
  const ids = new Set();
  for (const s of plan.slice(0, MAX_STEPS)) {
    if (!s || typeof s !== 'object' || !STEP_KINDS.includes(s.k)) continue;
    let id = String(s.id || '').replace(/[^\w-]/g, '').slice(0, 24) || s.k + out.length;
    while (ids.has(id)) id += 'x';
    ids.add(id);
    const step = { id, k: s.k, min: Math.max(0, Math.min(180, Math.round((Number(s.min) || 0) * 2) / 2)) };
    const b = Math.round(Number(s.b));
    if (b >= 1 && b <= 20) step.b = b;
    const label = String(s.label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (label) step.label = label;
    out.push(step);
  }
  return out;
}

export async function dealerOp(b, meta, players, slips, save) {
  if (!F.on(meta, 'regie')) return fail(F.OFF);
  if (b.op === 'regiePlan') {
    if (b.plan === null) { meta.regie = { plan: null, ts: Date.now() }; await save(); return ok({ plan: null }); } // back to the default plan
    const plan = cleanPlan(b.plan);
    if (!plan) return fail('Plán je neplatný.');
    meta.regie = { plan, ts: Date.now() };
    await save();
    return ok({ plan });
  }
  // nudge: { team } | { all: true }, optional via: 'wall' | 'msg' (default: wall when walls are on)
  const miss = missingByTeam(meta, players, slips);
  const targets = b.all === true ? meta.teams.map((t) => t.id).filter((t) => miss[t].length) : [b.team];
  if (b.all !== true && !meta.teams.some((t) => t.id === b.team)) return fail('Vyber tým.');
  if (!targets.length || targets.every((t) => !miss[t]?.length)) return fail('Všichni v tomto týmu už investovali.');
  const via = b.via === 'msg' || !F.on(meta, 'wall') ? 'msg' : 'wall';
  const sent = [];
  for (const t of targets) {
    if (!miss[t].length) continue;
    const names = miss[t].map((x) => x.name);
    const text = 'Ještě vám chybí investice od: ' + names.join(', ');
    if (via === 'wall') {
      const r = await W.op({ op: 'wallPost', team: t, kind: 'task', text }, meta, { role: 'dealer' });
      if (!r.body.ok) return r;
      sent.push({ team: t, names, via, id: r.body.id });
    } else {
      E.addMsg(meta, t, { kind: 'note', text, nudge: true });
      sent.push({ team: t, names, via });
    }
  }
  if (via === 'msg') await save();
  return ok({ sent, via });
}

// ---------- recent dealer actions + what undo reverts ----------
// The ops that push a backup (see backup() calls in game.js); `undo` pops the newest of them.
const UNDOABLE = new Set(['marketCard', 'trancheAdd', 'trancheCancel', 'trancheRelease', 'showdown', 'rjReveal', 'revalue', 'nextBlock']);
const QUIET = new Set(['auth', 'restore', 'regiePlan']);
export async function track(b) {
  if (!b || QUIET.has(b.op)) return;
  try {
    const cur = (await S.getJSON('regie:acts')) || {};
    const list = Array.isArray(cur.list) ? cur.list : [], stack = Array.isArray(cur.stack) ? cur.stack : [];
    const e = { op: String(b.op).slice(0, 30), ts: Date.now() };
    for (const k of ['phase', 'team', 'screen', 'label', 'minutes']) if (b[k] !== undefined && typeof b[k] !== 'object') e[k] = String(b[k]).slice(0, 40);
    if (b.all === true) e.all = true;
    if (b.op === 'undo') { const top = stack.pop(); if (top) e.of = top; }
    else if (UNDOABLE.has(b.op)) stack.push({ op: e.op, ts: e.ts });
    if (b.op === 'reset') { list.length = 0; stack.length = 0; }
    list.push(e);
    await S.setJSON('regie:acts', { list: list.slice(-30), stack: stack.slice(-15) });
  } catch (err) { console.error('regie track failed', err?.message); }
}
