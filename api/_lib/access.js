// v3 access: the dealer's one-time login QR for a student who lost their PIN (§9),
// and the dealer's read-only preview of one student's view, GET ?as=<sid> (§10).
import crypto from 'node:crypto';
import * as S from './store.js';

export const LT_FAIL = 'Odkaz už neplatí. Požádej o nový.';
// 10 minutes; MUP_LT_TTL_MS shortens it for the expiry test
const ttl = () => Number(process.env.MUP_LT_TTL_MS) > 0 ? Number(process.env.MUP_LT_TTL_MS) : 10 * 60 * 1000;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Same rule as dealerOk in api/game.js (kept here so the wall view can call asPlayer without it).
const DEALER_PW = process.env.DEALER_LOCK === '1' ? process.env.DEALER_PASSWORD || 'mup-dealer' : '';
export const isDealer = (req) => !DEALER_PW || req.headers['x-dealer'] === DEALER_PW;

// dealer op loginLink { sid }: a new token replaces the previous one; only its hash and expiry are stored
export async function loginLink(players, sid) {
  const p = players[String(sid || '')];
  if (!p) return { error: 'Hráč nenalezen.' };
  const token = crypto.randomBytes(16).toString('base64url');
  const exp = Date.now() + ttl();
  p.lt = { h: sha(token), exp };
  await S.hset('players', p.id, p);
  return { url: `/play#login=${p.id}:${token}`, exp };
}

function tokenOk(p, token) {
  const lt = p?.lt;
  if (!lt || typeof lt.h !== 'string' || typeof token !== 'string' || !token || token.length > 64) return false;
  if (!(Number(lt.exp) > Date.now())) return false;
  const a = Buffer.from(sha(token), 'hex'), b = Buffer.from(lt.h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// student op tokenLogin { sid, token }: one use only, then a fresh random 4-digit PIN.
// One login per sid at a time on this instance, and the player is re-read inside, so two phones
// scanning the same QR at once cannot both get in.
const busy = new Set();
export async function tokenLogin(b, removed, pinHash) {
  const sid = String(b.sid || '');
  if (!/^[\w-]{4,24}$/.test(sid) || (removed || []).includes(sid) || busy.has(sid)) return { error: LT_FAIL };
  busy.add(sid);
  try {
    const p = await S.hget('players', sid);
    if (!p || !tokenOk(p, b.token)) return { error: LT_FAIL };
    const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    delete p.lt;
    delete p.lock; // v4 guard: a valid login link always works and ends a PIN lockout
    p.pin = pinHash(p.id, pin);
    await S.hset('players', p.id, p);
    return { sid: p.id, pin, name: p.name, team: p.team };
  } finally { busy.delete(sid); }
}

// GET ?as=<sid> (also for ?view=wall&as=<sid>): the player a valid dealer previews, else null.
// Pure: no storage reads, so a normal GET costs nothing extra.
export function asPlayer(req, players) {
  const q = req.url && req.url.includes('as=') ? new URL(req.url, 'http://local').searchParams.get('as') : null;
  // the x-dealer header must be sent (even on an open dealer), so a plain GET with as= reveals nothing
  if (!q || req.headers['x-dealer'] === undefined || !isDealer(req)) return null;
  return players[q] || null;
}
