// @self-managed: starts its own servers on E_PORT (memory), E_PORT+1 (short lock window) and E_PORT+2
// (mock Upstash only, on its own port, to count Redis commands).
// v4 guard: PIN brute-force limits per player / per IP, the dealer's reset, the QR path, the `guard`
// flag, zero extra commands for passing requests, and the retry queue's rid dedupe (api/_lib/guard.js).
import { ok, section, main, client, startServer, startMock, freshGame, sleep } from './_e-lib.mjs';

const PORT = Number(process.env.E_PORT || 3106);
const MOCK = 9000 + (PORT % 1000); // never the shared 8089 of other runs
const TOO_MANY = 'Moc pokusů. Zkus to za pár minut, nebo požádej o QR přihlášení.';
const WRONG = 'Špatný PIN.';
const xf = (ip) => ({ 'x-forwarded-for': ip + ', 10.255.0.1' });
const login = (c, s, pin = s.pin, h = {}) => c.post({ op: 'login', sid: s.sid, pin }, h);
const bad = (pin) => String((Number(pin) + 1111) % 10000).padStart(4, '0');
const parseLink = (url) => { const m = /^\/play#login=([\w-]+):([\w-]+)$/.exec(url || ''); return m ? { sid: m[1], token: m[2] } : null; };

await main(async () => {
  // ---------- memory server, default limits (8 per player, 30 per IP, 10 min) ----------
  const srv = await startServer({ port: PORT, tag: 'tagE' + PORT });
  const c = client(srv.base);
  const { T, S } = await freshGame(c, { n: 18, ghost: false });
  const st0 = await c.get();
  ok(st0.features?.guard === true, 'flag guard defaults to on');

  section('per player: 8 wrong PINs lock the player');
  const A = S[0];
  const ip1 = xf('10.1.0.1');
  const r7 = [];
  for (let i = 0; i < 7; i++) r7.push(await login(c, A, bad(A.pin), ip1));
  ok(r7.every((r) => !r.ok && r.error === WRONG), 'tries 1–7: „Špatný PIN.“');
  const r8 = await login(c, A, bad(A.pin), ip1);
  ok(!r8.ok && r8.error === TOO_MANY && r8.relogin === true, '8th wrong PIN → „Moc pokusů…“');
  const rGood = await login(c, A, A.pin, ip1);
  ok(!rGood.ok && rGood.error === TOO_MANY, 'locked: even the right PIN is refused');
  ok(!(await login(c, A, A.pin, xf('10.9.9.9'))).ok, 'locked: also from another IP');
  const gA = await c.me(A);
  ok(!gA.me && gA.meError === 'locked', 'locked: GET with the right PIN gives no me (meError „locked“)');
  const wA = await c.get('?view=wall', { 'x-sid': A.sid, 'x-pin': A.pin });
  ok(wA._status === 401 && wA.error === TOO_MANY && !wA.stickers, 'locked: wall view refused');
  const sA = await c.st(A, 'notes', { notes: {} });
  ok(!sA.ok && sA.error === TOO_MANY, 'locked: student ops refused');
  const rsA = await c.post({ op: 'restore', sid: A.sid, pin: A.pin, name: A.name, team: A.team });
  ok(!rsA.ok && rsA.error === TOO_MANY, 'locked: restore refused');
  ok((await login(c, S[1])).ok && !!(await c.me(S[1])).me, 'another player is not affected');
  const dv = await c.dget('?view=dealer');
  ok(dv.dealer?.rows?.find((r) => r.id === A.sid)?.locked === true && !dv.dealer.rows.find((r) => r.id === S[1].sid)?.locked, 'dealer view marks the locked player (and only that one)');
  const pubRaw = (await c.get())._raw;
  ok(!/"lock"\s*:/.test(pubRaw), 'the lock never shows in the public state');

  section('dealer resetPin clears the lock and the counter');
  ok((await c.dealer('resetPin', { sid: A.sid })).ok, 'dealer resetPin');
  A.pin = '4321';
  ok((await login(c, A, A.pin)).ok, 'after reset: the first login sets the new PIN');
  ok(!!(await c.me(A)).me, 'after reset: GET me works');
  const w1 = await login(c, A, bad(A.pin), ip1);
  ok(!w1.ok && w1.error === WRONG, 'after reset the counter starts again (1 wrong → „Špatný PIN.“)');

  section('QR login link: works while locked, clears the lock');
  const B = S[2];
  for (let i = 0; i < 8; i++) await login(c, B, bad(B.pin), xf('10.1.0.2'));
  ok((await login(c, B, B.pin)).error === TOO_MANY, 'B locked');
  const ll = await c.dealer('loginLink', { sid: B.sid });
  ok(ll.ok && parseLink(ll.url), 'dealer loginLink');
  ok((await login(c, B, B.pin)).ok, 'loginLink alone already clears the lock');
  for (let i = 0; i < 8; i++) await login(c, B, bad(B.pin), xf('10.1.0.2'));
  ok((await login(c, B, B.pin)).error === TOO_MANY, 'B locked again (link still unused)');
  const tl = await c.post({ op: 'tokenLogin', ...parseLink(ll.url) });
  ok(tl.ok && /^\d{4}$/.test(tl.pin || ''), 'tokenLogin with the dealer link works while locked');
  B.pin = tl.pin;
  ok(!!(await c.me(B)).me && (await login(c, B)).ok, 'the new PIN works: lock gone');
  const tl2 = await c.post({ op: 'tokenLogin', ...parseLink(ll.url) });
  ok(!tl2.ok && tl2.error === 'Odkaz už neplatí. Požádej o nový.', 'a used link still fails normally');

  section('per IP: 30 wrong tries, then every further miss locks its target');
  const ipX = xf('10.2.0.7');
  let n = 0;
  for (const s of S.slice(3, 8)) for (let i = 0; i < 6; i++) { const r = await login(c, s, bad(s.pin), ipX); if (r.error === WRONG) n++; }
  ok(n === 30, `30 misses from one IP over 5 players, all „Špatný PIN.“ (${n})`);
  const V = S[8];
  const r31 = await login(c, V, bad(V.pin), ipX);
  ok(r31.error === TOO_MANY, '31st miss from that IP → „Moc pokusů…“');
  ok((await login(c, V, V.pin, xf('10.2.0.99'))).error === TOO_MANY, 'and its target is locked');
  ok((await login(c, S[9], S[9].pin, ipX)).ok, 'a right PIN from the same IP still works (one school NAT never locks the class)');
  const other = await login(c, S[10], bad(S[10].pin), xf('10.2.0.8'));
  ok(other.error === WRONG, 'another IP has its own counter');
  ok((await login(c, S[3], S[3].pin, xf('10.3.0.1'))).ok, 'players with 6 misses (below 8) are not locked');

  section('wrong GET PIN counts too, a right one never does');
  const G = S[11];
  for (let i = 0; i < 7; i++) await c.get('', { 'x-sid': G.sid, 'x-pin': bad(G.pin) });
  const g8 = await c.get('', { 'x-sid': G.sid, 'x-pin': bad(G.pin) });
  ok(g8.meError === 'locked', '8 wrong GETs lock (meError „locked“)');
  const H = S[12];
  let allOk = true;
  for (let i = 0; i < 40; i++) { const r = await c.me(H); if (!r.me) allOk = false; }
  for (let i = 0; i < 20; i++) { const r = await login(c, H); if (!r.ok) allOk = false; }
  ok(allOk, '40 GETs + 20 logins with the right PIN: all fine (successes are never counted)');

  section('tokenLogin: wrong tokens are rate limited like PINs');
  const K = S[13];
  const tk = [];
  for (let i = 0; i < 8; i++) tk.push(await c.post({ op: 'tokenLogin', sid: K.sid, token: 'nope' + i }, xf('10.4.0.1')));
  ok(tk.slice(0, 7).every((r) => r.error === 'Odkaz už neplatí. Požádej o nový.') && tk[7].error === TOO_MANY, '7 × „Odkaz už neplatí“, the 8th → „Moc pokusů…“');
  const ll2 = await c.dealer('loginLink', { sid: K.sid });
  const tk2 = await c.post({ op: 'tokenLogin', ...parseLink(ll2.url) }, xf('10.4.0.1'));
  ok(tk2.ok, 'a real dealer link still works for that player');

  section('flag off: v3 behaviour');
  await c.dealer('features', { set: { guard: false } });
  const F = S[14];
  const fr = [];
  for (let i = 0; i < 12; i++) fr.push(await login(c, F, bad(F.pin), xf('10.5.0.1')));
  ok(fr.every((r) => r.error === WRONG), 'guard off: 12 wrong PINs are all „Špatný PIN.“');
  ok((await login(c, F)).ok, 'guard off: the right PIN works');
  ok((await login(c, V)).ok, 'guard off: an earlier lock (V) is ignored');
  await c.dealer('features', { set: { guard: true } });

  section('rid: the same request id runs once');
  const P = S[15];
  const body = { kind: 'q', text: 'Kdo připraví pitch? RID-TEST' };
  const p1 = await c.st(P, 'wallPost', { ...body, rid: 'rid-abc-123' });
  const p2 = await c.st(P, 'wallPost', { ...body, rid: 'rid-abc-123' });
  ok(p1.ok && p2.ok && p2.dup === true, 'same rid twice: both ok, the second marked dup');
  const wl = await c.get('?view=wall', { 'x-sid': P.sid, 'x-pin': P.pin });
  ok((wl.stickers || []).filter((x) => /RID-TEST/.test(x.text)).length === 1, 'same rid twice → one sticker');
  const p3 = await c.st(P, 'wallPost', { ...body, rid: 'rid-abc-124' });
  const wl2 = await c.get('?view=wall', { 'x-sid': P.sid, 'x-pin': P.pin });
  ok(p3.ok && !p3.dup && (wl2.stickers || []).filter((x) => /RID-TEST/.test(x.text)).length === 2, 'a new rid → a second sticker');
  const Q2 = S.find((s) => s.team === P.team && s !== P);
  const p4 = await c.st(Q2, 'wallPost', { ...body, text: body.text + ' Q2', rid: 'rid-abc-123' });
  ok(p4.ok && !p4.dup, 'the same rid from another student is its own request');
  const e1 = await c.st(P, 'wallPost', { kind: 'q', text: '', rid: 'rid-fix-001' });
  const e2 = await c.st(P, 'wallPost', { kind: 'q', text: 'Opravený text RID-FIX', rid: 'rid-fix-001' });
  ok(!e1.ok && e2.ok && !e2.dup, 'a refused write can be sent again with the same rid');
  const twice = await Promise.all([1, 2].map(() => c.st(P, 'wallPost', { kind: 'q', text: 'Souběžně RID-PAR', rid: 'rid-par-001' })));
  const wl3 = await c.get('?view=wall', { 'x-sid': P.sid, 'x-pin': P.pin });
  ok((wl3.stickers || []).filter((x) => /RID-PAR/.test(x.text)).length === 1 && twice.some((r) => r.ok), 'the same rid sent twice at once → one sticker');
  const bad1 = await c.st(P, 'wallPost', { kind: 'q', text: 'Bez kontroly', rid: 'x' });
  ok(bad1.ok && !bad1.dup, 'a malformed rid is ignored (the write runs normally)');
  await c.dealer('phase', { phase: 'betting' });
  const others = T.filter((t) => t !== P.team);
  const slip = { in: { [others[0]]: { amt: 600000, why: 'a' }, [others[1]]: { amt: 400000, why: '' } } };
  const s1 = await c.st(P, 'submit', { ...slip, rid: 'rid-sub-001' });
  const s2 = await c.st(P, 'submit', { ...slip, rid: 'rid-sub-001' });
  ok(s1.ok && s2.ok && s2.dup, 'submit with the same rid twice: ok + dup');
  const mp = await c.me(P);
  ok(mp.me?.slip?.submitted && mp.me.slip.in[others[0]].amt === 600000, 'the slip is there once, as sent');
  await srv.stop();

  // ---------- short window: the lock ends by itself ----------
  section('the lock ends when the window is over');
  const srv2 = await startServer({ port: PORT + 1, tag: 'tagE' + (PORT + 1), env: { MUP_GUARD_WINDOW_S: '1', MUP_GUARD_MAX: '3' } });
  const c2 = client(srv2.base);
  const { S: S2 } = await freshGame(c2, { n: 2, ghost: false });
  const L = S2[0];
  const lr = [];
  for (let i = 0; i < 3; i++) lr.push(await login(c2, L, bad(L.pin)));
  ok(lr[2].error === TOO_MANY && (await login(c2, L)).error === TOO_MANY, 'MUP_GUARD_MAX=3: the 3rd miss locks');
  await sleep(1300);
  ok((await login(c2, L)).ok, 'after the window (MUP_GUARD_WINDOW_S=1) the right PIN works again');
  await srv2.stop();

  // ---------- Redis (mock Upstash): passing requests cost zero extra commands ----------
  section('Redis commands: zero extra for passing requests');
  const mock = await startMock(MOCK);
  const redisEnv = { UPSTASH_REDIS_REST_URL: mock.url, UPSTASH_REDIS_REST_TOKEN: 'test-token' };
  const srv3 = await startServer({ port: PORT + 2, tag: 'tagE' + (PORT + 2), env: redisEnv });
  const c3 = client(srv3.base);
  ok((await c3.get()).storage === 'redis', 'server on the mock Redis');
  const { S: S3 } = await freshGame(c3, { n: 4, ghost: false });
  const M = S3[0];
  const cost = async (fn) => { await sleep(800); await mock.resetStats(); await fn(); return mock.stats(); };
  const measure = async () => ({
    get: await cost(() => c3.get()),
    me: await cost(() => c3.me(M)),
    wall: await cost(() => c3.get('?view=wall', { 'x-sid': M.sid, 'x-pin': M.pin })),
    login: await cost(() => login(c3, M)),
    notes: await cost(() => c3.st(M, 'notes', { notes: {} })),
  });
  const on = await measure();
  await c3.dealer('features', { set: { guard: false } });
  const off = await measure();
  await c3.dealer('features', { set: { guard: true } });
  for (const k of Object.keys(on)) {
    ok(on[k].total === off[k].total && !on[k].byCmd.INCR && !on[k].byCmd.EXPIRE, `${k}: ${on[k].total} commands with guard on = ${off[k].total} with it off, no INCR / EXPIRE`);
  }
  const miss = await cost(() => login(c3, M, bad(M.pin)));
  ok(miss.byCmd.INCR === 2 && miss.byCmd.EXPIRE === 2, `a miss costs INCR ×2 + EXPIRE ×2 (player + IP): ${JSON.stringify(miss.byCmd)}`);
  const miss2 = await cost(() => login(c3, M, bad(M.pin)));
  ok(miss2.byCmd.INCR === 2 && !miss2.byCmd.EXPIRE, 'the next miss: INCR only (EXPIRE once per window)');
  const withRid = await cost(() => c3.st(M, 'notes', { notes: {}, rid: 'rid-cost-001' }));
  ok(withRid.total - on.notes.total === 2, `a write with a rid costs 2 more (claim + done): ${withRid.total} vs ${on.notes.total}`);
  const dup = await c3.st(M, 'notes', { notes: {}, rid: 'rid-cost-001' });
  ok(dup.ok && dup.dup, 'Redis: same rid twice → dup');
  const R = S3[1];
  for (let i = 0; i < 8; i++) await login(c3, R, bad(R.pin));
  ok((await login(c3, R)).error === TOO_MANY, 'Redis: 8 misses lock the player');
  const locked = await cost(() => login(c3, R));
  ok(!locked.byCmd.INCR, 'tries on a locked player are not counted any more (no INCR)');
  ok((await c3.dealer('resetPin', { sid: R.sid })).ok && (await login(c3, R, '5555')).ok, 'Redis: dealer resetPin unlocks');
  await srv3.stop();
  await mock.stop();
});
