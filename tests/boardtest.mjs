const B = process.argv[2] || process.env.BASE || 'http://localhost:3077/api/game';
const post = async (b) => (await fetch(B, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const get = async (h = {}, q = '') => (await fetch(B + q, { headers: h })).json();
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
await post({ op: 'reset', confirm: 'RESET', keepPlayers: false });
let st = await get(); const T = st.teams.map((t) => t.id);
const S = []; for (let i = 0; i < 6; i++) S.push({ ...(await post({ op: 'register', name: 'Board ' + i, team: T[i], pin: '1234' })), team: T[i] });
const me = (i) => get({ 'x-sid': S[i].sid, 'x-pin': '1234' });
// block 1: everyone invests 1M into the next team
await post({ op: 'phase', phase: 'betting' });
for (let i = 0; i < 6; i++) await post({ op: 'submit', sid: S[i].sid, pin: '1234', in: { [T[(i + 1) % 6]]: { amt: 1000000 } } });
await post({ op: 'phase', phase: 'closed' }); await post({ op: 'showdown' }); await post({ op: 'nextBlock' });
// 300k rule
await post({ op: 'phase', phase: 'betting' });
let m = await me(0); ok(m.me.rules.exact === true && m.me.rules.cashoutMax === 300000, 'student must move exactly 300k');
let r = await post({ op: 'submit', sid: S[0].sid, pin: '1234', out: { [T[1]]: { amt: 100000 } }, in: { [T[2]]: { amt: 100000 } } });
ok(!r.ok && /přesně/.test(r.error), 'moving only 100k is refused: ' + r.error);
r = await post({ op: 'submit', sid: S[0].sid, pin: '1234', out: {}, in: {} }); ok(!r.ok, 'sitting out is refused');
r = await post({ op: 'submit', sid: S[0].sid, pin: '1234', out: { [T[1]]: { amt: 300000 } }, in: { [T[2]]: { amt: 200000 }, [T[3]]: { amt: 100000 } } });
ok(r.ok, 'moving exactly 300k works');
// board
r = await post({ op: 'ask', sid: S[0].sid, pin: '1234', team: T[0], cat: 'market', text: 'Kolik zákazníků máte?' }); ok(!r.ok, 'cannot ask own team');
const q1 = await post({ op: 'ask', sid: S[0].sid, pin: '1234', team: T[1], cat: 'market', text: 'Odkud máte číslo pro SOM?' });
const q2 = await post({ op: 'ask', sid: S[0].sid, pin: '1234', team: T[1], cat: 'competition', text: 'Komu dnes zákazník platí?' });
await post({ op: 'ask', sid: S[0].sid, pin: '1234', team: T[2], cat: 'problem', text: 'Jak často ten problém nastává?' });
r = await post({ op: 'ask', sid: S[0].sid, pin: '1234', team: T[3], cat: 'problem', text: 'Čtvrtá otázka v jednom bloku?' }); ok(!r.ok && /nejvýš 3/.test(r.error), 'max 3 questions per block');
r = await post({ op: 'vote', sid: S[0].sid, pin: '1234', qid: q1.id }); ok(!r.ok, 'cannot vote own question');
r = await post({ op: 'vote', sid: S[1].sid, pin: '1234', qid: q1.id }); ok(!r.ok, 'team cannot vote on questions to itself');
for (const i of [2, 3, 4]) await post({ op: 'vote', sid: S[i].sid, pin: '1234', qid: q1.id });
await post({ op: 'vote', sid: S[2].sid, pin: '1234', qid: q2.id });
r = await post({ op: 'vote', sid: S[2].sid, pin: '1234', qid: q2.id }); ok(r.ok && r.voted === false, 'second click removes the vote');
st = await get(); const b1 = st.board.find((q) => q.id === q1.id);
ok(b1 && b1.votes === 3 && !('by' in b1), 'public board: 3 votes, asker hidden');
ok(st.board[0].id === q1.id, 'board sorted by votes');
r = await post({ op: 'answer', sid: S[2].sid, pin: '1234', qid: q1.id, text: 'x' }); ok(!r.ok, 'other team cannot answer');
r = await post({ op: 'answer', sid: S[1].sid, pin: '1234', qid: q1.id, text: 'Z ČSÚ: 4 200 ordinací v Praze.' }); ok(r.ok, 'team answers');
r = await post({ op: 'react', sid: S[3].sid, pin: '1234', qid: q1.id, v: 'yes' }); ok(r.ok, 'student reacts convinced');
await post({ op: 'react', sid: S[4].sid, pin: '1234', qid: q1.id, v: 'no' });
st = await get(); const b2 = st.board.find((q) => q.id === q1.id); ok(b2.answer && b2.yes === 1 && b2.no === 1, 'answer + reactions visible');
m = await me(0); ok(m.me.board.asked === 3 && m.me.board.mine.length === 3, 'my board counters');
m = await me(2); ok(m.me.board.votesUsed === 1 && m.me.board.voted.includes(q1.id), 'my votes tracked');
// ghost questions are private
const g = await post({ op: 'ghost', team: T[5] });
await post({ op: 'ask', sid: g.sid, pin: g.pin, team: T[1], cat: 'problem', text: 'Testovací otázka od ghosta?' });
st = await get(); ok(!st.board.some((q) => /ghosta/.test(q.text)), 'ghost question hidden from class');
m = await get({ 'x-sid': g.sid, 'x-pin': g.pin }); ok(m.me.board.extra.some((q) => /ghosta/.test(q.text)), 'ghost still sees its own question');
// dealer pin + hide
await post({ op: 'qpin', qid: q1.id }); st = await get(); ok(st.qpin && st.qpin.id === q1.id, 'question pinned to the table');
const d = await get({}, '?view=dealer'); ok(d.dealer.board.find((q) => q.id === q1.id).by === 'Board 0', 'dealer sees who asked');
await post({ op: 'qhide', qid: q1.id, hidden: true }); st = await get(); ok(!st.board.some((q) => q.id === q1.id) && !st.qpin, 'hidden question gone and unpinned');
console.log(fails ? `${fails} FAILED` : 'ALL OK');
