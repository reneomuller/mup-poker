// Full game with every feature on: 18 students + a ghost, 5 blocks, then the exit.
// Every block: cards, milestones, round terms, betting, showdown, RJ (tranches), revalue with reasons,
// a market card, a quiz, points and awards. Invariants are checked after every step.
import { ok, warnIf, info, section, main, client, sleep, sum, sumAmt, shape, checkClean, invariants, freshGame, initialSlip, rebalanceSlip, ALL_ON, REASON_LABELS, OFF, quizScore, answerAll, ledgerTotal, round1, FS } from './_e-lib.mjs';

const c = client();
const V = (st, t) => st.teams.find((x) => x.id === t).V;

await main(async () => {
  const { T, S, G } = await freshGame(c, { n: 18, ghost: true, features: { ...ALL_ON, demand: false } });
  const ctx = { S, G };
  const inv = (label) => invariants(c, ctx, label);
  let st = await c.get();
  ok(Object.values(st.features || {}).length >= 10 && Object.keys(ALL_ON).every((k) => st.features[k] === (k !== 'demand')), 'all 10 v2 features switched on (demand off)');
  const members = (t) => S.filter((s) => s.team === t);
  const QSET = { id: 'fg', title: 'Kvíz celé hry', questions: [
    { q: 'Co znamená MVP?', a: ['Most Valuable Player', 'Minimální životaschopný produkt', 'Marketingový plán', 'Měsíční výnos'], correct: 1, time: 30 },
    { q: 'Je CAC cena za zákazníka?', a: ['Ano', 'Ne'], correct: 0, time: 30 },
  ] };
  ok((await c.dealer('quizSave', { set: QSET })).ok, 'quizSave custom set');
  const trancheIds = {};
  const slipsBy = {}; // block -> sid -> slip we sent

  for (let blk = 1; blk <= 5; blk++) {
    section(`block ${blk}`);
    st = await c.get();
    ok(st.block === blk && st.phase === 'lobby', `block ${blk} starts in lobby (${st.block}/${st.phase})`);

    // --- startup cards (students) ---
    const cardRes = await Promise.all(T.map((t, i) => c.st(members(t)[0], 'card', { oneLiner: `Tým ${i} v bloku ${blk}: řešíme parkování`, sub: `Podrobnosti týmu ${i}, blok ${blk}. „Uvozovky“ – pomlčka.` })));
    ok(cardRes.every((r) => r.ok), 'every team edits its card at once: ' + (cardRes.find((r) => !r.ok)?.error || 'ok'));
    st = await c.get();
    ok(T.every((t, i) => st.cards?.[t]?.oneLiner === `Tým ${i} v bloku ${blk}: řešíme parkování` && st.cards[t].sub.includes(`blok ${blk}`)), 'publicState.cards has all 6 cards');
    if (blk === 1) {
      shape('cards[t]', st.cards?.[T[0]], { oneLiner: 'string', sub: 'string', milestones: 'object' }, { strict: true });
      const gr = await c.st(G, 'card', { oneLiner: 'Ghost card', sub: 'x' });
      ok(!gr.ok, 'ghost card edit refused');
      const long = await c.st(S[0], 'card', { oneLiner: 'x'.repeat(130), sub: 'y'.repeat(300) });
      const s2 = await c.get();
      ok(!long.ok || (s2.cards[T[0]].oneLiner.length <= 90 && s2.cards[T[0]].sub.length <= 220), 'card limits 90/220 enforced');
      await c.st(S[0], 'card', { oneLiner: `Tým 0 v bloku ${blk}: řešíme parkování`, sub: `Podrobnosti týmu 0, blok ${blk}. „Uvozovky“ – pomlčka.` });
      const other = await c.st(S[0], 'card', { team: T[3], oneLiner: 'Cizí tým', sub: 'cizí' });
      const s3 = await c.get();
      ok(s3.cards[T[3]].oneLiner !== 'Cizí tým', `student cannot edit another team's card (${other.ok ? 'ok but ignored' : 'refused'})`);
      if (other.ok && s3.cards[T[0]].oneLiner === 'Cizí tým') await c.st(S[0], 'card', { oneLiner: `Tým 0 v bloku ${blk}: řešíme parkování`, sub: 'x' });
    }

    // --- milestones (dealer) → +300 per member ---
    const ms = { 1: ['m1a', 'm1b'], 2: ['m2a', 'm2b'], 3: ['m3a'], 4: ['m4a'], 5: ['m5a'] }[blk];
    const mt = T[blk % 6], mt2 = T[1]; // T[1] holds the ghost
    const before = await c.meta();
    const r1 = await c.dealer('card', { team: mt, milestones: { [ms[0]]: true } });
    const r2 = await c.dealer('card', { team: mt2, milestones: Object.fromEntries(ms.map((k) => [k, true])) });
    ok(r1.ok && r2.ok, 'dealer sets milestones');
    await c.dealer('card', { team: mt2, milestones: { [ms[0]]: true } }); // again: no new points
    const after = await c.meta();
    const gained = (sid) => ledgerTotal(after, sid) - ledgerTotal(before, sid);
    ok(members(mt).every((s) => gained(s.sid) === 300 * (mt === mt2 ? ms.length : 1)), `milestone: +300 per member of ${mt}`);
    ok(members(mt2).every((s) => gained(s.sid) === 300 * ms.length), `milestones: +300 × ${ms.length} per member of ${mt2}, re-setting adds nothing`);
    ok(gained(G.sid) === 0, 'ghost member gets no milestone points');
    ok((after.points || []).filter((e) => e.kind === 'milestone').every((e) => typeof e.note === 'string'), 'milestone ledger entries have a note');
    st = await c.get();
    ok(ms.every((k) => st.cards[mt2].milestones[k] === true), 'milestones visible in publicState.cards');
    // dealer edits a card text
    ok((await c.dealer('card', { team: T[5], oneLiner: 'Upraveno dealerem', sub: 'Dealer' })).ok, 'dealer edits a card');
    st = await c.get();
    ok(st.cards[T[5]].oneLiner === 'Upraveno dealerem', 'dealer card edit visible');
    await inv(`b${blk} cards+milestones`);

    // --- priced round terms ---
    st = await c.get();
    const v0 = V(st, T[0]), v1 = V(st, T[1]);
    const preUp = Math.round((v0 * 1.2) / 10000) * 10000;
    const bad = await c.st(S[0], 'roundTerms', { pre: Math.round(v0 * 2.3) });
    ok(!bad.ok && /^Ocenění kola musí být mezi /.test(bad.error || ''), `out-of-range terms refused: ${bad.error}`);
    const low = await c.st(S[0], 'roundTerms', { pre: Math.round(v0 * 0.4) });
    ok(!low.ok, 'terms below 50 % refused');
    ok(!(await c.st(G, 'roundTerms', { pre: v1 })).ok, 'ghost cannot set round terms');
    const ru = await c.st(S[0], 'roundTerms', { pre: preUp });
    ok(ru.ok, `student sets up-round terms ${preUp} (${ru.error || 'ok'})`);
    const preDownRaw = Math.round(v1 * 0.8) + 3456;
    const rd = await c.dealer('roundTerms', { team: T[1], pre: preDownRaw });
    ok(rd.ok, 'dealer sets down-round terms ' + (rd.error || ''));
    await c.dealer('phase', { phase: 'pitch', team: T[0] });
    st = await c.get();
    const R = st.rounds || {};
    if (blk === 1) shape('rounds[t]', R[T[0]], { pre: 'number', prev: 'number', kind: 'string', pct: 'number' }, { strict: true });
    ok(R[T[0]]?.pre === preUp && R[T[0]].prev === v0 && R[T[0]].kind === 'up' && Math.abs(R[T[0]].pct - round1(((preUp - v0) / v0) * 100)) < 0.051, `rounds[${T[0]}] up ${R[T[0]]?.pct}%`);
    const expDown = Math.round(preDownRaw / 10000) * 10000;
    ok(R[T[1]]?.pre === expDown && R[T[1]].kind === 'down', `dealer terms rounded to nearest 10 000 (${preDownRaw} → ${R[T[1]]?.pre}, expected ${expDown})`);
    ok(!R[T[2]] || R[T[2]].kind === 'flat', 'team without terms = flat round');
    // --- betting: rounds reprice ---
    const hist0 = st.history.length;
    ok((await c.dealer('phase', { phase: 'betting', minutes: 5 })).ok, 'betting opens');
    st = await c.get();
    ok(Math.abs(V(st, T[0]) - preUp) <= 1 && Math.abs(V(st, T[1]) - expDown) <= 1, `round repricing: V = pre (${V(st, T[0])}, ${V(st, T[1])})`);
    ok(st.history.length === hist0 + 1 && st.history[st.history.length - 1].label === `Kolo bloku ${blk}`, `history snapshot "Kolo bloku ${blk}"`);
    ok(st.drivers?.[T[0]]?.[0]?.kind === 'round' && st.drivers[T[0]][0].note === 'Up round' && Math.abs(st.drivers[T[0]][0].delta - (preUp - v0)) <= 1, 'round driver "Up round" with delta');
    ok(st.drivers?.[T[1]]?.[0]?.kind === 'round' && st.drivers[T[1]][0].note === 'Down round', 'round driver "Down round"');
    ok(!(await c.st(S[0], 'roundTerms', { pre: preUp })).ok && !(await c.dealer('roundTerms', { team: T[2], pre: V(st, T[2]) })).ok, 'terms locked once betting opened');
    ok(!(await c.dealer('marketCard', { title: 'Během sázek', text: 'x', effects: { [T[0]]: 10 } })).ok, 'market card refused during betting');
    await inv(`b${blk} round priced`);

    // --- submits: 18 students at once (+ ghost) ---
    const mes = await Promise.all(S.map((s) => c.me(s)));
    const slips = {};
    S.forEach((s, i) => {
      const m = mes[i].me;
      slips[s.sid] = blk === 1 || m.rules.mode === 'initial' ? initialSlip(T, s.team, i + blk, 1_000_000, `b${blk}-`) : rebalanceSlip(T, s.team, m.stakes, i + blk, m.rules.cashoutMax, `b${blk}-`);
    });
    if (blk > 1) {
      ok(mes.every((m) => m.me.rules.mode === 'rebalance' && m.me.rules.exact === true && m.me.rules.cashoutMax === 300000), 'all students must move exactly 300 000');
      const s9 = S[9];
      const sl = rebalanceSlip(T, s9.team, mes[9].me.stakes, 3, 290000);
      const r = await c.st(s9, 'submit', sl);
      ok(!r.ok && /přesně/.test(r.error || ''), '290k rebalance refused: ' + r.error);
    }
    ok(Object.values(slips).every(Boolean), 'test built a valid slip for everyone');
    const subs = await Promise.all(S.map((s) => c.st(s, 'submit', slips[s.sid])));
    ok(subs.every((r) => r.ok), `18 submits at once ok ${subs.filter((r) => !r.ok).map((r) => r.error).slice(0, 2).join(' | ')}`);
    const gm = await c.me(G);
    const gs = gm.me.rules.mode === 'initial' ? initialSlip(T, G.team, 1, 1_000_000, 'ghost') : null;
    if (gs) await c.st(G, 'submit', gs);
    slipsBy[blk] = slips;
    st = await c.get();
    ok(st.betCount === 18, `betCount 18 (${st.betCount})`);
    const expNet = {};
    for (const sl of Object.values(slips)) {
      for (const [t, e] of Object.entries(sl.in)) expNet[t] = (expNet[t] || 0) + e.amt;
      for (const [t, e] of Object.entries(sl.out || {})) expNet[t] = (expNet[t] || 0) - e.amt;
    }
    ok(T.every((t) => Math.abs((st.teams.find((x) => x.id === t).live || 0) - (expNet[t] || 0)) <= 1), 'live incoming money = Σ submitted (ghost excluded)');
    await c.dealer('phase', { phase: 'closed' });
    const vBefore = Object.fromEntries(st.teams.map((t) => [t.id, t.V]));
    const sd = await c.dealer('showdown');
    ok(sd.ok && sd.n === 18, `showdown applied 18 (${sd.n} ${sd.error || ''})`);
    st = await c.get();
    ok(T.every((t) => Math.abs((st.reveal.delta[t] || 0) - (expNet[t] || 0)) <= 1), 'class money at showdown = Σ submitted in − out per team');
    ok(T.every((t) => Math.abs(V(st, t) - vBefore[t] - (expNet[t] || 0)) <= 2), 'valuations moved by exactly the class money');
    ok(T.filter((t) => Math.abs(expNet[t] || 0) > 1).every((t) => st.drivers[t]?.[0]?.kind === 'class' && Math.abs(st.drivers[t][0].delta - expNet[t]) <= 1 && st.drivers[t][0].block === blk), 'class drivers with delta = net class money');
    if (blk === 1) {
      ok(Math.abs(sum(st.teams.map((t) => t.cls)) - 18e6) <= 6, 'block 1: class money 18M');
      shape('teams[i].cap', st.teams[0].cap, { founders: 'number', cls: 'number', rj: 'number', investors: 'number' }, { strict: true });
      shape('drivers entry', st.drivers[T[2]]?.[0], { ts: 'number', block: 'number', team: 'string', kind: 'string', delta: 'number', note: 'string' }, { strict: true });
    }
    ok(T.every((t) => (st.drivers[t] || []).length <= 8 && (st.drivers[t] || []).every((d, i, a) => i === 0 || a[i - 1].ts >= d.ts)), 'drivers: ≤ 8 per team, newest first');
    const last = st.history[st.history.length - 1];
    ok(last.label === `Blok ${blk}` && last.F && T.every((t) => typeof last.F[t] === 'number'), 'showdown snapshot has F (founders %)');
    const m0 = await c.me(S[0]);
    shape('me.myTeamCap', m0.me?.myTeamCap, { founders: 'number', cls: 'number', rj: 'number', investors: 'number', history: 'array' });
    ok((m0.me?.myTeamCap?.history || []).every((h) => typeof h.label === 'string' && typeof h.founders === 'number') && m0.me.myTeamCap.history.length >= blk, 'myTeamCap.history [{label, founders}]');
    await inv(`b${blk} showdown`);

    // --- RJ (tranches on) ---
    const dv = await c.dget('?view=dealer');
    const rjr = dv.dealer.rj.rules;
    let rjSlip;
    if (blk === 1) {
      ok(rjr.mode === 'fund' && rjr.capital === 10_000_000, `tranches on: RJ rules mode "fund", capital = available 10M (${rjr.mode}, ${rjr.capital})`);
      rjSlip = { in: { [T[0]]: { amt: 2e6, why: 'RJ: tým' }, [T[2]]: { amt: 2e6, why: 'RJ: trh' }, [T[4]]: { amt: 2e6, why: 'RJ: produkt' } } };
    } else if (rjr.mode === 'rebalance') {
      const rs = dv.dealer.rj.stakes;
      const from = Object.entries(rs).sort((a, b) => b[1] - a[1])[0][0];
      const to = T.find((t) => t !== from && rs[t] < 1) || T.find((t) => t !== from);
      rjSlip = { out: { [from]: { amt: 100000, why: 'RJ ven' } }, in: { [to]: { amt: 100000, why: 'RJ dovnitř' } } };
    } else {
      info(`block ${blk}: RJ rules ${JSON.stringify(rjr)}`);
      rjSlip = { in: { [T[3]]: { amt: Math.min(100000, rjr.capital), why: 'RJ' } } };
    }
    const rs = await c.dealer('rjSave', rjSlip);
    ok(rs.ok, 'rjSave ' + (rs.error || ''));
    const fund0 = (await c.get()).rjFund;
    const rr = await c.dealer('rjReveal');
    ok(rr.ok, 'rjReveal ' + (rr.error || ''));
    st = await c.get();
    const rjNet = sumAmt(rjSlip.in) - sumAmt(rjSlip.out);
    ok(Math.abs(st.rjFund.invested - fund0.invested - rjNet) <= 1, `rjFund.invested grew by RJ net ${rjNet}`);
    if (blk === 1) {
      shape('rjFund', st.rjFund, { capital: 'number', invested: 'number', locked: 'number', available: 'number' }, { strict: true });
      ok(st.rjFund.invested === 6e6 && st.rjFund.available === 4e6, `partial RJ: invested 6M, available 4M (${st.rjFund.invested}/${st.rjFund.available})`);
      ok(T.filter((t) => rjSlip.in[t]).every((t) => st.drivers[t][0].kind === 'rj' && Math.abs(st.drivers[t][0].delta - 2e6) <= 1), 'rj drivers at reveal');
      // tranches
      const tooBig = await c.dealer('trancheAdd', { team: T[3], amt: 5e6, cond: 'Příliš', due: 'Blok 3' });
      ok(!tooBig.ok, 'tranche above available refused');
      const ta = await c.dealer('trancheAdd', { team: T[3], amt: 1e6, cond: 'MVP na veřejné adrese', due: 'Blok 3' });
      const tb = await c.dealer('trancheAdd', { team: T[5], amt: 1.5e6, cond: '100 platících uživatelů', due: 'Blok 4' });
      ok(ta.ok && tb.ok, 'two tranches added');
      st = await c.get();
      const tA = st.tranches.find((x) => x.team === T[3]), tB = st.tranches.find((x) => x.team === T[5]);
      ok(ta.id === undefined || ta.id === tA?.id, 'trancheAdd returns the tranche id (or none)');
      trancheIds.a = tA?.id; trancheIds.b = tB?.id;
      shape('tranches[0]', tA, { id: 'string', team: 'string', amt: 'number', cond: 'string', due: 'string|number|null', status: 'string' }, { strict: true });
      ok(tA?.status === 'locked' && st.rjFund.locked === 2.5e6 && st.rjFund.available === 1.5e6, 'locked 2.5M, available 1.5M');
      ok(!(await c.dealer('trancheAdd', { team: T[1], amt: 2e6, cond: 'x', due: 'y' })).ok, 'tranche above the remaining available refused');
    }
    await inv(`b${blk} rj`);

    if (blk === 2 && trancheIds.a) {
      const v3 = V(st, T[3]);
      const fb = st.rjFund;
      const tr = await c.dealer('trancheRelease', { id: trancheIds.a });
      ok(tr.ok, 'trancheRelease ' + (tr.error || ''));
      st = await c.get();
      ok(Math.abs(V(st, T[3]) - v3 - 1e6) <= 1, 'released tranche adds 1M to the team valuation');
      ok(st.tranches.find((x) => x.id === trancheIds.a).status === 'released', 'tranche status released');
      ok(st.rjFund.invested === fb.invested + 1e6 && st.rjFund.locked === fb.locked - 1e6 && st.rjFund.available === fb.available, 'rjFund: invested +1M, locked −1M, available unchanged');
      ok(st.reveal?.kind === 'tranche' && st.reveal.team === T[3] && st.reveal.amt === 1e6, 'reveal kind tranche');
      ok(st.drivers[T[3]][0].kind === 'rj' && Math.abs(st.drivers[T[3]][0].delta - 1e6) <= 1, 'tranche release driver rj');
      const mm = await c.me(members(T[3])[0]);
      ok(mm.me.msgs.some((m) => m.kind === 'tranche' && m.amt === 1e6 && m.cond === 'MVP na veřejné adrese'), 'team gets a tranche message');
      ok(!(await c.dealer('trancheRelease', { id: trancheIds.a })).ok, 'releasing twice refused');
      await inv('b2 tranche released');
    }
    if (blk === 3 && trancheIds.b) {
      const fb = st.rjFund;
      ok((await c.dealer('trancheCancel', { id: trancheIds.b })).ok, 'trancheCancel');
      st = await c.get();
      ok(st.tranches.find((x) => x.id === trancheIds.b).status === 'cancelled' && st.rjFund.locked === fb.locked - 1.5e6 && st.rjFund.available === fb.available + 1.5e6, 'cancelled tranche frees 1.5M');
      ok(!(await c.dealer('trancheRelease', { id: trancheIds.b })).ok, 'cancelled tranche cannot be released');
      await inv('b3 tranche cancelled');
    }

    // --- revalue with reasons ---
    st = await c.get();
    const a0 = V(st, T[0]), a4 = V(st, T[4]);
    const rv = await c.dealer('revalue', { V: { [T[0]]: Math.round(a0 * 1.3), [T[4]]: Math.round(a4 * 0.85) }, why: { [T[0]]: `Skvělá trakce ${blk}` }, reason: { [T[0]]: 'traction', [T[4]]: 'risk' } });
    ok(rv.ok, 'revalue with reasons ' + (rv.error || ''));
    st = await c.get();
    const d0 = st.drivers[T[0]][0], d4 = st.drivers[T[4]][0];
    ok(d0.kind === 'revalue' && [`Skvělá trakce ${blk}`, REASON_LABELS.traction].includes(d0.note) && Math.abs(d0.delta - (Math.round(a0 * 1.3) - a0)) <= 2, `revalue driver: note = why text or reason label, delta (${d0.note})`);
    if (blk === 1) warnIf(d0.note === `Skvělá trakce ${blk}`, 'spec §5 says revalue driver note = the why text, but why is a private team message; server uses the reason label instead (keeps it private)');
    ok(d4.kind === 'revalue' && d4.note === REASON_LABELS.risk && d4.delta < 0, `revalue driver: note = reason label „Riziko“ (${d4.note})`);
    ok(JSON.stringify(st.reasonLabels) === JSON.stringify(REASON_LABELS), 'reasonLabels');
    await inv(`b${blk} revalue`);

    // --- market card ---
    const eff = { [T[1]]: -20, [T[5]]: 15 };
    const b1 = V(st, T[1]), b5 = V(st, T[5]), b2 = V(st, T[2]);
    const hl = st.history.length;
    if (blk === 1) {
      const oor = await c.dealer('marketCard', { title: 'Mimo rozsah', text: 'x', effects: { [T[2]]: -75 } });
      const vv = V(await c.get(), T[2]);
      ok(!oor.ok || Math.abs(vv - b2 * 0.4) <= 2 || vv === b2, `market pct below −60 refused or clamped (${oor.ok ? 'accepted, V ' + b2 + '→' + vv : 'refused'})`);
    }
    st = await c.get();
    const mc = await c.dealer('marketCard', { title: `Recese ${blk}`, text: 'Banky utahují úvěry – „B2B“ trh zpomaluje.', effects: eff });
    ok(mc.ok, 'marketCard ' + (mc.error || ''));
    const s2 = await c.get();
    ok(Math.abs(V(s2, T[1]) - V(st, T[1]) * 0.8) <= 2 && Math.abs(V(s2, T[5]) - V(st, T[5]) * 1.15) <= 2 && V(s2, T[0]) === V(st, T[0]), 'market card moves P by pct, other teams untouched');
    const fl = s2.market?.flipped || [];
    const card = fl[fl.length - 1];
    if (blk === 1) shape('market.flipped[]', card, { id: 'string', block: 'number', ts: 'number', title: 'string', text: 'string', effects: 'object' }, { strict: true });
    ok(card?.title === `Recese ${blk}` && card.effects[T[1]] === -20 && card.block === blk, 'publicState.market.flipped has the card');
    ok(s2.reveal?.kind === 'market' && s2.reveal.title === `Recese ${blk}` && Math.abs(s2.reveal.delta[T[1]] - (V(s2, T[1]) - V(st, T[1]))) <= 2, 'reveal kind market with $ delta');
    ok(s2.history[s2.history.length - 1].label === `Karta: Recese ${blk}`, 'history "Karta: <title>"');
    ok(s2.drivers[T[1]][0].kind === 'market' && s2.drivers[T[1]][0].note === `Recese ${blk}`, 'market driver, note = title');
    const mm = await c.me(members(T[1])[0]);
    ok(mm.me.msgs.some((m) => m.kind === 'market' && m.title === `Recese ${blk}` && m.pct === -20 && typeof m.text === 'string'), 'team gets the market message');
    const mo = await c.me(members(T[0])[0]);
    ok(!mo.me.msgs.some((m) => m.kind === 'market' && m.title === `Recese ${blk}`), 'unaffected team gets no market message');
    void b1; void b5; void hl;
    await inv(`b${blk} market`);

    // --- quiz ---
    const qs = await c.dealer('quizStart', { setId: 'fg' });
    ok(qs.ok, 'quizStart');
    st = await c.get();
    ok(st.quiz?.state === 'board' && st.quiz.idx === -1 && st.quiz.total === 2 && st.quiz.setTitle === 'Kvíz celé hry', 'quiz lobby: board, idx −1');
    for (let qi = 0; qi < 2; qi++) {
      await c.dealer('quizNext');
      const qq = await c.get();
      ok(qq.quiz.state === 'question' && qq.quiz.idx === qi && !('correct' in qq.quiz), `question ${qi + 1} live, no correct index`);
      const choices = (s, i) => (i % 3 === 0 ? QSET.questions[qi].correct : (QSET.questions[qi].correct + 1) % QSET.questions[qi].a.length);
      const ans = await answerAll(c, S, choices);
      ok(ans.every((r) => r.ok), '18 answers at once ' + (ans.find((r) => !r.ok)?.error || ''));
      await c.st(G, 'quizAnswer', { choice: QSET.questions[qi].correct });
      const m4 = await c.dealer('quizReveal');
      ok(m4.ok, 'quizReveal');
      const rv2 = await c.get();
      ok(rv2.quiz.state === 'reveal' && rv2.quiz.correct === QSET.questions[qi].correct && sum(rv2.quiz.counts) >= 18, `reveal: correct + counts (${rv2.quiz.counts})`);
      await c.dealer('quizBoard');
    }
    await c.dealer('quizNext');
    st = await c.get();
    ok(st.quiz.state === 'done', 'quizNext after the last question → done');
    ok(Array.isArray(st.quiz.leaders) && st.quiz.leaders.length >= 6 && st.quiz.leaders.length <= 10 && !st.quiz.leaders.some((l) => l.name === 'Ghost') && st.quiz.leaders.every((l, i, a) => i === 0 || a[i - 1].quizPoints >= l.quizPoints), `quiz leaders: ≤ 10, sorted, without the ghost (${st.quiz.leaders?.length})`);
    await c.dealer('quizEnd');
    await inv(`b${blk} quiz`);

    // --- points + awards ---
    const mb = await c.meta();
    ok((await c.dealer('pointsAdd', { team: T[1], amt: 100, note: `Bonus týmu ${blk}` })).ok, 'pointsAdd to a team');
    const award = await c.dealer('award', { kind: 'sharpest', playerId: S[blk].sid, note: `Nejlepší call bloku ${blk}` });
    ok(award.ok, 'award');
    const ma = await c.meta();
    ok(members(T[1]).every((s) => ledgerTotal(ma, s.sid) - ledgerTotal(mb, s.sid) === 100 + (s.sid === S[blk].sid ? 500 : 0)), 'team points to every member');
    ok(ledgerTotal(ma, G.sid) === 0, 'ghost: no points');
    ok(ledgerTotal(ma, S[blk].sid) - ledgerTotal(mb, S[blk].sid) === 500 + (S[blk].team === T[1] ? 100 : 0), 'award +500 points');
    st = await c.get();
    const aw = (st.awards || []).find((a) => a.note === `Nejlepší call bloku ${blk}`);
    if (blk === 1) shape('awards[]', aw, { id: 'string', block: 'number', kind: 'string', name: 'string', team: 'string', note: 'string' }, { strict: true });
    ok(aw && aw.name === S[blk].name && aw.block === blk && aw.kind === 'sharpest', 'publicState.awards lists it');
    const mw = await c.me(S[blk]);
    ok((mw.me.track?.awards || []).some((a) => a.note === `Nejlepší call bloku ${blk}`), 'me.track.awards lists it');
    if (blk === 1) {
      shape('me.track', mw.me.track, { value: 'number', start: 'number', returnPct: 'number', rank: 'number', of: 'number', bestCall: 'object|null', awards: 'array' }, { strict: true });
      shape('me.points', mw.me.points, { total: 'number', rank: 'number', of: 'number', recent: 'array' }, { strict: true });
      shape('points', st.points, { leaders: 'array', teams: 'object' }, { strict: true });
      shape('leaders[0]', st.leaders[0], { name: 'string', team: 'string', value: 'number', returnPct: 'number' });
      const tmp = await c.dealer('award', { kind: 'custom', playerId: S[0].sid, note: 'Dočasné' });
      const tid = (await c.get()).awards.find((a) => a.note === 'Dočasné')?.id;
      ok(tmp.ok && tid && (await c.dealer('awardRemove', { id: tid })).ok && !(await c.get()).awards.some((a) => a.id === tid), 'awardRemove');
    }
    // track: rank among non-ghost students by portfolio
    const allMe = await Promise.all(S.map((s) => c.me(s)));
    const pfs = allMe.map((m) => m.me.portfolio);
    ok(allMe.every((m) => m.me.track.of === 18 && m.me.track.rank >= 1 + pfs.filter((v) => v > m.me.portfolio).length && m.me.track.rank <= pfs.filter((v) => v >= m.me.portfolio).length), 'track.rank = position by portfolio among 18');
    ok(allMe.every((m) => Math.abs(m.me.track.value - m.me.portfolio) <= 1 && Math.abs(m.me.track.returnPct - ((m.me.portfolio - 1e6) / 1e6) * 100) < 0.11), 'track.value = portfolio, returnPct from 1M');
    ok(st.leaders.every((l) => Math.abs(l.returnPct - ((l.value - 1e6) / 1e6) * 100) < 0.11), 'leaders carry returnPct');
    ok(allMe.every((m) => m.me.track.bestCall === null || (T.includes(m.me.track.bestCall.team) && m.me.track.bestCall.multiple > 0)), 'bestCall {team, multiple} or null');
    if (st.contrarian) shape('contrarian', st.contrarian, { name: 'string', team: 'string', multiple: 'number' }, { strict: true });
    await inv(`b${blk} points/awards`);

    // --- next block ---
    if (blk < 5) {
      const nb = await c.dealer('nextBlock');
      ok(nb.ok, 'nextBlock');
      const ar = await c.dget('?view=archives');
      ok((ar.archives || []).some((a) => a.label === `Před blokem ${blk + 1}` && a.auto === true), `auto archive "Před blokem ${blk + 1}"`);
      const ph = await Promise.all(S.slice(0, 6).map((s) => c.me(s)));
      const leak = ph.filter((m) => new RegExp(`Líbí b${blk}-|Pochybuji b${blk}-|Důvod A b${blk}-|Ven b${blk}-|Dovnitř b${blk}-`).test(JSON.stringify({ ...m, me: { ...m.me, myTeam: undefined } })));
      ok(leak.length === 0, `phones in block ${blk + 1} never see block-${blk} notes or reasons`);
      await inv(`b${blk + 1} start`);
    }
  }

  // ---------- rebalance rule over the whole game ----------
  section('exports and exit');
  const data = await c.dget('?view=data');
  checkClean('?view=data at the end', data);
  const studentIds = new Set(S.map((s) => s.sid));
  const reb = (data.allocations || []).filter((a) => a.block >= 2 && studentIds.has(a.playerId) && a.submitted);
  ok(reb.length === 18 * 4 && reb.every((a) => sumAmt(a.out) === 300000 && sumAmt(a.in) === 300000), `every student slip in blocks 2–5 moves exactly 300 000 out and in (${reb.length} slips)`);
  ok([1, 2, 3, 4, 5].every((b) => (data.allocations || []).some((a) => a.block === b && a.playerId === 'rj')), 'allocations include the RJ slip for every block');
  ok(Array.isArray(data.quizRuns) && data.quizRuns.length >= 10, `quizRuns: one per question run (${data.quizRuns?.length})`);
  ok(Array.isArray(data.points) && data.points.length > 0 && !data.points.some((e) => e.playerId === G.sid), 'data.points ledger without ghost entries');
  const gRow = (data.players || []).find((p) => p.id === G.sid);
  ok(!gRow || gRow.ghost === true, 'ghost row flagged in the data view');

  // ---------- exit ----------
  st = await c.get();
  const v = Object.fromEntries(st.teams.map((t) => [t.id, t.V]));
  ok(!(await c.dealer('exitSet', { outcomes: { [T[0]]: { kind: 'acquired', multiple: 25 } } })).ok, 'exit multiple above 20 refused');
  const outcomes = { [T[0]]: { kind: 'acquired', multiple: 3 }, [T[1]]: { kind: 'ipo', multiple: 5 }, [T[2]]: { kind: 'hold' }, [T[3]]: { kind: 'writeoff' }, [T[4]]: { kind: 'acquired', multiple: 0.5 }, [T[5]]: { kind: 'hold' } };
  const preExit = await Promise.all(S.map((s) => c.me(s)));
  const t3holders = S.filter((s, i) => preExit[i].me.stakes[T[3]] > 0);
  const ex = await c.dealer('exitSet', { outcomes });
  ok(ex.ok, 'exitSet ' + (ex.error || ''));
  st = await c.get();
  ok(st.phase === 'final', 'phase final after exit');
  ok(Math.abs(V(st, T[0]) - v[T[0]] * 3) <= 3 && Math.abs(V(st, T[1]) - v[T[1]] * 5) <= 5 && V(st, T[2]) === v[T[2]] && V(st, T[3]) === 0 && Math.abs(V(st, T[4]) - v[T[4]] * 0.5) <= 2, 'exit valuations: ×3, ×5, hold, write-off = 0, ×0.5');
  shape('exit', st.exit, { outcomes: 'object', teams: 'array', ranking: 'array', contrarian: 'object|null' }, { strict: true });
  shape('exit.teams[0]', st.exit?.teams?.[0], { team: 'string', kind: 'string', multiple: 'number|null', V: 'number' });
  shape('exit.ranking[0]', st.exit?.ranking?.[0], { name: 'string', team: 'string', value: 'number', returnPct: 'number' }, { strict: true });
  ok(st.exit?.ranking?.length === 10 && st.exit.ranking.every((r, i, a) => i === 0 || a[i - 1].value >= r.value), 'exit ranking: top 10, sorted');
  ok(st.reveal?.kind === 'exit' && st.history[st.history.length - 1].label === 'Exit', 'reveal exit + history "Exit"');
  ok(T.filter((t) => outcomes[t].kind !== 'hold').every((t) => st.drivers[t][0].kind === 'exit'), 'exit drivers');
  ok((await c.dget('?view=archives')).archives.some((a) => a.label === 'Před exitem'), 'auto archive "Před exitem"');
  const postExit = await Promise.all(t3holders.map((s) => c.me(s)));
  ok(t3holders.length > 0 && postExit.every((m) => m.me.stakes[T[3]] === 0 && Number.isFinite(m.me.portfolio) && Number.isFinite(m.me.track?.returnPct)), `written-off team: stake value 0 for its ${t3holders.length} investors, portfolios finite`);
  checkClean('every phone after exit', ...(await Promise.all([...S, G].map((s) => c.me(s)))));
  checkClean('dealer view after exit', await c.dget('?view=dealer'), await c.dget('?view=data'));
  await inv('after exit');
});
