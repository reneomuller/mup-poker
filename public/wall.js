/* MUP poker v3/v4 – team sticker wall (V3-SPEC §6, v4 wallplus). Plain JS, no dependencies.
   const w = window.MupWall.mount(el, { role, teams, team, api, canSendAll, pollMs, plus?, seenKey? });
   w.refresh(); w.setTeam(id); w.destroy();
   v4 (only with plus: true and api.op): reactions, pins, accepted answers, task due/assignee, send-to-all questions,
   dealer templates, unread dots (localStorage per device), filters, Esc closes the composer.
   All user text goes through textContent, never innerHTML. */
(function () {
  'use strict';
  var NB = '\u00a0';
  var MAX = 500;
  var KIND = { q: 'Otázka', task: 'Úkol' };
  var RX = [['up', '👍', 'Palec nahoru'], ['heart', '❤️', 'Srdce'], ['lol', '😂', 'Smích'], ['think', '🤔', 'Hmm'], ['fire', '🔥', 'Oheň']];
  var RXE = {}; RX.forEach(function (r) { RXE[r[0]] = r[1]; });
  var FILTERS = [['all', 'Vše'], ['q', 'Otázky'], ['task', 'Úkoly'], ['open', 'Otevřené'], ['mine', 'Moje']];
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
  function errMsg(e) { var m = e && (e.message || e.error || e.msg); if (m && /failed to fetch|networkerror|load failed|network request failed/i.test(String(m))) m = 'Spojení vypadlo. Zkus to znovu.'; return m ? String(m) : 'Něco se nepovedlo. Zkus to znovu.'; }
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
  function dueText(d) {
    if (!d || typeof d !== 'object') return '';
    if (d.kind === 'block') return 'do konce bloku';
    if (d.kind === 'time' && d.at) return 'do ' + String(d.at);
    return '';
  }
  function assignText(a, me) {
    if (!a || typeof a !== 'object') return '';
    if (a.all) return 'celý tým';
    if (me) return 'Ty';
    return String(a.name || '');
  }
  function firstName(n) { n = String(n || ''); var i = n.indexOf(' '); return i > 0 ? n.slice(0, i) : n; }
  // today's local HH:MM as a timestamp
  function timeTs(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
    if (!m) return null;
    var d = new Date(); d.setHours(+m[1], +m[2], 0, 0);
    return d.getTime();
  }
  function normHM(v) { var m = /^(\d{1,2}):(\d{2})/.exec(String(v || '')); return m ? pad(+m[1]) + ':' + m[2] : ''; }
  function soonHM() { var d = new Date(Date.now() + 30 * 60000); var m = Math.ceil(d.getMinutes() / 5) * 5; d.setMinutes(m, 0, 0); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function rxCount(rx) { var n = 0; if (rx) for (var k in rx) n += Number(rx[k] && rx[k].n) || 0; return n; }

  function mount(el, opts) {
    if (!el) throw new Error('MupWall.mount: missing element');
    opts = opts || {};
    var role = opts.role === 'dealer' ? 'dealer' : 'student';
    var isDealer = role === 'dealer';
    var api = opts.api || {};
    var teams = arr(opts.teams);
    var pollMs = opts.pollMs == null ? 4000 : Number(opts.pollMs) || 0;
    var plus = !!opts.plus && typeof api.op === 'function';
    var canSendAll = isDealer && !!opts.canSendAll;
    var seenBase = opts.seenKey ? String(opts.seenKey) : 'mw.seen.' + role;
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
      // v4 plus
      members: {}, templates: [], groups: null, filter: 'all',
      rxOv: {},           // 'team|sid|rid|code' -> bool
      pinOv: {},          // 'team|sid' -> bool
      accOv: {},          // 'team|sid' -> rid | null
      rxOpen: null,       // reply id whose emoji picker is open
      seen: {},           // team -> { sid: replyCount } (null = never loaded on this device)
      seenRev: 0,
      due: '', dueAt: '', assign: '', compOpen: false, tplOpen: false, tplSeq: 0,
    };

    function key(team) { return team == null ? '_' : String(team); }
    function teamArg(team) { return isDealer ? { team: team } : {}; }
    function teamById(id) { for (var i = 0; i < teams.length; i++) if (String(teams[i].id) === String(id)) return teams[i]; return null; }
    function teamName(id) { var t = teamById(id); return t ? t.name : String(id); }
    function assign(a, b) { for (var k in b) a[k] = b[k]; return a; }
    function plusOp(body, tk) { return call(api.op, assign(isDealer && tk != null && tk !== 'all' && tk !== '_' ? { team: tk } : {}, body)); }

    // ---------- unread (per device)
    function seenKeyFor(tk) { return seenBase + '.' + tk; }
    function seenGet(tk) {
      if (tk in st.seen) return st.seen[tk];
      var v = null;
      try { var raw = window.localStorage.getItem(seenKeyFor(tk)); v = raw ? JSON.parse(raw) : null; } catch (e) { v = null; }
      st.seen[tk] = v && typeof v === 'object' ? v : null;
      return st.seen[tk];
    }
    function seenSave(tk) {
      var m = st.seen[tk];
      if (!m) return;
      // keep only stickers still on the wall (plus a few just posted)
      var live = {}; arr(st.walls[tk]).forEach(function (s) { live[s.id] = 1; });
      var ks = Object.keys(m);
      if (ks.length > 400) ks.forEach(function (k) { if (!live[k]) delete m[k]; });
      try { window.localStorage.setItem(seenKeyFor(tk), JSON.stringify(m)); } catch (e) { /* private mode */ }
    }
    function markSeen(tk, id, n) {
      if (!plus) return;
      var m = seenGet(tk);
      if (!m) { m = {}; st.seen[tk] = m; }
      if (m[id] === n) return;
      m[id] = n; st.seenRev++;
      seenSave(tk);
    }
    function initSeen(tk) {
      if (!plus || seenGet(tk)) return;
      var m = {};
      arr(st.walls[tk]).forEach(function (s) { m[s.id] = arr(s.replies).length; });
      st.seen[tk] = m; seenSave(tk);
    }
    function isNew(tk, s) {
      if (!plus || s.pending || String(s.id).slice(0, 3) === 'tmp') return false;
      var m = seenGet(tk);
      if (!m) return false;
      if (!(s.id in m)) return !s.mine;
      var reps = arr(s.replies), from = Number(m[s.id]) || 0;
      for (var i = from; i < reps.length; i++) if (!reps[i].mine && !reps[i].pending) return true;
      return false;
    }

    // the data as shown: server data + optimistic overlays
    function view(tk) {
      var list = [];
      st.tmp.forEach(function (p) { if (key(p.team) === tk) list.push(p.s); });
      var srv = [];
      arr(st.walls[tk]).forEach(function (s) {
        if (!s || st.hidden[tk + '|' + s.id]) return;
        var o = assign({}, s);
        var dk = tk + '|' + s.id;
        if (dk in st.doneOv) o.done = st.doneOv[dk];
        if (dk in st.pinOv) o.pinned = st.pinOv[dk];
        if (dk in st.accOv) o.accepted = st.accOv[dk];
        o.reactions = rxApply(s.reactions, tk + '|' + s.id + '|');
        o.replies = arr(s.replies).filter(function (r) { return !st.hidden[tk + '|' + s.id + '|' + r.id]; }).map(function (r) {
          var x = assign({}, r);
          x.reactions = rxApply(r.reactions, tk + '|' + s.id + '|' + r.id + '|');
          if (dk in st.accOv) x.accepted = st.accOv[dk] === r.id;
          return x;
        });
        st.tmpReplies.forEach(function (p) { if (key(p.team) === tk && p.sid === s.id) o.replies = o.replies.concat([p.r]); });
        srv.push(o);
      });
      if (plus) srv = srv.map(function (s, i) { return [s, i]; }).sort(function (a, b) { return (!!b[0].pinned - !!a[0].pinned) || a[1] - b[1]; }).map(function (x) { return x[0]; });
      return list.concat(srv);
    }
    function rxApply(rx, pre) {
      if (!plus) return rx;
      var out = {};
      RX.forEach(function (r) {
        var c = r[0], cur = rx && rx[c] ? { n: Number(rx[c].n) || 0, mine: !!rx[c].mine } : { n: 0, mine: false };
        var ok = pre + c;
        if (ok in st.rxOv) {
          var on = st.rxOv[ok];
          if (on && !cur.mine) { cur.n++; cur.mine = true; }
          else if (!on && cur.mine) { cur.n = Math.max(0, cur.n - 1); cur.mine = false; }
        }
        if (cur.n > 0) out[c] = cur;
      });
      return out;
    }
    function find(team, id) {
      var l = view(key(team));
      for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
      return null;
    }
    function canDel(x) { return isDealer || !!(x && x.mine); }
    function canPin(s) { return plus && !s.pending && (s.canPin != null ? !!s.canPin : (isDealer || !!s.mine)); }
    function canAccept(s) { return plus && s.kind !== 'task' && (s.canAccept != null ? !!s.canAccept : (isDealer || !!s.mine)); }
    function canEdit(s) { return plus && s.kind === 'task' && (s.canEdit != null ? !!s.canEdit : (isDealer || !!s.mine)); }
    function answered(s) { return s.kind !== 'task' && !!s.accepted && arr(s.replies).some(function (r) { return r.id === s.accepted; }); }
    function wallKeys() {
      if (st.team !== 'all') return [key(st.team)];
      var ks = teams.map(function (t) { return String(t.id); });
      Object.keys(st.walls).forEach(function (k) { if (ks.indexOf(k) < 0) ks.push(k); });
      return ks;
    }
    function passes(s, f) {
      if (f === 'q') return s.kind !== 'task';
      if (f === 'task') return s.kind === 'task';
      if (f === 'open') return s.kind === 'task' ? !s.done : !answered(s);
      if (f === 'mine') return isDealer ? !!(s.by && s.by.role === 'dealer') : !!(s.mine || s.assignedToMe);
      return true;
    }
    function composerTeam() { return st.team === 'all' ? (comp.target ? comp.target.value : st.target) : st.team; }

    // ---------- DOM skeleton
    var root = h('div', { class: 'mw-root mw-role-' + role + (plus ? ' mw-plus' : '') });
    var status = h('p', { class: 'mw-status', role: 'status', 'aria-live': 'polite' });
    var filters = h('div', { class: 'mw-filters', role: 'group', 'aria-label': 'Filtr lístečků' });
    var groupsBox = h('div', { class: 'mw-groups-box' });
    var board = h('div', { class: 'mw-board' });
    var comp = {};
    el.textContent = '';
    el.appendChild(root);

    function buildComposer() {
      var segQ = h('button', { type: 'button', class: 'mw-seg-btn', 'data-kind': 'q', onclick: function () { setKind('q'); expand(); } }, KIND.q);
      var segT = h('button', { type: 'button', class: 'mw-seg-btn', 'data-kind': 'task', onclick: function () { setKind('task'); expand(); } }, KIND.task);
      var ta = h('textarea', { class: 'mw-input', id: me + '-text', rows: 3, maxlength: MAX, 'aria-label': 'Text lístečku', oninput: function () { updCount(); expand(); }, onfocus: expand,
        onkeydown: function (e) {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(e); }
          else if (e.key === 'Escape' && plus) { e.preventDefault(); collapse(); ta.blur(); }
        } });
      var count = h('span', { class: 'mw-count', 'aria-live': 'off' }, '0/' + MAX);
      var send = h('button', { type: 'submit', class: 'mw-send' }, 'Přilepit');
      var err = h('p', { class: 'mw-err', role: 'alert' });
      var allBox = null, allWrap = null, target = null, targetWrap = null, plusBox = null, tplBtn = null, tplBox = null;
      if (canSendAll) {
        allBox = h('input', { type: 'checkbox', class: 'mw-all-box', onchange: function () { st.all = allBox.checked; updTarget(); updPlusBox(); } });
        allWrap = h('label', { class: 'mw-all' }, [allBox, h('span', null, 'Poslat všem týmům')]);
      }
      if (isDealer && st.team === 'all') {
        target = h('select', { class: 'mw-target-sel', 'aria-label': 'Komu poslat', onchange: function () { st.target = target.value; st.assign = ''; updPlusBox(); } },
          teams.map(function (t) { return h('option', { value: t.id }, t.name); }));
        if (st.target == null && teams[0]) st.target = String(teams[0].id);
        if (st.target != null) target.value = st.target;
        targetWrap = h('label', { class: 'mw-target' }, [h('span', null, 'Komu'), target]);
      }
      if (plus) {
        plusBox = h('div', { class: 'mw-details' });
        if (isDealer) {
          tplBtn = h('button', { type: 'button', class: 'mw-link mw-tpl-btn', 'aria-expanded': 'false', onclick: function () { st.tplOpen = !st.tplOpen; updTpls(); } }, 'Šablony');
          tplBox = h('div', { class: 'mw-tpls', hidden: true });
        }
      }
      var form = h('form', { class: 'mw-composer' + (plus && !st.compOpen ? ' mw-collapsed' : ''), novalidate: true, onsubmit: submit, 'aria-label': 'Nový lísteček' }, [
        h('div', { class: 'mw-comp-top' }, [h('div', { class: 'mw-seg', role: 'group', 'aria-label': 'Druh lístečku' }, [segQ, segT]), tplBtn]),
        tplBox,
        targetWrap,
        ta,
        plusBox,
        h('div', { class: 'mw-composer-foot' }, [allWrap, count, send]),
        err,
      ]);
      comp = { form: form, segQ: segQ, segT: segT, ta: ta, count: count, send: send, err: err, allBox: allBox, allWrap: allWrap, target: target, plusBox: plusBox, tplBtn: tplBtn, tplBox: tplBox, plusSig: '', tplSig: '' };
      setKind(st.kind);
      updTpls();
      return form;
    }
    function expand() { if (!plus || st.compOpen || !comp.form) return; st.compOpen = true; comp.form.classList.remove('mw-collapsed'); }
    function collapse() { if (!plus || !comp.form) return; st.compOpen = false; st.tplOpen = false; comp.form.classList.add('mw-collapsed'); updTpls(); }
    function setKind(k) {
      st.kind = k === 'task' ? 'task' : 'q';
      comp.segQ.setAttribute('aria-pressed', String(st.kind === 'q'));
      comp.segT.setAttribute('aria-pressed', String(st.kind === 'task'));
      comp.form.classList.toggle('mw-k-task', st.kind === 'task');
      comp.form.classList.toggle('mw-k-q', st.kind === 'q');
      comp.ta.placeholder = st.kind === 'q'
        ? (isDealer ? 'Na co se chceš týmu zeptat?' : 'Na co se chceš zeptat týmu nebo MUP?')
        : 'Co je potřeba udělat?';
      if (comp.allWrap) comp.allWrap.hidden = !plus && st.kind !== 'task';
      updTarget();
      updPlusBox();
    }
    function sendAll() { return canSendAll && (plus || st.kind === 'task') && st.all; }
    function updTarget() { if (comp.target) comp.target.disabled = sendAll(); }
    function updCount() {
      var n = comp.ta.value.length;
      comp.count.textContent = n + '/' + MAX;
      comp.count.classList.toggle('mw-count-hi', n > MAX - 50);
      if (comp.err.textContent && comp.ta.value.trim()) comp.err.textContent = '';
    }
    // task details in the composer: due + assignee
    function updPlusBox() {
      var box = comp.plusBox;
      if (!box) return;
      var tk = key(composerTeam());
      var mem = sendAll() ? [] : arr(st.members[tk]);
      var sig = JSON.stringify([st.kind, st.due, st.dueAt, st.assign, mem, sendAll()]);
      if (sig === comp.plusSig) return;
      comp.plusSig = sig;
      box.textContent = '';
      box.hidden = st.kind !== 'task';
      if (st.kind !== 'task') return;
      var dsel = h('select', { class: 'mw-sel', 'aria-label': 'Termín úkolu', onchange: function () { st.due = dsel.value; if (st.due === 'time' && !st.dueAt) st.dueAt = soonHM(); comp.plusSig = ''; updPlusBox(); } }, [
        h('option', { value: '' }, 'bez termínu'), h('option', { value: 'block' }, 'do konce bloku'), h('option', { value: 'time' }, 'do času…'),
      ]);
      dsel.value = st.due;
      var tin = st.due === 'time' ? h('input', { type: 'time', class: 'mw-timein', value: st.dueAt || soonHM(), step: 300, 'aria-label': 'Čas termínu', onchange: function () { st.dueAt = tin.value; } }) : null;
      if (tin) st.dueAt = tin.value;
      var asel = h('select', { class: 'mw-sel', 'aria-label': 'Kdo to udělá', onchange: function () { st.assign = asel.value; } },
        [h('option', { value: '' }, 'nikdo'), h('option', { value: 'all' }, 'celý tým')].concat(mem.map(function (m) { return h('option', { value: m.id }, String(m.name || '')); })));
      if (st.assign && st.assign !== 'all' && !mem.some(function (m) { return String(m.id) === st.assign; })) st.assign = '';
      asel.value = st.assign;
      box.appendChild(h('label', { class: 'mw-field' }, [h('span', null, 'Termín'), dsel, tin]));
      box.appendChild(h('label', { class: 'mw-field' }, [h('span', null, 'Kdo'), asel]));
    }
    // dealer templates in the composer
    function updTpls() {
      if (!comp.tplBox) return;
      var list = arr(st.templates);
      comp.tplBtn.textContent = 'Šablony' + (list.length ? ' (' + list.length + ')' : '');
      comp.tplBtn.setAttribute('aria-expanded', String(!!st.tplOpen));
      comp.tplBox.hidden = !st.tplOpen;
      var sig = JSON.stringify([st.tplOpen, list]);
      if (sig === comp.tplSig) return;
      comp.tplSig = sig;
      comp.tplBox.textContent = '';
      if (!st.tplOpen) return;
      if (!list.length) { comp.tplBox.appendChild(h('p', { class: 'mw-tpl-empty' }, 'Zatím žádné šablony. Otevři lísteček a dej „Uložit jako šablonu“.')); return; }
      comp.tplBox.appendChild(h('ul', { class: 'mw-tpl-list', 'aria-label': 'Šablony' }, list.map(function (t) {
        return h('li', { class: 'mw-tpl ' + (t.kind === 'task' ? 'mw-k-task' : 'mw-k-q') }, [
          h('button', { type: 'button', class: 'mw-tpl-use', 'aria-label': 'Použít šablonu: ' + String(t.text || '').slice(0, 60), onclick: function () { useTpl(t); } }, [
            h('span', { class: 'mw-chip' }, KIND[t.kind === 'task' ? 'task' : 'q']),
            h('span', { class: 'mw-tpl-text' }, String(t.text || '')),
          ]),
          h('button', { type: 'button', class: 'mw-link mw-tpl-del', 'aria-label': 'Smazat šablonu', onclick: function () { delTpl(t.id); } }, '×'),
        ]);
      })));
    }
    function useTpl(t) {
      setKind(t.kind === 'task' ? 'task' : 'q');
      comp.ta.value = String(t.text || '').slice(0, MAX);
      var d = t.due;
      if (d === 'block' || (d && d.kind === 'block')) st.due = 'block';
      else if (d && (d.kind === 'time' || typeof d === 'string') && /^\d{1,2}:\d{2}$/.test(d.at || d)) { st.due = 'time'; st.dueAt = normHM(d.at || d); }
      else st.due = '';
      comp.plusSig = ''; updPlusBox();
      st.tplOpen = false; updTpls(); updCount(); expand();
      comp.ta.focus();
    }
    function delTpl(id) {
      call(api.op, { op: 'wallTplDelete', tpl: id }).then(function (r) {
        if (r && Array.isArray(r.templates)) st.templates = r.templates;
        else st.templates = st.templates.filter(function (t) { return t.id !== id; });
        st.tplSeq = st.seq + 1;
        updTpls();
      }, function (er) { comp.err.textContent = errMsg(er); });
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
      var extra = {};
      if (plus && kind === 'task') {
        if (st.due === 'block') { body.due = 'block'; extra.due = { kind: 'block' }; }
        else if (st.due === 'time' && /^\d{1,2}:\d{2}$/.test(st.dueAt)) { body.due = st.dueAt; body.dueTs = timeTs(st.dueAt); extra.due = { kind: 'time', at: st.dueAt, ts: body.dueTs }; }
        if (st.assign) {
          body.assign = st.assign;
          var mm = arr(st.members[key(team)]).filter(function (m) { return String(m.id) === st.assign; })[0];
          extra.assign = st.assign === 'all' ? { all: true } : { id: st.assign, name: mm ? mm.name : '' };
        }
      }
      var by = isDealer ? { role: 'dealer', name: 'MUP' } : { role: 'student', name: 'Ty' };
      var targets = all ? (st.team === 'all' ? wallKeys() : [key(st.team)]) : [key(st.team === 'all' ? team : st.team)];
      var temps = targets.map(function (tk) {
        var p = { team: tk, s: assign({ id: tmpId(), kind: kind, text: text, by: by, ts: Date.now(), mine: true, done: false, replies: [], pending: true }, extra) };
        st.tmp.push(p); return p;
      });
      comp.ta.value = ''; updCount();
      if (comp.allBox) { comp.allBox.checked = false; st.all = false; updTarget(); }
      if (plus) { st.due = ''; st.assign = ''; comp.plusSig = ''; updPlusBox(); }
      render();
      var req = plus ? call(api.op, assign({ op: 'wallPost' }, body)) : call(api.post, body);
      req.then(function (r) {
        // v4 guard: an offline post waits in the phone's retry queue; it stays on the board as „Odesílám…“ until the server has it
        if (r && r.queued) { temps.forEach(function (p) { p.queued = Date.now(); }); render(); return; }
        if (plus && r && r.id) targets.forEach(function (tk) { markSeen(tk, r.id, 0); });
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
      if (plus) { root.appendChild(groupsBox); root.appendChild(filters); }
      root.appendChild(board);
      st.sig = '';
      render();
    }

    // ---------- board
    function rxMini(rx) {
      var kids = [];
      RX.forEach(function (r) { var x = rx && rx[r[0]]; if (x && x.n > 0) kids.push(h('span', { class: 'mw-rx-mini' + (x.mine ? ' mw-rx-mine' : '') }, r[1] + NB + x.n)); });
      return kids.length ? h('span', { class: 'mw-note-rx' }, kids) : null;
    }
    function noteEl(s, tk) {
      var isTask = s.kind === 'task';
      var dealerBy = s.by && s.by.role === 'dealer';
      var rc = arr(s.replies).length;
      var ans = plus && answered(s);
      var fresh = isNew(tk, s);
      var overdue = plus && isTask && !s.done && !!s.overdue;
      var cls = 'mw-note ' + (isTask ? 'mw-k-task' : 'mw-k-q') + (isTask && s.done ? ' mw-done' : '') + (s.pending ? ' mw-pending' : '') + (dealerBy ? ' mw-by-dealer' : '')
        + (plus && s.pinned ? ' mw-pinned' : '') + (ans ? ' mw-answered' : '') + (overdue ? ' mw-overdue' : '') + (fresh ? ' mw-new' : '');
      var label = (plus && s.pinned ? 'Připnuté, ' : '') + (fresh ? 'nové, ' : '') + KIND[isTask ? 'task' : 'q'] + (isTask && s.done ? ' (hotovo)' : '') + (ans ? ' (zodpovězeno)' : '') + (overdue ? ' (po termínu)' : '')
        + ', ' + whoName(s.by, s.mine) + ': ' + String(s.text || '').slice(0, 80);
      var dt = plus && isTask ? dueText(s.due) : '';
      var at = plus && isTask ? assignText(s.assign, s.assignedToMe) : '';
      return h('button', { type: 'button', class: cls, style: '--mw-tilt:' + tilt(s.id), 'data-id': s.id, 'data-team': tk, 'aria-haspopup': 'dialog', 'aria-label': label, disabled: !!s.pending,
        onclick: function () { openSticker(tk, s.id, this); } }, [
        h('span', { class: 'mw-paper-wrap', 'aria-hidden': 'true' }, [h('span', { class: 'mw-paper' }), h('span', { class: 'mw-fold' })]),
        plus && s.pinned ? h('span', { class: 'mw-pin', 'aria-hidden': 'true' }, '📌') : null,
        fresh ? h('span', { class: 'mw-new-dot', 'aria-hidden': 'true' }, 'nové') : null,
        h('span', { class: 'mw-note-in' }, [
          h('span', { class: 'mw-note-top' }, [
            h('span', { class: 'mw-chip' }, KIND[isTask ? 'task' : 'q']),
            dealerBy ? h('span', { class: 'mw-badge' }, 'MUP') : null,
            s.ghost && isDealer ? h('span', { class: 'mw-ghost' }, 'duch') : null,
            (isTask && s.done) || ans ? h('span', { class: 'mw-tick', 'aria-hidden': 'true' }, '✓') : null,
          ]),
          h('span', { class: 'mw-note-text' }, String(s.text || '')),
          dt || at ? h('span', { class: 'mw-note-meta' }, [
            dt ? h('span', { class: 'mw-due' + (overdue ? ' mw-due-late' : '') }, dt) : null,
            at ? h('span', { class: 'mw-asg' }, '→' + NB + (s.assign && !s.assign.all && !s.assignedToMe ? firstName(at) : at)) : null,
          ]) : null,
          plus ? rxMini(s.reactions) : null,
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
    function filterLabel() { for (var i = 0; i < FILTERS.length; i++) if (FILTERS[i][0] === st.filter) return FILTERS[i][1]; return ''; }
    function renderFilters(all) {
      filters.textContent = '';
      FILTERS.forEach(function (f) {
        var n = all.filter(function (s) { return passes(s, f[0]); }).length;
        filters.appendChild(h('button', { type: 'button', class: 'mw-filter', 'data-filter': f[0], 'aria-pressed': String(st.filter === f[0]),
          onclick: function () { st.filter = f[0]; st.sig = ''; render(); var b = filters.querySelector('[data-filter="' + f[0] + '"]'); if (b) b.focus(); } }, [
          h('span', null, f[1]), h('span', { class: 'mw-filter-n' }, String(n)),
        ]));
      });
    }
    // dealer 'all' view: the send-to-all copies with their per-team state
    function groupList(keys, data) {
      if (Array.isArray(st.groups)) return st.groups;
      var g = {}, order = [];
      keys.forEach(function (k, i) {
        data[i].forEach(function (s) {
          if (!s.group) return;
          if (!g[s.group]) { g[s.group] = { group: s.group, kind: s.kind, text: s.text, ts: s.ts, teams: [] }; order.push(s.group); }
          g[s.group].teams.push({ team: k, id: s.id, done: !!s.done, replies: arr(s.replies).length, accepted: !!s.accepted });
        });
      });
      return order.map(function (id) { return g[id]; });
    }
    function renderGroups(keys, data) {
      groupsBox.textContent = '';
      if (!plus || !isDealer || st.team !== 'all' || !st.loaded) return;
      var list = groupList(keys, data).filter(function (g) { return g && arr(g.teams).length; }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      if (!list.length) return;
      var det = h('details', { class: 'mw-groups', open: true }, [
        h('summary', { class: 'mw-groups-h' }, [h('span', null, 'Rozesláno všem týmům'), h('span', { class: 'mw-team-n' }, String(list.length))]),
        h('ul', { class: 'mw-group-list' }, list.map(function (g) {
          var isTask = g.kind === 'task';
          var ts = arr(g.teams);
          var okOf = function (t) { return isTask ? !!t.done : !!(t.accepted || t.answered || (Number(t.replies) || 0) > 0); };
          var n = ts.filter(okOf).length, total = g.total || ts.length;
          return h('li', { class: 'mw-group ' + (isTask ? 'mw-k-task' : 'mw-k-q') }, [
            h('div', { class: 'mw-group-top' }, [
              h('span', { class: 'mw-chip' }, KIND[isTask ? 'task' : 'q']),
              h('span', { class: 'mw-group-text' }, String(g.text || '')),
              h('span', { class: 'mw-group-n' + (n === total ? ' mw-group-all' : '') }, (isTask ? 'Hotovo ' : 'Odpovězeno ') + n + '/' + total + NB + plural(total, 'tým', 'týmy', 'týmů')),
            ]),
            h('div', { class: 'mw-group-teams' }, ts.map(function (t) {
              var tm = teamById(t.team) || { name: t.team, color: '' };
              var good = okOf(t);
              return h('button', { type: 'button', class: 'mw-gteam' + (good ? ' mw-gteam-ok' : ''), style: tm.color ? '--mw-team:' + String(tm.color).replace(/[^#a-zA-Z0-9(),.% -]/g, '') : null,
                'aria-label': tm.name + (good ? (isTask ? ': hotovo' : ': odpovězeno') : (isTask ? ': nehotovo' : ': bez odpovědi')), onclick: function () { openSticker(key(t.team), t.id, this); } }, [
                h('span', { class: 'mw-team-dot', 'aria-hidden': 'true' }), h('span', null, tm.name), good ? h('span', { class: 'mw-gteam-tick', 'aria-hidden': 'true' }, '✓') : null,
              ]);
            })),
          ]);
        })),
      ]);
      groupsBox.appendChild(det);
    }
    function render() {
      if (st.destroyed) return;
      var keys = wallKeys();
      var data = keys.map(function (k) { return view(k); });
      var sig = JSON.stringify([st.team, st.loaded, st.loadErr, data, st.filter, st.seenRev, st.groups]);
      if (sig !== st.sig) {
        st.sig = sig;
        var act = document.activeElement, focusId = null, focusTeam = null;
        if (act && board.contains(act) && act.getAttribute('data-id')) { focusId = act.getAttribute('data-id'); focusTeam = act.getAttribute('data-team'); }
        board.textContent = '';
        status.textContent = st.loadErr;
        status.classList.toggle('mw-status-err', !!st.loadErr);
        var f = plus ? st.filter : 'all';
        if (plus) {
          var flat = []; data.forEach(function (l) { flat = flat.concat(l); });
          renderFilters(flat);
          filters.hidden = !st.loaded;
          renderGroups(keys, data);
        }
        var fd = data.map(function (l) { return f === 'all' ? l : l.filter(function (s) { return passes(s, f); }); });
        var fEmpty = f !== 'all' ? 'Nic pro filtr „' + filterLabel() + '“.' : null;
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
                h('span', { class: 'mw-team-n' }, list.length ? noteCount(list.length) + ' · ' + nq + NB + plural(nq, 'otázka', 'otázky', 'otázek') + (nt ? ' · otevřené úkoly' + NB + open + '/' + nt : '') : 'prázdná'),
              ]),
              gridEl(fd[i], k, list.length && fEmpty ? fEmpty : 'Zatím bez lístečků.'),
            ]));
          });
          if (!keys.length) board.appendChild(h('p', { class: 'mw-empty' }, 'Žádné týmy.'));
        } else {
          board.appendChild(gridEl(fd[0], keys[0], data[0].length && fEmpty ? fEmpty : (isDealer ? 'Nástěnka je zatím prázdná. Přilep týmu první otázku nebo úkol.' : 'Nástěnka je zatím prázdná. Přilep první otázku nebo úkol pro tým.')));
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
          if (res && res.members && typeof res.members === 'object' && !Array.isArray(res.members)) st.members = res.members;
          st.groups = res && Array.isArray(res.groups) ? res.groups : null;
        } else {
          walls[key(team)] = Array.isArray(res) ? res : arr(res && res.stickers);
          if (res && Array.isArray(res.members)) st.members[key(team)] = res.members;
        }
        if (res && Array.isArray(res.templates) && my >= st.tplSeq) st.templates = res.templates; // a list started before a template op is stale
        st.walls = walls; st.loaded = true; st.loadErr = '';
        settleQueued(walls);
        if (plus) {
          Object.keys(walls).forEach(initSeen);
          if (comp.plusBox) updPlusBox();
          updTpls();
        }
        render();
      }, function (e) {
        if (st.destroyed || my !== st.seq) return;
        st.loadErr = 'Nástěnku se nepodařilo načíst: ' + errMsg(e);
        render();
      }).then(function () { if (my === st.seq) st.inflight = false; });
    }
    // v4 guard: a queued (offline) post / reply leaves the board once the server's list has it (or after the queue's 10 min)
    function settleQueued(walls) {
      var now = Date.now(), QMAX = 10 * 60 * 1000;
      var same = function (a, b) { return a && a.mine && a.text === b.text; };
      st.tmp = st.tmp.filter(function (p) {
        if (!p.queued) return true;
        return now - p.queued < QMAX && !arr(walls[key(p.team)]).some(function (s) { return same(s, p.s) && s.kind === p.s.kind; });
      });
      st.tmpReplies = st.tmpReplies.filter(function (p) {
        if (!p.queued) return true;
        var s = arr(walls[key(p.team)]).filter(function (x) { return x && x.id === p.sid; })[0];
        return now - p.queued < QMAX && !(s && arr(s.replies).some(function (r) { return same(r, p.r); }));
      });
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
      st.confirm = null; st.rxOpen = null;
      var s = find(tk, id);
      if (!s) { st.open = null; return; }
      var tid = me + '-dlg';
      var chip = h('span', { class: 'mw-chip' });
      var badge = h('span', { class: 'mw-badge' }, 'MUP');
      var pinIc = h('span', { class: 'mw-dlg-pin', 'aria-label': 'Připnuto', role: 'img' }, '📌');
      var title = h('h2', { class: 'mw-dlg-title', id: tid });
      var closeBtn = h('button', { type: 'button', class: 'mw-x', 'aria-label': 'Zavřít', onclick: function () { closeModal(); } }, '×');
      var full = h('p', { class: 'mw-full' });
      var meta = h('p', { class: 'mw-meta' });
      var info = h('div', { class: 'mw-dlg-info' });
      var doneBox = h('input', { type: 'checkbox', class: 'mw-done-box', onchange: function () { toggleDone(doneBox.checked); } });
      var doneBy = h('span', { class: 'mw-done-by' });
      var doneRow = h('label', { class: 'mw-done-row' }, [doneBox, h('span', null, 'Hotovo'), doneBy]);
      var rx = h('div', { class: 'mw-rx', role: 'group', 'aria-label': 'Reakce na lísteček' });
      var edit = h('div', { class: 'mw-task-edit' });
      var thread = h('ul', { class: 'mw-thread', 'aria-label': 'Odpovědi' });
      var threadH = h('h3', { class: 'mw-thread-h' });
      var rta = h('textarea', { class: 'mw-input mw-reply-input', rows: 2, maxlength: MAX, 'aria-label': 'Tvoje odpověď', placeholder: 'Napiš odpověď…', oninput: function () { rcount.textContent = rta.value.length + '/' + MAX; if (rta.value.trim()) err.textContent = ''; }, onkeydown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(e); } } });
      var rcount = h('span', { class: 'mw-count' }, '0/' + MAX);
      var rform = h('form', { class: 'mw-reply-form', novalidate: true, onsubmit: sendReply }, [rta, h('div', { class: 'mw-composer-foot' }, [rcount, h('button', { type: 'submit', class: 'mw-send' }, 'Odpovědět')])]);
      var err = h('p', { class: 'mw-err', role: 'alert' });
      var foot = h('div', { class: 'mw-dlg-foot' });
      var paper = h('div', { class: 'mw-dlg-paper' }, [h('div', { class: 'mw-dlg-top' }, [chip, badge, pinIc, title, closeBtn]), full, meta, info, doneRow, plus ? rx : null, plus ? edit : null]);
      var sheet = h('div', { class: 'mw-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid, tabindex: '-1' }, [
        paper,
        h('div', { class: 'mw-dlg-body' }, [threadH, thread, rform, err, foot]),
      ]);
      var backdrop = h('div', { class: 'mw-backdrop', onclick: function () { closeModal(); } });
      var wrap = h('div', { class: 'mw-root mw-modal mw-role-' + role + (plus ? ' mw-plus' : ''), onkeydown: trap }, [backdrop, sheet]);
      var sm = plus ? seenGet(tk) : null;
      M = { wrap: wrap, sheet: sheet, paper: paper, chip: chip, badge: badge, pinIc: pinIc, title: title, full: full, meta: meta, info: info, doneBox: doneBox, doneBy: doneBy, doneRow: doneRow,
        rx: rx, edit: edit, editSig: '', thread: thread, threadH: threadH, rta: rta, rcount: rcount, err: err, foot: foot, opener: opener || document.activeElement, sig: '', donePending: false,
        seenAt: sm && (s.id in sm) ? Number(sm[s.id]) || 0 : (sm ? 0 : arr(s.replies).length), freshSticker: !!(sm && !(s.id in sm) && !s.mine),
        prevOverflow: document.documentElement.style.overflow };
      document.body.appendChild(wrap);
      document.documentElement.style.overflow = 'hidden';
      updModal();
      setTimeout(function () { if (M && M.wrap === wrap) closeBtn.focus(); }, 0);
    }
    function closeModal(silent) {
      if (!M) return;
      var m = M, op = st.open;
      M = null; st.open = null; st.confirm = null; st.rxOpen = null;
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
    function rxButtons(rxd, onToggle, fkPre, compact) {
      var out = [];
      RX.forEach(function (r) {
        var x = rxd && rxd[r[0]], n = x ? x.n : 0, mine = !!(x && x.mine);
        if (compact && !n) return;
        out.push(h('button', { type: 'button', class: 'mw-rx-btn' + (mine ? ' mw-rx-mine' : ''), 'aria-pressed': String(mine), 'data-fk': fkPre + r[0],
          'aria-label': r[2] + (n ? ' (' + n + ')' : ''), title: r[2], onclick: function () { onToggle(r[0], !mine); } }, [
          h('span', { class: 'mw-rx-e', 'aria-hidden': 'true' }, r[1]), n ? h('span', { class: 'mw-rx-n' }, String(n)) : null,
        ]));
      });
      return out;
    }
    function updModal() {
      if (!M || !st.open) return;
      var tk = st.open.team, s = find(tk, st.open.id);
      if (!s) { closeModal(); status.textContent = 'Lísteček byl smazán.'; return; }
      var isTask = s.kind === 'task';
      var mem = arr(st.members[tk]);
      var sig = JSON.stringify([s, st.confirm, st.rxOpen, mem, isDealer ? st.templates.length : 0]);
      if (plus && !s.pending) markSeen(tk, s.id, arr(s.replies).length);
      if (sig === M.sig) return;
      M.sig = sig;
      var ae = document.activeElement, fk = ae && M.sheet.contains(ae) ? ae.getAttribute('data-fk') : null;
      var ans = plus && answered(s);
      M.wrap.classList.toggle('mw-k-task', isTask);
      M.wrap.classList.toggle('mw-k-q', !isTask);
      M.wrap.classList.toggle('mw-done', isTask && !!s.done);
      M.wrap.classList.toggle('mw-overdue', plus && isTask && !s.done && !!s.overdue);
      M.chip.textContent = KIND[isTask ? 'task' : 'q'];
      M.badge.hidden = !(s.by && s.by.role === 'dealer');
      M.pinIc.hidden = !(plus && s.pinned);
      M.title.textContent = (isTask ? 'Úkol' : 'Otázka') + (st.team === 'all' ? ' – ' + teamName(tk) : '');
      M.full.textContent = String(s.text || '');
      M.meta.textContent = whoName(s.by, s.mine) + (s.ts ? ' · ' + when(s.ts) : '') + (isDealer && s.group ? ' · rozesláno všem týmům' : '');
      M.doneRow.hidden = !isTask;
      if (!M.donePending) M.doneBox.checked = !!s.done;
      M.doneBy.textContent = isTask && s.done && s.doneBy ? '– ' + whoName(s.doneBy, false) : '';
      // plus: info chips, reactions, task editor
      M.info.textContent = '';
      if (plus) {
        var dt = isTask ? dueText(s.due) : '', at = isTask ? assignText(s.assign, s.assignedToMe) : '';
        if (dt) M.info.appendChild(h('span', { class: 'mw-due' + (s.overdue && !s.done ? ' mw-due-late' : '') }, 'Termín: ' + dt + (s.overdue && !s.done ? ' (po termínu)' : '')));
        if (at) M.info.appendChild(h('span', { class: 'mw-asg' }, 'Kdo: ' + at));
        if (ans) M.info.appendChild(h('span', { class: 'mw-ans-chip' }, '✓ Zodpovězeno'));
        M.rx.textContent = '';
        if (!s.pending) rxButtons(s.reactions, function (c, on) { react(tk, s.id, null, c, on); }, 's|', false).forEach(function (b) { M.rx.appendChild(b); });
        M.rx.hidden = !!s.pending;
        renderEdit(s, tk, mem);
      }
      M.info.hidden = !M.info.childNodes.length;
      var reps = arr(s.replies);
      M.threadH.textContent = reps.length ? 'Odpovědi (' + reps.length + ')' : 'Zatím bez odpovědi';
      var hadFocus = M.thread.contains(document.activeElement);
      M.thread.textContent = '';
      var acc = canAccept(s) && !s.pending;
      reps.forEach(function (r, i) {
        var dealerBy = r.by && r.by.role === 'dealer';
        var isAcc = plus && !isTask && s.accepted === r.id;
        var fresh = plus && !r.mine && !r.pending && (M.freshSticker || i >= M.seenAt);
        var del = null;
        if (canDel(r) && !r.pending) {
          del = st.confirm === r.id
            ? h('span', { class: 'mw-confirm' }, [h('span', null, 'Smazat?'),
                h('button', { type: 'button', class: 'mw-link mw-danger', onclick: function () { delReply(r.id); } }, 'Ano'),
                h('button', { type: 'button', class: 'mw-link', onclick: function () { st.confirm = null; updModal(); } }, 'Ne')])
            : h('button', { type: 'button', class: 'mw-link', 'data-fk': 'del|' + r.id, 'aria-label': 'Smazat odpověď', onclick: function () { st.confirm = r.id; updModal(); focusIn('.mw-danger'); } }, 'Smazat');
        }
        var tools = null;
        if (plus && !r.pending) {
          var rk = [];
          rxButtons(r.reactions, function (c, on) { react(tk, s.id, r.id, c, on); }, 'r|' + r.id + '|', st.rxOpen !== r.id).forEach(function (b) { rk.push(b); });
          rk.push(h('button', { type: 'button', class: 'mw-rx-btn mw-rx-add', 'data-fk': 'rxo|' + r.id, 'aria-expanded': String(st.rxOpen === r.id), 'aria-label': st.rxOpen === r.id ? 'Zavřít reakce' : 'Přidat reakci',
            onclick: function () { st.rxOpen = st.rxOpen === r.id ? null : r.id; updModal(); } }, st.rxOpen === r.id ? '×' : '☺+'));
          if (acc) rk.push(h('button', { type: 'button', class: 'mw-link mw-acc-btn', 'data-fk': 'acc|' + r.id, onclick: function () { acceptReply(tk, s.id, isAcc ? null : r.id); } }, isAcc ? 'Zrušit odpověď' : 'Označit jako odpověď'));
          tools = h('div', { class: 'mw-reply-tools' }, rk);
        }
        M.thread.appendChild(h('li', { class: 'mw-reply' + (dealerBy ? ' mw-by-dealer' : '') + (r.pending ? ' mw-pending' : '') + (isAcc ? ' mw-accepted' : '') + (fresh ? ' mw-new' : '') }, [
          h('div', { class: 'mw-reply-head' }, [
            isAcc ? h('span', { class: 'mw-acc-label' }, '✓ Odpověď') : null,
            fresh ? h('span', { class: 'mw-new-dot mw-new-inline' }, 'nové') : null,
            dealerBy ? h('span', { class: 'mw-badge' }, 'MUP') : null,
            h('span', { class: 'mw-who' }, whoName(r.by, r.mine)),
            h('span', { class: 'mw-time' }, r.pending ? 'odesílám…' : when(r.ts)),
            del,
          ]),
          h('p', { class: 'mw-reply-text' }, String(r.text || '')),
          tools,
        ]));
      });
      M.foot.textContent = '';
      var acts = [];
      if (canPin(s)) acts.push(h('button', { type: 'button', class: 'mw-btn mw-pin-btn', 'data-fk': 'pin', 'aria-pressed': String(!!s.pinned), onclick: function () { pinSticker(tk, s.id, !s.pinned); } }, s.pinned ? '📌 Odepnout' : '📌 Připnout'));
      if (plus && isDealer && !s.pending) acts.push(h('button', { type: 'button', class: 'mw-btn mw-tpl-save', 'data-fk': 'tpl', onclick: function () { saveTpl(s); } }, 'Uložit jako šablonu'));
      if (canDel(s)) {
        if (st.confirm === 'sticker') {
          acts.push(h('div', { class: 'mw-confirm mw-confirm-big' }, [
            h('span', null, 'Opravdu smazat celý lísteček' + (reps.length ? ' i' + NB + 's odpověďmi' : '') + '?'),
            h('button', { type: 'button', class: 'mw-btn mw-danger-btn', onclick: delSticker }, 'Smazat'),
            h('button', { type: 'button', class: 'mw-btn', onclick: function () { st.confirm = null; updModal(); focusIn('.mw-del'); } }, 'Zpět'),
          ]));
        } else {
          acts.push(h('button', { type: 'button', class: 'mw-btn mw-del', onclick: function () { st.confirm = 'sticker'; updModal(); focusIn('.mw-danger-btn'); } }, 'Smazat lísteček'));
        }
      }
      acts.forEach(function (a) { M.foot.appendChild(a); });
      if (fk) { var back = M.sheet.querySelector('[data-fk="' + cssEsc(fk) + '"]'); if (back) back.focus(); }
      else if (hadFocus && !M.thread.contains(document.activeElement)) M.rta.focus();
    }
    // due/assignee editor inside the modal (author or dealer)
    function renderEdit(s, tk, mem) {
      var ok = canEdit(s) && !s.pending;
      M.edit.hidden = !ok;
      if (!ok) { M.edit.textContent = ''; M.editSig = ''; return; }
      var dv = s.due && s.due.kind === 'block' ? 'block' : s.due && s.due.kind === 'time' ? 'time' : '';
      var av = s.assign ? (s.assign.all ? 'all' : String(s.assign.id || '')) : '';
      var sig = JSON.stringify([dv, s.due && s.due.at, av, mem]);
      if (sig === M.editSig) return;
      M.editSig = sig;
      M.edit.textContent = '';
      var send = function (body) { taskEdit(tk, s.id, body); };
      var tin = h('input', { type: 'time', class: 'mw-timein', step: 300, value: normHM(s.due && s.due.at) || soonHM(), 'aria-label': 'Čas termínu', hidden: dv !== 'time',
        onchange: function () { if (/^\d{1,2}:\d{2}$/.test(tin.value)) send({ due: tin.value, dueTs: timeTs(tin.value) }); } });
      var dsel = h('select', { class: 'mw-sel', 'aria-label': 'Termín úkolu', onchange: function () {
        tin.hidden = dsel.value !== 'time';
        if (dsel.value === 'time') { if (!tin.value) tin.value = soonHM(); send({ due: tin.value, dueTs: timeTs(tin.value) }); }
        else send({ due: dsel.value });
      } }, [h('option', { value: '' }, 'bez termínu'), h('option', { value: 'block' }, 'do konce bloku'), h('option', { value: 'time' }, 'do času…')]);
      dsel.value = dv;
      var opts2 = [h('option', { value: '' }, 'nikdo'), h('option', { value: 'all' }, 'celý tým')].concat(mem.map(function (m) { return h('option', { value: m.id }, String(m.name || '')); }));
      if (av && av !== 'all' && !mem.some(function (m) { return String(m.id) === av; })) opts2.push(h('option', { value: av }, String((s.assign && s.assign.name) || av)));
      var asel = h('select', { class: 'mw-sel', 'aria-label': 'Kdo to udělá', onchange: function () { send({ assign: asel.value }); } }, opts2);
      asel.value = av;
      M.edit.appendChild(h('label', { class: 'mw-field' }, [h('span', null, 'Termín'), dsel, tin]));
      M.edit.appendChild(h('label', { class: 'mw-field' }, [h('span', null, 'Kdo'), asel]));
    }
    function focusIn(sel) { if (M) { var x = M.sheet.querySelector(sel); if (x) x.focus(); } }
    function modalErr(m, er) { if (M === m) m.err.textContent = errMsg(er); else { status.textContent = errMsg(er); status.classList.add('mw-status-err'); } }
    function react(tk, sid, rid, code, on) {
      var ok = tk + '|' + sid + '|' + (rid ? rid + '|' : '') + code, m = M;
      st.rxOv[ok] = on;
      render();
      var body = { op: 'wallReact', id: sid, emoji: code, on: on };
      if (rid) body.reply = rid;
      plusOp(body, tk).then(function () { return load().then(drop, drop); }, function (er) { drop(); modalErr(m, er); });
      function drop() { if (st.rxOv[ok] === on) delete st.rxOv[ok]; render(); }
    }
    function pinSticker(tk, sid, on) {
      var dk = tk + '|' + sid, m = M;
      st.pinOv[dk] = on;
      render();
      plusOp({ op: 'wallPin', id: sid, on: on }, tk).then(function () { return load().then(drop, drop); }, function (er) { drop(); modalErr(m, er); });
      function drop() { if (st.pinOv[dk] === on) delete st.pinOv[dk]; render(); }
    }
    function acceptReply(tk, sid, rid) {
      var dk = tk + '|' + sid, m = M;
      st.accOv[dk] = rid;
      render();
      plusOp({ op: 'wallAccept', id: sid, reply: rid }, tk).then(function () { return load().then(drop, drop); }, function (er) { drop(); modalErr(m, er); });
      function drop() { if (st.accOv[dk] === rid) delete st.accOv[dk]; render(); }
    }
    function taskEdit(tk, sid, body) {
      var m = M;
      if (m) m.err.textContent = '';
      plusOp(assign({ op: 'wallTask', id: sid }, body), tk).then(function () { return load(); }, function (er) { if (M === m) { m.editSig = ''; m.sig = ''; } modalErr(m, er); render(); });
    }
    function saveTpl(s) {
      var m = M;
      var body = { op: 'wallTplSave', kind: s.kind === 'task' ? 'task' : 'q', text: String(s.text || '') };
      if (s.kind === 'task' && s.due && s.due.kind === 'block') body.due = 'block';
      else if (s.kind === 'task' && s.due && s.due.kind === 'time' && s.due.at) body.due = s.due.at;
      call(api.op, body).then(function (r) {
        if (r && Array.isArray(r.templates)) st.templates = r.templates;
        st.tplSeq = st.seq + 1;
        updTpls();
        if (M === m) { m.err.textContent = ''; status.textContent = 'Uloženo jako šablona.'; status.classList.remove('mw-status-err'); m.sig = ''; updModal(); }
      }, function (er) { modalErr(m, er); });
    }
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
      call(api.reply, assign(teamArg(op.team), { id: op.id, text: text })).then(function (r) {
        if (r && r.queued) { p.queued = Date.now(); render(); return; } // v4 guard: queued offline, see settleQueued()
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
        st.team = id; st.walls = {}; st.loaded = false; st.loadErr = ''; st.seq++; st.inflight = false; st.groups = null;
        if (wasAll !== (id === 'all')) rebuild(); else { st.sig = ''; if (comp.plusSig != null) comp.plusSig = ''; updPlusBox(); render(); }
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

  window.MupWall = { mount: mount, version: 2 };
})();
