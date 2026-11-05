// v4 recap: printable class report for the organisers (/report). Reads GET /api/game?view=report (dealer only).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NB = '\u00a0';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 0) => (Number(n) || 0).toLocaleString('cs-CZ', { maximumFractionDigits: d, minimumFractionDigits: 0 }).replace(/\s/g, NB);
  const money = (n) => num(Math.round(n || 0)) + NB + '$';
  const mil = (n) => (Math.abs(n) >= 1e6 ? num(n / 1e6, 2) + NB + 'M' + NB + '$' : Math.abs(n) >= 1e3 ? num(n / 1e3, 0) + NB + 'k' + NB + '$' : money(n));
  const pct = (n, d = 1) => num(n, d) + NB + '%';
  const spct = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + pct(Math.abs(n));
  const mult = (x) => (x == null ? '–' : '×' + num(x, 2));
  const cls = (n) => (n > 0 ? 'r-up' : n < 0 ? 'r-down' : '');
  const EXIT = { acquired: 'Akvizice', ipo: 'IPO', hold: 'Bez exitu', writeoff: 'Odpis' };
  const PHASE = { lobby: 'čekáme na start', pitch: 'pitch', betting: 'investování', closed: 'uzavřeno', showdown: 'showdown', rj: 'smart money', final: 'Demo Day' };
  let pw = '';
  try { pw = localStorage.getItem('mup.dealer') || ''; } catch {}
  let R = null;

  const when = (ts) => new Date(ts).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\s/g, NB);
  const teamOf = (id) => (R?.teams || []).find((t) => t.id === id) || { id, name: id || '?', color: '#7E86A8' };
  const dot = (color) => `<span class="r-dot" style="background:${esc(color)}" aria-hidden="true"></span>`;
  const tname = (id) => esc(teamOf(id).name);
  const exitText = (e) => (!e ? '–' : e.kind === 'acquired' || e.kind === 'ipo' ? `${EXIT[e.kind]} ${mult(e.multiple)}` : EXIT[e.kind] || e.kind);
  const call = (c) => (c ? `${esc(c.teamName)} <span class="${cls(c.multiple - 1)}">${esc(mult(c.multiple))}</span>` : '–');

  function spark(path, color) {
    const v = path.map((p) => p.V);
    if (v.length < 2) return '';
    const W = 92, H = 26, max = Math.max(...v, 1), min = Math.min(...v, 0);
    const x = (i) => 2 + (i * (W - 4)) / (v.length - 1);
    const y = (n) => H - 3 - ((n - min) / (max - min || 1)) * (H - 6);
    const d = v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join(' ');
    return `<svg class="r-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Vývoj ocenění"><path d="${d}" fill="none" stroke="${esc(color)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(v.length - 1).toFixed(1)}" cy="${y(v[v.length - 1]).toFixed(1)}" r="2.6" fill="${esc(color)}"/></svg>`;
  }

  // the path columns: Start, Blok 1 … Blok N, Exit (the union over all startups, in order)
  function pathCols(teams) {
    const seen = new Map();
    for (const t of teams) for (const p of t.path || []) if (!seen.has(p.label)) seen.set(p.label, p.label === 'Start' ? -1 : p.label === 'Exit' ? 1e6 : p.block);
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([l]) => l);
  }

  function note(title, html) {
    $('main').innerHTML = `<div class="r-note" role="alert"><h2>${esc(title)}</h2><p>${html}</p></div>`;
    $('meta').textContent = '';
    $('csv').disabled = true;
  }

  async function load() {
    $('meta').textContent = 'Načítám…';
    let r, j;
    try {
      r = await fetch('/api/game?view=report', { headers: { 'x-dealer': pw || '-' }, cache: 'no-store' });
      j = await r.json();
    } catch (e) { return note('Report se nepodařilo načíst', 'Server neodpovídá. Zkontroluj připojení a zkus „Obnovit“.'); }
    if (r.status === 401) return note('Jen pro organizátory', 'Report vidí jen dealer. Přihlas se nejdřív na <a href="/dealer">/dealer</a> a pak tuto stránku obnov.');
    if (r.status === 400) return note('Rekapitulace je vypnutá', 'Rekapitulace je vypnutá (Funkce → recap).');
    if (!j || !j.ok) return note('Report se nepodařilo načíst', esc(j?.error || 'Neznámá chyba.'));
    R = j;
    render();
  }

  function render() {
    const c = R.class || {};
    const st = R.students || [];
    const teams = R.teams || [];
    $('meta').innerHTML = `Stav ${esc(when(R.generated))} · blok <b>${esc(R.block)}</b> z${NB}${esc(R.maxBlock)} · fáze ${esc(PHASE[R.phase] || R.phase)} · <b>${R.final ? 'konečné výsledky' : 'průběžný stav'}</b>`;
    document.title = `Třídní report – MUP poker (${R.final ? 'konec hry' : 'blok ' + R.block})`;
    const typeCount = {};
    for (const s of st) if (s.type) typeCount[s.type.label] = (typeCount[s.type.label] || 0) + 1;
    const tiles = [
      ['Studenti', esc(num(c.n))],
      ['Průměrný výnos', `<span class="${cls(c.avgReturn)}">${esc(spct(c.avgReturn || 0))}</span>`],
      ['Medián výnosu', `<span class="${cls(c.medianReturn)}">${esc(spct(c.medianReturn || 0))}</span>`],
      ['V plusu', `${esc(num(c.positive))} <small>z${NB}${esc(num(c.n))}</small>`],
      ['Investováno celkem', esc(mil(c.invested || 0))],
      ['Startupů na studenta', esc(num(c.avgStartups, 1))],
      ['Kvíz – průměr bodů', esc(num(c.avgQuiz))],
      ['Nejlepší investor', c.best ? `${esc(c.best.name)} <small class="${cls(c.best.returnPct)}">${esc(spct(c.best.returnPct))}</small>` : '–'],
    ];
    const cols = pathCols(teams);
    const blocks = R.blocks || [];
    const h = [];
    h.push(`<section class="r-sec" aria-labelledby="h-sum"><h2 id="h-sum">Shrnutí třídy</h2><p class="r-sub">Ghost účty se nepočítají. Start každého studenta: 1${NB}000${NB}000${NB}$.</p>
      <div class="r-tiles">${tiles.map(([l, v]) => `<div class="r-tile"><div class="r-l">${esc(l)}</div><div class="r-v r-num">${v}</div></div>`).join('')}</div>
      ${Object.keys(typeCount).length ? `<div class="r-types" aria-label="Typy investorů">${Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map(([l, n]) => `<span class="r-chip">${esc(l)} <b>${esc(n)}</b></span>`).join('')}</div>` : ''}
    </section>`);

    h.push(`<section class="r-sec" aria-labelledby="h-su"><h2 id="h-su">Startupy</h2><p class="r-sub">Ocenění na konci každého bloku, poptávkový násobek bloku, investoři ze třídy (kdykoli / teď) a peníze třídy.</p>
      <div class="r-wrap"><table class="r-t r-teams"><thead><tr><th scope="col">Startup</th>${cols.map((l) => `<th scope="col" class="r">${esc(l)}</th>`).join('')}<th scope="col">Vývoj</th>
        ${blocks.map((b) => `<th scope="col" class="r">Popt. B${esc(b)}</th>`).join('')}<th scope="col" class="r">Investoři</th><th scope="col" class="r">Třída vložila</th><th scope="col" class="r">Třída vybrala</th><th scope="col" class="r">Zakl.</th><th scope="col">Exit</th></tr></thead>
        <tbody>${teams.slice().sort((a, b) => b.V - a.V).map((t) => {
          const byL = Object.fromEntries((t.path || []).map((p) => [p.label, p.V]));
          const byB = Object.fromEntries((t.demand || []).map((d) => [d.block, d.mult]));
          return `<tr><th scope="row">${dot(t.color)}${esc(t.name)}</th>${cols.map((l) => `<td class="r r-num">${byL[l] === undefined ? '–' : esc(mil(byL[l]))}</td>`).join('')}
            <td>${spark(t.path || [], t.color)}</td>
            ${blocks.map((b) => `<td class="r r-num ${byB[b] == null ? '' : cls(byB[b] - 1)}">${esc(mult(byB[b]))}</td>`).join('')}
            <td class="r r-num">${esc(num(t.investors))} / ${esc(num(t.investorsNow))}</td><td class="r r-num">${esc(mil(t.classIn))}</td><td class="r r-num">${esc(mil(t.classOut))}</td>
            <td class="r r-num">${esc(pct(t.founderPct))}</td><td>${esc(exitText(t.exit))}</td></tr>`;
        }).join('')}</tbody></table></div>
    </section>`);

    const top = (R.top || []).map((x, i) => `<li><span class="r-pos">${i + 1}</span><span class="r-who"><b>${esc(x.name)}</b><span>${dot(teamOf(x.team).color)}${tname(x.team)}</span></span><span class="r-score r-num"><b>${esc(money(x.value))}</b><small class="${cls(x.returnPct)}">${esc(spct(x.returnPct))}</small></span></li>`).join('');
    const qtop = (R.quizTop || []).map((x, i) => `<li><span class="r-pos">${i + 1}</span><span class="r-who"><b>${esc(x.name)}</b><span>${dot(teamOf(x.team).color)}${tname(x.team)}</span></span><span class="r-score r-num"><b>${esc(num(x.quizPoints))} b.</b><small class="r-faint">${x.bestStreak > 1 ? `série ${esc(x.bestStreak)}` : x.bestStreak === 1 ? 'bez série' : ''}</small></span></li>`).join('');
    h.push(`<div class="r-cols">
      <section class="r-sec" aria-labelledby="h-top"><h2 id="h-top">Top 5 investorů</h2><p class="r-sub">Hodnota portfolia a výnos proti startu.</p>${top ? `<ol class="r-top5">${top}</ol>` : '<p class="r-empty">Zatím nikdo neinvestoval.</p>'}</section>
      <section class="r-sec" aria-labelledby="h-quiz"><h2 id="h-quiz">Top 5 v${NB}kvízu</h2><p class="r-sub">Body ze všech kvízů a nejdelší série správných odpovědí.</p>${qtop ? `<ol class="r-top5">${qtop}</ol>` : '<p class="r-empty">Kvíz zatím neběžel.</p>'}</section>
    </div>`);

    h.push(`<section class="r-sec" aria-labelledby="h-st"><h2 id="h-st">Studenti</h2><p class="r-sub">Seřazeno podle hodnoty portfolia. Nejlepší a nejhorší tah = násobek ceny akcie od nákupu do teď. Proti proudu = nákupy tam, kam třída v daném bloku dala méně než průměr.</p>
      <div class="r-wrap"><table class="r-t r-students"><thead><tr><th scope="col" class="r">#</th><th scope="col">Student</th><th scope="col">Tým</th><th scope="col" class="r">Portfolio</th><th scope="col" class="r">Výnos</th><th scope="col">Typ</th><th scope="col" class="r">Startupy</th><th scope="col">Největší sázka</th><th scope="col">Nejlepší tah</th><th scope="col">Nejhorší tah</th><th scope="col" class="r">Proti proudu</th><th scope="col" class="r">Kvíz</th><th scope="col" class="r">Body</th></tr></thead>
        <tbody>${st.map((s) => `<tr><td class="r r-num">${esc(s.rank)}</td><th scope="row">${esc(s.name)}</th><td>${dot(teamOf(s.team).color)}${esc(s.teamName)}</td>
          <td class="r r-num">${esc(money(s.value))}</td><td class="r r-num ${cls(s.returnPct)}">${esc(spct(s.returnPct))}</td>
          <td><span class="r-type">${esc(s.type?.label || '–')}</span></td><td class="r r-num">${esc(num(s.startups))}</td>
          <td>${s.biggest ? `${esc(s.biggest.teamName)} <span class="r-small r-num">${esc(mil(s.biggest.amt))}</span>` : '–'}</td>
          <td>${call(s.best)}</td><td>${call(s.worst)}</td>
          <td class="r r-num">${esc(num(s.contrarian?.count || 0))}</td><td class="r r-num">${esc(num(s.quizPoints))}</td><td class="r r-num">${esc(num(s.points))}</td></tr>`).join('') || '<tr><td colspan="13" class="r-empty">Zatím žádní studenti.</td></tr>'}</tbody></table></div>
    </section>`);
    $('main').innerHTML = h.join('');
    $('foot').textContent = `MUP poker · třídní report · vygenerováno ${when(R.generated)}`;
    $('csv').disabled = false;
  }

  // ---------- CSV (Excel-friendly: ; separated, UTF-8 BOM, decimal comma) ----------
  const cell = (v) => {
    const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  function csv() {
    if (!R) return;
    const rows = [['Pořadí', 'Student', 'Tým', 'Portfolio ($)', 'Výnos (%)', 'Typ investora', 'Startupy', 'Investováno ($)', 'Největší sázka – startup', 'Největší sázka ($)', 'Nejlepší tah – startup', 'Nejlepší tah – blok', 'Nejlepší tah (násobek)', 'Důvod nejlepšího tahu', 'Nejhorší tah – startup', 'Nejhorší tah (násobek)', 'Proti proudu (počet)', 'Proti proudu ($)', 'Body z kvízu', 'Nejdelší série', 'Body celkem', 'Ocenění']];
    for (const s of R.students || []) {
      rows.push([s.rank, s.name, s.teamName, s.value, s.returnPct, s.type?.label || '', s.startups, s.invested, s.biggest?.teamName || '', s.biggest?.amt ?? '',
        s.best?.teamName || '', s.best?.block ?? '', s.best?.multiple ?? '', s.best?.why || '', s.worst?.teamName || '', s.worst?.multiple ?? '',
        s.contrarian?.count || 0, s.contrarian?.amt || 0, s.quizPoints, s.bestStreak, s.points, (s.awards || []).map((a) => a.label + (a.note ? ': ' + a.note : '')).join(' | ')]);
    }
    rows.push([]);
    const cols = pathCols(R.teams || []);
    const blocks = R.blocks || [];
    rows.push(['Startup', ...cols.map((l) => `Ocenění ${l} ($)`), ...blocks.map((b) => `Poptávka blok ${b}`), ...blocks.map((b) => `Třída vložila blok ${b} ($)`), 'Investoři (kdykoli)', 'Investoři teď', 'Třída vložila ($)', 'Třída vybrala ($)', 'Zakladatelé (%)', 'Exit']);
    for (const t of R.teams || []) {
      const byL = Object.fromEntries((t.path || []).map((p) => [p.label, p.V]));
      const byB = Object.fromEntries((t.demand || []).map((d) => [d.block, d]));
      rows.push([t.name, ...cols.map((l) => byL[l] ?? ''), ...blocks.map((b) => byB[b]?.mult ?? ''), ...blocks.map((b) => byB[b]?.in ?? ''), t.investors, t.investorsNow, t.classIn, t.classOut, t.founderPct, exitText(t.exit)]);
    }
    const text = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const name = `mup-report-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  $('csv').onclick = csv;
  $('print').onclick = () => window.print();
  $('reload').onclick = load;
  load();
})();
