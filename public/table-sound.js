// v4 sound lane: projector glue for public/sound.js. A small corner button „🔊 Zvuk“ / „🔇“ (toggles and unlocks
// audio, remembered in localStorage), the `sound` feature flag, and "first click / key anywhere unlocks" when the
// remembered preference is on. The cues themselves are one-line hooks in table.js / table-quiz.js.
(function () {
  const S = window.MupSound, T = window.TBL;
  if (!S || !T) return;
  const st = document.createElement('style');
  st.textContent = `
    .snd-btn { position: fixed; left: 8px; bottom: 8px; z-index: 200; font: 600 14px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
      padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(242,234,214,.28); background: rgba(10,14,12,.55); color: #F2EAD6;
      opacity: .5; cursor: pointer; transition: opacity .2s; white-space: nowrap; }
    .snd-btn:hover, .snd-btn:focus-visible { opacity: 1; }
    .snd-btn.off { opacity: .7; }
    .snd-btn.idle { opacity: 0; }
    body.tapeon .snd-btn { bottom: calc(var(--tape-h, 0px) + 8px); }
    .snd-btn[hidden] { display: none; }`;
  document.head.appendChild(st);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'snd-btn';
  btn.hidden = true;
  document.body.appendChild(btn);
  function paint() {
    const live = S.playing;
    const v = live ? '🔊 Zvuk' : '🔇';
    if (btn.textContent !== v) btn.textContent = v;
    btn.classList.toggle('off', !live);
    btn.setAttribute('aria-pressed', String(live));
    btn.title = live ? 'Vypnout zvuk' : 'Zapnout zvuk';
    btn.setAttribute('aria-label', btn.title);
    btn.hidden = !S.allowed;
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (S.playing) S.setEnabled(false);
    else { S.setEnabled(true); S.unlock(); }
    paint();
  });
  // browsers only start audio after a user gesture: the first click / key on the projector (e.g. "f" for full screen) does it
  const gesture = (e) => { if (e.target !== btn && S.enabled && S.allowed && !S.unlocked) S.unlock(); };
  addEventListener('pointerdown', gesture, true);
  addEventListener('keydown', gesture, true);
  // the corner button sits over the market tape's label / the quiz footer: it fades out 4 s after the last mouse move
  let idleT = 0;
  const wake = () => { btn.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => btn.classList.add('idle'), 4000); };
  addEventListener('pointermove', wake, true);
  addEventListener('pointerdown', wake, true);
  addEventListener('keydown', wake, true);
  wake();
  S.onchange = paint;
  // runs before the quiz screen (script order), so the flag is set before any cue of the same tick
  T.screens.push((s) => { S.setAllowed(T.on(s, 'sound')); paint(); });
})();
