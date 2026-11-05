// v2: feature flags, defaults for older game states, cap table, valuation drivers, track record, points.
// Pure functions on meta (no storage) so they are easy to test and reuse.
import crypto from 'node:crypto';
import * as G from './game.js';
import { QUIZ_SEED } from './quiz-seed.js';

export const FEATURE_DEFAULTS = {
  captable: true, cards: true, drivers: true, track: true, quiz: true, points: true,
  rounds: false, market: false, tranches: false, exit: false,
  wall: true,
  demand: true,
  startupPage: true, // v4: startup detail sheet on the phone (+ GET ?view=startup)
  quizplus: true, // v4: quiz explanations, ×2 questions, images, podium, lobby counter, results export
  wallplus: true, // v4: reactions, pins, accepted answers, task due/assignee, templates on the team walls
  recap: true, // v4: end-of-game recap on the phone + class report (GET ?view=recap / ?view=report)
  regie: true, // v4 regie: run-of-show, class health, presence, nudges, shortcuts on /dealer
};
export const OFF = 'Tato funkce je vypnutá.';
export const REASON_LABELS = { milestone: 'Splněný milník', traction: 'Trakce', team: 'Tým', risk: 'Riziko', market: 'Trh', other: 'Jiné' };
export const MILESTONE_DEFAULTS = [
  { key: 'm1a', label: 'Potvrzený problém a one-liner', block: 1 },
  { key: 'm1b', label: 'Tři nejrizikovější předpoklady', block: 1 },
  { key: 'm2a', label: 'Byznys model v2', block: 2 },
  { key: 'm2b', label: 'Přehled konkurence', block: 2 },
  { key: 'm2c', label: 'Memo s důkazy', block: 2 },
  { key: 'm2d', label: 'MVP brief', block: 2 },
  { key: 'm3a', label: 'MVP na veřejné adrese', block: 3 },
  { key: 'm4a', label: 'Růstový motor běží', block: 4 },
  { key: 'm5a', label: 'Byznys model a pitch', block: 5 },
];
export const AWARD_KINDS = ['sharpest', 'analyst', 'contrarian', 'custom'];
export const POINT_KINDS = ['quiz', 'award', 'milestone', 'manual'];
export const DRIVERS_MAX = 600;
export const QUIZ_IDLE = { runId: null, setId: null, idx: -1, state: 'idle', startedAt: null, endsAt: null, seq: 0 };

// Fields that belong to the course rather than to one game round: undo keeps them, and restoring an
// old-shaped dump (without them) keeps the server's current ones.
export const KEEP_ON_UNDO = ['features', 'quizSets', 'quiz', 'quizLog', 'points', 'awards', 'cards', 'milestoneDefs', 'v2ArchivedAt', 'wallTpl', 'regie'];
export const V2_FIELDS = [...KEEP_ON_UNDO, 'drivers', 'rounds', 'market', 'tranches', 'rjPrincipal', 'lots', 'exit'];

export const seedSets = () => [{ id: 'blok2', title: 'Blok 2 – slovník', questions: structuredClone(QUIZ_SEED) }];
export const rid = (n = 5) => crypto.randomBytes(n).toString('hex');
export const r0 = (n) => (Number.isFinite(n) ? Math.round(n) : 0);
export const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);
export const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
export const on = (m, k) => !!m.features?.[k];

// Fill every v2 field an older meta lacks. Safe to run on every load; never removes anything.
export function normalize(m) {
  m.features = { ...FEATURE_DEFAULTS, ...(m.features && typeof m.features === 'object' ? m.features : {}) };
  if (!m.cards || typeof m.cards !== 'object') m.cards = {};
  if (!Array.isArray(m.milestoneDefs)) m.milestoneDefs = structuredClone(MILESTONE_DEFAULTS);
  if (!Array.isArray(m.drivers)) m.drivers = [];
  if (!m.rounds || typeof m.rounds !== 'object') m.rounds = {};
  if (!m.market || !Array.isArray(m.market.flipped)) m.market = { flipped: [] };
  if (!Array.isArray(m.tranches)) m.tranches = [];
  if (!Number.isFinite(m.rjPrincipal)) m.rjPrincipal = G.hasHoldings(m, G.RJ) ? Math.min(G.CFG.RJ_CAPITAL, Math.round(G.portfolio(m, G.RJ))) : 0;
  if (!m.lots || typeof m.lots !== 'object') m.lots = {};
  if (!Array.isArray(m.awards)) m.awards = [];
  if (!Array.isArray(m.quizSets)) m.quizSets = seedSets();
  if (!m.quiz || typeof m.quiz !== 'object') m.quiz = { ...QUIZ_IDLE };
  if (!Array.isArray(m.quizLog)) m.quizLog = [];
  if (!Array.isArray(m.points)) m.points = [];
  if (m.exit === undefined) m.exit = null;
  if (!m.settled) m.settled = {};
  if (!Array.isArray(m.history)) m.history = [];
  return m;
}

// ---------- portfolio history (stonks chart) ----------
export function recordPf(meta) {
  const v = {};
  for (const inv of Object.keys(meta.ledger.H)) {
    if (inv !== G.RJ && G.hasHoldings(meta, inv)) v[inv] = r0(G.portfolio(meta, inv));
  }
  meta.pfHist = meta.pfHist || [];
  meta.pfHist.push({ ts: Date.now(), v });
  if (meta.pfHist.length > 250) meta.pfHist.splice(0, meta.pfHist.length - 250);
}

// ---------- cap table ----------
export function capOf(m, t, players) {
  const S = m.ledger.S[t] || 0;
  let cls = 0, rj = 0, investors = 0;
  for (const [k, h] of Object.entries(m.ledger.H)) {
    const sh = h?.[t] || 0;
    if (sh <= 1e-9) continue;
    if (k === G.RJ) rj += sh;
    else { cls += sh; if (!players[k]?.ghost) investors++; }
  }
  const pct = (x) => (S > 0 ? r1((x / S) * 100) : 0);
  return { founders: G.founderPct(m, t), cls: pct(cls), rj: pct(rj), investors };
}

export function capHistory(m, t) {
  return (m.history || []).filter((h) => h.F && h.F[t] !== undefined).map((h) => ({ label: h.label, founders: h.F[t] }));
}

// ---------- valuation drivers ----------
// delta: { teamId: $ change }, note: string or { teamId: string }
export function addDrivers(m, kind, delta, note, extra) {
  const ts = Date.now();
  for (const t of m.teams) {
    const d = r0(delta[t.id] || 0);
    if (!d && kind !== 'exit' && !(kind === 'round' && t.id in delta)) continue;
    if (kind === 'exit' && delta[t.id] === undefined) continue;
    const n = typeof note === 'object' && note ? note[t.id] || '' : note || '';
    const x = extra?.[t.id] ? { ...extra[t.id] } : {};
    if (!x.why) delete x.why;
    m.drivers.push({ ts, block: m.block, team: t.id, kind, delta: d, note: String(n).slice(0, 200), ...x });
  }
  if (m.drivers.length > DRIVERS_MAX) m.drivers.splice(0, m.drivers.length - DRIVERS_MAX);
}

export function publicDrivers(m) {
  const out = {};
  for (const t of m.teams) out[t.id] = [];
  for (let i = m.drivers.length - 1; i >= 0; i--) {
    const d = m.drivers[i];
    if (out[d.team] && out[d.team].length < 8) { const { why, ...pub } = d; out[d.team].push(pub); }
  }
  return out;
}

// ---------- track record ----------
export const studentValue = (m, sid) => (G.hasHoldings(m, sid) ? G.portfolio(m, sid) : G.CFG.STUDENT_CAPITAL);
export const returnPct = (v) => r1(((v - G.CFG.STUDENT_CAPITAL) / G.CFG.STUDENT_CAPITAL) * 100);

export function ranking(m, players) {
  return Object.values(players)
    .filter((p) => p && !p.ghost)
    .map((p) => ({ id: p.id, name: p.name, team: p.team, value: r0(studentValue(m, p.id)) }))
    .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name), 'cs'));
}

const lotMultiple = (m, lot) => (lot.price > 0 ? (m.ledger.P[lot.team] || 0) / lot.price : 0);

export function bestCall(m, sid) {
  let best = null;
  for (const lot of m.lots[sid] || []) {
    if (!(lot.shares > 1e-9) || !(lot.price > 0)) continue;
    const x = lotMultiple(m, lot);
    if (!best || x > best.multiple) best = { team: lot.team, multiple: x };
  }
  return best ? { team: best.team, multiple: r2(best.multiple) } : null;
}

// Best current multiple on a "low" lot (bought when the team was at or below the median valuation).
// null until somebody's contrarian buy is actually up (multiple > 1).
export function contrarian(m, players) {
  let best = null;
  for (const [sid, lots] of Object.entries(m.lots)) {
    const p = players[sid];
    if (sid === G.RJ || !p || p.ghost) continue;
    for (const lot of lots || []) {
      if (!lot.low || !(lot.shares > 1e-9) || !(lot.price > 0)) continue;
      const x = lotMultiple(m, lot);
      if (x > 1.0001 && (!best || x > best.multiple)) best = { name: p.name, team: p.team, target: lot.team, multiple: x };
    }
  }
  return best ? { ...best, multiple: r2(best.multiple) } : null;
}

export function myTrack(m, p, players) {
  const value = r0(studentValue(m, p.id));
  const rk = ranking(m, players);
  const i = rk.findIndex((x) => x.id === p.id);
  return {
    value, start: G.CFG.STUDENT_CAPITAL, returnPct: returnPct(value),
    rank: i >= 0 ? 1 + rk.filter((x) => x.value > value).length : null, of: rk.length,
    bestCall: bestCall(m, p.id),
    awards: m.awards.filter((a) => a.playerId === p.id).map((a) => ({ id: a.id, kind: a.kind, note: a.note, block: a.block })),
  };
}

export function publicAwards(m, players) {
  return m.awards
    .filter((a) => !players[a.playerId]?.ghost)
    .map((a) => ({ id: a.id, block: a.block, kind: a.kind, name: players[a.playerId]?.name || '?', team: players[a.playerId]?.team || null, note: a.note }));
}

// ---------- points ----------
export function addPoints(m, playerId, amt, kind, note, extra) {
  const e = { id: rid(4), ts: Date.now(), block: m.block, playerId, amt: Math.round(amt), kind, note: String(note || '').slice(0, 120), ...(extra || {}) };
  m.points.push(e);
  return e;
}

export function pointTotals(m, players) {
  const tot = {};
  for (const p of Object.values(players)) if (p && !p.ghost) tot[p.id] = 0;
  for (const e of m.points) if (e.playerId in tot) tot[e.playerId] += Number(e.amt) || 0;
  return tot;
}

export function publicPoints(m, players) {
  const tot = pointTotals(m, players);
  const leaders = Object.entries(tot)
    .filter(([, v]) => v !== 0)
    .map(([id, total]) => ({ name: players[id].name, team: players[id].team, total }))
    .sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name), 'cs'))
    .slice(0, 10);
  const teams = {};
  for (const t of m.teams) {
    const mem = Object.keys(tot).filter((id) => players[id].team === t.id);
    teams[t.id] = mem.length ? Math.round(mem.reduce((a, id) => a + tot[id], 0) / mem.length) : 0;
  }
  return { leaders, teams };
}

export function myPoints(m, p, players) {
  const tot = pointTotals(m, players);
  const total = p.ghost ? 0 : tot[p.id] || 0;
  const mine = m.points.filter((e) => e.playerId === p.id);
  return {
    total, rank: p.ghost ? null : 1 + Object.values(tot).filter((v) => v > total).length, of: Object.keys(tot).length,
    recent: mine.slice(-8).reverse().map((e) => ({ id: e.id, ts: e.ts, block: e.block, amt: e.amt, kind: e.kind, note: e.note })),
  };
}

// ---------- startup cards ----------
export function publicCards(m, tx) {
  const out = {};
  for (const t of m.teams) {
    const c = tx['card:' + t.id] || {};
    out[t.id] = { oneLiner: c.oneLiner || '', sub: c.sub || '', milestones: { ...(m.cards[t.id]?.milestones || {}) } };
  }
  return out;
}

export function cleanCardText(b, cur) {
  const one = b.oneLiner === undefined ? cur.oneLiner || '' : String(b.oneLiner || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const sub = b.sub === undefined ? cur.sub || '' : String(b.sub || '').replace(/[ \t]+/g, ' ').trim().slice(0, 220);
  return { oneLiner: one, sub };
}

export function cleanMilestoneDefs(defs) {
  if (!Array.isArray(defs)) return null;
  const out = [], seen = new Set();
  for (const d of defs.slice(0, 40)) {
    const key = String(d?.key || '').trim();
    const label = String(d?.label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const block = Math.round(Number(d?.block));
    if (!/^[\w-]{1,20}$/.test(key) || seen.has(key) || !label) return null;
    seen.add(key);
    out.push({ key, label, block: block >= 1 && block <= G.CFG.MAX_BLOCK ? block : 1 });
  }
  return out;
}
