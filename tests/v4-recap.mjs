// v4 recap: GET ?view=recap (a student's own end-of-game story) and ?view=report (dealer class report).
// A 3-block game with known slips: returns, best / worst call, contrarian moves, investor types, quiz stats,
// privacy (own recap only, report dealer-only), ghosts excluded, flag off, plain GET unchanged.
import { ok, section, main, client, checkClean, freshGame, sum, DH } from './_e-lib.mjs';

const c = client();
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const K = 1000;
const LONG = 'Tým má jasný problém, ověřené zákazníky a rozumný plán, jak se dostat k prvním tržbám.';

// in-slips per block, by student index: { teamIndex: amount (thousands) }
const B1 = [
  { 1: 1000 },                          // S0 (own T0): all-in → Odvážný sázkař
  { 3: 400, 0: 300, 2: 150, 4: 150 },  // S1 (own T1): 4 startups → Diverzifikátor
  { 1: 500, 3: 500 },                   // S2 (own T2): long reasons → Analytik
  { 1: 500, 5: 500 },                   // S3 (own T3)
  { 2: 500, 5: 300, 0: 200 },           // S4 (own T4): where the class did not go → Proti proudu
  { 0: 500, 1: 400, 3: 100 },           // S5 (own T5): T1 in every block → Věrný fanoušek
];
// block 1 class money: T0 1.0M, T1 2.4M, T2 0.65M, T3 1.0M, T4 0.15M, T5 0.8M (average 1.0M)
// later blocks: where each student puts the 300k; the 300k out comes from their other stakes
// (largest first, S5 smallest first so it keeps enough outside its favourite)
const LATER = {
  2: [{ 2: 300 }, { 4: 300 }, { 3: 300 }, { 0: 300 }, { 5: 300 }, { 1: 300 }],
  3: [{ 3: 300 }, { 3: 300 }, { 4: 300 }, { 4: 300 }, { 2: 150, 0: 150 }, { 1: 300 }],
};

await main(async () => {
  const { T, S, G } = await freshGame(c, { n: 6, ghost: true });
  const ctx = { S, G };
  const whyOf = (i) => (i === 2 ? LONG : i === 0 ? 'Všechno na jednu kartu.' : 'ok');
  const slipIn = (i, m) => Object.fromEntries(Object.entries(m).map(([ti, a]) => [T[ti], { amt: a * K, why: whyOf(i) }]));

  section('flag + privacy before anything settled');
  ok((await c.get()).features.recap === true, 'features.recap defaults to on');
  let r = await c.get('?view=recap');
  ok(r._status === 401 && !r.recap, 'recap without login → 401');
  r = await c.get('?view=recap', { 'x-sid': S[0].sid, 'x-pin': '0000' });
  ok(r._status === 401 && !r.recap, 'recap with a wrong PIN → 401');
  r = await c.get('?view=report', { 'x-sid': S[0].sid, 'x-pin': S[0].pin });
  ok(r._status === 401 && !r.students, 'a student cannot read the class report');
  r = await c.get('?view=report');
  ok(r._status === 401 && !r.students, 'report without the dealer header → 401');
  r = await c.get('?view=recap&as=' + S[1].sid, { 'x-sid': S[0].sid, 'x-pin': S[0].pin });
  ok(r.ok && r.recap.id === S[0].sid, 'as=<sid> without the dealer header is ignored: own recap only');
  const empty = r.recap;
  ok(empty.trades === 0 && empty.type.id === 'watcher' && empty.best === null && empty.value === 1_000_000, 'before any showdown: watcher, no calls, 1 000 000');

  section('block 1');
  await c.dealer('phase', { phase: 'betting' });
  for (const [i, s] of S.entries()) ok((await c.st(s, 'submit', { in: slipIn(i, B1[i]) })).ok, `B1 submit ${s.name}`);
  // the ghost invests everything in T3 – it must not count anywhere
  ok((await c.st(G, 'submit', { in: { [T[3]]: { amt: 1_000_000, why: 'ghost' } } })).ok, 'ghost submits');
  await c.dealer('phase', { phase: 'closed' });
  ok((await c.dealer('showdown')).ok, 'showdown 1');
  let meta = await c.meta();
  ok(meta.px?.[1] && T.every((t) => near(meta.px[1][t], 1, 1e-9)), 'meta.px[1] = the class trade prices of block 1 (1 $/share)');

  for (const blk of [2, 3]) {
    section(`block ${blk}`);
    ok((await c.dealer('nextBlock')).ok, `nextBlock → ${blk}`);
    await c.dealer('phase', { phase: 'betting' });
    for (const [i, s] of S.entries()) {
      const me = (await c.me(s)).me;
      const inn = slipIn(i, LATER[blk][i]);
      const held = Object.entries(me.stakes).filter(([t, v]) => !inn[t] && v > 1).sort((a, b) => (i === 5 ? a[1] - b[1] : b[1] - a[1]));
      const out = {};
      let left = 300_000;
      for (const [t, v] of held) { if (left <= 0) break; const take = Math.min(left, Math.floor(v)); out[t] = { amt: take, why: 'ven' }; left -= take; }
      const target = Object.keys(inn).join('+');
      const res = await c.st(s, 'submit', { out, in: inn });
      ok(res.ok && left === 0, `B${blk} submit ${s.name} → ${target}${res.ok ? '' : ': ' + res.error}`);
    }
    await c.dealer('phase', { phase: 'closed' });
    ok((await c.dealer('showdown')).ok, `showdown ${blk}`);
  }

  section('quiz + award');
  await c.dealer('quizStart', { setId: 'blok2' });
  const set = (await c.meta()).quizSets.find((s) => s.id === 'blok2');
  // S2 answers 3 questions right in a row (fast), S0 gets one right, everyone else wrong
  for (let q = 0; q < 3; q++) {
    await c.dealer('quizNext');
    const correct = set.questions[q].correct;
    await c.st(S[2], 'quizAnswer', { choice: correct });
    await c.st(S[0], 'quizAnswer', { choice: q === 1 ? correct : (correct + 1) % set.questions[q].a.length });
    await c.st(G, 'quizAnswer', { choice: correct });
    await c.dealer('quizReveal');
  }
  await c.dealer('quizEnd');
  ok((await c.dealer('award', { kind: 'analyst', playerId: S[2].sid, note: 'Nejlepší memo' })).ok, 'award for S2');

  section('exit → final');
  await c.dealer('features', { set: { exit: true } });
  const outcomes = { [T[0]]: { kind: 'acquired', multiple: 2 }, [T[1]]: { kind: 'hold' }, [T[2]]: { kind: 'ipo', multiple: 3 }, [T[3]]: { kind: 'writeoff' }, [T[4]]: { kind: 'hold' }, [T[5]]: { kind: 'acquired', multiple: 1.5 } };
  ok((await c.dealer('exitSet', { outcomes })).ok, 'exitSet');
  meta = await c.meta();
  ok(meta.phase === 'final', 'phase final');

  // ---------- independent expectations from meta (flows, px, ledger) ----------
  const P = meta.ledger.P;
  const blocks = [1, 2, 3];
  const classIn = {}, avgIn = {};
  for (const b of blocks) {
    classIn[b] = Object.fromEntries(T.map((t) => [t, 0]));
    for (const [sid, f] of Object.entries(meta.flows[b])) {
      if (sid === 'rj' || sid === G.sid) continue;
      for (const [t, e] of Object.entries(f.in || {})) classIn[b][t] += e.amt;
    }
    avgIn[b] = sum(Object.values(classIn[b])) / T.length;
  }
  ok(!Object.keys(meta.flows[1]).includes(G.sid), 'ghost slip never applied (not in flows)');
  const buysOf = (sid) => blocks.flatMap((b) => Object.entries(meta.flows[b][sid]?.in || {}).map(([t, e]) => ({ block: b, team: t, amt: e.amt, mult: P[t] / meta.px[b][t] })));
  const value = (sid) => sum(T.map((t) => (meta.ledger.H[sid]?.[t] || 0) * P[t]));
  const vals = S.map((s) => value(s.sid));

  section('recap: each student, own numbers');
  const R = [];
  for (const [i, s] of S.entries()) {
    const x = await c.get('?view=recap', { 'x-sid': s.sid, 'x-pin': s.pin });
    ok(x.ok && x.final === true && x.recap?.id === s.sid, `recap ${s.name}: ok, final, own id`);
    R.push(x.recap);
    checkClean('recap ' + s.name, x);
    const rc = x.recap;
    const v = vals[i];
    ok(near(rc.value, v, 1) && near(rc.returnPct, Math.round(((v - 1e6) / 1e6) * 1000) / 10, 0.11), `${s.name}: value ${rc.value} ≈ ${Math.round(v)}, return ${rc.returnPct} %`);
    const rank = 1 + vals.filter((y) => y > v + 0.5).length;
    ok(rc.rank === rank && rc.of === 6, `${s.name}: rank ${rc.rank} = ${rank} of 6 (ghost not counted)`);
    ok(rc.beatPct === Math.round((100 * vals.filter((y) => y < v - 0.5).length) / 5), `${s.name}: beatPct ${rc.beatPct}`);
    const buys = buysOf(s.sid).sort((a, b) => b.mult - a.mult || b.amt - a.amt || a.block - b.block);
    ok(rc.trades === buys.length && rc.invested === sum(buys.map((b) => b.amt)), `${s.name}: ${buys.length} investments, ${rc.invested} invested`);
    const best = buys[0], worst = buys[buys.length - 1];
    ok(rc.best && rc.best.team === best.team && rc.best.block === best.block && near(rc.best.multiple, best.mult, 0.006), `${s.name}: best call ${rc.best?.teamName} B${rc.best?.block} ×${rc.best?.multiple}`);
    ok(rc.worst && rc.worst.team === worst.team && rc.worst.block === worst.block && near(rc.worst.multiple, worst.mult, 0.006), `${s.name}: worst call ${rc.worst?.teamName} B${rc.worst?.block} ×${rc.worst?.multiple}`);
    ok(rc.best.why === (meta.flows[best.block][s.sid].in[best.team].why || ''), `${s.name}: best call carries its reason text`);
    const contra = buys.filter((b) => classIn[b.block][b.team] < avgIn[b.block] - 1e-6);
    ok(rc.contrarian.count === contra.length && rc.contrarian.amt === sum(contra.map((b) => b.amt)), `${s.name}: contrarian ${rc.contrarian.count} moves, ${rc.contrarian.amt}`);
    ok(rc.diversification.startups === new Set(buys.map((b) => b.team)).size, `${s.name}: ${rc.diversification.startups} startups`);
    const big = Math.max(...buys.map((b) => b.amt));
    ok(rc.biggest.amt === big, `${s.name}: biggest bet ${rc.biggest.amt}`);
    const per = {};
    for (const b of buys) per[b.team] = (per[b.team] || 0) + b.amt;
    ok(rc.favourite.amt === Math.max(...Object.values(per)) && per[rc.favourite.team] === rc.favourite.amt, `${s.name}: favourite ${rc.favourite.teamName} (${rc.favourite.amt})`);
    ok(typeof rc.type?.label === 'string' && rc.type.label && typeof rc.type.line === 'string', `${s.name}: type „${rc.type?.label}“`);
    ok(!JSON.stringify(x).includes(G.sid), `${s.name}: the ghost appears nowhere in the recap`);
  }

  section('investor types');
  ok(R[0].type.id === 'bold' && R[0].type.label === 'Odvážný sázkař' && R[0].biggest.share === 1, 'S0 all-in → „Odvážný sázkař“');
  ok(R[1].type.id === 'diversifier' && R[1].diversification.startups >= 4, `S1 → „Diverzifikátor“ (${R[1].type.label})`);
  ok(R[2].type.id === 'analyst' && R[2].reasonAvg >= 60, `S2 long reasons → „Analytik“ (${R[2].type.label})`);
  ok(R[4].type.id === 'contrarian' && R[4].contrarian.share >= 0.5, `S4 → „Proti proudu“ (${R[4].type.label}, ${R[4].contrarian.share})`);
  ok(R[5].type.id === 'loyal' && R[5].loyal && R[5].favourite.team === T[1] && R[5].favourite.blocks === 3, `S5 → „Věrný fanoušek“ (${R[5].type.label})`);

  section('quiz, awards, badges');
  ok(R[2].quiz.correct === 3 && R[2].quiz.bestStreak === 3 && R[2].quiz.asked === 3, `S2: 3 correct, best streak 3 (${R[2].quiz.bestStreak})`);
  const qpts = (sid) => sum(meta.points.filter((e) => e.kind === 'quiz' && e.playerId === sid).map((e) => e.amt));
  ok(R[2].quiz.points === qpts(S[2].sid) && R[2].quiz.points > 0, `S2 quiz points ${R[2].quiz.points}`);
  ok(R[0].quiz.correct === 1 && R[0].quiz.bestStreak === 1, 'S0: 1 correct, streak 1');
  ok(R[1].quiz.points === 0 && R[1].quiz.fastest === null && R[1].quiz.bestStreak === 0, 'S1: no quiz points, no fastest answer');
  const qa = await c.dget('?view=data');
  const myMs = qa.quizRuns.flatMap((q) => (q.answers[S[2].sid] ? [{ ...q.answers[S[2].sid], idx: q.idx }] : []));
  const fastest = Math.min(...myMs.map((a) => a.ms));
  const fm = R[2].quiz.fastest;
  // the fastest is picked by score (1 point ≈ 2 × time ms), then its exact ms is read from the answer
  ok(fm && myMs.some((a) => a.ms === fm.ms) && fm.ms - fastest <= 2 * fm.time && fm.q, `S2 fastest correct answer ${fm?.ms} ms (exact, from the answer; min ${fastest})`);
  ok(R[2].quizRank === 1 && R[0].quizRank === 2, 'quiz ranks (ghost excluded)');
  ok(R[2].awards.length === 1 && R[2].awards[0].kind === 'analyst' && R[2].awards[0].note === 'Nejlepší memo', 'S2 award in the recap');
  ok(R[2].badges.some((b) => b.id === 'streak') && R[2].badges.some((b) => b.id === 'quiztop'), 'S2 badges: streak, quiz top');
  ok(R[0].badges.some((b) => b.id === 'allin'), 'S0 badge: all-in');
  ok(R.every((x) => Array.isArray(x.series) && x.series[0][1] === 1_000_000 && x.series.length >= 4), 'portfolio series from 1 000 000');

  section('ghost recap');
  const g = await c.get('?view=recap', { 'x-sid': G.sid, 'x-pin': G.pin });
  ok(g.ok && g.recap.ghost === true && g.recap.rank === null && g.recap.trades === 0, 'ghost: own (empty) recap, never ranked');

  section('dealer preview (as=<sid>)');
  const a = await c.get('?view=recap&as=' + S[3].sid, DH);
  ok(a.ok && a.recap.id === S[3].sid && a.recap.value === R[3].value, 'dealer as=<sid> sees exactly that student’s recap');
  const noAs = await c.get('?view=recap', DH);
  ok(noAs._status === 401 && !noAs.recap, 'dealer without as= gets no recap');

  section('report (dealer)');
  const rep = await c.dget('?view=report');
  ok(rep.ok && rep.final && rep.students.length === 6 && rep.teams.length === 6, 'report: 6 students, 6 startups');
  checkClean('report', rep);
  ok(!JSON.stringify(rep).includes(G.sid) && !rep.students.some((x) => x.name === 'Ghost'), 'report: ghost excluded');
  ok(rep.students.every((x, i) => i === 0 || rep.students[i - 1].rank <= x.rank), 'students sorted by rank');
  ok(rep.students.every((x) => { const q = R.find((y) => y.id === x.id); return q && q.value === x.value && q.returnPct === x.returnPct && q.type.id === x.type.id; }), 'report rows = the recaps');
  const avgRet = sum(R.map((x) => x.returnPct)) / 6;
  ok(near(rep.class.avgReturn, avgRet, 0.06) && rep.class.n === 6, `class average return ${rep.class.avgReturn} %`);
  ok(rep.top.length === 5 && rep.top[0].value === Math.max(...R.map((x) => x.value)), 'top 5 by portfolio');
  ok(rep.quizTop.length === 2 && rep.quizTop[0].name === S[2].name, 'quiz top (ghost excluded)');
  const t1 = rep.teams.find((t) => t.id === T[1]);
  ok(t1.path[0].label === 'Start' && ['Blok 1', 'Blok 2', 'Blok 3'].every((l) => t1.path.some((p) => p.label === l)) && t1.path[t1.path.length - 1].label === 'Exit', 'valuation path: Start, Blok 1–3, Exit');
  ok(t1.path.find((p) => p.label === 'Exit').V === t1.V, 'path ends at the current valuation');
  ok(rep.teams.every((t) => t.demand.length === 3 && t.demand.every((d) => near(d.mult, meta.demand[d.block].mult[t.id], 0.006) && d.in === classIn[d.block][t.id])), 'demand multiples and class money per block');
  ok(t1.investors === S.filter((s) => buysOf(s.sid).some((b) => b.team === T[1])).length, `T1 investors ${t1.investors}`);
  ok(rep.teams.find((t) => t.id === T[3]).exit.kind === 'writeoff', 'exit outcome per startup');

  section('cost + flag off');
  const pub = await c.get('', { 'x-sid': S[0].sid, 'x-pin': S[0].pin });
  ok(!('recap' in pub) && !('recap' in pub.me), 'plain GET carries no recap payload');
  await c.dealer('features', { set: { recap: false } });
  const off1 = await c.get('?view=recap', { 'x-sid': S[0].sid, 'x-pin': S[0].pin });
  const off2 = await c.dget('?view=report');
  ok(off1._status === 400 && off1.error === 'Tato funkce je vypnutá.' && off2._status === 400 && !off2.students, 'flag off: recap and report refused');
  await c.dealer('features', { set: { recap: true } });
  ok((await c.get('?view=recap', { 'x-sid': S[0].sid, 'x-pin': S[0].pin })).ok, 'flag back on');
  void ctx;
});
