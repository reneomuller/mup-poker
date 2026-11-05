// Exit finale: per-team outcome reveal, then the investor ranking and the contrarian call.
(function () {
  const T = window.TBL;
  if (!T) return;
  const { $, esc, fmtM, pct, mult, toggle, team, on, sleep } = T;
  const tx = MUP.t;
  MUP.addTexts({
    'table.exit.kick': 'Demo Day · exit',
    'table.exit.title': 'Jak to dopadlo',
    'table.exit.acquired': 'Akvizice',
    'table.exit.ipo': 'IPO',
    'table.exit.hold': 'Bez exitu',
    'table.exit.writeoff': 'Odpis',
    'table.exit.outcomes': 'Startupy',
    'table.exit.ranking': 'Nejlepší investoři',
    'table.exit.contrarian': 'Proti proudu',
    'table.exit.contrarianHint': 'Investice do týmu {target} v době, kdy byl pod mediánem ocenění – dnes {mult}.',
    'table.exit.noRanking': 'Žádní investoři.',
  });
  const RANK = { writeoff: 0, hold: 1, acquired: 2, ipo: 3 };
  const el = $('exit');
  let seenKey = null, stage = null, running = false;

  const kindLabel = (k) => tx('table.exit.' + (RANK[k] !== undefined ? k : 'hold'));
  const hasMult = (o) => o.kind === 'acquired' || o.kind === 'ipo';

  function cardsHTML(s, list) {
    return list.map((o, i) => {
      const t = team(s, o.team);
      return `<div class="ex-card k-${esc(o.kind)}" data-i="${i}" style="--tc:${t.color}"><div class="pcard"><div class="back"></div><div class="face">
        <div class="ex-tn"><span class="dot" style="background:${t.color}"></span><span>${esc(t.name)}</span></div>
        <div class="ex-k">${esc(kindLabel(o.kind))}</div>
        ${hasMult(o) ? `<div class="ex-m">${mult(o.multiple)}</div>` : o.kind === 'writeoff' ? '<div class="ex-m">×0</div>' : '<div class="ex-m dim">×1</div>'}
        <div class="ex-v">${esc(fmtM(o.V))}</div></div></div></div>`;
    }).join('');
  }

  function finalHTML(s, x, list) {
    const rows = (x.ranking || []).map((r, i) => {
      const t = team(s, r.team);
      return `<li style="--d:${(9 - i) * 90 + 200}ms" class="${i === 0 ? 'first' : ''}"><span class="ex-pos">${i + 1}</span><span class="ex-nm">${esc(r.name)}</span><span class="ex-tm"><span class="dot" style="background:${t.color}"></span><span class="ex-tmn">${esc(t.name)}</span></span><span class="ex-val">${esc(fmtM(r.value))}</span><span class="ex-ret ${r.returnPct >= 0 ? 'up' : 'down'}">${pct(r.returnPct)}</span></li>`;
    }).join('') || `<li class="ex-empty">${esc(tx('table.exit.noRanking'))}</li>`;
    const outs = list.slice().sort((a, b) => b.V - a.V).map((o) => {
      const t = team(s, o.team);
      return `<li class="k-${esc(o.kind)}"><span class="ex-tn"><span class="dot" style="background:${t.color}"></span><span>${esc(t.name)}</span></span><span class="ex-pill">${esc(kindLabel(o.kind))}${hasMult(o) ? ' ' + mult(o.multiple) : ''}</span><span class="ex-v">${esc(fmtM(o.V))}</span></li>`;
    }).join('');
    const c = x.contrarian;
    const ct = c ? team(s, c.team) : null;
    const contra = c ? `<div class="ex-contra"><div class="ex-ck">${esc(tx('table.exit.contrarian'))}</div><div class="ex-cn">${esc(c.name)}</div>
      <div class="ex-ct"><span class="dot" style="background:${ct.color}"></span>${esc(ct.name)}</div>
      <div class="ex-ch">${esc(tx('table.exit.contrarianHint', { target: team(s, c.target).name || '', mult: mult(c.multiple) }))}</div></div>` : '';
    return `<div class="ex-final">
      <div class="ex-left"><div class="ex-h">${esc(tx('table.exit.outcomes'))}</div><ol class="ex-outs">${outs}</ol>${contra}</div>
      <div class="ex-right"><div class="ex-h">${esc(tx('table.exit.ranking'))}</div><ol class="ex-rank">${rows}</ol></div></div>`;
  }

  function sorted(x) {
    return (x.teams || []).slice().sort((a, b) => (RANK[a.kind] ?? 1) - (RANK[b.kind] ?? 1) || (a.multiple || 0) - (b.multiple || 0) || a.V - b.V);
  }

  async function play(s, x) {
    running = true;
    stage = 'reveal';
    const list = sorted(x);
    el.className = 'exit stage-reveal';
    el.innerHTML = `<div class="ex-head"><div class="ex-kick">${esc(tx('table.exit.kick'))}</div><h2>${esc(tx('table.exit.title'))}</h2></div><div class="ex-grid">${cardsHTML(s, list)}</div>`;
    await sleep(1400);
    const cards = el.querySelectorAll('.ex-card');
    for (const c of cards) {
      c.classList.add('up');
      await sleep(c.classList.contains('k-ipo') || c.classList.contains('k-acquired') ? 1700 : 1200);
    }
    await sleep(3500);
    showFinal(T.state() || s);
    running = false;
  }

  function showFinal(s) {
    const x = s.exit;
    if (!x) return;
    stage = 'final';
    el.className = 'exit stage-final';
    el.innerHTML = `<div class="ex-head"><div class="ex-kick">${esc(tx('table.exit.kick'))}</div><h2>${esc(tx('table.exit.title'))}</h2></div>` + finalHTML(s, x, sorted(x));
    el._fk = JSON.stringify([x.ranking, x.teams, x.contrarian, s.teams.map((t) => [t.name, t.color])]);
  }

  function render(s, first) {
    const x = on(s, 'exit') && s.exit ? s.exit : null;
    const boardWanted = s.screen === 'board' || document.getElementById('boardscreen').classList.contains('on');
    toggle(el, 'hidden', !x || boardWanted);
    if (!x) { seenKey = null; stage = null; return; }
    const key = JSON.stringify(x.outcomes || x.teams);
    if (key !== seenKey) {
      const wasSeen = seenKey !== null || first;
      seenKey = key;
      if (wasSeen && first) { showFinal(s); return; }
      if (!running) play(s, x);
      return;
    }
    // keep the final screen fresh (names, late ranking changes) without re-animating
    if (stage === 'final' && !running) {
      const fk = JSON.stringify([x.ranking, x.teams, x.contrarian, s.teams.map((t) => [t.name, t.color])]);
      if (fk !== el._fk) showFinal(s);
    }
  }

  T.screens.push(render);
})();
