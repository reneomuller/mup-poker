// Feature flags, archives, data view, cards/milestone defs, makeDump/restore round-trip of every v2 field,
// and restoring an old-shaped (pre-v2) dump from an old dealer tab.
//   BASE=http://localhost:3101/api/game node tests/a-flags.mjs   (fresh server; spawns a second one on 3113)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { client, ok, done, register, firstSlip } from './a-lib.mjs';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT2 = Number(process.env.PORT2 || 3113);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function spawnServer(port) {
  const p = spawn('node', ['dev-server.js', 'tagA-flags'], { cwd: DIR, env: { ...process.env, PORT: String(port), KV_REST_API_URL: '', KV_REST_API_TOKEN: '', DATABASE_URL: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${port}/api/game`); return p; } catch { await sleep(100); } }
  throw new Error('no server');
}

const c = client();
await c.dealer('reset', { confirm: 'RESET', keepPlayers: false });
let st = await c.get();
const T = st.teams.map((t) => t.id);
ok(JSON.stringify(st.features) === JSON.stringify({ captable: true, cards: true, drivers: true, track: true, quiz: true, points: true, rounds: false, market: false, tranches: false, exit: false, wall: true, demand: true, startupPage: true }), 'feature defaults');
ok(st.reasonLabels.traction === 'Trakce' && st.milestoneDefs.length === 9 && st.milestoneDefs[0].key === 'm1a' && st.milestoneDefs[0].label === 'Potvrzený problém a one-liner', 'reason labels and milestone defaults');
let r = await c.dealer('features', { set: { market: true, bogus: true, quiz: false } });
st = await c.get();
ok(r.ok && st.features.market === true && st.features.quiz === false && !('bogus' in st.features), 'features op merges known keys only');
await c.dealer('features', { set: { quiz: true, rounds: true, tranches: true, exit: true } });

// cards
const S = await register(c, 8, T);
const g = await c.dealer('ghost', { team: T[0] });
r = await c.spost({ op: 'card', sid: S[0].sid, pin: S[0].pin, oneLiner: 'x'.repeat(120), sub: 'Dlouhý popis' });
st = await c.get();
ok(r.ok && st.cards[T[0]].oneLiner.length === 90 && st.cards[T[0]].sub === 'Dlouhý popis', 'student card: one-liner cut to 90');
r = await c.spost({ op: 'card', sid: S[6].sid, pin: S[6].pin, sub: 'Jen popis' });
st = await c.get();
ok(r.ok && st.cards[T[0]].oneLiner.length === 90 && st.cards[T[0]].sub === 'Jen popis', 'teammate edits only the sub, one-liner kept');
ok(!(await c.spost({ op: 'card', sid: g.sid, pin: g.pin, oneLiner: 'Ghost' })).ok, 'ghost card edit refused');
r = await c.dealer('card', { team: T[1], oneLiner: 'Parkování bez hledání', sub: 'B2B', milestones: { m1a: true, m1b: true } });
st = await c.get();
ok(r.ok && st.cards[T[1]].oneLiner === 'Parkování bez hledání' && st.cards[T[1]].milestones.m1b === true, 'dealer card with milestones');
ok(!(await c.dealer('milestoneDefs', { defs: [{ key: 'a a', label: 'x' }] })).ok, 'bad milestone defs refused');
r = await c.dealer('milestoneDefs', { defs: [...st.milestoneDefs, { key: 'm5b', label: 'Demo Day', block: 5 }] });
ok(r.ok && (await c.get()).milestoneDefs.length === 10, 'milestone defs saved');

// some game so every field has content
await c.dealer('roundTerms', { team: T[2], pre: 1200000 });
await c.dealer('award', { kind: 'custom', playerId: S[1].sid, note: 'Za odvahu' });
await c.dealer('pointsAdd', { team: T[3], amt: 150, note: 'Tým' });
await c.dealer('quizSave', { set: { id: 'mine', title: 'Moje', questions: [{ q: 'Q?', a: ['a', 'b'], correct: 1, time: 10 }] } });
await c.dealer('trancheAdd', { team: T[4], amt: 1e6, cond: 'MVP', due: 'Blok 3' });
await c.dealer('phase', { phase: 'betting' });
for (const [i, s] of S.entries()) await c.spost({ op: 'submit', sid: s.sid, pin: s.pin, in: firstSlip(s, T, i), notes: { [T[(i + 1) % 6]]: { like: 'L' + i, doubt: 'D' + i } } });
await c.dealer('phase', { phase: 'closed' });
await c.dealer('showdown');
await c.dealer('rjSave', { in: { [T[0]]: { amt: 4e6, why: 'x' } } });
await c.dealer('rjReveal');
await c.dealer('marketCard', { title: 'Boom AI', text: 'Trh roste.', effects: { [T[5]]: 30 } });
await c.dealer('quizStart', { setId: 'mine' });
await c.dealer('quizNext');
await c.spost({ op: 'quizAnswer', sid: S[0].sid, pin: S[0].pin, choice: 1 });
await c.dealer('quizReveal');

// archives
r = await c.dealer('archive', { label: 'Můj archiv' });
ok(r.ok && typeof r.id === 'string', 'manual archive → id');
let ar = await c.get('?view=archives');
ok(ar.ok && ar.archives[0].id === r.id && ar.archives[0].label === 'Můj archiv' && ar.archives[0].auto === false && ar.archives[0].block === 1 && ar.archives[0].sizeKB > 0, 'archives list newest first with sizeKB');
const one = await c.get('?view=archive&id=' + r.id);
ok(one.ok && one.archive.dump.meta && one.archive.dump.players && one.archive.dump.slips[1] && one.archive.dump.board && one.archive.dump.tx, 'archive download has the full dump');
ok(!('arch' in one.archive.dump), 'arch not inside dumps');
ok((await c.get('?view=archive&id=nope')).ok === false, 'unknown archive → error');
await c.spost({ op: 'ask', sid: S[0].sid, pin: S[0].pin, team: T[1], cat: 'problem', text: 'Kolik to bude stát?' });
ok((await c.get()).board.length === 1, 'board has a question');
r = await c.dealer('clearBoard');
st = await c.get();
ar = await c.get('?view=archives');
ok(r.ok && st.board.length === 0 && ar.archives[0].label === 'Otázky z tabule', 'clearBoard archives then empties the board');
const boardArch = await c.get('?view=archive&id=' + ar.archives[0].id);
ok(Object.keys(boardArch.archive.dump.board.qs).length === 1, 'board archive holds the question');
r = await c.dealer('archiveDelete', { id: ar.archives[0].id });
ok(r.ok && !(await c.get('?view=archives')).archives.some((a) => a.label === 'Otázky z tabule'), 'archiveDelete');

// data view
const data = await c.get('?view=data');
ok(data.ok && data.generated > 0 && data.teams.length === 6 && data.players.length === 9 && data.allocations.length === 9, 'data view counts (8 students + ghost, 8 slips + RJ)');
const tm = data.teams[1];
ok(['id', 'name', 'color', 'V', 'S', 'founderPct', 'cls', 'rj', 'oneLiner', 'sub'].every((k) => k in tm) && tm.oneLiner === 'Parkování bez hledání', 'data teams shape');
const pl = data.players.find((p) => p.id === S[0].sid);
ok(['id', 'name', 'team', 'teamName', 'created', 'ghost', 'hasPin', 'portfolio', 'returnPct', 'holdings'].every((k) => k in pl) && Object.values(pl.holdings).reduce((a, b) => a + b, 0) === pl.portfolio, 'data players shape, holdings add up');
const al = data.allocations.find((a) => a.playerId === S[0].sid);
ok(['block', 'playerId', 'name', 'team', 'submitted', 'ts', 'in', 'out', 'notes'].every((k) => k in al) && al.notes[T[1]].like === 'L0', 'data allocations shape with notes');
ok(data.allocations.find((a) => a.playerId === 'rj').in[T[0]].amt === 4e6, 'RJ allocation with playerId rj');
ok(Array.isArray(data.points) && data.quizRuns.length === 1 && data.quizRuns[0].answers[S[0].sid].choice === 1, 'data points + quizRuns');

// makeDump / restore round-trip into a fresh server
const dump = (await c.get('?view=dealer&dump=1')).dealer.dump;
const keys = ['features', 'cards', 'milestoneDefs', 'drivers', 'rounds', 'market', 'tranches', 'rjPrincipal', 'lots', 'awards', 'quizSets', 'quiz', 'quizLog', 'points', 'v2ArchivedAt'];
ok(keys.every((k) => dump.meta[k] !== undefined) && dump.tx['card:' + T[1]] && dump.tx[`rt:1:${T[2]}`], 'dump carries every v2 field + tx hash');
const p2 = await spawnServer(PORT2);
try {
  const c2 = client(`http://localhost:${PORT2}/api/game`);
  r = await c2.dealer('restore', { dump });
  ok(r.ok && r.restored, 'restore into a fresh server');
  const back = (await c2.get('?view=dealer&dump=1')).dealer.dump;
  const diff = keys.filter((k) => JSON.stringify(back.meta[k]) !== JSON.stringify(dump.meta[k]));
  ok(diff.length === 0, 'every v2 meta field round-trips ' + diff.join(','));
  ok(JSON.stringify(back.tx) === JSON.stringify(dump.tx) && JSON.stringify(back.slips) === JSON.stringify(dump.slips), 'tx hash and slips round-trip');
  const st2 = await c2.get();
  const st1 = await c.get();
  for (const k of ['cards', 'drivers', 'rounds', 'market', 'tranches', 'rjFund', 'awards', 'points', 'milestoneDefs', 'features']) {
    ok(JSON.stringify(st2[k]) === JSON.stringify(st1[k]), 'public ' + k + ' identical after restore');
  }
  ok(JSON.stringify(st2.teams.map((t) => [t.V, t.cap])) === JSON.stringify(st1.teams.map((t) => [t.V, t.cap])), 'valuations and cap table identical');
  ok((await c2.get('?view=archives')).archives.length === 0, 'restoring a v2 dump creates no „Stav před v2“ archive');

  // old dealer tab: an old-shaped dump (no v2 fields) restored into a fresh server
  const oldShape = structuredClone(dump);
  for (const k of keys) delete oldShape.meta[k];
  delete oldShape.tx;
  const p3port = PORT2 + 1;
  const p3 = await spawnServer(p3port);
  try {
    const c3 = client(`http://localhost:${p3port}/api/game`);
    r = await c3.dealer('restore', { dump: oldShape });
    const m3 = (await c3.get('?view=dealer&dump=1')).dealer.dump.meta;
    await c3.get(); await c3.get();
    ok(r.ok && r.restored && m3.quizSets[0].id === 'blok2' && m3.features.quiz === true && m3.v2ArchivedAt > 0 && Array.isArray(m3.points), 'old-shaped dump into a fresh server: defaults + quiz re-seeded + v2 marker');
    ok((await c3.get('?view=archives')).archives.length === 0, 'no archive loop after restoring an old dump');
  } finally { p3.kill(); }
} finally { p2.kill(); }

// old dealer tab on the same game pushes a stale old-shaped dump with a higher rev
const cur = (await c.get('?view=dealer&dump=1')).dealer.dump.meta;
const stale = structuredClone(dump);
for (const k of keys) delete stale.meta[k];
stale.meta.rev = cur.rev + 5;
const archBefore = (await c.get('?view=archives')).archives.length;
r = await c.dealer('restore', { dump: stale });
const after = (await c.get('?view=dealer&dump=1')).dealer.dump.meta;
await c.get(); await c.get();
ok(r.ok && after.v2ArchivedAt === cur.v2ArchivedAt, 'stale old-shaped dump keeps v2ArchivedAt');
ok(JSON.stringify(after.points) === JSON.stringify(cur.points) && JSON.stringify(after.quizSets) === JSON.stringify(cur.quizSets) && JSON.stringify(after.features) === JSON.stringify(cur.features) && JSON.stringify(after.awards) === JSON.stringify(cur.awards), 'v2 data (points, quiz sets, flags, awards) kept from the server');
ok(after.rev >= cur.rev && after.gid === cur.gid, 'rev never goes down, gid kept');
ok((await c.get('?view=archives')).archives.length === archBefore, 'no re-archive after restoring an old dump');
st = await c.get();
ok(st.quiz && st.features.quiz === true && st.cards, 'state still serves v2 views');
const lower = structuredClone(dump);
lower.meta.rev = 1;
r = await c.dealer('restore', { dump: lower });
ok(r.ok && !r.restored && (await c.get()).rev >= after.rev, 'older rev is ignored');
done('a-flags');
