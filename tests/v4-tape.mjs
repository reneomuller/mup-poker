// v4 tape: publicState.tape = the last 15 submitted class trades of the current block, newest first.
// Ghosts and RJ never appear, `tapeNames` picks initials / first name / off, the `tape` flag removes it,
// and it costs no extra Redis command (it reuses the slips the GET already reads for `live`).
import fs from 'node:fs';
import path from 'node:path';
import { ok, info, section, main, client, sleep, checkClean, freshGame, initialSlip, mockStats, mockResetStats, MOCK_URL, ROOT } from './_e-lib.mjs';
import * as TP from '../api/_lib/tape.js';

const c = client();
const NAMES = ['Jana Nováková', 'Petr Kovář', 'Čeněk Šťastný', 'Eva Malá', 'Ondřej', 'Lucie Anna Dvořáková', 'Adam Bílý', 'Tereza Krátká',
  'Marek Zelený', 'Klára Nová', 'Filip Horák', 'Bára Veselá', 'Jakub Černý', 'Ema Králová', 'David Svoboda', 'Nela Pokorná', 'Vít Marek', 'Zoe Fialová'];

main(async () => {
  section('pure: names');
  ok(TP.whoOf('Jana Nováková', 'initials') === 'J. N.' && TP.whoOf('Jana Nováková', 'first') === 'Jana N.' && TP.whoOf('Jana Nováková', 'off') === '', 'Jana Nováková → „J. N.“ / „Jana N.“ / off');
  ok(TP.whoOf('Čeněk Šťastný', 'initials') === 'Č. Š.' && TP.whoOf('lucie anna dvořáková', 'first') === 'lucie D.', 'diacritics and middle names');
  ok(TP.whoOf('Ondřej', 'initials') === 'O.' && TP.whoOf('Ondřej', 'first') === 'Ondřej' && TP.whoOf('  ', 'first') === '', 'single names and blanks');
  ok(TP.nameMode('first') === 'first' && TP.nameMode('bogus') === 'initials' && TP.nameMode(true) === 'initials' && TP.nameMode(false) === 'off' && TP.whoOf('Jana N', 'bogus') === 'J. N.', 'unknown modes fall back to initials');
  ok(TP.flagValue(true) === true && TP.flagValue(false) === false && TP.flagValue('off') === 'off' && TP.flagValue(7) === 'initials' && TP.whoOf('Jana N', true) === 'J. N.' && TP.whoOf('Jana N', false) === '', 'stored flag values: modes or booleans');

  section('pure: tapeOf');
  const teams = ['a', 'b', 'c'].map((id) => ({ id }));
  const players = { rj: { id: 'rj', name: 'RainbowJet', team: null }, g: { id: 'g', name: 'Ghost Duch', team: 'a', ghost: true } };
  const slips = { rj: { submitted: true, ts: 9e12, in: { a: { amt: 5e5 } } }, g: { submitted: true, ts: 9e12, in: { b: { amt: 1e6 } } }, x: { submitted: true, ts: 9e12, in: { b: { amt: 1e6 } } } };
  for (let i = 0; i < 20; i++) {
    players['s' + i] = { id: 's' + i, name: NAMES[i % NAMES.length], team: teams[i % 3].id };
    slips['s' + i] = { submitted: i !== 7, ts: 1000 + ((i * 7) % 20), in: { [teams[(i + 1) % 3].id]: { amt: 300000, why: 'tajný důvod' } }, out: i % 2 ? { [teams[(i + 2) % 3].id]: { amt: 300000 } } : {} };
  }
  const meta = { phase: 'betting', block: 2, settled: {}, teams, features: { tape: true, tapeNames: 'initials' } };
  const tp = TP.tapeOf(meta, slips, players);
  ok(tp.length === 15, `capped at 15 (${tp.length})`);
  ok(tp.every((r, i) => i === 0 || tp[i - 1].ts >= r.ts) && tp[0].ts === 1019, 'newest first');
  ok(!tp.some((r) => r.who === 'G. D.' || r.who === 'R.' || r.ts === 9e12), 'ghosts, RJ and unknown slips never appear');
  ok(!tp.some((r) => r.ts === 1000 + ((7 * 7) % 20) && r.who === TP.whoOf(NAMES[7], 'initials')), 'unsubmitted slips never appear');
  ok(tp.every((r) => Object.keys(r).sort().join() === 'in,out,team,ts,who' && Object.values(r.in).every((v) => typeof v === 'number')), 'rows are { ts, who, team, in, out } with plain amounts (no reasons)');
  ok(!JSON.stringify(tp).includes('tajný') && !JSON.stringify(tp).includes('"s1"'), 'no reasons, no sids');
  ok(TP.tapeOf({ ...meta, settled: { '2c': true } }, slips, players).length === 0 && TP.tapeOf({ ...meta, phase: 'pitch' }, slips, players).length === 0, 'empty outside investing and after the showdown');
  ok(!('tape' in TP.publicTape({ ...meta, features: { tape: false } }, slips, players)) && Array.isArray(TP.publicTape(meta, slips, players).tape), 'flag off: no tape key');
  ok(!/store\.js|from '\.\/store/.test(fs.readFileSync(path.join(ROOT, 'api/_lib/tape.js'), 'utf8')), 'tape.js never touches storage');

  section('API: live tape during betting');
  const { T, S, G } = await freshGame(c, { n: 3, ghost: true });
  const P = [...S];
  for (let i = 3; i < 18; i++) {
    const team = T[i % T.length], pin = String(3000 + i);
    const r = await c.post({ op: 'register', name: NAMES[i], team, pin });
    P.push({ sid: r.sid, pin, team, name: NAMES[i] });
  }
  let st = await c.get();
  ok(st.features.tape === true && st.features.tapeNames === 'initials', 'defaults: tape on, initials');
  ok(Array.isArray(st.tape) && st.tape.length === 0, 'lobby: empty tape');
  await c.dealer('phase', { phase: 'betting', minutes: 5 });
  await c.st(G, 'submit', initialSlip(T, G.team, 0));
  const rjIn = Object.fromEntries(T.map((t) => [t, { amt: 500000, why: 'RJ' }]));
  await c.dealer('rjSave', { in: rjIn });
  for (let i = 3; i < 8; i++) { const r = await c.st(P[i], 'submit', initialSlip(T, P[i].team, i)); if (!r.ok) info('submit: ' + r.error); await sleep(3); }
  await sleep(800);
  st = await c.get();
  ok(st.tape.length === 5, `ghost and RJ are not on the tape (5 trades, got ${st.tape.length})`);
  ok(st.tape[0].who === 'T. K.' && st.tape[4].who === 'E. M.', `newest first with initials (${st.tape.map((r) => r.who).join(', ')})`);
  ok(st.tape.every((r) => Object.values(r.in).reduce((a, b) => a + b, 0) === 1_000_000 && T.includes(r.team)), 'block 1 trades: 1 M each, investor team set');
  ok(st.tape.every((r) => st.tape.filter((x) => x.ts === r.ts && x.who === r.who).length === 1), 'one row per slip');
  checkClean('public state with tape', st);

  await c.dealer('features', { set: { tapeNames: 'first' } });
  await sleep(800);
  st = await c.get();
  ok(st.features.tapeNames === 'first' && st.tape[0].who === 'Tereza K.' && st.tape[4].who === 'Eva M.', `first names (${st.tape[0].who})`);
  await c.dealer('features', { set: { tapeNames: 'off' } });
  await sleep(800);
  st = await c.get();
  ok(st.tape.length === 5 && st.tape.every((r) => r.who === ''), 'off: amounts only');
  await c.dealer('features', { set: { tapeNames: '<script>' } });
  ok((await c.get()).features.tapeNames === 'initials', 'unknown value stored as initials');

  for (let i = 8; i < 18; i++) await c.st(P[i], 'submit', initialSlip(T, P[i].team, i));
  for (let i = 0; i < 3; i++) await c.st(P[i], 'submit', initialSlip(T, P[i].team, i));
  await sleep(800);
  st = await c.get();
  ok(st.tape.length === 15 && st.betCount === 18, `cap of 15 (${st.tape.length} of ${st.betCount})`);
  ok(st.tape[0].who === TP.whoOf(P[2].name, 'initials') && st.tape.every((r, i) => i === 0 || st.tape[i - 1].ts >= r.ts), 'latest submit leads');

  await c.dealer('features', { set: { tape: false } });
  await sleep(800);
  st = await c.get();
  ok(!('tape' in st), 'tape off: no tape in the public state');
  await c.dealer('features', { set: { tape: true } });

  if (MOCK_URL) {
    section('GET cost in Redis mode');
    const cost = async () => { await sleep(800); await mockResetStats(); await c.get(); return (await mockStats()).total; };
    await c.dealer('features', { set: { tape: false } });
    const off = await cost();
    await c.dealer('features', { set: { tape: true } });
    const on = await cost();
    info(`Redis commands per GET: tape off ${off}, on ${on}`);
    ok(on === off, `tape adds no Redis command per GET (${off} → ${on})`);
  }

  await c.dealer('phase', { phase: 'closed' });
  await sleep(800);
  ok((await c.get()).tape.length === 15, 'closed: tape stays');
  await c.dealer('showdown');
  await sleep(800);
  ok((await c.get()).tape.length === 0, 'after the showdown: empty');
});
