// @self-managed: starts (and wipes) its own server on E_PORT in E_MODE storage, with DEALER_LOCK=1 and short presence
// timings (MUP_PRESENCE_WINDOW=1 s "connected", MUP_PRESENCE_TTL=3 s expiry) so the TTL can be checked in seconds.
// v4 regie: heartbeat + ?view=presence (dealer only, ghosts excluded, window/TTL), the not-submitted list vs the slips,
// nudges (wall task / team message, all teams, flag off), the run-of-show plan (saved, kept on undo, in dumps,
// restored after a wipe), recent dealer actions + the undo stack, and that hb never reaches the action log.
import { execSync } from 'node:child_process';
import { ok, info, section, main, client, startServer, startMock, freshGame, initialSlip, sleep, MODE, MOCK_PORT, PG_URL, OFF } from './_e-lib.mjs';

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
  ok(p.actions[0]?.op === 'features' && p.actions.some((a) => a.op === 'nudge') && p.actions.some((a) => a.op === 'phase' && a.phase === 'betting'), 'recent dealer actions, newest first');
  ok(!p.actions.some((a) => a.op === 'auth' || a.op === 'hb'), 'no auth / hb in the list');
  ok(p.undoTop === null, 'nothing undoable yet');
  const sd = await c.dealer('showdown');
  ok(sd.ok, 'showdown');
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
  ok(p.actions[0]?.op === 'undo' && p.actions[0].of?.op === 'showdown' && p.undoTop === null, 'the undo entry names what it reverted');
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

  section('teams without members, PIN-less accounts');
  await c.dealer('removePlayer', { sid: S[0].sid }).catch(() => {});
  p = await pres();
  info(`after restore: ${p.players.length} players, empty teams ${p.emptyTeams.length}`);
  ok(Array.isArray(p.emptyTeams) && Array.isArray(p.noPin), 'empty teams + no-PIN lists present');
});
