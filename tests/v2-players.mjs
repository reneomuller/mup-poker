// Player management in a v2 game: late joiners (first investment = 1M in block 2), movePlayer, resetPin,
// removePlayer, a ghost created mid-game, and how cards/points/track follow the player.
import { ok, section, main, client, sum, sumAmt, invariants, freshGame, initialSlip, rebalanceSlip, ALL_ON, ledgerTotal } from './_e-lib.mjs';

const c = client();
await main(async () => {
  const { T, S } = await freshGame(c, { n: 6, ghost: false, features: { ...ALL_ON, demand: false } });
  await c.dealer('phase', { phase: 'betting' });
  await Promise.all(S.map((s, i) => c.st(s, 'submit', initialSlip(T, s.team, i))));
  await c.dealer('phase', { phase: 'closed' });
  await c.dealer('showdown');
  await c.dealer('nextBlock');

  section('late joiner');
  const lj = await c.post({ op: 'register', name: 'Pozdní Příchozí', team: T[2], pin: '7777' });
  ok(lj.ok, 'register in block 2');
  const L = { sid: lj.sid, pin: '7777', team: T[2], name: 'Pozdní Příchozí' };
  const all = [...S, L];
  await c.dealer('phase', { phase: 'betting' });
  const ml = await c.me(L);
  ok(ml.me.rules.mode === 'initial' && ml.me.rules.capital === 1e6, 'late joiner: first investment of 1 000 000');
  ok(ml.me.track && ml.me.track.value === 0 || ml.me.track?.value === undefined || ml.me.track.returnPct === 0 || Number.isFinite(ml.me.track.returnPct), 'late joiner track has no NaN before investing');
  const mes = await Promise.all(S.map((s) => c.me(s)));
  const slips = S.map((s, i) => rebalanceSlip(T, s.team, mes[i].me.stakes, i));
  const r = await Promise.all([...S.map((s, i) => c.st(s, 'submit', slips[i])), c.st(L, 'submit', initialSlip(T, L.team, 3, 1e6, 'late'))]);
  ok(r.every((x) => x.ok), 'rebalances + late first investment accepted ' + (r.find((x) => !x.ok)?.error || ''));
  const before = await c.get();
  await c.dealer('phase', { phase: 'closed' });
  const sd = await c.dealer('showdown');
  ok(sd.ok && sd.n === 7, 'showdown n=7');
  const st = await c.get();
  const lateIn = initialSlip(T, L.team, 3, 1e6, 'late').in;
  const exp = {};
  for (const sl of [...slips, { in: lateIn, out: {} }]) {
    for (const [t, e] of Object.entries(sl.in)) exp[t] = (exp[t] || 0) + e.amt;
    for (const [t, e] of Object.entries(sl.out || {})) exp[t] = (exp[t] || 0) - e.amt;
  }
  ok(T.every((t) => Math.abs((st.reveal.delta[t] || 0) - (exp[t] || 0)) <= 1), 'class money = Σ in − out incl. the late 1M');
  ok(Math.abs(sum(st.teams.map((t) => t.cls)) - sum(before.teams.map((t) => t.cls)) - 1e6) <= 3, 'class money grew by exactly the late 1M');
  const mL = await c.me(L);
  ok(mL.me.track.of === 7 && mL.me.track.start === 1e6 && Math.abs(mL.me.track.value - mL.me.portfolio) <= 1, 'late joiner ranked among 7');
  await invariants(c, { S: all, G: null }, 'late joiner');

  section('movePlayer');
  ok((await c.dealer('movePlayer', { sid: S[0].sid, team: T[3] })).ok, 'movePlayer S1 → team 4');
  const m0 = await c.me(S[0]);
  ok(m0.me.team === T[3], 'phone shows the new team');
  ok((await c.st(S[0], 'card', { oneLiner: 'Nový tým', sub: '' })).ok && (await c.get()).cards[T[3]].oneLiner === 'Nový tým', 'moved player edits the new team’s card');
  const pb = await c.meta();
  await c.dealer('pointsAdd', { team: T[3], amt: 20, note: 'nový tým' });
  ok(ledgerTotal(await c.meta(), S[0].sid) - ledgerTotal(pb, S[0].sid) === 20, 'team points reach the moved player');
  await c.dealer('nextBlock');
  await c.dealer('phase', { phase: 'betting' });
  const m0b = await c.me(S[0]);
  const into3 = await c.st(S[0], 'submit', { out: { [Object.entries(m0b.me.stakes).sort((a, b) => b[1] - a[1])[0][0]]: { amt: 300000 } }, in: { [T[3]]: { amt: 300000 } } });
  ok(!into3.ok && /vlastního/.test(into3.error || ''), 'cannot invest into the new own team');

  section('resetPin, removePlayer, ghost mid-game');
  ok((await c.dealer('resetPin', { sid: S[1].sid })).ok, 'resetPin');
  ok((await c.post({ op: 'login', sid: S[1].sid, pin: '9911' })).ok, 'first login after reset sets the new PIN');
  ok(!(await c.post({ op: 'login', sid: S[1].sid, pin: S[1].pin })).ok, 'old PIN no longer works');
  ok(!!(await c.me({ sid: S[1].sid, pin: '9911' })).me, 'GET me with the new PIN');
  ok(!(await c.dealer('removePlayer', { sid: S[2].sid })).ok, 'player with holdings cannot be removed');
  const tmp = await c.post({ op: 'register', name: 'Omylem Registrovaný', team: T[4], pin: '1212' });
  ok((await c.dealer('removePlayer', { sid: tmp.sid })).ok, 'fresh registrant removed');
  const rr = await c.post({ op: 'restore', sid: tmp.sid, pin: '1212', name: 'Omylem Registrovaný', team: T[4], gid: (await c.get()).gid, slips: {} });
  ok(!rr.ok && rr.relogin, 'removed player cannot silently restore');
  const g = await c.dealer('ghost', { team: T[5] });
  const G = { sid: g.sid, pin: g.pin, team: T[5] };
  const gm = await c.me(G);
  ok(gm.me?.ghost === true && gm.me.rules.mode === 'initial', 'mid-game ghost logs in, sees an initial slip');
  ok((await c.st(G, 'submit', initialSlip(T, G.team, 1))).ok, 'ghost submits');
  ok((await c.get()).betCount === 0, 'ghost slip not counted in betCount');
  ok(!(await c.st(G, 'card', { oneLiner: 'ghost', sub: '' })).ok, 'ghost cannot edit a card');
  await invariants(c, { S: all, G }, 'after player ops');
  void sumAmt;
});
