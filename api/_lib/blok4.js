// Blok 4 "simple round" (19 Nov 2026): a 7th team, invest-only mode, a fresh round where everyone has
// $1M again (the open, never settled investments are handed back), and the "Minule → Dnes" movement on
// the table. Pure functions on meta (storage and archiving stay in api/game.js).
import * as G from './game.js';
import * as D from './demand.js';

// Everything except investing switched off; demand pricing off (simulation recommendation).
// `guard` (PIN brute-force limits) stays as it is.
export const INVEST_ONLY = {
  simple: true, pinFallback: true, demand: false,
  quiz: false, quizplus: false, points: false, track: false, captable: false, cards: false, drivers: false,
  rounds: false, market: false, tranches: false, exit: false,
  wall: false, wallplus: false, startupPage: false, recap: false, regie: false, sound: false, tape: false,
};

const r0 = (n) => Math.round(Number(n) || 0);
const cleanName = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Add a team. spec: { id?, name, color?, startV? }. Returns { team } or { error }. Mutates meta.
export function addTeam(meta, spec) {
  const name = cleanName(spec?.name, 30);
  if (name.length < 2) return { error: 'Zadej název týmu.' };
  if (meta.phase === 'betting') return { error: 'Během investování tým přidat nejde. Nejdřív investování zavři.' };
  if (meta.teams.length >= 7) return { error: 'Stůl má místo pro 7 týmů.' };
  const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (meta.teams.some((t) => fold(t.name) === fold(name))) return { error: `Tým „${name}“ už ve hře je.` };
  let id = String(spec?.id || '').trim();
  if (id && (!/^t\d{1,2}$/.test(id) || meta.teams.some((t) => t.id === id))) return { error: `Id týmu ${id} je obsazené nebo neplatné (t1–t99).` };
  if (!id) { let n = meta.teams.length + 1; while (meta.teams.some((t) => t.id === 't' + n)) n++; id = 't' + n; }
  const used = new Set(meta.teams.map((t) => String(t.color).toLowerCase()));
  const color = /^#[0-9a-f]{6}$/i.test(spec?.color || '') ? spec.color : G.EXTRA_COLORS.find((c) => !used.has(c.toLowerCase())) || '#2EC4C9';
  const startV = r0(spec?.startV) >= 1000 ? r0(spec.startV) : (meta.startV || G.CFG.START_VALUATION);
  const team = { id, name, color };
  meta.teams.push(team);
  meta.ledger.S[id] = G.CFG.FOUNDER_SHARES;
  meta.ledger.P[id] = startV / G.CFG.FOUNDER_SHARES;
  // the team "existed" at its start valuation in every earlier snapshot (charts, block start values)
  for (const h of meta.history || []) {
    if (h.V && h.V[id] === undefined) h.V[id] = startV;
    if (h.F && h.F[id] === undefined) h.F[id] = 100;
  }
  if (meta.movement?.prev && meta.movement.prev[id] === undefined) meta.movement.prev[id] = startV;
  return { team, startV };
}

// What the projector shows for each team right now (live projection while a block is pending, else V).
export function shownValues(meta, slips, players) {
  const now = D.teamNow(meta, D.project(meta, slips, players));
  return Object.fromEntries(meta.teams.map((t) => [t.id, r0(now[t.id]?.Vnow ?? G.valuation(meta, t.id))]));
}

// "Minule" values. prev: 'shown' (what the table shows now), 'base' (current settled valuations), or a map.
export function prevValues(meta, prev, slips, players) {
  const base = Object.fromEntries(meta.teams.map((t) => [t.id, r0(G.valuation(meta, t.id))]));
  if (prev && typeof prev === 'object') {
    const out = {};
    for (const t of meta.teams) { const v = r0(prev[t.id]); out[t.id] = v > 0 ? v : base[t.id]; }
    return { from: 'custom', prev: out };
  }
  if (prev === 'base') return { from: 'base', prev: base };
  return { from: 'shown', prev: shownValues(meta, slips, players) };
}

// New round: hand back every open (unsettled) investment and every class holding, everyone starts with the
// full student capital again, next block in the lobby. Mutates meta; returns a summary that is also kept in
// meta.voided (the slips themselves stay untouched in storage under slip:<old block> and in the archive).
export function newRound(meta, slips, players, opts = {}) {
  if (meta.phase === 'betting') return { error: 'Investování je otevřené. Nejdřív ho zavři.' };
  const blk = meta.block;
  if (blk >= G.CFG.MAX_BLOCK) return { error: 'Toto je poslední blok hry.' };
  const { from, prev } = prevValues(meta, opts.prev, slips, players);
  // the open investments of this block (never settled) – summary only
  const pendingOpen = !meta.settled?.[blk + 'c'];
  const perTeam = {}, sids = [];
  if (pendingOpen) {
    for (const [sid, s] of Object.entries(slips || {})) {
      if (sid === G.RJ || !players?.[sid] || players[sid].ghost || !s?.submitted) continue;
      sids.push(sid);
      for (const [t, e] of Object.entries(s.in || {})) perTeam[t] = (perTeam[t] || 0) + (Number(e?.amt) || 0);
    }
  }
  // settled class holdings (none in production on 19 Nov) are handed back too: shares cancelled, prices kept
  const L = meta.ledger;
  const returned = {};
  for (const [inv, h] of Object.entries(L.H)) {
    if (inv === G.RJ) continue;
    let any = false;
    for (const [t, sh] of Object.entries(h || {})) {
      if (!(sh > 1e-12) || !(t in L.S)) continue;
      returned[t] = (returned[t] || 0) + sh * (L.P[t] || 0);
      L.S[t] -= sh;
      any = true;
    }
    if (any || h) delete L.H[inv];
    if (meta.lots) delete meta.lots[inv];
  }
  for (const t of meta.teams) if (!(L.S[t.id] > 0)) L.S[t.id] = G.CFG.FOUNDER_SHARES;
  const label = cleanName(opts.label, 40) || 'Investiční kolo';
  const entry = {
    at: Date.now(), block: blk, toBlock: blk + 1, label, open: sids.length, openTotal: r0(Object.values(perTeam).reduce((a, b) => a + b, 0)),
    openPerTeam: Object.fromEntries(Object.entries(perTeam).map(([t, v]) => [t, r0(v)])),
    returnedHoldings: Object.fromEntries(Object.entries(returned).map(([t, v]) => [t, r0(v)])),
    prev, prevFrom: from, archiveId: opts.archiveId || null,
  };
  meta.voided = [...(meta.voided || []), entry].slice(-10);
  meta.block = blk + 1;
  meta.phase = 'lobby'; meta.presenting = null; meta.reveal = null; meta.pins = [];
  meta.movement = { block: meta.block, label, prev, prevFrom: from, at: entry.at };
  meta.history = meta.history || [];
  meta.history.push(G.snapshot(meta, label + ' · start'));
  return { entry };
}

// Edit the "Minule" values afterwards (dealer). prev: map | 'shown' | 'base'.
export function setPrev(meta, prev, slips, players) {
  if (!meta.movement) return { error: 'Nejdřív spusť nové kolo.' };
  const r = prevValues(meta, prev, slips, players);
  meta.movement.prev = r.prev; meta.movement.prevFrom = r.from;
  return { prev: r.prev };
}

// Public view: per team prev ("Minule"), now ("Dnes", live while investing), change $ and %.
// `done` once the round's showdown ran, so the table can say "Dnes" instead of "živě".
export function publicMovement(meta, teamsOut) {
  const m = meta.movement;
  if (!m || m.block !== meta.block) return null;
  const startV = meta.startV || G.CFG.START_VALUATION;
  const teams = {};
  for (const t of teamsOut) {
    const prev = r0(m.prev?.[t.id] ?? startV) || startV;
    const now = r0(t.Vnow ?? t.V);
    teams[t.id] = { prev, now, diff: now - prev, pct: prev > 0 ? Math.round((now / prev - 1) * 1000) / 10 : 0 };
  }
  return { label: m.label, prevFrom: m.prevFrom, done: !!meta.settled?.[meta.block + 'c'], live: D.isPending(meta), teams };
}
