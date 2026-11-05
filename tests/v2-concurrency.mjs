// Concurrency (spec §11: 18 students acting concurrently never lose a write). Five repetitions (one per block):
// students submit / edit cards / set round terms / answer the quiz / write notes all at once while the dealer
// runs market cards, revalues, milestones, timers and points. Meaningful in pg/redis mode (real I/O interleaving).
import { ok, warnIf, info, section, main, client, sum, sumAmt, invariants, freshGame, initialSlip, rebalanceSlip, ALL_ON, ledgerTotal } from './_e-lib.mjs';

const c = client();
const V = (st, t) => st.teams.find((x) => x.id === t).V;

await main(async () => {
  const { T, S, G } = await freshGame(c, { n: 18, ghost: true, features: { ...ALL_ON, demand: false }, parallel: true });
  ok(S.every((s) => s.ok), '18 parallel registrations');
  ok((await c.get()).playerCount === 18, 'playerCount 18 after parallel registration');
  const ctx = { S, G };
  const first = T.map((t) => S.find((s) => s.team === t));
  await c.dealer('quizSave', { set: { id: 'cc', title: 'Souběh', questions: [{ q: 'Souběžná otázka?', a: ['A', 'B', 'C', 'D'], correct: 1, time: 60 }] } });

  for (let rep = 1; rep <= 5; rep++) {
    section(`repetition ${rep} (block ${rep})`);
    let st = await c.get();
    // D: six teams set round terms at once + dealer milestone
    const pre = T.map((t, i) => Math.round((V(st, t) * (1 + 0.05 * (i - 2))) / 10000) * 10000);
    const msKey = ['m1a', 'm2a', 'm3a', 'm4a', 'm5a'][rep - 1];
    const dRes = await Promise.all([...first.map((s, i) => c.st(s, 'roundTerms', { pre: pre[i] })), c.dealer('card', { team: T[rep % 6], milestones: { [msKey]: true } })]);
    ok(dRes.every((r) => r.ok), '6 round terms + milestone at once: ' + (dRes.find((r) => !r.ok)?.error || 'ok'));
    st = await c.get();
    ok(T.every((t, i) => st.rounds?.[t]?.pre === pre[i]), `all 6 round terms kept (${T.filter((t, i) => st.rounds?.[t]?.pre !== pre[i]).length} lost)`);
    ok(st.cards?.[T[rep % 6]]?.milestones?.[msKey] === true, 'milestone kept');
    // B1: six card edits at once + market card
    const fl0 = st.market?.flipped?.length || 0;
    const vm = V(st, T[rep % 6]);
    const bRes = await Promise.all([...first.map((s, i) => c.st(s, 'card', { oneLiner: `R${rep} karta ${i}`, sub: `Popis ${rep}/${i}` })),
      c.dealer('marketCard', { title: `Souběh ${rep}`, text: 'Karta během úprav', effects: { [T[rep % 6]]: 10 } })]);
    ok(bRes.every((r) => r.ok), '6 card edits + market card at once: ' + (bRes.find((r) => !r.ok)?.error || 'ok'));
    st = await c.get();
    ok(T.every((t, i) => st.cards?.[t]?.oneLiner === `R${rep} karta ${i}`), `all 6 cards kept (${T.filter((t, i) => st.cards?.[t]?.oneLiner !== `R${rep} karta ${i}`).length} lost)`);
    ok((st.market?.flipped?.length || 0) === fl0 + 1 && Math.abs(V(st, T[rep % 6]) - vm * 1.1) <= 2, 'market card applied');
    ok(T.every((t, i) => st.rounds?.[t]?.pre === pre[i]), 'round terms survived the card burst');
    // A: betting — 18 submits + ghost + dealer meta writes at once
    await c.dealer('phase', { phase: 'pitch', team: T[0] });
    await c.dealer('phase', { phase: 'betting' });
    const mes = await Promise.all(S.map((s) => c.me(s)));
    const slips = S.map((s, i) => (mes[i].me.rules.mode === 'initial' ? initialSlip(T, s.team, i + rep, 1e6, `c${rep}-`) : rebalanceSlip(T, s.team, mes[i].me.stakes, i + rep, mes[i].me.rules.cashoutMax, `c${rep}-`)));
    const label = `Souběh ${rep}`;
    // one dealer (ops one after another) while all students submit at once
    const dealerChain = async () => [await c.dealer('timer', { minutes: rep, label }), await c.dealer('pointsAdd', { playerId: S[rep].sid, amt: 7, note: `souběh ${rep}` }), await c.dealer('card', { team: T[(rep + 1) % 6], oneLiner: `Dealer ${rep}` })];
    const aRes = await Promise.all([...S.map((s, i) => c.st(s, 'submit', slips[i])), c.st(G, 'submit', initialSlip(T, G.team, 0)), dealerChain()]).then((a) => [...a.slice(0, 19), ...a[19]]);
    ok(aRes.slice(0, 18).every((r) => r.ok), '18 submits at once: ' + (aRes.slice(0, 18).find((r) => !r.ok)?.error || 'ok'));
    ok(aRes.slice(19).every((r) => r.ok), 'dealer timer + pointsAdd + card during the submits');
    const dv = await c.dget('?view=dealer');
    const stored = S.filter((s, i) => { const sl = dv.dealer.rows.find((r) => r.id === s.sid)?.slip; return sl?.submitted && JSON.stringify(Object.keys(sl.in).sort()) === JSON.stringify(Object.keys(slips[i].in).sort()) && sumAmt(sl.in) === sumAmt(slips[i].in); });
    ok(stored.length === 18, `all 18 slips stored (${18 - stored.length} lost)`);
    st = await c.get();
    ok(st.timerLabel === label, 'timer write kept');
    ok((await c.meta()).points.some((e) => e.note === `souběh ${rep}`), 'pointsAdd kept');
    ok(st.cards[T[(rep + 1) % 6]].oneLiner === `Dealer ${rep}`, 'dealer card kept');
    ok(st.betCount === 18, `betCount 18 (${st.betCount})`);
    // two organisers on two admin pages press buttons in the same second
    const two = await Promise.all([c.dealer('timer', { minutes: rep + 1, label: `Dva ${rep}` }), c.dealer('pointsAdd', { playerId: S[0].sid, amt: 1, note: `dva ${rep}` }), c.dealer('card', { team: T[0], oneLiner: `Dva ${rep}` })]);
    const s2 = await c.get(), m2 = await c.meta();
    const kept2 = [s2.timerLabel === `Dva ${rep}`, m2.points.some((e) => e.note === `dva ${rep}`), s2.cards[T[0]].oneLiner === `Dva ${rep}`];
    warnIf(two.every((r) => r.ok) && kept2.every(Boolean), `two admins at once: 3 simultaneous dealer ops all kept (timer/points/card: ${kept2})`);
    await c.dealer('phase', { phase: 'closed' });
    const sd = await c.dealer('showdown');
    ok(sd.ok && sd.n === 18, `showdown n=18 (${sd.n})`);
    // C: quiz answers + card edits + dealer pointsAdd at once
    await c.dealer('quizStart', { setId: 'cc' });
    await c.dealer('quizNext');
    const before = await c.meta();
    const cRes = await Promise.all([...S.map((s, i) => c.st(s, 'quizAnswer', { choice: i % 4 })), ...first.map((s, i) => c.st(s, 'card', { oneLiner: `Q${rep} karta ${i}`, sub: 'kvíz' })),
      c.dealer('pointsAdd', { team: T[2], amt: 3, note: `kvíz souběh ${rep}` })]);
    ok(cRes.every((r) => r.ok), '18 answers + 6 cards + team points at once: ' + (cRes.find((r) => !r.ok)?.error || 'ok'));
    await c.dealer('quizReveal');
    st = await c.get();
    ok(sum(st.quiz?.counts || []) === 18, `all 18 answers counted (${st.quiz?.counts})`);
    ok(T.every((t, i) => st.cards[t].oneLiner === `Q${rep} karta ${i}`), 'all 6 cards kept during the quiz burst');
    const after = await c.meta();
    ok(S.filter((s) => s.team === T[2]).every((s) => ledgerTotal(after, s.sid) - ledgerTotal(before, s.sid) === 3 + (after.points.find((e) => e.kind === 'quiz' && e.playerId === s.sid && !before.points.some((b) => b.id === e.id))?.amt || 0)), 'team points + quiz points both kept');
    ok(after.points.filter((e) => e.kind === 'quiz' && !before.points.some((b) => b.id === e.id)).length === S.filter((s, i) => i % 4 === 1).length, 'one quiz entry per correct answer');
    await c.dealer('quizEnd');
    // B2: card edits + notes + revalue at once
    st = await c.get();
    const vr = V(st, T[3]);
    const eRes = await Promise.all([...first.map((s, i) => c.st(s, 'card', { oneLiner: `E${rep} karta ${i}`, sub: 'po' })), ...S.map((s, i) => c.st(s, 'notes', { notes: { [T[(T.indexOf(s.team) + 1) % 6]]: { like: `N${rep}-${i}`, doubt: '' } } })),
      c.dealer('revalue', { V: { [T[3]]: Math.round(vr * 1.2) }, reason: { [T[3]]: 'traction' } })]);
    ok(eRes.every((r) => r.ok), '6 cards + 18 notes + revalue at once: ' + (eRes.find((r) => !r.ok)?.error || 'ok'));
    st = await c.get();
    ok(T.every((t, i) => st.cards[t].oneLiner === `E${rep} karta ${i}`), 'all 6 cards kept during the revalue');
    ok(Math.abs(V(st, T[3]) - Math.round(vr * 1.2)) <= 1, 'revalue applied');
    const dv2 = await c.dget('?view=dealer');
    const notesKept = S.filter((s, i) => JSON.stringify(dv2.dealer.rows.find((r) => r.id === s.sid)?.slip?.notes || {}).includes(`N${rep}-${i}`)).length;
    ok(notesKept === 18, `all 18 notes kept (${18 - notesKept} lost)`);
    const dvs = S.filter((s) => dv2.dealer.rows.find((r) => r.id === s.sid)?.slip?.submitted).length;
    ok(dvs === 18, 'notes after the showdown did not undo any slip');
    await invariants(c, ctx, `rep ${rep}`);
    if (rep < 5) ok((await c.dealer('nextBlock')).ok, 'nextBlock');
  }
  info('done');
});
