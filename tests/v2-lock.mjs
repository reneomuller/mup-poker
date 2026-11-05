// @self-managed: starts its own server on E_PORT with DEALER_LOCK=1 and checks that the new dealer views
// (archives, archive download, data view, log) and ops stay behind the dealer password.
import { ok, section, main, client, startServer, wipePg, startMock, findKey, MODE, MOCK_PORT } from './_e-lib.mjs';

const PORT = Number(process.env.E_PORT || 3106);

await main(async () => {
  let mock = null;
  if (MODE === 'redis') mock = await startMock(MOCK_PORT);
  if (MODE !== 'mem') wipePg();
  const srv = await startServer({ port: PORT, tag: 'tagE' + PORT, mode: MODE, env: { DEALER_LOCK: '1', DEALER_PASSWORD: 'tajne-heslo' } });
  const base = srv.base;
  const raw = async (method, q = '', body = null, headers = {}) => {
    const r = await fetch(base + q, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let j = {}; try { j = JSON.parse(t); } catch {}
    return { status: r.status, j, t };
  };
  const H = { 'x-dealer': 'tajne-heslo' };
  section('dealer password');
  let r = await raw('POST', '', { op: 'archive', label: 'Tajný archiv' });
  ok(r.status === 401 && !r.j.ok, 'dealer op without password → 401');
  r = await raw('POST', '', { op: 'archive', label: 'Tajný archiv' }, { 'x-dealer': 'mup-dealer' });
  ok(r.status === 401, 'default password refused when locked');
  r = await raw('POST', '', { op: 'archive', label: 'Tajný archiv' }, H);
  ok(r.j.ok && r.j.id, 'archive with the password');
  const id = r.j.id;
  const st = (await raw('GET')).j;
  const T = st.teams.map((t) => t.id);
  const reg = (await raw('POST', '', { op: 'register', name: 'Zamčená Studentka', team: T[0], pin: '1357' })).j;
  ok(reg.ok, 'students still register without a password');
  await raw('POST', '', { op: 'phase', phase: 'betting' }, H);
  ok((await raw('POST', '', { op: 'submit', sid: reg.sid, pin: '1357', in: { [T[1]]: { amt: 1e6, why: 'Tajný důvod' } }, notes: { [T[1]]: { like: 'Tajná poznámka', doubt: '' } } })).j.ok, 'student submit without a password');
  ok((await raw('POST', '', { op: 'quizStart', setId: 'blok2' })).status === 401, 'quizStart without password → 401');
  ok((await raw('POST', '', { op: 'pointsAdd', playerId: reg.sid, amt: 5, note: 'x' })).status === 401, 'pointsAdd without password → 401');
  ok((await raw('POST', '', { op: 'features', set: { market: true } })).status === 401, 'features without password → 401');
  ok((await raw('POST', '', { op: 'card', team: T[0], oneLiner: 'hack' })).status === 401 || !(await raw('GET')).j.cards?.[T[0]]?.oneLiner?.includes('hack'), 'dealer card op without password refused');
  section('dealer views stay private');
  for (const q of ['?view=archives', '?view=archive&id=' + id, '?view=data', '?view=log', '?view=dealer&dump=1']) {
    const g = await raw('GET', q);
    const leak = g.j.archives || g.j.archive || g.j.allocations || g.j.log || g.j.dealer || /Tajný důvod|Tajná poznámka|Tajný archiv/.test(g.t) || findKey(g.j, 'pin').length;
    ok(!leak, `GET ${q} without password leaks nothing`);
    const w = await raw('GET', q, null, { 'x-dealer': 'nope' });
    ok(!(w.j.archives || w.j.archive || w.j.allocations || w.j.log || w.j.dealer), `GET ${q} with a wrong password leaks nothing`);
  }
  const a = await raw('GET', '?view=archives', null, H);
  ok(a.j.ok && a.j.archives.some((x) => x.id === id), 'archives listed with the password');
  const d = await raw('GET', '?view=data', null, H);
  ok(d.j.ok && d.j.allocations.length >= 1, 'data view with the password');
  await srv.stop();
  if (mock) await mock.stop();
  void client;
});
