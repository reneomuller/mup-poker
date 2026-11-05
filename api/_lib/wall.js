// v3 §4: team sticker walls. One hash per team, `wall:<teamId>`, with separate fields so that
// concurrent writers never overwrite each other:
//   s:<stickerId>            { id, kind: 'q'|'task', text, by: { role, id?, name }, ts, group?, ghost?, due?, assign? }
//   r:<stickerId>:<replyId>  { id, text, by, ts, ghost? }
//   d:<stickerId>            { done, by, ts }   (tasks only)
// v4 (feature `wallplus`), again one field per writer:
//   x:<target>:<code>:<who>  { ts, ghost? }     reaction; target = stickerId or stickerId.replyId, code ∈ REACT, who = student id | 'dealer'
//   p:<stickerId>            { on, by, ts }      pinned to the top (dealer or the sticker's author)
//   a:<stickerId>            { reply, by, ts }   accepted answer of a question (the asker or the dealer)
//   m:<stickerId>            { due, assign, by, ts }  task details edited after posting (overrides the sticker's own)
//   t:<stickerId>[.<replyId>] { ts }             tombstone: restoring an older dump never resurrects a deleted sticker/reply
// Dealer templates live in meta.wallTpl (≤ 30) and are only ever sent to the dealer.
// No team ever sees another team's wall; a ghost's stickers, replies and reactions are seen only by that ghost and the dealer.
// meta.wallRev[team] is a cheap per-team counter for the phones' badge (read from meta, so a plain GET costs nothing extra).
import crypto from 'node:crypto';
import * as S from './store.js';
import * as F from './features.js';

export const PLUS_OPS = ['wallReact', 'wallPin', 'wallAccept', 'wallTask', 'wallTplSave', 'wallTplDelete'];
export const OPS = ['wallPost', 'wallReply', 'wallDone', 'wallDelete', ...PLUS_OPS];
export const MAX_STICKERS = 300, MAX_REPLIES = 100, MAX_TEXT = 500, MAX_TPL = 30;
export const KINDS = ['q', 'task'];
export const REACT = { up: '👍', heart: '❤️', lol: '😂', think: '🤔', fire: '🔥' };
const REACT_BY_EMOJI = Object.fromEntries(Object.entries(REACT).map(([k, v]) => [v, k]));
REACT_BY_EMOJI['❤'] = 'heart';
export const key = (team) => 'wall:' + team;
const newId = () => crypto.randomBytes(6).toString('base64url');
const fail = (msg, status = 400) => ({ status, body: { ok: false, error: msg } });
const ok = (extra) => ({ status: 200, body: { ok: true, ...extra } });
const OTHER_TEAM = 'Tahle nástěnka patří jinému týmu.';
const NOT_FOUND = 'Lísteček nenalezen.';
const DEALER_BY = { role: 'dealer', name: 'MUP' };
const ID = /^[\w-]{1,24}$/;

export const rev = (meta, team) => Number(meta?.wallRev?.[team]) || 0;
const teamIds = (meta) => (meta.teams || []).map((t) => t.id);
const plusOn = (meta) => F.on(meta, 'wallplus');

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
  const st = {}, rp = {}, dn = {}, rx = {}, pn = {}, ac = {}, md = {};
  for (const [f, v] of Object.entries(h || {})) {
    if (!v || typeof v !== 'object') continue;
    const c = f.slice(0, 2);
    if (c === 's:') st[f.slice(2)] = v;
    else if (c === 'd:') dn[f.slice(2)] = v;
    else if (c === 'p:') pn[f.slice(2)] = v;
    else if (c === 'a:') ac[f.slice(2)] = v;
    else if (c === 'm:') md[f.slice(2)] = v;
    else if (c === 'r:') {
      const i = f.indexOf(':', 2);
      if (i < 0) continue;
      (rp[f.slice(2, i)] ||= {})[f.slice(i + 1)] = v;
    } else if (c === 'x:') {
      const [, target, code, who] = f.split(':');
      if (!target || !REACT[code] || !who) continue;
      ((rx[target] ||= {})[code] ||= []).push({ who, ...v });
    }
  }
  return { st, rp, dn, rx, pn, ac, md };
};

// viewer: { role: 'dealer' } | { role: 'student', p }
const canSee = (x, viewer) => viewer.role === 'dealer' || !x.ghost || (x.by?.role === 'student' && x.by.id === viewer.p.id);
const isMine = (x, viewer) => viewer.role === 'student' && x.by?.role === 'student' && x.by.id === viewer.p.id;
const pubBy = (by) => (by && typeof by === 'object' ? { role: by.role === 'dealer' ? 'dealer' : 'student', ...(by.id ? { id: by.id } : {}), name: String(by.name || '') } : { role: 'student', name: '?' });
const whoOf = (viewer) => (viewer.role === 'dealer' ? 'dealer' : viewer.p.id);
// a reaction counts for a viewer unless it is another ghost's
const reactions = (list, viewer) => {
  const out = {};
  const me = whoOf(viewer);
  for (const [code, arr] of Object.entries(list || {})) {
    const vis = arr.filter((x) => viewer.role === 'dealer' || !x.ghost || x.who === me);
    if (vis.length) out[code] = { n: vis.length, mine: vis.some((x) => x.who === me) };
  }
  return out;
};

const pubDue = (d) => (!d ? null : d.kind === 'block' ? { kind: 'block', block: d.block } : { kind: 'time', at: d.at, ts: d.ts });
const overdue = (d, ctx) => !!d && (d.kind === 'block' ? (ctx.block || 0) > (d.block || 0) : (Number(d.ts) || Infinity) < ctx.now);

// ctx: { plus, block, now, members? } — only `plus` switches the v4 fields on (v3 output otherwise)
export function build(h, viewer, ctx = {}) {
  const { st, rp, dn, rx, pn, ac, md } = split(h);
  const dealer = viewer.role === 'dealer';
  const plus = !!ctx.plus;
  const now = ctx.now || Date.now();
  const list = Object.values(st).filter((s) => s && s.id && canSee(s, viewer)).map((s) => {
    const d = dn[s.id];
    const done = s.kind === 'task' && !!d?.done;
    const acc = plus && s.kind === 'q' ? ac[s.id]?.reply || null : null;
    let replies = Object.values(rp[s.id] || {}).filter((r) => r && r.id && canSee(r, viewer))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0))
      .map((r) => ({ id: r.id, text: r.text, by: pubBy(r.by), ts: r.ts, mine: isMine(r, viewer), ...(dealer && r.ghost ? { ghost: true } : {}),
        ...(plus ? { reactions: reactions(rx[s.id + '.' + r.id], viewer), ...(acc === r.id ? { accepted: true } : {}) } : {}) }));
    const out = {
      id: s.id, kind: s.kind, text: s.text, by: pubBy(s.by), ts: s.ts, ...(s.group ? { group: s.group } : {}),
      ...(dealer && s.ghost ? { ghost: true } : {}),
      mine: isMine(s, viewer), done, ...(done ? { doneBy: pubBy(d.by), doneTs: d.ts } : {}), replies,
    };
    if (plus) {
      const mine = out.mine;
      const author = dealer || mine;
      const pin = pn[s.id];
      out.pinned = !!pin?.on;
      if (out.pinned) out.pinBy = pubBy(pin.by);
      out.reactions = reactions(rx[s.id], viewer);
      if (s.kind === 'q') out.accepted = replies.some((r) => r.id === acc) ? acc : null;
      if (s.kind === 'task') {
        const m = md[s.id];
        const due = m ? m.due : s.due;
        const assign = m ? m.assign : s.assign;
        out.due = pubDue(due);
        out.overdue = !done && overdue(due, { block: ctx.block, now });
        out.assign = assign ? (assign.all ? { all: true } : { id: assign.id, name: String(assign.name || '') }) : null;
        out.assignedToMe = !dealer && !!assign && (assign.all || assign.id === viewer.p.id);
      }
      // a ghost may only change its own stickers (reactions and replies stay its own anyway)
      out.canPin = author;
      out.canAccept = s.kind === 'q' && author;
      out.canEdit = s.kind === 'task' && author;
    }
    return out;
  });
  // pinned first (v4), then open tasks (and questions) before done tasks, newest first
  return list.sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || (a.done - b.done) || (b.ts || 0) - (a.ts || 0));
}

// the team's students for the assignee picker (a ghost sees itself, others never see ghosts)
function members(players, team, viewer) {
  return Object.values(players || {}).filter((p) => p && p.team === team && (!p.ghost || viewer.role === 'dealer' || p.id === viewer.p?.id))
    .map((p) => ({ id: p.id, name: String(p.name || '') })).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}
const ctxOf = (meta) => ({ plus: plusOn(meta), block: meta.block, now: Date.now() });
const pubTpl = (meta) => (Array.isArray(meta.wallTpl) ? meta.wallTpl : []).map((t) => ({ id: t.id, kind: t.kind, text: t.text, ...(t.due ? { due: t.due } : {}), ts: t.ts }));

// send-to-all copies with each team's state, for the dealer's overview
function groups(walls) {
  const g = {};
  for (const [team, list] of Object.entries(walls)) {
    for (const s of list) {
      if (!s.group) continue;
      const x = (g[s.group] ||= { group: s.group, kind: s.kind, text: s.text, ts: s.ts, total: 0, done: 0, answered: 0, teams: [] });
      x.total++;
      if (s.done) x.done++;
      if (s.accepted || s.replies.length) x.answered++;
      x.teams.push({ team, id: s.id, done: !!s.done, replies: s.replies.length, ...(s.accepted ? { accepted: true } : {}) });
    }
  }
  return Object.values(g).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// GET ?view=wall. Student: own team only (a `team` param naming another team is refused).
// Dealer: ?team=<id> → that wall, ?team=all → { walls: { <teamId>: [stickers] } }.
// players (optional) adds the team's members for the v4 assignee picker.
export async function view(meta, viewer, team, players) {
  if (!F.on(meta, 'wall')) return fail(F.OFF);
  const ctx = ctxOf(meta);
  const plus = ctx.plus;
  if (viewer.role === 'student') {
    const own = viewer.p.team;
    if (team && team !== own) return fail(OTHER_TEAM, 403);
    return ok({ team: own, rev: rev(meta, own), stickers: build(await S.hgetall(key(own)), viewer, ctx), ...(plus && players ? { members: members(players, own, viewer) } : {}) });
  }
  const extra = plus ? { templates: pubTpl(meta) } : {};
  if (team === 'all') {
    const ids = teamIds(meta);
    const hs = await Promise.all(ids.map((t) => S.hgetall(key(t))));
    const walls = {}, revs = {}, mem = {};
    ids.forEach((t, i) => { walls[t] = build(hs[i], viewer, ctx); revs[t] = rev(meta, t); if (plus && players) mem[t] = members(players, t, viewer); });
    return ok({ walls, revs, ...extra, ...(plus ? { groups: groups(walls), ...(players ? { members: mem } : {}) } : {}) });
  }
  if (!teamIds(meta).includes(team)) return fail('Vyber tým.');
  return ok({ team, rev: rev(meta, team), stickers: build(await S.hgetall(key(team)), viewer, ctx), ...extra, ...(plus && players ? { members: members(players, team, viewer) } : {}) });
}

// due: 'HH:MM' (+ dueTs, the client's local time for it) | 'block' (end of the current block) | '' / null (none)
function parseDue(b, meta) {
  const d = b.due;
  if (d == null || d === '') return { due: null };
  if (d === 'block') return { due: { kind: 'block', block: Number(meta.block) || 1 } };
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(d));
  if (!m) return { error: 'Termín zadej jako čas, třeba 10:30, nebo „do konce bloku“.' };
  const at = `${Number(m[1])}:${m[2]}`;
  let ts = Number(b.dueTs);
  const now = Date.now();
  if (!Number.isFinite(ts) || Math.abs(ts - now) > 2 * 86400e3) {
    const x = new Date(now); x.setHours(Number(m[1]), Number(m[2]), 0, 0); ts = x.getTime();
  }
  return { due: { kind: 'time', at, ts } };
}
// assign: student id of a team member | 'all' (celý tým) | '' / null (nobody)
// (a ghost can be picked only by itself or the dealer, so nobody else learns it exists)
function parseAssign(b, team, players, actor) {
  const a = b.assign;
  if (a == null || a === '') return { assign: null };
  if (a === 'all') return { assign: { all: true } };
  const p = players?.[String(a)];
  if (!p || p.team !== team || (p.ghost && actor.role !== 'dealer' && actor.p?.id !== p.id)) return { error: 'Úkol jde přidělit jen členovi týmu.' };
  return { assign: { id: p.id, name: p.name } };
}

async function saveTpl(fn) {
  const m = await S.getJSON('meta');
  if (!m) return [];
  if (!Array.isArray(m.wallTpl)) m.wallTpl = [];
  const r = fn(m.wallTpl);
  if (r && r.error) return r;
  await S.setJSON('meta', m);
  return pubTpl(m);
}

// One wall op. actor: { role: 'dealer' } | { role: 'student', p }. runMeta wraps the wallRev write
// (the student path passes the per-instance serial queue so it never races a dealer meta write).
// players (optional) lets wallPost / wallTask check an assignee.
export async function op(b, meta, actor, runMeta = (fn) => fn(), players = null) {
  if (!F.on(meta, 'wall')) return fail(F.OFF);
  const dealer = actor.role === 'dealer';
  const plus = plusOn(meta);
  if (PLUS_OPS.includes(b.op) && !plus) return fail(F.OFF);
  const p = actor.p;
  const ghost = !dealer && !!p.ghost;
  const by = dealer ? DEALER_BY : { role: 'student', id: p.id, name: p.name };

  // templates: dealer only, never tied to a team
  if (b.op === 'wallTplSave' || b.op === 'wallTplDelete') {
    if (!dealer) return fail('Šablony může ukládat jen MUP.', 403);
    if (b.op === 'wallTplDelete') {
      const tid = String(b.tpl || b.id || '');
      const r = await runMeta(() => saveTpl((l) => { const i = l.findIndex((t) => t.id === tid); if (i < 0) return { error: 'Šablona nenalezena.' }; l.splice(i, 1); }));
      return r.error ? fail(r.error) : ok({ templates: r });
    }
    if (!KINDS.includes(b.kind)) return fail('Vyber, jestli je to otázka, nebo úkol.');
    const t = cleanText(b.text);
    if (t.error) return fail(t.error);
    const due = b.kind === 'task' && (b.due === 'block' || /^\d{1,2}:\d{2}$/.test(String(b.due || ''))) ? String(b.due) : null;
    const r = await runMeta(() => saveTpl((l) => {
      if (l.some((x) => x.kind === b.kind && x.text === t.text)) return { error: 'Tahle šablona už existuje.' };
      if (l.length >= MAX_TPL) return { error: `Šablon je moc (nejvýš ${MAX_TPL}). Nejdřív nějakou smaž.` };
      l.push({ id: newId(), kind: b.kind, text: t.text, ...(due ? { due } : {}), ts: Date.now() });
    }));
    return r.error ? fail(r.error) : ok({ templates: r });
  }

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
    let extra = {};
    if (plus && b.kind === 'task') {
      const d = parseDue(b, meta);
      if (d.error) return fail(d.error);
      // send-to-all: only „celý tým“ makes sense on every wall
      const a = teams.length > 1 && b.assign && b.assign !== 'all' ? { error: 'Úkol pro všechny týmy jde přidělit jen celému týmu.' } : parseAssign(b, team, players, actor);
      if (a.error) return fail(a.error);
      extra = { ...(d.due ? { due: d.due } : {}), ...(a.assign ? { assign: a.assign } : {}) };
    }
    const hs = await Promise.all(teams.map((x) => S.hgetall(key(x))));
    const full = teams.filter((x, i) => Object.keys(hs[i]).filter((f) => f.startsWith('s:')).length >= MAX_STICKERS);
    if (full.length === teams.length) return fail(`Nástěnka je plná (nejvýš ${MAX_STICKERS} lístečků).`);
    const sid = newId();
    const group = teams.length > 1 ? 'g' + newId() : null;
    const to = teams.filter((x) => !full.includes(x));
    const s = { id: sid, kind: b.kind, text: t.text, by, ts, ...(group ? { group } : {}), ...(ghost ? { ghost: true } : {}), ...extra };
    await Promise.all(to.map((x) => S.hset(key(x), 's:' + sid, s)));
    teams = to;
    return done({ id: sid, ...(group ? { group, teams: to, full } : {}), sticker: build({ ['s:' + sid]: s }, actor, ctxOf(meta))[0] || null });
  }

  if (!ID.test(id)) return fail(NOT_FOUND);
  const h = await S.hgetall(key(team));
  const s = h['s:' + id];
  // a student never learns that a ghost's sticker exists
  if (!s || !s.id || !canSee(s, actor)) return fail(NOT_FOUND);
  const author = dealer || isMine(s, actor);

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

  if (b.op === 'wallReact') {
    const code = REACT[b.emoji] ? b.emoji : REACT_BY_EMOJI[b.emoji];
    if (!code) return fail('Tuhle reakci neznám.');
    let target = id;
    if (b.reply != null && b.reply !== '') {
      const r = h[`r:${id}:${String(b.reply)}`];
      if (!r || !canSee(r, actor)) return fail('Odpověď nenalezena.');
      target = id + '.' + r.id;
    }
    const f = `x:${target}:${code}:${dealer ? 'dealer' : p.id}`;
    if (b.on === false) await S.hdel(key(team), f);
    else await S.hset(key(team), f, { ts, ...(ghost ? { ghost: true } : {}) });
    return done({ on: b.on !== false });
  }

  if (b.op === 'wallPin') {
    if (!author) return fail('Připnout může jen autor lístečku nebo MUP.', 403);
    const v = { on: b.on !== false, by, ts };
    await S.hset(key(team), 'p:' + id, v);
    return done({ pinned: v.on });
  }

  if (b.op === 'wallAccept') {
    if (s.kind !== 'q') return fail('Odpověď jde označit jen u otázky.');
    if (!author) return fail('Odpověď může označit jen ten, kdo se ptal, nebo MUP.', 403);
    let reply = null;
    if (b.reply != null && b.reply !== '') {
      const r = h[`r:${id}:${String(b.reply)}`];
      if (!r || !canSee(r, actor)) return fail('Odpověď nenalezena.');
      reply = r.id;
    }
    await S.hset(key(team), 'a:' + id, { reply, by, ts });
    return done({ accepted: reply });
  }

  if (b.op === 'wallTask') {
    if (s.kind !== 'task') return fail('Termín a řešitele jde nastavit jen u úkolu.');
    if (!author) return fail('Upravit úkol může jen jeho autor nebo MUP.', 403);
    const cur = h['m:' + id] || { due: s.due || null, assign: s.assign || null };
    let due = cur.due || null, assign = cur.assign || null;
    if ('due' in b) { const d = parseDue(b, meta); if (d.error) return fail(d.error); due = d.due; }
    if ('assign' in b) { const a = parseAssign(b, team, players, actor); if (a.error) return fail(a.error); assign = a.assign; }
    await S.hset(key(team), 'm:' + id, { due, assign, by, ts });
    return done({ due: pubDue(due), assign });
  }

  if (b.op === 'wallDelete') {
    if (b.reply != null && b.reply !== '') {
      const f = `r:${id}:${String(b.reply)}`;
      const r = h[f];
      if (!r || !canSee(r, actor)) return fail('Odpověď nenalezena.');
      if (!dealer && !isMine(r, actor)) return fail('Smazat můžeš jen svůj lísteček nebo svou odpověď.', 403);
      const xs = Object.keys(h).filter((x) => x.startsWith(`x:${id}.${r.id}:`));
      await S.hset(key(team), `t:${id}.${r.id}`, { ts });
      for (const x of [f, ...xs]) await S.hdel(key(team), x);
      return done({ deleted: f });
    }
    if (!dealer && !isMine(s, actor)) return fail('Smazat můžeš jen svůj lísteček nebo svou odpověď.', 403);
    const fields = ['s:' + id, ...Object.keys(h).filter((f) => stickerOf(f) === id && f !== 's:' + id && !f.startsWith('t:'))];
    // the tombstone goes in first: a restore running in between still sees it
    await S.hset(key(team), 't:' + id, { ts });
    for (const f of fields) await S.hdel(key(team), f);
    return done({ deleted: 's:' + id, removed: fields.length });
  }
  return fail('Neznámá akce.');
}

// the sticker id a field belongs to (null for unknown fields)
const FIELD = /^(?:([sdpam]):([\w-]+)|r:([\w-]+):([\w-]+)|x:([\w-]+)(?:\.([\w-]+))?:(\w+):([\w-]+)|t:([\w-]+)(?:\.([\w-]+))?)$/;
function parse(f) {
  const m = FIELD.exec(f);
  if (!m) return null;
  if (m[1]) return { type: m[1], sid: m[2] };
  if (m[3]) return { type: 'r', sid: m[3], rid: m[4] };
  if (m[5]) return REACT[m[7]] ? { type: 'x', sid: m[5], rid: m[6] || null } : null;
  return { type: 't', sid: m[9], rid: m[10] || null };
}
function stickerOf(f) { const x = parse(f); return x ? x.sid : null; }

// ---------- dump / restore / data view / reset ----------
export async function dumpWalls(meta) {
  const ids = teamIds(meta);
  const hs = await Promise.all(ids.map((t) => S.hgetall(key(t))));
  const out = {};
  ids.forEach((t, i) => { if (Object.keys(hs[i]).length) out[t] = hs[i]; });
  return out;
}

// Merge a dump's walls in: missing fields are added; done / pin / accepted / task details only replace an older one.
// Tombstones (t:) win: a sticker or reply deleted after it was created is never brought back, and a dump's
// newer tombstone deletes what the server still has. Old dumps without `walls` simply restore nothing here.
export async function restoreWalls(walls, ids) {
  if (!walls || typeof walls !== 'object') return 0;
  let n = 0;
  for (const [t, map] of Object.entries(walls)) {
    if (!ids.includes(t) || !map || typeof map !== 'object') continue;
    const cur = await S.hgetall(key(t));
    const tomb = {};
    const tsOf = (v) => Number(v?.ts) || 0;
    for (const src of [cur, map]) {
      for (const [f, v] of Object.entries(src)) {
        if (!f.startsWith('t:') || !v || typeof v !== 'object') continue;
        const k = f.slice(2);
        tomb[k] = Math.max(tomb[k] || 0, tsOf(v));
      }
    }
    // the sticker's creation time (the dump's copy or the server's): a tombstone older than that is stale
    const born = (sid) => tsOf(map['s:' + sid] || cur['s:' + sid]);
    const dead = (x) => {
      if (tomb[x.sid] != null && tomb[x.sid] >= born(x.sid)) return true;
      if (x.rid && tomb[x.sid + '.' + x.rid] != null) {
        const r = map[`r:${x.sid}:${x.rid}`] || cur[`r:${x.sid}:${x.rid}`];
        return tomb[x.sid + '.' + x.rid] >= tsOf(r);
      }
      return false;
    };
    for (const [f, v] of Object.entries(map)) {
      const x = parse(f);
      if (!x || !v || typeof v !== 'object') continue;
      if (x.type === 't') {
        if (tsOf(cur[f]) >= tsOf(v)) continue;
      } else if (dead(x)) continue;
      else if ('dpam'.includes(x.type)) {
        const c = cur[f];
        if (c && tsOf(c) >= tsOf(v)) continue;
      } else if (f in cur) continue;
      await S.hset(key(t), f, v);
      n++;
    }
    // the dump knows about deletions the server missed (its tombstone is newer than the server's sticker)
    for (const f of Object.keys(cur)) {
      const x = parse(f);
      if (x && x.type !== 't' && dead(x)) { await S.hdel(key(t), f); n++; }
    }
  }
  return n;
}

export async function dataWalls(meta) {
  const ids = teamIds(meta);
  const hs = await Promise.all(ids.map((t) => S.hgetall(key(t))));
  const out = {};
  const ctx = ctxOf(meta);
  ids.forEach((t, i) => { out[t] = build(hs[i], { role: 'dealer' }, ctx); });
  return out;
}

export async function clearWalls(meta) {
  await Promise.all(teamIds(meta).map((t) => S.del(key(t))));
}
