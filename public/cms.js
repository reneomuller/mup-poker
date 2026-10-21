(function () {
  const { esc, get, post, T, billHTML, loadPortraits, DEFAULT_FOUNDERS } = MUP;
  const $ = (id) => document.getElementById(id);
  const H = () => ({ 'x-dealer': localStorage.getItem('mup.dealer') || '' });
  const LONG = /Hint|hint|initHint|rebHint|sent|invested|join\.hint/;

  // What each screen shows, grouped like the screen itself.
  const SCHEMA = {
    table: {
      label: 'Plátno (projektor)', src: '/table', w: 1600, h: 900,
      groups: [
        ['Nadpisy fází (plátno i mobily)', [
          ['phase.lobby', 'Před začátkem'], ['phase.pitch', 'Pitch'], ['phase.betting', 'Investování otevřené'], ['phase.closed', 'Investování uzavřené'],
          ['phase.showdown', 'Showdown'], ['phase.rj', 'Po odhalení smart money'], ['phase.final', 'Demo Day'],
        ]],
        ['Stůl', [
          ['table.block', 'Blok nahoře', '{block} {max}'], ['table.final', 'Blok nahoře ve finále'], ['table.pitchTitle', 'Nadpis při pitchi', '{team}'],
          ['table.join.title', 'Připojení: nadpis'], ['table.join.hint', 'Připojení: návod'], ['table.qr', 'Malý QR kód: popisek'],
          ['table.pot', 'Pod hromádkou investic', '{n} {total}'], ['table.badge', 'Štítek u pitchujícího týmu'],
          ['table.seat.valuation', 'Pod oceněním (bez investic)'], ['table.seat.invested', 'Pod oceněním (s investicemi)', '{amount}'], ['table.seat.leader', 'Vedoucí tým'],
          ['table.timeUp', 'Konec časovače'], ['table.brand', 'Patička'],
        ]],
        ['Žebříček', [
          ['table.board.kick', 'Nadpis nad grafem', '{block}'], ['table.board.title', 'Graf: nadpis'], ['table.board.rankKick', 'Pořadí: nad nadpisem'],
          ['table.board.rankTitle', 'Pořadí: nadpis'], ['table.board.investors', 'Nejlepší investoři'], ['table.board.noInvestors', 'Když nikdo neinvestoval'], ['table.board.same', 'Beze změny'],
        ]],
        ['Otázky v bublinách na plátně', [
          ['q.in', 'K důvodu investice'], ['q.out', 'K důvodu výběru'], ['q.like', 'K poznámce „zaujalo“'], ['q.doubt', 'K poznámce „nevěří“'],
        ]],
      ],
    },
    play: {
      label: 'Mobil studenta', src: '/play', phone: true,
      groups: [
        ['Přihlášení', [
          ['play.login.title', 'Nadpis'], ['play.login.sub', 'Podnadpis'], ['play.login.tabNew', 'Záložka: noví'], ['play.login.tabOld', 'Záložka: vracející se'],
          ['play.login.name', 'Pole: jméno'], ['play.login.team', 'Pole: tým'], ['play.login.pinNew', 'Pole: nový PIN'], ['play.login.goNew', 'Tlačítko: noví'],
          ['play.login.who', 'Pole: kdo jsi'], ['play.login.pin', 'Pole: PIN'], ['play.login.goOld', 'Tlačítko: přihlásit'],
        ]],
        ['Stav nahoře', [
          ['play.status.block', 'Blok', '{block} {max}'], ['play.status.lobby', 'Před začátkem'], ['play.status.lobbyHint', 'Před začátkem: popisek'],
          ['play.status.pitch', 'Při pitchi', '{team}'], ['play.status.pitchHint', 'Při pitchi: popisek'], ['play.status.closedHint', 'Po uzavření'],
          ['play.status.showdownHint', 'Po showdownu'], ['play.status.rjHint', 'Po smart money'],
        ]],
        ['Investování', [
          ['play.form.initTitle', 'První kolo: nadpis', '{capital}'], ['play.form.initHint', 'První kolo: návod'], ['play.form.go', 'Tlačítko: investovat'],
          ['play.form.rebTitle', 'Další kola: nadpis'], ['play.form.rebHint', 'Další kola: návod', '{max}'], ['play.form.outLabel', 'Sekce: vybrat'], ['play.form.inLabel', 'Sekce: vložit'],
          ['play.form.confirm', 'Tlačítko: potvrdit přesun'], ['play.form.hold', 'Tlačítko: nic neměním'], ['play.form.whyIn', 'Pole: proč investuješ'], ['play.form.whyOut', 'Pole: proč vybíráš'],
          ['play.form.sent', 'Po odeslání'], ['play.form.invested', 'Po investování'], ['play.fan.left', 'Bankovky: zbývá'], ['play.fan.done', 'Bankovky: hotovo'],
        ]],
        ['Mezi koly', [
          ['play.wait.initTitle', 'Před 1. investicí: nadpis', '{capital}'], ['play.wait.initHint', 'Před 1. investicí: popisek'],
          ['play.wait.rebTitle', 'Další bloky: nadpis'], ['play.wait.rebHint', 'Další bloky: popisek', '{max}'],
        ]],
        ['Poznámky, portfolio, zprávy', [
          ['play.notes.title', 'Poznámky: nadpis'], ['play.notes.hint', 'Poznámky: popisek'], ['play.notes.like', 'Pole: zaujalo'], ['play.notes.likePh', 'Pole: zaujalo (nápověda)'],
          ['play.notes.doubt', 'Pole: nevěří'], ['play.notes.doubtPh', 'Pole: nevěří (nápověda)'], ['play.pf.title', 'Portfolio: nadpis'], ['play.pf.empty', 'Portfolio: prázdné'],
          ['play.msgs.title', 'Zprávy od RJ: nadpis'], ['play.msgs.hint', 'Zprávy od RJ: popisek'],
        ]],
      ],
    },
    dealer: {
      label: 'Dealer (my)', src: '/dealer', w: 1180, h: 900,
      groups: [
        ['Tlačítka', [
          ['dealer.btn.pitch', 'Spustit pitch'], ['dealer.btn.qa', 'Otázky'], ['dealer.btn.stop', 'Stop časovač'], ['dealer.btn.lobby', 'Lobby'],
          ['dealer.btn.open', 'Otevřít investování'], ['dealer.btn.close', 'Zavřít investování'], ['dealer.btn.showdown', 'Showdown'],
          ['dealer.btn.rj', 'Odhalit smart money'], ['dealer.btn.next', 'Další blok'], ['dealer.btn.final', 'Demo Day'],
        ]],
        ['Sekce', [
          ['dealer.title', 'Nadpis stránky'], ['dealer.sec.bets', 'Investice', '{block}'], ['dealer.sec.rj', 'Smart money'], ['dealer.sec.vals', 'Ocenění a zprávy'],
          ['dealer.sec.players', 'Hráči'], ['dealer.sec.teams', 'Týmy'], ['dealer.sec.tools', 'Export a záloha'],
        ]],
      ],
    },
    bills: { label: 'Bankovky (mobil)', src: '/', phone: true },
  };

  let content = { texts: {}, founders: null }, vals = {}, founders = [], tab = 'table', dirty = false;

  function markDirty(on = true) { dirty = on; $('status').textContent = on ? 'Neuložené změny' : ''; }

  function fieldHTML([key, label, vars]) {
    const def = T[key] || '';
    const cur = vals[key] ?? def;
    const long = LONG.test(key) || def.length > 60;
    const ctl = long
      ? `<textarea class="input" rows="3" data-k="${key}" placeholder="${esc(def)}">${esc(cur)}</textarea>`
      : `<input class="input" data-k="${key}" value="${esc(cur)}" placeholder="${esc(def)}">`;
    return `<div class="f ${cur !== def ? 'changed' : ''}" data-f="${key}"><div class="top"><span class="name">${esc(label)}</span>${vars ? `<span class="vars">${esc(vars)}</span>` : ''}
      <button class="reset" data-r="${key}" ${cur !== def ? '' : 'hidden'}>výchozí</button></div>${ctl}</div>`;
  }

  function renderEditor() {
    const sc = SCHEMA[tab];
    if (tab === 'bills') return renderBills();
    $('editor').innerHTML = sc.groups.map(([g, fields]) => `<div class="group"><h2>${esc(g)}</h2>${fields.map(fieldHTML).join('')}</div>`).join('') +
      '<p class="muted small">Proměnné ve složených závorkách (např. {team}) se doplní samy. Prázdné pole = výchozí text.</p>';
    $('editor').querySelectorAll('[data-k]').forEach((el) => el.addEventListener('input', () => {
      const k = el.dataset.k;
      vals[k] = el.value;
      const box = el.closest('.f');
      const changed = el.value !== (T[k] || '');
      box.classList.toggle('changed', changed);
      box.querySelector('.reset').hidden = !changed;
      markDirty();
    }));
    $('editor').querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.r, el = $('editor').querySelector(`[data-k="${k}"]`);
      el.value = T[k] || ''; el.dispatchEvent(new Event('input'));
    }));
  }

  function renderBills() {
    MUP.FOUNDERS.splice(0, MUP.FOUNDERS.length, ...founders.map((f) => ({ ...f })));
    $('editor').innerHTML = `<div class="group"><h2>Zakladatelé na bankovkách</h2>
      <p class="muted small" style="margin-bottom:10px">Fotka se načte z Wikipedie podle odkazu (např. en/Jeff_Bezos nebo cs/Pavel_Baudiš). Pokud tam fotka není, vložte přímý odkaz na obrázek (https://…).</p>
      ${founders.map((f, i) => `<div class="f" data-i="${i}"><div class="bill-ed"><div>${billHTML(i)}<button class="btn sm ghost rm" data-rm="${i}">Odebrat</button></div>
        <div class="brow2"><input class="input" data-b="name" value="${esc(f.name)}" placeholder="Jméno">
        <input class="input" data-b="wiki" value="${esc(f.wiki || '')}" placeholder="Wikipedie (en/Jmeno)">
        <input class="input full" data-b="story" value="${esc(f.story || '')}" placeholder="Jedna věta: jak začal úzce">
        <input class="input full" data-b="photo" value="${esc(f.photo || '')}" placeholder="Vlastní fotka (https://…), nepovinné"></div></div></div>`).join('')}
      <div class="actions"><button class="btn ghost" id="addb">+ Přidat bankovku</button><button class="btn ghost" id="defb">Vrátit výchozí zakladatele</button></div></div>`;
    loadPortraits();
    $('editor').querySelectorAll('[data-b]').forEach((el) => el.addEventListener('input', () => {
      const i = +el.closest('[data-i]').dataset.i;
      founders[i][el.dataset.b] = el.value;
      markDirty();
    }));
    $('editor').querySelectorAll('[data-b="photo"],[data-b="wiki"],[data-b="name"]').forEach((el) => el.addEventListener('change', renderBills));
    $('editor').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { founders.splice(+b.dataset.rm, 1); markDirty(); renderBills(); }));
    $('addb').onclick = () => { founders.push({ name: 'Nový zakladatel', wiki: '', story: '', photo: '' }); markDirty(); renderBills(); };
    $('defb').onclick = () => { founders = DEFAULT_FOUNDERS.map((f) => ({ ...f, photo: '' })); markDirty(); renderBills(); };
  }

  function renderPreview() {
    const sc = SCHEMA[tab], fr = $('frame');
    $('pvlabel').textContent = 'Náhled: ' + sc.label;
    fr.className = 'frame' + (sc.phone ? ' phone' : '');
    if (sc.phone) {
      fr.innerHTML = `<div class="device"><iframe src="${sc.src}" title="Náhled"></iframe></div>`;
      const dev = fr.querySelector('.device');
      const fit = () => { const k = Math.min(1, (fr.clientHeight - 10) / 820); dev.style.transform = `scale(${k})`; };
      fit(); window.onresize = fit;
    } else {
      fr.innerHTML = `<iframe src="${sc.src}" title="Náhled" style="width:${sc.w}px;height:${sc.h}px"></iframe>`;
      const ifr = fr.querySelector('iframe');
      const fit = () => { const k = Math.min(fr.clientWidth / sc.w, fr.clientHeight / sc.h); ifr.style.transform = `scale(${k})`; };
      fit(); window.onresize = fit;
    }
  }

  function switchTab(t) {
    tab = t;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    renderEditor(); renderPreview();
  }
  document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

  $('save').onclick = async () => {
    const texts = {};
    for (const [k, v] of Object.entries(vals)) if (v.trim() && v !== (T[k] || '')) texts[k] = v;
    const same = JSON.stringify(founders.map(({ name, wiki, story }) => ({ name, wiki, story }))) === JSON.stringify(DEFAULT_FOUNDERS.map(({ name, wiki, story }) => ({ name, wiki, story }))) && founders.every((f) => !f.photo);
    $('save').disabled = true;
    const r = await post({ op: 'content', texts, founders: same ? null : founders }, H());
    $('save').disabled = false;
    if (!r.ok) { $('status').textContent = r.error || 'Chyba'; return; }
    markDirty(false);
    $('status').textContent = 'Uloženo ✓';
    setTimeout(() => { if (!dirty) $('status').textContent = ''; }, 2500);
  };
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  (async function init() {
    const s = await get();
    content = s.content || content;
    vals = { ...(content.texts || {}) };
    founders = (content.founders && content.founders.length ? content.founders : DEFAULT_FOUNDERS).map((f) => ({ photo: '', ...f }));
    switchTab('table');
  })();
})();
