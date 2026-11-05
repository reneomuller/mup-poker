// Small UI kit for the phone screen: DOM morphing (no flicker on polls), haptics, toasts.
(function () {
  // ---------- morph: patch a subtree to match new HTML, keeping nodes, focus and scroll ----------
  // Elements with data-own are created once and then left alone (their code manages them).
  // Elements with data-key are matched by key inside their parent (lists that reorder).
  const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') : null);
  const sameKind = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && keyOf(a) === keyOf(b)));

  function patchChildren(a, b) {
    let ac = a.firstChild;
    let bc = b.firstChild;
    while (bc) {
      const bn = bc.nextSibling;
      if (ac && sameKind(ac, bc)) {
        patchNode(ac, bc);
        ac = ac.nextSibling;
      } else {
        const k = keyOf(bc);
        let m = null;
        if (k) for (let x = ac; x; x = x.nextSibling) if (keyOf(x) === k && x.tagName === bc.tagName) { m = x; break; }
        if (m) { a.insertBefore(m, ac); patchNode(m, bc); } else a.insertBefore(bc, ac);
      }
      bc = bn;
    }
    while (ac) { const n = ac.nextSibling; a.removeChild(ac); ac = n; }
  }

  function patchNode(a, b) {
    if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    if (a.hasAttribute('data-own')) return;
    for (const { name, value } of Array.from(b.attributes)) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
    for (const { name } of Array.from(a.attributes)) if (!b.hasAttribute(name)) a.removeAttribute(name);
    const tag = a.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (document.activeElement !== a && a.value !== b.value) a.value = b.value;
      if (tag === 'INPUT' && a.checked !== b.checked) a.checked = b.checked;
      return;
    }
    patchChildren(a, b);
  }

  function morph(root, html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    patchChildren(root, t.content);
  }

  // ---------- haptics ----------
  const canVibe = typeof navigator !== 'undefined' && 'vibrate' in navigator;
  // browsers refuse (and log an error) before the first tap, so only buzz after one
  let touched = false;
  addEventListener('pointerdown', () => { touched = true; }, { capture: true, passive: true });
  const active = () => (navigator.userActivation ? navigator.userActivation.hasBeenActive : touched);
  const buzz = (p) => { if (canVibe && active()) try { navigator.vibrate(p); } catch {} };
  const haptic = { tap: () => buzz(8), ok: () => buzz([12, 40, 18]), err: () => buzz([30, 50, 30]) };

  // ---------- toast ----------
  let toastEl = null, toastT = null;
  function toast(html, kind = '') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 's-toast p-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.className = 's-toast p-toast' + (kind ? ' p-toast-' + kind : '');
    toastEl.innerHTML = html;
    requestAnimationFrame(() => toastEl.classList.add('s-show'));
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('s-show'), kind === 'err' ? 4200 : 3200);
  }

  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.PK = { morph, haptic, toast, reduced };
})();
