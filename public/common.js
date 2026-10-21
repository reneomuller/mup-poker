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
    if (j.content) setContent(j.content);
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

  // ---------- editable content (CMS) ----------
  // Defaults; overrides come from the server (dealer → Upravit texty) and win.
  const T = {
    'phase.lobby': 'Připojte se ke stolu',
    'phase.pitch': 'Pitch',
    'phase.betting': 'Investujte!',
    'phase.closed': 'Investování uzavřeno',
    'phase.showdown': 'Showdown',
    'phase.rj': 'Smart money odhaleno',
    'phase.final': 'Demo Day',

    'table.block': 'Blok {block} / {max}',
    'table.final': 'Finále',
    'table.pitchTitle': 'Pitch · {team}',
    'table.join.title': 'Připojte se ke stolu',
    'table.join.hint': 'Naskenujte kód, vyberte svůj tým a zvolte si PIN.',
    'table.qr': 'Hraj na mobilu',
    'table.pot': '{n} / {total} investovalo',
    'table.brand': 'RainbowJet × MUP',
    'table.badge': 'PITCHUJE',
    'table.seat.valuation': 'ocenění',
    'table.seat.invested': 'investice {amount}',
    'table.seat.leader': 'vede',
    'table.timeUp': 'Čas!',
    'table.board.kick': 'Blok {block} · ocenění startupů',
    'table.board.title': 'Jak se mění ocenění',
    'table.board.rankKick': 'Pořadí',
    'table.board.rankTitle': 'Stůl',
    'table.board.investors': 'Nejlepší investoři',
    'table.board.noInvestors': 'Zatím nikdo neinvestoval.',
    'table.board.same': 'beze změny',

    'play.login.title': 'Investiční stůl',
    'play.login.sub': 'RainbowJet × MUP',
    'play.login.tabNew': 'Jsem tu poprvé',
    'play.login.tabOld': 'Už hraju',
    'play.login.name': 'Jméno a příjmení',
    'play.login.team': 'Můj tým',
    'play.login.pinNew': 'Zvol si PIN (4 číslice)',
    'play.login.who': 'Kdo jsi',
    'play.login.pin': 'PIN',
    'play.login.goNew': 'Sednout ke stolu',
    'play.login.goOld': 'Přihlásit',
    'play.status.block': 'Blok {block} z {max}',
    'play.status.lobby': 'Sedíš u stolu',
    'play.status.lobbyHint': 'Počkej, až dealer otevře blok.',
    'play.status.pitch': 'Pitchuje {team}',
    'play.status.pitchHint': 'Piš si poznámky, investovat se bude po pitchích.',
    'play.status.closedHint': 'Čeká se na showdown na plátně.',
    'play.status.showdownHint': 'Peníze třídy jsou na stole. Sleduj plátno.',
    'play.status.rjHint': 'RainbowJet odhalil své investice.',
    'play.form.initTitle': 'Rozděl {capital}',
    'play.form.initHint': 'Investuj všechno, klidně jen do jednoho týmu. Do vlastního nemůžeš. U každé investice napiš proč a ke každému týmu, co tě zaujalo a čemu nevěříš. Probereme to po kole.',
    'play.form.go': 'Investovat',
    'play.form.rebTitle': 'Přeskládej portfolio',
    'play.form.rebHint': 'Můžeš vybrat až {max} a vložit je do jiných týmů. Nebo nech vše, jak je.',
    'play.form.outLabel': 'Vybrat',
    'play.form.inLabel': 'Vložit',
    'play.form.confirm': 'Potvrdit přesun',
    'play.form.hold': 'Nic neměním',
    'play.form.whyIn': 'Proč investuješ? (povinné)',
    'play.form.whyOut': 'Proč vybíráš? (povinné)',
    'play.form.sent': 'Odesláno ✓ Dokud se investování neuzavře, můžeš to ještě změnit a odeslat znovu.',
    'play.form.invested': 'Investováno ✓ Dokud se investování neuzavře, můžeš to ještě změnit.',
    'play.wait.initTitle': 'Máš {capital}',
    'play.wait.initHint': 'Po pitchích je rozdělíš mezi ostatní týmy. Investovat musíš všechno.',
    'play.wait.rebTitle': 'Tvoje investice běží',
    'play.wait.rebHint': 'V tomto bloku můžeš přesunout až {max}.',
    'play.fan.left': 'Zbývá rozdělit',
    'play.fan.done': 'Vše rozděleno ✓',
    'play.notes.title': 'Poznámky ke startupům',
    'play.notes.hint': 'Na diskusi po kole. Nejlepší odpovědi můžou jít bez jména na plátno.',
    'play.notes.like': 'Co tě zaujalo',
    'play.notes.likePh': 'Co tě na nápadu nebo týmu zaujalo?',
    'play.notes.doubt': 'Čemu nevěříš',
    'play.notes.doubtPh': 'Který předpoklad ti nesedí?',
    'play.pf.title': 'Moje portfolio',
    'play.pf.empty': 'Zatím nemáš žádné investice.',
    'play.msgs.title': 'Zprávy od RainbowJet',
    'play.msgs.hint': 'Vidí je jen tvůj tým.',

    'q.in': 'Proč investuješ?',
    'q.out': 'Proč vybíráš?',
    'q.like': 'Co tě zaujalo?',
    'q.doubt': 'Čemu nevěříš?',

    'dealer.title': 'Dealer',
    'dealer.btn.pitch': 'Spustit pitch',
    'dealer.btn.qa': '+2 min otázky',
    'dealer.btn.stop': 'Stop časovač',
    'dealer.btn.lobby': 'Lobby (QR kód)',
    'dealer.btn.open': 'Otevřít investování',
    'dealer.btn.close': 'Zavřít investování',
    'dealer.btn.showdown': 'Showdown třídy',
    'dealer.btn.rj': 'Odhalit smart money',
    'dealer.btn.next': 'Další blok →',
    'dealer.btn.final': 'Demo Day',
    'dealer.sec.bets': 'Investice v bloku {block}',
    'dealer.sec.rj': 'Smart money (RainbowJet + Dominik)',
    'dealer.sec.vals': 'Ocenění a zprávy týmům',
    'dealer.sec.players': 'Hráči',
    'dealer.sec.teams': 'Týmy',
    'dealer.sec.tools': 'Export a záloha',
  };
  let O = {}; // overrides
  let cv = '0'; // content version, part of re-render keys
  const t = (k, vars) => {
    let s = O[k] != null && O[k] !== '' ? O[k] : T[k] != null ? T[k] : k;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, v) => (vars[v] != null ? vars[v] : m));
    return s;
  };
  const PHASES = {};
  for (const p of ['lobby', 'pitch', 'betting', 'closed', 'showdown', 'rj', 'final']) Object.defineProperty(PHASES, p, { get: () => t('phase.' + p), enumerable: true });

  // Founders who started narrow; portraits load from Wikipedia at runtime unless a photo URL is set.
  const DEFAULT_FOUNDERS = [
    { name: 'Jeff Bezos', wiki: 'en/Jeff_Bezos', story: 'Amazon začal jako online knihkupectví.' },
    { name: 'Mark Zuckerberg', wiki: 'en/Mark_Zuckerberg', story: 'Facebook byl nejdřív jen pro studenty Harvardu.' },
    { name: 'Tobi Lütke', wiki: 'en/Tobias_Lütke', story: 'Shopify vznikl, když chtěl prodávat snowboardy online.' },
    { name: 'Pavel Baudiš', wiki: 'cs/Pavel_Baudiš', story: 'Avast začal programem proti jedinému viru.' },
    { name: 'Eduard Kučera', wiki: 'cs/Eduard_Kučera', story: 'Avast spoluzaložil v roce 1988 jako družstvo.' },
    { name: 'Max Levchin', wiki: 'en/Max_Levchin', story: 'PayPal se rozjel mezi uživateli eBay.' },
    { name: 'Brian Chesky', wiki: 'en/Brian_Chesky', story: 'Airbnb začalo nafukovacími matracemi pro hosty jedné konference.' },
  ];
  const FOUNDERS = DEFAULT_FOUNDERS.map((f) => ({ ...f }));
  let foundersKey = JSON.stringify(FOUNDERS);

  function setContent(c) {
    const next = (c && c.texts) || {};
    const v = String((c && c.v) || '0');
    if (v === cv) return false;
    cv = v; O = next;
    const f = c && Array.isArray(c.founders) && c.founders.length ? c.founders : DEFAULT_FOUNDERS;
    const fk = JSON.stringify(f);
    if (fk !== foundersKey) {
      foundersKey = fk;
      FOUNDERS.splice(0, FOUNDERS.length, ...f.map((x) => ({ ...x })));
      for (const k of Object.keys(portraits)) delete portraits[k];
      loadPortraits();
    }
    applyStatic();
    return true;
  }
  function applyStatic(root = document) {
    root.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  }
  const portraits = {};
  function loadPortraits() {
    let cached = {};
    try { cached = JSON.parse(localStorage.getItem('mup.portraits') || '{}'); } catch {}
    FOUNDERS.forEach((f, i) => {
      if (f.photo) { portraits[i] = f.photo; paint(i); return; }
      if (!f.wiki) return;
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
      const img = el.querySelector('img');
      if (portraits[i] && (!img || img.getAttribute('src') !== portraits[i])) el.innerHTML = `<img alt="" src="${esc(portraits[i])}" referrerpolicy="no-referrer">`;
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

  window.MUP = { esc, fmt, fmtM, sign, get, post, now, timeLeft, clock, poll, PHASES, FOUNDERS, DEFAULT_FOUNDERS, T, t, setContent, applyStatic, cv: () => cv, loadPortraits, billHTML, glassHTML, setGlass };
})();
