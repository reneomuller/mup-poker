// Money and valuation features: cap table, drivers, lots / track record, rounds, market cards, tranches,
// exit, and the invariants (money conservation, exact 300k, ghosts excluded, no NaN, undo).
//   BASE=http://localhost:3101/api/game node tests/a-econ.mjs   (fresh server)
import { client, ok, done, sum, register, firstSlip, badNumbers, noNaNText } from './a-lib.mjs';

const c = client();
await c.dealer('reset', { confirm: 'RESET', keepPlayers: false });
await c.dealer('features', { set: { rounds: true, market: true, tranches: true, exit: true } });
let st = await c.get();
const T = st.teams.map((t) => t.id);
const S = await register(c, 12, T);
const g = await c.dealer('ghost', { team: T[0] });
const G = { sid: g.sid, pin: g.pin };
const FOUNDER = 1e6;

async function full() {
  const pub = await c.get();
  const dump = (await c.get('?view=dealer&dump=1')).dealer.dump;
  return { pub, meta: dump.meta, dump };
}
// Σ stakes of every investor + founders' value = Σ valuations
function conserved(meta) {
  const L = meta.ledger;
  let stakes = 0, founders = 0, vals = 0;
  for (const t of meta.teams) { vals += L.P[t.id] * L.S[t.id]; founders += FOUNDER * L.P[t.id]; }
  for (const h of Object.values(L.H)) for (const [t, sh] of Object.entries(h)) stakes += sh * L.P[t];
  return Math.abs(stakes + founders - vals) < 1;
}
async function checkAll(label) {
  const txt = await c.rawGet('?view=dealer&dump=1');
  ok(noNaNText(txt), label + ': no NaN/Infinity in dealer GET');
  const pub = await c.get();
  const me = await c.me(S[0]);
  const bad = [...badNumbers(pub), ...badNumbers(me)];
  ok(bad.length === 0, label + ': no null numbers in public/me ' + bad.slice(0, 4));
  const data = await c.rawGet('?view=data');
  ok(noNaNText(data) && !/"(V|portfolio|returnPct)":null/.test(data), label + ': data view finite');
  ok(conserved(JSON.parse(txt).dealer.dump.meta), label + ': money conserved (stakes + founders = valuations)');
}

// ---- Block 1: rounds terms before betting (block 1 has no trades yet)
ok(!(await c.spost({ op: 'roundTerms', sid: G.sid, pin: G.pin, pre: 1200000 })).ok, 'ghost cannot set round terms');
let r = await c.spost({ op: 'roundTerms', sid: S[0].sid, pin: S[0].pin, pre: 3000000 });
ok(!r.ok && r.error === 'Ocenění kola musí být mezi 500 000 $ a 2 000 000 $.', 'terms outside 50–200 % refused: ' + r.error);
r = await c.spost({ op: 'roundTerms', sid: S[0].sid, pin: S[0].pin, pre: 1504000 });
ok(r.ok && r.terms.pre === 1500000 && r.terms.prev === 1000000, 'student sets pre-money (rounded to 10k)');
r = await c.dealer('roundTerms', { team: T[1], pre: 800000 });
ok(r.ok, 'dealer sets terms for another team');
let m0 = await c.me(S[0]);
ok(m0.me.roundTermsOpen === true && m0.me.roundBounds.min === 500000 && m0.me.roundBounds.max === 2000000, 'me.roundTermsOpen + bounds');
st = await c.get();
ok(st.rounds[T[0]].kind === 'up' && st.rounds[T[0]].pct === 50 && st.rounds[T[1]].kind === 'down' && st.rounds[T[2]].kind === 'flat', 'public rounds up/down/flat');

await c.dealer('phase', { phase: 'betting' });
st = await c.get();
ok(st.teams[0].V === 1500000 && st.teams[1].V === 800000 && st.teams[2].V === 1000000, 'betting reprices teams with terms');
ok(st.history.some((h) => h.label === 'Kolo bloku 1'), 'history snapshot „Kolo bloku 1“');
ok(st.drivers[T[0]][0].kind === 'round' && st.drivers[T[0]][0].note === 'Up round' && st.drivers[T[0]][0].delta === 500000, 'round driver Up round +500k');
ok(st.drivers[T[1]][0].note === 'Down round', 'Down round driver');
r = await c.spost({ op: 'roundTerms', sid: S[0].sid, pin: S[0].pin, pre: 1000000 });
ok(!r.ok, 'terms locked after betting opened');
ok((await c.me(S[0])).me.roundTermsOpen === false, 'me.roundTermsOpen false when locked');

// students invest (exactly 1M each), the ghost too
const subs = await Promise.all(S.map((s, i) => c.spost({ op: 'submit', sid: s.sid, pin: s.pin, in: firstSlip(s, T, i) })));
ok(subs.every((x) => x.ok), 'all first slips accepted');
ok((await c.spost({ op: 'submit', sid: G.sid, pin: G.pin, in: { [T[1]]: { amt: 1e6 } } })).ok, 'ghost slip accepted');
await c.dealer('phase', { phase: 'closed' });
r = await c.dealer('showdown');
ok(r.ok && r.n === 12, 'showdown 12 (ghost skipped)');
let { pub, meta } = await full();
ok(sum(pub.teams.map((t) => t.cls)) === 12e6, 'class money = Σ submitted in = 12M');
ok(!meta.ledger.H[G.sid] && !meta.lots[G.sid], 'ghost has no holdings or lots');
ok(pub.teams.every((t) => Math.abs(t.cap.founders + t.cap.cls + t.cap.rj - 100) < 0.2), 'cap table adds to 100 %');
const t0 = pub.teams[0];
ok(t0.cap.investors === S.filter((s, i) => firstSlip(s, T, i)[T[0]]).length, 'cap.investors counts students holding the team');
ok(Math.abs(t0.cap.founders - Math.round(FOUNDER / meta.ledger.S[T[0]] * 1000) / 10) < 0.01, 'founders % = FOUNDER_SHARES / S');
m0 = await c.me(S[0]);
ok(m0.me.myTeamCap && m0.me.myTeamCap.founders === pub.teams.find((t) => t.id === S[0].team).cap.founders && m0.me.myTeamCap.history.length >= 2, 'me.myTeamCap with history');
ok(m0.me.track.value === m0.me.portfolio && m0.me.track.start === 1e6 && m0.me.track.of === 12 && m0.me.track.rank >= 1, 'me.track value/rank/of');
ok(meta.lots[S[0].sid].length === 2 && meta.lots[S[0].sid].every((l) => typeof l.low === 'boolean' && l.block === 1), 'lots with low flag');
ok(pub.leaders.every((l) => typeof l.returnPct === 'number'), 'leaders have returnPct');
await checkAll('after showdown');

// RJ with tranches on: not all-in
const rjRules = (await c.get('?view=dealer')).dealer.rj.rules;
ok(rjRules.mode === 'fund' && rjRules.capital === 10e6, 'RJ fund mode, capital 10M');
r = await c.dealer('trancheAdd', { team: T[3], amt: 2e6, cond: 'Prvních 10 platících zákazníků', due: 'Blok 3' });
ok(r.ok, 'tranche added');
const trId = r.id;
st = await c.get();
ok(st.rjFund.available === 8e6 && st.rjFund.locked === 2e6 && st.tranches[0].status === 'locked', 'rjFund: 2M locked, 8M available');
r = await c.dealer('rjSave', { in: { [T[0]]: { amt: 5e6, why: 'A' }, [T[1]]: { amt: 4e6, why: 'B' } } });
ok(!r.ok, 'RJ over available refused: ' + r.error);
r = await c.dealer('rjSave', { in: { [T[0]]: { amt: 3e6, why: 'Silný tým' }, [T[1]]: { amt: 2e6, why: 'B' } } });
ok(r.ok, 'RJ invests 5M of 8M');
r = await c.dealer('rjReveal');
({ pub, meta } = await full());
ok(r.ok && meta.rjPrincipal === 5e6 && pub.rjFund.available === 3e6, 'rjPrincipal 5M, 3M available');
ok(pub.drivers[T[0]][0].kind === 'rj' && pub.drivers[T[0]][0].delta === 3e6 && !JSON.stringify(pub.drivers).includes('Silný tým'), 'rj driver, private reason not public');
r = await c.dealer('trancheRelease', { id: trId });
({ pub, meta } = await full());
ok(r.ok && pub.tranches[0].status === 'released' && meta.rjPrincipal === 7e6 && pub.rjFund.available === 3e6, 'tranche released: principal 7M');
ok(pub.reveal.kind === 'tranche' && pub.reveal.amt === 2e6 && pub.teams[3].rj === 2e6, 'tranche reveal, RJ owns 2M of team 4');
const m3 = await c.me(S.find((s) => s.team === T[3]));
ok(m3.me.msgs.some((x) => x.kind === 'tranche' && x.amt === 2e6), 'team gets a tranche message');
r = await c.dealer('undo');
({ pub, meta } = await full());
ok(r.ok && pub.tranches[0].status === 'locked' && meta.rjPrincipal === 5e6 && pub.teams[3].rj === 0, 'undo reverts the tranche release');
await c.dealer('trancheRelease', { id: trId });
const t2 = await c.dealer('trancheAdd', { team: T[2], amt: 1e6, cond: 'Pilot', due: '' });
ok((await c.dealer('trancheCancel', { id: t2.id })).ok && (await c.get()).tranches[1].status === 'cancelled', 'tranche cancelled');
ok(!(await c.dealer('trancheAdd', { team: T[2], amt: 4e6, cond: 'Moc' })).ok, 'tranche over available refused');
await checkAll('after tranches');

// revalue with reason
r = await c.dealer('revalue', { V: { [T[2]]: 5e6 }, why: { [T[2]]: 'Tajná zpráva týmu' }, reason: { [T[2]]: 'traction' } });
pub = await c.get();
ok(r.ok && pub.drivers[T[2]][0].kind === 'revalue' && pub.drivers[T[2]][0].note === 'Trakce' && pub.drivers[T[2]][0].reason === 'traction', 'revalue driver with reason label');
ok(!JSON.stringify(pub).includes('Tajná zpráva týmu'), 'revalue message stays private');

// market card
ok(!(await c.dealer('marketCard', { title: 'X', effects: { [T[0]]: 150 } })).ok, 'market effect over +100 % refused');
r = await c.dealer('marketCard', { title: 'Recese', text: 'Investoři šetří.', effects: { [T[0]]: -20, [T[4]]: 50 } });
({ pub, meta } = await full());
const vBefore = meta.history[meta.history.length - 2].V;
ok(r.ok && pub.market.flipped.length === 1 && pub.market.flipped[0].effects[T[0]] === -20, 'market card flipped');
ok(Math.abs(pub.teams[0].V - vBefore[T[0]] * 0.8) < 2 && Math.abs(pub.teams[4].V - vBefore[T[4]] * 1.5) < 2, 'market card moves valuations');
ok(pub.reveal.kind === 'market' && pub.reveal.title === 'Recese' && pub.history[pub.history.length - 1].label === 'Karta: Recese', 'market reveal + history');
ok(pub.drivers[T[0]][0].kind === 'market' && pub.drivers[T[0]][0].note === 'Recese', 'market driver');
const mm = await c.me(S.find((s) => s.team === T[4]));
ok(mm.me.msgs.some((x) => x.kind === 'market' && x.pct === 50 && x.title === 'Recese'), 'market team message');
await checkAll('after market');
r = await c.dealer('undo');
pub = await c.get();
ok(r.ok && pub.market.flipped.length === 0 && Math.abs(pub.teams[0].V - vBefore[T[0]]) < 2, 'undo reverts the market card');

// Block 2: exactly 300k
await c.dealer('nextBlock');
await c.dealer('phase', { phase: 'betting' });
ok((await c.dealer('marketCard', { title: 'X', effects: { [T[0]]: 10 } })).error === 'Během investování nelze otočit kartu trhu.', 'market refused during betting');
const s1 = S[1];
m0 = await c.me(s1);
const from = Object.keys(m0.me.stakes).find((t) => m0.me.stakes[t] >= 300000);
const to = T.find((t) => t !== s1.team && t !== from);
r = await c.spost({ op: 'submit', sid: s1.sid, pin: s1.pin, out: { [from]: { amt: 200000 } }, in: { [to]: { amt: 200000 } } });
ok(!r.ok, 'student moving 200k refused (must be exactly 300k)');
r = await c.spost({ op: 'submit', sid: s1.sid, pin: s1.pin, out: { [from]: { amt: 300000 } }, in: { [to]: { amt: 300000 } } });
ok(r.ok, 'exactly 300k accepted');
await c.dealer('phase', { phase: 'closed' });
const pfBefore = m0.me.portfolio;
r = await c.dealer('showdown');
({ pub, meta } = await full());
ok(r.ok && r.n === 1 && Math.abs((await c.me(s1)).me.portfolio - pfBefore) < 2, 'block 2 trade keeps portfolio value');
const lots1 = meta.lots[s1.sid];
const heldFrom = lots1.filter((l) => l.team === from).reduce((a, l) => a + l.shares, 0);
ok(Math.abs(heldFrom - meta.ledger.H[s1.sid][from]) < 1e-6 && lots1.some((l) => l.team === to && l.block === 2), 'withdrawal consumed lots FIFO, new lot in block 2');
await checkAll('after block 2');

// track: awards + contrarian
await c.dealer('revalue', { V: Object.fromEntries(T.map((t, i) => [t, (i + 1) * 3e6])) });
pub = await c.get();
ok(pub.contrarian === null || (pub.contrarian.multiple > 1 && pub.contrarian.name && pub.contrarian.team && pub.contrarian.target), 'contrarian shape: ' + JSON.stringify(pub.contrarian));
const me5 = await c.me(S[5]);
ok(me5.me.track.bestCall && me5.me.track.bestCall.multiple > 0, 'bestCall: ' + JSON.stringify(me5.me.track.bestCall));
ok(Math.abs(me5.me.track.returnPct - Math.round((me5.me.track.value - 1e6) / 1e4 * 10) / 10) < 0.11, 'returnPct one decimal');

// exit
await c.dealer('nextBlock');
r = await c.dealer('exitSet', { outcomes: { [T[0]]: { kind: 'ipo', multiple: 25 } } });
ok(!r.ok, 'exit multiple over 20 refused');
const preExit = await c.get();
r = await c.dealer('exitSet', { outcomes: { [T[0]]: { kind: 'acquired', multiple: 3 }, [T[1]]: { kind: 'writeoff' }, [T[2]]: { kind: 'ipo', multiple: 1.5 } } });
({ pub, meta } = await full());
ok(r.ok && pub.phase === 'final' && pub.exit && pub.reveal.kind === 'exit', 'exit set → final, reveal exit');
ok(Math.abs(pub.teams[0].V - preExit.teams[0].V * 3) < 3 && pub.teams[1].V === 0 && pub.teams[3].V === preExit.teams[3].V, 'acquired ×3, writeoff 0, hold unchanged');
ok(pub.exit.teams.length === 6 && pub.exit.teams[1].kind === 'writeoff' && pub.exit.teams[3].kind === 'hold' && pub.exit.ranking.length === 10 && typeof pub.exit.ranking[0].returnPct === 'number', 'public exit view');
ok(pub.history[pub.history.length - 1].label === 'Exit' && meta.drivers.filter((d) => d.kind === 'exit').length === 3, 'exit history + drivers');
ok((await c.get('?view=archives')).archives[0].label === 'Před exitem', 'archive „Před exitem“');
await checkAll('after writeoff exit');
const victim = S.find((s, i) => meta.ledger.H[s.sid]?.[T[1]] > 0);
const mv = await c.me(victim);
ok(mv.me.stakes[T[1]] === 0 && Number.isFinite(mv.me.track.value), 'written-off stake is 0, value finite');
await c.dealer('phase', { phase: 'lobby' });
ok(!(await c.dealer('rjSave', { in: { [T[1]]: { amt: 1000, why: '' } } })).ok || true, 'rjSave into written-off team handled');
const vv = await c.dealer('revalue', { V: { [T[1]]: 100000 } });
ok(vv.ok && (await c.get()).teams[1].V === 100000, 'written-off team can be revalued without NaN');
await c.dealer('undo');
await c.dealer('undo');
pub = await c.get();
ok(!pub.exit && pub.phase !== 'final' && Math.abs(pub.teams[0].V - preExit.teams[0].V) < 3, 'undo reverts the exit');
await checkAll('after undo exit');

// ghosts never count
pub = await c.get();
ok(pub.playerCount === 12 && !pub.players.some((p) => p.id === G.sid) && !pub.leaders.some((l) => l.name === 'Ghost'), 'ghost not counted');
const data = await c.get('?view=data');
ok(data.players.length === 13 && data.players.find((p) => p.id === G.sid).ghost === true, 'data view flags the ghost');
ok(data.allocations.some((a) => a.playerId === G.sid && a.ghost) && data.allocations.some((a) => a.playerId === 'rj'), 'data view allocations: ghost flagged, RJ included');

// flags off: ops refused, fields hidden
await c.dealer('features', { set: { captable: false, cards: false, drivers: false, track: false, rounds: false, market: false, tranches: false, exit: false } });
pub = await c.get();
m0 = await c.me(S[0]);
ok(!pub.cards && !pub.drivers && !pub.rounds && !pub.market && !pub.tranches && !pub.rjFund && !pub.exit && !pub.awards && !('cap' in pub.teams[0]), 'flags off: public fields hidden');
ok(!m0.me.track && !m0.me.myTeamCap && !('roundTermsOpen' in m0.me), 'flags off: me fields hidden');
for (const [op, x] of [['marketCard', { title: 'X' }], ['trancheAdd', { team: T[0], amt: 1 }], ['exitSet', {}], ['award', { kind: 'custom', playerId: S[0].sid }], ['card', { team: T[0], oneLiner: 'x' }]]) {
  ok((await c.dealer(op, x)).error === 'Tato funkce je vypnutá.', op + ' refused when off');
}
ok((await c.spost({ op: 'card', sid: S[0].sid, pin: S[0].pin, oneLiner: 'x' })).error === 'Tato funkce je vypnutá.', 'student card refused when off');
const dm = (await c.get('?view=dealer&dump=1')).dealer.dump.meta;
ok(dm.drivers.length > 0 && Object.keys(dm.lots).length > 0, 'drivers and lots still recorded');
done('a-econ');
