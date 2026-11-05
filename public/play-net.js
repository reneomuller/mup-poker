// v4 guard: the phone on flaky school Wi-Fi (flag `guard`, default on).
// Wraps MUP.get / MUP.post (load after common.js, before play.js):
// - a slim offline banner when fetches fail or navigator.onLine is false, with exponential backoff
//   on polling (play.js asks PN.delay(ms)) and „Synchronizováno ✓“ when the connection is back;
// - a retry queue (localStorage) for the student's important writes: submit, notes, reasons,
//   wall posts / replies and the quiz answer (only within its window). Every queued write carries
//   a request id `rid`; the server runs the same sid:rid only once (api/_lib/guard.js), so a resend
//   after a lost response never doubles anything. Overwrites (submit, notes, reasons, quiz) keep
//   only the newest version; an identical wall post is kept once, with its first rid.
// With the flag off (or in the dealer preview) every call goes straight through, as in v3.
(function () {
  if (!window.MUP || window.PN) return;
  const origGet = MUP.get, origPost = MUP.post;
  const PREVIEW = !!(window.PA && window.PA.on);
  // op -> coalesce key ('' = keep each one, but merge identical bodies)
  const OPS = { submit: 'submit', notes: 'notes', reasons: 'reasons', quizAnswer: 'quiz', wallPost: '', wallReply: '' };
  const QK = 'mup.netq', KEEP = 10 * 60 * 1000, MAXQ = 30; // a queued write is given up after 10 min
  const QUEUED = 'Jsi offline – odešlu to, až se spojení vrátí.';
  // a queued wall post / reply counts as sent for the wall UI (it clears the composer, so nobody posts it
  // twice); the others report the queue honestly, so the phone never keeps a local copy the server may refuse
  const LATER = { wallPost: 1, wallReply: 1 };
  const queuedReply = (x, msg) => (LATER[x.body.op] ? { ok: true, queued: true } : { ok: false, net: true, queued: true, error: msg });
  let flag = true, fails = 0, down = false, quiz = null, flushing = null, okT = null;
  const waiters = new Map(); // rid -> resolve of the post() waiting for it

  const load = () => { try { const a = JSON.parse(localStorage.getItem(QK) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const save = () => { try { localStorage.setItem(QK, JSON.stringify(queue)); } catch {} };
  let queue = load().filter((x) => x && x.body && x.rid && x.exp > Date.now());
  const newRid = () => {
    const a = new Uint8Array(9);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.random() * 256));
    return 'r' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  };
  const sameBody = (a, b) => { const { rid: x, ...ra } = a, { rid: y, ...rb } = b; return JSON.stringify(ra) === JSON.stringify(rb); };

  // ---------- banner ----------
  const css = `body.pn-on #net { display: none !important; }
.pn-bar { position: fixed; z-index: 96; left: 50%; top: calc(6px + var(--p-safe-t, 0px)); transform: translateX(-50%); width: min(calc(100% - 24px), 520px);
  display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 6px 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; line-height: 1.3;
  color: #fff; background: #3A1830; border: 1px solid rgba(255, 92, 108, .5); box-shadow: 0 6px 20px rgba(0, 0, 0, .35); }
.pn-bar[hidden] { display: none; }
.pn-bar .pn-t { flex: 1; min-width: 0; }
.pn-bar .pn-dot { width: 8px; height: 8px; border-radius: 50%; background: #FF5C6C; flex: none; animation: pn-pulse 1.2s ease-in-out infinite; }
.pn-bar button { min-height: 32px; padding: 0 10px; border-radius: 9px; border: 1px solid rgba(255, 255, 255, .25); background: rgba(255, 255, 255, .08); color: inherit; font: inherit; font-size: 12px; font-weight: 700; }
.pn-bar.pn-ok { background: #0F3326; border-color: rgba(63, 207, 142, .55); }
.pn-bar.pn-ok .pn-dot { background: #3FCF8E; animation: none; }
.pn-bar.pn-ok button { display: none; }
@keyframes pn-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .pn-bar .pn-dot { animation: none; } }`;
  let bar = null, txt = null;
  function ensureBar() {
    if (bar || !document.body) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    bar = document.createElement('div');
    bar.className = 'pn-bar'; bar.hidden = true; bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite');
    bar.innerHTML = '<span class="pn-dot" aria-hidden="true"></span><span class="pn-t"></span><button type="button">Zkusit hned</button>';
    txt = bar.querySelector('.pn-t');
    bar.querySelector('button').onclick = () => { fails = Math.min(fails, 1); flush(); if (PN.kick) PN.kick(0); };
    document.body.appendChild(bar);
  }
  const cz = (n) => (n === 1 ? '1 změna čeká' : n >= 2 && n <= 4 ? `${n} změny čekají` : `${n} změn čeká`);
  function render() {
    if (!flag || PREVIEW) { if (bar) bar.hidden = true; document.body?.classList.remove('pn-on'); return; }
    ensureBar();
    if (!bar) return;
    document.body.classList.add('pn-on');
    if (down) {
      clearTimeout(okT); okT = null;
      bar.classList.remove('pn-ok');
      txt.textContent = 'Jsi offline – zkusím to znovu…' + (queue.length ? ` (${cz(queue.length)} na odeslání)` : '');
      bar.hidden = false;
    } else if (!okT) bar.hidden = true;
  }
  function flashOk() {
    ensureBar();
    if (!bar || !flag) return;
    bar.classList.add('pn-ok'); txt.textContent = 'Synchronizováno ✓'; bar.hidden = false;
    clearTimeout(okT);
    okT = setTimeout(() => { okT = null; bar.classList.remove('pn-ok'); render(); }, 1800);
  }

  // ---------- state ----------
  function offline() {
    fails++;
    if (!down && (fails >= 2 || navigator.onLine === false)) { down = true; render(); }
    else if (down) render();
  }
  function online() {
    fails = 0;
    if (down) {
      down = false;
      const sent = queue.length > 0;
      const done = () => { if (down || queue.length) return; flashOk(); try { if (PN.onSync) PN.onSync(sent); } catch {} };
      if (sent) flush().then(done); else done();
    } else if (queue.length && !flushing) flush();
    render();
  }

  // ---------- queue ----------
  function enqueue(body) {
    const op = body.op, key = OPS[op];
    const now = Date.now();
    let exp = now + KEEP;
    if (op === 'quizAnswer') {
      if (!quiz || quiz.state !== 'question') return null; // no open question known: send as is
      if (body.idx === undefined) body.idx = quiz.idx; // a late resend can never land on the next question
      exp = quiz.endsLocal ? quiz.endsLocal + 1200 : now + 30000; // the server's grace is 1.5 s
    }
    if (key) queue = queue.filter((x) => !(x.key === key && x.body.sid === body.sid)); // newest version wins…
    else {
      const twin = queue.find((x) => x.body.op === op && sameBody(x.body, body));
      if (twin) return twin; // …and an identical post is sent once, with its first rid
    }
    const item = { rid: body.rid || newRid(), key, exp, body: null };
    item.body = { ...body, rid: item.rid };
    queue.push(item);
    if (queue.length > MAXQ) queue.splice(0, queue.length - MAXQ);
    save();
    return item;
  }
  const settle = (rid, r) => { const w = waiters.get(rid); if (w) { waiters.delete(rid); w(r); } };
  function drop(item, r) {
    queue = queue.filter((x) => x !== item && x.rid !== item.rid); save();
    if (waiters.has(item.rid)) return settle(item.rid, r);
    // a write resent in the background that the server refused: say so once
    if (r && !r.ok && !/už máš/i.test(r.error || '') && window.PK && PK.toast) PK.toast(`Neodesláno: ${MUP.esc(r.error || 'chyba')}`, 'err');
  }
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      while (queue.length) {
        const item = queue[0];
        if (item.exp <= Date.now()) {
          drop(item, { ok: false, error: item.body.op === 'quizAnswer' ? 'Odpověď nedorazila včas.' : 'Spojení vypadlo příliš dlouho.' });
          continue;
        }
        const r = await origPost(item.body);
        if (r && r.pending) { // the first copy is still running on the server: ask again in a moment
          for (const x of queue) settle(x.rid, queuedReply(x, 'Odesílám…'));
          setTimeout(flush, 1500);
          return;
        }
        if (r && r.net) { // still offline: keep it
          fails = Math.max(fails, 1); offline();
          for (const x of queue) settle(x.rid, queuedReply(x, QUEUED));
          return;
        }
        fails = 0;
        drop(item, r || { ok: false, error: 'Něco se pokazilo.' });
      }
    })().finally(() => { flushing = null; render(); });
    return flushing;
  }

  // ---------- wrapped API ----------
  MUP.get = async function (headers, q) {
    let j;
    try { j = await origGet(headers, q); } catch (e) { if (!q) offline(); throw e; }
    if (j && !q) {
      if (j.features) flag = j.features.guard !== false;
      const z = j.quiz;
      quiz = z ? { state: z.state, idx: z.idx, endsLocal: z.endsAt ? Date.now() + (z.endsAt - (j.now || Date.now())) : 0 } : null;
      online();
    }
    return j;
  };
  MUP.post = function (body, headers) {
    if (!flag || PREVIEW || !body || !(body.op in OPS) || !body.sid) {
      return origPost(body, headers).then((r) => { if (r && r.net) offline(); return r; });
    }
    const item = enqueue({ ...body });
    if (!item) return origPost(body, headers).then((r) => { if (r && r.net) offline(); return r; });
    return new Promise((resolve) => {
      const prev = waiters.get(item.rid);
      waiters.set(item.rid, (r) => { if (prev) prev(r); resolve(r); });
      if (flushing) flushing.then(() => { if (waiters.has(item.rid)) flush(); });
      else flush();
    });
  };

  window.addEventListener('offline', () => { fails = Math.max(fails, 1); offline(); });
  window.addEventListener('online', () => { fails = 0; flush(); if (PN.kick) PN.kick(0); });

  const PN = window.PN = {
    // poll interval: normal when online, exponential backoff (2 s … 15 s) while offline
    delay(ms) { return flag && down ? Math.min(15000, 2000 * Math.pow(2, Math.max(0, fails - 2))) + Math.round(Math.random() * 400) : ms; },
    kick: null, // play.js: its poll kick (retry button, back online)
    onSync: null, // play.js: called when the connection is back and the queue is empty (arg: something was sent)
    pending: () => queue.length,
    get offline() { return down; },
  };
  if (queue.length) setTimeout(flush, 1500); // writes left over from a page reload
  document.addEventListener('DOMContentLoaded', render);
})();
