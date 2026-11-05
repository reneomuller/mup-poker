// Edge cases and limits: flat rounds and range edges, text limits, custom milestone defs, drivers capped at 600,
// a written-off team (P = 0) in a later betting round, and GET speed/size after a long game.
import { ok, warnIf, info, section, main, client, sum, checkClean, invariants, freshGame, initialSlip, ALL_ON, ledgerTotal } from './_e-lib.mjs';

const c = client();
const V = (st, t) => st.teams.find((x) => x.id === t).V;

await main(async () => {
  const { T, S, G } = await freshGame(c, { n: 12, ghost: true, features: ALL_ON });
  const ctx = { S, G };

  section('rounds: flat and range edges');
  let st = await c.get();
  const v = V(st, T[0]);
  ok((await c.dealer('roundTerms', { team: T[0], pre: v })).ok, 'terms = current valuation accepted');
  st = await c.get();
  ok(st.rounds[T[0]].kind === 'flat' && st.rounds[T[0]].pct === 0, `kind flat, pct 0 (${JSON.stringify(st.rounds[T[0]])})`);
  ok((await c.dealer('roundTerms', { team: T[1], pre: v * 0.5 })).ok && (await c.dealer('roundTerms', { team: T[2], pre: v * 2 })).ok, 'exactly 50 % and 200 % accepted');
  ok((await c.dealer('roundTerms', { team: T[3], pre: v * 1.004 })).ok, 'terms +0.4 % accepted');
  st = await c.get();
  ok(st.rounds[T[3]].kind === 'flat', `+0.4 % (rounded to 10 000) is a flat round (${JSON.stringify(st.rounds[T[3]])})`);
  ok((await c.st(S[4], 'roundTerms', { pre: v * 1.1 })).ok && (await c.st(S[4], 'roundTerms', { pre: v * 1.3 })).ok && (await c.get()).rounds[S[4].team].pre === Math.round((v * 1.3) / 10000) * 10000, 'terms can be changed until betting');
  ok(!(await c.dealer('roundTerms', { team: 'nope', pre: v })).ok, 'unknown team refused');
  await c.dealer('phase', { phase: 'betting' });
  st = await c.get();
  ok(st.drivers[T[0]]?.[0]?.kind === 'round' && st.drivers[T[0]][0].note === 'Flat round' && st.drivers[T[0]][0].delta === 0, `flat round driver „Flat round“ delta 0 (${JSON.stringify(st.drivers[T[0]]?.[0])})`);
  ok(Math.abs(V(st, T[1]) - v * 0.5) <= 1 && Math.abs(V(st, T[2]) - v * 2) <= 1, 'edges repriced');
  await Promise.all(S.map((s, i) => c.st(s, 'submit', initialSlip(T, s.team, i))));
  await c.dealer('phase', { phase: 'closed' });
  await c.dealer('showdown');
  await c.dealer('rjSave', { in: { [T[5]]: { amt: 2e6, why: 'x' } } });
  await c.dealer('rjReveal');

  section('text limits');
  const mc = await c.dealer('marketCard', { title: 'T'.repeat(80), text: 'x'.repeat(300), effects: { [T[4]]: 5 } });
  st = await c.get();
  const last = st.market.flipped[st.market.flipped.length - 1];
  ok(!mc.ok || (last.title.length <= 60 && last.text.length <= 240), `market title ≤ 60, text ≤ 240 (${mc.ok ? last.title.length + '/' + last.text.length : 'refused'})`);
  const mc2 = await c.dealer('marketCard', { title: 'Bez efektu', text: 'Nic se neděje.', effects: {} });
  info(`market card without effects: ${mc2.ok ? 'accepted' : mc2.error}`);
  const ta = await c.dealer('trancheAdd', { team: 'nope', amt: 1e5, cond: 'x', due: 'y' });
  ok(!ta.ok, 'tranche for an unknown team refused');
  ok(!(await c.dealer('trancheAdd', { team: T[0], amt: -5, cond: 'x', due: 'y' })).ok, 'negative tranche refused');
  const aw = await c.dealer('award', { kind: 'custom', playerId: S[3].sid, note: 'n'.repeat(400) });
  ok(!aw.ok || (await c.get()).awards.every((a) => a.note.length <= 300), 'award note length bounded');

  section('custom milestone defs');
  const defs = [{ key: 'm1a', label: 'Potvrzený problém a one-liner', block: 1 }, { key: 'zz', label: 'Vlastní milník – demo', block: 3 }];
  ok((await c.dealer('milestoneDefs', { defs })).ok, 'milestoneDefs');
  st = await c.get();
  ok(st.milestoneDefs.length === 2 && st.milestoneDefs[1].key === 'zz' && st.milestoneDefs[1].label === 'Vlastní milník – demo', 'publicState.milestoneDefs replaced');
  const pb = await c.meta();
  ok((await c.dealer('card', { team: T[2], milestones: { zz: true } })).ok, 'custom milestone set');
  const pa = await c.meta();
  ok(S.filter((s) => s.team === T[2]).every((s) => ledgerTotal(pa, s.sid) - ledgerTotal(pb, s.sid) === 300), 'custom milestone gives +300 per member');
  const unk = await c.dealer('card', { team: T[2], milestones: { nope: true } });
  ok(!unk.ok || !(await c.get()).cards[T[2]].milestones.nope, 'unknown milestone key not stored');

  section('drivers capped at 600');
  for (let i = 0; i < 105; i++) {
    const eff = Object.fromEntries(T.map((t, k) => [t, (i + k) % 2 ? 1 : -1]));
    await c.dealer('marketCard', { title: `Šum ${i}`, text: 'drobná změna', effects: eff });
  }
  const meta = await c.meta();
  ok(meta.drivers.length <= 600 && meta.drivers.length >= 590, `meta.drivers capped at 600 (${meta.drivers.length})`);
  ok(meta.drivers[meta.drivers.length - 1].note === 'Šum 104', 'newest driver last');
  st = await c.get();
  ok(T.every((t) => st.drivers[t].length === 8 && st.drivers[t][0].note === 'Šum 104'), 'public drivers: last 8 per team, newest first');
  const t0 = Date.now();
  const big = await c.get();
  const ms = Date.now() - t0;
  const kb = Math.round(big._raw.length / 1024);
  info(`after 110 market cards: public GET ${kb} KB in ${ms} ms, meta ${Math.round(JSON.stringify(meta).length / 1024)} KB, history ${big.history.length}, flipped ${big.market.flipped.length}`);
  warnIf(kb < 150, `public GET stays small (${kb} KB)`);
  ok(ms < 1500, `public GET still fast (${ms} ms)`);
  checkClean('long game', big);

  section('written-off team in a later betting round');
  await c.dealer('nextBlock');
  ok((await c.dealer('exitSet', { outcomes: { [T[5]]: { kind: 'writeoff' }, [T[0]]: { kind: 'hold' } } })).ok, 'exit with a write-off in block 2');
  st = await c.get();
  ok(V(st, T[5]) === 0 && st.phase === 'final', 'team 6 at 0, phase final');
  const ph = await c.dealer('phase', { phase: 'betting' });
  info(`phase betting after the exit: ${ph.ok ? 'allowed' : ph.error}`);
  if (ph.ok) {
    const holder = S.find((s) => s.team !== T[5]);
    const m = await c.me(holder);
    checkClean('phone with a written-off stake', m);
    ok(m.me.stakes[T[5]] === 0, 'stake in the written-off team = 0');
    const r = await c.st(holder, 'submit', { out: { [T[5]]: { amt: 300000 } }, in: { [T[1] === holder.team ? T[2] : T[1]]: { amt: 300000 } } });
    ok(!r.ok, `withdrawing from a team at P = 0 refused (${r.error})`);
    const inn = await c.st(holder, 'submit', { out: { [Object.entries(m.me.stakes).filter(([t]) => t !== T[5]).sort((a, b) => b[1] - a[1])[0][0]]: { amt: m.me.rules.cashoutMax } }, in: { [T[5]]: { amt: m.me.rules.cashoutMax } } });
    ok(!inn.ok, `investing into a team at P = 0 refused (${inn.error})`);
    await c.dealer('phase', { phase: 'closed' });
    const sd = await c.dealer('showdown');
    info(`showdown after write-off: ${sd.ok ? 'n=' + sd.n : sd.error}`);
    checkClean('state after write-off showdown', await c.get(), await c.dget('?view=data'));
  }
  await invariants(c, ctx, 'limits');
  void sum;
});
