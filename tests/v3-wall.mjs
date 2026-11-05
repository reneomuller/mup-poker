// @self-managed: starts (and wipes) its own server on E_PORT in E_MODE storage, with DEALER_LOCK=1 so the dealer header matters.
// v3 §4 team sticker walls: privacy between teams, student + dealer ops, send-to-all, ghosts, concurrent replies,
// limits, wallRev, feature switch, dump/restore (incl. old dumps without walls), data view, reset, Redis flush (redis mode).
import { execSync } from 'node:child_process';
import { ok, info, section, main, client, startServer, startMock, freshGame, MODE, MOCK_PORT, PG_URL } from './_e-lib.mjs';

const PORT = Number(process.env.E_PORT || 3107);
const TAG = 'tagE' + PORT;
const OTHER = 'Tahle nástěnka patří jinému týmu.';
let srv, mock, c;
const dbName = PG_URL.split('/').pop().split('?')[0];
function wipeDb() { if (MODE !== 'mem') execSync(`PGPASSWORD=pw psql -q -h localhost -U postgres -d ${dbName} -c 'drop table if exists mup_kv, mup_h, mup_log'`, { stdio: 'pipe' }); }
async function boot() { srv = await startServer({ port: PORT, tag: TAG, mode: MODE, env: { DEALER_LOCK: '1', DEALER_PASSWORD: 'mup-dealer' } }); c = client(srv.base); }
async function wipe() { await srv.stop(); if (MODE === 'redis') await mock.flush(); wipeDb(); await boot(); }
const H = (s) => ({ 'x-sid': s.sid, 'x-pin': s.pin });
const wall = (s, team) => c.get('?view=wall' + (team ? '&team=' + encodeURIComponent(team) : ''), H(s));
const dwall = (team) => c.dget('?view=wall&team=' + encodeURIComponent(team));
const find = (w, id) => (w?.stickers || []).find((x) => x.id === id);
const has = (w, id) => !!find(w, id);
const batches = async (n, size, fn) => { const out = []; for (let i = 0; i < n; i += size) out.push(...(await Promise.all(Array.from({ length: Math.min(size, n - i) }, (_, k) => fn(i + k))))); return out; };

await main(async () => {
  if (MODE === 'redis') {
    let up = false;
    try { await fetch(`http://localhost:${MOCK_PORT}/__stats`); up = true; } catch {}
    mock = up ? { flush: () => fetch(`http://localhost:${MOCK_PORT}/__flush`).then((r) => r.text()) } : await startMock(MOCK_PORT);
  }
  wipeDb();
  await boot();
  info(`storage ${(await c.get()).storage}`);
  let { T, S, G } = await freshGame(c, { n: 18, ghost: true });
  const A = S.filter((s) => s.team === T[0]), B = S.filter((s) => s.team === T[1]), Cc = S.filter((s) => s.team === T[2]);
  ok(A.length === 3 && B.length === 3 && G?.sid, 'fresh game: 6 teams, 3 students each, a ghost on team 2');

  section('feature + plain GET');
  const st0 = await c.get();
  ok(st0.features?.wall === true, 'feature wall is on by default');
  const me0 = await c.me(A[0]);
  ok(me0.me && me0.me.wallRev === 0, `me.wallRev starts at 0 (${me0.me?.wallRev})`);

  section('student ops on own team');
  const q1 = await c.st(A[0], 'wallPost', { kind: 'q', text: 'Kdo dělá průzkum trhu? TAJNE-A-1' });
  ok(q1.ok && q1.id, `student posts a question (${q1.error || q1.id})`);
  const t1 = await c.st(A[1], 'wallPost', { kind: 'task', text: 'Udělat 5 rozhovorů se zákazníky TAJNE-A-2' });
  ok(t1.ok && t1.id, 'teammate posts a task');
  const qB = await c.st(B[0], 'wallPost', { kind: 'q', text: 'Otázka týmu B TAJNE-B-1' });
  ok(qB.ok, 'team B posts its own question');
  const me1 = await c.me(A[2]);
  ok(me1.me.wallRev === 2, `wallRev of team A counts its 2 writes (${me1.me.wallRev})`);
  ok((await c.me(Cc[0])).me.wallRev === 0, 'wallRev of an untouched team stays 0');
  let wA = await wall(A[2]);
  ok(wA.ok && wA.team === T[0] && has(wA, q1.id) && has(wA, t1.id) && !has(wA, qB.id), 'team A sees its two stickers and not team B\'s');
  ok(wA.stickers[0].id === t1.id, 'newest first');
  const s1 = find(wA, q1.id);
  ok(s1.kind === 'q' && s1.by.role === 'student' && s1.by.name === A[0].name && s1.mine === false && s1.done === false && Array.isArray(s1.replies), 'sticker shape: kind, by, mine, done, replies');
  ok(find(await wall(A[0]), q1.id).mine === true, 'author sees mine: true');
  const r1 = await c.st(A[1], 'wallReply', { id: q1.id, text: 'Já, do pátku.' });
  ok(r1.ok && r1.id, 'teammate replies');
  const r2 = await c.st(A[0], 'wallReply', { id: q1.id, text: 'Díky!' });
  wA = await wall(A[0]);
  const rs = find(wA, q1.id).replies;
  ok(rs.length === 2 && rs[0].id === r1.id && rs[0].mine === false && rs[1].mine === true, 'replies oldest first with mine flags');
  ok(!(await c.st(A[0], 'wallDone', { id: q1.id, done: true })).ok, 'done on a question is refused');
  const d1 = await c.st(A[2], 'wallDone', { id: t1.id, done: true });
  ok(d1.ok, 'any teammate ticks the task off');
  const t2 = await c.st(A[2], 'wallPost', { kind: 'task', text: 'Druhý úkol' });
  wA = await wall(A[0]);
  ok(find(wA, t1.id).done === true && find(wA, t1.id).doneBy?.name === A[2].name, 'done + doneBy');
  ok(wA.stickers[wA.stickers.length - 1].id === t1.id && wA.stickers[0].id === t2.id, 'done task sorted after the open ones');
  await c.st(A[1], 'wallDone', { id: t1.id, done: false });
  ok(find(await wall(A[0]), t1.id).done === false, 'task un-ticked');
  const del1 = await c.st(A[1], 'wallDelete', { id: q1.id });
  ok(!del1.ok, `student cannot delete a teammate's sticker (${del1.error})`);
  ok(!(await c.st(A[0], 'wallDelete', { id: q1.id, reply: r1.id })).ok, 'student cannot delete a teammate\'s reply');
  ok((await c.st(A[0], 'wallDelete', { id: q1.id, reply: r2.id })).ok, 'student deletes own reply');
  ok(find(await wall(A[0]), q1.id).replies.length === 1, 'reply gone');
  const tmp = await c.st(A[0], 'wallPost', { kind: 'q', text: 'Smažu' });
  await c.st(A[1], 'wallReply', { id: tmp.id, text: 'odpověď' });
  ok((await c.st(A[0], 'wallDelete', { id: tmp.id })).ok, 'student deletes own sticker (with a teammate\'s reply on it)');
  ok(!has(await wall(A[0]), tmp.id), 'sticker gone');
  ok(!Object.keys((await c.dump()).walls[T[0]]).some((f) => f.includes(tmp.id)), 'its replies and fields are gone from the hash too');

  section('validation');
  for (const [x, m] of [[{ kind: 'q', text: '' }, 'empty text'], [{ kind: 'q', text: '   \n ' }, 'blank text'], [{ kind: 'q' }, 'missing text'], [{ kind: 'q', text: 'x'.repeat(501) }, '501 chars'], [{ kind: 'note', text: 'ahoj' }, 'kind note'], [{ text: 'ahoj' }, 'no kind']]) {
    const r = await c.st(A[0], 'wallPost', x);
    ok(!r.ok && typeof r.error === 'string', `refused: ${m} (${r.error})`);
  }
  ok((await c.st(A[0], 'wallPost', { kind: 'q', text: '' })).error === 'Text je prázdný.', 'Czech error „Text je prázdný.“');
  ok((await c.st(A[0], 'wallPost', { kind: 'q', text: 'x'.repeat(500) })).ok, '500 chars accepted');
  ok(!(await c.st(A[0], 'wallReply', { id: q1.id, text: ' ' })).ok, 'empty reply refused');
  ok(!(await c.st(A[0], 'wallReply', { id: 'nope', text: 'x' })).ok, 'reply to an unknown sticker refused');
  ok(!(await c.st({ sid: A[0].sid, pin: '0000' }, 'wallPost', { kind: 'q', text: 'x' })).ok, 'wrong PIN refused');

  section('privacy between teams');
  const pB = await c.st(B[0], 'wallPost', { kind: 'q', text: 'x', team: T[0] });
  ok(!pB.ok && pB.error === OTHER, `post to another team's wall refused (${pB.error})`);
  for (const op of ['wallReply', 'wallDone', 'wallDelete']) {
    const r1x = await c.st(B[0], op, { team: T[0], id: q1.id, text: 'x', done: true });
    ok(!r1x.ok && r1x.error === OTHER, `${op} with another team's id in the body refused`);
    const r2x = await c.st(B[0], op, { id: q1.id, text: 'x', done: true });
    ok(!r2x.ok, `${op} on another team's sticker id refused (${r2x.error})`);
  }
  const wB = await wall(B[0]);
  ok(wB.ok && wB.team === T[1] && !has(wB, q1.id) && !has(wB, t1.id) && has(wB, qB.id), 'team B sees only its own wall');
  const wBA = await wall(B[0], T[0]);
  ok(!wBA.ok && wBA._status === 403 && !JSON.stringify(wBA).includes('TAJNE-A'), `?team=<other> refused for a student (${wBA._status} ${wBA.error})`);
  const unk = await c.get('?view=wall&team=' + T[0], { 'x-sid': 'nobody123', 'x-pin': '1234' });
  ok(!unk.ok && unk._status === 401 && !unk._raw.includes('TAJNE'), `unknown sid refused (${unk._status})`);
  const badPin = await c.get('?view=wall', { 'x-sid': A[0].sid, 'x-pin': '0000' });
  ok(!badPin.ok && badPin._status === 401 && !badPin._raw.includes('TAJNE'), 'wrong PIN on the view refused');
  for (const q of ['?view=wall', '?view=wall&team=' + T[0], '?view=wall&team=all']) {
    const r = await c.get(q);
    ok(!r.ok && r._status === 401 && !r._raw.includes('TAJNE'), `${q} without the dealer header refused (${r._status})`);
    const r2 = await c.get(q, { 'x-dealer': 'wrong' });
    ok(!r2.ok && !r2._raw.includes('TAJNE'), `${q} with a wrong dealer password refused`);
  }
  ok(!(await c.post({ op: 'wallPost', team: T[0], kind: 'q', text: 'x' })).ok, 'dealer op without the header refused');
  ok(!(await c.post({ op: 'wallPost', all: true, kind: 'task', text: 'x' })).ok, 'dealer send-to-all without the header refused');
  const plain = [await c.get(), await c.me(A[0]), await c.me(B[0])].map((x) => x._raw).join('');
  ok(!plain.includes('TAJNE'), 'no sticker text in any plain GET (public or me)');
  ok(!(await c.dget('?view=dealer'))._raw.includes('TAJNE'), 'no sticker text in the plain dealer view');

  section('dealer ops');
  const dA = await dwall(T[0]);
  ok(dA.ok && dA.team === T[0] && has(dA, q1.id) && dA.stickers.every((s) => s.mine === false), 'dealer sees team A\'s wall, mine false');
  const dp = await c.dealer('wallPost', { team: T[2], kind: 'task', text: 'Úkol od MUP' });
  ok(dp.ok && dp.id, 'dealer posts a task to one team');
  const wC = await wall(Cc[0]);
  ok(find(wC, dp.id)?.by.role === 'dealer' && find(wC, dp.id).by.name === 'MUP', 'team C sees the dealer sticker with by.role dealer');
  ok(!has(await wall(A[0]), dp.id), 'other teams do not');
  ok((await c.dealer('wallReply', { team: T[0], id: q1.id, text: 'MUP odpovídá' })).ok, 'dealer replies on a student sticker');
  ok((await c.dealer('wallDone', { team: T[0], id: t1.id, done: true })).ok, 'dealer ticks a student task');
  ok(!(await c.dealer('wallDone', { team: T[0], id: q1.id, done: true })).ok, 'dealer cannot tick a question');
  ok(!(await c.dealer('wallPost', { team: 'nope', kind: 'q', text: 'x' })).ok, 'dealer post to an unknown team refused');
  ok(!(await c.dealer('wallPost', { kind: 'q', text: 'x' })).ok, 'dealer post without a team refused');
  ok(!(await c.dealer('wallReply', { team: T[1], id: q1.id, text: 'x' })).ok, 'dealer reply with the wrong team refused');
  const sr = await c.st(Cc[1], 'wallReply', { id: dp.id, text: 'Hotovo zítra' });
  ok(sr.ok, 'student replies to the dealer task');
  ok(!(await c.st(Cc[1], 'wallDelete', { id: dp.id })).ok, 'student cannot delete the dealer sticker');
  ok((await c.dealer('wallDelete', { team: T[2], id: dp.id, reply: sr.id })).ok, 'dealer deletes a student reply');
  ok(find(await wall(Cc[0]), dp.id).replies.length === 0, 'reply gone');
  const tB = await c.st(B[1], 'wallPost', { kind: 'q', text: 'smaže dealer' });
  ok((await c.dealer('wallDelete', { team: T[1], id: tB.id })).ok && !has(await wall(B[1]), tB.id), 'dealer deletes a student sticker');

  section('send to all teams');
  const revBefore = await Promise.all(T.map((t) => c.me(S.find((s) => s.team === t)).then((r) => r.me.wallRev)));
  const all = await c.dealer('wallPost', { all: true, kind: 'task', text: 'Všichni: pitch deck do pátku' });
  ok(all.ok && all.group && all.id, `send-to-all ok with a group (${all.group})`);
  const walls = await Promise.all(T.map((t) => wall(S.find((s) => s.team === t))));
  ok(walls.every((w) => w.stickers.some((s) => s.group === all.group && s.kind === 'task')), 'every team has the sticker with the shared group');
  const revAfter = await Promise.all(T.map((t) => c.me(S.find((s) => s.team === t)).then((r) => r.me.wallRev)));
  ok(revAfter.every((v, i) => v === revBefore[i] + 1), `wallRev +1 on every team (${revBefore} → ${revAfter})`);
  const gid = (w) => w.stickers.find((s) => s.group === all.group).id;
  ok((await c.st(A[0], 'wallDone', { id: gid(walls[0]), done: true })).ok, 'team A ticks its copy');
  const w2 = await Promise.all(T.map((t) => wall(S.find((s) => s.team === t))));
  ok(w2[0].stickers.find((s) => s.group === all.group).done === true && w2.slice(1).every((w) => w.stickers.find((s) => s.group === all.group).done === false), 'done state stays per team');
  await c.st(B[0], 'wallReply', { id: gid(walls[1]), text: 'B odpovídá' });
  ok(w2[0].stickers.find((s) => s.group === all.group).replies.length === 0 && (await wall(B[0])).stickers.find((s) => s.group === all.group).replies.length === 1, 'replies stay per team');
  const ov = await c.dget('?view=wall&team=all');
  ok(ov.ok && T.every((t) => Array.isArray(ov.walls?.[t]) && ov.walls[t].some((s) => s.group === all.group)), 'dealer overview team=all lists every wall');

  section('ghosts');
  const revG = (await c.me(B[0])).me.wallRev;
  const gp = await c.st(G, 'wallPost', { kind: 'task', text: 'Ghost úkol GHOSTTXT' });
  ok(gp.ok, 'ghost posts on its team wall');
  ok(!has(await wall(B[0]), gp.id) && !(await wall(B[0]))._raw.includes('GHOSTTXT'), 'teammates do not see the ghost sticker');
  const gw = await wall(G);
  ok(find(gw, gp.id)?.mine === true, 'the ghost sees its own sticker (mine)');
  ok(find(await dwall(T[1]), gp.id)?.ghost === true, 'the dealer sees it, marked ghost');
  const gr = await c.st(G, 'wallReply', { id: qB.id, text: 'Ghost odpověď GHOSTREPLY' });
  ok(gr.ok, 'ghost replies on a teammate sticker');
  ok(!(await wall(B[0]))._raw.includes('GHOSTREPLY'), 'teammates do not see the ghost reply');
  ok(find(await wall(G), qB.id).replies.some((r) => r.id === gr.id && r.mine), 'the ghost sees its reply');
  ok(find(await dwall(T[1]), qB.id).replies.some((r) => r.id === gr.id && r.ghost), 'the dealer sees the ghost reply');
  ok(!(await c.st(B[0], 'wallReply', { id: gp.id, text: 'x' })).ok, 'a teammate cannot reply to the ghost sticker');
  ok(!(await c.st(B[0], 'wallDone', { id: gp.id, done: true })).ok, 'a teammate cannot tick the ghost task');
  ok(!(await c.st(G, 'wallDone', { id: gid(walls[1]), done: true })).ok, 'the ghost cannot tick a real team task');
  ok((await c.st(G, 'wallDone', { id: gp.id, done: true })).ok, 'the ghost ticks its own task');
  ok((await c.me(B[0])).me.wallRev === revG, 'ghost writes do not move the team badge');
  ok(!has(await wall(A[0]), gp.id), 'other teams never see it');

  section('concurrency');
  const target = await c.st(A[0], 'wallPost', { kind: 'q', text: 'Paralelní odpovědi' });
  const rr = await Promise.all(Array.from({ length: 18 }, (_, i) => c.st(A[i % 3], 'wallReply', { id: target.id, text: 'Odpověď ' + i })));
  ok(rr.every((r) => r.ok), `18 concurrent replies accepted (${rr.filter((r) => !r.ok).map((r) => r.error).slice(0, 2)})`);
  const tw = find(await wall(A[1]), target.id);
  ok(tw.replies.length === 18 && new Set(tw.replies.map((r) => r.text)).size === 18, `all 18 replies on the sticker, none lost (${tw.replies.length})`);
  const before = (await wall(A[0])).stickers.length;
  const pp = await Promise.all(Array.from({ length: 18 }, (_, i) => c.st(S[i], 'wallPost', { kind: i % 2 ? 'q' : 'task', text: 'Paralelně ' + i })));
  ok(pp.every((r) => r.ok), '18 concurrent posts across all teams accepted');
  ok((await wall(A[0])).stickers.length === before + 3, 'team A got its 3');
  const ovc = await c.dget('?view=wall&team=all');
  ok(T.every((t) => ovc.walls[t].filter((s) => /^Paralelně /.test(s.text)).length === 3), 'every team got exactly its 3');
  const conc = await Promise.all([c.st(A[0], 'wallDone', { id: t1.id, done: true }), c.st(A[1], 'wallReply', { id: t1.id, text: 'souběžně' }), c.dealer('wallReply', { team: T[0], id: t1.id, text: 'MUP souběžně' })]);
  const ct = find(await wall(A[0]), t1.id);
  ok(conc.every((r) => r.ok) && ct.done && ct.replies.some((r) => r.text === 'souběžně') && ct.replies.some((r) => r.text === 'MUP souběžně'), 'done + student reply + dealer reply at once: nothing overwritten');

  section('limits');
  const lim = await c.st(Cc[0], 'wallPost', { kind: 'q', text: 'Sto odpovědí' });
  const have = 0;
  const rl = await batches(100 - have, 25, (i) => c.st(Cc[i % 3], 'wallReply', { id: lim.id, text: 'r' + i }));
  ok(rl.every((r) => r.ok), '100 replies accepted');
  const r101 = await c.st(Cc[0], 'wallReply', { id: lim.id, text: 'stoprvní' });
  ok(!r101.ok && /100/.test(r101.error), `101st reply refused (${r101.error})`);
  ok(!(await c.dealer('wallReply', { team: T[2], id: lim.id, text: 'stoprvní' })).ok, 'also for the dealer');
  const nowC = (await dwall(T[2])).stickers.length;
  const pl = await batches(300 - nowC, 30, (i) => c.st(Cc[i % 3], 'wallPost', { kind: 'q', text: 'plno ' + i }));
  ok(pl.every((r) => r.ok) && (await dwall(T[2])).stickers.length === 300, `team C filled to 300 stickers (${pl.filter((r) => !r.ok).length} failed)`);
  const s301 = await c.st(Cc[0], 'wallPost', { kind: 'q', text: 'tři sta první' });
  ok(!s301.ok && /300/.test(s301.error), `301st sticker refused (${s301.error})`);
  ok(!(await c.dealer('wallPost', { team: T[2], kind: 'q', text: 'x' })).ok, 'dealer post to the full wall refused');
  const allFull = await c.dealer('wallPost', { all: true, kind: 'task', text: 'Všem kromě plného' });
  ok(allFull.ok && allFull.full?.includes(T[2]) && !allFull.teams.includes(T[2]) && allFull.teams.length === T.length - 1, `send-to-all skips the full wall (full: ${allFull.full})`);
  ok((await c.st(Cc[0], 'wallReply', { id: lim.id, text: 'x' })).ok === false && (await c.st(Cc[0], 'wallDelete', { id: lim.id })).ok, 'a full wall still allows deleting');
  ok((await c.st(Cc[0], 'wallPost', { kind: 'q', text: 'zase místo' })).ok, 'after a delete there is room again');

  section('data view');
  const dv = await c.dget('?view=data');
  ok(dv.ok && dv.walls && T.every((t) => Array.isArray(dv.walls[t])) && dv.walls[T[1]].some((s) => s.id === gp.id && s.ghost), 'view=data has walls per team (ghost marked)');
  ok((await c.get('?view=data'))._status === 401, 'view=data needs the dealer header');

  section('dump → wipe → restore');
  const dump = await c.dump();
  ok(dump?.walls && T.every((t) => dump.walls[t] && Object.keys(dump.walls[t]).every((f) => /^(s|r|d):/.test(f))), 'dump has walls per team, fields s:/r:/d:');
  ok(Object.keys(dump.walls[T[0]]).some((f) => f.startsWith('d:')) && Object.keys(dump.walls[T[0]]).some((f) => f.startsWith('r:')), 'dump keeps done states and replies');
  const ovBefore = await c.dget('?view=wall&team=all');
  const revsBefore = ovBefore.revs;
  await wipe();
  ok((await c.dget('?view=wall&team=' + T[0])).stickers?.length === 0 || !(await c.dget('?view=wall&team=' + T[0])).ok, 'server wiped');
  const rst = await c.dealer('restore', { dump });
  ok(rst.ok && rst.restored, 'restore ok');
  const ovAfter = await c.dget('?view=wall&team=all');
  ok(JSON.stringify(ovAfter.walls) === JSON.stringify(ovBefore.walls), 'every wall identical after the restore (stickers, replies, done, ghosts)');
  ok(JSON.stringify(ovAfter.revs) === JSON.stringify(revsBefore), 'wallRev restored with meta');
  ok(find(await wall(A[0]), q1.id) && !(await wall(B[0]))._raw.includes('GHOSTTXT'), 'privacy holds after the restore');
  await c.dealer('restore', { dump });
  ok(JSON.stringify((await c.dget('?view=wall&team=all')).walls) === JSON.stringify(ovBefore.walls), 'restoring twice does not duplicate anything');
  // a newer done state on the server is not overwritten by an older dump
  await c.st(A[0], 'wallDone', { id: t1.id, done: false });
  await c.dealer('restore', { dump });
  ok(find(await wall(A[0]), t1.id).done === false, 'restore keeps a newer done state');
  const old = structuredClone(dump);
  delete old.walls;
  await wipe();
  const ro = await c.dealer('restore', { dump: old });
  ok(ro.ok && ro.restored, 'an old dump without walls still restores');
  const ow = await c.dget('?view=wall&team=all');
  ok(ow.ok && T.every((t) => ow.walls[t].length === 0), 'walls empty after the old dump');
  ok((await c.st(A[0], 'wallPost', { kind: 'q', text: 'po obnově' })).ok, 'students post again after the restore');
  await c.dealer('restore', { dump });
  ok(find(await wall(A[0]), q1.id) && (await wall(A[0])).stickers.some((s) => s.text === 'po obnově'), 'a later full dump merges in without losing new stickers');

  section('feature switch');
  ok((await c.dealer('features', { set: { wall: false } })).ok, 'wall switched off');
  const off1 = await c.st(A[0], 'wallPost', { kind: 'q', text: 'x' });
  const off2 = await wall(A[0]);
  const off3 = await c.dealer('wallPost', { team: T[0], kind: 'q', text: 'x' });
  ok(!off1.ok && !off2.ok && !off3.ok && off1.error === 'Tato funkce je vypnutá.', `ops and views refused while off (${off1.error})`);
  ok((await c.me(A[0])).me.wallRev === undefined, 'no wallRev while off');
  await c.dealer('features', { set: { wall: true } });
  ok(has(await wall(A[0]), q1.id), 'switched on again: wall intact');

  if (MODE === 'redis') {
    section('Redis flush');
    const pre = await c.dget('?view=wall&team=all');
    await mock.flush();
    info('mock Redis flushed');
    const post = await c.dget('?view=wall&team=all');
    ok(JSON.stringify(post.walls) === JSON.stringify(pre.walls), 'every wall read back from Postgres after the flush');
    await mock.flush();
    const fr = await c.st(A[1], 'wallReply', { id: q1.id, text: 'po flushi' });
    ok(fr.ok, 'reply right after a second flush (write before any read)');
    const fw = find(await wall(A[0]), q1.id);
    ok(fw && fw.replies.some((r) => r.text === 'po flushi') && fw.replies.length === find({ stickers: pre.walls[T[0]] }, q1.id).replies.length + 1, 'old replies kept, new one added (hash refilled before the write)');
    ok(JSON.stringify((await c.dget('?view=wall&team=all')).walls[T[3]]) === JSON.stringify(pre.walls[T[3]]), 'untouched walls intact');
    await mock.flush();
    const fp = await c.st(B[0], 'wallPost', { kind: 'task', text: 'po flushi B' });
    const wb2 = await wall(B[0]);
    ok(fp.ok && has(wb2, fp.id) && has(wb2, qB.id) && !wb2._raw.includes('GHOSTTXT'), 'post after a flush keeps the rest of the wall, ghost still hidden');
    await mock.flush();
    ok((await c.st(A[0], 'wallDelete', { id: q1.id })).ok && !has(await wall(A[0]), q1.id), 'delete right after a flush sticks');
    ok((await c.me(A[0])).me.wallRev > 0, 'wallRev survives the flush (meta from Postgres)');
  }

  section('reset');
  await c.dealer('reset', { confirm: 'RESET', keepPlayers: true });
  const rw = await c.dget('?view=wall&team=all');
  ok(rw.ok && T.every((t) => rw.walls[t].length === 0), 'reset clears every wall');
  ok((await c.me(A[0])).me.wallRev === 0, 'wallRev back to 0');
  await srv.stop();
});
