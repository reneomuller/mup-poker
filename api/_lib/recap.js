// v4 recap (flag `recap`, default on): a student's personal „Můj rok v MUP pokeru“ story (GET ?view=recap)
// and the organisers' class report (GET ?view=report). Everything is computed from meta (ledger, lots,
// flows, history, demand, points, quiz log) – pure functions, so a plain GET never pays for it.
// The only storage read: the student's own answer to their fastest correct quiz question (one HGET).
import * as G from './game.js';
import * as F from './features.js';
import * as Q from './quiz.js';
import * as S from './store.js';
import * as AC from './access.js';

export const FLAG = 'recap';
const r0 = F.r0, r1 = F.r1, r2 = F.r2;
const CAP = G.CFG.STUDENT_CAPITAL;

export const TYPES = {
  watcher: { label: 'Pozorovatel', line: 'Tentokrát bez investic. Příště do toho skoč!' },
  bold: { label: 'Odvážný sázkař', line: 'Jedna velká sázka místo opatrného rozkládání.' },
  contrarian: { label: 'Proti proudu', line: 'Většina tvých peněz šla tam, kam třída nešla.' },
  loyal: { label: 'Věrný fanoušek', line: 'Jeden startup měl tvoji podporu v každém bloku.' },
  diversifier: { label: 'Diverzifikátor', line: 'Riziko rozložené do mnoha startupů.' },
  analyst: { label: 'Analytik', line: 'Ke každé investici máš pořádné zdůvodnění.' },
  balanced: { label: 'Vyvážený stratég', line: 'Rozumný mix odvahy a opatrnosti.' },
};
export const AWARD_LABELS = { sharpest: 'Nejostřejší oko', analyst: 'Nejlepší analýza', contrarian: 'Proti proudu', custom: 'Ocenění' };

const live = (players, sid) => sid !== G.RJ && players[sid] && !players[sid].ghost;
const tname = (m, t) => m.teams.find((x) => x.id === t)?.name || t;

// Class trade price of team t in block b: recorded at the showdown (meta.px, v4), else any class lot of that block.
function priceBook(m, players) {
  const lot = {};
  for (const [sid, lots] of Object.entries(m.lots || {})) {
    if (!live(players, sid)) continue;
    for (const l of lots || []) if (l.price > 0 && !lot[l.block + ':' + l.team]) lot[l.block + ':' + l.team] = l.price;
  }
  return (b, t) => (m.px?.[b]?.[t] > 0 ? m.px[b][t] : lot[b + ':' + t] || null);
}

// Every settled class trade per student (from meta.flows; `extra` = slips of settled blocks that predate flows).
function tradesOf(m, players, extra = {}) {
  const by = {}, classIn = {};
  const blocks = [];
  for (let b = 1; b <= m.block; b++) if (m.settled?.[b + 'c']) blocks.push(b);
  for (const b of blocks) {
    const fl = m.flows?.[b] || extra[b] || {};
    classIn[b] = Object.fromEntries(m.teams.map((t) => [t.id, 0]));
    for (const [sid, f] of Object.entries(fl)) {
      if (!live(players, sid)) continue;
      if (extra[b] && !m.flows?.[b] && !f?.submitted) continue;
      const me = by[sid] || (by[sid] = { buys: [], sells: [] });
      for (const [t, e] of Object.entries(f?.in || {})) {
        const amt = Math.round(Number(e?.amt) || 0);
        if (amt <= 0 || !(t in classIn[b])) continue;
        me.buys.push({ block: b, team: t, amt, why: String(e.why || '') });
        classIn[b][t] += amt;
      }
      for (const [t, e] of Object.entries(f?.out || {})) {
        const amt = Math.round(Number(e?.amt) || 0);
        if (amt > 0) me.sells.push({ block: b, team: t, amt, why: String(e.why || '') });
      }
    }
  }
  const avgIn = {};
  for (const b of blocks) avgIn[b] = m.teams.length ? Object.values(classIn[b]).reduce((a, x) => a + x, 0) / m.teams.length : 0;
  return { by, classIn, avgIn, blocks };
}

// Quiz stats of one student from the points ledger (kind quiz entries carry run, qi, base, bonus).
function quizOf(m, sid) {
  const mine = m.points.filter((e) => e.kind === 'quiz' && e.playerId === sid);
  const points = mine.reduce((a, e) => a + (Number(e.amt) || 0), 0);
  const runs = {};
  for (const e of mine) if (e.run) (runs[e.run] = runs[e.run] || []).push(e);
  let bestStreak = mine.length ? 1 : 0;
  for (const list of Object.values(runs)) {
    const qi = [...new Set(list.map((e) => Number(e.qi)).filter(Number.isFinite))].sort((a, b) => a - b);
    let s = 0, prev = null;
    for (const i of qi) { s = prev !== null && i === prev + 1 ? s + 1 : 1; prev = i; bestStreak = Math.max(bestStreak, s); }
  }
  const setOfRun = {};
  for (const e of m.quizLog || []) setOfRun[e.runId] = e.setId;
  const asked = (m.quizLog || []).length;
  let fastest = null;
  for (const e of mine) {
    const base = Number(e.base);
    if (!Number.isFinite(base)) continue;
    if (!fastest || base > fastest.base) fastest = { base, run: e.run, qi: Number(e.qi) };
  }
  if (fastest) {
    const q = m.quizSets.find((s) => s.id === setOfRun[fastest.run])?.questions?.[fastest.qi];
    const time = q?.time || 20;
    // score = 1000 × (1 − 0.5 × ms / (time × 1000)), so ms ≈ (1 − base/1000) × 2 × time × 1000 (± a few ms)
    fastest = { run: fastest.run, qi: fastest.qi, q: q?.q || '', time, ms: Math.max(0, Math.round((1 - fastest.base / 1000) * 2 * time * 1000)) };
  }
  return { points, correct: mine.length, asked, accuracy: asked ? r2(Math.min(1, mine.length / asked)) : null, bestStreak, fastest };
}

// The per-student numbers (no rank fields: those need the whole class).
function statsOf(m, p, px, tr) {
  const sid = p.id;
  const value = r0(F.studentValue(m, sid));
  const mine = tr.by[sid] || { buys: [], sells: [] };
  const buys = mine.buys.map((x) => {
    const price = px(x.block, x.team), now = m.ledger.P[x.team] || 0;
    const multiple = price > 0 ? now / price : null;
    return { ...x, multiple: multiple === null ? null : r2(multiple), returnPct: multiple === null ? null : r1((multiple - 1) * 100), gain: multiple === null ? null : r0(x.amt * (multiple - 1)) };
  });
  const priced = buys.filter((x) => x.multiple !== null);
  const pub = (x) => (x ? { block: x.block, team: x.team, teamName: tname(m, x.team), amt: x.amt, multiple: x.multiple, returnPct: x.returnPct, gain: x.gain, why: x.why } : null);
  const byMult = priced.slice().sort((a, b) => b.multiple - a.multiple || b.amt - a.amt || a.block - b.block);
  const best = byMult[0] || null;
  const worstC = byMult.length >= 2 ? byMult[byMult.length - 1] : null;
  const worst = worstC && worstC.multiple < best.multiple ? worstC : null;
  const total = buys.reduce((a, x) => a + x.amt, 0);
  // contrarian: money put where the class put less than the average team got in that block
  const contra = buys.filter((x) => tr.classIn[x.block]?.[x.team] < tr.avgIn[x.block] - 1e-6);
  const contraAmt = contra.reduce((a, x) => a + x.amt, 0);
  const contraBest = contra.filter((x) => x.multiple !== null).sort((a, b) => b.multiple - a.multiple)[0] || null;
  const perTeam = {};
  for (const x of buys) {
    const o = perTeam[x.team] || (perTeam[x.team] = { amt: 0, blocks: new Set() });
    o.amt += x.amt; o.blocks.add(x.block);
  }
  const favT = Object.entries(perTeam).sort((a, b) => b[1].amt - a[1].amt || a[0].localeCompare(b[0]))[0];
  const stakes = G.stakes(m, sid);
  const buyBlocks = new Set(buys.map((x) => x.block));
  const favourite = favT ? { team: favT[0], teamName: tname(m, favT[0]), amt: favT[1].amt, blocks: favT[1].blocks.size, stakeNow: r0(stakes[favT[0]] || 0), share: total ? r2(favT[1].amt / total) : 0 } : null;
  const loyal = !!(favourite && buyBlocks.size >= 2 && favT[1].blocks.size === buyBlocks.size);
  const big = buys.slice().sort((a, b) => b.amt - a.amt || a.block - b.block)[0] || null;
  const biggest = big ? { ...pub(big), share: r2(big.amt / CAP) } : null;
  const whys = buys.map((x) => x.why.trim().length);
  const reasonAvg = whys.length ? r0(whys.reduce((a, x) => a + x, 0) / whys.length) : 0;
  const quiz = quizOf(m, sid);
  const st = {
    id: sid, name: p.name, team: p.team, teamName: tname(m, p.team), ghost: !!p.ghost,
    start: CAP, value, returnPct: F.returnPct(value), gain: value - CAP,
    invested: total, trades: buys.length, sells: mine.sells.length, blocks: [...buyBlocks].sort((a, b) => a - b),
    best: pub(best), worst: pub(worst),
    contrarian: { count: contra.length, amt: contraAmt, share: total ? r2(contraAmt / total) : 0, hits: contra.filter((x) => x.multiple > 1).length, best: pub(contraBest) },
    diversification: { startups: Object.keys(perTeam).length, held: Object.values(stakes).filter((v) => v > 0.5).length, of: Math.max(0, m.teams.length - 1) },
    biggest, favourite, loyal, reasonAvg, quiz,
    awards: m.awards.filter((a) => a.playerId === sid).map((a) => ({ id: a.id, kind: a.kind, label: AWARD_LABELS[a.kind] || 'Ocenění', note: a.note || '', block: a.block })),
    investments: buys.map(pub),
  };
  st.type = typeOf(st);
  return st;
}

// One investor type, first rule that matches.
export function typeOf(st) {
  let id = 'balanced';
  if (!st.trades) id = 'watcher';
  else if (st.biggest && st.biggest.share >= 0.6) id = 'bold';
  else if (st.contrarian.share >= 0.5) id = 'contrarian';
  else if (st.loyal && st.favourite.share >= 0.4) id = 'loyal';
  else if (st.diversification.startups >= 4) id = 'diversifier';
  else if (st.reasonAvg >= 60 || (st.quiz.accuracy !== null && st.quiz.accuracy >= 0.75 && st.quiz.correct >= 4)) id = 'analyst';
  return { id, ...TYPES[id] };
}

function badgesOf(st) {
  const b = [];
  if (st.rank && st.rank <= 3) b.push({ id: 'podium', label: `${st.rank}. místo ve třídě` });
  if (st.returnPct > 0) b.push({ id: 'green', label: 'V plusu' });
  if (st.best && st.best.multiple >= 2) b.push({ id: 'double', label: `Trefa ×${String(st.best.multiple).replace('.', ',')}` });
  if (st.contrarian.hits > 0) b.push({ id: 'contra', label: 'Proti proudu a v plusu' });
  if (st.diversification.startups >= 4) b.push({ id: 'diverse', label: 'Široké portfolio' });
  if (st.biggest && st.biggest.share >= 0.5) b.push({ id: 'allin', label: 'All-in' });
  if (st.quiz.bestStreak >= 3) b.push({ id: 'streak', label: `Kvízová série ${st.quiz.bestStreak}` });
  if (st.quiz.fastest && st.quiz.fastest.ms < 3000) b.push({ id: 'quick', label: 'Bleskovka' });
  if (st.quizRank && st.quizRank <= 3 && st.quiz.points > 0) b.push({ id: 'quiztop', label: `${st.quizRank}. v kvízu` });
  if (st.reasonAvg >= 60) b.push({ id: 'writer', label: 'Pečlivé zdůvodnění' });
  return b;
}

// Slips of settled blocks that have no meta.flows (games settled before v3): read only then, only here.
async function legacySlips(m) {
  const need = [];
  for (let b = 1; b <= m.block; b++) if (m.settled?.[b + 'c'] && !m.flows?.[b]) need.push(b);
  if (!need.length) return {};
  const maps = await Promise.all(need.map((b) => S.hgetall('slip:' + b)));
  return Object.fromEntries(need.map((b, i) => [b, maps[i] || {}]));
}

// The whole class: per-student stats with ranks (ghosts excluded).
export function classStats(m, players, extra = {}) {
  const px = priceBook(m, players);
  const tr = tradesOf(m, players, extra);
  const list = Object.values(players).filter((p) => p && !p.ghost).map((p) => statsOf(m, p, px, tr));
  const n = list.length;
  const pts = F.pointTotals(m, players);
  for (const st of list) {
    st.rank = 1 + list.filter((x) => x.value > st.value).length;
    st.of = n;
    st.beatPct = n > 1 ? r0((100 * list.filter((x) => x.value < st.value).length) / (n - 1)) : 100;
    st.topPct = n ? Math.max(1, Math.ceil((100 * st.rank) / n)) : 100;
    st.quizRank = st.quiz.points > 0 ? 1 + list.filter((x) => x.quiz.points > st.quiz.points).length : null;
    st.points = pts[st.id] || 0;
    st.badges = badgesOf(st);
  }
  return { list, tr, px };
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

function classSummary(list) {
  const rets = list.map((x) => x.returnPct);
  const types = {};
  for (const x of list) types[x.type.id] = (types[x.type.id] || 0) + 1;
  const top = list.slice().sort((a, b) => b.value - a.value)[0];
  return {
    n: list.length, avgValue: r0(avg(list.map((x) => x.value))), avgReturn: r1(avg(rets)), medianReturn: r1(median(rets)),
    positive: list.filter((x) => x.returnPct > 0).length, invested: list.reduce((a, x) => a + x.invested, 0),
    avgStartups: r1(avg(list.map((x) => x.diversification.startups))), avgBiggest: r0(avg(list.filter((x) => x.biggest).map((x) => x.biggest.amt))),
    avgQuiz: r0(avg(list.map((x) => x.quiz.points))), avgContrarian: r2(avg(list.map((x) => x.contrarian.share))),
    best: top ? { name: top.name, team: top.team, returnPct: top.returnPct } : null, types,
  };
}

// Valuation path of a team: Start, the end of every block, Exit.
function pathOf(m, t) {
  const out = [], byBlock = {};
  let start = null, exit = null;
  for (const h of m.history || []) {
    const V = h.V?.[t];
    if (V === undefined) continue;
    if (h.label === 'Start') { if (!start) start = { label: 'Start', block: 0, V }; }
    else if (h.label === 'Exit') exit = { label: 'Exit', block: h.block, V };
    else byBlock[h.block] = { label: `Blok ${h.block}`, block: h.block, V };
  }
  if (start) out.push(start);
  for (const b of Object.keys(byBlock).map(Number).sort((a, b2) => a - b2)) out.push(byBlock[b]);
  if (exit) out.push(exit);
  return out;
}

// GET ?view=report (dealer).
export function report(m, players, extra = {}) {
  const { list, tr } = classStats(m, players, extra);
  const teams = m.teams.map((t) => {
    const inv = new Set(), raised = { in: 0, out: 0 };
    for (const [sid, x] of Object.entries(tr.by)) {
      if (x.buys.some((y) => y.team === t.id)) inv.add(sid);
      raised.in += x.buys.filter((y) => y.team === t.id).reduce((a, y) => a + y.amt, 0);
      raised.out += x.sells.filter((y) => y.team === t.id).reduce((a, y) => a + y.amt, 0);
    }
    let now = 0;
    for (const [k, h] of Object.entries(m.ledger.H)) if (live(players, k) && (h?.[t.id] || 0) > 1e-9) now++;
    const o = m.exit?.outcomes?.[t.id];
    return {
      id: t.id, name: t.name, color: t.color, V: r0(G.valuation(m, t.id)), founderPct: G.founderPct(m, t.id), path: pathOf(m, t.id),
      demand: tr.blocks.map((b) => ({ block: b, mult: m.demand?.[b]?.mult?.[t.id] !== undefined ? r2(m.demand[b].mult[t.id]) : null, in: tr.classIn[b][t.id] || 0 })),
      investors: inv.size, investorsNow: now, classIn: raised.in, classOut: raised.out,
      members: Object.values(players).filter((p) => p && !p.ghost && p.team === t.id).length,
      exit: o ? { kind: o.kind, multiple: o.multiple } : null,
    };
  });
  const row = (x) => ({
    id: x.id, name: x.name, team: x.team, teamName: x.teamName, value: x.value, returnPct: x.returnPct, rank: x.rank,
    startups: x.diversification.startups, invested: x.invested, biggest: x.biggest, favourite: x.favourite, best: x.best, worst: x.worst,
    contrarian: x.contrarian, quizPoints: x.quiz.points, quizCorrect: x.quiz.correct, bestStreak: x.quiz.bestStreak, quizRank: x.quizRank,
    points: x.points, type: x.type, awards: x.awards, badges: x.badges,
  });
  const students = list.slice().sort((a, b) => a.rank - b.rank || String(a.name).localeCompare(String(b.name), 'cs')).map(row);
  return {
    ok: true, generated: Date.now(), block: m.block, maxBlock: G.CFG.MAX_BLOCK, phase: m.phase, final: m.phase === 'final' || !!m.exit,
    blocks: tr.blocks, class: classSummary(list), teams, students,
    top: students.slice(0, 5).map((x) => ({ name: x.name, team: x.team, value: x.value, returnPct: x.returnPct })),
    quizTop: students.filter((x) => x.quizPoints > 0).sort((a, b) => b.quizPoints - a.quizPoints || String(a.name).localeCompare(String(b.name), 'cs')).slice(0, 5)
      .map((x) => ({ name: x.name, team: x.team, quizPoints: x.quizPoints, bestStreak: x.bestStreak })),
  };
}

// GET ?view=recap (student x-sid/x-pin, or dealer as=<sid>): only that student's own story.
export async function recap(m, players, p, extra = {}) {
  const { list, tr, px } = classStats(m, players, extra);
  let st = list.find((x) => x.id === p.id);
  if (!st) {
    // a ghost (test account): its own numbers, never ranked and never part of the class
    st = statsOf(m, p, px, tr);
    Object.assign(st, { rank: null, of: list.length, beatPct: null, topPct: null, quizRank: null, points: 0 });
    st.badges = badgesOf(st);
  }
  const f = st.quiz.fastest;
  if (f) {
    try {
      const a = await S.hget(Q.qaKey(f.run, f.qi), p.id);
      if (a && Number.isFinite(Number(a.ms))) f.ms = Math.max(0, Math.round(Number(a.ms)));
    } catch {}
    delete f.run;
  }
  const series = [[null, CAP], ...(m.pfHist || []).filter((h) => h.v[p.id] !== undefined).map((h) => [h.ts, h.v[p.id]])];
  const team = m.teams.find((t) => t.id === p.team);
  return {
    ok: true, generated: Date.now(), final: m.phase === 'final' || !!m.exit, block: m.block, phase: m.phase, blocks: tr.blocks,
    recap: {
      ...st, series: series.map(([ts, v]) => [ts, r0(v)]),
      myTeam: team ? { id: team.id, name: team.name, color: team.color, V: r0(G.valuation(m, team.id)), exit: m.exit?.outcomes?.[team.id] || null } : null,
      class: { n: list.length, avgReturn: r1(avg(list.map((x) => x.returnPct))), avgStartups: r1(avg(list.map((x) => x.diversification.startups))) },
    },
  };
}

// The GET handler for both views. ctx = { meta, players, pinHash, dealerOk }.
export async function view(name, req, { meta, players, pinHash }) {
  const off = { status: 400, body: { ok: false, error: F.OFF } };
  const dealer = req.headers['x-dealer'] !== undefined && AC.isDealer(req);
  if (name === 'report') {
    if (!dealer) return { status: 401, body: { ok: false, error: 'Špatné heslo dealera.' } };
    if (!F.on(meta, FLAG)) return off;
    return { status: 200, body: report(meta, players, await legacySlips(meta)) };
  }
  let p = AC.asPlayer(req, players);
  if (!p) {
    const sid = req.headers['x-sid'], pin = req.headers['x-pin'];
    const x = sid ? players[sid] : null;
    if (!x || !x.pin || x.pin !== pinHash(x.id, String(pin || ''))) {
      return { status: 401, body: { ok: false, error: dealer ? 'Vyber hráče (as=<sid>).' : 'Přihlas se znovu.', relogin: !dealer } };
    }
    p = x;
  }
  if (!F.on(meta, FLAG)) return off;
  return { status: 200, body: await recap(meta, players, p, await legacySlips(meta)) };
}
