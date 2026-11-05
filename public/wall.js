/* MUP poker v3 – team sticker wall (V3-SPEC §6). Plain JS, no dependencies.
   const w = window.MupWall.mount(el, { role, teams, team, api, canSendAll, pollMs });
   w.refresh(); w.setTeam(id); w.destroy();
   All user text goes through textContent, never innerHTML. */
(function () {
  'use strict';
  var NB = '\u00a0';
  var MAX = 500;
  var KIND = { q: 'Otázka', task: 'Úkol' };
  var uid = 0;

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') e[k] = v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function hash(s) { var x = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  // ±3–10° from the id, only the paper turns
  function tilt(id) { var x = hash(id); var mag = 3 + (x % 701) / 100; return ((x >>> 12) & 1 ? mag : -mag).toFixed(2) + 'deg'; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function errMsg(e) { var m = e && (e.message || e.error || e.msg); return m ? String(m) : 'Něco se nepovedlo. Zkus to znovu.'; }
  function checkOk(r) { if (r && typeof r === 'object' && !Array.isArray(r) && r.ok === false) throw new Error(r.error || r.msg || ''); return r; }
  function call(fn, arg) { return Promise.resolve().then(function () { if (typeof fn !== 'function') throw new Error('Akce není k dispozici.'); return fn(arg); }).then(checkOk); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function when(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date();
    if (isNaN(d)) return '';
    var t = d.getHours() + ':' + pad(d.getMinutes());
    if (now - d < 60000 && now - d > -60000) return 'teď';
    if (d.toDateString() === now.toDateString()) return 'dnes ' + t;
    return d.getDate() + '.' + NB + (d.getMonth() + 1) + '.' + NB + t;
  }
  function plural(n, one, few, many) { return n === 1 ? one : (n >= 2 && n <= 4 ? few : many); }
  function replyCount(n) { return n + NB + plural(n, 'odpověď', 'odpovědi', 'odpovědí'); }
  function noteCount(n) { return n + NB + plural(n, 'lísteček', 'lístečky', 'lístečků'); }
  function whoName(by, mine) {
    if (mine) return 'Ty';
    if (!by) return '';
    if (by.role === 'dealer') return by.name || 'MUP';
    return by.name || 'Student';
  }
  function tmpId() { return 'tmp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function mount(el, opts) {
    if (!el) throw new Error('MupWall.mount: missing element');
    opts = opts || {};
    var role = opts.role === 'dealer' ? 'dealer' : 'student';
    var isDealer = role === 'dealer';
    var api = opts.api || {};
    var teams = arr(opts.teams);
    var pollMs = opts.pollMs == null ? 4000 : Number(opts.pollMs) || 0;
    var canSendAll = isDealer && !!opts.canSendAll;
    var me = 'mw' + (++uid);

    var st = {
      team: opts.team != null ? opts.team : (isDealer && teams[0] ? teams[0].id : null),
      walls: {}, loaded: false, loadErr: '', seq: 0, inflight: false,
      kind: 'q', all: false, target: null,
      tmp: [],            // optimistic stickers: { team, s }
      tmpReplies: [],     // { team, sid, r }
      doneOv: {},         // 'team|sid' -> bool
      hidden: {},         // 'team|sid' or 'team|sid|rid' -> true while deleting
      open: null,         // { team, id }
      confirm: null,      // 'sticker' or reply id awaiting delete confirm
      sig: '', destroyed: false,
    };

    function key(team) { return team == null ? '_' : String(team); }
    function teamArg(team) { return isDealer ? { team: team } : {}; }
    function teamById(id) { for (var i = 0; i < teams.length; i++) if (String(teams[i].id) === String(id)) return teams[i]; return null; }
    function teamName(id) { var t = teamById(id); return t ? t.name : String(id); }
    function assign(a, b) { for (var k in b) a[k] = b[k]; return a; }

    // the data as shown: server data + optimistic overlays
    function view(tk) {
      var list = [];
      st.tmp.forEach(function (p) { if (key(p.team) === tk) list.push(p.s); });
      arr(st.walls[tk]).forEach(function (s) {
        if (!s || st.hidden[tk + '|' + s.id]) return;
        var o = assign({}, s);
        var dk = tk + '|' + s.id;
        if (dk in st.doneOv) o.done = st.doneOv[dk];
        o.replies = arr(s.replies).filter(function (r) { return !st.hidden[tk + '|' + s.id + '|' + r.id]; });
        st.tmpReplies.forEach(function (p) { if (key(p.team) === tk && p.sid === s.id) o.replies = o.replies.concat([p.r]); });
        list.push(o);
      });
      return list;
    }
    function find(team, id) {
      var l = view(key(team));
      for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
      return null;
    }
    function canDel(x) { return isDealer || !!(x && x.mine); }
    function wallKeys() {
      if (st.team !== 'all') return [key(st.team)];
      var ks = teams.map(function (t) { return String(t.id); });
      Object.keys(st.walls).forEach(function (k) { if (ks.indexOf(k) < 0) ks.push(k); });
      return ks;
    }

    // ---------- DOM skeleton
    var root = h('div', { class: 'mw-root mw-role-' + role });
    var status = h('p', { class: 'mw-status', role: 'status', 'aria-live': 'polite' });
    var board = h('div', { class: 'mw-board' });
    var comp = {};
    el.textContent = '';
    el.appendChild(root);

    function buildComposer() {
      var segQ = h('button', { type: 'button', class: 'mw-seg-btn', 'data-kind': 'q', onclick: function () { setKind('q'); } }, KIND.q);
      var segT = h('button', { type: 'button', class: 'mw-seg-btn', 'data-kind': 'task', onclick: function () { setKind('task'); } }, KIND.task);
      var ta = h('textarea', { class: 'mw-input', id: me + '-text', rows: 3, maxlength: MAX, 'aria-label': 'Text lístečku', oninput: updCount, onkeydown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(e); } } });
      var count = h('span', { class: 'mw-count', 'aria-live': 'off' }, '0/' + MAX);
      var send = h('button', { type: 'submit', class: 'mw-send' }, 'Přilepit');
      var err = h('p', { class: 'mw-err', role: 'alert' });
      var allBox = null, allWrap = null, target = null, targetWrap = null;
      if (canSendAll) {
        allBox = h('input', { type: 'checkbox', class: 'mw-all-box', onchange: function () { st.all = allBox.checked; updTarget(); } });
        allWrap = h('label', { class: 'mw-all' }, [allBox, h('span', null, 'Poslat všem týmům')]);
      }
      if (isDealer && st.team === 'all') {
        target = h('select', { class: 'mw-target-sel', 'aria-label': 'Komu poslat', onchange: function () { st.target = target.value; } },
          teams.map(function (t) { return h('option', { value: t.id }, t.name); }));
        if (st.target == null && teams[0]) st.target = String(teams[0].id);
        if (st.target != null) target.value = st.target;
        targetWrap = h('label', { class: 'mw-target' }, [h('span', null, 'Komu'), target]);
      }
      var form = h('form', { class: 'mw-composer', novalidate: true, onsubmit: submit, 'aria-label': 'Nový lísteček' }, [
        h('div', { class: 'mw-seg', role: 'group', 'aria-label': 'Druh lístečku' }, [segQ, segT]),
        targetWrap,
        ta,
        h('div', { class: 'mw-composer-foot' }, [allWrap, count, send]),
        err,
      ]);
      comp = { form: form, segQ: segQ, segT: segT, ta: ta, count: count, send: send, err: err, allBox: allBox, allWrap: allWrap, target: target };
      setKind(st.kind);
      return form;
    }
    function setKind(k) {
      st.kind = k === 'task' ? 'task' : 'q';
      comp.segQ.setAttribute('aria-pressed', String(st.kind === 'q'));
      comp.segT.setAttribute('aria-pressed', String(st.kind === 'task'));
      comp.form.classList.toggle('mw-k-task', st.kind === 'task');
      comp.form.classList.toggle('mw-k-q', st.kind === 'q');
      comp.ta.placeholder = st.kind === 'q'
        ? (isDealer ? 'Na co se chceš týmu zeptat?' : 'Na co se chceš zeptat týmu nebo MUP?')
        : 'Co je potřeba udělat?';
      if (comp.allWrap) comp.allWrap.hidden = st.kind !== 'task';
      updTarget();
    }
    function sendAll() { return canSendAll && st.kind === 'task' && st.all; }
    function updTarget() { if (comp.target) comp.target.disabled = sendAll(); }
    function updCount() {
      var n = comp.ta.value.length;
      comp.count.textContent = n + '/' + MAX;
      comp.count.classList.toggle('mw-count-hi', n > MAX - 50);
      if (comp.err.textContent && comp.ta.value.trim()) comp.err.textContent = '';
    }

    function submit(e) {
      if (e && e.preventDefault) e.preventDefault();
      var text = comp.ta.value.trim();
      comp.err.textContent = '';
      if (!text) { comp.err.textContent = 'Text je prázdný.'; comp.ta.focus(); return; }
      if (text.length > MAX) { comp.err.textContent = 'Text je moc dlouhý (max.' + NB + MAX + ' znaků).'; return; }
      var kind = st.kind, all = sendAll();
      var team = st.team === 'all' ? (comp.target ? comp.target.value : null) : st.team;
      if (isDealer && !all && (team == null || team === 'all')) { comp.err.textContent = 'Vyber tým.'; return; }
      var body = { kind: kind, text: text };
      if (isDealer) { if (all) body.all = true; else body.team = team; }
      var by = isDealer ? { role: 'dealer', name: 'MUP' } : { role: 'student', name: 'Ty' };
      var targets = all ? (st.team === 'all' ? wallKeys() : [key(st.team)]) : [key(st.team === 'all' ? team : st.team)];
      var temps = targets.map(function (tk) {
        var p = { team: tk, s: { id: tmpId(), kind: kind, text: text, by: by, ts: Date.now(), mine: true, done: false, replies: [], pending: true } };
        st.tmp.push(p); return p;
      });
      comp.ta.value = ''; updCount();
      if (comp.allBox) { comp.allBox.checked = false; st.all = false; updTarget(); }
      render();
      call(api.post, body).then(function () {
        return load().then(drop, drop);
      }, function (er) {
        drop();
        if (!comp.ta.value) { comp.ta.value = text; updCount(); }
        comp.err.textContent = errMsg(er);
      });
      function drop() { st.tmp = st.tmp.filter(function (p) { return temps.indexOf(p) < 0; }); render(); }
    }

    function rebuild() {
      root.textContent = '';
      root.appendChild(buildComposer());
      root.appendChild(status);
      root.appendChild(board);
      st.sig = '';
      render();
    }

    // ---------- board
    function noteEl(s, tk) {
      var isTask = s.kind === 'task';
      var dealerBy = s.by && s.by.role === 'dealer';
      var rc = arr(s.replies).length;
      var cls = 'mw-note ' + (isTask ? 'mw-k-task' : 'mw-k-q') + (isTask && s.done ? ' mw-done' : '') + (s.pending ? ' mw-pending' : '') + (dealerBy ? ' mw-by-dealer' : '');
      var label = KIND[isTask ? 'task' : 'q'] + (isTask && s.done ? ' (hotovo)' : '') + ', ' + whoName(s.by, s.mine) + ': ' + String(s.text || '').slice(0, 80);
      return h('button', { type: 'button', class: cls, style: '--mw-tilt:' + tilt(s.id), 'data-id': s.id, 'data-team': tk, 'aria-haspopup': 'dialog', 'aria-label': label, disabled: !!s.pending,
        onclick: function () { openSticker(tk, s.id, this); } }, [
        h('span', { class: 'mw-paper-wrap', 'aria-hidden': 'true' }, [h('span', { class: 'mw-paper' }), h('span', { class: 'mw-fold' })]),
        h('span', { class: 'mw-note-in' }, [
          h('span', { class: 'mw-note-top' }, [
            h('span', { class: 'mw-chip' }, KIND[isTask ? 'task' : 'q']),
            dealerBy ? h('span', { class: 'mw-badge' }, 'MUP') : null,
            s.ghost && isDealer ? h('span', { class: 'mw-ghost' }, 'duch') : null,
            isTask && s.done ? h('span', { class: 'mw-tick', 'aria-hidden': 'true' }, '✓') : null,
          ]),
          h('span', { class: 'mw-note-text' }, String(s.text || '')),
          h('span', { class: 'mw-note-foot' }, [
            h('span', { class: 'mw-who' }, s.pending ? 'Odesílám…' : whoName(s.by, s.mine)),
            rc ? h('span', { class: 'mw-rc' }, replyCount(rc)) : null,
          ]),
        ]),
      ]);
    }
    function gridEl(list, tk, emptyText) {
      if (!list.length) return h('p', { class: 'mw-empty' }, emptyText);
      return h('div', { class: 'mw-grid' }, list.map(function (s) { return noteEl(s, tk); }));
    }
    function render() {
      if (st.destroyed) return;
      var keys = wallKeys();
      var data = keys.map(function (k) { return view(k); });
      var sig = JSON.stringify([st.team, st.loaded, st.loadErr, data]);
      if (sig !== st.sig) {
        st.sig = sig;
        var act = document.activeElement, focusId = null, focusTeam = null;
        if (act && board.contains(act) && act.getAttribute('data-id')) { focusId = act.getAttribute('data-id'); focusTeam = act.getAttribute('data-team'); }
        board.textContent = '';
        status.textContent = st.loadErr;
        status.classList.toggle('mw-status-err', !!st.loadErr);
        if (!st.loaded && !st.loadErr) board.appendChild(h('p', { class: 'mw-empty' }, 'Načítám nástěnku…'));
        else if (st.team === 'all') {
          keys.forEach(function (k, i) {
            var t = teamById(k) || { id: k, name: k, color: '' };
            var list = data[i];
            var nq = list.filter(function (s) { return s.kind !== 'task'; }).length;
            var nt = list.length - nq;
            var open = list.filter(function (s) { return s.kind === 'task' && !s.done; }).length;
            board.appendChild(h('section', { class: 'mw-team', style: t.color ? '--mw-team:' + String(t.color).replace(/[^#a-zA-Z0-9(),.% -]/g, '') : null, 'aria-label': 'Nástěnka týmu ' + t.name }, [
              h('h3', { class: 'mw-team-h' }, [
                h('span', { class: 'mw-team-dot', 'aria-hidden': 'true' }),
                h('span', { class: 'mw-team-name' }, t.name),
                h('span', { class: 'mw-team-n' }, list.length ? noteCount(list.length) + ' · ' + nq + NB + plural(nq, 'otázka', 'otázky', 'otázek') + ' · ' + open + '/' + nt + NB + 'úkolů otevřeno' : 'prázdná'),
              ]),
              gridEl(list, k, 'Zatím bez lístečků.'),
            ]));
          });
          if (!keys.length) board.appendChild(h('p', { class: 'mw-empty' }, 'Žádné týmy.'));
        } else {
          board.appendChild(gridEl(data[0], keys[0], isDealer ? 'Nástěnka je zatím prázdná. Přilep týmu první otázku nebo úkol.' : 'Nástěnka je zatím prázdná. Přilep první otázku nebo úkol pro tým.'));
        }
        if (focusId) {
          var n = board.querySelector('[data-id="' + cssEsc(focusId) + '"][data-team="' + cssEsc(focusTeam) + '"]');
          if (n) n.focus();
        }
      }
      updModal();
    }
    function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

    // ---------- loading + polling
    function load() {
      if (st.destroyed) return Promise.resolve();
      var my = ++st.seq, team = st.team;
      st.inflight = true;
      return call(api.list, team).then(function (res) {
        if (st.destroyed || my !== st.seq || team !== st.team) return;
        var walls = {};
        if (team === 'all') {
          var w = (res && res.walls) || {};
          Object.keys(w).forEach(function (k) { walls[k] = arr(w[k]); });
        } else walls[key(team)] = Array.isArray(res) ? res : arr(res && res.stickers);
        st.walls = walls; st.loaded = true; st.loadErr = '';
        render();
      }, function (e) {
        if (st.destroyed || my !== st.seq) return;
        st.loadErr = 'Nástěnku se nepodařilo načíst: ' + errMsg(e);
        render();
      }).then(function () { if (my === st.seq) st.inflight = false; });
    }
    var timer = null;
    function tick() {
      if (st.destroyed || st.inflight) return;
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      load();
    }
    function onVis() { if (document.visibilityState === 'visible') tick(); }
    if (pollMs > 0) timer = setInterval(tick, pollMs);
    document.addEventListener('visibilitychange', onVis);

    // ---------- modal
    var M = null;
    function openSticker(tk, id, opener) {
      closeModal(true);
      st.open = { team: tk, id: id };
      st.confirm = null;
      var s = find(tk, id);
      if (!s) { st.open = null; return; }
      var tid = me + '-dlg';
      var chip = h('span', { class: 'mw-chip' });
      var badge = h('span', { class: 'mw-badge' }, 'MUP');
      var title = h('h2', { class: 'mw-dlg-title', id: tid });
      var closeBtn = h('button', { type: 'button', class: 'mw-x', 'aria-label': 'Zavřít', onclick: function () { closeModal(); } }, '×');
      var full = h('p', { class: 'mw-full' });
      var meta = h('p', { class: 'mw-meta' });
      var doneBox = h('input', { type: 'checkbox', class: 'mw-done-box', onchange: function () { toggleDone(doneBox.checked); } });
      var doneBy = h('span', { class: 'mw-done-by' });
      var doneRow = h('label', { class: 'mw-done-row' }, [doneBox, h('span', null, 'Hotovo'), doneBy]);
      var thread = h('ul', { class: 'mw-thread', 'aria-label': 'Odpovědi' });
      var threadH = h('h3', { class: 'mw-thread-h' });
      var rta = h('textarea', { class: 'mw-input mw-reply-input', rows: 2, maxlength: MAX, 'aria-label': 'Tvoje odpověď', placeholder: 'Napiš odpověď…', oninput: function () { rcount.textContent = rta.value.length + '/' + MAX; if (rta.value.trim()) err.textContent = ''; }, onkeydown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(e); } } });
      var rcount = h('span', { class: 'mw-count' }, '0/' + MAX);
      var rform = h('form', { class: 'mw-reply-form', novalidate: true, onsubmit: sendReply }, [rta, h('div', { class: 'mw-composer-foot' }, [rcount, h('button', { type: 'submit', class: 'mw-send' }, 'Odpovědět')])]);
      var err = h('p', { class: 'mw-err', role: 'alert' });
      var foot = h('div', { class: 'mw-dlg-foot' });
      var paper = h('div', { class: 'mw-dlg-paper' }, [h('div', { class: 'mw-dlg-top' }, [chip, badge, title, closeBtn]), full, meta, doneRow]);
      var sheet = h('div', { class: 'mw-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid, tabindex: '-1' }, [
        paper,
        h('div', { class: 'mw-dlg-body' }, [threadH, thread, rform, err, foot]),
      ]);
      var backdrop = h('div', { class: 'mw-backdrop', onclick: function () { closeModal(); } });
      var wrap = h('div', { class: 'mw-root mw-modal mw-role-' + role, onkeydown: trap }, [backdrop, sheet]);
      M = { wrap: wrap, sheet: sheet, paper: paper, chip: chip, badge: badge, title: title, full: full, meta: meta, doneBox: doneBox, doneBy: doneBy, doneRow: doneRow,
        thread: thread, threadH: threadH, rta: rta, rcount: rcount, err: err, foot: foot, opener: opener || document.activeElement, sig: '', donePending: false,
        prevOverflow: document.documentElement.style.overflow };
      document.body.appendChild(wrap);
      document.documentElement.style.overflow = 'hidden';
      updModal();
      setTimeout(function () { if (M && M.wrap === wrap) closeBtn.focus(); }, 0);
    }
    function closeModal(silent) {
      if (!M) return;
      var m = M, op = st.open;
      M = null; st.open = null; st.confirm = null;
      if (m.wrap.parentNode) m.wrap.parentNode.removeChild(m.wrap);
      document.documentElement.style.overflow = m.prevOverflow || '';
      if (silent) return;
      var n = op && board.querySelector('[data-id="' + cssEsc(op.id) + '"][data-team="' + cssEsc(op.team) + '"]');
      var f = n || (m.opener && document.contains(m.opener) ? m.opener : null);
      if (f && f.focus) f.focus();
    }
    function trap(e) {
      if (!M) return;
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(M.sheet.querySelectorAll('button, textarea, input, select, [href], [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === M.sheet)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function updModal() {
      if (!M || !st.open) return;
      var tk = st.open.team, s = find(tk, st.open.id);
      if (!s) { closeModal(); status.textContent = 'Lísteček byl smazán.'; return; }
      var isTask = s.kind === 'task';
      var sig = JSON.stringify([s, st.confirm]);
      if (sig === M.sig) return;
      M.sig = sig;
      M.wrap.classList.toggle('mw-k-task', isTask);
      M.wrap.classList.toggle('mw-k-q', !isTask);
      M.wrap.classList.toggle('mw-done', isTask && !!s.done);
      M.chip.textContent = KIND[isTask ? 'task' : 'q'];
      M.badge.hidden = !(s.by && s.by.role === 'dealer');
      M.title.textContent = (isTask ? 'Úkol' : 'Otázka') + (st.team === 'all' ? ' – ' + teamName(tk) : '');
      M.full.textContent = String(s.text || '');
      M.meta.textContent = whoName(s.by, s.mine) + (s.ts ? ' · ' + when(s.ts) : '');
      M.doneRow.hidden = !isTask;
      if (!M.donePending) M.doneBox.checked = !!s.done;
      M.doneBy.textContent = isTask && s.done && s.doneBy ? '– ' + whoName(s.doneBy, false) : '';
      var reps = arr(s.replies);
      M.threadH.textContent = reps.length ? 'Odpovědi (' + reps.length + ')' : 'Zatím bez odpovědi';
      var hadFocus = M.thread.contains(document.activeElement);
      M.thread.textContent = '';
      reps.forEach(function (r) {
        var dealerBy = r.by && r.by.role === 'dealer';
        var del = null;
        if (canDel(r) && !r.pending) {
          del = st.confirm === r.id
            ? h('span', { class: 'mw-confirm' }, [h('span', null, 'Smazat?'),
                h('button', { type: 'button', class: 'mw-link mw-danger', onclick: function () { delReply(r.id); } }, 'Ano'),
                h('button', { type: 'button', class: 'mw-link', onclick: function () { st.confirm = null; updModal(); } }, 'Ne')])
            : h('button', { type: 'button', class: 'mw-link', 'aria-label': 'Smazat odpověď', onclick: function () { st.confirm = r.id; updModal(); focusIn('.mw-danger'); } }, 'Smazat');
        }
        M.thread.appendChild(h('li', { class: 'mw-reply' + (dealerBy ? ' mw-by-dealer' : '') + (r.pending ? ' mw-pending' : '') }, [
          h('div', { class: 'mw-reply-head' }, [
            dealerBy ? h('span', { class: 'mw-badge' }, 'MUP') : null,
            h('span', { class: 'mw-who' }, whoName(r.by, r.mine)),
            h('span', { class: 'mw-time' }, r.pending ? 'odesílám…' : when(r.ts)),
            del,
          ]),
          h('p', { class: 'mw-reply-text' }, String(r.text || '')),
        ]));
      });
      M.foot.textContent = '';
      if (canDel(s)) {
        if (st.confirm === 'sticker') {
          M.foot.appendChild(h('div', { class: 'mw-confirm mw-confirm-big' }, [
            h('span', null, 'Opravdu smazat celý lísteček' + (reps.length ? ' i' + NB + 's odpověďmi' : '') + '?'),
            h('button', { type: 'button', class: 'mw-btn mw-danger-btn', onclick: delSticker }, 'Smazat'),
            h('button', { type: 'button', class: 'mw-btn', onclick: function () { st.confirm = null; updModal(); focusIn('.mw-del'); } }, 'Zpět'),
          ]));
        } else {
          M.foot.appendChild(h('button', { type: 'button', class: 'mw-btn mw-del', onclick: function () { st.confirm = 'sticker'; updModal(); focusIn('.mw-danger-btn'); } }, 'Smazat lísteček'));
        }
      }
      if (hadFocus && !M.thread.contains(document.activeElement)) M.rta.focus();
    }
    function focusIn(sel) { if (M) { var x = M.sheet.querySelector(sel); if (x) x.focus(); } }
    function sendReply(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!M || !st.open) return;
      var text = M.rta.value.trim(), op = st.open, m = M;
      m.err.textContent = '';
      if (!text) { m.err.textContent = 'Text je prázdný.'; m.rta.focus(); return; }
      var p = { team: op.team, sid: op.id, r: { id: tmpId(), text: text, by: isDealer ? { role: 'dealer', name: 'MUP' } : { role: 'student', name: 'Ty' }, ts: Date.now(), mine: true, pending: true } };
      st.tmpReplies.push(p);
      m.rta.value = ''; m.rcount.textContent = '0/' + MAX;
      render();
      call(api.reply, assign(teamArg(op.team), { id: op.id, text: text })).then(function () {
        return load().then(drop, drop);
      }, function (er) {
        drop();
        if (M === m) { if (!m.rta.value) { m.rta.value = text; m.rcount.textContent = text.length + '/' + MAX; } m.err.textContent = errMsg(er); }
      });
      function drop() { st.tmpReplies = st.tmpReplies.filter(function (x) { return x !== p; }); render(); }
    }
    function toggleDone(done) {
      if (!M || !st.open) return;
      var op = st.open, m = M, dk = key(op.team) + '|' + op.id;
      m.err.textContent = '';
      st.doneOv[dk] = done; m.donePending = true;
      render();
      call(api.done, assign(teamArg(op.team), { id: op.id, done: done })).then(function () {
        return load().then(drop, drop);
      }, function (er) {
        drop();
        if (M === m) m.err.textContent = errMsg(er);
      });
      function drop() { delete st.doneOv[dk]; m.donePending = false; if (M === m) m.sig = ''; render(); }
    }
    function delSticker() {
      if (!M || !st.open) return;
      var op = st.open, hk = key(op.team) + '|' + op.id;
      st.hidden[hk] = true;
      closeModal(true);
      render();
      call(api.del, assign(teamArg(op.team), { id: op.id })).then(function () {
        return load().then(drop, drop);
      }, function (er) {
        drop();
        status.textContent = 'Smazání se nepovedlo: ' + errMsg(er);
        status.classList.add('mw-status-err');
      });
      function drop() { delete st.hidden[hk]; render(); }
    }
    function delReply(rid) {
      if (!M || !st.open) return;
      var op = st.open, m = M, hk = key(op.team) + '|' + op.id + '|' + rid;
      st.hidden[hk] = true; st.confirm = null;
      render();
      call(api.del, assign(teamArg(op.team), { id: op.id, reply: rid })).then(function () {
        return load().then(drop, drop);
      }, function (er) {
        drop();
        if (M === m) m.err.textContent = errMsg(er);
      });
      function drop() { delete st.hidden[hk]; render(); }
    }

    // ---------- public
    rebuild();
    load();
    return {
      refresh: function () { return load(); },
      setTeam: function (id) {
        if (st.destroyed) return;
        closeModal(true);
        var wasAll = st.team === 'all';
        st.team = id; st.walls = {}; st.loaded = false; st.loadErr = ''; st.seq++; st.inflight = false;
        if (wasAll !== (id === 'all')) rebuild(); else { st.sig = ''; render(); }
        return load();
      },
      destroy: function () {
        if (st.destroyed) return;
        closeModal(true);
        st.destroyed = true;
        if (timer) clearInterval(timer);
        document.removeEventListener('visibilitychange', onVis);
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
  }

  window.MupWall = { mount: mount, version: 1 };
})();
