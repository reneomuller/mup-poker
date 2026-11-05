// v2 archives (hash arch = full objects, hash archi = their small index) and the dealer's data view.
import crypto from 'node:crypto';
import * as S from './store.js';
import * as G from './game.js';
import * as F from './features.js';
import * as Q from './quiz.js';
import * as W from './wall.js';

// The game minus archives and quiz answers: what the dealer laptop keeps and what an archive stores.
export async function buildDump(meta, players, content) {
  const slips = {};
  const hs = await Promise.all(Array.from({ length: G.CFG.MAX_BLOCK }, (_, i) => S.hgetall('slip:' + (i + 1))));
  hs.forEach((h, i) => { if (Object.keys(h).length) slips[i + 1] = h; });
  const [qs, qv, qr, tx] = await Promise.all([S.hgetall('qs'), S.hgetall('qv'), S.hgetall('qr'), S.hgetall('tx')]);
  return { meta, players, slips, content, board: { qs, qv, qr }, tx };
}

export async function createArchive(label, auto, meta, players, content) {
  const dump = await buildDump(meta, players, content);
  dump.walls = await W.dumpWalls(meta); // v3 §4: the team walls too (reset clears them right after its archive)
  const ts = Date.now();
  const id = ts.toString(36) + crypto.randomBytes(3).toString('hex');
  const obj = { id, ts, label: String(label || 'Archiv').slice(0, 80), auto: !!auto, block: meta.block, dump };
  const sizeKB = Math.max(1, Math.round(JSON.stringify(obj).length / 1024));
  await S.hset('arch', id, obj);
  await S.hset('archi', id, { id, ts, label: obj.label, auto: obj.auto, block: obj.block, sizeKB });
  return id;
}

export async function listArchives() {
  const idx = await S.hgetallBoth('archi');
  return Object.values(idx).filter(Boolean).sort((a, b) => b.ts - a.ts);
}
export const getArchive = (id) => S.hget('arch', String(id || ''));
export async function deleteArchive(id) {
  await S.hdel('arch', String(id));
  await S.hdel('archi', String(id));
}

export async function dataView(meta, players, tx) {
  const r = G.raised(meta);
  const tname = (t) => meta.teams.find((x) => x.id === t)?.name || t;
  const teams = meta.teams.map((t) => ({
    id: t.id, name: t.name, color: t.color, V: F.r0(G.valuation(meta, t.id)), S: Math.round((meta.ledger.S[t.id] || 0) * 1000) / 1000,
    founderPct: G.founderPct(meta, t.id), cls: F.r0(r[t.id].cls), rj: F.r0(r[t.id].rj),
    oneLiner: tx['card:' + t.id]?.oneLiner || '', sub: tx['card:' + t.id]?.sub || '',
  }));
  const plist = Object.values(players).filter(Boolean).map((p) => {
    const st = G.stakes(meta, p.id);
    const holdings = {};
    for (const [t, v] of Object.entries(st)) if (v > 0.5) holdings[t] = F.r0(v);
    const value = F.studentValue(meta, p.id);
    return {
      id: p.id, name: p.name, team: p.team, teamName: tname(p.team), created: p.created || null, ghost: !!p.ghost, hasPin: !!p.pin,
      portfolio: F.r0(G.portfolio(meta, p.id)), returnPct: F.returnPct(value), holdings,
    };
  });
  const allocations = [];
  const blocks = Array.from({ length: Math.max(1, Math.min(meta.block, G.CFG.MAX_BLOCK)) }, (_, i) => i + 1);
  const slipMaps = await Promise.all(blocks.map((b) => S.hgetall('slip:' + b)));
  blocks.forEach((block, i) => {
    for (const [sid, s] of Object.entries(slipMaps[i])) {
      if (!s || typeof s !== 'object') continue;
      const p = players[sid];
      allocations.push({
        block, playerId: sid, name: sid === G.RJ ? 'RainbowJet' : p?.name || '?', team: sid === G.RJ ? null : p?.team || null,
        ghost: !!p?.ghost, submitted: !!s.submitted, ts: s.ts || null, in: s.in || {}, out: s.out || {}, notes: s.notes || {},
      });
    }
  });
  const runs = meta.quizLog || [];
  const ans = await Promise.all(runs.map((e) => S.hgetall(Q.qaKey(e.runId, e.idx))));
  const quizRuns = runs.map((e, i) => {
    const answers = {};
    for (const [sid, a] of Object.entries(ans[i])) if (a && !players[sid]?.ghost) answers[sid] = { choice: a.choice, ms: a.ms };
    return { runId: e.runId, setId: e.setId, idx: e.idx, answers };
  });
  return { ok: true, generated: Date.now(), teams, players: plist, allocations, points: meta.points, quizRuns, demand: meta.demand || {} };
}
