(function () {
  const { esc, fmt, fmtM, get, post, timeLeft, clock, poll, PHASES } = MUP;
  const $ = (id) => document.getElementById(id);
  let pw = localStorage.getItem('mup.dealer') || '';
  let S = null, D = null, keys = {};
  const H = () => ({ 'x-dealer': pw });
  const team = (id) => S.teams.find((t) => t.id === id) || { name: id, color: '#888' };
  const parseAmt = (v) => Math.max(0, Math.round(Number(String(v).replace(/[^\d]/g, '')) || 0));
  const plain = (n) => Math.round(n || 0).toLocaleString('cs-CZ');
  const once = (k, v) => { const j = JSON.stringify(v); if (keys[k] === j) return false; keys[k] = j; return true; };

  async function act(op, extra = {}, okMsg) {
    const r = await post({ op, ...extra }, H());
    if (!r.ok) { alert(r.error || 'Chyba'); return r; }
    if (okMsg) flash(okMsg);
    setTimeout(tick, 150);
    return r;
  }
  function flash(t) { const s = $('dsub'); const old = s.textContent; s.textContent = t; s.classList.add('ok'); setTimeout(() => { s.classList.remove('ok'); s.textContent = old; }, 2500); }

  // ---------- login ----------
  async function tryLogin(p) {
    const r = await post({ op: 'auth' }, { 'x-dealer': p });
    if (r.ok) { pw = p; localStorage.setItem('mup.dealer', p); start(); return true; }
    return false;
  }
  $('dgo').onclick = async () => { if (!(await tryLogin($('dpw').value))) $('derr').textContent = 'Špatné heslo.'; };
  $('dpw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dgo').click(); });

  // ---------- control ----------
  function renderCtrl() {
    const s = S, left = timeLeft(s);
    const settledC = D.settled[s.block + 'c'], settledR = D.settled[s.block + 'r'];
    const teamOpts = s.teams.map((t) => `<option value="${t.id}" ${s.presenting === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const key = [s.phase, s.block, s.presenting, settledC, settledR, s.screen, s.regOpen, s.teams.map((t) => t.name)];
    if (once('ctrl', key)) {
      $('ctrl').innerHTML = `
        <div class="lbl">Blok ${s.block} / ${s.maxBlock}</div>
        <div class="phase">${esc(s.phase === 'pitch' ? 'Pitch · ' + team(s.presenting).name : PHASES[s.phase])}</div>
        <div class="muted small" id="tleft"></div>
        <div class="inline"><select class="input" id="pteam">${teamOpts}</select>
          <input class="input num" id="pmin" value="3" inputmode="decimal"> min
          <button class="btn sm" id="bpitch">Spustit pitch</button>
          <button class="btn sm ghost" id="bqa">+2 min otázky</button>
          <button class="btn sm ghost" id="bstop">Stop časovač</button></div>
        <div class="flow">
          <button class="btn ghost ${s.phase === 'lobby' ? 'cur' : ''}" id="blobby">Lobby (QR kód)</button>
          <button class="btn ${s.phase === 'betting' ? 'cur' : ''}" id="bbet" ${settledC ? 'disabled' : ''}>Otevřít sázky</button>
          <button class="btn ${s.phase === 'closed' ? 'cur' : ''}" id="bclose" ${settledC || s.phase !== 'betting' ? 'disabled' : ''}>Zavřít sázky</button>
          <button class="btn ${s.phase === 'showdown' ? 'cur' : ''}" id="bshow" ${settledC || !['betting', 'closed'].includes(s.phase) ? 'disabled' : ''}>Showdown třídy</button>
          <button class="btn ${s.phase === 'rj' ? 'cur' : ''}" id="brj" ${!settledC || settledR ? 'disabled' : ''}>Odhalit smart money</button>
          ${s.block < s.maxBlock ? `<button class="btn ghost" id="bnext">Další blok →</button>` : `<button class="btn ghost ${s.phase === 'final' ? 'cur' : ''}" id="bfinal">Demo Day</button>`}
        </div>
        <div class="inline"><span class="lbl">Sázky na</span><input class="input num" id="bmin" value="8" inputmode="decimal"> min
          <span class="lbl" style="margin-left:auto">Plátno</span>
          <button class="btn sm ${s.screen === 'table' ? '' : 'ghost'}" id="sct">Stůl</button>
          <button class="btn sm ${s.screen === 'board' ? '' : 'ghost'}" id="scb">Žebříček</button></div>`;
      $('bpitch').onclick = () => act('phase', { phase: 'pitch', team: $('pteam').value, minutes: Number($('pmin').value.replace(',', '.')) || 0, label: 'Pitch' });
      $('bqa').onclick = () => act('timer', { minutes: 2, label: 'Otázky' });
      $('bstop').onclick = () => act('timer', { minutes: 0 });
      $('blobby').onclick = () => act('phase', { phase: 'lobby' });
      $('bbet').onclick = () => act('phase', { phase: 'betting', minutes: Number($('bmin').value.replace(',', '.')) || 0, label: 'Sázky' });
      $('bclose').onclick = () => act('phase', { phase: 'closed' });
      $('bshow').onclick = async () => {
        if (!confirm(`Spustit showdown? Započítá se ${S.betCount} sázek z ${S.playerCount}. Kdo nevsadil, v tomto bloku nic neinvestuje.`)) return;
        const r = await act('showdown');
        if (r.ok && r.skipped?.length) alert('Neplatné sázky (nezapočítány):\n' + r.skipped.map((x) => `${x.name}: ${x.error}`).join('\n'));
      };
      $('brj').onclick = () => act('rjReveal');
      if ($('bnext')) $('bnext').onclick = () => { if (confirm(`Uzavřít blok ${S.block} a přejít na blok ${S.block + 1}?`)) act('nextBlock'); };
      if ($('bfinal')) $('bfinal').onclick = () => act('phase', { phase: 'final' });
      $('sct').onclick = () => act('screen', { screen: 'table' });
      $('scb').onclick = () => act('screen', { screen: 'board' });
    }
    $('tleft').textContent = left === null ? 'Bez časovače' : `${s.timerLabel || 'Časovač'}: ${left > 0 ? clock(left) : 'čas vypršel'}`;
    $('dsub').textContent = `${s.playerCount} hráčů · ${s.betCount} sázek v bloku ${s.block}`;
  }

  // ---------- bets + call list ----------
  function renderBets() {
    const rows = D.rows.slice().sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
    const c = D.calls;
    if (!once('bets', [rows.map((r) => [r.id, r.slip?.ts, r.slip?.submitted]), c, S.phase])) return;
    const line = (r) => {
      const s = r.slip, sub = s?.submitted;
      const parts = [...Object.entries(s?.out || {}).map(([t, e]) => `−${fmtM(e.amt)} ${team(t).name}`), ...Object.entries(s?.in || {}).map(([t, e]) => `+${fmtM(e.amt)} ${team(t).name}`)];
      const reasons = [
        ...Object.entries(s?.out || {}).map(([t, e]) => `<div class="reason">Vybral z ${esc(team(t).name)} (${esc(fmt(e.amt))}): ${esc(e.why)}</div>`),
        ...Object.entries(s?.in || {}).map(([t, e]) => `<div class="reason">${esc(team(t).name)} (${esc(fmt(e.amt))}): ${esc(e.why)}</div>`),
        ...Object.entries(s?.notes || {}).map(([t, n]) => `<div class="reason">Poznámka k ${esc(team(t).name)}: ${esc(n)}</div>`),
      ].join('');
      return `<details class="brow"><summary><span><span class="dot" style="background:${team(r.team).color}"></span> ${esc(r.name)}</span>
        <span class="${sub ? 'ok' : 'no'}">${sub ? (parts.length ? esc(parts.join(', ')) : 'beze změny') : 'ještě nevsadil'}</span></summary>${reasons || '<div class="reason">Nic.</div>'}</details>`;
    };
    const call = (title, items) => items.length ? `<div class="lbl sec">${title}</div>` + items.join('') : '';
    $('bets').innerHTML = `<h3>Sázky v bloku ${S.block}</h3>
      ${call('Koho vyvolat', [
        ...c.big.map((b) => `<div class="call"><b>${esc(b.name)}</b> (${esc(b.team)}) dal <b>${esc(fmtM(b.amt))}</b> do ${esc(b.target)}<div class="why">„${esc(b.why)}“</div></div>`),
        ...c.lone.map((b) => `<div class="call">Jediný, kdo věří týmu <b>${esc(b.target)}</b>: <b>${esc(b.name)}</b> (${esc(fmtM(b.amt))})<div class="why">„${esc(b.why)}“</div></div>`),
        ...c.conc.filter((x) => x.share >= 0.5).map((x) => `<div class="call"><b>${esc(x.name)}</b> vsadil ${Math.round(x.share * 100)} % do ${esc(x.target)}</div>`),
        ...c.outs.map((b) => `<div class="call"><b>${esc(b.name)}</b> vybral ${esc(fmtM(b.amt))} z ${esc(b.target)}<div class="why">„${esc(b.why)}“</div></div>`),
        ...(c.none.length ? [`<div class="call">Od třídy nedostal nic: <b>${esc(c.none.join(', '))}</b></div>`] : []),
      ])}
      <div class="lbl sec">Všichni hráči</div>${rows.map(line).join('') || '<p class="hint">Zatím nikdo není u stolu.</p>'}`;
  }

  // ---------- RJ smart money ----------
  function renderRJ() {
    const rj = D.rj, R = rj.rules, settledR = D.settled[S.block + 'r'];
    if (!once('rj', [S.block, R, rj.slip?.ts, settledR, rj.stakes, S.teams.map((t) => t.name)])) return;
    const init = R.mode === 'initial';
    const sl = rj.slip || {};
    $('rj').innerHTML = `<h3>Smart money (RainbowJet + Dominik)</h3>
      <p class="hint">${init ? `Rozdělte ${esc(fmt(R.capital))} (5 × 2 mil.). Studenti to uvidí až po odhalení.` : `Fond má ${esc(fmt(rj.portfolio))}. Můžete vybrat až ${esc(fmt(R.cashoutMax))} (30 %) a vložit jinam.`}</p>
      ${settledR ? '<div class="done">V tomto bloku už odhaleno ✓</div>' : sl.submitted ? '<div class="done">Uloženo, čeká na odhalení ✓</div>' : ''}
      <div class="rjrow rjhead"><span>Tým</span><span>${init ? '' : 'Vybrat $'}</span><span>Vložit $</span></div>
      ${S.teams.map((t) => `<div class="rjrow" data-t="${t.id}"><span><span class="dot" style="background:${t.color}"></span> ${esc(t.name)}${init ? '' : `<br><span class="muted small">máte ${esc(fmtM(rj.stakes[t.id] || 0))}</span>`}</span>
        ${init ? '<span></span>' : `<input class="input ro" inputmode="numeric" value="${plain(sl.out?.[t.id]?.amt)}">`}
        <input class="input ri" inputmode="numeric" value="${plain(sl.in?.[t.id]?.amt)}"></div>`).join('')}
      <div class="sum" id="rjsum"></div>
      <div class="field"><label class="lbl">Proč (jedna věta pro všechny)</label><input class="input" id="rjwhy" value="${esc(Object.values(sl.in || {})[0]?.why || '')}" placeholder="např. tým nejlíp zná svého zákazníka"></div>
      <button class="btn" id="rjsave" ${settledR ? 'disabled' : ''}>Uložit smart money</button><div class="err msg" id="rjerr"></div>`;
    const recalc = () => {
      let o = 0, i = 0;
      $('rj').querySelectorAll('.rjrow[data-t]').forEach((row) => { o += parseAmt(row.querySelector('.ro')?.value || 0); i += parseAmt(row.querySelector('.ri').value); });
      $('rjsum').innerHTML = init ? `<span>Rozděleno</span><b>${esc(fmt(i))} / ${esc(fmtM(R.capital))}</b>` : `<span>Vybráno ${esc(fmt(o))}</span><b>vloženo ${esc(fmt(i))}</b>`;
      $('rjsum').classList.toggle('good', init ? i === R.capital : i === o && o <= R.cashoutMax);
    };
    $('rj').querySelectorAll('input.ro, input.ri').forEach((inp) => {
      inp.addEventListener('input', recalc);
      inp.addEventListener('blur', () => { inp.value = plain(parseAmt(inp.value)); });
    });
    recalc();
    $('rjsave').onclick = async () => {
      const why = $('rjwhy').value.trim() || 'Smart money';
      const out = {}, inn = {};
      $('rj').querySelectorAll('.rjrow[data-t]').forEach((row) => {
        const t = row.dataset.t, o = parseAmt(row.querySelector('.ro')?.value || 0), i = parseAmt(row.querySelector('.ri').value);
        if (o) out[t] = { amt: o, why }; if (i) inn[t] = { amt: i, why };
      });
      const r = await post({ op: 'rjSave', out, in: inn }, H());
      $('rjerr').textContent = r.ok ? '' : r.error;
      if (r.ok) { flash('Smart money uloženo'); keys.rj = null; tick(); }
    };
  }

  // ---------- valuations ----------
  function renderVals() {
    if (!once('vals', [S.teams.map((t) => [t.name, t.V, t.cls, t.rj]), S.phase])) return;
    const locked = ['betting', 'closed'].includes(S.phase);
    $('vals').innerHTML = `<h3>Ocenění</h3><p class="hint">Zadejte nové ocenění v milionech $ (např. 14,5). Ceny podílů se přepočítají a studentům se pohnou portfolia.</p>
      ${S.teams.map((t) => `<div class="vrow" data-t="${t.id}"><div><span class="dot" style="background:${t.color}"></span> <b>${esc(t.name)}</b>
        <div class="meta">teď ${esc(fmtM(t.V))} · třída ${esc(fmtM(t.cls))} · RJ ${esc(fmtM(t.rj))}</div></div>
        <input class="input" inputmode="decimal" placeholder="${(t.V / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })}"></div>`).join('')}
      <button class="btn" id="vsave" ${locked ? 'disabled' : ''}>Přecenit</button> ${locked ? '<span class="muted small">Během sázek nelze.</span>' : ''}`;
    $('vsave').onclick = () => {
      const V = {};
      $('vals').querySelectorAll('.vrow').forEach((row) => {
        const v = row.querySelector('input').value.trim().replace(/\s/g, '').replace(',', '.');
        if (v) V[row.dataset.t] = Math.round(Number(v) * 1e6);
      });
      if (!Object.keys(V).length) return alert('Zadejte aspoň jedno nové ocenění.');
      const lines = Object.entries(V).map(([t, v]) => `${team(t).name}: ${fmtM(v)}`).join('\n');
      if (confirm('Přecenit?\n' + lines)) { keys.vals = null; act('revalue', { V }, 'Přeceněno'); }
    };
  }

  // ---------- players ----------
  function renderPlayers() {
    if (!once('players', [D.rows.map((r) => [r.id, r.name, r.team, r.hasPin, r.holdings]), S.regOpen, S.teams.map((t) => t.name)])) return;
    const rows = D.rows.slice().sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
    $('players').innerHTML = `<h3>Hráči (${rows.length})</h3>
      <div class="inline"><span>Registrace nových hráčů:</span><button class="btn sm ${S.regOpen ? '' : 'ghost'}" id="regon">Otevřená</button><button class="btn sm ${S.regOpen ? 'ghost' : ''}" id="regoff">Zavřená</button></div>
      ${rows.map((r) => `<div class="prow2" data-id="${r.id}"><span>${esc(r.name)}${r.hasPin ? '' : ' <span class="no small">(PIN resetován)</span>'}</span>
        <span class="btns"><select class="input" data-move>${S.teams.map((t) => `<option value="${t.id}" ${t.id === r.team ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <button class="btn sm ghost" data-reset>PIN</button>${r.holdings ? '' : '<button class="btn sm danger" data-del>×</button>'}</span></div>`).join('')}`;
    $('regon').onclick = () => act('reg', { open: true });
    $('regoff').onclick = () => act('reg', { open: false });
    $('players').querySelectorAll('.prow2').forEach((row) => {
      const id = row.dataset.id, name = row.querySelector('span').textContent;
      row.querySelector('[data-move]').onchange = (e) => act('movePlayer', { sid: id, team: e.target.value }, 'Přesunuto');
      row.querySelector('[data-reset]').onclick = () => confirm(`Resetovat PIN hráči ${name}? Při dalším přihlášení si zvolí nový.`) && act('resetPin', { sid: id }, 'PIN resetován');
      const del = row.querySelector('[data-del]');
      if (del) del.onclick = () => confirm(`Smazat hráče ${name}?`) && act('removePlayer', { sid: id }, 'Smazáno');
    });
  }

  // ---------- teams ----------
  function renderTeams() {
    if (!once('teams', S.teams)) return;
    $('teams').innerHTML = `<h3>Týmy</h3><p class="hint">Názvy startupů se ukážou na stole i v mobilech.</p>
      ${S.teams.map((t) => `<div class="trow" data-t="${t.id}"><input type="color" value="${t.color}"><input class="input" value="${esc(t.name)}" maxlength="30"></div>`).join('')}
      <div class="actions"><button class="btn" id="tsave">Uložit týmy</button></div>`;
    $('tsave').onclick = () => {
      const teams = [...$('teams').querySelectorAll('.trow')].map((row) => ({ id: row.dataset.t, color: row.querySelector('[type=color]').value, name: row.querySelector('.input').value.trim() }));
      keys.teams = null;
      act('teams', { teams }, 'Týmy uloženy');
    };
  }

  // ---------- tools ----------
  function renderTools() {
    if (!once('tools', [S.block])) return;
    $('tools').innerHTML = `<h3>Export a záloha</h3>
      <div class="actions"><button class="btn ghost" id="csv">Stáhnout všechny sázky (CSV)</button>
      <button class="btn ghost" id="undo">Vrátit poslední krok</button>
      <button class="btn danger" id="reset">Nová hra (smaže sázky, hráči zůstanou)</button>
      <button class="btn danger" id="wipe">Smazat vše včetně hráčů</button></div>
      <p class="hint" style="margin-top:10px">„Vrátit poslední krok“ zruší poslední showdown, odhalení, přecenění nebo přechod na další blok.</p>`;
    $('undo').onclick = () => confirm('Vrátit poslední krok?') && act('undo', {}, 'Vráceno');
    $('reset').onclick = () => prompt('Napište RESET pro novou hru (hráči zůstanou):') === 'RESET' && act('reset', { confirm: 'RESET', keepPlayers: true }, 'Nová hra');
    $('wipe').onclick = () => prompt('Napište RESET pro smazání všeho:') === 'RESET' && act('reset', { confirm: 'RESET', keepPlayers: false }, 'Smazáno');
    $('csv').onclick = exportCSV;
  }

  async function exportCSV() {
    const j = await get(H(), '?view=dealer&all=1');
    const all = j.dealer.all, players = j.dealer.players;
    const tn = (id) => j.teams.find((t) => t.id === id)?.name || id;
    const rows = [['Blok', 'Investor', 'Tým investora', 'Typ', 'Startup', 'Částka ($)', 'Důvod / poznámka']];
    for (const [b, slips] of Object.entries(all)) {
      for (const [sid, s] of Object.entries(slips)) {
        const p = sid === 'rj' ? { name: 'RainbowJet (smart money)', team: '' } : players[sid];
        if (!p) continue;
        for (const [t, e] of Object.entries(s.in || {})) rows.push([b, p.name, tn(p.team), 'vloženo', tn(t), e.amt, e.why]);
        for (const [t, e] of Object.entries(s.out || {})) rows.push([b, p.name, tn(p.team), 'vybráno', tn(t), e.amt, e.why]);
        for (const [t, n] of Object.entries(s.notes || {})) rows.push([b, p.name, tn(p.team), 'poznámka', tn(t), '', n]);
      }
    }
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `investicni-stul-blok-${S.block}.csv`;
    a.click();
  }

  function renderWarns() {
    const w = [];
    if (S.storage === 'memory' && !/localhost|127\.0\.0\.1/.test(location.hostname)) w.push('Chybí databáze. Ve Vercelu: Storage → Upstash for Redis → Connect, pak Redeploy. Bez ní se sázky ztrácejí.');
    if (D.dealerDefault) w.push('Heslo dealera je výchozí („mup-dealer“). Nastavte ve Vercelu proměnnou DEALER_PASSWORD.');
    if (once('warns', w)) $('warns').innerHTML = w.map((x) => `<div class="warnbox">${esc(x)}</div>`).join('');
  }

  async function tick() {
    const j = await get(H(), '?view=dealer');
    if (!j.dealer) { localStorage.removeItem('mup.dealer'); location.reload(); return; }
    S = j; D = j.dealer;
    renderWarns(); renderCtrl(); renderBets(); renderRJ(); renderVals(); renderPlayers(); renderTeams(); renderTools();
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    $('dlogin').classList.add('hidden');
    $('dgame').classList.remove('hidden');
    poll(tick, 2000);
    setInterval(() => { if (S) { const left = timeLeft(S); $('tleft') && ($('tleft').textContent = left === null ? 'Bez časovače' : `${S.timerLabel || 'Časovač'}: ${left > 0 ? clock(left) : 'čas vypršel'}`); } }, 500);
  }

  if (pw) tryLogin(pw).then((ok) => { if (!ok) $('dlogin').classList.remove('hidden'); });
  else $('dlogin').classList.remove('hidden');
})();
