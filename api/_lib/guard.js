// v4 guard: PIN / login-token brute-force protection and idempotent student writes (`rid`).
//
// Cost rule: a request that passes costs ZERO extra storage commands. Only a failed attempt counts
// (INCR + EXPIRE per player and per IP), and the lock itself lives in the player record (`p.lock`),
// which every request already has in memory, so checking it is free.
//
// - 8 failed PIN / token tries per player in 10 minutes lock that player (even the right PIN is refused)
//   until the window is over, or until the dealer's resetPin / loginLink clears it. A valid one-time
//   login link (tokenLogin) always works and clears the lock too.
// - 30 failed tries per IP (x-forwarded-for, first hop) in 10 minutes: from then on every further
//   failed try from that IP locks the player it was aimed at. Right PINs from the same IP keep working,
//   so a class behind one school NAT is never locked out as a whole.
// - Limits: MUP_GUARD_MAX (player, 8), MUP_GUARD_IP_MAX (IP, 30), MUP_GUARD_WINDOW_S (600).
// - `rid` (request id from the phone's retry queue, public/play-net.js): the same sid:rid runs once.
//   Without a rid nothing is read or written.
// Feature flag `guard` (default on). Off = v3 behaviour (no counting, no locks; rid dedupe stays,
// because only a v4 phone with the flag on sends a rid).
import * as S from './store.js';

export const TOO_MANY = 'Moc pokusů. Zkus to za pár minut, nebo požádej o QR přihlášení.';
const num = (k, d) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);
const MAX = () => num('MUP_GUARD_MAX', 8);
const IP_MAX = () => num('MUP_GUARD_IP_MAX', 30);
const WIN = () => num('MUP_GUARD_WINDOW_S', 600);
const RID_TTL = 600;
export const on = (meta) => meta?.features?.guard !== false;
// A map entry only if it is the map's own (a sid like "__proto__" or "toString" is never a player)
export const own = (map, k) => (typeof k === 'string' && map && Object.hasOwn(map, k) ? map[k] : undefined);
export const badKey = (k) => typeof k !== 'string' || k in Object.prototype;

export function clientIp(req) {
  const xf = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return (xf || req?.headers?.['x-real-ip'] || req?.socket?.remoteAddress || '?').slice(0, 64);
}

// ---------- tiny TTL counter / key store: Redis, else Postgres, else memory ----------
const P = 'mup:g:';
const mem = globalThis.__mupGuard || (globalThis.__mupGuard = new Map()); // k -> { v, exp }
const memLive = (k) => { const e = mem.get(k); if (e && e.exp > Date.now()) return e; mem.delete(k); return null; };
let pgReady = null;
async function pgq(t, p) {
  if (!pgReady) {
    pgReady = S.rawPg('CREATE TABLE IF NOT EXISTS mup_guard (k text PRIMARY KEY, v text NOT NULL, exp bigint NOT NULL)')
      .catch((e) => { pgReady = null; if (!/already exists|duplicate key/i.test(String(e?.message))) throw e; });
  }
  await pgReady;
  return S.rawPg(t, p);
}
const kv = {
  async incr(key, ttl) {
    const k = P + key, now = Date.now();
    if (S.rawRedis) {
      const n = Number(await S.rawRedis.incr(k));
      if (n === 1) await S.rawRedis.expire(k, ttl);
      return n;
    }
    if (S.rawPg) {
      const r = await pgq(`INSERT INTO mup_guard (k, v, exp) VALUES ($1, '1', $2) ON CONFLICT (k) DO UPDATE SET
        v = CASE WHEN mup_guard.exp < $3 THEN '1' ELSE (mup_guard.v::bigint + 1)::text END,
        exp = CASE WHEN mup_guard.exp < $3 THEN EXCLUDED.exp ELSE mup_guard.exp END RETURNING v`, [k, now + ttl * 1000, now]);
      return Number(r[0]?.v) || 1;
    }
    const e = memLive(k);
    if (e) { e.v = String(Number(e.v) + 1); return Number(e.v); }
    mem.set(k, { v: '1', exp: now + ttl * 1000 });
    return 1;
  },
  // set only if absent; true when this call wrote it
  async add(key, v, ttl) {
    const k = P + key, now = Date.now();
    if (S.rawRedis) return (await S.rawRedis.set(k, v, { nx: true, ex: ttl })) != null;
    if (S.rawPg) {
      const r = await pgq(`INSERT INTO mup_guard (k, v, exp) VALUES ($1, $2, $3) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, exp = EXCLUDED.exp
        WHERE mup_guard.exp < $4 RETURNING k`, [k, v, now + ttl * 1000, now]);
      return r.length > 0;
    }
    if (memLive(k)) return false;
    mem.set(k, { v, exp: now + ttl * 1000 });
    return true;
  },
  async get(key) {
    const k = P + key;
    if (S.rawRedis) { const v = await S.rawRedis.get(k); return v == null ? null : String(v); }
    if (S.rawPg) { const r = await pgq('SELECT v FROM mup_guard WHERE k = $1 AND exp >= $2', [k, Date.now()]); return r[0]?.v ?? null; }
    return memLive(k)?.v ?? null;
  },
  async set(key, v, ttl) {
    const k = P + key;
    if (S.rawRedis) return S.rawRedis.set(k, v, { ex: ttl });
    if (S.rawPg) return pgq('INSERT INTO mup_guard (k, v, exp) VALUES ($1, $2, $3) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, exp = EXCLUDED.exp', [k, v, Date.now() + ttl * 1000]);
    mem.set(k, { v, exp: Date.now() + ttl * 1000 });
  },
  async del(key) {
    const k = P + key;
    if (S.rawRedis) return S.rawRedis.del(k);
    if (S.rawPg) return pgq('DELETE FROM mup_guard WHERE k = $1', [k]);
    mem.delete(k);
  },
};
// counters must never break the game: on a storage hiccup the try simply is not counted
const safe = async (fn, dflt) => { try { return await fn(); } catch (e) { console.error('guard store failed', e?.message); return dflt; } };

// ---------- PIN / token gate ----------
// Pure: is this player locked right now? (no storage)
export const locked = (meta, p) => on(meta) && !!p && Number(p.lock) > Date.now();

// A failed PIN / token try for player p (may be null for an unknown sid). Counts it and, when a limit
// is reached, locks the player. Returns true when the answer should be TOO_MANY instead of "wrong PIN".
export async function failed(meta, req, p) {
  if (!on(meta)) return false;
  if (locked(meta, p)) return true; // already locked: no more counting, no cost
  const [np, ni] = await Promise.all([
    p ? safe(() => kv.incr('p:' + p.id, WIN()), 0) : 0,
    safe(() => kv.incr('ip:' + clientIp(req), WIN()), 0),
  ]);
  const over = np >= MAX() || ni > IP_MAX();
  if (over && p) await lock(p);
  return over;
}

async function lock(p) {
  const until = Date.now() + WIN() * 1000;
  p.lock = until; // the cached record (same object) sees it at once
  const cur = await S.hget('players', p.id); // re-read so a concurrent change is not overwritten
  if (cur) { cur.lock = until; await S.hset('players', p.id, cur); }
}

// The dealer's resetPin / loginLink (and a used login link): drop the lock and the player's counter.
// Mutates p (the caller writes it); costs one DEL.
export async function clear(p) {
  if (!p) return;
  delete p.lock;
  await safe(() => kv.del('p:' + p.id));
}

// ---------- idempotent writes: same sid + rid runs once ----------
const RID_OK = /^[\w-]{6,40}$/;
export async function once(b, fn) {
  const rid = b && typeof b.rid === 'string' && RID_OK.test(b.rid) && b.sid ? b.rid : null;
  if (!rid) return fn();
  const key = 'rid:' + String(b.sid).slice(0, 40) + ':' + rid;
  const claimed = await safe(() => kv.add(key, 'p', 30), true); // short: a crashed request frees it soon
  if (!claimed) {
    const v = await safe(() => kv.get(key), null);
    if (v === 'ok') return { status: 200, body: { ok: true, dup: true } };
    if (v === 'p') return { status: 409, body: { ok: false, pending: true, error: 'Zpracovává se, zkusím to znovu…' } };
  }
  let r;
  try { r = await fn(); } catch (e) { await safe(() => kv.del(key)); throw e; }
  if (r?.body?.ok) await safe(() => kv.set(key, 'ok', RID_TTL));
  else await safe(() => kv.del(key)); // a refused write may be sent again (e.g. after fixing it)
  return r;
}
