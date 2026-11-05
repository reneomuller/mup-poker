// v4 startup lane: read-only „due diligence“ view of one startup for the phone's detail sheet.
//   GET /api/game?view=startup&team=<id>   (student: x-sid + x-pin; dealer preview: ?as=<sid> + x-dealer; dealer: x-dealer)
// Settled blocks list every investor by name with amounts and written reasons (the class plays it like a
// stock market, V3 §3). Ghosts are never listed. RainbowJet is listed only after that block's RJ reveal.
// The current, unsettled block gives totals only (no names, no reasons). Not part of the plain GET, so it
// adds no Redis commands there; it works on the data load() already read.
import * as G from './game.js';
import * as D from './demand.js';
import * as AC from './access.js';

export const OFF = 'Tato funkce je vypnutá.';
const r1 = (x) => Math.round(x * 10) / 10;
const fail = (status, error, extra = {}) => ({ status, body: { ok: false, error, ...extra } });

// Who is asking: a logged-in student, the dealer previewing a student (as=), or the dealer itself.
function viewerOf(req, players, pinHash) {
  const asP = AC.asPlayer(req, players);
  if (asP) return { p: asP };
  const sid = req.headers['x-sid'];
  if (sid) {
    const p = players[sid];
    if (!p || !p.pin || p.pin !== pinHash(p.id, String(req.headers['x-pin'] || ''))) return { error: fail(401, 'Přihlas se znovu.', { relogin: true }) };
    return { p };
  }
  if (req.headers['x-dealer'] && AC.isDealer(req)) return { p: null };
  return { error: fail(401, 'Přihlas se znovu.', { relogin: true }) };
}

// The viewer's own position in team t: projected shares × projected price, against what they paid for
// the lots they still hold (their pending buys of this block included, at the block's trade price).
// cost is null when the holdings predate lot tracking (v1 data), so no return can be computed.
function position(meta, proj, p, t) {
  if (!p) return null;
  const shares = proj.pm.ledger.H[p.id]?.[t] || 0;
  const value = shares * (proj.pm.ledger.P[t] || 0);
  const m = { ...meta, ledger: structuredClone(meta.ledger), lots: { [p.id]: structuredClone(meta.lots?.[p.id] || []) } };
  const mine = proj.pending ? proj.trades.find((x) => x.sid === p.id) : null;
  if (mine) G.apply(m, p.id, mine.v);
  const lots = m.lots[p.id].filter((l) => l.team === t && l.shares > 0);
  const lotShares = lots.reduce((a, l) => a + l.shares, 0);
  const cost = lots.reduce((a, l) => a + l.shares * l.price, 0);
  const known = shares > 1e-9 && Math.abs(lotShares - shares) <= Math.max(1e-6, shares * 1e-6) && cost > 0;
  return {
    value: Math.round(value), shares: Math.round(shares * 100) / 100,
    pct: proj.pm.ledger.S[t] > 0 ? Math.round((shares / proj.pm.ledger.S[t]) * 1e4) / 100 : 0,
    cost: known ? Math.round(cost) : null, returnPct: known ? r1((value / cost - 1) * 100) : null,
  };
}

export function view(req, url, { meta, players, slips, pinHash }) {
  if (meta.features?.startupPage === false) return fail(403, OFF);
  const who = viewerOf(req, players, pinHash);
  if (who.error) return who.error;
  const t = String(url.searchParams.get('team') || '');
  const team = meta.teams.find((x) => x.id === t);
  if (!team) return fail(404, 'Startup nenalezen.');
  const proj = D.project(meta, slips, players);
  const now = D.teamNow(meta, proj);
  // the Tým tab's per-team builder (§3), so names, amounts, reasons and multiples are the same numbers
  const mt = D.myTeam(meta, { team: t }, players, proj, now);
  const blocks = [];
  let current = null;
  for (const f of mt.flows) {
    if (f.settled) {
      blocks.push({ block: f.block, mult: f.mult, totalIn: f.totalIn, totalOut: f.totalOut, rj: !!meta.settled?.[f.block + 'r'], investors: f.investors });
    } else {
      // unsettled: totals only, nothing that says who or why
      current = { block: f.block, totalIn: f.totalIn, totalOut: f.totalOut, count: f.investors.length, mult: f.mult };
    }
  }
  return {
    status: 200,
    body: {
      ok: true, team: t, block: meta.block, phase: meta.phase, pending: proj.pending,
      P: meta.ledger.P[t] || 0, Pnow: proj.pm.ledger.P[t] || 0, V: mt.V, Vnow: mt.Vnow, mult: mt.mult, rank: mt.rank, of: mt.of, chg: mt.chg,
      founders: mt.founders, investorsNow: mt.investorsNow, history: mt.history,
      mine: position(meta, proj, who.p, t), current, blocks,
    },
  };
}
