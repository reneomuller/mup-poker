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
// - meta.regieLog / meta.regieUndo: the last dealer actions + what undo reverts, written in the op's own meta save.
import { Redis } from '@upstash/redis';
import * as S from './store.js';
import * as F from './features.js';
import * as W from './wall.js';
import * as E from './economy.js';
import * as GU from './guard.js';

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
export async function hb(b, pinHash, req) {
  const sid = String(b.sid || '');
  if (!SID.test(sid) || !/^\d{4}$/.test(String(b.pin || ''))) return fail('Přihlas se znovu.');
  const p = await S.hget('players', sid);
  if (!p || !p.pin) return fail('Přihlas se znovu.', 401);
  // v4 guard: a wrong PIN counts here like on every other route, and a locked player is refused, so the
  // heartbeat is no PIN oracle around the lockout (only a failed or locked beat reads meta, for the flag)
  if (p.pin !== pinHash(sid, String(b.pin))) return fail((await GU.failed(await S.getJSON('meta'), req, p)) ? GU.TOO_MANY : 'Přihlas se znovu.', 401);
  if (Number(p.lock) > Date.now() && GU.locked(await S.getJSON('meta'), p)) return fail(GU.TOO_MANY, 401);
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
  const [seen, walls] = await Promise.all([
    seenMap(real.map((p) => p.id)),
    F.on(meta, 'wall') ? W.dataWalls(meta) : null,
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
    actions: arr(meta.regieLog).slice().reverse(),
    undoTop: arr(meta.regieUndo).slice(-1)[0] || null,
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
  if (meta.settled?.[meta.block + 'c']) return fail('Showdown tohoto bloku už proběhl.');
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

// ---------- recent dealer actions + what undo reverts (inside meta: 0 extra commands) ----------
// meta.regieLog: the last 5 dealer actions { op, label, ts }, written in the op's own meta save.
// meta.regieUndo: ≤ 15 { op, label, ts } mirroring the backups stack, so the undo confirm can name what it reverts.
// backup() in game.js calls noteBackup(); dealer ops run one at a time per instance (serial), so the next
// save of meta belongs to the op that pushed the backup (this also covers the priced-round repricing at „betting“).
// Neither field is in KEEP_ON_UNDO: the backups hold them as they were before the op, so undo restores both
// (the reverted op leaves the history together with its effects, and the stack's new top is the previous backup).
const LOG_MAX = 5, UNDO_MAX = 15;
const QUIET = new Set(['auth', 'restore', 'regiePlan']);
const PH = { lobby: 'Lobby', pitch: 'Pitch', betting: 'Otevřít investování', closed: 'Zavřít investování', final: 'Demo Day' };
const OPL = {
  showdown: 'Showdown', rjReveal: 'Odhalení smart money', rjSave: 'Uložení smart money', revalue: 'Přecenění', nextBlock: 'Další blok',
  reg: 'Registrace', features: 'Funkce', quizStart: 'Start kvízu', quizNext: 'Další otázka', quizReveal: 'Odhalení odpovědi', quizBoard: 'Žebříček kvízu',
  quizEnd: 'Konec kvízu', quizAdvance: 'Kvíz – další krok', quizSave: 'Uložení kvízu', quizDelete: 'Smazání kvízu', pointsAdd: 'Přidání bodů', pointsRemove: 'Odebrání bodů',
  award: 'Ocenění', awardRemove: 'Odebrání ocenění', marketCard: 'Karta trhu', trancheAdd: 'Nová tranše RJ', trancheCancel: 'Zrušení tranše', trancheRelease: 'Uvolnění tranše',
  exitSet: 'Exit', card: 'Karta startupu', milestoneDefs: 'Milníky', roundTerms: 'Podmínky kola', teams: 'Týmy', content: 'Texty', startValuation: 'Startovní ocenění',
  clearBoard: 'Vyčištění otázek', resetPin: 'Reset PINu', movePlayer: 'Přesun hráče', removePlayer: 'Odebrání hráče', pin: 'Připnutí otázky', qpin: 'Otázka na plátno',
  qhide: 'Skrytí otázky', unpin: 'Odepnutí',
};
const mins = (n) => String(Math.round((Number(n) || 0) * 10) / 10).replace('.', ',');
export function opLabel(meta, b) {
  const tn = (id) => meta.teams.find((t) => t.id === id)?.name || id;
  if (b.op === 'phase') {
    const base = PH[b.phase] || String(b.phase);
    return b.phase === 'pitch' && b.team ? `${base}: ${tn(b.team)}` : b.phase === 'betting' && meta.rounds && Object.keys(meta.rounds).length && F.on(meta, 'rounds') ? base + ' (nový kurz kola)' : base;
  }
  if (b.op === 'timer') return Number(b.minutes) > 0 ? `Časovač ${mins(b.minutes)} min` : 'Zastavení časovače';
  if (b.op === 'screen') return b.screen === 'board' ? 'Plátno: žebříček' : 'Plátno: stůl';
  if (b.op === 'nudge') return 'Připomínka ' + (b.all === true ? 'všem týmům' : 'týmu ' + tn(b.team));
  return OPL[b.op] || String(b.op).slice(0, 30);
}
let pendingBackup = false;
export function noteBackup() { pendingBackup = true; }
const arr = (x) => (Array.isArray(x) ? x : []);
// called from dealerAction's save(): adds this op to meta.regieLog (and to meta.regieUndo when it pushed a backup)
export function logInMeta(meta, b) {
  const backed = pendingBackup;
  pendingBackup = false;
  if (!b || b.__rg || QUIET.has(b.op) || !F.on(meta, 'regie')) return;
  b.__rg = true; // an op that saves twice is logged once
  const e = { op: String(b.op).slice(0, 30), label: opLabel(meta, b).slice(0, 80), ts: Date.now() };
  meta.regieLog = [...arr(meta.regieLog), e].slice(-LOG_MAX);
  if (backed) meta.regieUndo = [...arr(meta.regieUndo), e].slice(-UNDO_MAX);
}
