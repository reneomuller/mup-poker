// v3 §4: team sticker walls. One hash per team, `wall:<teamId>`, with separate fields so that
// concurrent writers never overwrite each other:
//   s:<stickerId>            { id, kind: 'q'|'task', text, by: { role, id?, name }, ts, group?, ghost? }
//   r:<stickerId>:<replyId>  { id, text, by, ts, ghost? }
//   d:<stickerId>            { done, by, ts }   (tasks only)
// No team ever sees another team's wall; a ghost's stickers and replies are seen only by that ghost and the dealer.
// meta.wallRev[team] is a cheap per-team counter for the phones' badge (read from meta, so a plain GET costs nothing extra).
import crypto from 'node:crypto';
import * as S from './store.js';
import * as F from './features.js';

export const OPS = ['wallPost', 'wallReply', 'wallDone', 'wallDelete'];
export const MAX_STICKERS = 300, MAX_REPLIES = 100, MAX_TEXT = 500;
export const KINDS = ['q', 'task'];
export const key = (team) => 'wall:' + team;
const newId = () => crypto.randomBytes(6).toString('base64url');
const fail = (msg, status = 400) => ({ status, body: { ok: false, error: msg } });
const ok = (extra) => ({ status: 200, body: { ok: true, ...extra } });
const OTHER_TEAM = 'Tahle nástěnka patří jinému týmu.';
const NOT_FOUND = 'Lísteček nenalezen.';
const DEALER_BY = { role: 'dealer', name: 'MUP' };

export const rev = (meta, team) => Number(meta?.wallRev?.[team]) || 0;
const teamIds = (meta) => (meta.teams || []).map((t) => t.id);

function cleanText(t) {
  const s = String(t ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!s) return { error: 'Text je prázdný.' };
  if (s.length > MAX_TEXT) return { error: `Text je moc dlouhý (nejvýš ${MAX_TEXT} znaků).` };
  return { text: s };
}

// Increment meta.wallRev for these teams on a fresh copy of meta (only that field changes; meta.rev stays).
async function bump(teams) {
  const m = await S.getJSON('meta');
  if (!m) return;
  if (!m.wallRev || typeof m.wallRev !== 'object') m.wallRev = {};
  for (const t of teams) m.wallRev[t] = (Number(m.wallRev[t]) || 0) + 1;
  await S.setJSON('meta', m);
}

const split = (h) => {
  const st = {}, rp = {}, dn = {};
  for (const [f, v] of Object.entries(h || {})) {
    if (!v || typeof v !== 'object') continue;
    if (f.startsWith('s:')) st[f.slice(2)] = v;
    else if (f.startsWith('d:')) dn[f.slice(2)] = v;
    else if (f.startsWith('r:')) {
      const i = f.indexOf(':', 2);
      if (i < 0) continue;
      (rp[f.slice(2, i)] ||= {})[f.slice(i + 1)] = v;
    }
  }
  return { st, rp, dn };
};

// viewer: { role: 'dealer' } | { role: 'student', p }
const canSee = (x, viewer) => viewer.role === 'dealer' || !x.ghost || (x.by?.role === 'student' && x.by.id === viewer.p.id);
const isMine = (x, viewer) => viewer.role === 'student' && x.by?.role === 'student' && x.by.id === viewer.p.id;
const pubBy = (by) => (by && typeof by === 'object' ? { role: by.role === 'dealer' ? 'dealer' : 'student', ...(by.id ? { id: by.id } : {}), name: String(by.name || '') } : { role: 'student', name: '?' });

export function build(h, viewer) {
  const { st, rp, dn } = split(h);
  const dealer = viewer.role === 'dealer';
  const list = Object.values(st).filter((s) => s && s.id && canSee(s, viewer)).map((s) => {
    const d = dn[s.id];
    const done = s.kind === 'task' && !!d?.done;
    const replies = Object.values(rp[s.id] || {}).filter((r) => r && r.id && canSee(r, viewer))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0))
      .map((r) => ({ id: r.id, text: r.text, by: pubBy(r.by), ts: r.ts, mine: isMine(r, viewer), ...(dealer && r.ghost ? { ghost: true } : {}) }));
    return {
      id: s.id, kind: s.kind, text: s.text, by: pubBy(s.by), ts: s.ts, ...(s.group ? { group: s.group } : {}),
      ...(dealer && s.ghost ? { ghost: true } : {}),
      mine: isMine(s, viewer), done, ...(done ? { doneBy: pubBy(d.by), doneTs: d.ts } : {}), replies,
    };
  });
  // newest first, open tasks (and questions) before done tasks
  return list.sort((a, b) => (a.done - b.done) || (b.ts || 0) - (a.ts || 0));
}

// GET ?view=wall. Student: own team only (a `team` param naming another team is refused).
// Dealer: ?team=<id> → that wall, ?team=all → { walls: { <teamId>: [stickers] } }.
export async function view(meta, viewer, team) {
  if (!F.on(meta, 'wall')) return fail(F.OFF);
  if (viewer.role === 'student') {
    const own = viewer.p.team;
    if (team && team !== own) return fail(OTHER_TEAM, 403);
    return ok({ team: own, rev: rev(meta, own), stickers: build(await S.hgetall(key(own)), viewer) });
  }
  if (team === 'all') {
    const ids = teamIds(meta);
    const hs = await Promise.all(ids.map((t) => S.hgetall(key(t))));
    const walls = {}, revs = {};
    ids.forEach((t, i) => { walls[t] = build(hs[i], viewer); revs[t] = rev(meta, t); });
    return ok({ walls, revs });
  }
  if (!teamIds(meta).includes(team)) return fail('Vyber tým.');
  return ok({ team, rev: rev(meta, team), stickers: build(await S.hgetall(key(team)), viewer) });
}

// One wall op. actor: { role: 'dealer' } | { role: 'student', p }. runMeta wraps the wallRev write
// (the student path passes the per-instance serial queue so it never races a dealer meta write).
export async function op(b, meta, actor, runMeta = (fn) => fn()) {
  if (!F.on(meta, 'wall')) return fail(F.OFF);
  const dealer = actor.role === 'dealer';
  const p = actor.p;
  const ghost = !dealer && !!p.ghost;
  const by = dealer ? DEALER_BY : { role: 'student', id: p.id, name: p.name };
  let teams;
  if (dealer) {
    if (b.op === 'wallPost' && b.all === true) teams = teamIds(meta);
    else if (teamIds(meta).includes(b.team)) teams = [b.team];
    else return fail('Vyber tým.');
  } else {
    if (b.team != null && b.team !== '' && b.team !== p.team) return fail(OTHER_TEAM, 403);
    if (!teamIds(meta).includes(p.team)) return fail(OTHER_TEAM, 403);
    teams = [p.team];
  }
  const team = teams[0];
  const ts = Date.now();
  const id = String(b.id || '');
  const done = (extra) => runMeta(() => (ghost ? null : bump(teams))).then(() => ok(extra));

  if (b.op === 'wallPost') {
    if (!KINDS.includes(b.kind)) return fail('Vyber, jestli je to otázka, nebo úkol.');
    const t = cleanText(b.text);
    if (t.error) return fail(t.error);
    const hs = await Promise.all(teams.map((x) => S.hgetall(key(x))));
    const full = teams.filter((x, i) => Object.keys(hs[i]).filter((f) => f.startsWith('s:')).length >= MAX_STICKERS);
    if (full.length === teams.length) return fail(`Nástěnka je plná (nejvýš ${MAX_STICKERS} lístečků).`);
    const sid = newId();
    const group = teams.length > 1 ? 'g' + newId() : null;
    const to = teams.filter((x) => !full.includes(x));
    const s = { id: sid, kind: b.kind, text: t.text, by, ts, ...(group ? { group } : {}), ...(ghost ? { ghost: true } : {}) };
    await Promise.all(to.map((x) => S.hset(key(x), 's:' + sid, s)));
    teams = to;
    return done({ id: sid, ...(group ? { group, teams: to, full } : {}), sticker: build({ ['s:' + sid]: s }, actor)[0] || null });
  }

  if (!/^[\w-]{1,24}$/.test(id)) return fail(NOT_FOUND);
  const h = await S.hgetall(key(team));
  const s = h['s:' + id];
  // a student never learns that a ghost's sticker exists
  if (!s || !s.id || !canSee(s, actor)) return fail(NOT_FOUND);

  if (b.op === 'wallReply') {
    const t = cleanText(b.text);
    if (t.error) return fail(t.error);
    const n = Object.keys(h).filter((f) => f.startsWith(`r:${id}:`)).length;
    if (n >= MAX_REPLIES) return fail(`Na tenhle lísteček už je moc odpovědí (nejvýš ${MAX_REPLIES}).`);
    const rid = newId();
    const r = { id: rid, text: t.text, by, ts, ...(ghost ? { ghost: true } : {}) };
    await S.hset(key(team), `r:${id}:${rid}`, r);
    return done({ id: rid, reply: { id: rid, text: r.text, by: pubBy(by), ts, mine: !dealer } });
  }

  if (b.op === 'wallDone') {
    if (s.kind !== 'task') return fail('Odškrtnout jde jen úkol.');
    if (ghost && !s.ghost) return fail('Ghost úkoly týmu neodškrtává.');
    const v = { done: !!b.done, by, ts };
    await S.hset(key(team), 'd:' + id, v);
    return done({ done: v.done });
  }

  if (b.op === 'wallDelete') {
    if (b.reply != null && b.reply !== '') {
      const f = `r:${id}:${String(b.reply)}`;
      const r = h[f];
      if (!r || !canSee(r, actor)) return fail('Odpověď nenalezena.');
      if (!dealer && !isMine(r, actor)) return fail('Smazat můžeš jen svůj lísteček nebo svou odpověď.', 403);
      await S.hdel(key(team), f);
      return done({ deleted: f });
    }
    if (!dealer && !isMine(s, actor)) return fail('Smazat můžeš jen svůj lísteček nebo svou odpověď.', 403);
    const fields = ['s:' + id, ...Object.keys(h).filter((f) => f === 'd:' + id || f.startsWith(`r:${id}:`))];
    for (const f of fields) await S.hdel(key(team), f);
    return done({ deleted: 's:' + id, removed: fields.length });
  }
  return fail('Neznámá akce.');
}

// ---------- dump / restore / data view / reset ----------
export async function dumpWalls(meta) {
  const ids = teamIds(meta);
  const hs = await Promise.all(ids.map((t) => S.hgetall(key(t))));
  const out = {};
  ids.forEach((t, i) => { if (Object.keys(hs[i]).length) out[t] = hs[i]; });
  return out;
}

// Merge a dump's walls in: missing fields are added, a done state only replaces an older one.
// Old dumps without `walls` simply restore nothing here.
export async function restoreWalls(walls, ids) {
  if (!walls || typeof walls !== 'object') return 0;
  let n = 0;
  for (const [t, map] of Object.entries(walls)) {
    if (!ids.includes(t) || !map || typeof map !== 'object') continue;
    const cur = await S.hgetall(key(t));
    for (const [f, v] of Object.entries(map)) {
      if (!/^(s:[\w-]+|d:[\w-]+|r:[\w-]+:[\w-]+)$/.test(f) || !v || typeof v !== 'object') continue;
      if (f.startsWith('d:')) {
        const c = cur[f];
        if (c && (Number(c.ts) || 0) >= (Number(v.ts) || 0)) continue;
      } else if (f in cur) continue;
      await S.hset(key(t), f, v);
      n++;
    }
  }
  return n;
}

export async function dataWalls(meta) {
  const ids = teamIds(meta);
  const hs = await Promise.all(ids.map((t) => S.hgetall(key(t))));
  const out = {};
  ids.forEach((t, i) => { out[t] = build(hs[i], { role: 'dealer' }); });
  return out;
}

export async function clearWalls(meta) {
  await Promise.all(teamIds(meta).map((t) => S.del(key(t))));
}
