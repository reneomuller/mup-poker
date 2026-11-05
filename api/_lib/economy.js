// v2 valuation events: priced rounds, market cards, RJ tranches, exit. Pure functions on meta.
import * as G from './game.js';
import * as F from './features.js';

const fmt = (n) => Math.round(n).toLocaleString('cs-CZ').replace(/[\s  ]/g, ' ') + ' $';
const tname = (m, t) => m.teams.find((x) => x.id === t)?.name || t;
const values = (m) => Object.fromEntries(m.teams.map((t) => [t.id, G.valuation(m, t.id)]));
const deltaSince = (m, before) => Object.fromEntries(m.teams.map((t) => [t.id, F.r0(G.valuation(m, t.id) - before[t.id])]));

// ---------- priced rounds ----------
export const termsKey = (blk, t) => `rt:${blk}:${t}`;
const r10k = (x) => Math.round(x / 10000) * 10000;
export function roundBounds(m, t) {
  const V = G.valuation(m, t);
  return { min: r10k(V * 0.5), max: r10k(V * 2) };
}
export const roundKind = (pct) => (Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down');
const KIND_NOTE = { up: 'Up round', down: 'Down round', flat: 'Flat round' };
export const termsLocked = (m) => !!m.settled[m.block + 't'];

// Can terms for the current block still be set? Returns an error or null.
export function termsOpen(m) {
  if (!F.on(m, 'rounds')) return F.OFF;
  if (termsLocked(m)) return 'Podmínky kola jsou už uzamčené.';
  if (m.settled[m.block + 'c'] || !['lobby', 'pitch'].includes(m.phase)) return 'Podmínky kola jde nastavit jen před otevřením investování.';
  return null;
}

// Validate a pre-money; returns { error } or { terms } to store in hash tx.
export function makeTerms(m, t, pre, by) {
  const err = termsOpen(m);
  if (err) return { error: err };
  if (!m.teams.some((x) => x.id === t)) return { error: 'Neznámý tým.' };
  const { min, max } = roundBounds(m, t);
  const v = r10k(Number(pre));
  if (!Number.isFinite(v) || v < min || v > max) return { error: `Ocenění kola musí být mezi ${fmt(min)} a ${fmt(max)}.` };
  return { terms: { pre: v, prev: F.r0(G.valuation(m, t)), ts: Date.now(), by: String(by || '').slice(0, 40) } };
}

// Phase -> betting: reprice every team with terms, lock the terms. Returns true if a price moved.
export function applyRounds(m, tx) {
  const blk = m.block, locked = {}, delta = {}, notes = {};
  let changed = false;
  for (const t of m.teams) {
    const tm = tx[termsKey(blk, t.id)];
    if (!tm || !(tm.pre > 0)) continue;
    const prevV = G.valuation(m, t.id);
    const pct = prevV > 0 ? (tm.pre / prevV - 1) * 100 : 0;
    locked[t.id] = { ...tm, prev: F.r0(prevV) };
    if (Math.abs(tm.pre - prevV) >= 1 && m.ledger.S[t.id] > 0) {
      m.ledger.P[t.id] = tm.pre / m.ledger.S[t.id];
      delta[t.id] = tm.pre - prevV;
      notes[t.id] = KIND_NOTE[roundKind(pct)];
      changed = true;
    }
  }
  m.rounds[blk] = locked;
  m.settled[blk + 't'] = true;
  if (changed) {
    F.addDrivers(m, 'round', delta, notes);
    m.history.push(G.snapshot(m, `Kolo bloku ${blk}`));
    F.recordPf(m);
  }
  return changed;
}

export function publicRounds(m, tx) {
  const blk = m.block, src = termsLocked(m) ? m.rounds[blk] || {} : null, out = {};
  for (const t of m.teams) {
    const tm = src ? src[t.id] : tx[termsKey(blk, t.id)];
    const V = F.r0(G.valuation(m, t.id));
    if (!tm) { out[t.id] = { pre: V, prev: V, kind: 'flat', pct: 0 }; continue; }
    const pct = tm.prev > 0 ? F.r1((tm.pre / tm.prev - 1) * 100) : 0;
    out[t.id] = { pre: tm.pre, prev: tm.prev, kind: roundKind(pct), pct };
  }
  return out;
}

// ---------- market cards ----------
export function marketCard(m, b) {
  if (['betting', 'closed'].includes(m.phase)) return 'Během investování nelze otočit kartu trhu.';
  const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!title) return 'Karta potřebuje název.';
  const effects = {};
  for (const t of m.teams) {
    const raw = b.effects?.[t.id];
    if (raw === undefined || raw === null || raw === '') continue;
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < -60 || pct > 100) return `Efekt pro ${tname(m, t.id)} musí být mezi −60 a +100 %.`;
    if (pct !== 0) effects[t.id] = Math.round(pct * 10) / 10;
  }
  const before = values(m);
  for (const [t, pct] of Object.entries(effects)) m.ledger.P[t] *= 1 + pct / 100;
  const delta = deltaSince(m, before);
  F.addDrivers(m, 'market', delta, title);
  for (const [t, pct] of Object.entries(effects)) addMsg(m, t, { kind: 'market', title, text, pct });
  const card = { id: F.rid(4), block: m.block, ts: Date.now(), title, text, effects };
  m.market.flipped.push(card);
  m.history.push(G.snapshot(m, `Karta: ${title}`));
  F.recordPf(m);
  m.reveal = { seq: ++m.seq, block: m.block, kind: 'market', title, text, delta };
  return null;
}

export function addMsg(meta, team, msg) {
  meta.fb = meta.fb || {};
  (meta.fb[team] = meta.fb[team] || []).push({ ts: Date.now(), block: meta.block, ...msg });
}

// ---------- RJ tranches ----------
export function trancheAdd(m, b) {
  if (!m.teams.some((t) => t.id === b.team)) return 'Neznámý tým.';
  const amt = Math.round(Number(b.amt));
  const { available } = G.rjFund(m);
  if (!(amt > 0)) return 'Zadej částku tranše.';
  if (amt > available) return `Ve fondu zbývá jen ${fmt(available)}.`;
  const cond = String(b.cond || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!cond) return 'Napiš podmínku tranše.';
  const due = String(b.due ?? '').trim().slice(0, 40);
  m.tranches.push({ id: F.rid(4), team: b.team, amt, cond, due, status: 'locked', ts: Date.now(), doneAt: null });
  return null;
}

export function trancheRelease(m, b) {
  const x = m.tranches.find((y) => y.id === b.id);
  if (!x) return 'Tranše nenalezena.';
  if (x.status !== 'locked') return 'Tranše už je vyřízená.';
  if (!(m.ledger.P[x.team] > 0)) return 'Do odepsaného týmu nejde investovat.';
  const d = G.apply(m, G.RJ, { out: {}, in: { [x.team]: { amt: x.amt, why: x.cond } } });
  m.rjPrincipal = (m.rjPrincipal || 0) + x.amt;
  x.status = 'released'; x.doneAt = Date.now();
  F.addDrivers(m, 'rj', d, 'Tranše: ' + x.cond);
  addMsg(m, x.team, { kind: 'tranche', amt: x.amt, cond: x.cond });
  m.reveal = { seq: ++m.seq, block: m.block, kind: 'tranche', team: x.team, amt: x.amt };
  return null;
}

export function trancheCancel(m, b) {
  const x = m.tranches.find((y) => y.id === b.id);
  if (!x) return 'Tranše nenalezena.';
  if (x.status !== 'locked') return 'Tranše už je vyřízená.';
  x.status = 'cancelled'; x.doneAt = Date.now();
  return null;
}

export const publicTranches = (m) => m.tranches.map(({ id, team, amt, cond, due, status }) => ({ id, team, amt, cond, due, status }));

// ---------- exit ----------
const EXIT_KINDS = ['acquired', 'ipo', 'hold', 'writeoff'];
export function cleanOutcomes(m, raw) {
  const out = {};
  for (const t of m.teams) {
    const o = raw?.[t.id];
    if (!o) { out[t.id] = { kind: 'hold', multiple: 1 }; continue; }
    if (!EXIT_KINDS.includes(o.kind)) return { error: `Neznámý výsledek pro ${tname(m, t.id)}.` };
    if (o.kind === 'acquired' || o.kind === 'ipo') {
      const x = Number(o.multiple);
      if (!(x >= 0.5 && x <= 20)) return { error: `Násobek pro ${tname(m, t.id)} musí být mezi 0,5 a 20.` };
      out[t.id] = { kind: o.kind, multiple: Math.round(x * 100) / 100 };
    } else out[t.id] = { kind: o.kind, multiple: o.kind === 'writeoff' ? 0 : 1 };
  }
  return { outcomes: out };
}

export function applyExit(m, outcomes) {
  const before = values(m);
  for (const [t, o] of Object.entries(outcomes)) {
    if (o.kind === 'acquired' || o.kind === 'ipo') m.ledger.P[t] *= o.multiple;
    else if (o.kind === 'writeoff') m.ledger.P[t] = 0;
  }
  const all = deltaSince(m, before), delta = {};
  for (const [t, o] of Object.entries(outcomes)) if (o.kind !== 'hold') delta[t] = all[t];
  const notes = {};
  const label = { acquired: 'Akvizice', ipo: 'IPO', hold: 'Bez exitu', writeoff: 'Odpis' };
  for (const [t, o] of Object.entries(outcomes)) notes[t] = o.kind === 'acquired' || o.kind === 'ipo' ? `${label[o.kind]} ${String(o.multiple).replace('.', ',')}×` : label[o.kind];
  F.addDrivers(m, 'exit', delta, notes);
  m.phase = 'final';
  m.presenting = null;
  m.history.push(G.snapshot(m, 'Exit'));
  F.recordPf(m);
  m.reveal = { seq: ++m.seq, block: m.block, kind: 'exit' };
  m.exit = { ts: Date.now(), outcomes };
}

export function publicExit(m, players) {
  const rk = F.ranking(m, players).slice(0, 10).map(({ name, team, value }) => ({ name, team, value, returnPct: F.returnPct(value) }));
  return {
    outcomes: m.exit.outcomes,
    teams: m.teams.map((t) => ({ team: t.id, kind: m.exit.outcomes[t.id]?.kind || 'hold', multiple: m.exit.outcomes[t.id]?.multiple ?? 1, V: F.r0(G.valuation(m, t.id)) })),
    ranking: rk,
    contrarian: F.contrarian(m, players),
  };
}
