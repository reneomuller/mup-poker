// Minimal Upstash REST mock with base64 response encoding.
// Port: MOCK_PORT (default 8079). Extra endpoints: /__flush (wipe everything),
// /__stats (command counts since the last /__stats/reset), /__stats/reset.
import http from 'node:http';
const PORT = Number(process.env.MOCK_PORT || 8079);
const kv = new Map(), hs = new Map();
let stats = { total: 0, byCmd: {} };
const enc = (x, b64) => (typeof x === 'string' && b64 ? Buffer.from(x).toString('base64') : Array.isArray(x) ? x.map((y) => enc(y, b64)) : x);
function run(cmd) {
  const [c, k, ...a] = cmd; const C = String(c).toUpperCase();
  stats.total++; stats.byCmd[C] = (stats.byCmd[C] || 0) + 1;
  if (C === 'PING') return 'PONG';
  if (C === 'GET') return kv.has(k) && typeof kv.get(k) === 'string' ? kv.get(k) : null;
  if (C === 'MGET') return [k, ...a].map((x) => (kv.has(x) && typeof kv.get(x) === 'string' ? kv.get(x) : null));
  if (C === 'SET') {
    const opts = a.slice(1).map((x) => String(x).toUpperCase());
    if (opts.includes('NX') && kv.has(k)) return null;
    if (opts.includes('XX') && !kv.has(k)) return null;
    kv.set(k, String(a[0])); return 'OK';
  }
  if (C === 'SETNX') { if (kv.has(k)) return 0; kv.set(k, String(a[0])); return 1; }
  if (C === 'EXISTS') return [k, ...a].filter((x) => kv.has(x) || hs.has(x)).length;
  if (C === 'INCR' || C === 'INCRBY') { const n = Number(kv.get(k) || 0) + (C === 'INCR' ? 1 : Number(a[0])); kv.set(k, String(n)); return n; }
  if (C === 'EXPIRE' || C === 'PEXPIRE') return kv.has(k) || hs.has(k) ? 1 : 0;
  if (C === 'TTL' || C === 'PTTL') return kv.has(k) || hs.has(k) ? -1 : -2;
  if (C === 'DEL') { let n = 0; for (const key of [k, ...a]) { if (kv.delete(key)) n++; if (hs.delete(key)) n++; } return n; }
  if (C === 'HSET' || C === 'HMSET') { const h = hs.get(k) || new Map(); hs.set(k, h); let n = 0; for (let i = 0; i < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], String(a[i + 1])); } return C === 'HMSET' ? 'OK' : n; }
  if (C === 'HSETNX') { const h = hs.get(k) || new Map(); hs.set(k, h); if (h.has(a[0])) return 0; h.set(a[0], String(a[1])); return 1; }
  if (C === 'HGET') { const h = hs.get(k); return h && h.has(a[0]) ? h.get(a[0]) : null; }
  if (C === 'HMGET') { const h = hs.get(k); return a.map((f) => (h && h.has(f) ? h.get(f) : null)); }
  if (C === 'HEXISTS') { const h = hs.get(k); return h && h.has(a[0]) ? 1 : 0; }
  if (C === 'HLEN') { const h = hs.get(k); return h ? h.size : 0; }
  if (C === 'HKEYS') { const h = hs.get(k); return h ? [...h.keys()] : []; }
  if (C === 'HVALS') { const h = hs.get(k); return h ? [...h.values()] : []; }
  if (C === 'HGETALL') { const h = hs.get(k); return h ? [...h].flat() : []; }
  if (C === 'HDEL') { const h = hs.get(k); let n = 0; for (const f of a) if (h?.delete(f)) n++; if (h && !h.size) hs.delete(k); return n; }
  if (C === 'HINCRBY') { const h = hs.get(k) || new Map(); hs.set(k, h); const n = Number(h.get(a[0]) || 0) + Number(a[1]); h.set(a[0], String(n)); return n; }
  if (C === 'RPUSH' || C === 'LPUSH') { const l = kv.get(k) || []; kv.set(k, l); if (C === 'RPUSH') l.push(...a.map(String)); else l.unshift(...a.map(String).reverse()); return l.length; }
  if (C === 'LLEN') return (kv.get(k) || []).length;
  if (C === 'LRANGE') { const l = kv.get(k) || []; let s0 = Number(a[0]), e0 = Number(a[1]); if (s0 < 0) s0 = Math.max(0, l.length + s0); if (e0 < 0) e0 = l.length + e0; return l.slice(s0, e0 + 1); }
  if (C === 'LTRIM') { const l = kv.get(k) || []; let s0 = Number(a[0]), e0 = Number(a[1]); if (s0 < 0) s0 = Math.max(0, l.length + s0); if (e0 < 0) e0 = l.length + e0; kv.set(k, l.slice(s0, e0 + 1)); return 'OK'; }
  if (C === 'KEYS') return [...new Set([...kv.keys(), ...hs.keys()])];
  throw new Error('unsupported ' + C);
}
http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url === '/__flush') { kv.clear(); hs.clear(); return res.end('flushed'); }
    if (req.url === '/__stats/reset') { stats = { total: 0, byCmd: {} }; return res.end('{}'); }
    if (req.url === '/__stats') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(stats)); }
    const b64 = req.headers['upstash-encoding'] === 'base64';
    if (req.headers.authorization !== 'Bearer test-token') { res.statusCode = 401; return res.end(JSON.stringify({ error: 'unauthorized' })); }
    try {
      const j = JSON.parse(body);
      const out = req.url.startsWith('/pipeline') || req.url.startsWith('/multi-exec') ? j.map((c) => { try { return { result: enc(run(c), b64) }; } catch (e) { return { error: e.message }; } }) : { result: enc(run(j), b64) };
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out));
    } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
  });
}).listen(PORT, () => console.log('mock upstash on ' + PORT));
