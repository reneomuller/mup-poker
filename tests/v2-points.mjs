// Points ledger (spec §10b, §9): pointsAdd for a player and a team, range checks, pointsRemove,
// award +500, milestone +300 per member, ghosts get nothing, public and personal views.
import { ok, warnIf, section, main, client, shape, checkClean, invariants, freshGame, ledgerTotal } from './_e-lib.mjs';

const c = client();
await main(async () => {
  const { T, S, G } = await freshGame(c, { n: 18, ghost: true });
  const ctx = { S, G };
  const members = (t) => S.filter((s) => s.team === t);
  section('pointsAdd / pointsRemove');
  let r = await c.dealer('pointsAdd', { playerId: S[0].sid, amt: 250, note: 'Aktivita v diskusi' });
  ok(r.ok, 'pointsAdd to a player');
  let meta = await c.meta();
  let e = meta.points.find((x) => x.playerId === S[0].sid && x.note === 'Aktivita v diskusi');
  ok(e && e.amt === 250 && e.kind === 'manual' && e.block === 1 && typeof e.id === 'string' && typeof e.ts === 'number', 'ledger entry: amt, kind manual, block, id, ts');
  ok((await c.dealer('pointsAdd', { playerId: S[1].sid, amt: 100, note: 'Kvíz na papíře', kind: 'quiz' })).ok, 'pointsAdd with kind');
  meta = await c.meta();
  ok(meta.points.some((x) => x.playerId === S[1].sid && x.kind === 'quiz' && x.amt === 100), 'optional kind kept');
  for (const [amt, nm] of [[0, '0'], [5001, '5001'], [-5001, '−5001'], ['abc', 'text']]) {
    const rr = await c.dealer('pointsAdd', { playerId: S[2].sid, amt, note: 'x' });
    ok(!rr.ok, `pointsAdd amt ${nm} refused`);
  }
  ok((await c.dealer('pointsAdd', { playerId: S[2].sid, amt: -5000, note: 'Penalizace' })).ok && (await c.dealer('pointsAdd', { playerId: S[2].sid, amt: 5000, note: 'Max' })).ok, 'amt −5000 and 5000 accepted');
  ok(!(await c.dealer('pointsAdd', { playerId: 'nobody', amt: 10, note: 'x' })).ok, 'unknown player refused');
  const before = await c.meta();
  r = await c.dealer('pointsAdd', { team: T[1], amt: 40, note: 'Týmový bonus' });
  ok(r.ok, 'pointsAdd to a team');
  meta = await c.meta();
  ok(members(T[1]).every((s) => ledgerTotal(meta, s.sid) - ledgerTotal(before, s.sid) === 40), 'every non-ghost member of the team +40');
  ok(ledgerTotal(meta, G.sid) === 0, 'ghost in that team gets nothing');
  const gr = await c.dealer('pointsAdd', { playerId: G.sid, amt: 300, note: 'ghost' });
  meta = await c.meta();
  ok(ledgerTotal(meta, G.sid) === 0, `pointsAdd to the ghost has no effect (${gr.ok ? 'accepted, ignored' : 'refused'})`);
  const rem = meta.points.find((x) => x.note === 'Aktivita v diskusi');
  ok((await c.dealer('pointsRemove', { id: rem.id })).ok, 'pointsRemove');
  meta = await c.meta();
  ok(!meta.points.some((x) => x.id === rem.id) && ledgerTotal(meta, S[0].sid) === 0, 'entry gone, total back to 0');
  ok(!(await c.dealer('pointsRemove', { id: 'nope' })).ok, 'pointsRemove of an unknown id refused');

  section('award +500, milestone +300');
  const b2 = await c.meta();
  ok((await c.dealer('award', { kind: 'analyst', playerId: S[4].sid, note: 'Nejlepší analýza' })).ok, 'award analyst');
  meta = await c.meta();
  ok(ledgerTotal(meta, S[4].sid) - ledgerTotal(b2, S[4].sid) === 500 && meta.points.some((x) => x.playerId === S[4].sid && x.kind === 'award' && x.amt === 500), 'award adds 500 (kind award)');
  const ga = await c.dealer('award', { kind: 'custom', playerId: G.sid, note: 'Ghost award' });
  meta = await c.meta();
  const pub = await c.get();
  ok(ledgerTotal(meta, G.sid) === 0 && !(pub.awards || []).some((a) => a.name === 'Ghost'), `ghost award: no points, not public (${ga.ok ? 'accepted' : 'refused'})`);
  ok(!(await c.dealer('award', { kind: 'nonsense', playerId: S[4].sid, note: 'x' })).ok, 'unknown award kind refused');
  const b3 = await c.meta();
  ok((await c.dealer('card', { team: T[1], milestones: { m1a: true } })).ok, 'milestone m1a for the ghost’s team');
  meta = await c.meta();
  ok(members(T[1]).every((s) => ledgerTotal(meta, s.sid) - ledgerTotal(b3, s.sid) === 300) && meta.points.filter((x) => x.kind === 'milestone').length === members(T[1]).length, '+300 per non-ghost member (kind milestone)');
  ok(ledgerTotal(meta, G.sid) === 0, 'ghost gets no milestone points');
  await c.dealer('card', { team: T[1], milestones: { m1a: true } });
  ok((await c.meta()).points.filter((x) => x.kind === 'milestone').length === members(T[1]).length, 'setting the same milestone again adds nothing');
  await c.dealer('card', { team: T[1], milestones: { m1a: false } });
  ok((await c.get()).cards[T[1]].milestones.m1a !== true, 'milestone can be unset');

  section('views');
  const st = await c.get();
  meta = await c.meta();
  checkClean('public state', st);
  shape('points', st.points, { leaders: 'array', teams: 'object' }, { strict: true });
  const L = st.points.leaders;
  ok(L.length <= 10 && L.every((x, i) => i === 0 || L[i - 1].total >= x.total), 'points leaders: ≤ 10, sorted');
  if (L[0]) shape('points.leaders[0]', L[0], { name: 'string', team: 'string', total: 'number' }, { strict: true });
  ok(L.every((l) => ledgerTotal(meta, S.find((s) => s.name === l.name)?.sid) === l.total), 'leaders total = ledger');
  ok(!L.some((l) => l.name === 'Ghost'), 'ghost not in points leaders');
  const avgOk = T.every((t) => { const m = members(t); const avg = m.reduce((a, s) => a + ledgerTotal(meta, s.sid), 0) / m.length; return Math.abs((st.points.teams[t] ?? NaN) - avg) <= 0.51; });
  ok(avgOk, `points.teams = average per non-ghost member ${JSON.stringify(st.points.teams)}`);
  const mes = await Promise.all(S.map((s) => c.me(s)));
  ok(mes.every((m, i) => m.me.points.total === ledgerTotal(meta, S[i].sid) && m.me.points.of === 18), 'me.points.total and of');
  const tot = mes.map((m) => m.me.points.total);
  ok(mes.every((m) => m.me.points.rank >= 1 + tot.filter((x) => x > m.me.points.total).length && m.me.points.rank <= tot.filter((x) => x >= m.me.points.total).length), 'me.points.rank = position by total');
  for (let i = 0; i < 10; i++) await c.dealer('pointsAdd', { playerId: S[7].sid, amt: i + 1, note: 'série ' + i });
  const m7 = await c.me(S[7]);
  ok(m7.me.points.recent.length === 8 && m7.me.points.recent.every((x) => x.amt >= 3), 'recent = last 8 entries');
  warnIf(m7.me.points.recent[0].amt === 10, 'recent is newest first');
  const gm = await c.me(G);
  ok(!gm.me.points || gm.me.points.total === 0, 'ghost me.points total 0');
  const data = await c.dget('?view=data');
  ok(Array.isArray(data.points) && data.points.length === meta.points.length + 10, 'data view has the full ledger');
  await invariants(c, ctx, 'points');
});
