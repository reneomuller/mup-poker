const B = process.env.BASE || 'http://localhost:3077/api/game';
const D = { 'content-type': 'application/json', 'x-dealer': 'mup-dealer' };
const post = async (body, h = { 'content-type': 'application/json' }) => (await fetch(B, { method: 'POST', headers: h, body: JSON.stringify(body) })).json();
const get = async (h = {}, q = '') => (await fetch(B + q, { headers: h })).json();
const dealer = (op, x = {}) => post({ op, ...x }, D);
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  ', m); };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// v2 fixed-price expectations: demand pricing (v3) off
await dealer('features', { set: { demand: false } });
let st = await get();
const teams = st.teams.map(t => t.id);
await dealer('teams', { teams: teams.map((id, i) => ({ id, name: ['Lumio', 'Parkly', 'Tutorix', 'GreenBox', 'Hrajsport', 'Vetly'][i] })) });
const students = [];
for (let i = 0; i < 18; i++) {
  const team = teams[i % 6], pin = String(1000 + i);
  const r = await post({ op: 'register', name: 'Student ' + (i + 1), team, pin });
  students.push({ sid: r.sid, pin, team });
}
assert((await post({ op: 'register', name: 'student 1', team: teams[0], pin: '1111' })).ok === false, 'duplicate name rejected');
assert((await post({ op: 'login', sid: students[0].sid, pin: '9999' })).ok === false, 'wrong PIN rejected');

// betting closed -> submit refused
const s0 = students[0];
const others = (team) => teams.filter(t => t !== team);
assert((await post({ op: 'submit', sid: s0.sid, pin: s0.pin, in: {} })).ok === false, 'submit refused before betting');

await dealer('phase', { phase: 'betting', minutes: 5 });
// invalid: own team
let r = await post({ op: 'submit', sid: s0.sid, pin: s0.pin, in: { [s0.team]: { amt: 1000000, why: 'my team' } } });
assert(r.ok === false && /vlastního/.test(r.error), 'own team refused: ' + r.error);
// invalid: missing reason
r = await post({ op: 'submit', sid: s0.sid, pin: s0.pin, in: { [others(s0.team)[0]]: { amt: 1000000, why: '' } } });
assert(r.ok === true, 'reason is optional');
// invalid: wrong total
r = await post({ op: 'submit', sid: s0.sid, pin: s0.pin, in: { [others(s0.team)[0]]: { amt: 900000, why: 'good team' } } });
assert(r.ok === false, 'wrong total refused: ' + r.error);
// invalid: out in block 1 ignored -> still must allocate 1M
// valid submissions
let rnd = 7;
const rand = () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280;
for (const s of students) {
  const o = others(s.team);
  let left = 1000000; const inn = {};
  o.forEach((t, k) => {
    const amt = k === o.length - 1 ? left : Math.round(rand() * left * 0.6 / 10000) * 10000;
    if (amt > 0) { inn[t] = { amt, why: 'protože ' + t }; left -= amt; }
  });
  r = await post({ op: 'submit', sid: s.sid, pin: s.pin, in: inn, notes: { [o[0]]: 'poznámka' } });
  if (!r.ok) console.log(r);
}
st = await get();
assert(st.betCount === 18, 'betCount 18, got ' + st.betCount);

// RJ allocation
r = await dealer('rjSave', { in: Object.fromEntries(teams.map((t, i) => [t, { amt: [3e6, 2e6, 2e6, 1e6, 1e6, 1e6][i], why: 'RJ view' }])) });
assert(r.ok, 'RJ saved');
st = await get();
assert(sum(Object.fromEntries(st.teams.map(t => [t.id, t.rj]))) === 0, 'RJ hidden before reveal');

await dealer('phase', { phase: 'closed' });
r = await dealer('showdown');
assert(r.ok && r.n === 18, 'showdown settled 18');
st = await get();
const cls = sum(Object.fromEntries(st.teams.map(t => [t.id, t.cls])));
assert(Math.abs(cls - 18e6) < 10, 'class money = 18M, got ' + cls);
assert(Math.abs(sum(Object.fromEntries(st.teams.map(t => [t.id, t.V]))) - (6 * st.startV + 18e6)) < 10, 'valuations = 6 × start + 18M (start ' + st.startV + ')');
r = await dealer('rjReveal');
assert(r.ok, 'RJ revealed');
st = await get();
assert(Math.abs(sum(Object.fromEntries(st.teams.map(t => [t.id, t.rj]))) - 10e6) < 10, 'RJ money = 10M');
assert(st.reveal.kind === 'rj', 'reveal kind rj');

// revalue: double team 1
const v1 = st.teams[0].V;
r = await dealer('revalue', { V: { [teams[0]]: v1 * 2 } });
assert(r.ok, 'revalue ok');
st = await get();
assert(Math.abs(st.teams[0].V - v1 * 2) < 2, 'team1 doubled');

// next block, rebalance
await dealer('nextBlock');
await dealer('phase', { phase: 'betting' });
const me = await get({ 'x-sid': students[1].sid, 'x-pin': students[1].pin });
assert(me.me.rules.mode === 'rebalance' && me.me.rules.cashoutMax === 300000, 'student rules: rebalance 300k');
const st1 = me.me.stakes;
const from = Object.keys(st1).find(t => st1[t] >= 200000);
const to = others(students[1].team).find(t => t !== from);
r = await post({ op: 'submit', sid: students[1].sid, pin: students[1].pin, out: { [from]: { amt: 400000, why: 'too much' } }, in: { [to]: { amt: 400000, why: 'better' } } });
assert(r.ok === false, 'cash-out over 300k refused: ' + r.error);
r = await post({ op: 'submit', sid: students[1].sid, pin: students[1].pin, out: { [from]: { amt: 200000, why: 'weak' } }, in: { [from]: { amt: 200000, why: 'same' } } });
assert(r.ok === false, 'same team out+in refused');
r = await post({ op: 'submit', sid: students[1].sid, pin: students[1].pin, out: { [from]: { amt: 200000, why: 'weak' } }, in: { [to]: { amt: 150000, why: 'better' } } });
assert(r.ok === false, 'unbalanced refused');
r = await post({ op: 'submit', sid: students[1].sid, pin: students[1].pin, out: { [from]: { amt: 300000, why: 'weak' } }, in: { [to]: { amt: 300000, why: 'better' } } });
assert(r.ok, 'valid rebalance');
const pvBefore = me.me.portfolio;
const rjInfo = await get(D, '?view=dealer');
assert(rjInfo.dealer.rj.rules.cashoutMax === Math.floor(rjInfo.dealer.rj.portfolio * 0.3 / 1000) * 1000, 'RJ cash-out 30%: ' + rjInfo.dealer.rj.rules.cashoutMax);
r = await dealer('showdown');
assert(r.ok && r.n === 1, 'block 2 showdown, 1 trade');
const me2 = await get({ 'x-sid': students[1].sid, 'x-pin': students[1].pin });
assert(Math.abs(me2.me.portfolio - pvBefore) < 2, 'portfolio value unchanged by trade at same prices');
// undo
r = await dealer('undo');
st = await get();
assert(r.ok && st.phase === 'betting', 'undo back to betting');
const all = await get(D, '?view=dealer&all=1');
assert(all.dealer.all[1] && Object.keys(all.dealer.all[1]).length === 19, 'export has block 1 slips (18 + RJ)');
assert(!JSON.stringify(all).includes('"pin"'), 'no PIN hashes leak');
const pub = await get();
assert(!JSON.stringify(pub).includes('"pin"'), 'no PIN hashes in public state');
console.log('calls', JSON.stringify(all.dealer.calls).slice(0, 300));
