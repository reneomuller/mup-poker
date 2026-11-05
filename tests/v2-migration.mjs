// @self-managed: starts its own servers (old v2-base code, then the new code) on E_PORT, on Postgres (E_MODE mem|pg)
// or Redis+Postgres (E_MODE=redis, mock Upstash on MOCK_PORT).
// Production today: old code, 19 players, 19 submitted slips in block 1, phase "closed", showdown not run.
// We build exactly that through the OLD server's API, kill it, start the NEW code on the same storage and check nothing is lost.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ok, warnIf, info, section, main, client, startServer, startMock, wipePg, sleep, sum, sumAmt, shape, checkClean, invariants, FEATURE_DEFAULTS, REASON_LABELS, MILESTONES, ROOT, MODE, MOCK_PORT } from './_e-lib.mjs';

const PORT = Number(process.env.E_PORT || 3106);
const TAG = 'tagE' + PORT;
const mode = MODE === 'redis' ? 'redis' : 'pg';
const OLD = '/tmp/oldE';
const NAMES = ['Šimon Dvořák', 'Tereza Nováková', 'Jakub Černý', 'Anna Svobodová', 'Matěj Procházka', 'Eliška Kučerová', 'Vojtěch Veselý', 'Karolína Horáková',
  'Ondřej Němec', 'Natálie Marková', 'Filip Pokorný', 'Adéla Pospíšilová', 'Lukáš Hájek', 'Kristýna Jelínková', 'Dominik Král', 'Barbora Růžičková',
  'Tomáš Beneš', 'Veronika Fialová', 'Štěpán Sedláček'];
const TEAMS = ['Lumio', 'Parkly', 'Tutorix', 'GreenBox', 'Hrajsport', 'Vetly'];

await main(async () => {
  section(`migration in ${mode} mode`);
  execSync(`rm -rf ${OLD} && mkdir -p ${OLD} && git -C ${ROOT} archive v2-base api dev-server.js public package.json | tar -x -C ${OLD} && ln -sfn /home/claude/mup-poker/node_modules ${OLD}/node_modules`);
  ok(fs.existsSync(path.join(OLD, 'api/game.js')), 'old v2-base code extracted to /tmp/oldE');
  wipePg();
  let mock = null;
  if (mode === 'redis') mock = await startMock(MOCK_PORT);

  // ---------- 1. production state with the OLD code ----------
  let srv = await startServer({ port: PORT, tag: TAG, cwd: OLD, mode });
  let c = client(srv.base);
  let st = await c.get();
  ok(st.storage === (mode === 'redis' ? 'redis+postgres' : 'postgres'), `old server storage = ${st.storage}`);
  const T = st.teams.map((t) => t.id);
  await c.dealer('teams', { teams: T.map((id, i) => ({ id, name: TEAMS[i] })) });
  await c.dealer('content', { texts: { 'play.login.title': 'Investiční stůl – test' } });
  const S = [];
  for (let i = 0; i < 19; i++) {
    const team = T[i % 6], pin = String(3000 + i * 7).slice(-4);
    const r = await c.post({ op: 'register', name: NAMES[i], team, pin });
    S.push({ sid: r.sid, pin, team, name: NAMES[i] });
  }
  ok(S.every((s) => s.sid), '19 players registered on the old server');
  const g = await c.dealer('ghost', { team: T[2] });
  const G = { sid: g.sid, pin: g.pin, team: T[2] };
  // board questions exist in production too (the board is hidden in the UI but its data is real)
  const q1 = await c.st(S[0], 'ask', { team: T[1], cat: 'market', text: 'Kolik máte platících zákazníků?' });
  await c.st(S[2], 'vote', { qid: q1.id });
  await c.st(S[1], 'answer', { qid: q1.id, text: 'Zatím 12 pilotních.' });
  await c.dealer('phase', { phase: 'pitch', team: T[0] });
  await c.dealer('phase', { phase: 'betting', minutes: 10, label: 'Investujte' });
  const slips = {};
  for (let i = 0; i < 19; i++) {
    const s = S[i];
    const o = T.filter((t) => t !== s.team);
    const a = o[i % 5], b = o[(i + 1) % 5], c3 = o[(i + 3) % 5];
    const x = 300000 + 10000 * i, y = 200000 + 10000 * (i % 7);
    const inn = { [a]: { amt: x, why: `Silný tým – ${s.name}` }, [b]: { amt: y, why: i % 3 ? `Trh je velký (${i})` : '' }, [c3]: { amt: 1000000 - x - y, why: '' } };
    const notes = { [a]: { like: `Zaujalo mě ${i}`, doubt: `Nevěřím ${i}` }, [b]: { like: `Pilotní zákazníci ${i}`, doubt: '' } };
    await c.st(s, 'notes', { notes });
    const r = await c.st(s, 'submit', { in: inn, notes });
    if (!r.ok) ok(false, 'old submit ' + r.error);
    slips[s.sid] = { in: inn, notes };
  }
  // reasons edited after submitting (existing feature)
  for (const i of [0, 5, 9]) {
    const s = S[i]; const t = Object.keys(slips[s.sid].in)[2];
    await c.st(s, 'reasons', { in: { [t]: `Doplněný důvod ${i}` } });
    slips[s.sid].in[t].why = `Doplněný důvod ${i}`;
  }
  await c.st(G, 'submit', { in: { [T[0]]: { amt: 1000000, why: 'ghost' } } });
  // RJ allocation saved before the deploy (the dealer enters it any time before the reveal)
  const rjIn = Object.fromEntries(T.map((t, i) => [t, { amt: [3e6, 2e6, 2e6, 1e6, 1e6, 1e6][i], why: `RJ důvod ${i}` }]));
  ok((await c.dealer('rjSave', { in: rjIn })).ok, 'old: RJ slip saved');
  await c.dealer('phase', { phase: 'closed' });
  const oldPub = await c.get();
  const oldDump = await c.dump();
  const oldAll = await c.dget('?view=dealer&all=1');
  const oldLog = await c.dget('?view=log&limit=5000');
  ok(oldPub.phase === 'closed' && oldPub.block === 1 && oldPub.betCount === 19 && oldPub.playerCount === 19, 'old: block 1 closed, 19 players, 19 slips');
  ok(Object.keys(oldDump.slips[1]).length === 21, 'old: slip:1 has 19 students + ghost + RJ');
  await srv.stop();

  // ---------- 2. deploy: new code on the same storage ----------
  section('new code starts on production data');
  srv = await startServer({ port: PORT, tag: TAG, cwd: ROOT, mode });
  c = client(srv.base);
  // first contact after the deploy is a burst: table, dealer and phones poll at once
  const burst = await Promise.all([
    ...Array.from({ length: 6 }, () => c.get()),
    ...S.slice(0, 6).map((s) => c.me(s)),
    c.dget('?view=dealer'),
  ]);
  ok(burst.every((r) => r._status === 200 && Array.isArray(r.teams)), 'burst of 13 first GETs all answered 200 with state');
  st = await c.get();
  ok(st.phase === 'closed' && st.block === 1, `phase closed / block 1 kept (got ${st.phase}/${st.block})`);
  ok(st.playerCount === 19 && st.betCount === 19, `19 players / 19 slips kept (got ${st.playerCount}/${st.betCount})`);
  ok(st.gid === oldPub.gid, 'game id unchanged (phones keep their local copies)');
  ok((st.rev || 0) >= (oldPub.rev || 0), `rev not lower than before (${st.rev} ≥ ${oldPub.rev})`);
  ok(JSON.stringify(st.teams.map((t) => [t.id, t.name, t.color, t.V])) === JSON.stringify(oldPub.teams.map((t) => [t.id, t.name, t.color, t.V])), 'teams (names, colours, valuations) unchanged');
  ok(JSON.stringify(st.players.map((p) => p.id).sort()) === JSON.stringify(oldPub.players.map((p) => p.id).sort()), 'same player list');
  ok(st.content?.texts?.['play.login.title'] === 'Investiční stůl – test', 'CMS texts kept');
  ok(st.board?.some((q) => q.id === q1.id && q.answer?.text === 'Zatím 12 pilotních.'), 'question board data kept');
  checkClean('public state after migration', st);
  shape('features', st.features, Object.fromEntries(Object.keys(FEATURE_DEFAULTS).map((k) => [k, 'boolean'])), { strict: true });
  ok(Object.entries(FEATURE_DEFAULTS).every(([k, v]) => st.features?.[k] === v), 'feature defaults applied to the old meta');
  ok(JSON.stringify(st.reasonLabels) === JSON.stringify(REASON_LABELS), 'reasonLabels exported');
  ok(Array.isArray(st.milestoneDefs) && MILESTONES.every(([k, l, b]) => st.milestoneDefs.some((d) => d.key === k && d.label === l && d.block === b)) && st.milestoneDefs.length === 9, 'default milestoneDefs seeded');

  // every PIN works, slips/notes/reasons intact
  let pinsOk = 0, slipsOk = 0, loginOk = 0;
  for (const s of S) {
    const m = await c.me(s);
    if (m.me && !m.meError) pinsOk++;
    const sl = m.me?.slip;
    const exp = slips[s.sid];
    const same = sl && sl.submitted === true && Object.entries(exp.in).every(([t, e]) => sl.in?.[t]?.amt === e.amt && (sl.in[t].why || '') === e.why) &&
      Object.entries(exp.notes).every(([t, n]) => sl.notes?.[t]?.like === n.like && (sl.notes[t].doubt || '') === n.doubt);
    if (same) slipsOk++; else info('slip differs for ' + s.name + ': ' + JSON.stringify(sl).slice(0, 300));
    const l = await c.post({ op: 'login', sid: s.sid, pin: s.pin });
    if (l.ok && l.sid === s.sid) loginOk++;
  }
  ok(pinsOk === 19, `all 19 PINs work for GET me (${pinsOk})`);
  ok(slipsOk === 19, `all 19 slips with amounts, reasons and notes intact on the phone (${slipsOk})`);
  ok(loginOk === 19, `old-style login op works for all 19 (${loginOk})`);
  ok((await c.post({ op: 'login', sid: S[0].sid, pin: '0000' })).ok === false, 'wrong PIN still refused');
  const gm = await c.me(G);
  ok(gm.me && gm.me.ghost === true, 'ghost still logs in and is flagged');

  // "Stav před v2" archive
  const arch = await c.dget('?view=archives');
  ok(arch.ok && Array.isArray(arch.archives), '?view=archives answers');
  const pre = (arch.archives || []).filter((a) => a.label === 'Stav před v2');
  ok(pre.length >= 1, `"Stav před v2" archive exists (${pre.length}×)`);
  warnIf(pre.length === 1, `"Stav před v2" exists exactly once after a 13-request burst (got ${pre.length}; spec allows duplicates on races)`);
  if (pre[0]) {
    shape('archive list row', pre[0], { id: 'string', ts: 'number', label: 'string', auto: 'boolean', block: 'number', sizeKB: 'number' }, { strict: true });
    ok(pre[0].auto === true && pre[0].block === 1, 'auto archive, block 1');
    const full = await c.dget('?view=archive&id=' + encodeURIComponent(pre[0].id));
    const A = full.archive;
    ok(full.ok && A && A.dump, 'full archive downloadable');
    shape('archive object', A, { id: 'string', ts: 'number', label: 'string', auto: 'boolean', block: 'number', dump: 'object' }, { strict: true });
    const d = A?.dump || {};
    ok(d.meta?.phase === 'closed' && d.meta?.block === 1, 'archived meta = closed block 1');
    ok(Object.keys(d.players || {}).length === 20, `archived players: 19 + ghost (${Object.keys(d.players || {}).length})`);
    const as = d.slips?.[1] || d.slips?.['1'] || {};
    ok(Object.keys(as).length === 21, `archived slip:1 has 21 entries (${Object.keys(as).length})`);
    const notesSame = S.every((s) => JSON.stringify(as[s.sid]?.notes) === JSON.stringify(oldDump.slips[1][s.sid].notes) && JSON.stringify(as[s.sid]?.in) === JSON.stringify(oldDump.slips[1][s.sid].in));
    ok(notesSame, 'archive contains Block 1 notes and reasons exactly as before');
    ok(d.board?.qs?.[q1.id], 'archive contains the question board');
    ok(!('arch' in d), 'archive dump does not nest archives');
  }

  // ?view=data
  section('?view=data after migration');
  const data = await c.dget('?view=data');
  ok(data.ok, '?view=data ok');
  checkClean('?view=data', data);
  shape('data', data, { ok: 'boolean', generated: 'number|string', teams: 'array', players: 'array', allocations: 'array' });
  ok(data.teams?.length === 6, 'data.teams has 6');
  for (const t of (data.teams || []).slice(0, 1)) shape('data.teams[0]', t, { id: 'string', name: 'string', color: 'string', V: 'number', S: 'number', founderPct: 'number', cls: 'number', rj: 'number', oneLiner: 'string|null', sub: 'string|null' });
  ok(data.teams?.length === 6 && data.teams.every((t) => t.V === 1000000 && Math.abs(t.founderPct - 100) < 0.05), 'teams still at 1M valuation, founders 100 %');
  const dp = data.players || [];
  ok(dp.filter((p) => !p.ghost).length === 19, `data.players has 19 non-ghost (${dp.filter((p) => !p.ghost).length})`);
  const dg = dp.filter((p) => p.ghost);
  ok(dp.length > 0 && dg.length <= 1 && dg.every((p) => p.id === G.sid), 'ghost only as a flagged row (or absent)');
  if (dp[0]) shape('data.players[0]', dp[0], { id: 'string', name: 'string', team: 'string', teamName: 'string', created: 'number', ghost: 'boolean', hasPin: 'boolean', portfolio: 'number', returnPct: 'number', holdings: 'object' });
  ok(dp.length > 0 && dp.filter((p) => !p.ghost).every((p) => p.hasPin === true && p.teamName === TEAMS[T.indexOf(p.team)]), 'players: hasPin + teamName right');
  const al = (data.allocations || []).filter((a) => a.block === 1);
  const alS = al.filter((a) => S.some((s) => s.sid === a.playerId));
  ok(alS.length === 19, `allocations: 19 student rows for block 1 (${alS.length})`);
  ok(al.some((a) => a.playerId === 'rj' && sumAmt(a.in) === 10e6), 'allocations: RJ row with 10M');
  const ghostAl = al.filter((a) => a.playerId === G.sid);
  ok(ghostAl.every((a) => a.ghost === true), `ghost allocation rows (if any) are flagged ghost: true (${ghostAl.length} row)`);
  if (alS[0]) shape('allocations[0]', alS[0], { block: 'number', playerId: 'string', name: 'string', team: 'string', submitted: 'boolean', ts: 'number', in: 'object', out: 'object', notes: 'object' });
  const allocSame = alS.length === 19 && alS.every((a) => {
    const o = oldDump.slips[1][a.playerId];
    return a.submitted === true && a.ts === o.ts && JSON.stringify(a.in) === JSON.stringify(o.in) && Object.entries(o.notes || {}).every(([t, n]) => a.notes?.[t]?.like === n.like && a.notes[t].doubt === n.doubt);
  });
  ok(allocSame, 'allocations equal the old slips (amounts, reasons, notes, ts)');
  ok(alS.length === 19 && alS.every((a) => a.name === S.find((s) => s.sid === a.playerId).name), 'allocation names right');
  ok(Array.isArray(data.points) && Array.isArray(data.quizRuns), 'data has points ledger and quizRuns arrays');

  // seeded quiz
  const meta0 = await c.meta();
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/quiz-blok2.json'), 'utf8'));
  const bl = (meta0?.quizSets || []).find((x) => x.id === 'blok2');
  ok(bl && bl.title === 'Blok 2 – slovník' && bl.questions?.length === seed.length && bl.questions[0].q === seed[0].q && bl.questions.every((q, i) => q.correct === seed[i].correct), `quiz set blok2 seeded from docs/quiz-blok2.json (${bl?.questions?.length}/${seed.length})`);
  ok(typeof meta0?.v2ArchivedAt === 'number' || typeof meta0?.v2ArchivedAt === 'string', 'meta.v2ArchivedAt set');

  // restart: no second "Stav před v2"
  await srv.stop();
  srv = await startServer({ port: PORT, tag: TAG, cwd: ROOT, mode });
  c = client(srv.base);
  await c.get();
  const arch2 = await c.dget('?view=archives');
  ok((arch2.archives || []).filter((a) => a.label === 'Stav před v2').length === pre.length, 'restart of the new code adds no further "Stav před v2"');

  // ---------- 3. the class continues: showdown, RJ, next block ----------
  section('showdown on migrated data');
  const sd = await c.dealer('showdown');
  ok(sd.ok && sd.n === 19, `showdown ok, 19 slips applied (n=${sd.n}, ${sd.error || ''})`);
  st = await c.get();
  const cls = sum(st.teams.map((t) => t.cls));
  ok(cls === 19e6, `class money = 19 000 000 (got ${cls})`);
  const expIn = {};
  for (const s of S) for (const [t, e] of Object.entries(slips[s.sid].in)) expIn[t] = (expIn[t] || 0) + e.amt;
  ok(T.every((t) => Math.abs((st.reveal?.delta?.[t] || 0) - (expIn[t] || 0)) <= 1), 'reveal.delta per team = Σ submitted in');
  ok(T.every((t) => { const d = st.drivers?.[t]?.[0]; return expIn[t] ? d && d.kind === 'class' && Math.abs(d.delta - expIn[t]) <= 1 && d.block === 1 : true; }), 'drivers start: class driver per team with delta = class money');
  const m2 = await invariants(c, { S, G }, 'after migrated showdown');
  const lots = m2.meta?.lots || {};
  const lotsOk = Object.keys(lots).length > 0 && S.every((s) => {
    const L = lots[s.sid] || [];
    return Object.entries(m2.meta.ledger.H[s.sid] || {}).every(([t, sh]) => sh < 1e-9 || Math.abs(sum(L.filter((x) => x.team === t).map((x) => x.shares)) - sh) < 1e-6);
  });
  ok(lotsOk, 'lots start: every student has lots matching their holdings');
  const lot0 = (lots[S[0].sid] || [])[0];
  if (lot0) shape('lot', lot0, { team: 'string', shares: 'number', price: 'number', block: 'number', ts: 'number', low: 'boolean' }, { strict: true });
  ok(!lots[G.sid]?.length, 'ghost has no lots');
  const me0 = await c.me(S[0]);
  shape('me.track', me0.me?.track, { value: 'number', start: 'number', returnPct: 'number', rank: 'number', of: 'number', bestCall: 'object|null', awards: 'array' }, { strict: true });
  ok(me0.me?.track?.start === 1000000 && me0.me?.track?.of === 19, 'track: start 1M, of 19');
  ok(me0.me?.myTeamCap && Array.isArray(me0.me.myTeamCap.history), 'myTeamCap present with history');

  section('RJ, next block, phones');
  // RJ slip from the old code can be re-saved and revealed
  ok((await c.dealer('rjSave', { in: Object.fromEntries(T.map((t, i) => [t, { amt: [2e6, 2e6, 2e6, 2e6, 1e6, 1e6][i], why: `RJ nový důvod ${i}` }])) })).ok, 'rjSave after migration');
  const rv = await c.dealer('rjReveal');
  ok(rv.ok, 'rjReveal ok ' + (rv.error || ''));
  st = await c.get();
  ok(sum(st.teams.map((t) => t.rj)) === 10e6, 'RJ money = 10M');
  ok(T.every((t) => (st.drivers?.[t] || []).some((d) => d.kind === 'rj')), 'rj drivers recorded');
  const nb = await c.dealer('nextBlock');
  ok(nb.ok, 'Další blok works');
  st = await c.get();
  ok(st.block === 2 && st.phase === 'lobby', 'block 2 lobby');
  const arch3 = await c.dget('?view=archives');
  ok((arch3.archives || []).some((a) => a.label === 'Před blokem 2' && a.auto === true && a.block === 1), 'auto archive "Před blokem 2"');
  const mb2 = await c.me(S[3]);
  ok(!mb2.me?.slip || !mb2.me.slip.submitted, 'phone in block 2 has no block-1 slip');
  ok(!/Zaujalo mě 3|Nevěřím 3|Silný tým – /.test(mb2._raw), 'phone never sees block-1 notes or reasons in block 2');
  // old-style restore: a phone with its local copy (same gid, older ts) changes nothing
  const old3 = oldDump.slips[1][S[3].sid];
  const rr = await c.post({ op: 'restore', sid: S[3].sid, pin: S[3].pin, name: S[3].name, team: S[3].team, gid: oldPub.gid, slips: { 1: old3 } });
  ok(rr.ok && rr.sid === S[3].sid, 'old-style restore op accepted');
  const data2 = await c.dget('?view=data');
  const a3 = (data2.allocations || []).find((a) => a.block === 1 && a.playerId === S[3].sid);
  ok(a3 && a3.ts === old3.ts && JSON.stringify(a3.in) === JSON.stringify(old3.in), 'restore with an older copy does not overwrite the slip');
  const lost = await c.post({ op: 'restore', sid: 'lostphoneE1', pin: '4321', name: 'Ztracená Studentka', team: T[4], gid: oldPub.gid, slips: {} });
  ok(lost.ok, 'forgotten phone can re-create its account');
  // block 2 rebalance works on migrated players
  await c.dealer('phase', { phase: 'betting' });
  const m5 = await c.me(S[5]);
  ok(m5.me?.rules?.mode === 'rebalance' && m5.me.rules.cashoutMax === 300000 && m5.me.rules.exact === true, 'block 2: migrated student must move exactly 300k');
  const held = Object.entries(m5.me.stakes).sort((a, b) => b[1] - a[1])[0][0];
  const tgt = T.find((t) => t !== S[5].team && t !== held);
  ok((await c.st(S[5], 'submit', { out: { [held]: { amt: 300000 } }, in: { [tgt]: { amt: 300000 } } })).ok, 'block 2 submit works');
  const lg = await c.dget('?view=log&limit=5000');
  ok((lg.log || []).filter((e) => e.op === 'submit').length >= (oldLog.log || []).filter((e) => e.op === 'submit').length, 'action log kept the old submits');
  checkClean('dealer view block 2', await c.dget('?view=dealer'));
  await srv.stop();
  if (mock) await mock.stop();
});
