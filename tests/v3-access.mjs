// @self-managed: starts its own servers on E_PORT (open dealer) and E_PORT+1 (DEALER_LOCK=1, short token TTL).
// v3 §9 login QR (loginLink / tokenLogin) and §10 dealer preview (GET ?as=<sid>).
import { ok, section, main, client, startServer, wipePg, startMock, freshGame, sleep, findKey, MODE, MOCK_PORT } from './_e-lib.mjs';

const PORT = Number(process.env.E_PORT || 3106);
const LT_FAIL = 'Odkaz už neplatí. Požádej o nový.';
const parse = (url) => { const m = /^\/play#login=([\w-]+):([\w-]+)$/.exec(url || ''); return m ? { sid: m[1], token: m[2] } : null; };
// drop timestamps / time-derived fields before comparing two `me` objects
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (/^(ts|t|now|serverNow|left|remaining|ends|endsAt|until)$/i.test(k) ? undefined : v)));

await main(async () => {
  let mock = null;
  if (MODE === 'redis') mock = await startMock(MOCK_PORT);
  if (MODE !== 'mem') wipePg();
  const srv = await startServer({ port: PORT, tag: 'tagV3A' + PORT, mode: MODE });
  const c = client(srv.base);
  const { T, S, G } = await freshGame(c, { n: 3, ghost: true });
  const [A, B] = S;

  section('loginLink');
  const t0 = Date.now();
  let l1 = await c.dealer('loginLink', { sid: A.sid });
  const p1 = parse(l1.url);
  ok(l1.ok && p1 && p1.sid === A.sid, 'loginLink returns /play#login=<sid>:<token> ' + (l1.error || l1.url));
  ok(p1 && /^[A-Za-z0-9_-]{22}$/.test(p1.token), 'token = 16 random bytes, base64url');
  ok(l1.exp >= t0 + 9.9 * 60e3 && l1.exp <= Date.now() + 10 * 60e3 + 1000, 'exp = now + 10 min');
  let dump = await c.dump();
  const lt = dump?.players?.[A.sid]?.lt;
  ok(lt && /^[0-9a-f]{64}$/.test(lt.h) && lt.exp === l1.exp, 'only the sha256 hash + exp stored in p.lt');
  ok(!JSON.stringify(dump).includes(p1.token), 'the plain token is stored nowhere in the dump');
  ok(!(await c.dealer('loginLink', { sid: 'nobody123' })).ok, 'loginLink for an unknown sid fails');

  section('wrong / replaced token');
  let r = await c.post({ op: 'tokenLogin', sid: A.sid, token: 'A'.repeat(22) });
  ok(!r.ok && r.error === LT_FAIL, 'wrong token → „Odkaz už neplatí…“');
  ok(!(await c.post({ op: 'tokenLogin', sid: A.sid })).ok, 'missing token fails');
  ok(!(await c.post({ op: 'tokenLogin', sid: B.sid, token: p1.token })).ok, 'token of another player fails');
  ok(!(await c.post({ op: 'tokenLogin', sid: 'nobody123', token: p1.token })).ok, 'unknown sid fails');
  const l2 = await c.dealer('loginLink', { sid: A.sid });
  const p2 = parse(l2.url);
  ok(l2.ok && p2 && p2.token !== p1.token, 'a second loginLink makes a new token');
  r = await c.post({ op: 'tokenLogin', sid: A.sid, token: p1.token });
  ok(!r.ok && r.error === LT_FAIL, 'the replaced (old) token no longer works');

  section('tokenLogin works once');
  r = await c.post({ op: 'tokenLogin', sid: A.sid, token: p2.token });
  ok(r.ok && r.sid === A.sid && /^\d{4}$/.test(r.pin) && r.name === A.name && r.team === A.team, 'tokenLogin → { ok, sid, pin, name, team } ' + (r.error || ''));
  const newPin = r.pin;
  r = await c.post({ op: 'tokenLogin', sid: A.sid, token: p2.token });
  ok(!r.ok && r.error === LT_FAIL, 'the same token a second time fails');
  dump = await c.dump();
  ok(dump.players[A.sid] && dump.players[A.sid].lt === undefined, 'p.lt deleted after use');
  const A2 = { ...A, pin: newPin };
  ok((await c.me(A2)).me?.id === A.sid, 'the new PIN works (GET me)');
  ok((await c.st(A2, 'login')).ok, 'the new PIN works (login op)');
  if (newPin !== A.pin) {
    const old = await c.me(A);
    ok(!old.me && old.meError === 'pin', 'the old PIN no longer works (GET)');
    ok(!(await c.st(A, 'login')).ok, 'the old PIN no longer works (login op)');
  } else ok(true, 'new PIN equals the old one by chance (1:10000)');
  const log = await c.dget('?view=log');
  ok(log.ok && !log._raw.includes(p2.token) && !log._raw.includes(p1.token), 'tokens never written to the action log');
  ok(!findKey(log.log, 'pin').length, 'no PIN in the action log');

  section('concurrent scans of one QR');
  const l3 = parse((await c.dealer('loginLink', { sid: B.sid })).url);
  const both = await Promise.all([1, 2, 3].map(() => c.post({ op: 'tokenLogin', sid: B.sid, token: l3.token })));
  ok(both.filter((x) => x.ok).length === 1, 'three simultaneous tokenLogins → exactly one succeeds');
  B.pin = both.find((x) => x.ok)?.pin || B.pin;

  section('ghost');
  const lg = await c.dealer('loginLink', { sid: G.sid });
  ok(lg.ok, 'loginLink works for a ghost');
  r = await c.post({ op: 'tokenLogin', sid: G.sid, token: parse(lg.url)?.token });
  ok(r.ok && /^\d{4}$/.test(r.pin), 'ghost tokenLogin → new PIN');
  const gm = await c.me({ sid: G.sid, pin: r.pin });
  ok(gm.me?.ghost === true, 'ghost logged in with the new PIN, still a ghost');
  ok(!(await c.get()).players?.some?.((p) => p.id === G.sid), 'ghost still hidden from the public player list');

  section('dealer preview GET ?as=<sid>');
  await c.dealer('phase', { phase: 'betting' });
  await c.st(B, 'submit', { in: { [T.find((t) => t !== B.team)]: { amt: 300000, why: 'Silný tým a trakce' } }, out: {}, notes: {} });
  const plain = await c.get();
  const noHdr = await c.get('?as=' + B.sid);
  ok(!noHdr.me && !noHdr.asDealer, 'as= without the dealer header: no me, no asDealer');
  ok(JSON.stringify(Object.keys(noHdr).sort()) === JSON.stringify(Object.keys(plain).sort()), 'as= without the dealer header = the normal public GET');
  const own = await c.me(B);
  const asB = await c.dget('?as=' + B.sid);
  ok(asB.asDealer === true && asB.me?.id === B.sid, 'dealer as=<sid> → asDealer + that player\'s me');
  ok(JSON.stringify(strip(asB.me)) === JSON.stringify(strip(own.me)), 'me equals the player\'s own GET (ignoring timestamps)');
  ok(asB.teams && asB.phase === own.phase && !asB.dealer, 'the rest is the normal GET (no dealer state)');
  const asG = await c.dget('?as=' + G.sid);
  ok(asG.asDealer && asG.me?.ghost === true, 'dealer can preview a ghost');
  const asX = await c.dget('?as=nobody123');
  ok(!asX.me && !asX.asDealer, 'as= an unknown sid gives no me');
  const asWrong = await c.get('?as=' + B.sid, { 'x-sid': A.sid, 'x-pin': newPin });
  ok(asWrong.me?.id === A.sid && !asWrong.asDealer, 'a student sending as= still only sees their own me');
  await srv.stop();

  section('DEALER_LOCK + token expiry');
  if (MODE !== 'mem') wipePg();
  const lk = await startServer({ port: PORT + 1, tag: 'tagV3A' + (PORT + 1), mode: MODE, env: { DEALER_LOCK: '1', DEALER_PASSWORD: 'tajne-heslo', MUP_LT_TTL_MS: '600' } });
  const H = { 'x-dealer': 'tajne-heslo' };
  const raw = async (body, headers = {}, q = '') => {
    const x = await fetch(lk.base + q, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: x.status, j: await x.json().catch(() => ({})) };
  };
  await raw({ op: 'reg', open: true }, H);
  const T2 = (await raw(null)).j.teams.map((t) => t.id);
  const reg = (await raw({ op: 'register', name: 'Zamčený Student', team: T2[0], pin: '1357' })).j;
  ok(reg.ok, 'register on the locked server');
  r = await raw({ op: 'loginLink', sid: reg.sid });
  ok(r.status === 401 && !r.j.ok && !r.j.url, 'loginLink without the password → 401');
  r = await raw({ op: 'loginLink', sid: reg.sid }, { 'x-dealer': 'mup-dealer' });
  ok(r.status === 401 && !r.j.url, 'loginLink with the default password refused when locked');
  r = await raw({ op: 'loginLink', sid: reg.sid }, H);
  ok(r.j.ok && parse(r.j.url), 'loginLink with the password');
  const tk = parse(r.j.url).token;
  await sleep(900);
  r = await raw({ op: 'tokenLogin', sid: reg.sid, token: tk });
  ok(!r.j.ok && r.j.error === LT_FAIL, 'an expired token → „Odkaz už neplatí…“');
  ok((await raw({ op: 'login', sid: reg.sid, pin: '1357' })).j.ok, 'the old PIN still works after a failed token');
  r = await raw({ op: 'loginLink', sid: reg.sid }, H);
  const tk2 = parse(r.j.url).token;
  r = await raw({ op: 'tokenLogin', sid: reg.sid, token: tk2 });
  ok(r.j.ok, 'tokenLogin needs no dealer password');
  ok(!(await raw(null, {}, '?as=' + reg.sid)).j.me, 'locked: as= without a header gives no me');
  ok(!(await raw(null, { 'x-dealer': 'nope' }, '?as=' + reg.sid)).j.me, 'locked: as= with a wrong password gives no me');
  const la = (await raw(null, H, '?as=' + reg.sid)).j;
  ok(la.asDealer && la.me?.id === reg.sid, 'locked: as= with the password → me');
  await lk.stop();
  if (mock) await mock.stop();
});
