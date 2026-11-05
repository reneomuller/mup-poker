// v4 quizplus (flag `quizplus`, default on): per-question explanation (`why`), double points (`double`),
// an https image (`img`), the lobby „ready“ counter and the per-question results export for the admin.
// Pure helpers on meta plus two small async views; quiz.js and api/game.js call into it.
import * as F from './features.js';
import { QUIZ_SEED } from './quiz-seed.js';

export const on = (m) => F.on(m, 'quizplus');
export const WHY_MAX = 240, IMG_MAX = 500;
const qaKey = (runId, idx) => `qa:${runId}:${idx}`;
// phones that opened the quiz lobby: one tiny hash per run (field = sid), never read by a plain GET
export const readyKey = (runId) => qaKey(runId, 'ready');
const SEED_WHY = new Map(QUIZ_SEED.filter((x) => x.why).map((x) => [x.q, x.why]));

export function validImg(s) {
  if (typeof s !== 'string' || !s || s.length > IMG_MAX || /[\s"'<>\\`]/.test(s)) return false;
  try { const u = new URL(s); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; }
}

// The optional per-question fields (kept even with the flag off: content editing always works).
export function cleanExtras(x, n) {
  const extra = {};
  const why = String(x?.why ?? '').replace(/[ \t\r\n]+/g, ' ').trim(); // keeps nbsp
  if (why.length > WHY_MAX) return { error: `Vysvětlení u otázky ${n} je delší než ${WHY_MAX} znaků.` };
  if (why) extra.why = why;
  if (x?.double === true || x?.double === 1 || x?.double === 'true') extra.double = true;
  const img = String(x?.img ?? '').trim();
  if (img) {
    if (!validImg(img)) return { error: `Obrázek u otázky ${n} musí být adresa začínající https://.` };
    extra.img = img;
  }
  return { extra };
}

export const mult = (m, q) => (on(m) && q?.double ? 2 : 1);
// seeded „Blok 2 – slovník“ sets saved before v4 have no explanations: fall back to the seed's text
export const whyOf = (q) => q?.why || SEED_WHY.get(q?.q) || '';

// publicState.quiz additions. Never the correct index or the explanation before the reveal.
export function publicExtras(m, z, q, set, mode) {
  if (!on(m)) return {};
  const out = {};
  if ((mode === 'question' || mode === 'reveal') && q) {
    if (q.double) out.double = true;
    if (q.img) out.img = q.img;
    if (mode === 'reveal') { const w = whyOf(q); if (w) out.why = w; }
  }
  if (mode === 'board' && set) {
    const nx = set.questions[(z.idx ?? -1) + 1];
    if (nx?.double) out.nextDouble = true;
  }
  return out;
}

// Longest run of correct answers in a row this run (ledger entries are one per correct, scored in order).
export function bestStreak(m, z, sid) {
  const qi = m.points.filter((e) => e.kind === 'quiz' && e.run === z.runId && e.playerId === sid).map((e) => e.qi).sort((a, b) => a - b);
  let best = 0, cur = 0, prev = null;
  for (const i of qi) { cur = prev !== null && i === prev + 1 ? cur + 1 : 1; prev = i; if (cur > best) best = cur; }
  return best;
}

export function meExtras(m, z, p) {
  if (!on(m) || !z.runId) return {};
  if (z.state === 'board' || z.state === 'done') return { bestStreak: p.ghost ? 0 : bestStreak(m, z, p.id) };
  return {};
}

// student op quizReady: the phone shows the lobby → one HSETNX on the run's ready hash (never meta)
export async function ready(m, p, S) {
  const z = m.quiz;
  if (!on(m) || !F.on(m, 'quiz')) return { error: F.OFF };
  if (!z.runId || z.state !== 'board' || !(z.idx < 0)) return { ok: true, lobby: false };
  if (!p.ghost) await S.hsetnx(readyKey(z.runId), p.id, { ts: Date.now() });
  return { ok: true, lobby: true };
}

// GET ?view=quizready (the projector polls it only while the lobby is up): { ready, expected }
export async function readyView(m, players, S) {
  const z = m.quiz;
  const expected = Object.values(players || {}).filter((p) => p && !p.ghost).length;
  if (!on(m) || !F.on(m, 'quiz') || !z.runId || z.state !== 'board' || !(z.idx < 0)) return { ok: true, lobby: false, ready: 0, expected };
  const h = await S.hgetall(readyKey(z.runId));
  const ready = Object.keys(h || {}).filter((sid) => players[sid] && !players[sid].ghost).length;
  return { ok: true, lobby: true, ready, expected };
}

// GET ?view=quizrun (dealer): without runId the list of runs, with runId per-question stats.
export async function runView(m, players, runId, S) {
  const log = m.quizLog || [];
  const titleOf = (setId) => m.quizSets.find((s) => s.id === setId)?.title || setId;
  const tname = (t) => (m.teams || []).find((x) => x.id === t)?.name || t;
  if (!runId) {
    const runs = new Map();
    for (const e of log) {
      const r = runs.get(e.runId) || { runId: e.runId, setId: e.setId, title: titleOf(e.setId), ts: e.ts, questions: 0 };
      r.questions++; r.last = e.ts;
      runs.set(e.runId, r);
    }
    return { ok: true, on: on(m), runs: [...runs.values()].sort((a, b) => b.ts - a.ts), current: m.quiz.runId || null };
  }
  const byIdx = new Map();
  for (const e of log) if (e.runId === runId) byIdx.set(e.idx, e);
  if (!byIdx.size) return { ok: false, status: 404, error: 'Běh kvízu nenalezen.' };
  const entries = [...byIdx.values()].sort((a, b) => a.idx - b.idx);
  const setId = entries[0].setId, set = m.quizSets.find((s) => s.id === setId);
  const hashes = await Promise.all(entries.map((e) => S.hgetall(qaKey(runId, e.idx))));
  const questions = entries.map((e, i) => {
    const q = set?.questions[e.idx] || null;
    const n = q ? q.a.length : 4;
    const correct = Number.isInteger(e.c) ? e.c : q ? q.correct : null;
    const counts = Array.from({ length: n }, () => 0);
    let answered = 0, right = 0, msSum = 0, fastest = null;
    for (const [sid, a] of Object.entries(hashes[i] || {})) {
      const p = players[sid];
      if (!p || p.ghost || !a) continue;
      const c = Number(a.choice);
      if (!(c >= 0 && c < n)) continue;
      const ms = Math.max(0, Math.round(Number(a.ms) || 0));
      counts[c]++; answered++; msSum += ms;
      if (c === correct) { right++; if (!fastest || ms < fastest.ms) fastest = { name: p.name, team: p.team, teamName: tname(p.team), ms }; }
    }
    return {
      idx: e.idx, n: e.idx + 1, q: q?.q || '', a: q?.a || [], correct, time: e.t || q?.time || null, double: !!(e.x2 || q?.double),
      counts, answered, correctN: right, pctCorrect: answered ? Math.round((right / answered) * 1000) / 10 : 0,
      avgMs: answered ? Math.round(msSum / answered) : null, fastest, ts: e.ts,
    };
  });
  const run = {};
  for (const e of m.points) if (e.kind === 'quiz' && e.run === runId && players[e.playerId] && !players[e.playerId].ghost) run[e.playerId] = (run[e.playerId] || 0) + e.amt;
  const ranking = Object.entries(run).sort((a, b) => b[1] - a[1]).map(([id, pts], i) => ({ rank: i + 1, name: players[id].name, team: players[id].team, teamName: tname(players[id].team), points: pts }));
  const players0 = Object.values(players).filter((p) => p && !p.ghost).length;
  return { ok: true, runId, setId, title: titleOf(setId), ts: entries[0].ts, players: players0, questions, ranking };
}
