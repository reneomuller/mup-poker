// Pure game rules: stakes ledger, limits, validation, settlement.
export const CFG = {
  START_VALUATION: 1_000_000, // pre-money of every team at the start (dealer can change it before the first showdown)
  FOUNDER_SHARES: 1_000_000,
  STUDENT_CAPITAL: 1_000_000,
  RJ_CAPITAL: 10_000_000,
  STUDENT_CASHOUT: 300_000,
  RJ_CASHOUT_PCT: 0.3,
  MAX_BLOCK: 5,
};
export const RJ = 'rj';
const COLORS = ['#E8505B', '#F39C34', '#E9C046', '#3BB273', '#3A8DDE', '#9B6BE0'];

export function newMeta(teams, startV) {
  teams = teams || COLORS.map((c, i) => ({ id: 't' + (i + 1), name: 'Tým ' + (i + 1), color: c }));
  startV = startV > 0 ? startV : CFG.START_VALUATION;
  const S = {}, P = {};
  for (const t of teams) { S[t.id] = CFG.FOUNDER_SHARES; P[t.id] = startV / CFG.FOUNDER_SHARES; }
  const m = {
    v: 1, teams, startV, block: 1, phase: 'lobby', presenting: null,
    timerEnd: null, timerTotal: 0, timerLabel: '', regOpen: true, screen: 'table',
    ledger: { S, P, H: {} }, history: [], reveal: null, settled: {}, seq: 0,
    gid: Math.random().toString(36).slice(2, 10), rev: 1, removed: [],
  };
  m.history.push(snapshot(m, 'Start'));
  return m;
}

export const valuation = (m, t) => m.ledger.P[t] * m.ledger.S[t];

export function snapshot(m, label) {
  const V = {};
  for (const t of m.teams) V[t.id] = Math.round(valuation(m, t.id));
  return { ts: Date.now(), label, block: m.block, V };
}

export function stakes(m, inv) {
  const h = m.ledger.H[inv] || {};
  const r = {};
  for (const t of m.teams) r[t.id] = (h[t.id] || 0) * m.ledger.P[t.id];
  return r;
}

export const portfolio = (m, inv) => Object.values(stakes(m, inv)).reduce((a, b) => a + b, 0);

export function hasHoldings(m, inv) {
  const h = m.ledger.H[inv];
  return !!h && Object.values(h).some((s) => s > 1e-9);
}

// Money split between the class and RJ, per team, at current prices.
export function raised(m) {
  const out = {};
  for (const t of m.teams) out[t.id] = { cls: 0, rj: 0 };
  for (const [inv, h] of Object.entries(m.ledger.H)) {
    for (const [t, sh] of Object.entries(h)) {
      if (!out[t]) continue;
      const val = sh * m.ledger.P[t];
      if (inv === RJ) out[t].rj += val; else out[t].cls += val;
    }
  }
  return out;
}

export function rules(m, inv) {
  const isRJ = inv === RJ;
  if (!hasHoldings(m, inv)) {
    return { mode: 'initial', capital: isRJ ? CFG.RJ_CAPITAL : CFG.STUDENT_CAPITAL, cashoutMax: 0 };
  }
  const pv = portfolio(m, inv);
  const cap = isRJ ? Math.floor((pv * CFG.RJ_CASHOUT_PCT) / 1000) * 1000 : CFG.STUDENT_CASHOUT;
  return { mode: 'rebalance', capital: 0, cashoutMax: Math.min(cap, Math.floor(pv)) };
}

const fmt = (n) => Math.round(n).toLocaleString('cs-CZ').replace(/ /g, ' ') + ' $';

function clean(x, ids) {
  const out = {};
  if (!x || typeof x !== 'object') return out;
  for (const t of ids) {
    const e = x[t];
    if (!e) continue;
    const amt = Math.round(Number(e.amt) || 0);
    if (amt <= 0) continue;
    out[t] = { amt, why: String(e.why || '').trim().slice(0, 600) };
  }
  return out;
}

export function validate(m, inv, ownTeam, raw) {
  const ids = m.teams.map((t) => t.id);
  const name = (t) => m.teams.find((x) => x.id === t)?.name || t;
  const r = rules(m, inv);
  const out = r.mode === 'initial' ? {} : clean(raw?.out, ids);
  const inn = clean(raw?.in, ids);
  const errors = [];
  const st = stakes(m, inv);
  let outTotal = 0, inTotal = 0;
  for (const [t, e] of Object.entries(out)) {
    outTotal += e.amt;
    if (e.amt > st[t] + 1) errors.push(`Z týmu ${name(t)} můžeš vybrat nejvýš ${fmt(st[t])}.`);
  }
  for (const [t, e] of Object.entries(inn)) {
    inTotal += e.amt;
    if (t === ownTeam) errors.push('Do vlastního týmu investovat nemůžeš.');
    if (out[t]) errors.push(`Z týmu ${name(t)} nemůžeš ve stejném bloku vybírat a zároveň do něj vkládat.`);
  }
  if (r.mode === 'initial') {
    if (inTotal !== r.capital) errors.push(`Rozděl přesně ${fmt(r.capital)} (zatím ${fmt(inTotal)}).`);
  } else {
    if (outTotal > r.cashoutMax) errors.push(`V tomto bloku můžeš vybrat nejvýš ${fmt(r.cashoutMax)}.`);
    if (inTotal !== outTotal) errors.push(`Vlož přesně tolik, kolik vybíráš (${fmt(outTotal)}).`);
  }
  return { ok: errors.length === 0, errors, out, in: inn, outTotal, inTotal, mode: r.mode };
}

// Trades happen at the block's fixed prices: selling cancels shares, buying issues new ones.
export function apply(m, inv, v) {
  const L = m.ledger;
  const h = L.H[inv] || (L.H[inv] = {});
  const delta = {};
  for (const [t, e] of Object.entries(v.out)) {
    const sh = Math.min(h[t] || 0, e.amt / L.P[t]);
    h[t] = (h[t] || 0) - sh;
    if (h[t] < 1e-9) h[t] = 0;
    L.S[t] -= sh;
    delta[t] = (delta[t] || 0) - sh * L.P[t];
  }
  for (const [t, e] of Object.entries(v.in)) {
    const sh = e.amt / L.P[t];
    h[t] = (h[t] || 0) + sh;
    L.S[t] += sh;
    delta[t] = (delta[t] || 0) + e.amt;
  }
  return delta;
}

export function revalue(m, newV) {
  for (const t of m.teams) {
    const v = Math.round(Number(newV[t.id]));
    if (Number.isFinite(v) && v > 0) m.ledger.P[t.id] = v / m.ledger.S[t.id];
  }
}
