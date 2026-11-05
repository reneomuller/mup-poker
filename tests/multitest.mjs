// 18 students at once: register, notes, submit in parallel; showdown; reasons; restore of a forgotten phone.
const B = process.argv[2] || process.env.BASE || 'http://localhost:3077/api/game';
const post = async (b, h = {}) => (await fetch(B, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) })).json();
const get = async (h = {}, q = '') => (await fetch(B + q, { headers: h })).json();
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
await post({ op: 'reset', confirm: 'RESET', keepPlayers: false });
await post({ op: 'features', set: { demand: false } }); // v2 fixed-price expectations
let st = await get(); const T = st.teams.map((t) => t.id);
await post({ op: 'reg', open: true });
const S = await Promise.all(Array.from({ length: 18 }, (_, i) => post({ op: 'register', name: 'Student ' + (i + 1), team: T[i % 6], pin: '1234' }).then((r) => ({ ...r, team: T[i % 6] }))));
ok(S.every((r) => r.ok), 'all 18 registered in parallel');
st = await get(); ok(st.playerCount === 18, 'playerCount 18 (got ' + st.playerCount + ')');
const g = await post({ op: 'ghost', team: T[0] }); ok(g.ok, 'ghost created');
st = await get(); ok(st.playerCount === 18, 'ghost not counted');
await post({ op: 'phase', phase: 'betting' });
const subs = await Promise.all(S.map((s, i) => {
  const others = T.filter((t) => t !== s.team);
  // like a real phone: one request at a time per student, all 18 students at once
  return (async () => [
    await post({ op: 'notes', sid: s.sid, pin: '1234', notes: { [others[0]]: { like: 'L' + i, doubt: 'D' + i } } }),
    await post({ op: 'submit', sid: s.sid, pin: '1234', in: { [others[0]]: { amt: 600000 }, [others[1]]: { amt: 400000 } }, notes: { [others[0]]: { like: 'L' + i, doubt: 'D' + i } } }),
    await post({ op: 'notes', sid: s.sid, pin: '1234', notes: { [others[0]]: { like: 'L2' + i, doubt: 'D2' + i } } }),
  ])();
}));
ok(subs.every(([a, b, c]) => a.ok && b.ok && c.ok), 'all notes + submits + later notes ok, 18 students in parallel');
const gs = await post({ op: 'submit', sid: g.sid, pin: g.pin, in: { [T[1]]: { amt: 1000000 } } }); ok(gs.ok, 'ghost can invest');
st = await get(); ok(st.betCount === 18, 'betCount 18 (ghost excluded), got ' + st.betCount);
const sd = await post({ op: 'showdown' }); ok(sd.ok && sd.n === 18, 'showdown applied 18 (got ' + sd.n + ')');
st = await get(); const raised = st.teams.reduce((a, t) => a + t.cls, 0); ok(raised === 18000000, 'class raised exactly 18M (got ' + raised + ')');
const me = await get({ 'x-sid': S[3].sid, 'x-pin': '1234' }); ok(me.me && me.me.portfolio > 0 && me.me.slip.notes, 'student sees own portfolio + notes');
const rs = await Promise.all(S.map((s) => post({ op: 'reasons', sid: s.sid, pin: '1234', in: {} })));
ok(rs.every((r) => r.ok), 'reasons accepted for all');
const d = await get({}, '?view=dealer&all=1'); ok(Object.keys(d.dealer.all[1] || {}).filter((k) => k !== 'rj').length === 18, 'dealer export has all 18 slips, ghost excluded');
const lg = await get({}, '?view=log&limit=500'); ok(lg.log.filter((e) => e.op === 'submit').length >= 19, 'log has every submit (' + lg.log.filter((e) => e.op === 'submit').length + ')');
ok(!JSON.stringify(lg.log).includes('"pin"'), 'no PINs in log');
// a phone the server forgot puts itself back
const rr = await post({ op: 'restore', sid: 'lostphone1', pin: '4321', name: 'Ztracený Student', team: T[2], gid: 'oldgame', slips: {} });
ok(rr.ok, 'forgotten phone re-creates its account even from an old game id');
const me2 = await get({ 'x-sid': 'lostphone1', 'x-pin': '4321' }); ok(!!me2.me, 'restored account can play');
console.log(fails ? `${fails} FAILED` : 'ALL OK');
