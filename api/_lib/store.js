// Storage: Upstash Redis on Vercel, in-memory fallback for local development.
import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;

export const storageMode = redis ? 'redis' : 'memory';

const mem = globalThis.__mupMem || (globalThis.__mupMem = { kv: new Map(), h: new Map() });
const P = 'mup:';

const parse = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
};

export async function getJSON(key) {
  if (!redis) { const v = mem.kv.get(P + key); return v ? JSON.parse(v) : null; }
  return parse(await redis.get(P + key));
}

export async function setJSON(key, val) {
  const s = JSON.stringify(val);
  if (!redis) { mem.kv.set(P + key, s); return; }
  await redis.set(P + key, s);
}

export async function del(key) {
  if (!redis) { mem.kv.delete(P + key); mem.h.delete(P + key); return; }
  await redis.del(P + key);
}

export async function hset(key, field, val) {
  const s = JSON.stringify(val);
  if (!redis) {
    if (!mem.h.has(P + key)) mem.h.set(P + key, new Map());
    mem.h.get(P + key).set(field, s);
    return;
  }
  await redis.hset(P + key, { [field]: s });
}

export async function hdel(key, field) {
  if (!redis) { mem.h.get(P + key)?.delete(field); return; }
  await redis.hdel(P + key, field);
}

export async function hgetall(key) {
  const out = {};
  if (!redis) {
    const m = mem.h.get(P + key);
    if (m) for (const [f, v] of m) out[f] = JSON.parse(v);
    return out;
  }
  const r = await redis.hgetall(P + key);
  if (r) for (const [f, v] of Object.entries(r)) out[f] = parse(v);
  return out;
}
