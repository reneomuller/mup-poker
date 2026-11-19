// Blok 4 simple round (19 Nov 2026): fuzzy matching (pure), 7th team (teamAdd), invest-only preset,
// newRound (open block-1 investments handed back, everyone $1M again, next block, archive + summary kept),
// flexible split up to $1M, PIN fallback (name + team → unverified), Minule → Dnes movement, undo.
// Production-shaped start: 6 teams, 20 players, block 1 closed with 19 unsettled slips, demand ON.
import { ok, section, main, client, sum, OFF } from './_e-lib.mjs';
import * as Z from '../api/_lib/fuzzy.js';
import * as G from '../api/_lib/game.js';

const c = client();
const PROD_NAMES = ['Seeto', 'Zdravotni Prehled', 'Vestity', 'AssetLink', 'Billi', 'Zdravotni Pomucky'];
const SIZES = [4, 2, 3, 4, 6, 1]; // production team sizes (20 players)

await main(async () => {
  section('fuzzy (pure)');
  const T7 = [...PROD_NAMES, 'PLUGG'].map((name, i) => ({ id: 't' + (i + 1), name }));
  const mt = (q) => Z.matchTeam(T7, q);
  ok(mt('plug').team?.id === 't7' && mt('plug').sure, '„plug“ → PLUGG (sure)');
  ok(mt('PLUG').team?.id === 't7', '„PLUG“ → PLUGG (case)');
  ok(mt('zdravotni prehled').team?.id === 't2' && mt('zdravotni prehled').sure, '„zdravotni prehled“ → Zdravotni Prehled');
  ok(mt('zdravotní přehled').team?.id === 't2', 'diacritics ignored');
  ok(mt('zdravotny prehlet').team?.id === 't2', 'two typos still → Zdravotni Prehled');
  ok(mt('pomucky').team?.id === 't6', 'one word „pomucky“ → Zdravotni Pomucky');
  ok(mt('zdravotni').sure === false, '„zdravotni“ alone is ambiguous (not sure → list)');
  ok(mt('billy').team?.id === 't5' && mt('asetlink').team?.id === 't4' && mt('seto').team?.id === 't1', 'billy / asetlink / seto');
  ok(mt('xyz').team === null, 'nonsense → no team');
  ok(mt('')?.team === null, 'empty → no team');
  const P = { a: { id: 'a', name: 'Jan Novák', team: 't1' }, b: { id: 'b', name: 'Jana Nováková', team: 't2' }, g: { id: 'g', name: 'Ghost', team: 't1', ghost: true } };
  ok(Z.matchPlayer(P, 'jan novak', 't1')?.id === 'a', 'player: „jan novak“ → Jan Novák');
  ok(Z.matchPlayer(P, 'Novák Jan', null)?.id === 'a', 'player: words in any order');
  ok(Z.matchPlayer(P, 'jana novakova', 't2')?.id === 'b', 'player: Jana ≠ Jan');
  ok(Z.matchPlayer(P, 'jan', null) === null, 'player: first name alone does not attach');
  ok(Z.matchPlayer(P, 'ghost', 't1') === null, 'player: ghosts never match');
  ok(Z.lev('kitten', 'sitting') === 3, 'levenshtein kitten/sitting = 3');

  section('rules (pure)');
  const m = { teams: T7.slice(0, 2), features: { simple: true }, ledger: { S: { t1: 1e6, t2: 1e6 }, P: { t1: 1, t2: 1 }, H: {} } };
  ok(G.rules(m, 'x').flex === true && G.rules(m, 'x').capital === 1e6, 'simple mode: initial + flex, capital 1M');
  ok(G.validate(m, 'x', 't1', { in: { t2: { amt: 400000 } } }).ok, 'flex: 400k of 1M is fine (rest stays cash)');
  ok(!G.validate(m, 'x', 't1', { in: { t2: { amt: 1_200_000 } } }).ok, 'flex: more than 1M refused');
  ok(!G.validate(m, 'x', 't1', { in: {} }).ok, 'flex: nothing refused');
  ok(!G.validate(m, 'x', 't1', { in: { t1: { amt: 100000 } } }).ok, 'flex: own team still refused');
  ok(!G.validate({ ...m, features: {} }, 'x', 't1', { in: { t2: { amt: 400000 } } }).ok, 'normal mode: still exactly 1M');

  section('production-shaped start');
  await c.dealer('reset', { confirm: 'RESET', keepPlayers: false });
  let st = await c.get();
  if (st.teams.length > 6) ok(false, 'fresh server should have 6 teams (restart the server between runs)');
  const T = st.teams.map((t) => t.id).slice(0, 6);
  await c.dealer('teams', { teams: T.map((id, i) => ({ id, name: PROD_NAMES[i] })) });
  await c.dealer('features', { set: { demand: true } });
  const S = [];
  let k = 0;
  for (const [ti, n] of SIZES.entries()) for (let j = 0; j < n; j++) {
    const pin = String(3000 + k), name = `Hráč ${String.fromCharCode(65 + k)} Testovací`;
    const r = await c.post({ op: 'register', name, team: T[ti], pin });
    S.push({ sid: r.sid, pin, team: T[ti], name }); k++;
  }
  ok(S.length === 20 && S.every((s) => s.sid), '20 players registered');
  await c.dealer('phase', { phase: 'betting', minutes: 0 });
  for (const [i, s] of S.slice(0, 19).entries()) {
    const o = T.filter((t) => t !== s.team);
    const r = await c.st(s, 'submit', { in: { [o[i % 5]]: { amt: 700000, why: 'říjen ' + i }, [o[(i + 2) % 5]]: { amt: 300000, why: '' } }, out: {} });
    if (!r.ok) ok(false, 'october slip ' + i + ': ' + r.error);
  }
  await c.dealer('phase', { phase: 'closed' });
  st = await c.get();
  ok(st.block === 1 && st.phase === 'closed' && st.betCount === 19 && !st.anyHoldings, 'block 1 closed, 19 unsettled slips, nobody holds anything');
  const shown = Object.fromEntries(st.teams.map((t) => [t.id, t.Vnow]));
  ok(st.teams.some((t) => t.Vnow !== 1e6), 'the table shows a demand projection (values ≠ 1M)');

  section('guards');
  const nr0 = await c.dealer('newRound', {});
  ok(!nr0.ok && /NOVE KOLO/.test(nr0.error), 'newRound needs confirm „NOVE KOLO“');
  await c.dealer('phase', { phase: 'betting' });
  const nr1 = await c.dealer('newRound', { confirm: 'NOVE KOLO' });
  ok(!nr1.ok && /zavři/.test(nr1.error), 'newRound refused while investing is open');
  const ta0 = await c.dealer('teamAdd', { name: 'PLUGG' });
  ok(!ta0.ok, 'teamAdd refused while investing is open');
  await c.dealer('phase', { phase: 'closed' });
  const fb0 = await c.post({ op: 'fallback', name: 'Někdo', team: 'billi' });
  ok(!fb0.ok && fb0.error === OFF, 'fallback is off until pinFallback is on');

  section('newRound: hand back, everyone 1M, block 2');
  const nr = await c.dealer('newRound', { confirm: 'NOVE KOLO', label: 'Blok 4 · investiční kolo' });
  ok(nr.ok && nr.block === 2, `newRound ok → block ${nr.block}`);
  ok(nr.voided?.open === 19 && nr.voided.openTotal === 19_000_000, `summary: 19 open slips, $19M handed back (${nr.voided?.open}, ${nr.voided?.openTotal})`);
  ok(nr.voided?.archiveId, 'archive created before the reset');
  ok(T.every((t) => nr.voided.prev[t] === shown[t]), 'Minule = what the table showed (default prev „shown“)');
  st = await c.get();
  ok(st.block === 2 && st.phase === 'lobby' && st.betCount === 0 && !st.anyHoldings, 'block 2 lobby, no bets, no holdings');
  ok(st.teams.every((t) => t.V === 1e6 && t.Vnow === 1e6), 'every team at $1M');
  ok(st.movement && st.movement.label === 'Blok 4 · investiční kolo' && !st.movement.done, 'public movement present (not done yet)');
  const me0 = await c.me(S[0]);
  ok(me0.me?.rules?.mode === 'initial' && me0.me.rules.capital === 1e6 && me0.me.slip === null, 'player: initial mode with $1M, no slip in the new block');
  const dd = await c.dget('?view=dealer&all=1');
  ok(Object.keys(dd.dealer?.all?.[1] || {}).length === 19, 'block-1 slips still stored (history kept)');
  ok((dd.dealer?.voided || []).length === 1, 'dealer sees the voided-round summary');
  const arch = await c.dget('?view=archives');
  ok((arch.archives || []).some((a) => a.id === nr.voided.archiveId), 'archive listed');

  section('PLUGG = t7');
  const ta = await c.dealer('teamAdd', { id: 't7', name: 'PLUGG', oneLiner: 'YOUR GEAR. WHENEVER YOU NEED IT.', sub: 'Samoobslužné automaty se sluchátky, kabely, powerbankami a adaptéry na univerzitách, kolejích a v hotelech.', startV: 1_000_000 });
  ok(ta.ok && ta.team?.id === 't7' && ta.team.color, `teamAdd PLUGG → ${ta.team?.id} ${ta.team?.color}`);
  const taDup = await c.dealer('teamAdd', { name: 'plugg' });
  ok(!taDup.ok, 'second PLUGG refused');
  const taMax = await c.dealer('teamAdd', { name: 'Osmý' });
  ok(!taMax.ok && /7/.test(taMax.error), 'an 8th team is refused (7 seats)');
  st = await c.get();
  const p7 = st.teams.find((t) => t.id === 't7');
  ok(st.teams.length === 7 && p7?.name === 'PLUGG' && p7.V === 1e6, 'public state: 7 teams, PLUGG at $1M');
  ok(st.movement.teams.t7?.prev === 1e6, 'PLUGG Minule = $1M');
  ok(st.cards?.t7?.oneLiner === 'YOUR GEAR. WHENEVER YOU NEED IT.', 'PLUGG card one-liner stored');

  section('invest-only preset');
  const pr = await c.dealer('features', { preset: 'investOnly' });
  ok(pr.ok && pr.features.simple && pr.features.pinFallback && !pr.features.demand && !pr.features.quiz && !pr.features.tape && !pr.features.sound, 'preset: simple + fallback on, demand/quiz/tape/sound off');
  const dv = await c.dget('?view=dealer');
  ok(dv.dealer?.featuresBefore?.demand === true, 'previous switches remembered');
  await c.dealer('phase', { phase: 'betting', minutes: 0 });

  section('invest: PIN, fallback (existing, misspelled team), fallback (new)');
  const a = S[0]; // Seeto player, logs in with the PIN
  const ra = await c.st(a, 'submit', { in: { t7: { amt: 600000, why: '' }, t5: { amt: 250000, why: '' } }, out: {} });
  ok(ra.ok, 'PIN player invests 850k (150k stays cash): ' + (ra.error || 'ok'));
  const ra2 = await c.st(a, 'submit', { in: { t7: { amt: 1_100_000, why: '' } }, out: {} });
  ok(!ra2.ok, 'more than 1M refused');
  // B: an existing Zdravotni Prehled player forgot the PIN, types the team as "zdravotni prehled" and the name without diacritics
  const bP = S.find((s) => s.team === T[1]);
  const q1 = await c.post({ op: 'fallback', name: bP.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), team: 'zdravotni prehled' });
  ok(q1.ok && q1.need === 'confirm' && q1.team?.id === T[1] && q1.sure, 'step 1: team suggestion Zdravotni Prehled');
  ok(q1.player?.id === bP.sid, 'step 1: matches the existing player');
  ok(!('pin' in q1) && !('sid' in q1), 'step 1 signs nobody in');
  const q2 = await c.post({ op: 'fallback', name: q1.player.name, team: 'zdravotni prehled', teamId: q1.team.id, playerId: q1.player.id, confirm: true });
  ok(q2.ok && q2.sid === bP.sid && /^\d{4}$/.test(q2.pin) && q2.matched === 'existing', 'step 2: attached to the existing player with a new PIN');
  const old = await c.me(bP);
  ok(!old.me && old.meError === 'pin', 'the old PIN no longer works');
  const bS = { sid: q2.sid, pin: q2.pin };
  const rb = await c.st(bS, 'submit', { in: { t1: { amt: 500000, why: '' }, t7: { amt: 500000, why: '' } }, out: {} });
  ok(rb.ok, 'fallback player invests 1M');
  const fake = await c.post({ op: 'fallback', name: 'Úplně Jiný', team: 'billi', teamId: T[4], playerId: S[5].sid, confirm: true });
  ok(!fake.ok, 'attaching to a player whose name does not match is refused');
  // C: a new student, team typed "plug"
  const q3 = await c.post({ op: 'fallback', name: 'Nová Studentka', team: 'plug' });
  ok(q3.ok && q3.team?.id === 't7' && q3.sure && q3.player === null, 'step 1: „plug“ → PLUGG, no existing player');
  const q4 = await c.post({ op: 'fallback', name: 'Nová Studentka', team: 'plug', teamId: 't7', confirm: true });
  ok(q4.ok && q4.matched === 'new' && q4.team === 't7', 'step 2: new unverified player in PLUGG');
  const cS = { sid: q4.sid, pin: q4.pin };
  const meC = await c.me(cS);
  ok(meC.me?.unverified === true && meC.me.rules.capital === 1e6 && meC.me.rules.flex, 'new player: $1M, flex, flagged unverified');
  const rcOwn = await c.st(cS, 'submit', { in: { t7: { amt: 300000, why: '' } }, out: {} });
  ok(!rcOwn.ok, 'PLUGG member cannot invest into PLUGG');
  const rc = await c.st(cS, 'submit', { in: { t5: { amt: 300000, why: '' } }, out: {} });
  ok(rc.ok, 'new player invests 300k');
  const noTeam = await c.post({ op: 'fallback', name: 'Někdo Další', team: 'xyz', confirm: true });
  ok(!noTeam.ok, 'confirm without a picked team refused');

  section('dealer: unverified list');
  const dv2 = await c.dget('?view=dealer');
  const unv = dv2.dealer.rows.filter((r) => r.unverified);
  ok(unv.length === 2, `2 unverified players listed (${unv.length})`);
  const ub = unv.find((r) => r.id === bP.sid);
  ok(ub?.unverified.rawTeam === 'zdravotni prehled' && ub.unverified.matched === 'existing' && ub.unverified.last > 0, 'raw typed team + match + time recorded');
  const mk = await c.dealer('unverifiedMark', { sid: bP.sid, checked: true });
  ok(mk.ok && (await c.dget('?view=dealer')).dealer.rows.find((r) => r.id === bP.sid).unverified.checked > 0, 'dealer marks one as checked');

  section('live + showdown (demand off) → Minule → Dnes');
  st = await c.get();
  ok(st.betCount === 3 && st.movement.live, '3 of 21 invested, movement live');
  const exp = { t1: 1_500_000, t5: 1_550_000, t7: 2_100_000 };
  ok(Object.entries(exp).every(([t, v]) => st.teams.find((x) => x.id === t).Vnow === v), 'live values = $1M + money in (demand off)');
  await c.dealer('phase', { phase: 'closed' });
  const sd = await c.dealer('showdown');
  ok(sd.ok && sd.n === 3 && !(sd.skipped || []).length, `showdown applied 3 slips (${sd.n})`);
  st = await c.get();
  ok(st.movement.done && !st.movement.live, 'movement done after the showdown');
  for (const t of st.teams) {
    const mv = st.movement.teams[t.id];
    const want = exp[t.id] || 1e6;
    if (!(t.V === want && mv.now === want && mv.diff === want - mv.prev && Math.abs(mv.pct - Math.round((want / mv.prev - 1) * 1000) / 10) < 1e-9)) ok(false, `movement ${t.name}: ${JSON.stringify(mv)} V=${t.V}`);
  }
  ok(st.teams.length === 7 && st.teams.every((t) => Number.isFinite(t.prevV) && Number.isFinite(t.chg)), 'all 7 teams carry prevV + chg');
  ok(st.movement.teams.t7.prev === 1e6 && st.movement.teams.t7.now === 2_100_000 && st.movement.teams.t7.pct === 110, 'PLUGG: 1,00 M → 2,10 M = ▲110 %');
  const meA = await c.me(a);
  ok(meA.me.portfolio === 850000, `PIN player portfolio = invested 850k (${meA.me.portfolio}); cash 150k not counted as stake`);

  section('movementPrev + undo');
  const mp = await c.dealer('movementPrev', { prev: 'base' });
  ok(mp.ok, 'Minule switched to base values');
  const mp2 = await c.dealer('movementPrev', { prev: { t1: 2_000_000 } });
  ok(mp2.ok && (await c.get()).movement.teams.t1.prev === 2_000_000, 'Minule edited per team');
  const restoreF = await c.dealer('features', { preset: 'restore' });
  ok(restoreF.ok && restoreF.features.demand === true && restoreF.features.simple === false, 'preset restore brings the old switches back');
  await c.dealer('undo'); // showdown
  await c.dealer('undo'); // teamAdd
  await c.dealer('undo'); // newRound
  st = await c.get();
  ok(st.block === 1 && st.phase === 'closed' && st.betCount === 19 && st.teams.length === 6 && !st.movement, 'undo ×3 → back to block 1 closed with the 19 slips and 6 teams');
});
