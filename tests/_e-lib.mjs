// Shared helpers for agent E's independent v2 suites (written from docs/V2-SPEC.md, not from the server code).
// Output contract (run-all.sh counts these): "ok   …" = pass, "FAIL …" = failure, "WARN …" = spec ambiguity / soft finding.
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE = process.env.BASE || 'http://localhost:3105/api/game';
export const MODE = process.env.E_MODE || 'mem'; // storage mode of the server under test: mem | pg | redis
export const MOCK_PORT = Number(process.env.MOCK_PORT || 8089);
export const MOCK_URL = process.env.MOCK_URL || (MODE === 'redis' ? `http://localhost:${MOCK_PORT}` : '');
export const PG_URL = process.env.E_PG_URL || 'postgres://postgres:pw@localhost:5432/mup_e';
export const DH = { 'x-dealer': 'mup-dealer' };
export const FS = 1_000_000;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const sumAmt = (m) => sum(Object.values(m || {}).map((e) => Number(e?.amt) || 0));
export const OFF = 'Tato funkce je vypnutá.';
export const FEATURE_DEFAULTS = { captable: true, cards: true, drivers: true, track: true, quiz: true, points: true, rounds: false, market: false, tranches: false, exit: false, wall: true, demand: true, startupPage: true, quizplus: true, wallplus: true, recap: true, regie: true, sound: true, guard: true, tape: true, tapeNames: initials };
export const ALL_ON = Object.fromEntries(Object.keys(FEATURE_DEFAULTS).map((k) => [k, true]));
export const REASON_LABELS = { milestone: 'Splněný milník', traction: 'Trakce', team: 'Tým', risk: 'Riziko', market: 'Trh', other: 'Jiné' };
export const MILESTONES = [
  ['m1a', 'Potvrzený problém a one-liner', 1], ['m1b', 'Tři nejrizikovější předpoklady', 1], ['m2a', 'Byznys model v2', 2],
  ['m2b', 'Přehled konkurence', 2], ['m2c', 'Memo s důkazy', 2], ['m2d', 'MVP brief', 2], ['m3a', 'MVP na veřejné adrese', 3],
  ['m4a', 'Růstový motor běží', 4], ['m5a', 'Byznys model a pitch', 5],
];
export const TEAM_NAMES = ['Lumio', 'Parkly', 'Tutorix', 'GreenBox', 'Hrajsport', 'Vetly'];

// ---------- result counting ----------
let pass = 0, fail = 0, warn = 0;
const fails = [];
export function ok(c, m) {
  if (c) { pass++; console.log('ok   ' + m); } else { fail++; fails.push(m); console.log('FAIL ' + m); }
  return !!c;
}
export function warnIf(c, m) { if (!c) { warn++; console.log('WARN ' + m); } return !!c; }
export function info(m) { console.log('info ' + m); }
export function section(m) { console.log('\n== ' + m); }
export function counts() { return { pass, fail, warn }; }
export function done() {
  console.log(`\nSUMMARY pass=${pass} fail=${fail} warn=${warn}`);
  if (fails.length) console.log('FAILED CHECKS:\n  - ' + [...new Set(fails)].slice(0, 60).join('\n  - '));
  process.exit(fail ? 1 : 0);
}
// run a suite body, turning crashes into a counted failure instead of a silent stop
export async function main(fn) {
  try { await fn(); } catch (e) { ok(false, 'suite crashed: ' + (e?.stack || e)); }
  await stopAll();
  done();
}

// ---------- HTTP client ----------
export function client(base = BASE) {
  async function req(method, body, headers = {}, q = '') {
    let r, text;
    try {
      r = await fetch(base + q, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
      text = await r.text();
    } catch (e) { return mark({ ok: false, error: 'network: ' + e.message }, 0, ''); }
    let j;
    try { j = JSON.parse(text); } catch { j = { ok: false, error: 'non-JSON ' + r.status + ': ' + text.slice(0, 200) }; }
    return mark(j, r.status, text);
  }
  function mark(j, status, text) {
    if (j && typeof j === 'object') {
      Object.defineProperty(j, '_status', { value: status, enumerable: false });
      Object.defineProperty(j, '_raw', { value: text, enumerable: false });
    }
    return j;
  }
  const c = {
    base,
    get: (q = '', h = {}) => req('GET', null, h, q),
    post: (b, h = {}) => req('POST', b, h),
    dealer: (op, x = {}) => req('POST', { op, ...x }, DH),
    dget: (q = '') => req('GET', null, DH, q),
    me: (s) => req('GET', null, { 'x-sid': s.sid, 'x-pin': s.pin }),
    st: (s, op, x = {}) => req('POST', { op, ...x, sid: s.sid, pin: s.pin }),
    async dump() { const d = await req('GET', null, DH, '?view=dealer&dump=1'); return d?.dealer?.dump || null; },
    async meta() { return (await c.dump())?.meta || null; },
  };
  return c;
}

// ---------- servers, storage ----------
const children = new Set();
const STORE_VARS = /^(KV_|UPSTASH_|DATABASE_URL|POSTGRES_|NEON_|MUP_PG_LOCAL)|(DATABASE_URL|POSTGRES_URL)/;
export function storageEnv(mode) {
  const pg = { MUP_PG_LOCAL: '1', DATABASE_URL: PG_URL };
  if (mode === 'pg') return pg;
  if (mode === 'redis') return { ...pg, UPSTASH_REDIS_REST_URL: `http://localhost:${MOCK_PORT}`, UPSTASH_REDIS_REST_TOKEN: 'test-token' };
  return {};
}
function cleanEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!STORE_VARS.test(k)) env[k] = v;
  return { ...env, ...extra };
}
// Start "node dev-server.js <tag>" in cwd; resolves when the static site answers (so the first /api/game hit is ours).
export async function startServer({ port, tag, cwd = ROOT, mode = 'mem', env = {} }) {
  try { execSync(`pkill -f "^node dev-server.js ${tag}$"`); } catch {}
  const child = spawn('node', ['dev-server.js', tag], { cwd, env: cleanEnv({ ...storageEnv(mode), ...env, PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  children.add(child);
  const srv = {
    child, port, tag, base: `http://localhost:${port}/api/game`, log: () => log,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(50);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      try { execSync(`pkill -f "^node dev-server.js ${tag}$"`); } catch {}
      children.delete(child);
      await sleep(150);
    },
  };
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`server ${tag} exited: ${log.slice(-800)}`);
    try { const r = await fetch(`http://localhost:${port}/`); await r.text(); return srv; } catch {}
    await sleep(100);
  }
  throw new Error(`server ${tag} did not start: ${log.slice(-800)}`);
}
export async function startMock(port = MOCK_PORT) {
  const child = spawn('node', [path.join(ROOT, 'tests/mock-upstash.mjs')], { env: cleanEnv({ MOCK_PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://localhost:${port}/__stats`); break; } catch {}
    await sleep(100);
  }
  return {
    child, port, url: `http://localhost:${port}`,
    flush: () => fetch(`http://localhost:${port}/__flush`).then((r) => r.text()),
    stats: () => fetch(`http://localhost:${port}/__stats`).then((r) => r.json()),
    resetStats: () => fetch(`http://localhost:${port}/__stats/reset`).then((r) => r.text()),
    async stop() { child.kill('SIGTERM'); children.delete(child); await sleep(100); },
  };
}
export function wipePg() {
  execSync(`PGPASSWORD=pw psql -q -h localhost -U postgres -d mup_e -c 'drop table if exists mup_kv, mup_h, mup_log'`, { stdio: 'pipe' });
}
export function pgQuery(sql) {
  return execSync(`PGPASSWORD=pw psql -h localhost -U postgres -d mup_e -At -c "${sql.replace(/"/g, '\\"')}"`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}
export async function stopAll() {
  for (const ch of children) { try { ch.kill('SIGTERM'); } catch {} }
  children.clear();
}
export async function mockStats() {
  if (!MOCK_URL) return null;
  try { return await (await fetch(MOCK_URL + '/__stats')).json(); } catch { return null; }
}
export async function mockResetStats() { if (MOCK_URL) { try { await fetch(MOCK_URL + '/__stats/reset'); } catch {} } }
export async function mockFlush() { if (MOCK_URL) return (await fetch(MOCK_URL + '/__flush')).text(); return null; }

// ---------- JSON hygiene ----------
// Keys whose values (or whose children, for maps) must be finite numbers whenever present.
const NUMERIC = new Set(['V', 'cls', 'rj', 'live', 'value', 'portfolio', 'returnPct', 'founders', 'investors', 'pct', 'delta', 'multiple', 'amt', 'total',
  'quizPoints', 'of', 'capital', 'invested', 'locked', 'available', 'pre', 'prev', 'startV', 'cashoutMax', 'betCount', 'playerCount',
  'shares', 'price', 'ms', 'answered', 'sizeKB', 'idx', 'seq', 'start', 'from', 'to', 'n']);
const NUMERIC_MAPS = new Set(['V', 'F', 'stakes', 'delta', 'holdings', 'effects', 'teams', 'counts', 'v', 'P', 'S']);
export function badNumbers(obj, maxReport = 10) {
  const bad = [];
  const walk = (x, p, key, parentKey) => {
    if (bad.length >= maxReport) return;
    if (typeof x === 'number') { if (!Number.isFinite(x)) bad.push(p + '=' + x); return; }
    if (x === null) { if (NUMERIC.has(key) || NUMERIC_MAPS.has(parentKey)) bad.push(p + '=null'); return; }
    if (typeof x === 'string') { if (/\bNaN\b|\bInfinity\b|undefined \$|NaN \$/.test(x)) bad.push(p + '="' + x.slice(0, 40) + '"'); return; }
    if (Array.isArray(x)) { x.forEach((y, i) => walk(y, p + '[' + i + ']', key, parentKey)); return; }
    if (typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (k === 'content' || k === 'texts') continue; walk(v, p + '.' + k, k, key); }
  };
  walk(obj, '$', '', '');
  return bad;
}
export function checkClean(label, ...objs) {
  const bad = [];
  for (const o of objs) {
    if (!o) continue;
    if (o._raw && /\bNaN\b|\bInfinity\b/.test(o._raw.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) bad.push('raw NaN/Infinity token');
    bad.push(...badNumbers(o));
  }
  return ok(bad.length === 0, `${label}: no NaN/Infinity/null numbers${bad.length ? ' → ' + bad.slice(0, 5).join(', ') : ''}`);
}
export const findKey = (obj, key) => {
  const hits = [];
  const walk = (x, p) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach((y, i) => walk(y, p + '[' + i + ']'));
    for (const [k, v] of Object.entries(x)) { if (k === key) hits.push(p + '.' + k); walk(v, p + '.' + k); }
  };
  walk(obj, '$');
  return hits;
};

// ---------- shapes ----------
const typeOk = (v, t) => t.split('|').some((tt) => {
  if (tt === 'null') return v === null;
  if (tt === 'array') return Array.isArray(v);
  if (tt === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  if (tt === 'int') return Number.isInteger(v);
  if (tt === 'any') return v !== undefined;
  return typeof v === tt;
});
// spec: { key: 'number' | 'string|null' | ... }. Missing/mistyped keys fail; extra keys are reported as WARN when strict.
export function shape(label, obj, spec, { strict = false, quiet = false } = {}) {
  if (!obj || typeof obj !== 'object') return ok(false, `${label}: is an object (got ${JSON.stringify(obj)?.slice(0, 80)})`);
  const errs = [];
  for (const [k, t] of Object.entries(spec)) if (!typeOk(obj[k], t)) errs.push(`${k}:${t} got ${JSON.stringify(obj[k])?.slice(0, 60)}`);
  if (strict) {
    const extra = Object.keys(obj).filter((k) => !(k in spec));
    if (extra.length) warnIf(false, `${label}: extra keys not in spec: ${extra.join(', ')}`);
  }
  if (quiet && !errs.length) return true;
  return ok(errs.length === 0, `${label}: shape${errs.length ? ' → ' + errs.slice(0, 6).join('; ') : ''}`);
}
export const round1 = (x) => Math.round(x * 10) / 10;

// ---------- game setup ----------
export async function freshGame(c, { n = 18, ghost = true, features = null, parallel = false, names = 'Student' } = {}) {
  await c.dealer('reset', { confirm: 'RESET', keepPlayers: false });
  if (features) await c.dealer('features', { set: features });
  let st = await c.get();
  const T = st.teams.map((t) => t.id);
  await c.dealer('teams', { teams: T.map((id, i) => ({ id, name: TEAM_NAMES[i] || id })) });
  await c.dealer('reg', { open: true });
  const mk = async (i) => {
    const team = T[i % T.length], pin = String(2000 + i);
    const r = await c.post({ op: 'register', name: `${names} ${i + 1}`, team, pin });
    return { sid: r.sid, pin, team, name: `${names} ${i + 1}`, ok: r.ok, err: r.error };
  };
  let S;
  if (parallel) S = await Promise.all(Array.from({ length: n }, (_, i) => mk(i)));
  else { S = []; for (let i = 0; i < n; i++) S.push(await mk(i)); }
  const bad = S.filter((s) => !s.ok);
  if (bad.length) ok(false, `register ${n} students (${bad.length} failed: ${bad[0].err})`);
  let G = null;
  if (ghost) {
    const g = await c.dealer('ghost', { team: T[1] });
    G = { sid: g.sid, pin: g.pin, team: T[1], name: 'Ghost', ok: g.ok };
  }
  return { T, S, G };
}

// deterministic pseudo-random
export function rng(seed = 7) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

// a valid initial slip: exactly `capital` into teams other than own (2–3 teams)
export function initialSlip(T, own, i, capital = 1_000_000, tag = '') {
  const others = T.filter((t) => t !== own);
  const a = others[i % others.length], b = others[(i + 2) % others.length], c3 = others[(i + 3) % others.length];
  const x = Math.round((capital * (0.3 + 0.05 * (i % 5))) / 10000) * 10000;
  const y = Math.round(((capital - x) * 0.6) / 10000) * 10000;
  const inn = { [a]: { amt: x, why: `Důvod A ${tag}${i}` }, [b]: { amt: y, why: `Důvod B ${tag}${i}` }, [c3]: { amt: capital - x - y, why: '' } };
  return { in: inn, notes: { [a]: { like: `Líbí ${tag}${i}`, doubt: `Pochybuji ${tag}${i}` } } };
}
// a valid rebalance slip: exactly `amount` out of the largest stakes, the same amount in elsewhere (never own team, never a team it takes out of)
export function rebalanceSlip(T, own, stakes, i, amount = 300_000, tag = '') {
  const held = Object.entries(stakes || {}).filter(([t, v]) => v > 1).sort((a, b) => b[1] - a[1]);
  const out = {};
  let left = amount;
  for (const [t, v] of held) {
    if (left <= 0) break;
    const take = Math.min(left, Math.floor(v));
    if (take <= 0) continue;
    out[t] = { amt: take, why: `Ven ${tag}${i}` };
    left -= take;
  }
  if (left > 0) return null;
  const targets = T.filter((t) => t !== own && !out[t]);
  const inn = {};
  if (!targets.length) return null;
  const a = targets[i % targets.length], b = targets[(i + 1) % targets.length];
  if (a === b) inn[a] = { amt: amount, why: `Dovnitř ${tag}${i}` };
  else { const x = Math.round((amount * 0.6) / 10000) * 10000; inn[a] = { amt: x, why: `Dovnitř ${tag}${i}` }; inn[b] = { amt: amount - x, why: '' }; }
  return { out, in: inn };
}

// ---------- invariants (spec §11 + ghost rule) ----------
// ctx: { S: students, G: ghost|null, n: student count }
export async function invariants(c, ctx, label, { quiet = true } = {}) {
  const [pub, d] = await Promise.all([c.get(), c.dget('?view=dealer&dump=1')]);
  const dump = d?.dealer?.dump;
  const meta = dump?.meta;
  const mes = await Promise.all([...ctx.S.slice(0, 3), ...(ctx.G ? [ctx.G] : [])].map((s) => c.me(s)));
  let good = true;
  const t = (cnd, m) => { if (!cnd) { good = false; ok(false, `[${label}] ${m}`); } return cnd; };
  // NaN
  const bad = [...badNumbers(pub), ...mes.flatMap((m) => badNumbers(m)), ...badNumbers(d?.dealer || {})];
  t(bad.length === 0, 'no NaN/Infinity/null numbers in GET responses: ' + bad.slice(0, 5).join(', '));
  if (!meta || !pub?.teams) { t(false, 'state + dump readable'); return { pub, dump, meta }; }
  // money conservation: S[t] = founders + Σ holdings; V = P·S; cls + rj + founders value ≈ V
  const L = meta.ledger;
  for (const tm of meta.teams) {
    const id = tm.id;
    let held = 0;
    for (const h of Object.values(L.H)) held += h[id] || 0;
    t(Math.abs(L.S[id] - (FS + held)) < 1e-3, `shares conserved for ${id}: S=${L.S[id]} founders+held=${FS + held}`);
    const pt = pub.teams.find((x) => x.id === id);
    const V = L.P[id] * L.S[id];
    t(Math.abs(pt.V - V) <= 1, `${id}: public V ${pt.V} = P·S ${Math.round(V)}`);
    t(Math.abs(pt.cls + pt.rj + FS * L.P[id] - V) <= 3, `${id}: class ${pt.cls} + RJ ${pt.rj} + founders ${Math.round(FS * L.P[id])} = V ${Math.round(V)}`);
    // ghost never holds anything
    if (ctx.G) t(!(L.H[ctx.G.sid]?.[id] > 1e-9), `ghost holds no shares of ${id}`);
    // cap table
    if (pub.features?.captable !== false && pt.cap) {
      const cap = pt.cap;
      t(Math.abs(cap.founders - round1((FS / L.S[id]) * 100)) <= 0.051, `${id}: cap.founders ${cap.founders} = ${round1((FS / L.S[id]) * 100)}`);
      t(Math.abs(cap.founders + cap.cls + cap.rj - 100) <= 0.25, `${id}: cap sums to 100 (${cap.founders}+${cap.cls}+${cap.rj})`);
      const inv = Object.entries(L.H).filter(([k, h]) => k !== 'rj' && !dump.players?.[k]?.ghost && (h[id] || 0) > 1e-9).length;
      t(cap.investors === inv, `${id}: cap.investors ${cap.investors} = ${inv} distinct non-ghost holders`);
    }
  }
  // ghosts excluded
  const gname = ctx.G ? 'Ghost' : null;
  if (ctx.G) {
    const lists = [['players', pub.players], ['leaders', pub.leaders], ['points.leaders', pub.points?.leaders], ['quiz.leaders', pub.quiz?.leaders],
      ['awards', pub.awards], ['exit.ranking', pub.exit?.ranking]];
    for (const [nm, l] of lists) if (Array.isArray(l)) t(!l.some((x) => x?.name === gname || x?.id === ctx.G.sid), `ghost absent from ${nm}`);
    if (pub.contrarian) t(pub.contrarian.name !== gname, 'ghost is not the contrarian');
    const gp = (meta.points || []).filter((e) => e.playerId === ctx.G.sid);
    t(gp.length === 0, 'ghost has no points ledger entries');
  }
  t(pub.playerCount === ctx.S.length, `playerCount ${pub.playerCount} = ${ctx.S.length} (ghost excluded)`);
  // rebalance: exactly 300k out and in for every submitted student slip of this block (when the student held stakes at block start)
  // (checked from the dump's slips; rules.mode at submit time is not known here, so only blocks >1 for students with ≥1 earlier block)
  // points: totals in public lists agree with the ledger
  if (Array.isArray(meta.points) && pub.points?.leaders) {
    const tot = {};
    for (const e of meta.points) tot[e.playerId] = (tot[e.playerId] || 0) + e.amt;
    for (const l of pub.points.leaders) {
      const p = Object.values(dump.players).find((x) => x.name === l.name);
      if (p) t(tot[p.id] === l.total, `points leader ${l.name} total ${l.total} = ledger ${tot[p.id]}`);
    }
    const sorted = pub.points.leaders.every((x, i, a) => i === 0 || a[i - 1].total >= x.total);
    t(sorted, 'points leaders sorted by total desc');
  }
  // RJ fund bookkeeping
  if (pub.rjFund) {
    const f = pub.rjFund;
    const lockedSum = (meta.tranches || []).filter((x) => x.status === 'locked').reduce((a, x) => a + x.amt, 0);
    t(f.capital === 10_000_000, 'rjFund.capital = 10M');
    t(Math.abs(f.locked - lockedSum) <= 1, `rjFund.locked ${f.locked} = Σ locked tranches ${lockedSum}`);
    t(Math.abs(f.available - (f.capital - f.invested - f.locked)) <= 1, `rjFund.available ${f.available} = capital − invested − locked`);
    if (meta.rjPrincipal !== undefined) t(Math.abs(f.invested - meta.rjPrincipal) <= 1, `rjFund.invested ${f.invested} = meta.rjPrincipal ${meta.rjPrincipal}`);
  }
  // no PIN hashes anywhere public
  t(!/"pin"\s*:/.test(pub._raw || ''), 'no PIN hashes in public state');
  if (good && !quiet) ok(true, `[${label}] invariants`);
  if (good && quiet) ok(true, `[${label}] invariants hold`);
  return { pub, dump, meta, mes };
}

// ---------- quiz helpers ----------
export const quizScore = (ms, time) => Math.min(1000, Math.max(500, Math.round(1000 * (1 - (0.5 * ms) / (time * 1000)))));
// all students answer at once; returns the responses
export function answerAll(c, students, choiceOf) {
  return Promise.all(students.map((s, i) => c.st(s, 'quizAnswer', { choice: choiceOf(s, i) })));
}
export const ledgerTotal = (meta, sid) => (meta?.points || []).filter((e) => e.playerId === sid).reduce((a, e) => a + e.amt, 0);
// JSON with object keys sorted (hash refills from Postgres may return fields in another order)
export const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((kk) => [kk, v[kk]])) : v));
