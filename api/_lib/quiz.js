// v2 quiz: question sets, the run state machine, scoring into the points ledger, and the views.
// Answers live in one small hash per question, `qa:<runId>:<idx>` (field = sid, value { choice, ms, ts }),
// written once per student with HSETNX, so 20 students answering at the same moment never touch meta.
import * as F from './features.js';

export const qaKey = (runId, idx) => `qa:${runId}:${idx}`;
export const setOf = (m) => m.quizSets.find((s) => s.id === m.quiz.setId) || null;
export const current = (m) => { const s = setOf(m); return s && m.quiz.idx >= 0 ? s.questions[m.quiz.idx] || null : null; };
export const GRACE_MS = 1500;

// The answers hash a GET needs (only while a question is open or revealed): one cheap command.
export function answersKey(m) {
  const z = m.quiz;
  if (!F.on(m, 'quiz') || !z?.runId || !(z.idx >= 0) || !['question', 'reveal'].includes(z.state)) return null;
  return qaKey(z.runId, z.idx);
}

export function score(raw, time) {
  const ms = Math.max(0, Number(raw) || 0);
  const s = Math.round(1000 * (1 - (0.5 * ms) / (time * 1000)));
  return Math.min(1000, Math.max(500, s));
}

export function cleanSet(set) {
  if (!set || typeof set !== 'object') return { error: 'Chybí sada otázek.' };
  const id = set.id === undefined || set.id === '' ? 's' + F.rid(3) : String(set.id).trim();
  if (!/^[\w-]{1,24}$/.test(id)) return { error: 'Neplatné ID sady.' };
  const title = String(set.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!title) return { error: 'Sada potřebuje název.' };
  if (!Array.isArray(set.questions) || !set.questions.length) return { error: 'Sada potřebuje aspoň jednu otázku.' };
  if (set.questions.length > 60) return { error: 'Sada může mít nejvýš 60 otázek.' };
  const questions = [];
  for (const [i, x] of set.questions.entries()) {
    const n = i + 1;
    const q = String(x?.q || '').replace(/\s+/g, ' ').trim();
    if (!q) return { error: `Otázka ${n} je prázdná.` };
    if (q.length > 160) return { error: `Otázka ${n} je delší než 160 znaků.` };
    if (!Array.isArray(x.a) || x.a.length < 2 || x.a.length > 4) return { error: `Otázka ${n} musí mít 2 až 4 odpovědi.` };
    const a = x.a.map((s) => String(s ?? '').replace(/\s+/g, ' ').trim());
    if (a.some((s) => !s)) return { error: `Otázka ${n} má prázdnou odpověď.` };
    if (a.some((s) => s.length > 80)) return { error: `Odpověď u otázky ${n} je delší než 80 znaků.` };
    const correct = Number(x.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct >= a.length) return { error: `Otázka ${n} nemá platnou správnou odpověď.` };
    const time = Math.round(Number(x.time) || 20);
    if (time < 5 || time > 120) return { error: `Čas u otázky ${n} musí být 5 až 120 s.` };
    questions.push({ q, a, correct, time });
  }
  return { set: { id, title, questions } };
}

const bump = (m, patch) => { Object.assign(m.quiz, patch); m.quiz.seq = (m.quiz.seq || 0) + 1; };

export function start(m, setId) {
  const s = m.quizSets.find((x) => x.id === setId);
  if (!s || !s.questions.length) return 'Sada otázek nenalezena.';
  bump(m, { runId: F.rid(4), setId: s.id, idx: -1, state: 'board', startedAt: null, endsAt: null, scored: [], res: null, startTs: Date.now() });
  return null;
}

// Score the open question once (one ledger entry per correct student). Idempotent.
export function scoreCurrent(m, players, qa) {
  const z = m.quiz, q = current(m);
  if (!z.runId || !q) return;
  const key = z.runId + ':' + z.idx;
  z.scored = z.scored || [];
  if (z.scored.includes(key)) return;
  const counts = q.a.map(() => 0);
  let answered = 0, fastest = null;
  for (const [sid, ans] of Object.entries(qa || {})) {
    const p = players[sid];
    if (!p || p.ghost || !ans) continue;
    const c = Number(ans.choice);
    if (!(c >= 0 && c < q.a.length)) continue;
    counts[c]++; answered++;
    if (c === q.correct) {
      F.addPoints(m, sid, score(ans.ms, q.time), 'quiz', `Kvíz: otázka ${z.idx + 1}`, { run: z.runId, qi: z.idx });
      if (!fastest || ans.ms < fastest.ms) fastest = { name: p.name, team: p.team, ms: Math.max(0, Math.round(ans.ms)) };
    }
  }
  z.res = { key, counts, answered, fastest };
  z.scored.push(key);
}

// op name -> handler(meta, players, qa, b) returning an error string or null
export function step(m, op, players, qa, b) {
  const z = m.quiz;
  const total = setOf(m)?.questions.length || 0;
  const open = z.state === 'question' && z.idx >= 0;
  if (op === 'quizStart') return start(m, b.setId);
  if (!z.runId && op !== 'quizEnd') return 'Kvíz neběží. Nejdřív ho spusť.';
  if (op === 'quizNext') {
    if (open) scoreCurrent(m, players, qa);
    const idx = z.idx + 1;
    if (idx >= total) { bump(m, { state: 'done', startedAt: null, endsAt: null }); return null; }
    const q = setOf(m).questions[idx];
    const now = Date.now();
    bump(m, { idx, state: 'question', startedAt: now, endsAt: now + q.time * 1000, res: null });
    m.quizLog.push({ runId: z.runId, setId: z.setId, idx, ts: now });
    if (m.quizLog.length > 400) m.quizLog.splice(0, m.quizLog.length - 400);
    return null;
  }
  if (op === 'quizReveal') {
    if (!(z.idx >= 0) || !current(m)) return 'Není co odhalit.';
    if (z.state === 'reveal') return null;
    scoreCurrent(m, players, qa);
    bump(m, { state: 'reveal' });
    return null;
  }
  if (op === 'quizBoard') {
    if (open) scoreCurrent(m, players, qa);
    if (z.state === 'board') return null;
    bump(m, { state: 'board' });
    return null;
  }
  if (op === 'quizEnd') {
    if (open) scoreCurrent(m, players, qa);
    // first press: final board (done); pressed again (or { idle: true }): quiz off the screens
    if (z.state === 'done' || b.idle || !z.runId) bump(m, { state: 'idle', startedAt: null, endsAt: null });
    else bump(m, { state: 'done', startedAt: null, endsAt: null });
    return null;
  }
  return 'Neznámá akce.';
}

function runBoard(m, players) {
  const z = m.quiz;
  const tot = F.pointTotals(m, players);
  const run = {};
  for (const e of m.points) if (e.kind === 'quiz' && e.run === z.runId && e.playerId in tot) run[e.playerId] = (run[e.playerId] || 0) + e.amt;
  return { tot, run };
}

export function publicQuiz(m, players, qa) {
  const z = m.quiz, s = setOf(m);
  const out = { state: F.on(m, 'quiz') ? z.state : 'idle', seq: z.seq || 0, setTitle: s?.title || '', idx: z.idx ?? -1, total: s?.questions.length || 0, serverNow: Date.now() };
  if (!F.on(m, 'quiz')) return out;
  const q = current(m);
  if (z.state === 'question' && q) {
    let answered = 0;
    for (const sid of Object.keys(qa || {})) if (players[sid] && !players[sid].ghost) answered++;
    Object.assign(out, { q: q.q, a: q.a, time: q.time, startedAt: z.startedAt, endsAt: z.endsAt, answered });
  } else if (z.state === 'reveal' && q) {
    const res = z.res || { counts: q.a.map(() => 0), answered: 0, fastest: null };
    Object.assign(out, { q: q.q, a: q.a, correct: q.correct, counts: res.counts, answered: res.answered, fastest: res.fastest });
  } else if (z.state === 'board' || z.state === 'done') {
    const { tot, run } = runBoard(m, players);
    out.leaders = Object.entries(run)
      .filter(([, v]) => v > 0)
      .map(([id, quizPoints]) => ({ name: players[id].name, team: players[id].team, quizPoints, total: tot[id] || 0 }))
      .sort((a, b) => b.quizPoints - a.quizPoints || b.total - a.total || String(a.name).localeCompare(String(b.name), 'cs'))
      .slice(0, 10);
  }
  return out;
}

export function meQuiz(m, p, players, qa) {
  const z = m.quiz, q = current(m);
  const live = ['question', 'reveal'].includes(z.state) && q;
  const mine = live && qa?.[p.id] ? Number(qa[p.id].choice) : null;
  const { tot, run } = runBoard(m, players);
  const runPoints = run[p.id] || 0;
  const qp = m.points.find((e) => e.kind === 'quiz' && e.run === z.runId && e.qi === z.idx && e.playerId === p.id);
  return {
    myChoice: Number.isInteger(mine) ? mine : null,
    myCorrect: z.state === 'reveal' && q ? mine === q.correct : null,
    myPoints: z.state === 'reveal' || z.state === 'board' || z.state === 'done' ? qp?.amt || 0 : 0,
    runPoints,
    rank: p.ghost || !z.runId ? null : 1 + Object.keys(tot).filter((id) => (run[id] || 0) > runPoints).length,
  };
}

// For the admin: everything about the run, including the correct answer and who answered.
export function dealerQuiz(m, players, qa) {
  const q = current(m);
  const answers = [];
  for (const [sid, a] of Object.entries(qa || {})) {
    const p = players[sid];
    if (!p) continue;
    answers.push({ sid, name: p.name, team: p.team, ghost: !!p.ghost, choice: a.choice, ms: a.ms });
  }
  answers.sort((a, b) => a.ms - b.ms);
  return { ...m.quiz, question: q, answers, answered: answers.filter((a) => !a.ghost).length };
}
