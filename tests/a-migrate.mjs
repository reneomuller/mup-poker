// Production migration: the old server (git v2-base, in OLD_DIR) builds the production-like state
// (19 players, 19 submitted slips in slip:1, phase closed, no showdown) in a real database; then the
// v2 server starts on the same data and must keep everything, archive it, and run the next steps.
// Runs twice: Postgres only, and Redis (mock) + Postgres mirror.
//   OLD_DIR=/tmp/oldA PG=postgres://postgres:pw@localhost:5432/mup_a node tests/a-migrate.mjs
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { client, ok, done, sum, badNumbers } from './a-lib.mjs';

const OLD_DIR = process.env.OLD_DIR || '/tmp/oldA';
const NEW_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PG = process.env.PG || 'postgres://postgres:pw@localhost:5432/mup_a';
const PORT = Number(process.env.MPORT || 3111), PORT2 = PORT + 1, MOCK = Number(process.env.MOCK_PORT || 8099);
const BASE = `http://localhost:${PORT}/api/game`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

function wipe() {
  const u = new URL(PG);
  execSync(`psql -h ${u.hostname} -U ${u.username} -d ${u.pathname.slice(1)} -c 'drop table if exists mup_kv, mup_h, mup_log'`, { env: { ...process.env, PGPASSWORD: u.password }, stdio: 'pipe' });
}
async function up(port, base) {
  for (let i = 0; i < 60; i++) { try { await fetch(base); return; } catch { await sleep(100); } }
  throw new Error('server did not start on ' + port);
}
async function start(dir, port, env, tag) {
  const p = spawn('node', ['dev-server.js', tag], { cwd: dir, env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => { if (process.env.VERBOSE) process.stderr.write(d); });
  procs.push(p);
  await up(port, `http://localhost:${port}/api/game`);
  return p;
}
const stop = (p) => new Promise((r) => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill('SIGTERM'); });
async function startMock() {
  const src = fs.readFileSync(path.join(NEW_DIR, 'tests/mock-upstash.mjs'), 'utf8').replace(/8079/g, String(MOCK));
  const f = '/tmp/a-mock-upstash.mjs';
  fs.writeFileSync(f, src);
  const p = spawn('node', [f], { stdio: 'ignore' });
  procs.push(p);
  await sleep(400);
  return p;
}

async function buildOldState(c) {
  let st = await c.get();
  const T = st.teams.map((t) => t.id);
  await c.dealer('teams', { teams: T.map((id, i) => ({ id, name: ['Lumio', 'Parkly', 'Tutorix', 'GreenBox', 'Hrajsport', 'Vetly'][i] })) });
  const S = [];
  for (let i = 0; i < 19; i++) {
    const team = T[i % 6], pin = String(2000 + i);
    const r = await c.spost({ op: 'register', name: 'Student ' + (i + 1), team, pin });
    S.push({ sid: r.sid, pin, team });
  }
  await c.spost({ op: 'ask', sid: S[0].sid, pin: S[0].pin, team: T[1], cat: 'problem', text: 'Jak víte, že to lidi chtějí?' });
  await c.dealer('phase', { phase: 'betting', minutes: 5 });
  for (const [i, s] of S.entries()) {
    const o = T.filter((t) => t !== s.team);
    const [x, y, z] = [o[i % 5], o[(i + 1) % 5], o[(i + 2) % 5]];
    const inn = { [x]: { amt: 500000, why: 'Důvod ' + i }, [y]: { amt: 300000, why: '' }, [z]: { amt: 200000, why: 'Tým' } };
    const r = await c.spost({ op: 'submit', sid: s.sid, pin: s.pin, in: inn, notes: { [x]: { like: 'Líbí ' + i, doubt: 'Pochyby ' + i } } });
    if (!r.ok) throw new Error('old submit failed ' + JSON.stringify(r));
  }
  await c.dealer('phase', { phase: 'closed' });
  await c.dealer('pin', { team: T[1], q: 'Čemu nevěříš?', a: 'Cenám' });
  return { T, S };
}

async function scenario(mode, env) {
  console.log(`\n=== ${mode} ===`);
  wipe();
  const old = await start(OLD_DIR, PORT, env, 'tagA-old');
  const c = client(BASE);
  const { T, S } = await buildOldState(c);
  const before = await c.get('?view=dealer&all=1');
  const oldMeta = (await c.get('?view=dealer&dump=1')).dealer.dump.meta;
  ok(!oldMeta.features && !oldMeta.v2ArchivedAt && oldMeta.phase === 'closed', `${mode}: old server wrote an old-shaped meta (phase closed)`);
  ok(Object.keys(before.dealer.all[1]).length === 19, `${mode}: old state has 19 slips`);
  await stop(old);

  // v2 on the same data
  const nw = await start(NEW_DIR, PORT, env, 'tagA-new');
  const firstGets = await Promise.all(Array.from({ length: 6 }, () => c.get()));
  ok(firstGets.every((g) => g.playerCount === 19 && g.betCount === 19), `${mode}: first GETs after deploy see 19 players and 19 slips`);
  let st = await c.get();
  ok(st.gid === oldMeta.gid && st.rev >= oldMeta.rev && st.auto === false, `${mode}: gid kept, rev not lower (old ${oldMeta.rev}, now ${st.rev}), not auto`);
  ok(st.phase === 'closed' && st.block === 1, `${mode}: still Block 1, phase closed`);
  ok(st.features && st.features.quiz === true && st.features.rounds === false, `${mode}: feature defaults on old meta`);
  const after = await c.get('?view=dealer&all=1');
  ok(JSON.stringify(after.dealer.all) === JSON.stringify(before.dealer.all), `${mode}: every slip (amounts, reasons, notes) intact`);
  ok(JSON.stringify(after.dealer.players) === JSON.stringify(before.dealer.players), `${mode}: every player intact`);
  ok(st.board.length === 1 && st.pins.length === 1, `${mode}: board question and pinned answer intact`);
  const arch = await c.get('?view=archives');
  const pre = arch.archives.filter((a) => a.label === 'Stav před v2');
  ok(pre.length >= 1 && pre[0].auto === true && pre[0].sizeKB > 0, `${mode}: archive „Stav před v2“ exists (${pre.length}×, ${pre[0]?.sizeKB} kB)`);
  const full = await c.get('?view=archive&id=' + pre[0]?.id);
  ok(full.ok && Object.keys(full.archive.dump.slips[1]).length === 19 && !full.archive.dump.meta.v2ArchivedAt && Object.keys(full.archive.dump.players).length === 19,
    `${mode}: archive holds the untouched old state (19 slips, 19 players)`);
  const dump = (await c.get('?view=dealer&dump=1')).dealer.dump.meta;
  ok(dump.quizSets?.[0]?.id === 'blok2' && dump.quizSets[0].questions.length === 15 && dump.v2ArchivedAt > 0, `${mode}: quiz seeded and v2 marker saved`);

  const data = await c.get('?view=data');
  ok(data.ok && data.players.length === 19 && data.allocations.length === 19 && data.teams.length === 6, `${mode}: data view 19 players, 19 allocations, 6 teams`);
  const a0 = data.allocations.find((x) => x.playerId === S[0].sid);
  const o0 = T.filter((t) => t !== S[0].team);
  ok(a0 && a0.submitted && a0.in[o0[0]].amt === 500000 && a0.in[o0[0]].why === 'Důvod 0' && a0.notes[o0[0]].doubt === 'Pochyby 0', `${mode}: data view allocation with reasons and notes`);
  ok(sum(data.allocations.map((x) => sum(Object.values(x.in).map((e) => e.amt)))) === 19e6, `${mode}: data view allocations sum to 19M`);

  // old phones keep working
  const lg = await c.spost({ op: 'login', sid: S[3].sid, pin: S[3].pin });
  ok(lg.ok, `${mode}: old phone login`);
  const rs = await c.spost({ op: 'restore', sid: S[3].sid, pin: S[3].pin, gid: oldMeta.gid, slips: { 1: { in: { [T[0]]: { amt: 1 } }, submitted: true, ts: 1 } } });
  ok(rs.ok, `${mode}: old phone restore`);
  const me3 = await c.me(S[3]);
  ok(me3.me && me3.me.slip.submitted && Object.values(me3.me.slip.in).reduce((a, e) => a + e.amt, 0) === 1e6, `${mode}: restore with an older slip does not overwrite the real one`);

  // Block 1 showdown on the migrated data
  const sd = await c.dealer('showdown');
  ok(sd.ok && sd.n === 19, `${mode}: showdown settles all 19 (got ${sd.n})`);
  st = await c.get();
  ok(sum(st.teams.map((t) => t.cls)) === 19e6, `${mode}: class money exactly 19M`);
  const m1 = (await c.get('?view=dealer&dump=1')).dealer.dump.meta;
  const lotInv = Object.keys(m1.lots).filter((k) => k !== 'rj');
  ok(lotInv.length === 19 && lotInv.every((k) => m1.lots[k].length === 3), `${mode}: lots recorded for every student (3 each)`);
  const lotMoney = sum(lotInv.flatMap((k) => m1.lots[k].map((l) => l.shares * l.price)));
  ok(Math.abs(lotMoney - 19e6) < 1, `${mode}: lots add up to 19M`);
  const cd = m1.drivers.filter((d) => d.kind === 'class');
  ok(cd.length === 6 && sum(cd.map((d) => d.delta)) === 19e6, `${mode}: class drivers recorded for 6 teams, Σ 19M (${cd.length}, ${sum(cd.map((d) => d.delta))})`);
  ok(st.drivers && st.drivers[T[0]].length === 1 && st.drivers[T[0]][0].kind === 'class', `${mode}: public drivers show the showdown`);
  ok(st.teams.every((t) => t.cap && t.cap.founders > 0 && t.cap.founders < 100), `${mode}: cap table shows dilution ${JSON.stringify(st.teams.map((t) => t.cap))}`);
  ok(badNumbers(st).length === 0, `${mode}: no NaN in public state ${badNumbers(st).slice(0, 3)}`);

  await c.dealer('rjSave', { in: Object.fromEntries(T.map((t, i) => [t, { amt: [3e6, 2e6, 2e6, 1e6, 1e6, 1e6][i], why: 'RJ ' + i }])) });
  const rv = await c.dealer('rjReveal');
  ok(rv.ok, `${mode}: RJ reveal`);
  const m2 = (await c.get('?view=dealer&dump=1')).dealer.dump.meta;
  ok(m2.rjPrincipal === 10e6 && m2.drivers.filter((d) => d.kind === 'rj').length === 6 && m2.lots.rj.length === 6, `${mode}: RJ principal 10M, rj drivers and lots`);

  const nb = await c.dealer('nextBlock');
  st = await c.get();
  ok(nb.ok && st.block === 2 && st.phase === 'lobby', `${mode}: Další blok → Block 2 lobby`);
  const arch2 = await c.get('?view=archives');
  ok(arch2.archives[0].label === 'Před blokem 2' && arch2.archives.filter((a) => a.label === 'Stav před v2').length === pre.length, `${mode}: archive „Před blokem 2“, no second „Stav před v2“`);
  await stop(nw);

  // another instance (cold start) on the same data: nothing re-archived, nothing lost
  const nw2 = await start(NEW_DIR, PORT, env, 'tagA-new');
  st = await c.get();
  const arch3 = await c.get('?view=archives');
  ok(st.block === 2 && st.playerCount === 19 && arch3.archives.length === arch2.archives.length, `${mode}: restart keeps state, no extra archive`);
  await c.dealer('phase', { phase: 'betting' });
  const me = await c.me(S[5]);
  ok(me.me.rules.mode === 'rebalance' && me.me.rules.cashoutMax === 300000, `${mode}: Block 2 rules rebalance 300k`);
  await stop(nw2);
}

// Two v2 instances hitting an old database at the same moment: archives may double, data must not be lost.
async function race(env) {
  console.log('\n=== race: two v2 instances on old data ===');
  wipe();
  const old = await start(OLD_DIR, PORT, env, 'tagA-old');
  const c = client(BASE);
  await buildOldState(c);
  const before = await c.get('?view=dealer&all=1');
  await stop(old);
  const [a, b] = [await start(NEW_DIR, PORT, env, 'tagA-new'), await start(NEW_DIR, PORT2, env, 'tagA-new2')];
  const c2 = client(`http://localhost:${PORT2}/api/game`);
  await Promise.all([c.get(), c2.get(), c.get(), c2.get()]);
  const after = await c.get('?view=dealer&all=1');
  const arch = await c.get('?view=archives');
  const st = await c2.get();
  ok(JSON.stringify(after.dealer.all) === JSON.stringify(before.dealer.all) && st.playerCount === 19, 'race: all slips and players intact');
  ok(arch.archives.filter((x) => x.label === 'Stav před v2').length >= 1, `race: archive exists (${arch.archives.length}×)`);
  const sd = await c2.dealer('showdown');
  ok(sd.ok && sd.n === 19, 'race: showdown works');
  await stop(a); await stop(b);
}

try {
  if (!fs.existsSync(path.join(OLD_DIR, 'dev-server.js'))) throw new Error('old code missing in ' + OLD_DIR);
  const pgEnv = { MUP_PG_LOCAL: '1', DATABASE_URL: PG, KV_REST_API_URL: '', KV_REST_API_TOKEN: '' };
  await scenario('postgres', pgEnv);
  await race(pgEnv);
  const mock = await startMock();
  const rEnv = { ...pgEnv, KV_REST_API_URL: `http://localhost:${MOCK}`, KV_REST_API_TOKEN: 'test-token' };
  await scenario('redis+postgres', rEnv);
  await stop(mock);
} catch (e) {
  ok(false, 'crashed: ' + e.stack);
} finally {
  for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
  done('a-migrate');
}
