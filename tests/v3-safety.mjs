// @self-managed: starts its own server on E_PORT.
// Client-sent keys never resolve to Object.prototype, and `restore` only brings back what the server lost
// (no edits after betting closed, no invalid slips such as a 5 000 000 $ buy).
import { ok, section, main, client, startServer, wipePg, startMock, freshGame, initialSlip, MODE, MOCK_PORT } from './_e-lib.mjs';

const PORT = Number(process.env.E_PORT || 3106);

await main(async () => {
  let mock = null;
  if (MODE === 'redis') mock = await startMock(MOCK_PORT);
  if (MODE !== 'mem') wipePg();
  const srv = await startServer({ port: PORT, tag: 'tagV3S' + PORT, mode: MODE });
  const c = client(srv.base);
  const { T, S } = await freshGame(c, { n: 4, ghost: false });
  const [A, B] = S;

  section('prototype keys');
  for (const sid of ['__proto__', 'toString', 'constructor']) {
    ok(!(await c.post({ op: 'restore', sid, pin: '1234', name: 'Evil', team: T[0] })).ok, `restore with sid "${sid}" refused`);
    ok(!(await c.post({ op: 'submit', sid, pin: '1234', in: {}, out: {} })).ok, `student op with sid "${sid}" refused`);
    ok(!(await c.dealer('resetPin', { sid })).ok && !(await c.dealer('movePlayer', { sid, team: T[1] })).ok, `dealer resetPin/movePlayer with sid "${sid}" refused`);
    ok(!(await c.dealer('loginLink', { sid })).ok, `loginLink with sid "${sid}" refused`);
    const g = await c.get('', { 'x-sid': sid, 'x-pin': '1234' });
    ok(g && g.teams && !g.me, `GET with x-sid "${sid}" gives no me`);
    ok((await c.dget(`?as=${encodeURIComponent(sid)}`)).me === undefined, `dealer preview ?as=${sid} gives no me`);
  }
  const d0 = await c.dump();
  ok(Object.keys(d0.players).length === 4 && !Object.keys(d0.players).some((k) => k in Object.prototype), 'players unchanged, no prototype keys stored');
  const fresh = await c.post({ op: 'register', name: 'Po útoku', team: T[2], pin: '4321' });
  ok(fresh.ok, 'server still healthy: a normal registration works after the attempts');

  section('reasons with a prototype key');
  await c.dealer('phase', { phase: 'betting' });
  const slA = initialSlip(T, A.team, 1, 1_000_000, 'a-');
  ok((await c.st(A, 'submit', slA)).ok, 'A submits a valid slip');
  const r = await c.st(A, 'reasons', { in: { __proto__: 'x', [Object.keys(slA.in)[0]]: 'Dobrý tým' } });
  ok(r.ok !== false, 'reasons with a __proto__ key does not crash');
  const slipA = (await c.dump()).slips[1][A.sid];
  ok(!Object.hasOwn(slipA.in, '__proto__') && slipA.in[Object.keys(slA.in)[0]].why === 'Dobrý tým', 'only own reason keys are written');

  section('restore brings back only what the server lost');
  const before = JSON.stringify((await c.dump()).slips[1][A.sid]);
  const bigIn = { [T.find((t) => t !== A.team)]: { amt: 5_000_000 } };
  await c.st(A, 'restore', { gid: (await c.meta()).gid, slips: { 1: { in: bigIn, out: {}, submitted: true, ts: Date.now() + 5000 } } });
  ok(JSON.stringify((await c.dump()).slips[1][A.sid]) === before, 'during betting an invalid 5M slip cannot replace a valid one');
  await c.st(B, 'restore', { gid: (await c.meta()).gid, slips: { 1: { in: bigIn, out: {}, submitted: true, ts: Date.now() } } });
  ok(!(await c.dump()).slips[1]?.[B.sid]?.submitted, 'a lost slip that fails the submit checks is not brought back');
  const slB = initialSlip(T, B.team, 2, 1_000_000, 'b-');
  await c.st(B, 'restore', { gid: (await c.meta()).gid, slips: { 1: { ...slB, submitted: true, ts: Date.now() } } });
  ok((await c.dump()).slips[1]?.[B.sid]?.submitted === true, 'a valid lost slip is brought back');
  await c.dealer('phase', { phase: 'closed' });
  const closed = JSON.stringify((await c.dump()).slips[1][A.sid]);
  const other = initialSlip(T, A.team, 3, 1_000_000, 'c-');
  await c.st(A, 'restore', { gid: (await c.meta()).gid, slips: { 1: { ...other, submitted: true, ts: Date.now() + 9000 } } });
  ok(JSON.stringify((await c.dump()).slips[1][A.sid]) === closed, 'after betting closed a restore cannot change a slip the server has');
  const sd = await c.dealer('showdown');
  ok(sd.ok && sd.n === 2, `showdown counts the 2 valid slips (${sd.n})`);

  await srv.stop();
  if (mock) await mock.stop?.();
});
