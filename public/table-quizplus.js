// v4 quizplus on the projector (flag `quizplus`): the ×2 badge and flash, the question image, „Proč“ under the
// answers at reveal, the lobby join prompt with a „Připraveno: n / m“ counter, the ×2 announcement on the board,
// and the podium finale at `done` (3rd, 2nd, drumroll, 1st, then the top 10). Runs as a second screen after
// table-quiz.js and only adds elements next to the ones it builds, so its transition code stays untouched.
(function () {
  const T = window.TBL;
  if (!T) return;
  const { $, esc, typo, setText, setHTML, toggle, team, on } = T;
  const tx = MUP.t;
  MUP.addTexts({
    'table.qp.x2': 'Dvojnásobné body ×2',
    'table.qp.x2flash': 'Dvojnásobné body',
    'table.qp.next2': 'Další otázka: dvojnásobné body ×2',
    'table.qp.why': 'Proč',
    'table.qp.ready': 'Připraveno:',
    'table.qp.joined': 'Přihlášeno:',
    'table.qp.join': 'Otevřete na mobilu',
    'table.qp.final': 'Konečné pořadí',
    'table.qp.drum': 'A vítězem je…',
    'table.qp.empty': 'V tomto kvízu nikdo nebodoval.',
    'table.qp.pts': 'b.',
  });
  const L = ['A', 'B', 'C', 'D'];
  const el = $('quiz');
  const nb = (n) => String(n).replace(/\s/g, ' ');
  const pts = (n) => nb((Math.round(n) || 0).toLocaleString('cs-CZ'));
  let flashSeq = -1, podKey = '', podTimers = [], readyTimer = 0, readyRun = null, ready = null;

  // ---------- question / reveal / board / lobby additions ----------
  function inject() {
    if (el.querySelector('.qzp-x2') || !el.querySelector('.qz-play')) return !!el.querySelector('.qzp-x2');
    el.querySelector('.qz-top').insertAdjacentHTML('beforeend', `<div class="qzp-x2" hidden>${esc(tx('table.qp.x2'))}</div>`);
    el.querySelector('.qz-qrow').insertAdjacentHTML('afterend', '<div class="qzp-media" hidden><img alt="" referrerpolicy="no-referrer" decoding="async"></div>');
    el.querySelector('.qz-tiles').insertAdjacentHTML('afterend', '<div class="qzp-why" hidden><span class="qzp-wl"></span><span class="qzp-wt"></span></div>');
    el.querySelector('.qz-play').insertAdjacentHTML('beforeend', `<div class="qzp-flash" hidden><b>×2</b><span>${esc(tx('table.qp.x2flash'))}</span></div>`);
    el.querySelector('.qz-bt').insertAdjacentHTML('afterend', `<div class="qzp-next2" hidden>${esc(tx('table.qp.next2'))}</div>`);
    el.querySelector('.qz-lobby').insertAdjacentHTML('beforeend', `<div class="qzp-lob"><div class="qzp-join"><span>${esc(tx('table.qp.join'))}</span> <b>${esc(location.host + '/play')}</b></div><div class="qzp-ready" aria-live="polite"></div><div class="qzp-next2" hidden>${esc(tx('table.qp.next2'))}</div></div>`);
    return true;
  }

  function clear() {
    el.querySelectorAll('.qzp-x2, .qzp-media, .qzp-why, .qzp-flash, .qzp-next2').forEach((x) => (x.hidden = true));
    const lob = el.querySelector('.qzp-lob');
    if (lob) lob.hidden = true;
    el.classList.remove('qzp-img', 'qzp-hasWhy');
  }

  async function pollReady() {
    clearTimeout(readyTimer); readyTimer = 0;
    const s = T.state();
    const q = s && s.quiz;
    if (!q || q.state !== 'board' || (q.idx ?? -1) >= 0 || !on(s, 'quizplus')) { ready = null; return; }
    try {
      const r = await fetch('/api/game?view=quizready', { cache: 'no-store' }).then((x) => x.json());
      if (r && r.ok && r.lobby) { ready = r; drawReady(T.state()); }
    } catch {}
    readyTimer = setTimeout(pollReady, document.hidden ? 5000 : 2000);
  }
  function drawReady(s) {
    const box = el.querySelector('.qzp-ready');
    if (!box) return;
    const all = s.playerCount || 0;
    // the ready counter needs the phones' lobby ping; without it fall back to the logged-in player count
    if (ready) setHTML(box, `<span>${esc(tx('table.qp.ready'))}</span> <b>${ready.ready}</b><i>&nbsp;/&nbsp;${ready.expected || all}</i>`);
    else setHTML(box, `<span>${esc(tx('table.qp.joined'))}</span> <b>${all}</b>`);
    const frac = ready && ready.expected ? Math.min(1, ready.ready / ready.expected) : 0;
    box.style.setProperty('--f', frac.toFixed(3));
    toggle(box, 'full', !!ready && ready.expected > 0 && ready.ready >= ready.expected);
  }

  function play(s, q, mode) {
    if (!inject()) return;
    const lobby = mode === 'lobby';
    const x2 = !!q.double && (mode === 'question' || mode === 'reveal');
    el.querySelector('.qzp-x2').hidden = !x2;
    // image: https only (the server validates), never sends a referrer, alt = the question
    const media = el.querySelector('.qzp-media'), img = media.querySelector('img');
    const src = (mode === 'question' || mode === 'reveal') && typeof q.img === 'string' && /^https:\/\//.test(q.img) ? q.img : '';
    if (src && img.getAttribute('src') !== src) { img.src = src; img.onerror = () => { media.hidden = true; el.classList.remove('qzp-img'); }; }
    if (src) img.alt = q.q || '';
    media.hidden = !src;
    el.classList.toggle('qzp-img', !!src);
    // why: only at reveal, under the answers, tied to the correct one by colour and letter
    const why = el.querySelector('.qzp-why');
    const w = mode === 'reveal' && q.why ? q.why : '';
    why.hidden = !w;
    el.classList.toggle('qzp-hasWhy', !!w);
    if (w) {
      why.style.setProperty('--qc', ['#3586D1', '#6754DF', '#FF5574', '#FF8A47'][q.correct] || '#3FCF8E');
      setText(why.querySelector('.qzp-wl'), `✓ ${L[q.correct] || ''} · ${tx('table.qp.why')}:`);
      setText(why.querySelector('.qzp-wt'), typo(w));
      const len = w.length;
      why.style.fontSize = len > 180 ? '1.9rem' : len > 120 ? '2.1rem' : '2.3rem';
    }
    // ×2 flash once when a doubled question opens
    const fl = el.querySelector('.qzp-flash');
    if (mode === 'question' && x2 && flashSeq !== q.seq) {
      flashSeq = q.seq;
      fl.hidden = false; fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
      setTimeout(() => { fl.hidden = true; }, 2300);
    } else if (mode !== 'question') fl.hidden = true;
    // board / lobby: announce a doubled next question
    el.querySelectorAll('.qzp-next2').forEach((n) => (n.hidden = !q.nextDouble || !(mode === 'board' || lobby)));
    const lob = el.querySelector('.qzp-lob');
    lob.hidden = !lobby;
    if (lobby) {
      drawReady(s);
      if (readyRun !== q.seq) { readyRun = q.seq; ready = null; drawReady(s); pollReady(); }
      else if (!readyTimer) pollReady();
    } else readyRun = null;
  }

  // ---------- podium finale ----------
  let pod = null;
  function podEl() {
    if (pod) return pod;
    pod = document.createElement('div');
    pod.className = 'qzp-pod hidden';
    pod.id = 'qzpodium';
    pod.setAttribute('role', 'region');
    pod.setAttribute('aria-label', tx('table.qp.final'));
    (document.getElementById('stage') || document.body).appendChild(pod);
    return pod;
  }
  function stopPod() { podTimers.forEach(clearTimeout); podTimers = []; }
  const cue = (step) => { try { document.dispatchEvent(new CustomEvent('mup:quizpodium', { detail: { step } })); } catch {} };
  function podium(s, q) {
    const p = podEl();
    const rows = q.leaders || [];
    const k = q.seq + '|' + JSON.stringify(rows);
    p.classList.remove('hidden');
    if (k === podKey) return;
    podKey = k;
    stopPod();
    p.className = 'qzp-pod';
    const col = (r, place) => {
      if (!r) return `<div class="qzp-col p${place} none"><div class="qzp-who"></div><div class="qzp-step"><span class="qzp-pl">${place}</span></div></div>`;
      const t = team(s, r.team);
      return `<div class="qzp-col p${place}"><div class="qzp-who"><div class="qzp-medal">${['🥇', '🥈', '🥉'][place - 1]}</div><div class="qzp-nm">${esc(r.name)}</div><div class="qzp-tm"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</div><div class="qzp-pts">${pts(r.quizPoints)} <small>${esc(tx('table.qp.pts'))}</small></div></div><div class="qzp-step"><span class="qzp-pl">${place}</span></div></div>`;
    };
    const rest = rows.map((r, i) => {
      const t = team(s, r.team);
      return `<li style="--d:${i * 70}ms" class="${i < 3 ? 'top' + (i + 1) : ''}"><span class="qzp-rp">${i + 1}</span><span class="qzp-rn">${esc(r.name)}</span><span class="qzp-rt"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</span><span class="qzp-rv">${pts(r.quizPoints)}</span></li>`;
    }).join('');
    p.innerHTML = `<div class="qzp-head"><div class="qzp-kick">${esc(q.setTitle || '')}</div><h2>${esc(tx('table.qp.final'))}</h2></div>
      ${rows.length ? `<div class="qzp-body"><div class="qzp-stage">${col(rows[1], 2)}${col(rows[0], 1)}${col(rows[2], 3)}<div class="qzp-drum"><span></span><span></span><span></span><em>${esc(tx('table.qp.drum'))}</em></div></div>
      <ol class="qzp-list">${rest}</ol></div>` : `<div class="qzp-none">${esc(tx('table.qp.empty'))}</div>`}`;
    // 3rd → 2nd → drumroll → 1st → top 10 (timings also in table-quizplus.css)
    const steps = [[600, 's3', 'third'], [1900, 's2', 'second'], [3100, 'sd', 'drum'], [5400, 's1', 'first'], [8600, 's10', 'top10']];
    for (const [ms, cls, name] of steps) podTimers.push(setTimeout(() => { p.classList.add(cls); cue(name); }, ms));
  }
  function hidePod() {
    if (!pod || pod.classList.contains('hidden')) return;
    stopPod(); podKey = '';
    pod.classList.add('hidden');
    pod.className = 'qzp-pod hidden';
  }

  function render(s) {
    const q = s.quiz;
    const plus = !!(q && on(s, 'quiz') && on(s, 'quizplus'));
    if (!plus) { clear(); hidePod(); return; }
    if (q.state === 'done') podium(s, q); else hidePod();
    if (['idle', 'done'].includes(q.state) || !el.querySelector('.qz-play')) return;
    const mode = q.state === 'board' && (q.idx ?? -1) < 0 ? 'lobby' : q.state;
    play(s, q, mode);
  }

  T.screens.push(render);
})();
