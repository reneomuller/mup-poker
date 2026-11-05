// @self-managed: starts (and wipes) its own server on E_PORT in E_MODE storage, with DEALER_LOCK=1 and short presence
// timings (MUP_PRESENCE_WINDOW=1 s "connected", MUP_PRESENCE_TTL=3 s expiry) so the TTL can be checked in seconds.
// v4 regie: heartbeat + ?view=presence (dealer only, ghosts excluded, window/TTL), the not-submitted list vs the slips,
// nudges (wall task / team message, all teams, flag off), the run-of-show plan (saved, kept on undo, in dumps,
// restored after a wipe), recent dealer actions + the undo stack, and that hb never reaches the action log.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ok, info, section, main, client, startServer, startMock, freshGame, initialSlip, sleep, MODE, MOCK_PORT, PG_URL, OFF, ROOT } from './_e-lib.mjs';

const PORT = Number(process.env.E_PORT || 3361);
const TAG = 'tagE' + PORT;
let srv, mock, c;
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
const ENV = { DEALER_LOCK: '1', DEALER_PASSWORD: 'mup-dealer', MUP_PRESENCE_WINDOW: '1', MUP_PRESENCE_TTL: '3' };
async function boot() { srv = await startServer({ port: PORT, tag: TAG, mode: MODE, env: ENV }); c = client(srv.base); }
async function wipe() { await srv.stop(); if (MODE === 'redis') await mock.flush(); await wipeDb(); await boot(); }
const pres = () => c.dget('?view=presence');
const hb = (s, pin = s.pin) => c.post({ op: 'hb', sid: s.sid, pin });
const ids = (a) => (a || []).map((x) => x.id).sort().join(',');

await main(async () => {
  if (MODE === 'redis') {
    let up = false;
    try { await fetch(`http://localhost:${MOCK_PORT}/__stats`); up = true; } catch {}
    mock = up ? { flush: () => fetch(`http://localhost:${MOCK_PORT}/__flush`).then((r) => r.text()) } : await startMock(MOCK_PORT);
  }
  await wipeDb();
  await boot();
  info(`storage ${(await c.get()).storage}`);
  const { T, S, G } = await freshGame(c, { n: 12, ghost: true });
  ok(S.length === 12 && G?.sid, 'fresh game: 6 teams, 2 students each, a ghost on team 2');

  section('flag + access');
  const st0 = await c.get();
  ok(st0.features?.regie === true, 'feature regie is on by default');
  ok(!('presence' in st0) && !JSON.stringify(st0).includes('mup:seen'), 'plain GET carries nothing from presence');
  const anon = await c.get('?view=presence');
  ok(anon._status === 401 && !anon.ok, `?view=presence without the dealer password → 401 (${anon._status})`);
  const asStudent = await c.get('?view=presence', { 'x-sid': S[0].sid, 'x-pin': S[0].pin });
  ok(asStudent._status === 401 && !asStudent.players, 'a student cannot read the presence view');
  let p = await pres();
  ok(p.ok && p.players.length === 12, `dealer view lists the 12 students (${p.players?.length})`);
  ok(!p.players.some((r) => r.id === G.sid) && !p.never.some((r) => r.id === G.sid), 'the ghost is not listed');
  ok(p.online === 0 && p.never.length === 12 && p.dropped.length === 0, 'nobody connected before any heartbeat');
  ok(p.window === 1 && p.ttl === 3, `test timings from the environment (window ${p.window} s, ttl ${p.ttl} s)`);

  section('heartbeat');
  const h0 = await hb(S[0]);
  ok(h0.ok && h0.ts > 0, 'hb with the right PIN → ok');
  ok((await hb(S[1])).ok, 'second student beats');
  const bad = await hb(S[2], '0000');
  ok(!bad.ok && bad._status === 401, `hb with a wrong PIN is refused (${bad._status})`);
  ok(!(await c.post({ op: 'hb', sid: 'nope-nope', pin: '1234' })).ok, 'hb for an unknown sid is refused');
  { // v4 review: wrong PINs on hb count like on every other route, so the heartbeat is no PIN oracle around the guard lockout
    const bf = await c.post({ op: 'register', name: 'Brute Force', team: T[0], pin: '4321' });
    for (let i = 0; i < 8; i++) await c.post({ op: 'hb', sid: bf.sid, pin: String(5000 + i) });
    const right = await c.post({ op: 'hb', sid: bf.sid, pin: '4321' });
    ok(bf.ok && !right.ok && right._status === 401, `after 8 wrong hb PINs even the right one is refused (${right._status} ${right.error})`);
    const g = await c.get('', { 'x-sid': bf.sid, 'x-pin': '4321' });
    ok(!g.me && g.meError === 'locked', `…and the player is locked for the GET too (${g.meError})`);
    ok((await c.dealer('removePlayer', { sid: bf.sid })).ok, 'clean-up: the test player is removed again');
  }
  const hg = await hb(G);
  ok(hg.ok && hg.ghost === true, 'a ghost hb is answered but not recorded');
  p = await pres();
  const r0 = p.players.find((r) => r.id === S[0].sid);
  ok(p.online === 2 && r0.online && r0.seen > 0, `2 connected, S1 seen (${p.online})`);
  ok(!p.players.some((r) => r.id === G.sid) && p.never.length === 10, 'ghost still excluded, 10 never seen');
  const log = await c.dget('?view=log&limit=200');
  ok(log.ok && !log.log.some((e) => e.op === 'hb'), 'hb never reaches the action log');

  section('window + TTL');
  await sleep(1300);
  await hb(S[1]);
  p = await pres();
  ok(p.dropped.some((r) => r.id === S[0].sid) && !p.players.find((r) => r.id === S[0].sid).online, 'after the window S1 counts as dropped');
  ok(p.players.find((r) => r.id === S[1].sid).online && p.online === 1, 'S2 who beat again is still connected');
  await sleep(2200);
  p = await pres();
  ok(p.never.some((r) => r.id === S[0].sid) && !p.dropped.some((r) => r.id === S[0].sid), 'after the TTL the beat is gone (never seen again)');
  ok(p.dropped.some((r) => r.id === S[1].sid), 'S2 is dropped by now');

  section('not submitted = slips');
  await c.dealer('phase', { phase: 'betting', minutes: 5 });
  const subs = [0, 1, 2, 5, 7];
  for (const i of subs) {
    const r = await c.st(S[i], 'submit', initialSlip(T, S[i].team, i));
    if (!r.ok) ok(false, `submit ${i}: ${r.error}`);
  }
  await c.st(G, 'submit', initialSlip(T, G.team, 99));
  p = await pres();
  const dump = await c.dump();
  const slips = dump.slips?.[String(dump.meta.block)] || dump.slips?.[dump.meta.block] || {};
  const expMissing = S.filter((s) => !slips[s.sid]?.submitted).map((s) => s.sid).sort().join(',');
  ok(ids(p.notSubmitted) === expMissing && p.notSubmitted.length === 7, `not-submitted list = students without a submitted slip (${p.notSubmitted.length})`);
  ok(!p.notSubmitted.some((r) => r.id === G.sid), 'the ghost is never in the missing list');
  for (const t of p.teams) {
    const exp = S.filter((s) => s.team === t.id && !subs.includes(S.indexOf(s))).map((s) => s.name).sort().join(',');
    if ([...t.missing].sort().join(',') !== exp) ok(false, `team ${t.id} missing ${t.missing} ≠ ${exp}`);
  }
  ok(p.teams.every((t) => t.missing.length === t.missingIds.length), 'per-team missing names match the slips');
  const d = await c.dget('?view=dealer');
  const dealerMissing = d.dealer.rows.filter((r) => !r.slip?.submitted).map((r) => r.id).sort().join(',');
  ok(dealerMissing === expMissing, 'same list as the dealer rows');
  ok(p.emptyTeams.length === 0 && p.noPin.length === 0, 'no empty teams, no PIN-less accounts');

  section('nudge');
  const tFull = T.find((t) => p.teams.find((x) => x.id === t).missing.length === 0);
  const tMiss = T.find((t) => p.teams.find((x) => x.id === t).missing.length === 2) || T.find((t) => p.teams.find((x) => x.id === t).missing.length);
  const names = p.teams.find((x) => x.id === tMiss).missing;
  const n1 = await c.dealer('nudge', { team: tMiss });
  ok(n1.ok && n1.via === 'wall' && n1.sent.length === 1, `nudge with walls on → wall task (${n1.error || n1.via})`);
  const txt = 'Ještě vám chybí investice od: ' + names.join(', ');
  const w = await c.dget('?view=wall&team=' + tMiss);
  const task = (w.stickers || []).find((s) => s.text === txt);
  ok(task && task.kind === 'task' && !task.done && task.by.role === 'dealer', `the team wall has the task „${txt}“`);
  const mate = S.find((s) => s.team === tMiss);
  const mw = await c.get('?view=wall', { 'x-sid': mate.sid, 'x-pin': mate.pin });
  ok((mw.stickers || []).some((s) => s.id === task?.id), 'the team member sees the reminder on their wall');
  const other = S.find((s) => s.team !== tMiss);
  const ow = await c.get('?view=wall', { 'x-sid': other.sid, 'x-pin': other.pin });
  ok(!(ow.stickers || []).some((s) => s.text === txt), 'another team never sees it');
  p = await pres();
  ok(p.teams.find((x) => x.id === tMiss).tasks === 1, 'open wall tasks per team: 1');
  if (tFull) {
    const nf = await c.dealer('nudge', { team: tFull });
    ok(!nf.ok && /investovali/.test(nf.error), `nudge to a team where everyone invested is refused („${nf.error}“)`);
  }
  const n2 = await c.dealer('nudge', { team: tMiss, via: 'msg' });
  ok(n2.ok && n2.via === 'msg', 'nudge as a team message');
  const me = await c.me(mate);
  ok(me.me.msgs[0]?.text === txt && me.me.msgs[0].kind === 'note', 'the team message is on the phone (newest first)');
  const meO = await c.me(other);
  ok(!(meO.me.msgs || []).some((m) => m.text === txt), 'and only for that team');
  const n3 = await c.dealer('nudge', { all: true, via: 'msg' });
  const teamsMissing = p.teams.filter((t) => t.missing.length).map((t) => t.id).sort().join(',');
  ok(n3.ok && n3.sent.map((x) => x.team).sort().join(',') === teamsMissing, 'nudge all → every team with someone missing');
  await c.dealer('features', { set: { wall: false } });
  const n4 = await c.dealer('nudge', { team: tMiss });
  ok(n4.ok && n4.via === 'msg', 'walls off → the nudge falls back to a team message');
  p = await pres();
  ok(p.wall === false && p.teams.every((t) => t.tasks === 0), 'walls off → no wall reads, tasks 0');
  await c.dealer('features', { set: { wall: true } });
  ok(!(await c.dealer('nudge', { team: 'xx' })).ok, 'nudge to an unknown team is refused');

  section('recent actions + undo stack');
  p = await pres();
  ok(p.actions.length === 5 && p.actions[0]?.op === 'features' && p.actions.some((a) => a.op === 'nudge' && /^Připomínka /.test(a.label)), `last 5 dealer actions, newest first, named (${p.actions.map((a) => a.label).join(' | ')})`);
  ok(!p.actions.some((a) => a.op === 'auth' || a.op === 'hb'), 'no auth / hb in the list');
  const m0 = await c.meta();
  ok(Array.isArray(m0.regieLog) && m0.regieLog.length === 5 && m0.regieLog.every((e) => e.op && e.label && e.ts), 'kept as a ring buffer in meta.regieLog ({ op, label, ts }, ≤ 5)');
  ok(p.undoTop === null, 'nothing undoable yet');
  const sd = await c.dealer('showdown');
  ok(sd.ok, 'showdown');
  const late = await c.dealer('nudge', { team: tMiss });
  ok(!late.ok && /Showdown/.test(late.error), `no nudge after the showdown („${late.error}“)`);
  p = await pres();
  ok(p.undoTop?.op === 'showdown', `undo would revert the showdown (${p.undoTop?.op})`);

  section('run-of-show plan');
  const plan = [
    { id: 'l1', k: 'lobby', b: 1, min: 5, label: 'Lobby a registrace' },
    { id: 'p1', k: 'pitch', b: 1, min: 12 },
    { id: 'x1', k: 'custom', min: 4, label: 'Diskuse ve dvojicích' },
    { id: 'bad', k: 'hack', min: 3 },
    { id: 'q1', k: 'quiz', b: 1, min: 999 },
  ];
  const sp = await c.dealer('regiePlan', { plan });
  ok(sp.ok && sp.plan.length === 4 && !sp.plan.some((s) => s.k === 'hack'), 'plan saved, unknown step kinds dropped');
  ok(sp.plan.find((s) => s.id === 'q1').min === 180, 'durations are clamped (≤ 180 min)');
  let meta = await c.meta();
  ok(JSON.stringify(meta.regie?.plan) === JSON.stringify(sp.plan), 'plan stored in meta.regie');
  ok(!(await c.dealer('regiePlan', { plan: 'x' })).ok, 'an invalid plan is refused');
  const un = await c.dealer('undo');
  ok(un.ok, 'undo the showdown');
  meta = await c.meta();
  ok(JSON.stringify(meta.regie?.plan) === JSON.stringify(sp.plan) && !meta.settled[meta.block + 'c'], 'undo reverts the showdown but keeps the plan');
  p = await pres();
  ok(!p.actions.some((a) => a.op === 'showdown') && p.undoTop === null && p.actions.length === 5, `undo restores the history from before the showdown (${p.actions.map((a) => a.label).join(' | ')})`);
  const dmp = await c.dump();
  ok(JSON.stringify(dmp.meta.regie?.plan) === JSON.stringify(sp.plan), 'plan is in the dealer dump');
  await wipe();
  ok(!(await c.meta())?.regie?.plan, 'server wiped: no plan');
  const rst = await c.dealer('restore', { dump: dmp });
  ok(rst.ok, `restore the dump (${rst.error || 'ok'})`);
  meta = await c.meta();
  ok(JSON.stringify(meta.regie?.plan) === JSON.stringify(sp.plan), 'plan restored from the dump');
  const clr = await c.dealer('regiePlan', { plan: null });
  ok(clr.ok && (await c.meta()).regie.plan === null, 'plan: null → back to the default plan');

  section('flag off');
  await c.dealer('features', { set: { regie: false } });
  const off = await pres();
  ok(!off.ok && off.error === OFF, `view off → „${off.error}“`);
  ok((await c.dealer('nudge', { team: T[0] })).error === OFF && (await c.dealer('regiePlan', { plan: [] })).error === OFF, 'nudge + regiePlan off');
  ok(!('regie' in (await c.get())) && (await c.get()).features.regie === false, 'public state only shows the flag');
  await c.dealer('features', { set: { regie: true } });

  section('undo after a priced-round repricing names it');
  await c.dealer('features', { set: { rounds: true } });
  await c.dealer('phase', { phase: 'lobby' });
  const rt = await c.dealer('roundTerms', { team: T[0], pre: 1_100_000 });
  ok(rt.ok, `round terms set (${rt.error || 'ok'})`);
  ok((await c.dealer('phase', { phase: 'betting', minutes: 5 })).ok, 'open betting → the block is repriced (backup)');
  p = await pres();
  ok(p.undoTop?.op === 'phase' && /^Otevřít investování/.test(p.undoTop.label), `undo would revert the repricing („${p.undoTop?.label}“)`);
  ok((await c.dealer('timer', { minutes: 2 })).ok, 'a later non-undoable action');
  p = await pres();
  ok(p.undoTop?.op === 'phase' && p.actions[0]?.op === 'timer', 'the timer does not change what undo reverts');
  ok((await c.dealer('undo')).ok, 'undo');
  p = await pres();
  ok((await c.get()).phase === 'lobby' && !p.actions.some((a) => /^Otevřít investování/.test(a.label) && a.ts > Date.now() - 3000) && p.actions[0]?.label === 'Lobby', `undo reverted the repricing and its log entry (${p.actions.map((a) => a.label).join(' | ')})`);
  await c.dealer('features', { set: { rounds: false } });

  section('teams without members, PIN-less accounts');
  await c.dealer('removePlayer', { sid: S[0].sid }).catch(() => {});
  p = await pres();
  info(`after restore: ${p.players.length} players, empty teams ${p.emptyTeams.length}`);
  ok(Array.isArray(p.emptyTeams) && Array.isArray(p.noPin), 'empty teams + no-PIN lists present');

  section('Redis cost of a dealer action: regie off = on = v3');
  // a counting mock Upstash + Redis-only servers (no Postgres), one after the other on PORT+2
  const MP = PORT + 1, MK = PORT + 2;
  const rmock = await startMock(MK);
  const REDIS = { UPSTASH_REDIS_REST_URL: `http://localhost:${MK}`, UPSTASH_REDIS_REST_TOKEN: 'test-token' };
  async function cost(cwd, set) {
    await rmock.flush();
    const s = await startServer({ port: MP, tag: 'tagE' + MP, cwd, mode: 'mem', env: REDIS });
    const cc = client(s.base);
    try {
      await cc.dealer('reset', { confirm: 'RESET' });
      if (set) await cc.dealer('features', { set });
      const tm = (await cc.get()).teams[0].id;
      await cc.dealer('timer', { minutes: 2 }); // warm-up
      const one = async (op, x) => { await rmock.resetStats(); const r = await cc.dealer(op, x); const st = await rmock.stats(); if (!r.ok) ok(false, `${op}: ${r.error}`); return st.total; };
      const out = { timer: await one('timer', { minutes: 3 }), pitch: await one('phase', { phase: 'pitch', team: tm, minutes: 3 }) };
      await cc.dealer('phase', { phase: 'betting', minutes: 5 });
      out.showdown = await one('showdown'); // pushes a backup (undo stack)
      out.undo = await one('undo');
      return out;
    } finally { await s.stop(); }
  }
  const offC = await cost(ROOT, { regie: false });
  const onC = await cost(ROOT, { regie: true });
  info(`commands per dealer action – regie off ${JSON.stringify(offC)}, on ${JSON.stringify(onC)}`);
  ok(JSON.stringify(offC) === JSON.stringify(onC), 'regie on costs exactly the same Redis commands as regie off');
  let base = null;
  try { base = execSync(`git -C ${ROOT} rev-parse --verify -q v4-base`, { stdio: 'pipe' }).toString().trim(); } catch {}
  if (base) { // compare with the v3 code this lane started from
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regie-v3-'));
    execSync(`git -C ${ROOT} archive ${base} api public dev-server.js package.json | tar -x -C ${dir}`);
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    const v3 = await cost(dir, null);
    info(`v3 (v4-base ${base.slice(0, 7)}): ${JSON.stringify(v3)}`);
    ok(Object.keys(v3).every((k) => onC[k] <= v3[k] && offC[k] <= v3[k]), 'no dealer action costs more Redis commands than on v3');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await rmock.stop();
});
