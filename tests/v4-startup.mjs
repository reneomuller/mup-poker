// v4 startup lane: GET ?view=startup&team=<id> (read-only data for the phone's startup detail sheet).
// Auth (student x-sid/x-pin, dealer, dealer preview as=), privacy (current block = totals only, no ghosts,
// RJ only after its reveal), numbers equal the public state and the Tým tab, the viewer's position and
// return, live = final across the showdown, flag startupPage off, plain GET unchanged.
import { ok, section, main, client, freshGame, initialSlip, rebalanceSlip, sum, DH, OFF } from './_e-lib.mjs';

const c = client();
const H = (s) => ({ 'x-sid': s.sid, 'x-pin': s.pin });
const sv = (s, team, extra = '') => c.get('?view=startup&team=' + encodeURIComponent(team) + extra, s ? H(s) : {});
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

await main(async () => {
  const { T, S, G } = await freshGame(c, { n: 12, ghost: true });
  const X = T[1]; // the ghost's team, so ghost money would show up here if it leaked
  ok(S.length === 12 && G?.sid, 'fresh game: 12 students + a ghost on team 2');

  section('flag + auth');
  const st0 = await c.get();
  ok(st0.features?.startupPage === true, 'feature startupPage is on by default');
  const noAuth = await sv(null, X);
  ok(noAuth._status === 401 && noAuth.ok === false, `no credentials → 401 (${noAuth._status})`);
  const badPin = await c.get('?view=startup&team=' + X, { 'x-sid': S[0].sid, 'x-pin': '0000' });
  ok(badPin._status === 401 && badPin.relogin === true, 'wrong PIN → 401 relogin');
  const unknown = await sv(S[0], 'nope');
  ok(unknown._status === 404 && unknown.error === 'Startup nenalezen.', `unknown team → 404 „${unknown.error}“`);
  const v0 = await sv(S[0], X);
  ok(v0.ok && v0.team === X && Array.isArray(v0.blocks) && v0.blocks.length === 0 && v0.current === null && v0.pending === false, 'lobby: no blocks, nothing pending');
  ok(Array.isArray(v0.history) && v0.history.length >= 1 && v0.history[0].label === 'Start', 'history starts with „Start“');
  const dv = await c.get('?view=startup&team=' + X, DH);
  ok(dv.ok && dv.mine === null, 'dealer (x-dealer) gets the view without a position');

  section('betting: current block = totals only');
  await c.dealer('phase', { phase: 'betting', minutes: 5 });
  const slips = {};
  for (const [i, s] of S.entries()) {
    const sl = initialSlip(T, s.team, i, 1_000_000, 'TAJNE');
    slips[s.sid] = sl;
    const r = await c.st(s, 'submit', { ...sl, out: {} });
    if (!r.ok) ok(false, `submit ${s.name}: ${r.error}`);
  }
  const gSlip = { in: { [T[0]]: { amt: 600_000, why: 'GHOSTWHY' }, [T[2]]: { amt: 400_000, why: '' } }, out: {} };
  await c.st(G, 'submit', gSlip);
  const inX = S.filter((s) => slips[s.sid].in[X]?.amt > 0);
  const totX = sum(inX.map((s) => slips[s.sid].in[X].amt));
  const pub = await c.get();
  const tX = pub.teams.find((t) => t.id === X);
  const v1 = await sv(S[0], X);
  ok(v1.ok && v1.pending === true && v1.blocks.length === 0, 'betting: pending, still no settled blocks');
  ok(v1.current && v1.current.block === 1 && v1.current.totalIn === totX && v1.current.totalOut === 0 && v1.current.count === inX.length,
    `current block totals: ${v1.current?.totalIn} = ${totX}, ${v1.current?.count} = ${inX.length} investors`);
  ok(v1.current && Object.keys(v1.current).sort().join() === 'block,count,mult,totalIn,totalOut', 'current block carries totals only (no names, no reasons)');
  const raw1 = v1._raw;
  ok(!/TAJNE|GHOSTWHY/.test(raw1), 'no reason text from the unsettled block');
  ok(!S.some((s) => raw1.includes(`"${s.name}"`)) && !raw1.includes('"Ghost"'), 'no investor names from the unsettled block');
  ok(v1.Vnow === tX.Vnow && near(v1.mult, tX.mult, 1e-4) && v1.rank === tX.rank && near(v1.chg, tX.chg, 1e-4), `Vnow/mult/rank/chg equal the public state (${v1.Vnow} / ${tX.Vnow})`);
  ok(near(v1.Pnow * (1_000_000 / (v1.founders / 100)), v1.Vnow, v1.Vnow * 0.002), 'Pnow × shares ≈ Vnow');
  ok(v1.history.at(-1).label === 'Teď' && v1.history.at(-1).live === true && v1.history.at(-1).V === v1.Vnow, 'history ends with the live point');
  ok(tX.live === totX, `public live money for the team (${tX.live}) = class money in this block`);

  section('the viewer\'s position');
  const inv = inX[0];
  const amt = slips[inv.sid].in[X].amt;
  const meI = (await c.me(inv)).me;
  const vI = await sv(inv, X);
  ok(vI.mine && near(vI.mine.value, meI.stakesNow[X]), `position value = stakesNow (${vI.mine?.value} / ${meI.stakesNow[X]})`);
  ok(vI.mine && near(vI.mine.cost, amt), `cost = money put in (${vI.mine?.cost} / ${amt})`);
  ok(vI.mine && near(vI.mine.returnPct, Math.round((vI.mine.value / vI.mine.cost - 1) * 1000) / 10, 0.11), `return % (${vI.mine?.returnPct})`);
  const non = S.find((s) => !(slips[s.sid].in[X]?.amt > 0));
  const vN = await sv(non, X);
  ok(vN.mine && vN.mine.value === 0 && vN.mine.cost === null && vN.mine.returnPct === null, 'no stake → value 0, no return');
  const pv = await c.get('?view=startup&team=' + X + '&as=' + inv.sid, DH);
  ok(pv.ok && pv.mine && pv.mine.value === vI.mine.value, 'dealer preview (as=) sees that student\'s position');

  section('showdown: live = final, settled block lists names and reasons');
  const before = v1.Vnow;
  await c.dealer('phase', { phase: 'closed' });
  ok((await c.dealer('showdown')).ok, 'showdown');
  const v2 = await sv(S[0], X);
  ok(v2.pending === false && v2.current === null && v2.Vnow === before && v2.V === before, `valuation after the showdown = the live number (${v2.V} / ${before})`);
  const b1 = v2.blocks[0];
  ok(b1 && b1.block === 1 && b1.rj === false && b1.totalIn === totX, `block 1 settled with ${b1?.totalIn} in`);
  ok(b1 && b1.investors.length === inX.length && inX.every((s) => b1.investors.some((v) => v.id === s.sid && v.name === s.name && v.in === slips[s.sid].in[X].amt && v.whyIn === (slips[s.sid].in[X].why || ''))),
    'every class investor listed by name with amount and reason');
  ok(b1 && !b1.investors.some((v) => v.id === G.sid || v.id === 'rj') && !v2._raw.includes('GHOSTWHY'), 'no ghost, no RJ before its reveal');
  const member = S.find((s) => s.team === X);
  const mt = (await c.me(member)).me.myTeam;
  const f1 = mt.flows.find((f) => f.block === 1);
  ok(f1 && JSON.stringify(f1.investors) === JSON.stringify(b1.investors) && f1.mult === b1.mult, 'same investors and multiple as the team\'s own Tým tab');
  ok(v2.investorsNow === mt.investorsNow && v2.founders === mt.founders, 'investors and founders % equal the Tým tab');
  const vI2 = await sv(inv, X);
  ok(near(vI2.mine.value, vI.mine.value) && near(vI2.mine.cost, amt), 'position unchanged by the showdown (it was already live)');
  const meI2 = (await c.me(inv)).me;
  ok(Array.isArray(vI2.mySeries) && vI2.mySeries.length >= 1 && vI2.mySeries[0].label === 'Blok 1' && near(vI2.mySeries.at(-1).V, meI2.stakes[X], 2),
    `„Moje pozice“ series ends at the real stake (${vI2.mySeries?.at(-1)?.V} / ${meI2.stakes[X]})`);
  ok(Array.isArray(vN.mySeries) && vN.mySeries.length === 0, 'no stake → empty series');
  ok(dv.mySeries === null, 'dealer → no series');

  section('RJ after its reveal');
  const rjS = await c.dealer('rjSave', { in: { [X]: { amt: 4_000_000, why: 'RJ důvod' }, [T[3]]: { amt: 3_000_000, why: '' }, [T[4]]: { amt: 3_000_000, why: '' } }, out: {} });
  ok(rjS.ok, `rjSave (${rjS.error || 'ok'})`);
  const v3a = await sv(S[0], X);
  ok(!v3a.blocks[0].investors.some((v) => v.id === 'rj'), 'RJ hidden before the reveal');
  ok((await c.dealer('rjReveal')).ok, 'rjReveal');
  const v3 = await sv(S[0], X);
  const rj = v3.blocks[0].investors.find((v) => v.id === 'rj');
  ok(v3.blocks[0].rj === true && rj && rj.name === 'RainbowJet' && rj.in === 4_000_000 && rj.whyIn === 'RJ důvod', 'RJ listed as „RainbowJet“ after the reveal');

  section('block 2: older blocks stay, the new one is totals only');
  ok((await c.dealer('nextBlock')).ok, 'nextBlock');
  await c.dealer('phase', { phase: 'betting' });
  let moved = 0;
  for (const [i, s] of S.entries()) {
    const me = (await c.me(s)).me;
    const sl = rebalanceSlip(T, s.team, me.stakes, i, 300_000, 'TAJNE2');
    if (!sl) continue;
    const r = await c.st(s, 'submit', sl);
    if (r.ok) moved++;
  }
  ok(moved > 3, `${moved} students rebalance in block 2`);
  const v4 = await sv(S[0], X);
  const pub4 = await c.get();
  const t4 = pub4.teams.find((t) => t.id === X);
  ok(v4.pending && v4.current?.block === 2 && v4.blocks.length === 1 && v4.blocks[0].block === 1, 'block 2 pending, block 1 still listed');
  ok(!v4._raw.includes('TAJNE2'), 'no block 2 reasons');
  ok(v4.current && v4.current.totalIn - v4.current.totalOut === t4.live, `block 2 net (${v4.current && v4.current.totalIn - v4.current.totalOut}) = public live (${t4.live})`);
  ok(v4.Vnow === t4.Vnow && v4.rank === t4.rank, 'live valuation and rank equal the public state in block 2');
  for (const s of S.slice(0, 6)) {
    const me = (await c.me(s)).me;
    for (const t of T) {
      if (t === s.team) continue;
      const v = await sv(s, t);
      const real = me.stakes[t] || 0;
      const last = v.mySeries?.at(-1)?.V ?? 0;
      if (!Array.isArray(v.mySeries) || !near(last, real, Math.max(2, real * 0.005))) ok(false, `series of ${s.name} in ${t}: ${last} vs stake ${real}`);
    }
  }
  ok(true, '„Moje pozice“ series match the real stakes for 6 students × 5 teams after RJ and block 1');

  section('flag off');
  await c.dealer('features', { set: { startupPage: false } });
  const off = await sv(S[0], X);
  ok(off.ok === false && off.error === OFF && off._status === 403, `startupPage off → „${off.error}“`);
  const plain = await c.me(S[0]);
  ok(plain.features?.startupPage === false && Array.isArray(plain.teams) && plain.me, 'plain GET works with the flag off');
  await c.dealer('features', { set: { startupPage: true } });
  ok((await sv(S[0], X)).ok, 'flag back on → view works again');

  section('guard: wrong PINs on the startup / recap views count (review)');
  { // these views check the PIN themselves; without the gate they were a PIN oracle around the guard lockout
    const bf = await c.post({ op: 'register', name: 'Brute Force', team: T[0], pin: '4321' });
    for (let i = 0; i < 8; i++) await c.get('?view=' + (i % 2 ? 'recap' : 'startup&team=' + X), { 'x-sid': bf.sid, 'x-pin': String(5000 + i) });
    const right = await c.get('?view=startup&team=' + X, { 'x-sid': bf.sid, 'x-pin': '4321' });
    ok(bf.ok && right._status === 401 && /Moc pokusů/.test(right.error || ''), `after 8 wrong PINs even the right one is refused (${right._status} ${right.error})`);
    const g = await c.get('', { 'x-sid': bf.sid, 'x-pin': '4321' });
    ok(!g.me && g.meError === 'locked', `…and the player is locked for the plain GET too (${g.meError})`);
    ok((await c.dealer('removePlayer', { sid: bf.sid })).ok, 'clean-up: the test player is removed again');
  }
});
