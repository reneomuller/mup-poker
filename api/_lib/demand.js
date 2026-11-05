// v3 §1–§3: demand pricing. One pure module used by the showdown and by every live view,
// so the live (projected) numbers equal the post-showdown numbers exactly.
import * as G from './game.js';

export const MULT_MIN = 0.1, MULT_MAX = 10;
const clamp = (x) => Math.min(MULT_MAX, Math.max(MULT_MIN, x));

// The class trades of the current block: submitted, non-ghost, non-RJ slips that validate
// (exactly the set the showdown applies). Each investor only touches their own holdings, so order is irrelevant.
export function classTrades(meta, slips, players) {
  const trades = [], skipped = [];
  for (const [sid, s] of Object.entries(slips || {})) {
    const p = players[sid];
    if (sid === G.RJ || !p || p.ghost || !s?.submitted) continue;
    const v = G.validate(meta, sid, p.team, s);
    if (!v.ok) { skipped.push({ sid, name: p.name, error: v.errors[0] }); continue; }
    trades.push({ sid, p, v });
  }
  return { trades, skipped };
}

// mult_t = clamp(1 + (net_t − avgNet) / avgIn, 0.1, 10); 1 for everyone when avgIn = 0 or demand is off.
export function demandOf(meta, trades, on = true) {
  const ids = meta.teams.map((t) => t.id);
  const inn = {}, out = {}, mult = {};
  for (const t of ids) { inn[t] = 0; out[t] = 0; }
  for (const { v } of trades) {
    for (const [t, e] of Object.entries(v.in)) if (t in inn) inn[t] += e.amt;
    for (const [t, e] of Object.entries(v.out)) if (t in out) out[t] += e.amt;
  }
  const n = ids.length || 1;
  const avgIn = ids.reduce((a, t) => a + inn[t], 0) / n;
  const avgNet = ids.reduce((a, t) => a + inn[t] - out[t], 0) / n;
  for (const t of ids) mult[t] = on && avgIn > 0 ? clamp(1 + (inn[t] - out[t] - avgNet) / avgIn) : 1;
  return { mult, in: inn, out, avgIn };
}

export const demand = (meta, slips, players, on = true) => demandOf(meta, classTrades(meta, slips, players).trades, on);

export const isPending = (meta) => ['betting', 'closed'].includes(meta.phase) && !meta.settled?.[meta.block + 'c'];
export const demandOn = (meta) => meta.features?.demand !== false;

// Apply the class trades to `m` at the old prices, then reprice by the demand multiple. Mutates m.
// Returns { delta (class money per team), before (V after trades, before repricing), dem, n }.
export function settleClass(m, trades, on) {
  const low = G.lowTeams(m);
  const delta = {};
  const dem = demandOf(m, trades, on);
  for (const { sid, v } of trades) {
    const d = G.apply(m, sid, v, low);
    for (const [t, x] of Object.entries(d)) delta[t] = (delta[t] || 0) + x;
  }
  const before = {};
  for (const t of m.teams) {
    before[t.id] = G.valuation(m, t.id);
    if (on && m.ledger.P[t.id] > 0) m.ledger.P[t.id] *= dem.mult[t.id];
  }
  return { delta, before, dem, n: trades.length };
}

// The projected state while class trades are pending: a light meta copy with the ledger cloned,
// the pending trades applied and prices multiplied. Not pending → the real meta, mult 1.
export function project(meta, slips, players) {
  if (!isPending(meta)) {
    const mult = Object.fromEntries(meta.teams.map((t) => [t.id, 1]));
    return { pm: meta, pending: false, trades: [], dem: { mult, in: {}, out: {}, avgIn: 0 } };
  }
  const { trades } = classTrades(meta, slips, players);
  const pm = { ...meta, ledger: structuredClone(meta.ledger), lots: null };
  const { dem } = settleClass(pm, trades, demandOn(meta));
  return { pm, pending: true, trades, dem };
}

// Valuation of each team at the start of the current block (last snapshot of an earlier block, else Start).
export function blockStartV(meta) {
  const h = meta.history || [];
  let snap = null;
  for (let i = h.length - 1; i >= 0; i--) if ((h[i].block || 0) < meta.block) { snap = h[i]; break; }
  if (!snap) snap = h[0];
  const out = {};
  for (const t of meta.teams) out[t.id] = snap?.V?.[t.id] > 0 ? snap.V[t.id] : (meta.startV || G.CFG.START_VALUATION);
  return out;
}

// Team-level live numbers: Vnow, mult, rank (1 = highest Vnow), chg (fraction vs start of block).
export function teamNow(meta, proj) {
  const st = blockStartV(meta);
  const vn = {};
  for (const t of meta.teams) vn[t.id] = G.valuation(proj.pm, t.id);
  const out = {};
  for (const t of meta.teams) {
    const rank = 1 + meta.teams.filter((x) => vn[x.id] > vn[t.id] + 1e-6).length;
    out[t.id] = {
      Vnow: Math.round(vn[t.id]), mult: Math.round((proj.dem.mult[t.id] ?? 1) * 1e4) / 1e4, rank,
      chg: st[t.id] > 0 ? Math.round((vn[t.id] / st[t.id] - 1) * 1e4) / 1e4 : 0,
    };
  }
  return out;
}

export const fmtMult = (x) => '×' + (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');

// What gets stored per settled block for the Tým tab flows (per investor, class + RJ after its reveal).
export function flowsOf(trades) {
  const o = {};
  for (const { sid, v } of trades) o[sid] = { in: v.in, out: v.out };
  return o;
}

// meState.myTeam (§3).
export function myTeam(meta, p, players, proj, now) {
  const t = p.team;
  const team = meta.teams.find((x) => x.id === t);
  if (!team) return null;
  const n = now[t];
  const L = proj.pm.ledger;
  const S = L.S[t] || 0;
  let investorsNow = 0;
  for (const [k, h] of Object.entries(L.H)) {
    if (k === G.RJ || !players[k] || players[k].ghost) continue;
    if ((h?.[t] || 0) > 1e-9) investorsNow++;
  }
  const history = (meta.history || []).map((s) => ({ label: s.label, block: s.block, V: s.V?.[t] ?? null })).filter((x) => x.V !== null);
  if (proj.pending) history.push({ label: 'Teď', block: meta.block, V: n.Vnow, live: true });
  const rows = (fl, withRj) => {
    const list = [];
    for (const [sid, f] of Object.entries(fl || {})) {
      if (sid === G.RJ) { if (!withRj) continue; }
      else if (!players[sid] || players[sid].ghost) continue;
      const i = f.in?.[t], o = f.out?.[t];
      if (!i && !o) continue;
      list.push({
        id: sid, name: sid === G.RJ ? 'RainbowJet' : players[sid].name, team: sid === G.RJ ? null : players[sid].team,
        in: i?.amt || 0, out: o?.amt || 0, whyIn: i?.why || '', whyOut: o?.why || '',
      });
    }
    return list.sort((a, b) => (b.in - b.out) - (a.in - a.out) || a.name.localeCompare(b.name, 'cs'));
  };
  const flows = [];
  for (let b = meta.block; b >= 1; b--) {
    const settled = !!meta.settled?.[b + 'c'];
    let investors, mult;
    if (settled) {
      investors = rows(meta.flows?.[b], !!meta.settled?.[b + 'r']);
      mult = meta.demand?.[b]?.mult?.[t] ?? 1;
    } else if (b === meta.block && proj.pending) {
      investors = rows(flowsOf(proj.trades), false);
      mult = proj.dem.mult[t] ?? 1;
    } else continue;
    flows.push({
      block: b, settled, totalIn: investors.reduce((a, x) => a + x.in, 0), totalOut: investors.reduce((a, x) => a + x.out, 0),
      mult: Math.round(mult * 1e4) / 1e4, investors,
    });
  }
  return {
    id: t, name: team.name, color: team.color, Vnow: n.Vnow, V: Math.round(G.valuation(meta, t)),
    P: meta.ledger.P[t], Pnow: L.P[t], mult: n.mult, rank: n.rank, of: meta.teams.length, chg: n.chg,
    founders: S > 0 ? Math.round((G.CFG.FOUNDER_SHARES / S) * 1000) / 10 : 0, investorsNow, history, flows,
  };
}

// publicState.demand: per settled block only the multiples ({ [block]: { mult: { t: x } } }), so a reloaded
// projector can still show „×1,63“ on each plate.
export function publicDemand(meta) {
  const out = {};
  for (const [b, d] of Object.entries(meta.demand || {})) {
    out[b] = { mult: Object.fromEntries(Object.entries(d?.mult || {}).map(([t, x]) => [t, Math.round(x * 1e4) / 1e4])) };
  }
  return out;
}
