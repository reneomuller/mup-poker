// Storage: Upstash Redis or Postgres (Neon) on Vercel, in-memory fallback for local development.
// Every action is also appended to an action log (mup_log / mup:log) so the game can be rebuilt.
import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;
const pgUrl = redis ? null : process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || null;

export const storageMode = redis ? 'redis' : pgUrl ? 'postgres' : 'memory';

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

let ready = null;
async function ensure() {
  if (!q) return;
  if (!ready) {
    ready = (async () => {
      const stmts = [
        'CREATE TABLE IF NOT EXISTS mup_kv (k text PRIMARY KEY, v text NOT NULL)',
        'CREATE TABLE IF NOT EXISTS mup_h (k text NOT NULL, f text NOT NULL, v text NOT NULL, PRIMARY KEY (k, f))',
        'CREATE TABLE IF NOT EXISTS mup_log (id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), op text, actor text, ok boolean, body text)',
      ];
      for (const s of stmts) {
        try { await q(s); } catch (e) { if (!/already exists|duplicate key/i.test(String(e?.message))) throw e; }
      }
    })().catch((e) => { ready = null; throw e; });
  }
  await ready;
}

const mem = globalThis.__mupMem || (globalThis.__mupMem = { kv: new Map(), h: new Map(), log: [] });
const P = 'mup:';

const parse = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
};

export async function getJSON(key) {
  if (q) { await ensure(); const r = await q('SELECT v FROM mup_kv WHERE k = $1', [P + key]); return r[0] ? parse(r[0].v) : null; }
  if (!redis) { const v = mem.kv.get(P + key); return v ? JSON.parse(v) : null; }
  return parse(await redis.get(P + key));
}

export async function setJSON(key, val) {
  const s = JSON.stringify(val);
  if (q) { await ensure(); await q('INSERT INTO mup_kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v', [P + key, s]); return; }
  if (!redis) { mem.kv.set(P + key, s); return; }
  await redis.set(P + key, s);
}

export async function del(key) {
  if (q) { await ensure(); await q('DELETE FROM mup_kv WHERE k = $1', [P + key]); await q('DELETE FROM mup_h WHERE k = $1', [P + key]); return; }
  if (!redis) { mem.kv.delete(P + key); mem.h.delete(P + key); return; }
  await redis.del(P + key);
}

export async function hset(key, field, val) {
  const s = JSON.stringify(val);
  if (q) { await ensure(); await q('INSERT INTO mup_h (k, f, v) VALUES ($1, $2, $3) ON CONFLICT (k, f) DO UPDATE SET v = EXCLUDED.v', [P + key, field, s]); return; }
  if (!redis) {
    if (!mem.h.has(P + key)) mem.h.set(P + key, new Map());
    mem.h.get(P + key).set(field, s);
    return;
  }
  await redis.hset(P + key, { [field]: s });
}

export async function hdel(key, field) {
  if (q) { await ensure(); await q('DELETE FROM mup_h WHERE k = $1 AND f = $2', [P + key, field]); return; }
  if (!redis) { mem.h.get(P + key)?.delete(field); return; }
  await redis.hdel(P + key, field);
}

export async function hgetall(key) {
  const out = {};
  if (q) {
    await ensure();
    for (const r of await q('SELECT f, v FROM mup_h WHERE k = $1', [P + key])) out[r.f] = parse(r.v);
    return out;
  }
  if (!redis) {
    const m = mem.h.get(P + key);
    if (m) for (const [f, v] of m) out[f] = JSON.parse(v);
    return out;
  }
  const r = await redis.hgetall(P + key);
  // with automaticDeserialization off, Upstash returns the raw [field, value, ...] array
  if (Array.isArray(r)) for (let i = 0; i + 1 < r.length; i += 2) out[r[i]] = parse(r[i + 1]);
  else if (r) for (const [f, v] of Object.entries(r)) out[f] = parse(v);
  return out;
}

// Append-only action log. Never throws: logging must not break the game.
export async function logAction(e) {
  try {
    const s = JSON.stringify(e);
    if (q) { await ensure(); await q('INSERT INTO mup_log (op, actor, ok, body) VALUES ($1, $2, $3, $4)', [e.op || '', e.actor || '', !!e.ok, s]); return; }
    if (!redis) { mem.log.push(s); if (mem.log.length > 5000) mem.log.shift(); return; }
    await redis.rpush(P + 'log', s);
  } catch (err) { console.error('log failed', err?.message); }
}

export async function readLog(limit = 5000) {
  if (q) { await ensure(); const r = await q('SELECT body FROM mup_log ORDER BY id DESC LIMIT $1', [limit]); return r.map((x) => parse(x.body)).reverse(); }
  if (!redis) return mem.log.slice(-limit).map((s) => JSON.parse(s));
  const r = await redis.lrange(P + 'log', -limit, -1);
  return (r || []).map(parse);
}
