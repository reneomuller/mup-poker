// Shared helpers for all three screens.
(function () {
  const API = '/api/game';
  let offset = 0; // server clock - local clock

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nbsp = (s) => s.replace(/ | /g, ' ');
  const fmt = (n) => nbsp(Math.round(n || 0).toLocaleString('cs-CZ')) + ' $';
  const fmtM = (n) => {
    n = n || 0;
    const a = Math.abs(n);
    if (a >= 1e6) return nbsp((n / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: a >= 1e7 ? 1 : 2 })) + ' mil. $';
    if (a >= 1e3) return nbsp(Math.round(n / 1e3).toLocaleString('cs-CZ')) + ' tis. $';
    return fmt(n);
  };
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtM(Math.abs(n));

  async function get(headers = {}, q = '') {
    const r = await fetch(API + q, { headers, cache: 'no-store' });
    const j = await r.json();
    if (j.now) offset = j.now - Date.now();
    return j;
  }
  let chain = Promise.resolve();
  function post(body, headers = {}) {
    // one request at a time per device, so autosaves never race a submit
    const run = async () => {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      return r.json();
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }
  const now = () => Date.now() + offset;
  const timeLeft = (s) => (s.timerEnd ? Math.max(0, s.timerEnd - now()) : null);
  const clock = (ms) => { const t = Math.ceil(ms / 1000); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

  function poll(fn, ms) {
    let timer = null, stopped = false;
    const tick = async () => {
      if (stopped) return;
      try { await fn(); } catch (e) { console.warn(e); }
      timer = setTimeout(tick, document.hidden ? ms * 3 : ms);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }

  const PHASES = {
    lobby: 'Připojte se ke stolu',
    pitch: 'Pitch',
    betting: 'Investujte!',
    closed: 'Investování uzavřeno',
    showdown: 'Showdown',
    rj: 'Smart money odhaleno',
    final: 'Demo Day',
  };

  // Founders who started narrow; portraits load from Wikipedia at runtime.
  const FOUNDERS = [
    { name: 'Jeff Bezos', wiki: 'en/Jeff_Bezos', co: 'Amazon', story: 'Amazon začal jako online knihkupectví.' },
    { name: 'Mark Zuckerberg', wiki: 'en/Mark_Zuckerberg', co: 'Facebook', story: 'Facebook byl nejdřív jen pro studenty Harvardu.' },
    { name: 'Tobi Lütke', wiki: 'en/Tobias_Lütke', co: 'Shopify', story: 'Shopify vznikl, když chtěl prodávat snowboardy online.' },
    { name: 'Pavel Baudiš', wiki: 'cs/Pavel_Baudiš', co: 'Avast', story: 'Avast začal programem proti jedinému viru.' },
    { name: 'Eduard Kučera', wiki: 'cs/Eduard_Kučera', co: 'Avast', story: 'Avast spoluzaložil v roce 1988 jako družstvo.' },
    { name: 'Max Levchin', wiki: 'en/Max_Levchin', co: 'PayPal', story: 'PayPal se rozjel mezi uživateli eBay.' },
    { name: 'Brian Chesky', wiki: 'en/Brian_Chesky', co: 'Airbnb', story: 'Airbnb začalo nafukovacími matracemi pro hosty jedné konference.' },
  ];
  const portraits = {};
  function loadPortraits() {
    let cached = {};
    try { cached = JSON.parse(localStorage.getItem('mup.portraits') || '{}'); } catch {}
    FOUNDERS.forEach((f, i) => {
      if (cached[f.wiki]) { portraits[i] = cached[f.wiki]; paint(i); return; }
      const [lang, title] = f.wiki.split('/');
      fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
        .then((r) => r.json())
        .then((j) => {
          const src = j?.thumbnail?.source;
          if (!src) return;
          portraits[i] = src;
          cached[f.wiki] = src;
          try { localStorage.setItem('mup.portraits', JSON.stringify(cached)); } catch {}
          paint(i);
        })
        .catch(() => {});
    });
  }
  function paint(i) {
    document.querySelectorAll(`.bill[data-f="${i}"] .bill-face`).forEach((el) => {
      if (portraits[i] && !el.querySelector('img')) el.innerHTML = `<img alt="" src="${esc(portraits[i])}" referrerpolicy="no-referrer">`;
    });
  }
  function billHTML(i, label = '100K') {
    const k = ((i % FOUNDERS.length) + FOUNDERS.length) % FOUNDERS.length;
    const f = FOUNDERS[k];
    const ini = f.name.split(' ').map((w) => w[0]).join('');
    const face = portraits[k] ? `<img alt="" src="${esc(portraits[k])}" referrerpolicy="no-referrer">` : `<span class="ini">${esc(ini)}</span>`;
    return `<div class="bill" data-f="${k}" title="${esc(f.name)} · ${esc(f.story)}">
      <span class="bill-c tl">${label}</span><span class="bill-c br">${label}</span>
      <div class="bill-face">${face}</div>
      <div class="bill-name">${esc(f.name)}</div>
    </div>`;
  }

  function glassHTML() {
    // a heavy cut-crystal rocks glass, like the one on the table in the reference
    return `<svg class="glass" viewBox="0 0 140 124" aria-hidden="true">
      <defs>
        <linearGradient id="whisky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e09a3a"/><stop offset=".55" stop-color="#b8661b"/><stop offset="1" stop-color="#6e300a"/></linearGradient>
        <linearGradient id="crys" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".45" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity=".26"/></linearGradient>
        <clipPath id="glassIn"><path d="M19 17 L121 17 L115 90 L25 90 Z"/></clipPath>
        <clipPath id="glassCut"><path d="M14 12 L126 12 L119 104 Q118 108 113 108 L27 108 Q22 108 21 104 Z"/></clipPath>
      </defs>
      <ellipse cx="70" cy="114" rx="64" ry="8.5" fill="#b8913a" opacity=".9"/>
      <ellipse cx="70" cy="112.5" rx="55" ry="6" fill="#5e4718"/>
      <g clip-path="url(#glassIn)">
        <rect class="liquid" x="10" y="40" width="120" height="70" fill="url(#whisky)" opacity=".94"/>
        <ellipse class="surface" cx="70" cy="40" rx="50" ry="3.2" fill="#f6c779" opacity=".75"/>
      </g>
      <path d="M14 12 L126 12 L119 104 Q118 108 113 108 L27 108 Q22 108 21 104 Z" fill="url(#crys)" stroke="#efe9da" stroke-opacity=".8" stroke-width="2"/>
      <path d="M25 90 L115 90" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>
      <g clip-path="url(#glassCut)" stroke="#fff" stroke-opacity=".2" stroke-width="1.2" fill="none">
        <path d="M14 58 L38 108 M34 58 L58 108 M54 58 L78 108 M74 58 L98 108 M94 58 L118 108 M114 58 L126 82"/>
        <path d="M126 58 L102 108 M106 58 L82 108 M86 58 L62 108 M66 58 L42 108 M46 58 L22 108 M26 58 L14 82"/>
        <path d="M16 58 L124 58"/>
      </g>
      <path d="M22 18 L28 98" stroke="#fff" stroke-opacity=".55" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M118 22 L114 70" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }
  function setGlass(svg, frac) {
    if (!svg) return;
    frac = Math.max(0, Math.min(1, frac));
    const top = 88 - frac * 58; // full ~30, empty ~88
    svg.querySelector('.liquid').setAttribute('y', top);
    const s = svg.querySelector('.surface');
    s.setAttribute('cy', top);
    s.setAttribute('opacity', frac > 0.02 ? 0.75 : 0);
  }

  window.MUP = { esc, fmt, fmtM, sign, get, post, now, timeLeft, clock, poll, PHASES, FOUNDERS, loadPortraits, billHTML, glassHTML, setGlass };
})();
