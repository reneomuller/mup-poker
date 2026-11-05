// Shared helpers for the server tests (tests/a-*.mjs).
export const BASE = process.env.BASE || 'http://localhost:3101/api/game';
export const D = { 'x-dealer': 'mup-dealer' };

export function client(base = BASE) {
  const post = async (b, h = {}) => {
    const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...D, ...h }, body: JSON.stringify(b) });
    return r.json();
  };
  const spost = async (b) => {
    const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    return r.json();
  };
  const get = async (q = '', h = {}) => (await fetch(base + q, { headers: { ...D, ...h } })).json();
  const rawGet = async (q = '', h = {}) => (await fetch(base + q, { headers: { ...D, ...h } })).text();
  const me = (s, q = '') => get(q, { 'x-sid': s.sid, 'x-pin': s.pin });
  return { post, spost, get, rawGet, me, dealer: (op, x = {}) => post({ op, ...x }) };
}

let fails = 0, passes = 0;
export function ok(c, m) {
  if (c) { passes++; console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); process.exitCode = 1; }
  return !!c;
}
export function done(name) {
  console.log(`${name}: ${passes} passed, ${fails} failed`);
  console.log(fails ? `${fails} FAILED` : 'ALL OK');
}
export const sum = (a) => a.reduce((x, y) => x + y, 0);

// Every number in a JSON text must be finite: JSON turns NaN/Infinity into null, so look for nulls
// on keys that must always hold numbers.
const NUM_KEYS = new Set(['V', 'cls', 'rj', 'live', 'founders', 'investors', 'value', 'returnPct', 'portfolio', 'start', 'delta',
  'pct', 'pre', 'prev', 'amt', 'capital', 'invested', 'locked', 'available', 'total', 'quizPoints', 'runPoints', 'myPoints',
  'multiple', 'answered', 'startV', 'betCount', 'playerCount', 'founderPct', 'S', 'ms', 'now', 'serverNow', 'seq', 'idx']);
export function badNumbers(obj, path = '', out = []) {
  if (typeof obj === 'number' && !Number.isFinite(obj)) out.push(path);
  if (obj === null) { const k = path.split('.').pop(); if (NUM_KEYS.has(k) && !path.startsWith('content.')) out.push(path); }
  else if (Array.isArray(obj)) obj.forEach((x, i) => badNumbers(x, path + '.' + i, out));
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) badNumbers(v, path ? path + '.' + k : k, out);
  if (path === '') for (const [k, v] of Object.entries(obj?.stakes || {})) if (!Number.isFinite(v)) out.push('stakes.' + k);
  return out;
}
export const noNaNText = (t) => !/NaN|Infinity/.test(t);

export async function register(c, n, teams, prefix = 'Student') {
  const out = [];
  for (let i = 0; i < n; i++) {
    const team = teams[i % teams.length], pin = String(1000 + i);
    const r = await c.spost({ op: 'register', name: `${prefix} ${i + 1}`, team, pin });
    out.push({ sid: r.sid, pin, team, name: `${prefix} ${i + 1}` });
  }
  return out;
}

// First-round slip: exactly 1M split over two other teams
export function firstSlip(s, teams, i) {
  const o = teams.filter((t) => t !== s.team);
  const a = o[i % o.length], b = o[(i + 2) % o.length];
  return { [a]: { amt: 600000, why: 'Silný tým ' + i }, [b]: { amt: 400000, why: '' } };
}
