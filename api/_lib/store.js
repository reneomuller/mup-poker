// Storage.
// - Upstash Redis (primary, fast) when KV_REST_API_* / UPSTASH_REDIS_REST_* are set.
// - Postgres (Neon) when DATABASE_URL / POSTGRES_URL is set: the only store if there is no Redis,
//   otherwise a full mirror of every write. Everything already in Redis is copied into Postgres once
//   per server instance, and if Redis ever comes back empty (flushed) the data is read back from
//   Postgres and Redis is refilled.
// - In-memory fallback for local development.
// Every action is also appended to an action log (mup:log / mup_log) so the game can be rebuilt.
import crypto from 'node:crypto';
import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;
// Neon via Vercel sets DATABASE_URL / POSTGRES_URL, possibly with a custom prefix (e.g. STORAGE_DATABASE_URL).
const PG_KEYS = ['DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL'];
const pgKey = PG_KEYS.find((k) => process.env[k]) ||
  Object.keys(process.env).find((k) => /(DATABASE_URL|POSTGRES_URL)$/.test(k) && /^postgres(ql)?:\/\//.test(process.env[k] || '')) ||
  Object.keys(process.env).find((k) => /(DATABASE_URL|POSTGRES_URL)/.test(k) && !/UNPOOLED|NON_POOLING|PRISMA/.test(k) && /^postgres(ql)?:\/\//.test(process.env[k] || '')) || null;
export const pgEnvKey = pgKey;
const pgUrl = pgKey ? process.env[pgKey] : null;

// q(text, params) -> rows
let q = null;
if (pgUrl) {
  if (process.env.MUP_PG_LOCAL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: pgUrl });
    q = async (t, p = []) => (await pool.query(t, p)).rows;
  } else {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(pgUrl);
    q = (t, p = []) => sql.query(t, p);
  }
}

export const storageMode = redis ? (q ? 'redis+postgres' : 'redis') : q ? 'postgres' : 'memory';

const P = 'mup:';
const mem = globalThis.__mupMem || (globalThis.__mupMem = { kv: new Map(), h: new Map(), log: [] });
const parse = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
};
const raw = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

// ---------- postgres ----------
let ready = null;
async function ensure() {
  if (!ready) {
    ready = (async () => {
      const stmts = [
        'CREATE TABLE IF NOT EXISTS mup_kv (k text PRIMARY KEY, v text NOT NULL)',
        'CREATE TABLE IF NOT EXISTS mup_h (k text NOT NULL, f text NOT NULL, v text NOT NULL, PRIMARY KEY (k, f))',
        'CREATE TABLE IF NOT EXISTS mup_log (id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), op text, actor text, ok boolean, body text)',
        'ALTER TABLE mup_log ADD COLUMN IF NOT EXISTS uid text',
        'CREATE UNIQUE INDEX IF NOT EXISTS mup_log_uid ON mup_log (uid)',
      ];
      for (const s of stmts) {
        try { await q(s); } catch (e) { if (!/already exists|duplicate key/i.test(String(e?.message))) throw e; }
      }
    })().catch((e) => { ready = null; throw e; });
  }
  await ready;
}
const pg = {
  async get(k) { await ensure(); const r = await q('SELECT v FROM mup_kv WHERE k = $1', [k]); return r[0] ? r[0].v : null; },
  async set(k, s) { await ensure(); await q('INSERT INTO mup_kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v', [k, s]); },
  async del(k) { await ensure(); await q('DELETE FROM mup_kv WHERE k = $1', [k]); await q('DELETE FROM mup_h WHERE k = $1', [k]); },
  async hsetMany(k, map) {
    const fs = Object.keys(map);
    if (!fs.length) return;
    await ensure();
    await q('INSERT INTO mup_h (k, f, v) SELECT $1, f, v FROM unnest($2::text[], $3::text[]) AS t(f, v) ON CONFLICT (k, f) DO UPDATE SET v = EXCLUDED.v', [k, fs, fs.map((f) => map[f])]);
  },
  async hdel(k, f) { await ensure(); await q('DELETE FROM mup_h WHERE k = $1 AND f = $2', [k, f]); },
  async hgetall(k) { await ensure(); const out = {}; for (const r of await q('SELECT f, v FROM mup_h WHERE k = $1', [k])) out[r.f] = r.v; return out; },
  async logMany(lines) {
    if (!lines.length) return;
    await ensure();
    const uid = [], op = [], actor = [], ok = [], body = [];
    for (const s of lines) {
      const e = parse(s) || {};
      uid.push(e.uid || crypto.createHash('sha1').update(s).digest('hex'));
      op.push(String(e.op || '')); actor.push(String(e.actor || '')); ok.push(!!e.ok); body.push(s);
    }
    await q('INSERT INTO mup_log (uid, op, actor, ok, body) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::bool[], $5::text[]) ON CONFLICT (uid) DO NOTHING', [uid, op, actor, ok, body]);
  },
};

// ---------- redis ----------
async function rHgetall(k) {
  const r = await redis.hgetall(k);
  const out = {};
  // with automaticDeserialization off, Upstash returns the raw [field, value, ...] array
  if (Array.isArray(r)) for (let i = 0; i + 1 < r.length; i += 2) out[r[i]] = raw(r[i + 1]);
  else if (r) for (const [f, v] of Object.entries(r)) out[f] = raw(v);
  return out;
}

// Mirror writes to Postgres without ever breaking the game if Postgres has a hiccup.
const mirror = async (fn) => { if (!(redis && q)) return; try { await fn(); } catch (e) { console.error('postgres mirror failed', e?.message); } };

// ---------- one-time copy Redis -> Postgres (and refill Redis from Postgres) per instance ----------
const HASHES = ['players', 'slip:1', 'slip:2', 'slip:3', 'slip:4', 'slip:5'];
let synced = null;
function sync() {
  if (!(redis && q)) return null;
  return synced || (synced = backfill().catch((e) => console.error('backfill failed', e?.message)));
}
async function backfill() {
  await ensure();
  for (const key of ['meta', 'content', 'backups']) {
    const k = P + key;
    const [rv, pv] = await Promise.all([redis.get(k).then(raw), pg.get(k)]);
    if (rv != null) {
      // Redis holds a brand-new empty game but Postgres has the real one: Postgres wins
      if (key === 'meta' && parse(rv)?.auto && pv && !parse(pv)?.auto) { await redis.set(k, pv); continue; }
      if (rv !== pv) await pg.set(k, rv);
    } else if (pv != null) await redis.set(k, pv);
  }
  for (const key of HASHES) {
    const k = P + key;
    const [rh, ph] = await Promise.all([rHgetall(k), pg.hgetall(k)]);
    const toPg = {};
    for (const [f, v] of Object.entries(rh)) if (ph[f] !== v) toPg[f] = v;
    await pg.hsetMany(k, toPg);
    const toRedis = {};
    for (const [f, v] of Object.entries(ph)) if (!(f in rh)) toRedis[f] = v;
    if (Object.keys(toRedis).length) await redis.hset(k, toRedis);
  }
  const n = await redis.llen(P + 'log');
  for (let i = Math.max(0, n - 20000); i < n; i += 500) {
    const chunk = await redis.lrange(P + 'log', i, Math.min(n, i + 500) - 1);
    await pg.logMany((chunk || []).map(raw));
  }
}

// ---------- public API ----------
export async function getJSON(key) {
  const k = P + key;
  if (redis) {
    await sync();
    let v = raw(await redis.get(k));
    if (v == null && q) {
      try { v = await pg.get(k); } catch (e) { console.error('postgres read failed', e?.message); }
      if (v != null) await redis.set(k, v); // Redis was flushed: refill it from Postgres
    }
    return parse(v);
  }
  if (q) return parse(await pg.get(k));
  const v = mem.kv.get(k);
  return v ? JSON.parse(v) : null;
}

export async function setJSON(key, val) {
  const k = P + key, s = JSON.stringify(val);
  if (redis) { await sync(); await Promise.all([redis.set(k, s), mirror(() => pg.set(k, s))]); return; }
  if (q) { await pg.set(k, s); return; }
  mem.kv.set(k, s);
}

export async function del(key) {
  const k = P + key;
  if (redis) { await sync(); await Promise.all([redis.del(k), mirror(() => pg.del(k))]); return; }
  if (q) { await pg.del(k); return; }
  mem.kv.delete(k); mem.h.delete(k);
}

export async function hset(key, field, val) {
  const k = P + key, s = JSON.stringify(val);
  if (redis) { await sync(); await Promise.all([redis.hset(k, { [field]: s }), mirror(() => pg.hsetMany(k, { [field]: s }))]); return; }
  if (q) { await pg.hsetMany(k, { [field]: s }); return; }
  if (!mem.h.has(k)) mem.h.set(k, new Map());
  mem.h.get(k).set(field, s);
}

export async function hdel(key, field) {
  const k = P + key;
  if (redis) { await sync(); await Promise.all([redis.hdel(k, field), mirror(() => pg.hdel(k, field))]); return; }
  if (q) { await pg.hdel(k, field); return; }
  mem.h.get(k)?.delete(field);
}

export async function hgetall(key) {
  const k = P + key;
  let rawMap;
  if (redis) {
    await sync();
    rawMap = await rHgetall(k);
    if (!Object.keys(rawMap).length && q) {
      let pm = {};
      try { pm = await pg.hgetall(k); } catch (e) { console.error('postgres read failed', e?.message); }
      if (Object.keys(pm).length) { await redis.hset(k, pm); rawMap = pm; } // refill a flushed Redis
    }
  } else if (q) rawMap = await pg.hgetall(k);
  else { rawMap = {}; const m = mem.h.get(k); if (m) for (const [f, v] of m) rawMap[f] = v; }
  const out = {};
  for (const [f, v] of Object.entries(rawMap)) out[f] = parse(v);
  return out;
}

// Append-only action log. Never throws: logging must not break the game.
export async function logAction(e) {
  try {
    const s = JSON.stringify({ uid: crypto.randomUUID(), ...e });
    if (redis) { await sync(); await Promise.all([redis.rpush(P + 'log', s), mirror(() => pg.logMany([s]))]); return; }
    if (q) { await pg.logMany([s]); return; }
    mem.log.push(s); if (mem.log.length > 5000) mem.log.shift();
  } catch (err) { console.error('log failed', err?.message); }
}

export async function readLog(limit = 5000) {
  if (q) {
    // Postgres has everything (mirrored + copied from Redis)
    await sync();
    const r = await q('SELECT body FROM mup_log ORDER BY id DESC LIMIT $1', [limit]);
    return r.map((x) => parse(x.body)).sort((a, b) => (a?.ts || 0) - (b?.ts || 0));
  }
  if (redis) return ((await redis.lrange(P + 'log', -limit, -1)) || []).map(parse);
  return mem.log.slice(-limit).map((s) => JSON.parse(s));
}
