// Redis commands per GET (Upstash bills per command): v2 may add at most 2 per load, the quiz at most 1,
// archives / answers are never read on a normal GET, and the 700 ms cache still works.
// Compares against the old server (OLD_DIR, git v2-base) on a counting copy of the Upstash mock.
//   OLD_DIR=/tmp/oldA node tests/a-perf.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { client, ok, done, register, firstSlip } from './a-lib.mjs';

const OLD_DIR = process.env.OLD_DIR || '/tmp/oldA';
const NEW_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.PPORT || 3115), MOCK = Number(process.env.PMOCK || 8098);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

const src = fs.readFileSync(path.join(NEW_DIR, 'tests/mock-upstash.mjs'), 'utf8')
  .replace(/8079/g, String(MOCK))
  .replace("const kv = new Map(), hs = new Map();", "const kv = new Map(), hs = new Map(); let count = 0; const seen = [];")
  .replace("function run(cmd) {", "function run(cmd) { count++; seen.push(String(cmd[0]).toUpperCase() + ' ' + cmd[1]);")
  .replace("if (req.url === '/__flush')", "if (req.url === '/__count') { const r = JSON.stringify({ count, seen }); count = 0; seen.length = 0; return res.end(r); }\n    if (req.url === '/__flush')")
  .replace("throw new Error('unsupported ' + C);", "if (C === 'HSETNX') { const h = hs.get(k) || new Map(); hs.set(k, h); if (h.has(a[0])) return 0; h.set(a[0], String(a[1])); return 1; }\n  if (C === 'HGET') { const h = hs.get(k); return h && h.has(a[0]) ? h.get(a[0]) : null; }\n  throw new Error('unsupported ' + C);");
fs.writeFileSync('/tmp/a-mock-count.mjs', src);
const counted = async () => (await (await fetch(`http://localhost:${MOCK}/__count`)).json());

async function start(dir, tag) {
  const p = spawn('node', ['dev-server.js', tag], { cwd: dir, env: { ...process.env, PORT: String(PORT), KV_REST_API_URL: `http://localhost:${MOCK}`, KV_REST_API_TOKEN: 'test-token', DATABASE_URL: '', MUP_PG_LOCAL: '' }, stdio: 'ignore' });
  procs.push(p);
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/api/game`); return p; } catch { await sleep(100); } }
  throw new Error('no server');
}
const stop = (p) => new Promise((r) => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill('SIGTERM'); });

async function perGet(c, h = {}) {
  await sleep(800); await counted();
  await c.get('', h);
  const a = await counted();
  await c.get('', h); // within 700 ms: cache
  const b = await counted();
  return { n: a.count, cached: b.count, seen: a.seen };
}

try {
  const mock = spawn('node', ['/tmp/a-mock-count.mjs'], { stdio: 'ignore' });
  procs.push(mock);
  await sleep(400);
  const base = `http://localhost:${PORT}/api/game`;
  const c = client(base);
  let old = await start(OLD_DIR, 'tagA-perf-old');
  let st = await c.get();
  const T = st.teams.map((t) => t.id);
  const S = await register(c, 6, T);
  await c.dealer('phase', { phase: 'betting' });
  for (const [i, s] of S.entries()) await c.spost({ op: 'submit', sid: s.sid, pin: s.pin, in: firstSlip(s, T, i) });
  const oldGet = await perGet(c), oldMe = await perGet(c, { 'x-sid': S[0].sid, 'x-pin': S[0].pin });
  await stop(old);

  const nw = await start(NEW_DIR, 'tagA-perf-new');
  await c.get(); // first load: migration archive
  const newGet = await perGet(c), newMe = await perGet(c, { 'x-sid': S[0].sid, 'x-pin': S[0].pin });
  console.log(`commands per GET: old ${oldGet.n}, v2 ${newGet.n}; with me: old ${oldMe.n}, v2 ${newMe.n}`);
  ok(newGet.n - oldGet.n <= 2 && newMe.n - oldMe.n <= 2, `v2 adds ≤ 2 commands per GET (+${newGet.n - oldGet.n})`);
  ok(newGet.cached === 0 && newMe.cached === 0, '700 ms cache: a second GET costs 0 commands');
  ok(!newGet.seen.some((s) => /arch|qa:/.test(s)), 'normal GET reads no archives and no quiz answers: ' + newGet.seen.join(', '));

  await c.dealer('phase', { phase: 'closed' });
  await c.dealer('quizStart', { setId: 'blok2' });
  const board = await perGet(c);
  ok(board.n === newGet.n, `quiz lobby/board costs nothing extra (${board.n})`);
  await c.dealer('quizNext');
  await Promise.all(S.map((s) => c.spost({ op: 'quizAnswer', sid: s.sid, pin: s.pin, choice: 0 })));
  const q = await perGet(c), qMe = await perGet(c, { 'x-sid': S[0].sid, 'x-pin': S[0].pin });
  ok(q.n - newGet.n <= 1 && qMe.n - newMe.n <= 1, `open question adds ≤ 1 command (${q.n} vs ${newGet.n}): ${q.seen.filter((s) => /qa:/.test(s)).join()}`);
  ok(q.n - oldGet.n <= 2, `open question: ≤ +2 over the old server overall (${q.n} vs ${oldGet.n})`);
  const pub = await c.get();
  ok(pub.quiz.answered === 6, 'answered from the per-question hash');
  await c.dealer('quizReveal');
  const rv = await perGet(c);
  ok(rv.n - newGet.n <= 1, `reveal adds ≤ 1 command (${rv.n})`);
  await stop(nw);
} catch (e) {
  ok(false, 'crashed: ' + e.stack);
} finally {
  for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
  done('a-perf');
}
