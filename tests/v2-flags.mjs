// Feature flags (spec §1, §0): defaults, merge, every gated op refused with „Tato funkce je vypnutá.“ when off,
// public fields absent or harmless, recording (drivers, lots) regardless, and core play with everything off.
import { ok, warnIf, info, section, main, client, sum, sumAmt, checkClean, invariants, freshGame, initialSlip, rebalanceSlip, FEATURE_DEFAULTS, ALL_ON, OFF } from './_e-lib.mjs';

const c = client();
const ALL_OFF = Object.fromEntries(Object.keys(FEATURE_DEFAULTS).map((k) => [k, false]));

await main(async () => {
  const { T, S, G } = await freshGame(c, { n: 12, ghost: true });
  const ctx = { S, G };
  section('defaults + merge');
  let st = await c.get();
  ok(Object.entries(FEATURE_DEFAULTS).every(([k, v]) => st.features?.[k] === v), `defaults ${JSON.stringify(st.features)}`);
  ok((await c.dealer('features', { set: { market: true } })).ok, 'features op');
  st = await c.get();
  ok(st.features.market === true && Object.entries(FEATURE_DEFAULTS).filter(([k]) => k !== 'market').every(([k, v]) => st.features[k] === v), 'features merge (only market changed)');
  await c.dealer('features', { set: { market: false } });
  ok((await c.get()).features.market === false, 'switched back');
  await c.dealer('features', { set: { bogus: true } });
  ok(!('bogus' in (await c.get()).features), 'unknown flag ignored');
  await c.dealer('features', { set: { demand: false } }); // the rest checks v2 fixed-price money

  // block 1 played with everything ON so every op has something to act on
  await c.dealer('features', { set: ALL_ON });
  await c.dealer('quizSave', { set: { id: 'f', title: 'F', questions: [{ q: 'Otázka?', a: ['A', 'B'], correct: 0, time: 30 }] } });
  await c.dealer('phase', { phase: 'betting' });
  await Promise.all(S.map((s, i) => c.st(s, 'submit', initialSlip(T, s.team, i))));
  await c.dealer('phase', { phase: 'closed' });
  ok((await c.dealer('showdown')).ok, 'block 1 showdown (all on)');
  await c.dealer('rjSave', { in: { [T[0]]: { amt: 5e6, why: 'x' } } });
  await c.dealer('rjReveal');
  await c.dealer('trancheAdd', { team: T[1], amt: 1e6, cond: 'Podmínka', due: 'Blok 3' });
  const trId = (await c.get()).tranches?.[0]?.id;
  await c.dealer('award', { kind: 'custom', playerId: S[0].sid, note: 'Test' });
  const awId = (await c.get()).awards?.[0]?.id;
  await c.dealer('pointsAdd', { playerId: S[0].sid, amt: 10, note: 'x' });
  const ptId = (await c.meta()).points?.[0]?.id;

  section('each flag off: ops refused');
  const opsOf = {
    cards: [['student card', () => c.st(S[0], 'card', { oneLiner: 'x', sub: 'y' })], ['dealer card', () => c.dealer('card', { team: T[0], oneLiner: 'x' })],
      ['dealer milestones', () => c.dealer('card', { team: T[0], milestones: { m1a: true } })], ['milestoneDefs', () => c.dealer('milestoneDefs', { defs: [{ key: 'x', label: 'X', block: 1 }] })]],
    track: [['award', () => c.dealer('award', { kind: 'custom', playerId: S[1].sid, note: 'x' })], ['awardRemove', () => c.dealer('awardRemove', { id: awId })]],
    quiz: [['quizSave', () => c.dealer('quizSave', { set: { id: 'g', title: 'G', questions: [{ q: 'Q?', a: ['A', 'B'], correct: 0, time: 10 }] } })], ['quizDelete', () => c.dealer('quizDelete', { id: 'f' })],
      ['quizStart', () => c.dealer('quizStart', { setId: 'f' })], ['quizNext', () => c.dealer('quizNext')], ['quizReveal', () => c.dealer('quizReveal')], ['quizBoard', () => c.dealer('quizBoard')],
      ['quizEnd', () => c.dealer('quizEnd')], ['quizAnswer', () => c.st(S[2], 'quizAnswer', { choice: 0 })]],
    points: [['pointsAdd', () => c.dealer('pointsAdd', { playerId: S[1].sid, amt: 5, note: 'x' })], ['pointsAdd team', () => c.dealer('pointsAdd', { team: T[2], amt: 5, note: 'x' })], ['pointsRemove', () => c.dealer('pointsRemove', { id: ptId })]],
    rounds: [['student roundTerms', () => c.st(S[0], 'roundTerms', { pre: 1_100_000 })], ['dealer roundTerms', () => c.dealer('roundTerms', { team: T[0], pre: 1_100_000 })]],
    market: [['marketCard', () => c.dealer('marketCard', { title: 'Vypnuto', text: 'x', effects: { [T[0]]: 10 } })]],
    tranches: [['trancheAdd', () => c.dealer('trancheAdd', { team: T[2], amt: 1e5, cond: 'x', due: 'y' })], ['trancheRelease', () => c.dealer('trancheRelease', { id: trId })], ['trancheCancel', () => c.dealer('trancheCancel', { id: trId })]],
    exit: [['exitSet', () => c.dealer('exitSet', { outcomes: { [T[0]]: { kind: 'ipo', multiple: 2 } } })]],
  };
  for (const flag of Object.keys(FEATURE_DEFAULTS)) {
    await c.dealer('features', { set: { ...ALL_ON, [flag]: false } });
    const pre = await c.meta();
    const SOFT = ['quizSave', 'quizDelete', 'quizEnd', 'milestoneDefs']; // set-up ops: accepting them while off is harmless
    for (const [nm, fn] of (opsOf[flag] || []).filter(([n]) => !SOFT.includes(n))) {
      const r = await fn();
      ok(!r.ok && r.error === OFF, `${flag} off: ${nm} → „${r.error}“`);
    }
    const post = await c.meta();
    for (const [nm, fn] of (opsOf[flag] || []).filter(([n]) => SOFT.includes(n))) {
      const r = await fn();
      warnIf(!r.ok && r.error === OFF, `${flag} off: set-up op ${nm} accepted (spec §0: refused with „${OFF}“)`);
    }
    if (opsOf[flag]) {
      const keys = { cards: ['cards', 'milestoneDefs'], track: ['awards'], quiz: ['quizSets', 'quiz'], points: ['points'], rounds: ['rounds'], market: ['market'], tranches: ['tranches', 'rjPrincipal'], exit: ['exit', 'phase'] }[flag];
      ok(keys.every((k) => JSON.stringify(pre[k]) === JSON.stringify(post[k])), `${flag} off: refused ops changed nothing (${keys})`);
    }
    st = await c.get();
    const me = await c.me(S[0]);
    checkClean(`${flag} off: public + phone`, st, me);
    const present = {
      captable: st.teams.some((t) => t.cap) || !!me.me.myTeamCap, cards: !!st.cards && Object.keys(st.cards).length > 0, drivers: !!st.drivers && Object.values(st.drivers).some((a) => a.length),
      track: !!me.me.track || (st.awards || []).length > 0, quiz: st.quiz && st.quiz.state !== 'idle', points: !!st.points?.leaders?.length || !!me.me.points,
      rounds: !!st.rounds && Object.keys(st.rounds).length > 0, market: !!st.market?.flipped?.length, tranches: !!st.tranches?.length || !!st.rjFund, exit: !!st.exit,
    }[flag];
    info(`${flag} off: public fields ${present ? 'still present (allowed: "may be omitted")' : 'omitted'}`);
    ok(st.features[flag] === false, `${flag} off reported in publicState.features`);
  }

  section('recording regardless of flags');
  await c.dealer('features', { set: { ...ALL_ON, drivers: false, track: false } });
  const before = await c.meta();
  const rv = await c.dealer('revalue', { V: { [T[2]]: 2_500_000 }, reason: { [T[2]]: 'traction' } });
  ok(rv.ok, 'revalue with reason while drivers off');
  await c.dealer('nextBlock');
  await c.dealer('phase', { phase: 'betting' });
  const m3 = await c.me(S[3]);
  ok((await c.st(S[3], 'submit', rebalanceSlip(T, S[3].team, m3.me.stakes, 1))).ok, 'block 2 rebalance with track off');
  await c.dealer('phase', { phase: 'closed' });
  ok((await c.dealer('showdown')).ok, 'showdown with drivers/track off');
  const after = await c.meta();
  ok((after.drivers || []).length > (before.drivers || []).length && after.drivers.some((d) => d.kind === 'revalue' && d.team === T[2]), 'drivers recorded while the flag was off');
  ok((after.lots?.[S[3].sid] || []).some((l) => l.block === 2), 'lots recorded while track was off');
  await c.dealer('features', { set: { drivers: true, track: true } });
  st = await c.get();
  ok((st.drivers?.[T[2]] || []).some((d) => d.kind === 'revalue'), 'turning drivers on shows what was recorded');

  section('rounds off: no repricing');
  await c.dealer('nextBlock');
  await c.dealer('features', { set: { rounds: true } });
  st = await c.get();
  const v4 = st.teams.find((t) => t.id === T[4]).V;
  ok((await c.dealer('roundTerms', { team: T[4], pre: Math.round((v4 * 1.5) / 10000) * 10000 })).ok, 'terms set while rounds on');
  await c.dealer('features', { set: { rounds: false } });
  await c.dealer('phase', { phase: 'betting' });
  st = await c.get();
  warnIf(st.teams.find((t) => t.id === T[4]).V === v4, `rounds switched off before betting: no repricing (V ${v4} → ${st.teams.find((t) => t.id === T[4]).V})`);
  await c.dealer('phase', { phase: 'closed' });
  await c.dealer('showdown');

  section('core play with every flag off');
  await c.dealer('reset', { confirm: 'RESET', keepPlayers: true });
  await c.dealer('features', { set: ALL_OFF });
  st = await c.get();
  ok(Object.values(st.features).every((v) => v === false), 'all flags off');
  ok(st.playerCount === 12, 'players kept by reset');
  const nw = await c.post({ op: 'register', name: 'Nová Studentka', team: T[3], pin: '4444' });
  ok(nw.ok, 'register');
  const S2 = [...S, { sid: nw.sid, pin: '4444', team: T[3], name: 'Nová Studentka' }];
  ok((await c.post({ op: 'login', sid: nw.sid, pin: '4444' })).ok, 'login');
  await c.dealer('phase', { phase: 'betting' });
  const subs = await Promise.all(S2.map((s, i) => c.st(s, 'submit', initialSlip(T, s.team, i))));
  ok(subs.every((r) => r.ok), 'submit (all off)');
  ok((await c.st(S2[0], 'notes', { notes: { [T[1]]: { like: 'L', doubt: 'D' } } })).ok && (await c.st(S2[0], 'reasons', { in: {} })).ok, 'notes + reasons');
  const q = await c.st(S2[0], 'ask', { team: T[1], cat: 'market', text: 'Jak velký je trh?' });
  ok(q.ok && (await c.st(S2[2], 'vote', { qid: q.id })).ok, 'board ask + vote');
  await c.dealer('phase', { phase: 'closed' });
  const sd = await c.dealer('showdown');
  ok(sd.ok && sd.n === 13, 'showdown (all off)');
  st = await c.get();
  ok(sum(st.teams.map((t) => t.cls)) === 13e6, 'class money 13M');
  const dv = await c.dget('?view=dealer');
  ok(dv.dealer.rj.rules.mode === 'initial' && dv.dealer.rj.rules.capital === 10e6, 'tranches off: RJ must go all-in with 10M');
  ok(!(await c.dealer('rjSave', { in: { [T[0]]: { amt: 6e6 } } })).ok, 'tranches off: partial RJ refused');
  ok((await c.dealer('rjSave', { in: { [T[0]]: { amt: 4e6, why: 'a' }, [T[3]]: { amt: 6e6, why: 'b' } } })).ok && (await c.dealer('rjReveal')).ok, 'rjSave + rjReveal (all off)');
  ok((await c.dealer('revalue', { V: { [T[1]]: 3_000_000 }, why: { [T[1]]: 'Zpráva' } })).ok, 'revalue (all off)');
  ok((await c.dealer('pin', { team: T[1], q: 'Otázka', a: 'Odpověď' })).ok, 'pin');
  ok((await c.dealer('nextBlock')).ok, 'nextBlock (all off)');
  await c.dealer('phase', { phase: 'betting' });
  const mes = await Promise.all(S2.map((s) => c.me(s)));
  ok(mes.every((m) => m.me.rules.mode === 'rebalance' && m.me.rules.cashoutMax === 300000), 'rebalance rules (all off)');
  const r2 = await Promise.all(S2.map((s, i) => c.st(s, 'submit', rebalanceSlip(T, s.team, mes[i].me.stakes, i))));
  ok(r2.every((r) => r.ok), 'rebalance submits (all off)');
  await c.dealer('phase', { phase: 'closed' });
  ok((await c.dealer('showdown')).ok, 'block 2 showdown (all off)');
  ok((await c.dealer('undo')).ok && (await c.get()).phase === 'closed', 'undo (all off)');
  checkClean('all off: public', await c.get(), ...mes.slice(0, 3));
  await invariants(c, { S: S2, G }, 'all flags off');
  void sumAmt;
});
