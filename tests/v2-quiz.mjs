// Quiz (spec §10b): set validation, a full run with 18 concurrent answers, double/late answers, scoring formula,
// no leak of the correct index while a question is live, idempotent reveal, leaderboards, meState, GET cost.
import fs from 'node:fs';
import path from 'node:path';
import { ok, warnIf, info, section, main, client, sleep, sum, shape, checkClean, invariants, freshGame, quizScore, answerAll, ledgerTotal, findKey, mockStats, mockResetStats, MOCK_URL, ROOT } from './_e-lib.mjs';

const c = client();
const leak = (label, resps) => {
  const hits = resps.flatMap((r) => findKey(r, 'correct'));
  const mc = resps.filter((r) => r?.me?.quiz && r.me.quiz.myCorrect !== null && r.me.quiz.myCorrect !== undefined);
  return ok(hits.length === 0 && mc.length === 0, `${label}: correct index never in a response while the question is live${hits.length ? ' → ' + hits.slice(0, 3) : ''}${mc.length ? ' → myCorrect set' : ''}`);
};
// wait until the server clock passes endsAt + extra (uses serverNow to cancel clock skew)
async function waitServer(q, extra) {
  const skew = q.serverNow - Date.now();
  const target = q.endsAt + extra - skew;
  while (Date.now() < target) await sleep(Math.min(200, target - Date.now() + 5));
}

await main(async () => {
  const { T, S, G } = await freshGame(c, { n: 18, ghost: true });
  const ctx = { S, G };
  section('seed + quizSave validation');
  let meta = await c.meta();
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/quiz-blok2.json'), 'utf8'));
  const bl = (meta.quizSets || []).find((x) => x.id === 'blok2');
  ok(bl && bl.title === 'Blok 2 – slovník' && bl.questions.length === seed.length && JSON.stringify(bl.questions.map((q) => [q.q, q.a, q.correct, q.time])) === JSON.stringify(seed.map((q) => [q.q, q.a, q.correct, q.time])), 'seed set blok2 = docs/quiz-blok2.json');
  const base = { id: 'qz', title: 'Test kvíz', questions: [{ q: 'Co je MRR?', a: ['Měsíční opakované tržby', 'Marže', 'Cena', 'Churn'], correct: 0, time: 20 }] };
  const bad = [
    ['question > 160 chars', { ...base, questions: [{ ...base.questions[0], q: 'x'.repeat(161) }] }],
    ['answer > 80 chars', { ...base, questions: [{ ...base.questions[0], a: ['a'.repeat(81), 'b', 'c', 'd'] }] }],
    ['1 answer', { ...base, questions: [{ ...base.questions[0], a: ['jen jedna'], correct: 0 }] }],
    ['5 answers', { ...base, questions: [{ ...base.questions[0], a: ['a', 'b', 'c', 'd', 'e'] }] }],
    ['correct out of range', { ...base, questions: [{ ...base.questions[0], a: ['a', 'b', 'c'], correct: 3 }] }],
    ['time 4 s', { ...base, questions: [{ ...base.questions[0], time: 4 }] }],
    ['time 121 s', { ...base, questions: [{ ...base.questions[0], time: 121 }] }],
  ];
  for (const [nm, set] of bad) {
    const r = await c.dealer('quizSave', { set });
    const m2 = await c.meta();
    const stored = (m2.quizSets || []).find((x) => x.id === 'qz');
    ok(!r.ok || (stored && stored.questions.every((q) => q.q.length <= 160 && q.a.length >= 2 && q.a.length <= 4 && q.a.every((a) => a.length <= 80) && q.correct >= 0 && q.correct < q.a.length && q.time >= 5 && q.time <= 120)), `quizSave rejects/cleans: ${nm} (${r.ok ? 'accepted+cleaned' : r.error})`);
  }
  const QZ = { id: 'qz', title: 'Test kvíz', questions: [
    { q: 'Co je MRR?', a: ['Marže', 'Cena', 'Měsíční opakované tržby', 'Churn'], correct: 2, time: 20 },
    { q: 'Rychlá otázka?', a: ['Ano', 'Ne', 'Možná'], correct: 1, time: 5 },
    { q: 'Je LTV > CAC dobře?', a: ['Ano', 'Ne'], correct: 0, time: 10 },
  ] };
  ok((await c.dealer('quizSave', { set: { ...QZ, title: 'Starý název' } })).ok, 'quizSave valid set');
  ok((await c.dealer('quizSave', { set: QZ })).ok, 'quizSave again replaces by id');
  meta = await c.meta();
  ok(meta.quizSets.filter((x) => x.id === 'qz').length === 1 && meta.quizSets.find((x) => x.id === 'qz').title === 'Test kvíz', 'one set per id, replaced');
  await c.dealer('quizSave', { set: { id: 'tmp', title: 'Smazat', questions: base.questions } });
  ok((await c.dealer('quizDelete', { id: 'tmp' })).ok && !(await c.meta()).quizSets.some((x) => x.id === 'tmp'), 'quizDelete');

  section('run: lobby');
  let st = await c.get();
  shape('quiz (idle)', st.quiz, { state: 'string', seq: 'number', setTitle: 'string|null', idx: 'number', total: 'number', serverNow: 'number' });
  ok(!(await c.st(S[0], 'quizAnswer', { choice: 0 })).ok, 'answer refused while no quiz runs');
  ok((await c.dealer('quizStart', { setId: 'qz' })).ok, 'quizStart');
  st = await c.get();
  const seqs = [st.quiz.seq];
  ok(st.quiz.state === 'board' && st.quiz.idx === -1 && st.quiz.total === 3 && st.quiz.setTitle === 'Test kvíz', 'quizStart → board, idx −1, total 3');
  ok(Array.isArray(st.quiz.leaders), 'board state has leaders');
  ok(Math.abs(st.quiz.serverNow - Date.now()) < 5000, 'serverNow ≈ now');
  const runId0 = (await c.meta()).quiz?.runId;
  ok(typeof runId0 === 'string' || typeof runId0 === 'number', 'meta.quiz.runId set');
  ok(!(await c.st(S[0], 'quizAnswer', { choice: 0 })).ok, 'answer refused in board state');

  section('question 1: 15 answers at once');
  ok((await c.dealer('quizNext')).ok, 'quizNext');
  st = await c.get();
  seqs.push(st.quiz.seq);
  shape('quiz (question)', st.quiz, { state: 'string', seq: 'number', setTitle: 'string', idx: 'number', total: 'number', serverNow: 'number', q: 'string', a: 'array', time: 'number', startedAt: 'number', endsAt: 'number', answered: 'number', expected: 'number' }, { strict: true });
  ok(st.quiz.state === 'question' && st.quiz.idx === 0 && st.quiz.q === QZ.questions[0].q && st.quiz.a.length === 4 && st.quiz.time === 20, 'question 0 live');
  ok(st.quiz.endsAt - st.quiz.startedAt === 20000, 'endsAt = startedAt + time');
  const gA = await c.st(G, 'quizAnswer', { choice: 2 }); // ghost answers first and right: must never be "fastest" or score
  const choice0 = (i) => (i < 9 ? 2 : i < 15 ? (i % 2 ? 0 : 3) : null);
  const answering = S.filter((s, i) => choice0(i) !== null);
  const ans = await answerAll(c, answering, (s) => choice0(S.indexOf(s)));
  ok(ans.every((r) => r.ok), `15 concurrent answers accepted ${ans.filter((r) => !r.ok).map((r) => r.error).slice(0, 2)}`);
  leak('answer responses', [...ans, gA]);
  const dbl = await c.st(S[0], 'quizAnswer', { choice: 1 });
  ok(!dbl.ok && dbl.error === 'Odpověď už máš odeslanou.', `double answer refused: „${dbl.error}“`);
  await sleep(800);
  st = await c.get();
  ok(st.quiz.answered >= 15 && st.quiz.answered <= 16, `answered counter = 15 (${st.quiz.answered}; 16 if the ghost is counted)`);
  warnIf(st.quiz.answered === 15, 'ghost answer counted in quiz.answered');
  const mesQ = await Promise.all(S.map((s) => c.me(s)));
  leak('public + 18 phones', [st, ...mesQ, await c.me(G)]);
  shape('me.quiz (question)', mesQ[0].me?.quiz, { myChoice: 'number|null', myCorrect: 'null|boolean', myPoints: 'number|null', myBonus: 'number', streak: 'number', runPoints: 'number', rank: 'number|null' }, { strict: true });
  ok(mesQ.every((m, i) => m.me.quiz.myChoice === choice0(i)), 'myChoice = the answer sent (first answer kept after a double)');
  checkClean('quiz question state', st, ...mesQ);

  section('reveal 1');
  ok((await c.dealer('quizReveal')).ok, 'quizReveal');
  st = await c.get();
  seqs.push(st.quiz.seq);
  shape('quiz (reveal)', st.quiz, { state: 'string', seq: 'number', setTitle: 'string', idx: 'number', total: 'number', serverNow: 'number', q: 'string', a: 'array', correct: 'number', counts: 'array', answered: 'number', fastest: 'object|null', topStreak: 'object|null' }, { strict: true });
  const counts = st.quiz.counts || [];
  const expCounts = [0, 0, 0, 0];
  S.forEach((s, i) => { if (choice0(i) !== null) expCounts[choice0(i)]++; });
  ok(st.quiz.correct === 2, 'correct index revealed');
  ok(counts.length === 4 && (JSON.stringify(counts) === JSON.stringify(expCounts) || JSON.stringify(counts) === JSON.stringify(expCounts.map((n, i) => n + (i === 2 ? 1 : 0)))), `counts per answer ${JSON.stringify(counts)} = ${JSON.stringify(expCounts)}`);
  warnIf(JSON.stringify(counts) === JSON.stringify(expCounts), 'ghost answer counted in quiz.counts');
  const data = await c.dget('?view=data');
  const run0 = (data.quizRuns || []).find((r) => r.idx === 0 && r.setId === 'qz');
  ok(run0 && Object.keys(run0.answers).filter((k) => k !== G.sid).length === 15, 'data.quizRuns has all 15 answers for question 1 (none lost)');
  if (run0) shape('quizRuns[]', run0, { runId: 'string|number', setId: 'string', idx: 'number', answers: 'object' }, { strict: true });
  meta = await c.meta();
  const qe = (meta.points || []).filter((e) => e.kind === 'quiz' && e.note === 'Kvíz: otázka 1');
  ok(qe.length === 9, `9 ledger entries for 9 correct students (${qe.length})`);
  if (qe[0]) shape('points entry', qe[0], { id: 'string', ts: 'number', block: 'number', playerId: 'string', amt: 'number', kind: 'string', note: 'string', run: 'string', qi: 'number', base: 'number', bonus: 'number' }, { strict: true });
  ok(qe.every((e) => e.bonus === 0 && e.base === e.amt) && st.quiz.topStreak === null, 'first question: no streak bonus, no topStreak');
  const scoreOk = S.slice(0, 9).every((s) => { const a = run0?.answers?.[s.sid]; const e = qe.find((x) => x.playerId === s.sid); return a && e && e.amt === quizScore(a.ms, 20) && e.amt >= 500 && e.amt <= 1000; });
  ok(scoreOk, 'score = round(1000 × (1 − 0.5 × ms / (time × 1000))), clamped 500…1000');
  ok(!qe.some((e) => e.playerId === G.sid), 'ghost scores nothing');
  // answers are timed in whole ms, so concurrent answers can tie: any student at the minimum counts as fastest
  const ms0 = (s) => run0?.answers?.[s.sid]?.ms ?? 1e9;
  const minMs0 = Math.min(...S.slice(0, 9).map(ms0));
  const tied0 = S.slice(0, 9).filter((s) => ms0(s) === minMs0);
  ok(st.quiz.fastest && tied0.some((s) => s.name === st.quiz.fastest.name && s.team === st.quiz.fastest.team) && typeof st.quiz.fastest.ms === 'number', `fastest correct = one of ${tied0.map((s) => s.name).join('/')} (not the ghost): ${JSON.stringify(st.quiz.fastest)}`);
  const mesR = await Promise.all(S.map((s) => c.me(s)));
  ok(mesR.every((m, i) => m.me.quiz.myCorrect === (choice0(i) === null ? (m.me.quiz.myCorrect === null ? null : false) : choice0(i) === 2)), 'myCorrect true/false at reveal');
  ok(mesR.every((m, i) => m.me.quiz.myPoints === (i < 9 ? qe.find((e) => e.playerId === S[i].sid)?.amt : 0) || (i >= 15 && m.me.quiz.myPoints === null)), 'myPoints = points of this question (0 for wrong)');
  ok(mesR.every((m, i) => m.me.quiz.runPoints === (i < 9 ? qe.find((e) => e.playerId === S[i].sid)?.amt : 0)), 'runPoints after question 1');
  const ledger1 = JSON.stringify(meta.points);
  ok((await c.dealer('quizReveal')).ok !== undefined, 'second quizReveal answered');
  ok(JSON.stringify((await c.meta()).points) === ledger1, 'quizReveal is idempotent (ledger unchanged)');

  section('board');
  ok((await c.dealer('quizBoard')).ok, 'quizBoard');
  st = await c.get();
  seqs.push(st.quiz.seq);
  ok(st.quiz.state === 'board', 'state board');
  const L = st.quiz.leaders || [];
  if (L[0]) shape('quiz.leaders[0]', L[0], { name: 'string', team: 'string', quizPoints: 'number', total: 'number' }, { strict: true });
  ok(L.length >= 9 && L.length <= 10 && L.every((x, i) => i === 0 || L[i - 1].quizPoints >= x.quizPoints), `quiz leaders sorted, ≤ 10 (${L.length})`);
  ok(L.slice(0, 9).every((x) => qe.some((e) => S.find((s) => s.sid === e.playerId).name === x.name && e.amt === x.quizPoints)), 'leaders quizPoints = this run');
  ok(!L.some((x) => x.name === 'Ghost'), 'ghost not on the quiz board');
  const mranks = await Promise.all(S.map((s) => c.me(s)));
  ok(mranks.every((a) => mranks.every((b) => !(a.me.quiz.runPoints > b.me.quiz.runPoints) || a.me.quiz.rank < b.me.quiz.rank)), 'meState.quiz.rank follows runPoints');

  section('question 2: late answers (time 5 s)');
  await c.dealer('quizNext');
  st = await c.get();
  seqs.push(st.quiz.seq);
  ok(st.quiz.idx === 1 && st.quiz.time === 5 && st.quiz.a.length === 3, 'question 2 live (3 answers)');
  ok((await c.st(S[0], 'quizAnswer', { choice: 1 })).ok, 'fast answer');
  ok(!(await c.st(S[3], 'quizAnswer', { choice: 3 })).ok, 'choice index outside the 3 answers refused');
  await waitServer(st.quiz, 400);
  const grace = await c.st(S[2], 'quizAnswer', { choice: 1 });
  ok(grace.ok, `answer 0.4 s after endsAt accepted (1.5 s grace) ${grace.error || ''}`);
  await waitServer(st.quiz, 1700);
  const late = await c.st(S[1], 'quizAnswer', { choice: 1 });
  ok(!late.ok && late.error === 'Čas vypršel.', `answer 1.7 s after endsAt refused: „${late.error}“`);
  await c.dealer('quizReveal');
  meta = await c.meta();
  const d2 = (await c.dget('?view=data')).quizRuns.find((r) => r.idx === 1 && r.setId === 'qz' && r.runId === runId0);
  const q2e = (s) => meta.points.find((e) => e.kind === 'quiz' && e.run === runId0 && e.qi === 1 && e.playerId === s.sid);
  const e0 = q2e(S[0]), e2 = q2e(S[2]);
  // S0 and S2 were right on question 1 too: 2nd correct answer in a row → +50
  ok(e0 && e0.base === quizScore(d2.answers[S[0].sid].ms, 5) && e0.base > 900 && e0.bonus === 50 && e0.amt === e0.base + 50, `fast answer scores ${e0?.base} + streak 50`);
  ok(e2 && e2.base === 500 && e2.amt === 550, `answer after the time limit is clamped to 500 (+50 streak) (${e2?.amt}, ms ${d2?.answers?.[S[2].sid]?.ms})`);
  ok(e0?.note === 'Kvíz: otázka 2 · série 2 (+50)', `streak note: „${e0?.note}“`);
  ok(!q2e(S[1]), 'refused late answer scores nothing');
  st = await c.get();
  ok(st.quiz.topStreak && st.quiz.topStreak.streak === 2 && [S[0].name, S[2].name].includes(st.quiz.topStreak.name), 'reveal 2: topStreak ' + JSON.stringify(st.quiz.topStreak));
  const me2 = await Promise.all([S[0], S[1], S[2]].map((s) => c.me(s)));
  ok(me2[0].me.quiz.streak === 2 && me2[0].me.quiz.myBonus === 50 && me2[1].me.quiz.streak === 0 && me2[1].me.quiz.myBonus === 0, 'me.quiz.streak / myBonus after question 2');

  section('question 3: speed matters');
  await c.dealer('quizBoard');
  await c.dealer('quizNext');
  const waveA = S.slice(0, 9), waveB = S.slice(9);
  const ra = await answerAll(c, waveA, () => 0);
  await sleep(2000);
  const rb = await answerAll(c, waveB, () => 0);
  ok([...ra, ...rb].every((r) => r.ok), '18 answers in two waves');
  await c.dealer('quizReveal');
  meta = await c.meta();
  const q3 = meta.points.filter((e) => e.kind === 'quiz' && e.run === runId0 && e.qi === 2);
  const p3 = (s) => q3.find((e) => e.playerId === s.sid)?.base || 0;
  ok(Math.min(...waveA.map(p3)) > Math.max(...waveB.map(p3)), `every fast answer beats every answer 2 s later (${Math.min(...waveA.map(p3))} > ${Math.max(...waveB.map(p3))})`);
  ok(q3.length === 18, '18 entries, none lost');
  // streak into question 3: S0, S2 right on 1–3 (+100); S1 refused on 2 and S3–S8 silent on 2 (reset → +0); S9+ wrong on 1 (+0)
  ok(q3.every((e) => e.bonus === ([S[0].sid, S[2].sid].includes(e.playerId) ? 100 : 0) && e.amt === e.base + e.bonus), 'question 3: +100 for 3 in a row, reset after a wrong / missing answer');

  section('done, end, restart');
  await c.dealer('quizNext');
  st = await c.get();
  seqs.push(st.quiz.seq);
  ok(st.quiz.state === 'done' && Array.isArray(st.quiz.leaders), 'quizNext after the last question → done with leaders');
  ok(seqs.every((x, i) => i === 0 || x > seqs[i - 1]), `seq increases on every state change (${seqs})`);
  const runPts = (s) => ledgerTotal({ points: meta.points.filter((e) => e.kind === 'quiz') }, s.sid);
  const mDone = await Promise.all(S.map((s) => c.me(s)));
  ok(mDone.every((m, i) => m.me.quiz.runPoints === runPts(S[i])), 'runPoints = Σ this run');
  ok(st.quiz.leaders.every((l) => { const s = S.find((x) => x.name === l.name); return l.quizPoints === runPts(s) && l.total === ledgerTotal(meta, s.sid); }), 'done leaders: quizPoints (run) and total (all points)');
  const qend = await c.dealer('quizEnd');
  const qst = (await c.get()).quiz.state;
  ok(qend.ok && ['done', 'idle'].includes(qst), `quizEnd on a finished run → done/idle (${qst})`);
  warnIf(qst === 'done', 'quizEnd pressed when already done switches to idle (spec: quizEnd → done; idle only on the next quizStart)');
  ok(!(await c.st(S[17], 'quizAnswer', { choice: 0 })).ok, 'answers refused after the end');
  shape('me.points', mDone[0].me.points, { total: 'number', rank: 'number', of: 'number', recent: 'array' }, { strict: true });
  ok(mDone.every((m, i) => m.me.points.total === ledgerTotal(meta, S[i].sid) && m.me.points.of === 18 && m.me.points.recent.length <= 8 && m.me.points.recent.every((e) => e.playerId === undefined || e.playerId === S[i].sid)), 'me.points: total, of 18, ≤ 8 recent entries');
  ok((await c.dealer('quizStart', { setId: 'qz' })).ok, 'quizStart a second run');
  const run2 = (await c.meta()).quiz;
  ok(run2.runId !== runId0 && run2.idx === -1 && run2.state === 'board', 'new runId, idx −1');
  const m2 = await c.me(S[0]);
  ok(m2.me.quiz.runPoints === 0, 'runPoints restart at 0 for a new run');
  ok((await c.get()).points.leaders[0].total > 0, 'overall points keep adding up across runs');

  if (MOCK_URL) {
    section('GET cost in Redis mode');
    await c.dealer('quizEnd');
    await c.dealer('quizStart', { setId: 'qz' });
    const cost = async () => { await sleep(800); await mockResetStats(); await c.get(); return (await mockStats()).total; };
    const costMe = async () => { await sleep(800); await mockResetStats(); await c.me(S[0]); return (await mockStats()).total; };
    const idle = await cost(), idleMe = await costMe();
    await c.dealer('quizNext');
    await answerAll(c, S, () => 0);
    const live = await cost(), liveMe = await costMe();
    info(`Redis commands per GET: idle ${idle}, question ${live}; with me: idle ${idleMe}, question ${liveMe}`);
    ok(live - idle <= 1 && liveMe - idleMe <= 1, `quiz adds ≤ 1 Redis command per GET (${idle}→${live}, me ${idleMe}→${liveMe})`);
  }
  await invariants(c, ctx, 'after quiz');
});
