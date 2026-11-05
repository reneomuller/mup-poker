// v4 quizplus on the phone (flag `quizplus`): ×2 badge, a small question image, „Proč: …“ at the reveal,
// the ×2 announcement before a doubled question, the lobby „ready“ ping and the final card (rank, points,
// best streak). play.js calls MupQuizPlus.phone() with the quiz body it built and shows what comes back.
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nb = (s) => String(s).replace(/\s/g, ' ');
  const num = (n) => nb((Math.round(Number(n) || 0)).toLocaleString('cs-CZ'));
  const COL = ['#3586D1', '#6754DF', '#FF5574', '#FF8A47'];
  const pinged = new Set();
  const ins = (body, marker, html) => { const i = body.indexOf(marker); return i < 0 ? body : body.slice(0, i) + html + body.slice(i); };
  const x2 = '<div class="qzp-x2" role="status"><b>×2</b> Dvojnásobné body</div>';
  const next2 = '<div class="qzp-next2" role="status"><b>×2</b> Další otázka: dvojnásobné body</div>';

  function phone({ mode, q, mq, me, S, body, ready }) {
    const on = !!(S && S.features && S.features.quizplus);
    if (!on || !q) return body;
    if (mode === 'question') {
      if (q.double) body = ins(body, '<div class="qz-q">', x2);
      if (q.img && /^https:\/\//.test(q.img)) body = ins(body, '<div class="qz-tiles', `<div class="qzp-img"><img src="${esc(q.img)}" alt="${esc(q.q || '')}" referrerpolicy="no-referrer" decoding="async" onerror="this.parentNode.hidden=true"></div>`);
      return body;
    }
    if (mode === 'reveal') {
      if (q.double) body = ins(body, '<p class="qz-qs">', '<div class="qzp-x2 sm"><b>×2</b> Otázka za dvojnásobné body</div>');
      if (q.why) body = ins(body, '<div class="qz-foot">', `<div class="qzp-why" style="--qc:${COL[q.correct] || '#3FCF8E'}"><b>Proč:</b> ${esc(q.why)}</div>`);
      return body;
    }
    if (mode === 'board' && (q.idx ?? -1) < 0) {
      // lobby: tell the projector this phone is on the quiz screen (once per run; the server ignores repeats)
      if (ready && !pinged.has(q.seq)) { pinged.add(q.seq); ready(); }
      if (q.nextDouble) body = ins(body, '<div class="qz-dots">', next2);
      return body;
    }
    if (mode === 'board') return q.nextDouble ? ins(body, '<div class="qz-rank">', next2) : body;
    if (mode === 'done') {
      const has = mq.rank && mq.runPoints > 0;
      const medal = has && mq.rank <= 3 ? ['🥇', '🥈', '🥉'][mq.rank - 1] : '';
      const best = Number(mq.bestStreak) || 0;
      const card = `<div class="qzp-final ${has && mq.rank <= 3 ? 'top' : ''}">
        <div class="s-label">Konečné pořadí</div>
        <div class="qzp-fr s-num">${medal ? `<span class="qzp-medal" aria-hidden="true">${medal}</span>` : ''}${has ? esc(mq.rank) + '.' : '–'}</div>
        <div class="s-muted">${has ? `místo z ${esc(S.playerCount)}` : 'V tomto kvízu bez bodů.'}</div>
        <div class="qzp-fs"><div><span class="s-label">Body</span><b class="s-num">${esc(num(mq.runPoints || 0))}</b></div><div><span class="s-label">Nejdelší série</span><b class="s-num">${esc(best)}${best >= 2 ? ' 🔥' : ''}</b></div></div>
      </div>`;
      return ins(body, '<div class="qz-rank">', card);
    }
    return body;
  }
  window.MupQuizPlus = { phone };
})();
