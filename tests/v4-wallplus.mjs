// @self-managed: starts (and wipes) its own server on E_PORT in E_MODE storage, with DEALER_LOCK=1 so the dealer header matters.
// v4 wallplus: reactions (18 concurrent users), pins, accepted answers, task due/assignee, send-to-all questions,
// dealer templates, archives with walls, tombstones on restore, the feature switch, and privacy for every new op.
import { execSync } from 'node:child_process';
import { ok, info, section, main, client, startServer, startMock, freshGame, MODE, MOCK_PORT, PG_URL, OFF } from './_e-lib.mjs';

const PORT = Number(process.env.E_PORT || 3331);
const TAG = 'tagE' + PORT;
const OTHER = 'Tahle nástěnka patří jinému týmu.';
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
async function boot() { srv = await startServer({ port: PORT, tag: TAG, mode: MODE, env: { DEALER_LOCK: '1', DEALER_PASSWORD: 'mup-dealer' } }); c = client(srv.base); }
async function wipe() { await srv.stop(); if (MODE === 'redis') await mock.flush(); await wipeDb(); await boot(); }
const H = (s) => ({ 'x-sid': s.sid, 'x-pin': s.pin });
const wall = (s, team) => c.get('?view=wall' + (team ? '&team=' + encodeURIComponent(team) : ''), H(s));
const dwall = (team) => c.dget('?view=wall&team=' + encodeURIComponent(team));
const find = (w, id) => (w?.stickers || []).find((x) => x.id === id);
const has = (w, id) => !!find(w, id);
const rx = (x, code) => x?.reactions?.[code] || { n: 0, mine: false };
const EMO = ['up', 'heart', 'lol', 'think', 'fire'];

await main(async () => {
  if (MODE === 'redis') {
    let up = false;
    try { await fetch(`http://localhost:${MOCK_PORT}/__stats`); up = true; } catch {}
    mock = up ? { flush: () => fetch(`http://localhost:${MOCK_PORT}/__flush`).then((r) => r.text()) } : await startMock(MOCK_PORT);
  }
  await wipeDb();
  await boot();
  info(`storage ${(await c.get()).storage}`);
  const { T, S, G } = await freshGame(c, { n: 18, ghost: true });
  const A = S.filter((s) => s.team === T[0]), B = S.filter((s) => s.team === T[1]), Cc = S.filter((s) => s.team === T[2]);
  ok(A.length === 3 && B.length === 3 && G?.sid, 'fresh game: 6 teams, 3 students each, a ghost on team 2');
  ok((await c.get()).features?.wallplus === true, 'feature wallplus is on by default');

  section('reactions');
  const q = await c.st(A[0], 'wallPost', { kind: 'q', text: 'Kdo pošle pitch? TAJNE-A-Q' });
  ok(q.ok, 'team A posts a question');
  let s = find(await wall(A[1]), q.id);
  ok(s && s.reactions && Object.keys(s.reactions).length === 0 && s.pinned === false && s.accepted === null, 'v4 fields: no reactions, not pinned, no accepted answer');
  // the whole team plus the dealer, all five emoji at once: 20 writes on one hash
  const burst = await Promise.all([...A.flatMap((st) => EMO.map((e) => c.st(st, 'wallReact', { id: q.id, emoji: e, on: true }))),
    ...EMO.map((e) => c.dealer('wallReact', { team: T[0], id: q.id, emoji: e, on: true }))]);
  ok(burst.every((r) => r.ok), `20 concurrent reactions on one sticker accepted (${burst.filter((r) => !r.ok).map((r) => r.error)[0] || ''})`);
  s = find(await wall(A[2]), q.id);
  ok(EMO.every((e) => rx(s, e).n === 4 && rx(s, e).mine === true), `every emoji counts 4 (3 students + MUP), none lost (${EMO.map((e) => rx(s, e).n)})`);
  // 18 students across all 6 teams react at the same moment on their own team's copy of a send-to-all question
  const gq = await c.dealer('wallPost', { all: true, kind: 'q', text: 'Všem: jak jde rozhovor se zákazníky?' });
  ok(gq.ok && gq.group && gq.teams.length === 6, 'dealer sends a question to all 6 teams');
  const gids = {};
  for (const t of T) gids[t] = (await dwall(t)).stickers.find((x) => x.group === gq.group).id;
  const rr = await Promise.all(S.flatMap((st, i) => [c.st(st, 'wallReact', { id: gids[st.team], emoji: 'fire', on: true }), c.st(st, 'wallReact', { id: gids[st.team], emoji: EMO[i % 5] === 'fire' ? 'up' : EMO[i % 5], on: true })]));
  ok(rr.every((r) => r.ok), `18 users × 2 concurrent reactions accepted (${rr.filter((r) => !r.ok).length} failed)`);
  const ws = await Promise.all(T.map((t) => dwall(t)));
  ok(ws.every((w, i) => rx(w.stickers.find((x) => x.group === gq.group), 'fire').n === 3), `every team's copy has exactly its 3 🔥 (${ws.map((w) => rx(w.stickers.find((x) => x.group === gq.group), 'fire').n)})`);
  ok(ws.every((w) => Object.values(w.stickers.find((x) => x.group === gq.group).reactions).reduce((a, x) => a + x.n, 0) === 6), 'and 6 reactions in total per copy: nothing crossed teams');
  ok((await c.st(A[0], 'wallReact', { id: q.id, emoji: 'up', on: false })).ok, 'toggle own 👍 off');
  s = find(await wall(A[0]), q.id);
  ok(rx(s, 'up').n === 3 && rx(s, 'up').mine === false && rx(find(await wall(A[1]), q.id), 'up').mine === true, 'count 3, mine false for A1, still mine for A2');
  ok((await c.st(A[0], 'wallReact', { id: q.id, emoji: 'up', on: false })).ok && rx(find(await wall(A[0]), q.id), 'up').n === 3, 'toggling off twice is idempotent');
  ok((await c.st(A[0], 'wallReact', { id: q.id, emoji: '🔥', on: true })).ok && rx(find(await wall(A[0]), q.id), 'fire').n === 4, 'the emoji itself works too and adding twice still counts once');
  const bad = await c.st(A[0], 'wallReact', { id: q.id, emoji: '💩', on: true });
  ok(!bad.ok && bad.error === 'Tuhle reakci neznám.', `unknown emoji refused in Czech (${bad.error})`);
  const r1 = await c.st(A[1], 'wallReply', { id: q.id, text: 'Já, zítra.' });
  const r2 = await c.st(A[2], 'wallReply', { id: q.id, text: 'Nebo já.' });
  ok((await c.st(A[0], 'wallReact', { id: q.id, reply: r1.id, emoji: 'heart', on: true })).ok, 'react on a reply');
  ok((await c.dealer('wallReact', { team: T[0], id: q.id, reply: r1.id, emoji: 'heart', on: true })).ok, 'dealer reacts on a reply');
  s = find(await wall(A[2]), q.id);
  const sr1 = s.replies.find((r) => r.id === r1.id);
  ok(rx(sr1, 'heart').n === 2 && rx(sr1, 'heart').mine === false && rx(s, 'heart').n === 4, 'reply reactions counted on the reply, separate from the sticker\'s');
  ok(!(await c.st(A[0], 'wallReact', { id: q.id, reply: 'nope', emoji: 'up', on: true })).ok, 'reaction on an unknown reply refused');
  const gr = await c.st(G, 'wallReact', { id: (await wall(B[0])).stickers.find((x) => x.group === gq.group).id, emoji: 'lol', on: true });
  ok(gr.ok, 'the ghost reacts on its team\'s sticker');
  const gB = (await wall(B[0])).stickers.find((x) => x.group === gq.group), gG = (await wall(G)).stickers.find((x) => x.group === gq.group), gD = (await dwall(T[1])).stickers.find((x) => x.group === gq.group);
  ok(rx(gG, 'lol').mine === true && rx(gD, 'lol').n === rx(gB, 'lol').n + 1, `the ghost's reaction counts only for the ghost and the dealer (team ${rx(gB, 'lol').n}, dealer ${rx(gD, 'lol').n})`);

  section('pins');
  const t1 = await c.st(A[1], 'wallPost', { kind: 'task', text: 'Starší úkol TAJNE-A-T' });
  let pn = await c.st(A[1], 'wallPin', { id: q.id, on: true });
  ok(!pn.ok && pn._status === 403 && pn.error === 'Připnout může jen autor lístečku nebo MUP.', `a teammate cannot pin someone else's sticker (${pn.error})`);
  ok(find(await wall(A[1]), q.id).canPin === false && find(await wall(A[0]), q.id).canPin === true && find(await dwall(T[0]), q.id).canPin === true, 'canPin: author and dealer only');
  const t2 = await c.st(A[2], 'wallPost', { kind: 'task', text: 'Nejnovější úkol' });
  ok((await c.st(A[0], 'wallPin', { id: q.id, on: true })).ok, 'the author pins');
  let wA = await wall(A[2]);
  ok(wA.stickers[0].id === q.id && wA.stickers[0].pinned === true && wA.stickers[0].pinBy?.name === A[0].name, 'pinned sticker is first, with pinBy');
  ok((await c.dealer('wallPin', { team: T[0], id: t1.id, on: true })).ok, 'the dealer pins a student task');
  wA = await wall(A[0]);
  ok(wA.stickers.slice(0, 2).every((x) => x.pinned) && wA.stickers[2].pinned === false && wA.stickers[2].id === t2.id, 'both pinned stickers first, then the newest');
  ok((await c.st(A[0], 'wallPin', { id: q.id, on: false })).ok && find(await wall(A[0]), q.id).pinned === false, 'unpin');

  section('accepted answer');
  let ac = await c.st(A[1], 'wallAccept', { id: q.id, reply: r1.id });
  ok(!ac.ok && ac._status === 403 && ac.error === 'Odpověď může označit jen ten, kdo se ptal, nebo MUP.', `a teammate cannot mark the answer (${ac.error})`);
  ok((await c.st(A[0], 'wallAccept', { id: q.id, reply: r1.id })).ok, 'the asker marks a reply as „Odpověď“');
  s = find(await wall(A[2]), q.id);
  ok(s.accepted === r1.id && s.replies.find((r) => r.id === r1.id).accepted === true && !s.replies.find((r) => r.id === r2.id).accepted, 'accepted reply id on the sticker and accepted: true on the reply');
  ok((await c.dealer('wallAccept', { team: T[0], id: q.id, reply: r2.id })).ok && find(await wall(A[0]), q.id).accepted === r2.id, 'the dealer switches it to another reply');
  ok(!(await c.st(A[0], 'wallAccept', { id: t1.id, reply: null })).ok, 'accept on a task refused');
  const other = await c.st(A[0], 'wallPost', { kind: 'q', text: 'jiná otázka' });
  const or1 = await c.st(A[1], 'wallReply', { id: other.id, text: 'odpověď jinde' });
  ok(!(await c.st(A[0], 'wallAccept', { id: q.id, reply: or1.id })).ok, 'a reply of another sticker cannot be accepted');
  ok((await c.st(A[2], 'wallDelete', { id: q.id, reply: r2.id })).ok && find(await wall(A[0]), q.id).accepted === null, 'deleting the accepted reply clears the answer');
  ok((await c.st(A[0], 'wallAccept', { id: q.id, reply: r1.id })).ok && (await c.st(A[0], 'wallAccept', { id: q.id, reply: null })).ok && find(await wall(A[0]), q.id).accepted === null, 'accept and un-accept');
  await c.st(A[0], 'wallAccept', { id: q.id, reply: r1.id });

  section('task details: due + assignee');
  const past = Date.now() - 3600e3;
  const td = await c.st(A[0], 'wallPost', { kind: 'task', text: 'Do 10:30 rozhovory', due: '10:30', dueTs: past, assign: A[1].sid });
  ok(td.ok, `task with due time and assignee (${td.error || ''})`);
  s = find(await wall(A[2]), td.id);
  ok(s.due?.kind === 'time' && s.due.at === '10:30' && s.due.ts === past && s.overdue === true, 'due time kept, overdue when the time has passed');
  ok(s.assign?.id === A[1].sid && s.assign.name === A[1].name && s.assignedToMe === false && find(await wall(A[1]), td.id).assignedToMe === true, 'assignee name, assignedToMe only for that student');
  const tb = await c.st(A[1], 'wallPost', { kind: 'task', text: 'Do konce bloku slidy', due: 'block', assign: 'all' });
  s = find(await wall(A[2]), tb.id);
  ok(tb.ok && s.due?.kind === 'block' && s.due.block === 1 && s.overdue === false && s.assign?.all === true && s.assignedToMe === true, '„do konce bloku“ + „celý tým“: not overdue yet, assigned to everyone');
  const fut = await c.st(A[1], 'wallPost', { kind: 'task', text: 'Za hodinu', due: '23:59', dueTs: Date.now() + 3600e3 });
  ok(find(await wall(A[0]), fut.id).overdue === false, 'a future due time is not overdue');
  for (const [x, m, e] of [[{ due: 'zítra' }, 'a bad due', 'Termín zadej jako čas, třeba 10:30, nebo „do konce bloku“.'], [{ due: '25:00' }, 'hour 25', null], [{ assign: B[0].sid }, 'an assignee from another team', 'Úkol jde přidělit jen členovi týmu.'], [{ assign: 'nobody1' }, 'an unknown assignee', null]]) {
    const r = await c.st(A[0], 'wallPost', { kind: 'task', text: 'špatně', ...x });
    ok(!r.ok && (!e || r.error === e), `refused: ${m} (${r.error})`);
  }
  ok(!(await c.st(B[0], 'wallPost', { kind: 'task', text: 'pro ducha', assign: G.sid })).ok, 'a teammate cannot assign the ghost (would reveal it)');
  const gt = await c.st(G, 'wallPost', { kind: 'task', text: 'duch sám sobě', assign: G.sid });
  ok(gt.ok && find(await wall(G), gt.id).assignedToMe === true && !has(await wall(B[0]), gt.id), 'the ghost assigns itself on its own (hidden) task');
  let te = await c.st(A[2], 'wallTask', { id: td.id, due: '' });
  ok(!te.ok && te._status === 403 && te.error === 'Upravit úkol může jen jeho autor nebo MUP.', `a teammate cannot edit someone else's task (${te.error})`);
  ok((await c.st(A[0], 'wallTask', { id: td.id, due: '' })).ok, 'the author clears the due time');
  s = find(await wall(A[0]), td.id);
  ok(s.due === null && s.overdue === false && s.assign?.id === A[1].sid, 'due cleared, assignee kept');
  ok((await c.dealer('wallTask', { team: T[0], id: td.id, assign: A[2].sid, due: '9:05', dueTs: past })).ok, 'the dealer reassigns and sets a time');
  s = find(await wall(A[2]), td.id);
  ok(s.assign.id === A[2].sid && s.assignedToMe === true && s.due.at === '9:05' && s.overdue === true, 'dealer edit applied');
  ok(!(await c.st(A[0], 'wallTask', { id: q.id, due: 'block' })).ok, 'wallTask on a question refused');
  await c.st(A[1], 'wallDone', { id: td.id, done: true });
  ok(find(await wall(A[0]), td.id).overdue === false, 'a done task is never overdue');
  ok(find(await wall(A[0]), q.id).due === undefined && find(await wall(A[0]), q.id).canEdit === false, 'questions have no due / edit');

  section('send to all: questions too, with the dealer overview');
  let ov = await c.dget('?view=wall&team=all');
  let g = ov.groups?.find((x) => x.group === gq.group);
  ok(g && g.kind === 'q' && g.total === 6 && g.answered === 0 && g.teams.length === 6, 'dealer overview lists the question group, 0/6 answered');
  await c.st(A[0], 'wallReply', { id: gids[T[0]], text: 'Dobře, díky' });
  await c.st(B[0], 'wallReply', { id: gids[T[1]], text: 'Ještě nevíme' });
  ov = await c.dget('?view=wall&team=all');
  g = ov.groups.find((x) => x.group === gq.group);
  ok(g.answered === 2 && g.teams.find((x) => x.team === T[0]).replies === 1, `answered 2/6 (${g.answered})`);
  const ga = await c.dealer('wallPost', { all: true, kind: 'task', text: 'Všichni: slidy do konce bloku', due: 'block', assign: 'all' });
  ok(ga.ok, 'dealer sends a task to all with „do konce bloku“ and „celý tým“');
  ok(!(await c.dealer('wallPost', { all: true, kind: 'task', text: 'x', assign: A[0].sid })).ok, 'send-to-all with one student as assignee refused');
  const gaw = await wall(Cc[0]);
  const gac = gaw.stickers.find((x) => x.group === ga.group);
  ok(gac?.due?.kind === 'block' && gac.assign?.all === true, 'every copy carries the task details');
  ok((await c.st(Cc[0], 'wallDone', { id: gac.id, done: true })).ok, 'team C ticks its copy');
  g = (await c.dget('?view=wall&team=all')).groups.find((x) => x.group === ga.group);
  ok(g.total === 6 && g.done === 1 && g.teams.find((x) => x.team === T[2]).done === true, `„Hotovo 1/6 týmů“ (${g.done}/${g.total})`);
  const sAll = await c.st(A[0], 'wallPost', { kind: 'q', text: 'student all', all: true });
  ok(sAll.ok && !sAll.group && !has(await wall(B[0]), sAll.id), 'a student\'s all: true is ignored (own team only)');
  ok((await wall(A[0])).groups === undefined && (await wall(A[0])).templates === undefined, 'students never get groups or templates');

  section('dealer templates');
  let tp = await c.dealer('wallTplSave', { kind: 'task', text: 'Šablona TPLTAJNE: nahrajte deck', due: 'block' });
  ok(tp.ok && tp.templates?.length === 1 && tp.templates[0].due === 'block' && tp.templates[0].kind === 'task', 'dealer saves a template (kind, text, due)');
  ok(!(await c.dealer('wallTplSave', { kind: 'task', text: 'Šablona TPLTAJNE: nahrajte deck' })).ok, 'a duplicate template refused');
  const stp = await c.st(A[0], 'wallTplSave', { kind: 'q', text: 'moje šablona' });
  ok(!stp.ok && stp._status === 403 && stp.error === 'Šablony může ukládat jen MUP.', `a student cannot save a template (${stp.error})`);
  ok(!(await c.st(A[0], 'wallTplDelete', { tpl: tp.templates[0].id })).ok, 'nor delete one');
  ok(!(await c.post({ op: 'wallTplSave', kind: 'q', text: 'x' })).ok, 'template op without the dealer header refused');
  for (let i = 2; i <= 30; i++) await c.dealer('wallTplSave', { kind: i % 2 ? 'q' : 'task', text: 'Šablona ' + i });
  const t31 = await c.dealer('wallTplSave', { kind: 'q', text: 'Šablona 31' });
  ok(!t31.ok && /30/.test(t31.error), `31st template refused (${t31.error})`);
  const dv1 = await dwall(T[0]);
  ok(dv1.templates?.length === 30 && (await c.dget('?view=wall&team=all')).templates.length === 30, 'dealer views carry 30 templates');
  tp = await c.dealer('wallTplDelete', { tpl: dv1.templates[1].id });
  ok(tp.ok && tp.templates.length === 29 && !tp.templates.some((x) => x.id === dv1.templates[1].id), 'delete a template');
  ok(!(await c.dealer('wallTplDelete', { tpl: 'nope' })).ok, 'delete an unknown template refused');
  const leak = [await c.get(), await c.me(A[0]), await c.me(B[0]), await wall(A[0]), await wall(B[0]), await wall(G)].map((x) => x._raw).join('');
  ok(!leak.includes('TPLTAJNE'), 'no template text in any student response');

  section('privacy for every new op');
  const probes = [['wallReact', { emoji: 'up', on: true }], ['wallPin', { on: true }], ['wallAccept', { reply: r1.id }], ['wallTask', { due: 'block' }]];
  for (const [op, x] of probes) {
    const id = op === 'wallAccept' ? q.id : op === 'wallTask' ? t1.id : q.id;
    const a1 = await c.st(B[0], op, { ...x, team: T[0], id });
    ok(!a1.ok && a1.error === OTHER && a1._status === 403, `${op} naming another team refused (${a1.error})`);
    const a2 = await c.st(B[0], op, { ...x, id });
    ok(!a2.ok && !a2._raw.includes('TAJNE'), `${op} on another team's sticker id refused (${a2.error})`);
    const a3 = await c.post({ op, team: T[0], id, ...x });
    ok(!a3.ok && a3._status === 401, `dealer ${op} without the header refused`);
    const a4 = await c.st(B[0], op, { ...x, id: gt.id });
    ok(!a4.ok && a4.error === 'Lísteček nenalezen.', `${op} on the ghost's hidden sticker: „not found“ for a teammate`);
  }
  const wB = await wall(B[0]);
  ok(!wB._raw.includes('TAJNE-A') && wB.members.every((m) => m.id !== G.sid) && !wB.members.some((m) => A.some((a) => a.sid === m.id)), 'team B sees no team A text or members, and no ghost in its member list');
  ok((await wall(G)).members.some((m) => m.id === G.sid) && (await dwall(T[1])).members.some((m) => m.id === G.sid), 'the ghost and the dealer see the ghost as a member');
  const plain = [await c.get(), await c.me(A[0]), await c.me(B[0])].map((x) => x._raw).join('');
  ok(!plain.includes('TAJNE') && !plain.includes('"reactions"'), 'no sticker text or reactions in any plain GET');

  section('archives keep the walls');
  const before = await c.dget('?view=wall&team=all');
  const arc = await c.dealer('archive', { label: 'Ruční se zdmi' });
  ok(arc.ok && arc.id, 'manual archive');
  const ar = await c.dget('?view=archive&id=' + arc.id);
  const aw = ar.archive?.dump?.walls;
  ok(aw && T.every((t) => aw[t] && Object.keys(aw[t]).some((f) => f.startsWith('s:'))), 'the archive dump has every team wall');
  ok(Object.keys(aw[T[0]]).some((f) => f.startsWith('x:')) && Object.keys(aw[T[0]]).some((f) => f.startsWith('p:')) && Object.keys(aw[T[0]]).some((f) => f.startsWith('a:')) && Object.keys(aw[T[0]]).some((f) => f.startsWith('m:')), 'with reactions, pins, accepted answers and task details');
  const nb = await c.dealer('nextBlock');
  ok(nb.ok, `next block (${nb.error || ''})`);
  const list = (await c.dget('?view=archives')).archives || [];
  const pb = list.find((x) => x.label === 'Před blokem 2');
  ok(pb, 'archive „Před blokem 2“ created');
  const pbw = (await c.dget('?view=archive&id=' + pb.id)).archive?.dump?.walls;
  ok(pbw && Object.keys(pbw[T[0]] || {}).length > 0, '„Před blokem 2“ keeps the walls too');
  ok(find(await wall(A[0]), tb.id).overdue === true, '„do konce bloku“ task is overdue in the next block');

  section('tombstones: restore never resurrects deleted stickers');
  const old = (await c.dget('?view=archive&id=' + arc.id)).archive.dump;
  const delS = await c.st(A[1], 'wallDelete', { id: t1.id });
  ok(delS.ok, 'delete a sticker (pinned, after the archive)');
  const delR = await c.st(A[0], 'wallDelete', { id: other.id, reply: or1.id });
  ok(!delR.ok, 'a student cannot delete a teammate\'s reply (still v3)');
  ok((await c.dealer('wallDelete', { team: T[0], id: other.id, reply: or1.id })).ok, 'the dealer deletes a reply');
  const dmp = await c.dump();
  ok(dmp.walls[T[0]]['t:' + t1.id]?.ts > 0 && dmp.walls[T[0]][`t:${other.id}.${or1.id}`]?.ts > 0, 'tombstones t:<id> and t:<id>.<reply> are in the dump');
  ok(!Object.keys(dmp.walls[T[0]]).some((f) => !f.startsWith('t:') && f.includes(t1.id)), 'every other field of the deleted sticker is gone (pin, details, reactions)');
  const rs1 = await c.dealer('restore', { dump: old });
  ok(rs1.ok, 'restore the older archive dump');
  wA = await dwall(T[0]);
  ok(!has(wA, t1.id) && !find(wA, other.id).replies.some((r) => r.id === or1.id), 'the deleted sticker and the deleted reply stay deleted');
  ok(has(wA, q.id) && find(wA, q.id).accepted === r1.id, 'everything else is still there');
  // full loss: wipe, restore the newest dump (with tombstones), then the old archive again
  await wipe();
  ok((await c.dealer('restore', { dump: dmp })).ok, 'restore the newest dump after a wipe');
  ok((await c.dealer('restore', { dump: old })).ok && !has(await dwall(T[0]), t1.id), 'the older archive restored on top still cannot bring the sticker back');
  // a dump's tombstone removes what the server still has
  await wipe();
  await c.dealer('restore', { dump: old });
  ok(has(await dwall(T[0]), t1.id), 'after a wipe the old archive alone brings the sticker back (no tombstone known)');
  await c.dealer('restore', { dump: dmp });
  ok(!has(await dwall(T[0]), t1.id), 'restoring the newer dump with the tombstone deletes it again');
  // archive round trip: the walls come back exactly as they were archived
  await wipe();
  ok((await c.dealer('restore', { dump: old })).ok, 'restore the archive into an empty server');
  const after = await c.dget('?view=wall&team=all');
  const norm = (w) => JSON.stringify(Object.fromEntries(Object.entries(w).map(([t, l]) => [t, l.map((x) => ({ ...x, overdue: undefined }))])));
  ok(norm(after.walls) === norm(before.walls), 'archive round trip: every wall identical (stickers, replies, reactions, pins, answers, details)');
  ok(JSON.stringify(after.templates) === JSON.stringify(before.templates), 'templates come back with meta');
  ok(!(await wall(B[0]))._raw.includes('TAJNE-A'), 'privacy holds after the restore');

  section('feature switch');
  ok((await c.dealer('features', { set: { wallplus: false } })).ok, 'wallplus switched off');
  const o1 = await c.st(A[0], 'wallReact', { id: q.id, emoji: 'up', on: true });
  const o2 = await c.dealer('wallTplSave', { kind: 'q', text: 'x' });
  ok(!o1.ok && o1.error === OFF && !o2.ok && o2.error === OFF, 'new ops refused while off');
  const vo = await wall(A[0]);
  const so = find(vo, q.id);
  ok(so && !('reactions' in so) && !('pinned' in so) && !('accepted' in so) && !('canPin' in so) && vo.members === undefined, 'v3 sticker shape while off');
  ok((await dwall(T[0])).templates === undefined && (await c.dget('?view=wall&team=all')).groups === undefined, 'no templates / groups while off');
  const po = await c.st(A[0], 'wallPost', { kind: 'task', text: 'bez detailů', due: '10:30', assign: A[1].sid });
  ok(po.ok, 'v3 post still works');
  await c.dealer('features', { set: { wallplus: true } });
  ok(find(await wall(A[0]), po.id).due === null && find(await wall(A[0]), po.id).assign === null, 'details sent while off were ignored');
  ok(rx(find(await wall(A[1]), q.id), 'heart').n === 4, 'switched on again: reactions intact');

  section('templates are course-level: undo and reset keep them');
  const nT = (await dwall(T[0])).templates.length;
  ok(nT === 29, `29 templates before (${nT})`);
  await c.dealer('nextBlock');
  await c.dealer('wallTplSave', { kind: 'q', text: 'Šablona po bloku' });
  ok((await c.dealer('undo')).ok && (await dwall(T[0])).templates.length === nT + 1, 'undo keeps a template saved after the backup');
  await c.dealer('reset', { confirm: 'RESET', keepPlayers: true });
  const rz = await c.dget('?view=wall&team=all');
  ok(rz.templates.length === nT + 1 && T.every((t) => rz.walls[t].length === 0), 'reset clears the walls but keeps the templates');
  await srv.stop();
});
