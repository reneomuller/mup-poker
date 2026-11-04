// Minimal Upstash REST mock: GET/SET/DEL/HSET/HGETALL/HDEL with base64 response encoding.
import http from 'node:http';
const kv = new Map(), hs = new Map();
const enc = (x, b64) => (typeof x === 'string' && b64 ? Buffer.from(x).toString('base64') : Array.isArray(x) ? x.map((y) => enc(y, b64)) : x);
function run(cmd) {
  const [c, k, ...a] = cmd; const C = String(c).toUpperCase();
  if (C === 'GET') return kv.has(k) && typeof kv.get(k) === 'string' ? kv.get(k) : null;
  if (C === 'SET') { kv.set(k, String(a[0])); return 'OK'; }
  if (C === 'DEL') { let n = 0; for (const key of [k, ...a]) { if (kv.delete(key)) n++; if (hs.delete(key)) n++; } return n; }
  if (C === 'HSET') { const h = hs.get(k) || new Map(); hs.set(k, h); let n = 0; for (let i = 0; i < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], String(a[i + 1])); } return n; }
  if (C === 'HGETALL') { const h = hs.get(k); return h ? [...h].flat() : []; }
  if (C === 'HDEL') { const h = hs.get(k); let n = 0; for (const f of a) if (h?.delete(f)) n++; return n; }
  if (C === 'RPUSH') { const l = kv.get(k) || []; kv.set(k, l); l.push(...a.map(String)); return l.length; }
  if (C === 'LLEN') return (kv.get(k) || []).length;
  if (C === 'LRANGE') { const l = kv.get(k) || []; let s0 = Number(a[0]), e0 = Number(a[1]); if (s0 < 0) s0 = Math.max(0, l.length + s0); if (e0 < 0) e0 = l.length + e0; return l.slice(s0, e0 + 1); }
  throw new Error('unsupported ' + C);
}
http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url === '/__flush') { kv.clear(); hs.clear(); return res.end('flushed'); }
    const b64 = req.headers['upstash-encoding'] === 'base64';
    if (req.headers.authorization !== 'Bearer test-token') { res.statusCode = 401; return res.end(JSON.stringify({ error: 'unauthorized' })); }
    try {
      const j = JSON.parse(body);
      const out = req.url.startsWith('/pipeline') || req.url.startsWith('/multi-exec') ? j.map((c) => ({ result: enc(run(c), b64) })) : { result: enc(run(j), b64) };
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out));
    } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
  });
}).listen(8079, () => console.log('mock upstash on 8079'));
