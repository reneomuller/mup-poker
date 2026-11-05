// @self-managed: starts (and wipes) its own server on E_PORT in E_MODE storage, with DEALER_LOCK=1 so the dealer header matters.
// v4 quizplus: per-question `why` (only at reveal, never leaking the answer early), double points, https image
// validation, 2- and 3-answer questions, the lobby ready counter, best streak, the dealer-only results export
// (?view=quizrun) and the flag switched off (= v3 behaviour).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ok, info, section, main, client, startServer, startMock, freshGame, quizScore, answerAll, findKey, MODE, MOCK_PORT, PG_URL, ROOT } from './_e-lib.mjs';

const PORT = Number(process.env.E_PORT || 3351);
const TAG = 'tagE' + PORT;
let srv, c;
const dbName = PG_URL.split('/').pop().split('?')[0];
async function wipeDb() {
  if (MODE === 'mem') return;
  try {
    const { default: pg } = await import('pg');
    const cl = new pg.Client({ connectionString: PG_URL });
    await cl.connect();
    try { await cl.query('drop table if exists mup_kv, mup_h, mup_log'); } finally { await cl.end(); }
  } catch {
    execSync(`PGPASSWORD=pw psql -q -h localhost -U postgres -d ${dbName} -c 'drop table if exists mup_kv, mup_h, mup_log'`, { stdio: 'pipe' });
  }
}
const WHY1 = 'Post-money = pre-money + investice. TAJNE-PROC-1';
const WHY2 = 'Pravda: tohle je vysvětlení TAJNE-PROC-2';
const IMG = 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg';
const QP = { id: 'qp', title: 'Kvíz plus', questions: [
  { q: 'Pre-money 8 + investice 2. Kolik % má investor?', a: ['10 %', '20 %', '25 %', '80 %'], correct: 1, time: 20, why: WHY1, double: true, img: IMG },
  { q: 'Runway se měří v měsících.', a: ['Pravda', 'Nepravda'], correct: 0, time: 20, why: WHY2 },
  { q: 'Tři možnosti?', a: ['X', 'Y', 'Z'], correct: 2, time: 20 },
] };
const leakWhy = (rs) => rs.filter((r) => JSON.stringify(r).includes('TAJNE-PROC') || findKey(r, 'why').length || findKey(r, 'correct').length).length;

await main(async () => {
  let mock;
  if (MODE === 'redis') {
    let up = false;
    try { await fetch(`http://localhost:${MOCK_PORT}/__stats`); up = true; } catch {}
    if (!up) mock = await startMock(MOCK_PORT);
  }
  await wipeDb();
  srv = await startServer({ port: PORT, tag: TAG, mode: MODE, env: { DEALER_LOCK: '1', DEALER_PASSWORD: 'mup-dealer' } });
  c = client(srv.base);
  info(`storage ${(await c.get()).storage}`);
  const { S, G } = await freshGame(c, { n: 18, ghost: true });
  ok(S.length === 18 && G?.sid, 'fresh game with 18 students and a ghost');

  section('flag + seed explanations');
  let st = await c.get();
  ok(st.features?.quizplus === true, 'feature quizplus is on by default');
  let meta = await c.meta();
  const seedJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/quiz-blok2.json'), 'utf8'));
  const bl = meta.quizSets.find((s) => s.id === 'blok2');
  ok(bl.questions.length === 15 && bl.questions.every((q) => typeof q.why === 'string' && q.why.length >= 40 && q.why.length <= 240), 'all 15 seeded questions have a 40–240 char explanation');
  ok(bl.questions.every((q, i) => q.why === seedJson[i].why), 'seed explanations = docs/quiz-blok2.json');

  section('quizSave: why / double / img validation');
  const base = QP.questions[0];
  const bad = [
    ['why > 240', { ...base, why: 'x'.repeat(241) }],
    ['img http://', { ...base, img: 'http://example.com/a.png' }],
    ['img javascript:', { ...base, img: 'javascript:alert(1)' }],
    ['img data:', { ...base, img: 'data:image/png;base64,AAAA' }],
    ['img with a quote', { ...base, img: 'https://example.com/a".png' }],
    ['img with a space', { ...base, img: 'https://example.com/a b.png' }],
    ['img relative', { ...base, img: '/img/a.png' }],
    ['img > 500 chars', { ...base, img: 'https://example.com/' + 'a'.repeat(490) }],
  ];
  for (const [nm, q] of bad) {
    const r = await c.dealer('quizSave', { set: { id: 'bad', title: 'Špatně', questions: [q] } });
    ok(!r.ok && /otázky 1/.test(r.error || ''), `refused: ${nm} („${r.error}“)`);
  }
  ok(!(await c.dealer('quizSave', { set: { id: 'bad', title: 'X', questions: [{ ...base, a: ['Jen jedna'], correct: 0 }] } })).ok, '1 answer still refused');
  const sv = await c.dealer('quizSave', { set: QP });
  ok(sv.ok, `valid set with why, double, img, a 2-answer and a 3-answer question saved ${sv.error || ''}`);
  meta = await c.meta();
  const stored = meta.quizSets.find((s) => s.id === 'qp');
  ok(stored.questions[0].why === WHY1 && stored.questions[0].double === true && stored.questions[0].img === IMG, 'why, double and img stored');
  ok(!('why' in stored.questions[2]) && !('double' in stored.questions[2]) && !('img' in stored.questions[2]), 'empty extras are not stored');
  ok(stored.questions[1].a.length === 2 && stored.questions[2].a.length === 3, '2- and 3-answer questions kept');
  await c.dealer('quizSave', { set: { id: 'nb', title: 'Nbsp', questions: [{ q: 'Q?', a: ['a', 'b'], correct: 0, time: 10, why: 'Jde o nbsp  a\nmezery.' }] } });
  ok((await c.meta()).quizSets.find((s) => s.id === 'nb').questions[0].why === 'Jde o nbsp a mezery.', 'why: whitespace collapsed, nbsp kept');
  await c.dealer('quizDelete', { id: 'nb' });

  section('lobby: ready counter, ×2 announced');
  ok((await c.dealer('quizStart', { setId: 'qp' })).ok, 'quizStart');
  st = await c.get();
  ok(st.quiz.state === 'board' && st.quiz.idx === -1 && st.quiz.nextDouble === true, 'lobby announces that question 1 is ×2 (nextDouble)');
  ok(!('ready' in st.quiz), 'plain GET carries no ready counter (no extra read)');
  let rv = await c.get('?view=quizready');
  ok(rv.ok && rv.lobby === true && rv.ready === 0 && rv.expected === 18, `quizready view: 0 / 18 (${JSON.stringify(rv)})`);
  const rr = await Promise.all([...S.slice(0, 5), G].map((s) => c.st(s, 'quizReady')));
  ok(rr.every((r) => r.ok && r.lobby === true), 'quizReady accepted from 5 phones + ghost');
  await c.st(S[0], 'quizReady');
  rv = await c.get('?view=quizready');
  ok(rv.ready === 5 && rv.expected === 18, `ready 5 / 18 (ghost not counted, repeat ping counted once): ${rv.ready}`);
  ok(!(await c.post({ op: 'quizReady', sid: S[0].sid, pin: '0000' })).ok, 'quizReady with a wrong PIN refused');

  section('question 1 (×2, image): nothing leaks');
  await c.dealer('quizNext');
  st = await c.get();
  ok(st.quiz.state === 'question' && st.quiz.double === true && st.quiz.img === IMG, 'question view: double + img');
  ok(!('why' in st.quiz) && !('correct' in st.quiz) && !('nextDouble' in st.quiz), 'question view: no why, no correct');
  ok((await c.st(S[0], 'quizReady')).lobby === false, 'quizReady outside the lobby is a harmless no-op');
  ok((await c.get('?view=quizready')).lobby === false, 'quizready view off outside the lobby');
  const choice1 = (i) => (i < 6 ? 1 : i < 12 ? 0 : null);
  const ans = await answerAll(c, S.filter((s, i) => choice1(i) !== null), (s) => choice1(S.indexOf(s)));
  ok(ans.every((r) => r.ok), '12 answers accepted');
  const mesQ = await Promise.all(S.map((s) => c.me(s)));
  ok(leakWhy([st, ...ans, ...mesQ, await c.get()]) === 0, 'no explanation and no correct index in any response while the question is live');

  section('reveal 1: why + doubled points');
  await c.dealer('quizReveal');
  st = await c.get();
  ok(st.quiz.state === 'reveal' && st.quiz.why === WHY1 && st.quiz.correct === 1 && st.quiz.double === true && st.quiz.img === IMG, 'reveal view: why, correct, double, img');
  const data = await c.dget('?view=data');
  const run1 = data.quizRuns.find((r) => r.setId === 'qp' && r.idx === 0);
  meta = await c.meta();
  const runId = meta.quiz.runId;
  const e1 = meta.points.filter((e) => e.kind === 'quiz' && e.run === runId && e.qi === 0);
  ok(e1.length === 6, `6 correct → 6 ledger entries (${e1.length})`);
  ok(e1.every((e) => e.x === 2 && e.amt === 2 * (e.base + e.bonus) && e.base === quizScore(run1.answers[e.playerId].ms, 20)), 'amt = 2 × (base + bonus), base by the V2 formula');
  ok(e1.every((e) => /×2/.test(e.note)), 'ledger note mentions ×2');
  const mesR = await Promise.all(S.slice(0, 7).map((s) => c.me(s)));
  ok(mesR.slice(0, 6).every((m) => m.me.quiz.myCorrect === true && m.me.quiz.myPoints >= 1000 && m.me.quiz.myPoints <= 2000), 'phones: myPoints doubled (1000–2000)');
  ok(mesR[6].me.quiz.myCorrect === false && mesR[6].me.quiz.myPoints === 0, 'wrong answer: 0');

  section('question 2: Pravda / Nepravda (2 answers)');
  await c.dealer('quizBoard');
  st = await c.get();
  ok(!('nextDouble' in st.quiz), 'board before a normal question: no ×2 announcement');
  ok(Number.isInteger(mesR[0].me.quiz.rank), 'rank present');
  await c.dealer('quizNext');
  st = await c.get();
  ok(st.quiz.a.length === 2 && !('double' in st.quiz) && !('img' in st.quiz) && !('why' in st.quiz), '2 answers, no double / img / why while live');
  ok(!(await c.st(S[0], 'quizAnswer', { choice: 2 })).ok, 'choice C refused on a 2-answer question');
  // S0–S2 right again (streak 2), S3–S5 wrong, S6–S11 right (streak 1)
  const ans2 = await answerAll(c, S.slice(0, 12), (s, i) => (i >= 3 && i < 6 ? 1 : 0));
  ok(ans2.every((r) => r.ok), '12 answers on question 2');
  await c.dealer('quizReveal');
  st = await c.get();
  ok(st.quiz.why === WHY2 && st.quiz.counts.length === 2 && st.quiz.counts[0] === 9 && st.quiz.counts[1] === 3, `reveal 2: why + counts ${JSON.stringify(st.quiz.counts)}`);
  meta = await c.meta();
  const e2 = meta.points.filter((e) => e.kind === 'quiz' && e.run === runId && e.qi === 1);
  ok(e2.length === 9 && e2.every((e) => !('x' in e) && e.amt === e.base + e.bonus), 'normal question: not doubled');
  ok(e2.filter((e) => e.bonus === 50).length === 3, 'streak bonus +50 for the 3 who were right twice');

  section('question 3 (3 answers, no why) → done');
  await c.dealer('quizNext');
  st = await c.get();
  ok(st.quiz.a.length === 3, '3 answers');
  await answerAll(c, S.slice(0, 2), () => 2);
  await c.dealer('quizReveal');
  st = await c.get();
  ok(st.quiz.state === 'reveal' && !('why' in st.quiz), 'reveal without an explanation has no why key');
  await c.dealer('quizNext');
  st = await c.get();
  ok(st.quiz.state === 'done' && st.quiz.leaders.length >= 3, 'done with leaders (podium = top 3)');
  const md = await Promise.all([S[0], S[3], S[6], S[17]].map((s) => c.me(s)));
  ok(md.map((m) => m.me.quiz.bestStreak).join() === '3,1,1,0', `bestStreak at done: ${md.map((m) => m.me.quiz.bestStreak)}`);
  ok(md[0].me.quiz.rank === 1 || md[0].me.quiz.runPoints >= md[2].me.quiz.runPoints, 'final rank and points on the phone');

  section('results export (?view=quizrun, dealer only)');
  ok((await c.get('?view=quizrun'))._status === 401, 'without the dealer password: 401');
  ok((await c.get('?view=quizrun&runId=' + runId))._status === 401, 'with a runId but no password: 401');
  const list = await c.dget('?view=quizrun');
  ok(list.ok && list.runs.some((r) => r.runId === runId && r.questions === 3 && r.title === 'Kvíz plus'), 'run list has this run with 3 questions');
  const ex = await c.dget('?view=quizrun&runId=' + runId);
  ok(ex.ok && ex.questions.length === 3 && ex.title === 'Kvíz plus' && ex.players === 18, 'per-run export: 3 questions, 18 players');
  const [x1, x2, x3] = ex.questions;
  ok(JSON.stringify(x1.counts) === JSON.stringify([6, 6, 0, 0]) && x1.correct === 1 && x1.correctN === 6 && x1.answered === 12 && x1.pctCorrect === 50 && x1.double === true, `Q1 split ${JSON.stringify(x1.counts)}, 50 % correct, ×2`);
  // the export rounds to whole ms, so two answers can tie: any student at the minimum counts as fastest
  const ms1 = (s) => Math.round(run1.answers[s.sid].ms);
  const minMs1 = Math.min(...S.slice(0, 6).map(ms1));
  const tied1 = S.slice(0, 6).filter((s) => ms1(s) === minMs1).map((s) => s.name);
  ok(x1.fastest && tied1.includes(x1.fastest.name) && x1.fastest.ms === minMs1, `Q1 fastest correct = ${x1.fastest?.name} (one of ${tied1.join('/')})`);
  const a1 = Object.entries(run1.answers).filter(([sid]) => sid !== G.sid).map(([, a]) => Math.round(a.ms));
  const avg1 = Math.round(a1.reduce((x, y) => x + y, 0) / a1.length);
  ok(Math.abs(x1.avgMs - avg1) <= 1, `Q1 average ms ${x1.avgMs} ≈ ${avg1}`);
  ok(x2.counts.length === 2 && x2.pctCorrect === 75 && !x2.double && x3.counts.length === 3 && x3.correctN === 2 && x3.answered === 2, 'Q2 2-way split 75 %, Q3 3-way split');
  ok(!JSON.stringify(ex).includes(G.sid) && !ex.ranking.some((r) => r.name === 'Ghost'), 'ghost not in the export');
  ok(ex.ranking[0].rank === 1 && ex.ranking.every((r, i) => i === 0 || ex.ranking[i - 1].points >= r.points), 'ranking sorted');
  ok((await c.dget('?view=quizrun&runId=nope'))._status === 404, 'unknown runId: 404');

  section('a blok2 set saved before v4 (no why) still explains from the seed');
  meta = await c.meta();
  const old = structuredClone(meta.quizSets.find((s) => s.id === 'blok2'));
  old.questions = old.questions.slice(0, 1).map(({ why, ...q }) => q);
  await c.dealer('quizSave', { set: old });
  ok(!('why' in (await c.meta()).quizSets.find((s) => s.id === 'blok2').questions[0]), 'blok2 saved without why');
  await c.dealer('quizEnd');
  await c.dealer('quizStart', { setId: 'blok2' });
  await c.dealer('quizNext');
  await c.dealer('quizReveal');
  st = await c.get();
  ok(st.quiz.why === seedJson[0].why, 'reveal falls back to the seed explanation');

  section('flag off = v3');
  ok((await c.dealer('features', { set: { quizplus: false } })).ok, 'quizplus off');
  st = await c.get();
  ok(!('why' in st.quiz) && !('img' in st.quiz) && !('double' in st.quiz), 'reveal without why / img / double');
  await c.dealer('quizEnd');
  await c.dealer('quizStart', { setId: 'qp' });
  st = await c.get();
  ok(!('nextDouble' in st.quiz), 'lobby: no ×2 announcement');
  const rOff = await c.st(S[0], 'quizReady');
  ok(!rOff.ok, `quizReady refused with the flag off (${rOff.error})`);
  ok((await c.get('?view=quizready')).lobby === false, 'quizready view off');
  await c.dealer('quizNext');
  st = await c.get();
  ok(!('double' in st.quiz) && !('img' in st.quiz), 'question without double / img');
  await answerAll(c, S.slice(0, 3), () => 1);
  await c.dealer('quizReveal');
  meta = await c.meta();
  const eo = meta.points.filter((e) => e.kind === 'quiz' && e.run === meta.quiz.runId && e.qi === 0);
  ok(eo.length === 3 && eo.every((e) => e.amt === e.base + e.bonus && !('x' in e)), 'scoring not doubled with the flag off');
  const mo = await c.me(S[0]);
  await c.dealer('quizBoard');
  ok(!('bestStreak' in (await c.me(S[0])).me.quiz) && mo.me.quiz.myPoints <= 1000, 'phone: no bestStreak, points ≤ 1000');
  await c.dealer('features', { set: { quizplus: true } });
  await c.dealer('quizEnd'); await c.dealer('quizEnd');
  await srv.stop();
  if (mock) await mock.stop?.();
});
