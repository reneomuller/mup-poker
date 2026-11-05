// /play access modes (V3 spec §9, §10). Loaded after common.js / play-kit.js and BEFORE play.js.
//   /play#login=<sid>:<token>  one-time login from the dealer's QR → new PIN shown once
//   /play?as=<sid>             dealer preview: read-only, never touches mup.sid / mup.pin
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = new URLSearchParams(location.search);
  const asSid = (qs.get('as') || '').trim();
  const on = !!asSid;
  let dealer = '';
  if (on) { try { dealer = localStorage.getItem('mup.dealer') || ''; } catch {} }
  const BLOCK = 'V náhledu nelze nic měnit.';
  const toast = (m, k) => { try { window.PK && PK.toast(esc(m), k); } catch {} };
  const PA = { on, sid: on ? asSid : null, dealer, loginError: null };

  if (on) {
    document.documentElement.classList.add('p-preview');
    document.body && document.body.classList.add('p-preview');
    // every GET: as=<sid> + x-dealer (and never the device's own x-sid / x-pin)
    const addAs = (q) => { q = q || ''; return q + (q.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(asSid); };
    const origGet = MUP.get;
    MUP.get = (headers = {}, q = '') => {
      const h = { ...headers }; delete h['x-sid']; delete h['x-pin'];
      return origGet({ ...h, 'x-dealer': dealer }, addAs(q));
    };
    // every POST is blocked on the client
    MUP.post = () => { toast(BLOCK, 'err'); return Promise.resolve({ ok: false, preview: true, error: BLOCK }); };
    PA.addAs = addAs;
    PA.headers = () => ({ 'x-dealer': dealer });

    // inputs and buttons disabled (navigation, the banner and pure view toggles stay usable)
    const KEEP = '[data-nav], .pa-keep, [data-tab], [data-act="msgs-toggle"], [data-act="quiz-close"], [aria-expanded], .p-top button';
    const lock = (root) => {
      (root || document).querySelectorAll('input, select, textarea, button').forEach((el) => {
        if (el.closest('.pa-bar, .pa-note') || el.matches(KEEP)) return;
        if (!el.disabled) { el.disabled = true; el.dataset.paLocked = '1'; }
      });
    };
    let lockQ = false;
    const mo = new MutationObserver(() => { if (lockQ) return; lockQ = true; requestAnimationFrame(() => { lockQ = false; lock(); }); });
    const startLock = () => { lock(); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] }); };
    // anything that still tries to submit or type gets the toast
    document.addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); toast(BLOCK, 'err'); }, true);
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-pa-locked]');
      if (b) { e.preventDefault(); e.stopPropagation(); toast(BLOCK, 'err'); }
    }, true);

    const bar = document.createElement('div');
    bar.className = 'pa-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<span class="pa-eye" aria-hidden="true"></span><span class="pa-t" id="pa-t">Náhled – jen pro čtení</span><button type="button" class="s-btn s-ghost s-sm pa-keep" id="pa-close">Zavřít</button>`;
    const close = () => { window.close(); setTimeout(() => { if (!window.closed) location.href = '/dealer'; }, 150); };
    const mountBar = () => { document.body.prepend(bar); bar.querySelector('#pa-close').onclick = close; };

    // play.js calls this after every GET
    let lastT = '';
    PA.update = (s) => {
      const me = s && s.me;
      if (!me) return;
      const t = (s.teams || []).find((x) => x.id === me.team);
      const txt = `Náhled: ${me.name} (${t ? t.name : me.team || '?'}) – jen pro čtení`;
      if (txt !== lastT) { lastT = txt; bar.querySelector('#pa-t').textContent = txt; }
    };
    // play.js calls this when the GET came back without `me` (server ignores as=, wrong password, unknown sid)
    PA.noMe = (s) => showNote(s && s.asDealer ? 'Hráč nenalezen.' : 'Server náhled nevrátil: zkontroluj heslo dealera (přihlas se znovu na /dealer) a odkaz na hráče.');
    function showNote(msg) {
      ['boot', 'login', 'game'].forEach((id) => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
      let n = document.getElementById('pa-note');
      if (!n) { n = document.createElement('section'); n.id = 'pa-note'; n.className = 'pa-note'; document.body.appendChild(n); }
      const html = `<div class="s-card p-card"><h2 class="s-h2">Náhled hráče</h2><p class="s-muted">${esc(msg)}</p><a class="s-btn s-primary s-block" href="/dealer">Otevřít /dealer</a></div>`;
      if (n.dataset.msg !== msg) { n.dataset.msg = msg; n.innerHTML = html; }
    }
    PA.stop = !dealer;
    const boot = () => {
      mountBar();
      if (!dealer) showNote('Náhled je jen pro dealera. Přihlas se nejdřív na /dealer na tomhle zařízení, pak náhled otevři znovu.');
      else startLock();
    };
    if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
  }

  // ---------- token login (§9) ----------
  const lm = !on && /^#login=([\w-]+):([\w-]+)$/.exec(location.hash);
  PA.login = lm ? { sid: lm[1], token: lm[2] } : null;
  PA.tokenLogin = async () => {
    const L = PA.login; PA.login = null;
    history.replaceState(null, '', location.pathname + location.search);
    if (!L) return null;
    const r = (await MUP.post({ op: 'tokenLogin', sid: L.sid, token: L.token })) || { ok: false, error: 'Něco se pokazilo.' };
    if (!r.ok || !r.sid || r.pin == null) {
      PA.loginError = r.error || 'Odkaz už neplatí. Požádej o nový.';
      // already logged in on this device: the login screen won't show, so say it in a toast
      let has = false; try { has = !!localStorage.getItem('mup.sid'); } catch {}
      if (has) { toast(PA.loginError, 'err'); PA.loginError = null; }
      return null;
    }
    const pin = String(r.pin).padStart(4, '0');
    try {
      localStorage.setItem('mup.sid', r.sid); localStorage.setItem('mup.pin', pin); localStorage.removeItem('mup.profile');
    } catch {}
    welcome(r.name, pin);
    return { sid: r.sid, pin };
  };
  function welcome(name, pin) {
    const m = document.createElement('div');
    m.className = 'pa-modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'pa-wh');
    m.innerHTML = `<div class="s-card p-card pa-welcome"><h2 class="s-h2" id="pa-wh">Jsi zpátky${name ? ', ' + esc(name) : ''}!</h2>
      <p>Tvůj nový PIN je <b class="pa-pin s-num">${esc(pin)}</b> – zapamatuj si ho.</p>
      <button type="button" class="s-btn s-primary s-block" id="pa-ok">OK</button></div>`;
    document.body.appendChild(m);
    const ok = m.querySelector('#pa-ok');
    ok.onclick = () => m.remove();
    setTimeout(() => ok.focus(), 50);
  }

  // styles for the banner, note and welcome card (kept here so play.css stays untouched)
  const st = document.createElement('style');
  st.textContent = `
.pa-bar { position: sticky; top: 0; z-index: 60; display: flex; align-items: center; gap: 10px; padding: 8px max(14px, env(safe-area-inset-left)); padding-top: max(8px, env(safe-area-inset-top));
  background: #F2B33D; color: #1b1300; font-size: 14px; font-weight: 600; line-height: 1.25; box-shadow: 0 2px 10px rgba(0,0,0,.35); }
.pa-bar .pa-t { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.pa-bar .pa-eye { width: 10px; height: 10px; border-radius: 50%; background: #1b1300; flex: none; }
.pa-bar .s-btn { flex: none; color: #1b1300; border-color: rgba(27,19,0,.45); background: rgba(255,255,255,.25); }
.p-preview .p-top { top: var(--pa-h, 0px); }
.p-preview [data-pa-locked] { cursor: not-allowed; }
.p-preview [class*="compos"], .p-preview [class*="Compos"] { display: none !important; }
.pa-note { max-width: 460px; margin: 0 auto; padding: 28px 16px; }
.pa-note .s-card { display: grid; gap: 12px; }
.pa-modal { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 16px; background: rgba(5,8,25,.72); }
.pa-welcome { width: 100%; max-width: 380px; display: grid; gap: 14px; text-align: center; }
.pa-welcome .pa-pin { font-size: 1.5em; letter-spacing: .12em; }
`;
  document.head.appendChild(st);
  if (on) {
    const setH = () => { const b = document.querySelector('.pa-bar'); if (b) document.documentElement.style.setProperty('--pa-h', b.offsetHeight + 'px'); };
    window.addEventListener('resize', setH); setTimeout(setH, 0); setTimeout(setH, 500);
  }

  window.PA = PA;
})();
