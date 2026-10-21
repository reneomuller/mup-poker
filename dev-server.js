// Local preview: serves public/ like Vercel (clean URLs) and routes /api/game.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import handler from './api/game.js';

const PORT = process.env.PORT || 3000;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/game')) return handler(req, res);
  let p = path.join('public', decodeURIComponent(u.pathname));
  if (u.pathname === '/') p = 'public/index.html';
  else if (!path.extname(p)) p += '.html';
  fs.readFile(p, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(PORT, () => console.log('MUP poker on http://localhost:' + PORT));
