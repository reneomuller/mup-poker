// Quiz + points: run state machine, scoring, views, refusals, ghosts, concurrency (18 answers + 6 card
// edits + a dealer op at the same moment), points ledger ops, awards and milestones.
//   BASE=http://localhost:3101/api/game node tests/a-quiz.mjs   (fresh server)
import { client, ok, done, sum, register, badNumbers } from './a-lib.mjs';

const c = client();
await c.dealer('reset', { confirm: 'RESET', keepPlayers: false });
let st = await c.get();
const T = st.teams.map((t) => t.id);
const S = await register(c, 18, T);
const g = await c.dealer('ghost', { team: T[0] });
const G = { sid: g.sid, pin: g.pin };

ok(st.quiz.state === 'idle' && st.quiz.idx === -1 && typeof st.quiz.serverNow === 'number', 'quiz idle at start, serverNow present');
ok(Math.abs(st.quiz.serverNow - Date.now()) < 5000 && st.now > 0, 'server clock returned');
const dv = await c.get('?view=dealer');
ok(dv.dealer.quizSets.length === 1 && dv.dealer.quizSets[0].id === 'blok2' && dv.dealer.quizSets[0].questions.length === 15, 'seed set blok2 with 15 questions');
ok(!JSON.stringify(st).includes('"correct"'), 'public state never has correct answers while idle');

// quiz sets: validation
let r = await c.dealer('quizSave', { set: { id: 'bad', title: 'X', questions: [{ q: 'Q?', a: ['jen jedna'], correct: 0, time: 10 }] } });
ok(!r.ok && /2 až 4/.test(r.error), 'set with one answer refused: ' + r.error);
r = await c.dealer('quizSave', { set: { id: 'bad', title: 'X', questions: [{ q: 'Q?', a: ['a', 'b'], correct: 2, time: 10 }] } });
ok(!r.ok, 'correct index out of range refused');
r = await c.dealer('quizSave', { set: { id: 'bad', title: 'X', questions: [{ q: 'x'.repeat(161), a: ['a', 'b'], correct: 0, time: 10 }] } });
ok(!r.ok, 'question over 160 chars refused');
r = await c.dealer('quizSave', { set: { id: 'bad', title: 'X', questions: [{ q: 'Q', a: ['a', 'b'], correct: 0, time: 3 }] } });
ok(!r.ok, 'time under 5 s refused');
r = await c.dealer('quizSave', { set: { id: 't1', title: 'Test', questions: [
  { q: 'První?', a: ['A', 'B', 'C', 'D'], correct: 1, time: 10 },
  { q: 'Druhá?', a: ['Ano', 'Ne'], correct: 0, time: 5 },
  { q: 'Třetí?', a: ['X', 'Y', 'Z'], correct: 2, time: 20 },
] } });
ok(r.ok && r.id === 't1', 'valid set saved');
r = await c.dealer('quizSave', { set: { id: 'tmp', title: 'Smazat', questions: [{ q: 'Q', a: ['a', 'b'], correct: 0, time: 10 }] } });
ok(r.ok && (await c.dealer('quizDelete', { id: 'tmp' })).ok, 'set saved and deleted');
ok((await c.get('?view=dealer')).dealer.quizSets.map((s) => s.id).join() === 'blok2,t1', 'sets: blok2, t1');

r = await c.spost({ op: 'quizAnswer', sid: S[0].sid, pin: S[0].pin, choice: 0 });
ok(!r.ok, 'answer refused when no question is open');
ok(!(await c.dealer('quizNext')).ok, 'quizNext refused before quizStart');

// start → board (lobby)
r = await c.dealer('quizStart', { setId: 't1' });
st = await c.get();
ok(r.ok && st.quiz.state === 'board' && st.quiz.idx === -1 && st.quiz.total === 3 && st.quiz.setTitle === 'Test' && Array.isArray(st.quiz.leaders) && st.quiz.leaders.length === 0, 'quizStart → board with empty leaders');
const seq0 = st.quiz.seq;
ok(!(await c.dealer('quizDelete', { id: 't1' })).ok, 'running set cannot be deleted');

// question 1
await c.dealer('quizNext');
st = await c.get();
ok(st.quiz.state === 'question' && st.quiz.idx === 0 && st.quiz.q === 'První?' && st.quiz.a.length === 4 && st.quiz.time === 10, 'question 1 open');
ok(st.quiz.seq > seq0 && st.quiz.endsAt - st.quiz.startedAt === 10000 && st.quiz.answered === 0, 'seq bumped, endsAt = startedAt + time, answered 0');
ok(!('correct' in st.quiz) && !JSON.stringify(st).includes('"correct"'), 'question state never shows the correct index');
const dq = (await c.get('?view=dealer')).dealer.quiz;
ok(dq.question.correct === 1 && dq.state === 'question', 'dealer sees the correct answer');

// concurrency: 18 answers + 6 card edits + a dealer op at once
const choices = S.map((_, i) => (i < 12 ? 1 : i % 4));
const work = [
  ...S.map((s, i) => c.spost({ op: 'quizAnswer', sid: s.sid, pin: s.pin, choice: choices[i], idx: 0 })),
  ...S.slice(0, 6).map((s, i) => c.spost({ op: 'card', sid: s.sid, pin: s.pin, oneLiner: 'One-liner týmu ' + i, sub: 'Popis ' + i })),
  c.dealer('timer', { minutes: 3, label: 'Kvíz' }),
  c.dealer('pointsAdd', { team: T[5], amt: 50, note: 'Souběh' }),
  c.spost({ op: 'quizAnswer', sid: G.sid, pin: G.pin, choice: 1 }),
];
const res = await Promise.all(work);
ok(res.every((x) => x.ok), 'all 18 answers, 6 card edits, dealer ops and ghost answer accepted: ' + JSON.stringify(res.filter((x) => !x.ok)));
st = await c.get();
ok(st.quiz.answered === 18, 'answered = 18 (ghost not counted), got ' + st.quiz.answered);
ok(T.every((t, i) => st.cards[t].oneLiner === 'One-liner týmu ' + i && st.cards[t].sub === 'Popis ' + i), 'all 6 card edits kept');
ok(st.timerLabel === 'Kvíz', 'concurrent dealer op kept');
const dup = await c.spost({ op: 'quizAnswer', sid: S[0].sid, pin: S[0].pin, choice: 2 });
ok(!dup.ok && dup.error === 'Odpověď už máš odeslanou.', 'second answer refused');
const parallelDup = await Promise.all([0, 1, 2].map((ch) => c.spost({ op: 'quizAnswer', sid: S[0].sid, pin: S[0].pin, choice: ch })));
ok(parallelDup.every((x) => !x.ok), 'parallel re-answers all refused');
const stale = await c.spost({ op: 'quizAnswer', sid: S[1].sid, pin: S[1].pin, choice: 1, idx: 5 });
ok(!stale.ok, 'answer for another question refused');
let m0 = await c.me(S[0]);
ok(m0.me.quiz.myChoice === 1 && m0.me.quiz.myCorrect === null, 'me.quiz.myChoice during question');
const dq2 = (await c.get('?view=dealer')).dealer.quiz;
ok(dq2.answered === 18 && dq2.answers.length === 19, 'dealer sees 18 answers + ghost');

// reveal + scoring
await c.dealer('quizReveal');
st = await c.get();
ok(st.quiz.state === 'reveal' && st.quiz.correct === 1 && st.quiz.answered === 18, 'reveal shows correct index');
const exp = [0, 0, 0, 0]; choices.forEach((ch) => exp[ch]++);
ok(JSON.stringify(st.quiz.counts) === JSON.stringify(exp), 'counts per answer ' + JSON.stringify(st.quiz.counts) + ' (ghost excluded)');
ok(st.quiz.fastest && st.quiz.fastest.ms >= 0 && S.slice(0, 12).some((s) => s.name === st.quiz.fastest.name) || st.quiz.counts[1] > 12, 'fastest correct answer named');
m0 = await c.me(S[0]);
ok(m0.me.quiz.myCorrect === true && m0.me.quiz.myPoints >= 500 && m0.me.quiz.myPoints <= 1000, 'correct student gets 500–1000 points: ' + m0.me.quiz.myPoints);
const wrong = S.findIndex((_, i) => choices[i] !== 1);
const mw = await c.me(S[wrong]);
ok(mw.me.quiz.myCorrect === false && mw.me.quiz.myPoints === 0, 'wrong answer → 0 points');
const mg = await c.me(G);
ok(mg.me.quiz.myPoints === 0 && mg.me.quiz.rank === null, 'ghost gets no points');
const dl = (await c.get('?view=dealer')).dealer.points.filter((e) => e.kind === 'quiz');
const nCorrect = choices.filter((ch) => ch === 1).length;
ok(dl.length === nCorrect && dl.every((e) => e.note === 'Kvíz: otázka 1'), `one ledger entry per correct student (${dl.length}/${nCorrect})`);
await c.dealer('quizReveal');
ok((await c.get('?view=dealer')).dealer.points.filter((e) => e.kind === 'quiz').length === nCorrect, 'reveal is idempotent');
ok(!(await c.spost({ op: 'quizAnswer', sid: S[17].sid, pin: S[17].pin, choice: 1 })).ok, 'answer refused after reveal');

// board
await c.dealer('quizBoard');
st = await c.get();
ok(st.quiz.state === 'board' && st.quiz.leaders.length === Math.min(10, nCorrect) && st.quiz.leaders.every((l) => l.quizPoints >= 500 && l.total >= l.quizPoints), 'board: top 10 with quizPoints and total');
ok(st.quiz.leaders.every((l, i, a) => i === 0 || a[i - 1].quizPoints >= l.quizPoints), 'board sorted');
m0 = await c.me(S[0]);
ok(m0.me.quiz.runPoints === m0.me.quiz.myPoints && m0.me.quiz.rank >= 1, 'me.quiz.runPoints and rank');

// question 2 (5 s): deadline
await c.dealer('quizNext');
st = await c.get();
ok(st.quiz.idx === 1 && st.quiz.a.length === 2, 'question 2 with 2 answers');
ok(!(await c.spost({ op: 'quizAnswer', sid: S[0].sid, pin: S[0].pin, choice: 3 })).ok, 'choice out of range refused');
ok((await c.spost({ op: 'quizAnswer', sid: S[0].sid, pin: S[0].pin, choice: 0 })).ok, 'answer in time ok');
await new Promise((res) => setTimeout(res, 6700));
r = await c.spost({ op: 'quizAnswer', sid: S[1].sid, pin: S[1].pin, choice: 0 });
ok(!r.ok && r.error === 'Čas vypršel.', 'answer after endsAt + 1.5 s refused: ' + r.error);
// skip reveal: next still scores the question
await c.dealer('quizNext');
const q2 = (await c.get('?view=dealer')).dealer.points.filter((e) => e.note === 'Kvíz: otázka 2');
ok(q2.length === 1 && q2[0].amt >= 500, 'unrevealed question scored when moving on');
await c.dealer('quizNext');
st = await c.get();
ok(st.quiz.state === 'done' && Array.isArray(st.quiz.leaders), 'quizNext after last question → done');
await c.dealer('quizEnd');
st = await c.get();
ok(st.quiz.state === 'idle', 'quizEnd on done → idle');

// points ledger
r = await c.dealer('pointsAdd', { playerId: S[2].sid, amt: 0, note: 'x' });
ok(!r.ok, 'zero points refused');
ok(!(await c.dealer('pointsAdd', { playerId: S[2].sid, amt: 6000 })).ok, 'over 5000 refused');
ok(!(await c.dealer('pointsAdd', { playerId: G.sid, amt: 100 })).ok, 'points to ghost refused');
r = await c.dealer('pointsAdd', { playerId: S[2].sid, amt: -200, note: 'Pozdě' });
ok(r.ok && r.n === 1, 'manual minus points');
r = await c.dealer('pointsAdd', { team: T[1], amt: 100, note: 'Týmová práce' });
ok(r.ok && r.n === 3, 'team points to 3 members (ghost excluded)');
const ledger = (await c.get('?view=dealer')).dealer.points;
const man = ledger.find((e) => e.note === 'Pozdě');
ok((await c.dealer('pointsRemove', { id: man.id })).ok && !(await c.get('?view=dealer')).dealer.points.some((e) => e.id === man.id), 'pointsRemove');
r = await c.dealer('award', { kind: 'analyst', playerId: S[4].sid, note: 'Nejlepší memo' });
ok(r.ok, 'award given');
let m4 = await c.me(S[4]);
ok(m4.me.points.recent[0].kind === 'award' && m4.me.points.recent[0].amt === 500, 'award adds 500 points');
ok(m4.me.track.awards.length === 1 && m4.me.track.awards[0].kind === 'analyst', 'award in me.track');
st = await c.get();
ok(st.awards.length === 1 && st.awards[0].name === S[4].name && st.awards[0].team === S[4].team && !('playerId' in st.awards[0]), 'public award without playerId');
await c.dealer('awardRemove', { id: r.id });
m4 = await c.me(S[4]);
ok(!m4.me.points.recent.some((e) => e.kind === 'award') && (await c.get()).awards.length === 0, 'awardRemove also removes its points');
r = await c.dealer('card', { team: T[2], milestones: { m1a: true, nope: true } });
let m2 = await c.me(S[2]);
ok(r.ok && (await c.get()).cards[T[2]].milestones.m1a === true && m2.me.points.recent[0].kind === 'milestone' && m2.me.points.recent[0].amt === 300, 'milestone adds 300 to each member');
await c.dealer('card', { team: T[2], milestones: { m1a: true } });
ok((await c.get('?view=dealer')).dealer.points.filter((e) => e.kind === 'milestone').length === 3, 'setting the same milestone again adds nothing');
await c.dealer('card', { team: T[2], milestones: { m1a: false } });
ok((await c.get('?view=dealer')).dealer.points.filter((e) => e.kind === 'milestone').length === 0, 'unsetting a milestone removes its points');

// public points view
st = await c.get();
const dealerLedger = (await c.get('?view=dealer')).dealer.points;
const tot = {};
for (const e of dealerLedger) tot[e.playerId] = (tot[e.playerId] || 0) + e.amt;
ok(st.points.leaders.length <= 10 && st.points.leaders.every((l) => tot[S.find((s) => s.name === l.name).sid] === l.total), 'points leaders match the ledger');
const t1 = S.filter((s) => s.team === T[1]).map((s) => tot[s.sid] || 0);
ok(st.points.teams[T[1]] === Math.round(sum(t1) / t1.length), 'team average per member');
m0 = await c.me(S[0]);
ok(m0.me.points.total === tot[S[0].sid] && m0.me.points.of === 18 && m0.me.points.rank >= 1 && m0.me.points.recent.length <= 8, 'me.points total, rank, of 18');

// data view
const data = await c.get('?view=data');
ok(data.points.length === dealerLedger.length && data.quizRuns.length === 3, 'data view: full ledger + 3 asked questions');
ok(Object.keys(data.quizRuns[0].answers).length === 18 && !(G.sid in data.quizRuns[0].answers) && data.quizRuns[0].answers[S[0].sid].choice === 1, 'data view: answers per sid, ghost excluded');

// feature off
await c.dealer('features', { set: { quiz: false, points: false } });
st = await c.get();
ok(st.features.quiz === false && st.quiz.state === 'idle' && !st.points, 'quiz/points off: idle quiz, no points');
ok((await c.dealer('quizStart', { setId: 't1' })).error === 'Tato funkce je vypnutá.', 'quizStart refused when off');
ok((await c.dealer('pointsAdd', { playerId: S[0].sid, amt: 5 })).error === 'Tato funkce je vypnutá.', 'pointsAdd refused when off');
await c.dealer('features', { set: { quiz: true, points: true } });
r = await c.dealer('quizStart', { setId: 'blok2' });
await c.dealer('quizNext');
st = await c.get();
ok(r.ok && st.quiz.total === 15 && st.quiz.q === 'Co znamená CAC?', 'seed set runs');
const all = await Promise.all(S.map((s) => c.spost({ op: 'quizAnswer', sid: s.sid, pin: s.pin, choice: 0 })));
await c.dealer('quizReveal');
st = await c.get();
ok(all.every((x) => x.ok) && st.quiz.counts[0] === 18 && st.quiz.fastest, 'all correct, fastest set');
ok(badNumbers(st).length === 0 && badNumbers(await c.me(S[0])).length === 0, 'no NaN in quiz views');
done('a-quiz');
