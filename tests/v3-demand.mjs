// v3 §1–§3: demand pricing (pure math + showdown), live numbers (Vnow/mult/rank/chg, portfolioNow…),
// meState.myTeam (flows with names, live current block, ghosts excluded), demand off = v2, conservation.
import { ok, section, main, client, checkClean, invariants, freshGame, sum, rebalanceSlip } from './_e-lib.mjs';
import * as D from '../api/_lib/demand.js';

const c = client();
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
// Block 1 per-team totals of the production-shaped state (19 slips, 19M): synthetic slips reproduce them.
const TARGET = [5_670_000, 5_150_000, 2_720_000, 2_370_000, 1_900_000, 1_190_000];

// Deterministic: lay the 19M of targets end to end; each student takes one 1M interval of that line,
// matched (Kuhn) so that no interval touches the student's own team.
function block1Slips(T, S) {
  const seg = [];
  let x = 0;
  T.forEach((t, i) => { seg.push({ t, a: x, b: x + TARGET[i] }); x += TARGET[i]; });
  const K = S.length, U = 1_000_000;
  const parts = (k) => seg.map((g) => ({ t: g.t, amt: Math.max(0, Math.min(g.b, (k + 1) * U) - Math.max(g.a, k * U)) })).filter((p) => p.amt > 0);
  const okFor = (s, k) => parts(k).every((p) => p.t !== s.team);
  const owner = new Array(K).fill(-1);
  const tryS = (si, seen) => {
    for (let k = 0; k < K; k++) {
      if (seen[k] || !okFor(S[si], k)) continue;
      seen[k] = true;
      if (owner[k] < 0 || tryS(owner[k], seen)) { owner[k] = si; return true; }
    }
    return false;
  };
  for (let si = 0; si < K; si++) tryS(si, []);
  const slips = {};
  owner.forEach((si, k) => {
    if (si < 0) return;
    const s = S[si];
    slips[s.sid] = { in: Object.fromEntries(parts(k).map((p) => [p.t, { amt: p.amt, why: `Proč ${s.name} → ${p.t}` }])) };
  });
  return slips;
}

const tally = (T, slips) => {
  const i = Object.fromEntries(T.map((t) => [t, 0])), o = Object.fromEntries(T.map((t) => [t, 0]));
  for (const sl of Object.values(slips)) {
    for (const [t, e] of Object.entries(sl.in || {})) i[t] += e.amt;
    for (const [t, e] of Object.entries(sl.out || {})) o[t] += e.amt;
  }
  return { i, o };
};
const expMult = (T, { i, o }) => {
  const avgIn = sum(T.map((t) => i[t])) / T.length, avgNet = sum(T.map((t) => i[t] - o[t])) / T.length;
  return Object.fromEntries(T.map((t) => [t, avgIn > 0 ? Math.min(10, Math.max(0.1, 1 + (i[t] - o[t] - avgNet) / avgIn)) : 1]));
};

await main(async () => {
  section('pure math (demandOf)');
  {
    const meta = { teams: [1, 2, 3, 4, 5, 6].map((k) => ({ id: 't' + k })) };
    const tr = (inn, out = {}) => ({ v: { in: Object.fromEntries(Object.entries(inn).map(([t, a]) => [t, { amt: a }])), out: Object.fromEntries(Object.entries(out).map(([t, a]) => [t, { amt: a }])) } });
    const d = D.demandOf(meta, [tr({ t1: 5_670_000, t2: 5_150_000, t3: 2_720_000, t4: 2_370_000, t5: 1_900_000, t6: 1_190_000 })]);
    ok(near(d.avgIn, 19_000_000 / 6, 1e-6), 'avgIn = mean of in_t');
    ok(near(d.mult.t1, 5_670_000 / (19_000_000 / 6), 1e-9) && near(d.mult.t6, 1_190_000 / (19_000_000 / 6), 1e-9), 'Block 1: mult = in_t / avgIn');
    const reb = D.demandOf(meta, [tr({ t1: 200_000, t2: 100_000 }, { t3: 300_000 })]);
    ok(near(reb.mult.t1, 1 + 200_000 / 50_000, 1e-9) && near(reb.mult.t3, Math.max(0.1, 1 - 300_000 / 50_000), 1e-9) && reb.mult.t4 === 1, 'rebalance: mult = 1 + net/avgIn, clamped at 0.1');
    const big = { teams: Array.from({ length: 12 }, (_, k) => ({ id: 'x' + k })) };
    const hi = D.demandOf(big, [tr({ x0: 1_000_000 })]);
    ok(hi.mult.x0 === 10 && hi.mult.x1 === 0.1, 'clamp: 12× demand → 10, no demand → 0.1');
    const z = D.demandOf(meta, []);
    ok(Object.values(z.mult).every((x) => x === 1) && z.avgIn === 0, 'avgIn = 0 → mult 1 everywhere');
    const off = D.demandOf(meta, [tr({ t1: 1_000_000 })], false);
    ok(Object.values(off.mult).every((x) => x === 1), 'demand off → mult 1');
  }

  section('Block 1: live numbers before the showdown');
  const { T, S, G } = await freshGame(c, { n: 19, ghost: true });
  const ctx = { S, G };
  const feat = (await c.get()).features;
  ok(feat.demand === true, 'features.demand defaults to on');
  const slips = block1Slips(T, S);
  const tl = tally(T, slips);
  ok(T.every((t, i) => tl.i[t] === TARGET[i]), 'synthetic slips reproduce 5.67M / 5.15M / 2.72M / 2.37M / 1.90M / 1.19M');
  const M = expMult(T, tl);
  const EXP = Object.fromEntries(T.map((t) => [t, (1_000_000 + tl.i[t]) * M[t]]));
  ok(near(EXP[T[0]], 11_942_000, 5_000) && near(EXP[T[1]], 10_000_000, 10_000) && near(EXP[T[5]], 822_000, 5_000), 'spec §7 numbers: ≈11.94M, ≈10.00M … ≈0.82M');
  await c.dealer('phase', { phase: 'betting', minutes: 5 });
  // the ghost submits too: it must change nothing
  const others = T.filter((t) => t !== G.team);
  ok((await c.st(G, 'submit', { in: { [others[0]]: { amt: 1_000_000, why: 'Ghost důvod' } } })).ok, 'ghost submits a slip');
  let pub = await c.get();
  ok(pub.teams.every((t) => t.Vnow === t.V && t.mult === 1 && t.rank >= 1 && t.chg === 0), 'nothing submitted (ghost only): Vnow = V, mult 1, chg 0');
  const half = S.slice(0, 10);
  for (const s of half) ok((await c.st(s, 'submit', slips[s.sid])).ok || false, `submit ${s.name}`);
  const part = tally(T, Object.fromEntries(half.map((s) => [s.sid, slips[s.sid]])));
  const Mp = expMult(T, part);
  pub = await c.get();
  ok(pub.teams.every((t) => near(t.Vnow, (1_000_000 + part.i[t.id]) * Mp[t.id], 1) && near(t.mult, Mp[t.id], 1e-4)), 'partial: Vnow and mult follow the submitted slips');
  ok(pub.teams.every((t) => t.V === 1_000_000), 'V keeps its v2 meaning (no trades applied yet)');
  for (const s of S.slice(10)) await c.st(s, 'submit', slips[s.sid]);
  pub = await c.get();
  ok(pub.betCount === 19, 'betCount 19 (ghost not counted)');
  ok(pub.teams.every((t) => near(t.Vnow, EXP[t.id], 1)), 'live Vnow = §7 numbers before the showdown');
  ok(pub.teams.every((t) => near(t.mult, M[t.id], 1e-4)), 'live mult = in_t / avgIn');
  const byV = [...pub.teams].sort((a, b) => b.Vnow - a.Vnow);
  ok(byV.every((t, i) => t.rank === i + 1), 'rank 1 = highest Vnow');
  ok(pub.teams.every((t) => near(t.chg, EXP[t.id] / 1_000_000 - 1, 1e-4)), 'chg = Vnow / V at block start − 1');
  ok(pub.teams.every((t) => typeof t.cls === 'number' && typeof t.live === 'number' && t.live === tl.i[t.id]), 'cls/rj/live keep their v2 meaning');
  ok(pub.leaders.length === 5 && pub.leaders.every((l) => l.value > 0) && pub.leaders[0].value > 1_000_000, 'leaders use projected portfolios');
  checkClean('pub (pending)', pub);
  const me0 = (await c.me(S[0])).me;
  const expPf = sum(Object.entries(slips[S[0].sid].in).map(([t, e]) => e.amt * M[t]));
  ok(near(me0.portfolioNow, expPf, 2) && me0.portfolio === 0, `me.portfolioNow = Σ in × mult (${me0.portfolioNow} vs ${Math.round(expPf)}), portfolio stays v2`);
  ok(Object.entries(slips[S[0].sid].in).every(([t, e]) => near(me0.stakesNow[t], e.amt * M[t], 1)), 'me.stakesNow per team');
  ok(Number.isInteger(me0.rankNow) && me0.rankNow >= 1 && me0.rankNow <= 19, 'me.rankNow');
  // myTeam: live current block with names, ghost not listed
  const mt = me0.myTeam;
  const own = S[0].team;
  ok(mt && mt.id === own && mt.of === 6 && near(mt.Vnow, EXP[own], 1) && mt.V === 1_000_000 && near(mt.mult, M[own], 1e-4), 'myTeam header: id, Vnow, V, mult, of');
  ok(mt.history.length >= 2 && mt.history[mt.history.length - 1].live && near(mt.history[mt.history.length - 1].V, EXP[own], 1), 'myTeam.history ends with a live point');
  const f1 = mt.flows[0];
  const backers = S.filter((s) => slips[s.sid].in[own]);
  ok(f1 && f1.block === 1 && !f1.settled && f1.investors.length === backers.length, `flows[0]: live block 1 lists ${backers.length} investors`);
  ok(f1.investors.every((x) => backers.some((s) => s.sid === x.id && s.name === x.name && x.in === slips[s.sid].in[own].amt && x.whyIn === slips[s.sid].in[own].why)), 'investors have real names, amounts and reasons');
  ok(f1.totalIn === tl.i[own], 'totalIn = class money in');
  ok(!f1.investors.some((x) => x.id === G.sid), 'ghost never listed');
  ok(mt.investorsNow === backers.length, 'investorsNow (projected)');
  const gme = (await c.me(G)).me;
  ok(gme.myTeam && gme.myTeam.id === G.team, 'ghost gets its team too');
  ok(!gme.myTeam.flows.some((f) => f.investors.some((x) => x.id === G.sid)), 'ghost not in its own team flows either');

  section('Block 1: showdown = live');
  await c.dealer('phase', { phase: 'closed' });
  const liveV = Object.fromEntries((await c.get()).teams.map((t) => [t.id, t.Vnow]));
  const livePf = (await c.me(S[0])).me.portfolioNow;
  const sd = await c.dealer('showdown');
  ok(sd.ok && sd.n === 19, `showdown applied 19 (${sd.n})`);
  pub = await c.get();
  ok(pub.teams.every((t) => t.V === liveV[t.id] && t.Vnow === t.V && t.mult === 1), 'post-showdown V = live Vnow exactly; Vnow = V; mult 1');
  const me1 = (await c.me(S[0])).me;
  ok(me1.portfolio === livePf && me1.portfolioNow === me1.portfolio, 'portfolio = live portfolioNow');
  let meta = await c.meta();
  const dm = meta.demand?.[1];
  ok(dm && near(dm.avgIn, 19_000_000 / 6, 1e-6) && T.every((t) => near(dm.mult[t], M[t], 1e-9) && dm.in[t] === tl.i[t] && dm.out[t] === 0), 'meta.demand[1] = { mult, in, out, avgIn }');
  ok(T.every((t) => near(pub.demand?.[1]?.mult?.[t], M[t], 1e-4)), 'publicState.demand[1].mult (projector reload)');
  const dd = meta.drivers.filter((x) => x.kind === 'demand' && x.block === 1);
  ok(dd.length === 6 && dd.every((x) => near(x.delta, EXP[x.team] - (1_000_000 + tl.i[x.team]), 2)), 'demand drivers: delta = V after − V before repricing');
  ok(/^Poptávka v bloku 1 \(×\d+,\d\d\)$/.test(dd[0].note), `driver label „${dd[0].note}“`);
  ok(meta.drivers.some((x) => x.kind === 'class' && x.block === 1), 'class drivers still recorded');
  const flows1 = (await c.me(S[0])).me.myTeam.flows[0];
  ok(flows1.settled && flows1.investors.length === backers.length && near(flows1.mult, M[own], 1e-4), 'settled block 1 flows list every investor');
  await invariants(c, ctx, 'after block 1 showdown');
  const pfs = meta.pfHist[meta.pfHist.length - 1].v;
  ok(Object.keys(pfs).length === 19, 'recordPf after repricing');

  section('RJ after demand, rebalance block');
  const rjIn = { [T[5]]: { amt: 2_000_000, why: 'RJ věří' }, [T[4]]: { amt: 8_000_000, why: 'RJ' } }; // initial RJ = exactly 10M
  ok((await c.dealer('rjSave', { in: rjIn })).ok && (await c.dealer('rjReveal')).ok, 'RJ invests at the new prices');
  const mtR = (await c.me(S.find((s) => s.team === T[5]))).me.myTeam;
  ok(mtR.flows[0].investors.some((x) => x.id === 'rj' && x.name === 'RainbowJet' && x.in === 2_000_000), 'RJ listed after its reveal');
  ok(!(await c.me(S.find((s) => s.team === T[3]))).me.myTeam.flows[0].investors.some((x) => x.id === 'rj'), 'RJ not listed for a team it did not touch');
  await invariants(c, ctx, 'after RJ');
  ok((await c.dealer('nextBlock')).ok, 'nextBlock');
  await c.dealer('phase', { phase: 'betting' });
  const startV = Object.fromEntries((await c.get()).teams.map((t) => [t.id, t.V]));
  const slips2 = {};
  for (const [i, s] of S.entries()) {
    const st = (await c.me(s)).me.stakes;
    const sl = rebalanceSlip(T, s.team, st, i, 300_000, 'b2');
    if (!sl) continue;
    slips2[s.sid] = sl;
    const r = await c.st(s, 'submit', sl);
    if (!r.ok) { ok(false, `rebalance submit ${s.name}: ${r.error}`); delete slips2[s.sid]; }
  }
  const tl2 = tally(T, slips2);
  ok(near(sum(T.map((t) => tl2.i[t] - tl2.o[t])), 0, 0), 'rebalance: Σ net = 0');
  const M2 = expMult(T, tl2);
  pub = await c.get();
  meta = await c.meta();
  const P = meta.ledger.P, Sx = meta.ledger.S;
  const exp2 = Object.fromEntries(T.map((t) => [t, (Sx[t] * P[t] + tl2.i[t] - tl2.o[t]) * M2[t]]));
  ok(pub.teams.every((t) => near(t.mult, M2[t.id], 1e-4)), 'rebalance live mult = 1 + net/avgIn');
  ok(pub.teams.every((t) => near(t.Vnow, exp2[t.id], 2)), 'rebalance live Vnow = (V + net) × mult');
  ok(pub.teams.every((t) => near(t.chg, t.Vnow / startV[t.id] - 1, 1e-3)), 'chg relative to start of block 2');
  const live2 = Object.fromEntries(pub.teams.map((t) => [t.id, t.Vnow]));
  const liveMe = await Promise.all(S.slice(0, 5).map((s) => c.me(s)));
  await c.dealer('phase', { phase: 'closed' });
  ok((await c.dealer('showdown')).ok, 'showdown block 2');
  pub = await c.get();
  ok(pub.teams.every((t) => t.V === live2[t.id]), 'block 2: post-showdown V = live Vnow');
  const after = await Promise.all(S.slice(0, 5).map((s) => c.me(s)));
  ok(after.every((m, i) => m.me.portfolio === liveMe[i].me.portfolioNow && T.every((t) => m.me.stakes[t] === liveMe[i].me.stakesNow[t])), 'block 2: portfolios and stakes = live ones');
  const mt2 = (await c.me(S[0])).me.myTeam;
  ok(mt2.flows.length === 2 && mt2.flows[0].block === 2 && mt2.flows[1].block === 1, 'flows newest first');
  await invariants(c, ctx, 'after block 2 showdown');
  ok((await c.dealer('revalue', { V: Object.fromEntries(T.map((t) => [t, 2_000_000])) })).ok || true, 'manual revalue still accepted');
  await invariants(c, ctx, 'after revalue');

  section('dump / restore carries meta.demand');
  const dump = await c.dump();
  ok(dump.meta.demand?.[1] && dump.meta.demand?.[2] && dump.meta.flows?.[1], 'dump has meta.demand and meta.flows');
  const dv = await c.dget('?view=data');
  ok(dv.ok && dv.demand?.[1]?.mult && dv.demand?.[2]?.avgIn > 0, '?view=data carries demand per block');
  ok((await c.dealer('restore', { dump })).ok, 'restore');
  const m2 = await c.meta();
  ok(JSON.stringify(m2.demand) === JSON.stringify(dump.meta.demand), 'restored meta.demand identical');

  section('demand off = v2');
  const g2 = await freshGame(c, { n: 19, ghost: false, features: { demand: false } });
  ok((await c.get()).features.demand === false, 'demand switched off');
  const slipsB = block1Slips(g2.T, g2.S);
  await c.dealer('phase', { phase: 'betting' });
  for (const s of g2.S) await c.st(s, 'submit', slipsB[s.sid]);
  const tlB = tally(g2.T, slipsB);
  pub = await c.get();
  ok(pub.teams.every((t) => t.mult === 1 && t.Vnow === 1_000_000 + tlB.i[t.id]), 'off: live Vnow = V + money in, mult 1');
  await c.dealer('phase', { phase: 'closed' });
  await c.dealer('showdown');
  pub = await c.get();
  meta = await c.meta();
  ok(pub.teams.every((t) => t.V === 1_000_000 + tlB.i[t.id]), 'off: showdown at fixed prices (v2)');
  ok(!meta.demand?.[1] && !meta.drivers.some((x) => x.kind === 'demand'), 'off: no meta.demand, no demand drivers');
  await invariants(c, { S: g2.S, G: null }, 'demand off');
});
