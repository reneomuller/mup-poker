// v4 quizplus for the admin (flag `quizplus`): extra fields in the quiz editor (why, ×2, image, „Pravda / Nepravda“)
// via a few hooks in dealer.js (MupQuizPlusEd), and the „Výsledky kvízu“ card in the Kvíz tab: per-question stats
// of a run from GET ?view=quizrun and a CSV download. Standalone otherwise (own fetch, own styles).
(function () {
  'use strict';
  const API = '/api/game';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ls = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const hdr = () => ({ 'x-dealer': ls('mup.dealer') || '' });
  const nb = (s) => String(s).replace(/\s/g, ' ');
  const dec = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '' : Number(n).toLocaleString('cs-CZ', { maximumFractionDigits: d, minimumFractionDigits: d }).replace(/\s/g, ''));
  const WHY_MAX = 240;

  const css = document.createElement('style');
  css.textContent = `
.qpx { display: grid; gap: 6px; padding-top: 4px; border-top: 1px dashed var(--s-border); }
.qpx textarea { resize: vertical; min-height: 44px; }
.qpx-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.qpx-row .s-input { flex: 1 1 220px; min-width: 0; }
.qpx label.chk { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13.5px; cursor: pointer; white-space: nowrap; }
.qpx label.chk input { width: 18px; height: 18px; accent-color: #FF8A47; }
.qpx .cnt { font-size: 12px; opacity: .7; margin-left: auto; }
.qpx .cnt.over { color: var(--s-red, #FF5C6C); opacity: 1; }
.qpx-img { max-height: 64px; max-width: 120px; border-radius: 8px; object-fit: contain; }
.qpb { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 700; background: rgba(255,138,71,.18); color: #FFB27A; vertical-align: 1px; }
#qzres .qrhead { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
#qzres .qrhead select { flex: 1 1 240px; min-width: 0; }
#qzres .qrwrap { overflow-x: auto; margin-top: 10px; }
#qzres table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
#qzres th, #qzres td { padding: 6px 8px; border-top: 1px solid var(--s-border); text-align: left; vertical-align: top; }
#qzres th { font-size: 12px; font-weight: 700; opacity: .75; border-top: 0; white-space: nowrap; }
#qzres td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
#qzres td.q { min-width: 180px; }
#qzres .split { display: flex; height: 8px; border-radius: 4px; overflow: hidden; min-width: 90px; margin-top: 4px; background: var(--s-border); }
#qzres .split i { display: block; height: 100%; }
#qzres .split i.ok { box-shadow: inset 0 0 0 2px #3FCF8E; }
#qzres .pct { font-weight: 700; }
#qzres .hint { margin-top: 8px; }`;
  document.head.appendChild(css);

  // ---------- editor fields (called from dealer.js qHTML / bind / cleanSet / importJSON) ----------
  function fields(q, i) {
    const why = String(q.why || '');
    return `<div class="qpx" data-qpx="${i}">
      <label class="lab" for="qpw${i}">Proč je to správně <span class="s-faint">(nepovinné – ukáže se po odhalení na plátně i v mobilech)</span></label>
      <textarea class="s-input sm" id="qpw${i}" data-qp="why" maxlength="${WHY_MAX}" rows="2" placeholder="Krátké vysvětlení, např. Post-money = pre-money + investice.">${esc(why)}</textarea>
      <div class="qpx-row"><input class="s-input sm" data-qp="img" type="url" inputmode="url" maxlength="500" value="${esc(q.img || '')}" placeholder="Obrázek: https://… (nepovinné)" aria-label="Adresa obrázku (https)">
        ${q.img && /^https:\/\//.test(q.img) ? `<img class="qpx-img" src="${esc(q.img)}" alt="${esc(q.q || '')}" referrerpolicy="no-referrer">` : ''}</div>
      <div class="qpx-row"><label class="chk"><input type="checkbox" data-qp="double" ${q.double ? 'checked' : ''}> Dvojnásobné body ×2</label>
        <button type="button" class="s-btn s-sm s-ghost" data-qp="tf" title="Dvě odpovědi: Pravda a Nepravda">Pravda / Nepravda</button>
        <span class="cnt ${why.length > WHY_MAX ? 'over' : ''}" data-qp="cnt">${why.length}/${WHY_MAX}</span></div>
    </div>`;
  }
  function bind(box, q, dirty, redraw) {
    const w = box.querySelector('[data-qp=why]'), img = box.querySelector('[data-qp=img]'), dbl = box.querySelector('[data-qp=double]'), cnt = box.querySelector('[data-qp=cnt]');
    if (!w) return;
    w.oninput = () => { q.why = w.value; cnt.textContent = `${w.value.length}/${WHY_MAX}`; cnt.classList.toggle('over', w.value.length > WHY_MAX); dirty(); };
    img.oninput = () => { q.img = img.value.trim(); dirty(); };
    img.onchange = () => { if (q.img && !/^https:\/\/[^\s"'<>]+$/.test(q.img)) img.setCustomValidity('Obrázek musí mít adresu https://…'); else img.setCustomValidity(''); img.reportValidity(); };
    dbl.onchange = () => { q.double = dbl.checked; dirty(); };
    box.querySelector('[data-qp=tf]').onclick = () => {
      q.a = ['Pravda', 'Nepravda', '', ''];
      if (!(q.correct === 0 || q.correct === 1)) q.correct = 0;
      dirty(); redraw();
    };
  }
  function clean(q) {
    const out = {};
    const why = String(q.why ?? q.explanation ?? '').replace(/[ \t\r\n]+/g, ' ').trim();
    if (why) out.why = why.slice(0, WHY_MAX);
    if (q.double === true || q.double === 1 || q.double === 'true') out.double = true;
    const img = String(q.img ?? q.image ?? '').trim();
    if (img) out.img = img;
    return out;
  }
  const badges = (q) => (q.double ? '<span class="qpb">×2</span>' : '') + (q.why ? '<span class="qpb" title="Má vysvětlení">Proč</span>' : '') + (q.img ? '<span class="qpb" title="Má obrázek">obrázek</span>' : '');
  window.MupQuizPlusEd = { fields, bind, clean, badges };

  // ---------- results export card ----------
  let runs = [], sel = null, data = null, dataKey = '', busy = false, listAt = 0, off = false;
  const card = () => document.getElementById('qzres');
  const when = (ts) => { try { return new Date(ts).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const COL = ['#3586D1', '#6754DF', '#FF5574', '#FF8A47'];
  async function getJ(q) {
    const r = await fetch(API + q, { headers: hdr(), cache: 'no-store' });
    return r.json();
  }
  async function loadList() {
    listAt = Date.now();
    try {
      const j = await getJ('?view=quizrun');
      if (j && j.ok) {
        off = j.on === false;
        runs = j.runs || [];
        if (!sel || !runs.some((r) => r.runId === sel)) sel = runs[0]?.runId || null;
      }
    } catch {}
  }
  const runKey = () => { const r = runs.find((x) => x.runId === sel); return r ? `${r.runId}|${r.questions}|${r.last}` : ''; };
  async function loadRun() {
    if (!sel) { data = null; dataKey = ''; return; }
    const k = runKey();
    try { const j = await getJ('?view=quizrun&runId=' + encodeURIComponent(sel)); data = j && j.ok ? j : null; dataKey = data ? k : ''; } catch { data = null; dataKey = ''; }
  }
  // the run's stats (one small hash per question) are re-read only when the run gained a question or on „Obnovit“
  async function refresh(force) {
    if (busy) return;
    busy = true; draw();
    await loadList();
    if (force === true || runKey() !== dataKey) await loadRun();
    busy = false; draw();
  }
  function draw() {
    const el = card();
    if (!el) return;
    el.hidden = off;
    if (off) return;
    const opts = runs.map((r) => `<option value="${esc(r.runId)}" ${r.runId === sel ? 'selected' : ''}>${esc(r.title)} · ${esc(when(r.ts))} · ${r.questions} ${r.questions === 1 ? 'otázka' : r.questions < 5 ? 'otázky' : 'otázek'}</option>`).join('');
    let body = '';
    if (!runs.length) body = '<p class="hint">Zatím žádný odehraný kvíz. Výsledky se tu objeví po první otázce.</p>';
    else if (!data) body = `<p class="hint">${busy ? 'Načítám…' : 'Výsledky se nepodařilo načíst.'}</p>`;
    else {
      const rows = data.questions.map((x) => {
        const sum = x.counts.reduce((a, b) => a + b, 0) || 1;
        const split = x.counts.map((c, k) => `<i class="${k === x.correct ? 'ok' : ''}" style="width:${(c / sum) * 100}%;background:${COL[k]}" title="${'ABCD'[k]}: ${c}"></i>`).join('');
        return `<tr><td class="n">${x.n}</td><td class="q">${esc(x.q)}${x.double ? '<span class="qpb">×2</span>' : ''}<div class="split" aria-hidden="true">${x.answered ? split : ''}</div></td>
          <td>${x.correct !== null && x.correct !== undefined ? 'ABCD'[x.correct] : '–'}</td>
          <td class="n">${x.counts.map((c, k) => `${'ABCD'[k]} ${c}`).join(' · ')}</td>
          <td class="n pct">${x.answered ? nb(dec(x.pctCorrect) + ' %') : '–'}</td>
          <td class="n">${x.avgMs !== null ? nb(dec(x.avgMs / 1000) + ' s') : '–'}</td>
          <td>${x.fastest ? `${esc(x.fastest.name)} <span class="s-faint">${esc(nb(dec(x.fastest.ms / 1000) + ' s'))}</span>` : '<span class="s-faint">nikdo</span>'}</td></tr>`;
      }).join('');
      body = `<div class="qrwrap"><table><thead><tr><th>#</th><th>Otázka</th><th>Správně</th><th>Odpovědi</th><th>% správně</th><th>Prům. čas</th><th>Nejrychlejší správně</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="hint">${data.players} hráčů ve hře · % správně počítá jen ty, kdo odpověděli. Ghost se nepočítá.</p>`;
    }
    el.innerHTML = `<div class="ch"><h3>Výsledky kvízu</h3></div>
      <div class="qrhead"><select class="s-input sm" id="qrsel" aria-label="Odehraný kvíz" ${runs.length ? '' : 'disabled'}>${opts || '<option>–</option>'}</select>
        <button class="s-btn s-sm s-ghost" id="qrref" type="button" ${busy ? 'disabled' : ''}>Obnovit</button>
        <button class="s-btn s-sm" id="qrcsv" type="button" ${data ? '' : 'disabled'}>Stáhnout CSV</button></div>${body}`;
    el.querySelector('#qrsel').onchange = async (e) => { sel = e.target.value; busy = true; draw(); await loadRun(); busy = false; draw(); };
    el.querySelector('#qrref').onclick = () => refresh(true);
    el.querySelector('#qrcsv').onclick = csv;
  }
  function csv() {
    if (!data) return;
    const q = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['Otázka', 'Text', 'Dvojnásobné body', 'Správná odpověď', 'Odpovědělo', 'Správně', '% správně', 'Průměrný čas (s)', 'Nejrychlejší správně', 'Tým', 'Čas nejrychlejšího (s)', 'A', 'B', 'C', 'D', 'Text A', 'Text B', 'Text C', 'Text D'];
    const lines = [head.map(q).join(';')];
    for (const x of data.questions) {
      lines.push([
        x.n, x.q, x.double ? 'ano' : 'ne', x.correct !== null && x.correct !== undefined ? 'ABCD'[x.correct] : '', x.answered, x.correctN, dec(x.pctCorrect),
        x.avgMs !== null ? dec(x.avgMs / 1000, 2) : '', x.fastest?.name || '', x.fastest?.teamName || x.fastest?.team || '', x.fastest ? dec(x.fastest.ms / 1000, 2) : '',
        ...[0, 1, 2, 3].map((k) => (k < x.counts.length ? x.counts[k] : '')), ...[0, 1, 2, 3].map((k) => x.a[k] ?? ''),
      ].map(q).join(';'));
    }
    const name = `kviz-vysledky-${String(data.title || 'kviz').replace(/[^\wÀ-ſ-]+/g, '-')}-${new Date(data.ts || Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // refresh the run list while the Kvíz tab is open (every 20 s)
  setInterval(() => {
    const el = card();
    if (!el || (!el.offsetParent && !(off && el.parentNode && el.parentNode.offsetParent))) return;
    if (!el.firstChild) { refresh(); return; }
    if (Date.now() - listAt > 20000) refresh();
  }, 1000);
})();
