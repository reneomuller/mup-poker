// @self-managed: starts (and wipes) its own server on E_PORT in E_MODE storage (mem | pg | redis = mock Upstash + Postgres).
// 1. dump → wipe → restore round-trips every meta field, players, slips, content, board
// 2. undo reverts showdown, market card, tranche release, exit
// 3. redis mode: flush Redis mid-game (mid-quiz) and nothing is lost
// 4. phone silent restore after the server forgot everything
import { ok, info, canon, section, main, client, startServer, startMock, wipePg, sleep, sum, invariants, freshGame, initialSlip, rebalanceSlip, ALL_ON, MODE, MOCK_PORT } from './_e-lib.mjs';

const PORT = Number(process.env.E_PORT || 3106);
const TAG = 'tagE' + PORT;
let srv, mock, c;
const strip = (m) => { const { rev, auto, ...rest } = m || {}; void rev; void auto; return rest; };
const diffKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]));
async function boot() { srv = await startServer({ port: PORT, tag: TAG, mode: MODE }); c = client(srv.base); }
async function wipe() {
  await srv.stop();
  if (MODE === 'redis') await mock.flush();
  if (MODE !== 'mem') wipePg();
  await boot();
}

await main(async () => {
  if (MODE === 'redis') mock = await startMock(MOCK_PORT);
  if (MODE !== 'mem') wipePg();
  await boot();
  info(`storage ${(await c.get()).storage}`);

  // ---------- 1. dump / wipe / restore ----------
  section('dump → wipe → restore');
  let { T, S, G } = await freshGame(c, { n: 8, ghost: true, features: ALL_ON });
  await c.dealer('milestoneDefs', { defs: [{ key: 'm1a', label: 'Potvrzený problém a one-liner', block: 1 }, { key: 'x9', label: 'Vlastní milník', block: 2 }] });
  await c.dealer('content', { texts: { 'table.title': 'Stůl' } });
  await Promise.all(T.map((t, i) => c.st(S.find((s) => s.team === t), 'card', { oneLiner: `Karta ${i}`, sub: `Popis ${i}` })));
  await c.dealer('card', { team: T[0], milestones: { m1a: true } });
  await c.st(S[0], 'roundTerms', { pre: 1_200_000 });
  await c.dealer('phase', { phase: 'betting' });
  await Promise.all(S.map((s, i) => c.st(s, 'submit', initialSlip(T, s.team, i))));
  const q = await c.st(S[1], 'ask', { team: T[2], cat: 'market', text: 'Jaký je váš trh?' });
  await c.st(S[3], 'vote', { qid: q.id });
  await c.dealer('phase', { phase: 'closed' });
  await c.dealer('showdown');
  await c.dealer('rjSave', { in: { [T[1]]: { amt: 3e6, why: 'RJ' } } });
  await c.dealer('rjReveal');
  await c.dealer('trancheAdd', { team: T[2], amt: 1e6, cond: 'MVP', due: 'Blok 2' });
  await c.dealer('trancheAdd', { team: T[3], amt: 5e5, cond: 'Tým', due: 'Blok 3' });
  await c.dealer('trancheRelease', { id: (await c.get()).tranches[0].id });
  await c.dealer('revalue', { V: { [T[4]]: 1_500_000 }, why: { [T[4]]: 'Trakce' }, reason: { [T[4]]: 'traction' } });
  await c.dealer('marketCard', { title: 'Boom', text: 'Trh roste.', effects: { [T[5]]: 20 } });
  await c.dealer('award', { kind: 'analyst', playerId: S[2].sid, note: 'Analýza' });
  await c.dealer('pointsAdd', { team: T[3], amt: 50, note: 'Bonus' });
  await c.dealer('quizSave', { set: { id: 'r', title: 'R', questions: [{ q: 'Q?', a: ['A', 'B'], correct: 1, time: 30 }] } });
  await c.dealer('quizStart', { setId: 'r' });
  await c.dealer('quizNext');
  await Promise.all(S.map((s, i) => c.st(s, 'quizAnswer', { choice: i % 2 })));
  await c.dealer('quizReveal');
  await c.dealer('features', { set: { rounds: false } });
  const pub1 = await c.get();
  const D1 = await c.dump();
  const me1 = await c.me(S[0]);
  const fields = ['features', 'cards', 'milestoneDefs', 'drivers', 'rounds', 'market', 'tranches', 'rjPrincipal', 'lots', 'awards', 'points', 'quizSets', 'quiz', 'v2ArchivedAt'];
  ok(fields.filter((k) => k !== 'v2ArchivedAt').every((k) => D1.meta[k] !== undefined), `dump carries every new meta field (${fields.filter((k) => D1.meta[k] === undefined)} missing)`);
  await wipe();
  const blank = await c.get();
  ok(blank.playerCount === 0, 'server wiped (fresh game)');
  const rr = await c.dealer('restore', { dump: D1 });
  ok(rr.ok && rr.restored === true, `dealer restore accepted ${JSON.stringify({ ok: rr.ok, restored: rr.restored, error: rr.error })}`);
  if (rr.ok) {
  const D2 = await c.dump();
  const dk = diffKeys(strip(D1.meta), strip(D2.meta));
  ok(dk.length === 0, `every meta field round-trips (${dk.join(', ') || 'all equal'})`);
  ok(canon(D1.players) === canon(D2.players), 'players round-trip');
  ok(canon(D1.slips) === canon(D2.slips), 'slips round-trip');
  ok(canon(D1.board) === canon(D2.board), 'board round-trips');
  ok(JSON.stringify(D1.content?.texts) === JSON.stringify(D2.content?.texts), 'content round-trips');
  const pub2 = await c.get();
  const pick = (p) => JSON.stringify({ teams: p.teams, cards: p.cards, drivers: p.drivers, market: p.market, tranches: p.tranches, rjFund: p.rjFund, awards: p.awards, points: p.points, leaders: p.leaders, features: p.features, milestoneDefs: p.milestoneDefs, history: p.history });
  ok(pick(pub1) === pick(pub2), 'public state after restore = before the wipe');
  const me2 = await c.me(S[0]);
  ok(me2.me && JSON.stringify(me2.me.track) === JSON.stringify(me1.me.track) && JSON.stringify(me2.me.points) === JSON.stringify(me1.me.points), 'phone view (track, points) identical after restore, PIN works');
  ok((await c.dealer('features', { set: { rounds: true } })).ok && (await c.dealer('nextBlock')).ok, 'game continues after restore');
  }
  // reset is not a wipe: a stale dump of another game must not override it
  await c.dealer('reset', { confirm: 'RESET', keepPlayers: false });
  const rs = await c.dealer('restore', { dump: D1 });
  info(`restore after a dealer reset: ${JSON.stringify({ ok: rs.ok, restored: rs.restored, skipped: rs.skipped })}`);
  ok(rs.restored !== true && (await c.get()).playerCount === 0, 'after "Nová hra" an old dump does not resurrect the old game');

  // ---------- 2. undo ----------
  section('undo');
  ({ T, S, G } = await freshGame(c, { n: 6, ghost: true, features: ALL_ON }));
  await c.dealer('phase', { phase: 'betting' });
  await Promise.all(S.map((s, i) => c.st(s, 'submit', initialSlip(T, s.team, i))));
  await c.dealer('phase', { phase: 'closed' });
  const undoCheck = async (label, fn, keys = null) => {
    const m0 = await c.meta();
    const r = await fn();
    ok(r.ok, `${label} ok ${r.error || ''}`);
    const m1 = await c.meta();
    const u = await c.dealer('undo');
    const m2 = await c.meta();
    const changed = diffKeys(strip(m0), strip(m1));
    const left = diffKeys(strip(m0), strip(m2)).filter((k) => !keys || keys.includes(k));
    ok(u.ok && changed.length > 0 && left.length === 0, `undo reverts ${label} (changed: ${changed.join(', ')}; still different after undo: ${left.join(', ') || 'none'})`);
    return r;
  };
  await undoCheck('showdown', () => c.dealer('showdown'));
  ok((await c.dealer('showdown')).ok, 'showdown runs again after undo');
  await c.dealer('rjSave', { in: { [T[0]]: { amt: 4e6, why: 'x' } } });
  await undoCheck('rjReveal', () => c.dealer('rjReveal'));
  await c.dealer('rjReveal');
  await undoCheck('market card', () => c.dealer('marketCard', { title: 'Krach', text: 'x', effects: { [T[1]]: -30, [T[2]]: 50 } }));
  await c.dealer('trancheAdd', { team: T[3], amt: 1e6, cond: 'MVP', due: 'Blok 2' });
  const tid = (await c.get()).tranches[0].id;
  const f0 = (await c.get()).rjFund;
  await undoCheck('tranche release', () => c.dealer('trancheRelease', { id: tid }));
  const st = await c.get();
  ok(st.tranches[0].status === 'locked' && JSON.stringify(st.rjFund) === JSON.stringify(f0), 'tranche back to locked, rjFund back');
  await undoCheck('revalue', () => c.dealer('revalue', { V: { [T[4]]: 2e6 }, reason: { [T[4]]: 'team' } }));
  await undoCheck('exit', () => c.dealer('exitSet', { outcomes: { [T[0]]: { kind: 'ipo', multiple: 4 }, [T[1]]: { kind: 'writeoff' } } }));
  const afterExitUndo = await c.get();
  ok(afterExitUndo.phase !== 'final' && !afterExitUndo.exit && afterExitUndo.teams.every((t) => t.V > 0), 'after undoing the exit: no final phase, no exit view, no zero valuations');
  await undoCheck('nextBlock', () => c.dealer('nextBlock'));
  await invariants(c, { S, G }, 'after undos');

  // ---------- 3. Redis flush mid-game ----------
  if (MODE === 'redis') {
    section('flush Redis mid-game');
    ({ T, S, G } = await freshGame(c, { n: 18, ghost: true, features: ALL_ON }));
    await Promise.all(T.map((t, i) => c.st(S[i], 'card', { oneLiner: `Před flushem ${i}`, sub: '' })));
    await c.dealer('archive', { label: 'Před flushem' });
    await c.dealer('phase', { phase: 'betting' });
    await Promise.all(S.map((s, i) => c.st(s, 'submit', initialSlip(T, s.team, i))));
    await c.dealer('quizSave', { set: { id: 'fl', title: 'Flush', questions: [{ q: 'Q?', a: ['A', 'B', 'C'], correct: 2, time: 120 }] } });
    await c.dealer('quizStart', { setId: 'fl' });
    await c.dealer('quizNext');
    await Promise.all(S.slice(0, 9).map((s) => c.st(s, 'quizAnswer', { choice: 2 })));
    const p1 = await c.get(), d1 = await c.dump(), a1 = (await c.dget('?view=archives')).archives;
    await mock.flush();
    info('mock Redis flushed');
    const p2 = await c.get();
    ok(p2.playerCount === 18 && p2.betCount === 18 && p2.phase === 'betting', `state still there after the flush (${p2.playerCount} players, ${p2.betCount} slips, ${p2.phase})`);
    ok(JSON.stringify(p2.cards) === JSON.stringify(p1.cards) && p2.quiz?.state === 'question', 'cards and the live quiz question survive');
    const d2 = await c.dump();
    const mk = diffKeys(strip(d1.meta), strip(d2.meta));
    const pk = diffKeys(d1.players, d2.players), sk = Object.keys({ ...d1.slips, ...d2.slips }).filter((b) => canon(d1.slips[b]) !== canon(d2.slips[b]));
    ok(mk.length + pk.length + sk.length === 0, `meta, players, slips identical after the flush (meta: ${mk.map((k) => k + ' ' + JSON.stringify(d1.meta[k])?.slice(0, 80) + ' → ' + JSON.stringify(d2.meta[k])?.slice(0, 80))}; players: ${pk.length}; slips: ${sk} ${sk.map((b) => diffKeys(d1.slips[b], d2.slips[b]).map((id) => id + ':' + JSON.stringify(d1.slips[b]?.[id])?.slice(0, 120) + ' → ' + JSON.stringify(d2.slips[b]?.[id])?.slice(0, 120)).slice(0, 2))})`);
    const a2 = (await c.dget('?view=archives')).archives || [];
    ok(a2.length === a1.length, `archives still listed (${a2.length}/${a1.length})`);
    const dbl = await c.st(S[0], 'quizAnswer', { choice: 0 });
    ok(!dbl.ok, `answer given before the flush still blocks a second answer (${dbl.error || 'accepted!'})`);
    const rest = await Promise.all(S.slice(9).map((s) => c.st(s, 'quizAnswer', { choice: 1 })));
    ok(rest.every((r) => r.ok), 'remaining 9 answers accepted after the flush');
    await c.dealer('quizReveal');
    const p3 = await c.get();
    ok(sum(p3.quiz.counts) === 18 && p3.quiz.counts[2] === 9, `all 18 answers counted, 9 from before the flush (${p3.quiz.counts})`);
    const m = await c.meta();
    ok(m.points.filter((e) => e.kind === 'quiz').length === 9, '9 correct answers scored');
    await c.dealer('phase', { phase: 'closed' });
    const sd = await c.dealer('showdown');
    ok(sd.ok && sd.n === 18, 'showdown with 18 slips after the flush');
    await mock.flush();
    ok((await c.dealer('nextBlock')).ok, 'nextBlock after a second flush');
    const a3 = (await c.dget('?view=archives')).archives || [];
    ok(a3.some((x) => x.label === 'Před blokem 2') && a3.some((x) => x.label === 'Před flushem'), `old and new archives listed (${a3.map((x) => x.label).join(', ')})`);
    const mes = await Promise.all(S.map((s) => c.me(s)));
    ok(mes.every((x) => x.me && x.me.portfolio > 0), 'every phone still logged in with its portfolio');
    await c.dealer('phase', { phase: 'betting' });
    const rb = await Promise.all(S.map((s, i) => c.st(s, 'submit', rebalanceSlip(T, s.team, mes[i].me.stakes, i))));
    ok(rb.every((r) => r.ok), 'block 2 submits after the flushes');
    await invariants(c, { S, G }, 'after flushes');
  }

  // ---------- 4. phone silent restore ----------
  section('phone silent restore after the server forgot everything');
  ({ T, S, G } = await freshGame(c, { n: 4, ghost: false }));
  const gid = (await c.get()).gid;
  await c.dealer('phase', { phase: 'betting' });
  const x = S[1];
  const slip = initialSlip(T, x.team, 5, 1e6, 'phone');
  ok((await c.st(x, 'submit', slip)).ok, 'phone submits with notes');
  const local = (await c.me(x)).me.slip;
  const Dd = await c.dump();
  await wipe();
  const lost = await c.me(x);
  ok(!lost.me && lost.meError, `wiped server does not know the phone (${lost.meError})`);
  const r = await c.post({ op: 'restore', sid: x.sid, pin: x.pin, name: x.name, team: x.team, gid, slips: { 1: local } });
  ok(r.ok && r.sid === x.sid, 'restore op with profile + slips accepted');
  const back = await c.me(x);
  ok(back.me && back.me.name === x.name && back.me.team === x.team, 'account back with the same name and team');
  ok(back.me?.slip?.submitted && JSON.stringify(back.me.slip.in) === JSON.stringify(local.in) && JSON.stringify(back.me.slip.notes) === JSON.stringify(local.notes), 'slip with reasons and notes back');
  const dr = await c.dealer('restore', { dump: Dd });
  ok(dr.ok && dr.restored === true, 'dealer laptop restores the rest ' + (dr.error || ''));
  if (dr.ok) {
  const after = await c.get();
  ok(after.playerCount === 4 && after.gid === gid, 'all 4 players and the game id back');
  const back2 = await c.me(x);
  ok(JSON.stringify(back2.me?.slip?.in) === JSON.stringify(local.in), 'phone slip still intact after the dealer restore');
  ok((await c.post({ op: 'login', sid: S[2].sid, pin: S[2].pin })).ok, 'other students log in again');
  }
  info(`mode ${MODE}: wipe = ${MODE === 'mem' ? 'process restart' : MODE === 'pg' ? 'drop tables + restart' : 'flush Redis + drop tables + restart'}`);
  await srv.stop();
  if (mock) await mock.stop();
});
