// Quiz takeover on the projector: question + countdown ring, answer split, top-10 board.
(function () {
  const T = window.TBL;
  if (!T) return;
  const { $, esc, setText, setHTML, toggle, team, on } = T;
  const tx = MUP.t;
  MUP.addTexts({
    'table.quiz.kick': 'Kvíz',
    'table.quiz.q': 'Otázka {n} / {total}',
    'table.quiz.answers': 'Odpovědi',
    'table.quiz.fastest': 'Nejrychlejší správná odpověď',
    'table.quiz.noneCorrect': 'Správně neodpověděl nikdo.',
    'table.quiz.board': 'Průběžné pořadí',
    'table.quiz.final': 'Konečné pořadí',
    'table.quiz.lobby': 'Připravte si mobily',
    'table.quiz.lobbyHint': 'Odpovídejte na mobilu. Čím rychlejší správná odpověď, tím víc bodů.',
    'table.quiz.count': '{n} otázek',
    'table.quiz.total': 'celkem',
    'table.quiz.empty': 'Zatím nikdo nebodoval.',
    'table.quiz.timeUp': 'Čas!',
    'table.quiz.sec': 's',
  });
  const L = ['A', 'B', 'C', 'D'];
  const R = 46, C = 2 * Math.PI * R;
  const el = $('quiz');
  let built = false, key = '', cur = null, raf = 0;

  const nb = (n) => String(n).replace(/\s/g, ' ');
  const pts = (n) => nb((Math.round(n) || 0).toLocaleString('cs-CZ'));
  const secs = (ms) => nb((Math.round(ms / 100) / 10).toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 })) + ' ' + tx('table.quiz.sec');

  function build() {
    el.innerHTML = `
      <div class="qz-top"><div class="qz-kick"><span class="qz-logo">${esc(tx('table.quiz.kick'))}</span><span class="qz-set"></span></div><div class="qz-count"></div></div>
      <div class="qz-main">
        <div class="qz-play">
          <div class="qz-qrow"><div class="qz-qt"></div>
            <div class="qz-ring"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="${R}"/><circle class="arc" cx="50" cy="50" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg><b></b></div>
          </div>
          <div class="qz-tiles"></div>
          <div class="qz-foot"><div class="qz-ans"></div><div class="qz-fast"></div></div>
        </div>
        <div class="qz-boardw"><div class="qz-bt"></div><ol class="qz-board"></ol></div>
        <div class="qz-lobby"><div class="qz-lt"></div><div class="qz-ls"></div><div class="qz-lq"><div class="qz-qr"></div><div class="qz-lh"></div></div></div>
      </div>`;
    try { const q = qrcode(0, 'M'); q.addData(location.origin + '/play'); q.make(); el.querySelector('.qz-qr').innerHTML = q.createSvgTag(4, 0); } catch {}
    built = true;
  }

  function tiles(q, reveal) {
    const box = el.querySelector('.qz-tiles');
    const n = (q.a || []).length;
    box.dataset.n = n;
    const k = JSON.stringify([q.q, q.a]);
    if (box._k !== k) {
      box._k = k;
      box.innerHTML = (q.a || []).map((a, i) => `<div class="qz-tile c${i}" data-quiz="${i}" style="--d:${i * 90}ms"><i class="qz-bar"></i><span class="qz-l">${L[i]}</span><span class="qz-a">${esc(a)}</span><span class="qz-n"></span></div>`).join('');
    }
    const max = reveal ? Math.max(1, ...(q.counts || [])) : 1;
    const sum = reveal ? (q.counts || []).reduce((a, b) => a + b, 0) : 0;
    box.querySelectorAll('.qz-tile').forEach((t, i) => {
      const c = reveal ? q.counts?.[i] || 0 : 0;
      toggle(t, 'right', reveal && i === q.correct);
      toggle(t, 'wrong', reveal && i !== q.correct);
      t.querySelector('.qz-bar').style.transform = `scaleX(${reveal ? c / max : 0})`;
      setText(t.querySelector('.qz-n'), reveal ? `${c}` + (sum ? ` · ${Math.round((c / sum) * 100)} %` : '') : '');
    });
    toggle(box, 'reveal', !!reveal);
  }

  function ringLoop() {
    raf = 0;
    const q = cur;
    if (!q || q.state !== 'question') return;
    const total = Math.max(1, (q.endsAt || 0) - (q.startedAt || 0)) || (q.time || 20) * 1000;
    const left = Math.max(0, (q.endsAt || 0) - MUP.now());
    const ring = el.querySelector('.qz-ring');
    const arc = ring.querySelector('.arc');
    const off = (C * (1 - left / total)).toFixed(1);
    if (arc._o !== off) { arc._o = off; arc.setAttribute('stroke-dashoffset', off); }
    setText(ring.querySelector('b'), left > 0 ? String(Math.ceil(left / 1000)) : tx('table.quiz.timeUp'));
    toggle(ring, 'low', left > 0 && left <= 5000);
    toggle(ring, 'over', left <= 0);
    raf = requestAnimationFrame(ringLoop);
  }

  function board(s, q) {
    const ol = el.querySelector('.qz-board');
    const last = q.state === 'done' || (q.total && q.idx >= q.total - 1);
    setText(el.querySelector('.qz-bt'), last ? tx('table.quiz.final') : tx('table.quiz.board'));
    const rows = q.leaders || [];
    const k = JSON.stringify(rows) + q.seq;
    if (ol._k === k) return;
    ol._k = k;
    if (!rows.length) { ol.innerHTML = `<li class="qz-empty">${esc(tx('table.quiz.empty'))}</li>`; return; }
    const n = rows.length;
    ol.innerHTML = rows.map((r, i) => {
      const t = team(s, r.team);
      return `<li style="--d:${(n - 1 - i) * 110 + 150}ms" class="${i < 3 ? 'top' + (i + 1) : ''}"><span class="qz-pos">${i + 1}</span><span class="qz-nm">${esc(r.name)}</span><span class="qz-tm"><span class="dot" style="background:${t.color}"></span><span class="qz-tmn">${esc(t.name)}</span></span><span class="qz-pts">${pts(r.quizPoints)}</span><span class="qz-tot">${esc(tx('table.quiz.total'))} ${pts(r.total)}</span></li>`;
    }).join('');
  }

  function render(s) {
    const q = s.quiz;
    const live = !!(q && on(s, 'quiz') && !['idle', 'done'].includes(q.state));
    toggle(el, 'hidden', !live);
    document.body.classList.toggle('quizon', live);
    if (!live) { cur = null; if (raf) cancelAnimationFrame(raf); raf = 0; return; }
    if (!built) build();
    cur = q;
    const lobby = q.state === 'board' && (q.idx ?? -1) < 0;
    const mode = lobby ? 'lobby' : q.state === 'board' ? 'board' : q.state;
    const k = mode + '|' + q.seq;
    if (k !== key) {
      key = k;
      el.dataset.state = mode;
      // restart the entry animations
      const main = el.querySelector('.qz-main');
      main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
    }
    setText(el.querySelector('.qz-set'), q.setTitle || '');
    setText(el.querySelector('.qz-count'), q.idx >= 0 && q.total ? tx('table.quiz.q', { n: Math.min(q.idx + 1, q.total), total: q.total }) : '');
    if (mode === 'lobby') {
      setText(el.querySelector('.qz-lt'), q.setTitle || tx('table.quiz.kick'));
      setText(el.querySelector('.qz-ls'), (q.total ? tx('table.quiz.count', { n: q.total }) + ' · ' : '') + tx('table.quiz.lobby'));
      setText(el.querySelector('.qz-lh'), tx('table.quiz.lobbyHint'));
      return;
    }
    if (mode === 'board') { board(s, q); return; }
    // question / reveal
    const qt = el.querySelector('.qz-qt');
    if (qt._t !== q.q) {
      setText(qt, q.q || '');
      const len = (q.q || '').length;
      qt.style.fontSize = len > 120 ? '3rem' : len > 80 ? '3.5rem' : '4rem';
    }
    tiles(q, mode === 'reveal');
    setHTML(el.querySelector('.qz-ans'), `${esc(tx('table.quiz.answers'))} <b>${q.answered || 0}</b>&nbsp;/&nbsp;${s.playerCount || 0}`);
    const fast = el.querySelector('.qz-fast');
    if (mode === 'reveal') {
      const f = q.fastest;
      if (f) {
        const t = team(s, f.team);
        setHTML(fast, `<span class="qz-fk">⚡ ${esc(tx('table.quiz.fastest'))}</span> <b>${esc(f.name)}</b> <span class="qz-ft"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</span> <span class="qz-fs">${secs(f.ms)}</span>`);
      } else setHTML(fast, `<span class="qz-fk">${esc(tx('table.quiz.noneCorrect'))}</span>`);
    } else setHTML(fast, '');
    toggle(el.querySelector('.qz-ring'), 'gone', mode !== 'question');
    if (mode === 'question' && !raf) raf = requestAnimationFrame(ringLoop);
  }

  T.screens.push(render);
})();
