// Fixture data for the phone screen, active ONLY with /play?demo=1.
// Fills in v2 fields (spec shapes) the server doesn't send yet, and answers v2 student ops locally.
// Extra switches: &quiz=question|reveal|board|lobby|done  &exit=1  &rounds=1  &market=1  &tranches=1
(function () {
  const qs = new URLSearchParams(location.search);
  const quizMode = qs.get('quiz');
  const on = (k) => qs.get(k) === '1';
  const t0 = Date.now();
  let quizChoice = null, myCard = null, myPre = null;
  const QUIZ = { q: 'LTV by podle běžného pravidla měla být aspoň…', a: ['Poloviční než CAC', 'Desetinásobkem MRR', 'Stejná jako CAC', 'Trojnásobkem CAC'], correct: 3, time: 20 };
  const LINES = [
    ['Pivo z regionálních minipivovarů do kanceláří', 'Předplatné sudů pro firmy do 50 lidí, objednávka jedním klikem, rozvoz do 24 hodin.'],
    ['Studijní parťák, který tě vyzkouší z poznámek', 'Nahraješ poznámky z přednášky a AI z nich udělá kvíz a kartičky na opakování.'],
    ['Zelené střechy pro paneláky jako služba', ''],
    ['Senioři online bez stresu', 'Tablet s jednoduchým rozhraním a vzdálenou pomocí od vnoučat.'],
    ['', ''],
    ['Domácí kvašák s rozvozem', 'Pekárna bez provozovny: pečeme v pronajaté kuchyni a vozíme ráno.'],
  ];

  function patch(s) {
    const T = s.teams.map((t) => t.id);
    s.features = Object.assign({ captable: true, cards: true, drivers: true, track: true, quiz: true, points: true, rounds: on('rounds'), market: on('market'), tranches: on('tranches'), exit: on('exit') }, s.features || {});
    s.teams.forEach((t, i) => { t.cap = t.cap || { founders: [100, 62.5, 71.4, 84.1, 100, 77][i] || 100, cls: [0, 37.5, 28.6, 15.9, 0, 23][i] || 0, rj: 0, investors: [0, 9, 6, 4, 0, 5][i] || 0 }; });
    s.milestoneDefs = s.milestoneDefs || [
      { key: 'm1a', label: 'Potvrzený problém a one-liner', block: 1 }, { key: 'm1b', label: 'Tři nejrizikovější předpoklady', block: 1 },
      { key: 'm2a', label: 'Byznys model v2', block: 2 }, { key: 'm2b', label: 'Přehled konkurence', block: 2 }, { key: 'm2c', label: 'Memo s důkazy', block: 2 }, { key: 'm2d', label: 'MVP brief', block: 2 },
      { key: 'm3a', label: 'MVP na veřejné adrese', block: 3 }, { key: 'm4a', label: 'Růstový motor běží', block: 4 }, { key: 'm5a', label: 'Byznys model a pitch', block: 5 },
    ];
    if (!s.cards) {
      s.cards = {};
      T.forEach((id, i) => { s.cards[id] = { oneLiner: LINES[i][0], sub: LINES[i][1], milestones: i % 2 ? { m1a: true, m1b: true, m2a: true } : { m1a: true } }; });
    }
    if (myCard && s.me) s.cards[s.me.team] = { ...s.cards[s.me.team], ...myCard };
    s.reasonLabels = s.reasonLabels || { milestone: 'Splněný milník', traction: 'Trakce', team: 'Tým', risk: 'Riziko', market: 'Trh', other: 'Jiné' };
    if (!s.drivers) {
      s.drivers = {};
      T.forEach((id, i) => {
        s.drivers[id] = [
          { ts: t0 - 3600e3, block: 1, team: id, kind: 'revalue', delta: (i - 2) * 120000, note: i % 2 ? 'Splněný milník' : 'Riziko: zatím bez zákazníků' },
          { ts: t0 - 7200e3, block: 1, team: id, kind: 'class', delta: (6 - i) * 210000, note: '' },
          { ts: t0 - 9000e3, block: 1, team: id, kind: 'rj', delta: i === 1 ? 2000000 : 0, note: 'Smart money' },
        ].filter((d) => d.delta);
      });
    }
    if (s.features.rounds && !s.rounds) {
      s.rounds = {};
      T.forEach((id, i) => { if (i % 3 !== 2) { const prev = s.teams[i].V, pre = Math.round((prev * (i % 2 ? 1.25 : 0.8)) / 1e4) * 1e4; s.rounds[id] = { pre, prev, kind: pre > prev ? 'up' : 'down', pct: Math.round(((pre - prev) / prev) * 1000) / 10 }; } });
      if (myPre && s.me) { const prev = s.teams.find((t) => t.id === s.me.team).V; const p = Math.round(((myPre - prev) / prev) * 1000) / 10; s.rounds[s.me.team] = { pre: myPre, prev, kind: Math.abs(p) < 0.5 ? 'flat' : p > 0 ? 'up' : 'down', pct: p }; }
    }
    if (s.features.market && !s.market) {
      s.market = { flipped: [
        { id: 'k1', block: 1, ts: t0 - 5e6, title: 'Recese', text: 'Firmy škrtají rozpočty na benefity. B2B předplatné to pocítí.', effects: { [T[0]]: -20, [T[3]]: -10 } },
        { id: 'k2', block: 2, ts: t0 - 2e6, title: 'Boom AI nástrojů', text: 'Studenti masově přecházejí na AI pomocníky. Edtech roste.', effects: { [T[1]]: 30 } },
      ] };
    }
    if (s.features.tranches && !s.tranches) {
      s.tranches = [{ id: 'tr1', team: T[1], amt: 500000, cond: 'MVP na veřejné adrese', due: 3, status: 'locked' }, { id: 'tr2', team: T[3], amt: 250000, cond: '50 platících uživatelů', due: 4, status: 'locked' }];
      s.rjFund = { capital: 10000000, invested: 6000000, locked: 750000, available: 3250000 };
    }
    if (!s.points) s.points = { leaders: [], teams: {} };
    if (quizMode && !s.quiz) {
      const now = s.now || Date.now();
      const base = { seq: 7, setTitle: 'Blok 2 – slovník', idx: quizMode === 'lobby' ? -1 : 1, total: 10, serverNow: now };
      if (quizMode === 'question') s.quiz = { ...base, state: 'question', q: QUIZ.q, a: QUIZ.a, time: QUIZ.time, startedAt: t0, endsAt: t0 + QUIZ.time * 1000, answered: 7 + (quizChoice != null ? 1 : 0) };
      if (quizMode === 'reveal') s.quiz = { ...base, state: 'reveal', q: QUIZ.q, a: QUIZ.a, correct: QUIZ.correct, counts: [2, 1, 4, 11], answered: 18, fastest: { name: 'Petr Malý', team: T[2], ms: 3400 } };
      if (quizMode === 'board' || quizMode === 'lobby' || quizMode === 'done') s.quiz = { ...base, state: quizMode === 'done' ? 'done' : 'board', leaders: quizMode === 'lobby' ? [] : [
        { name: 'Petr Malý', team: T[2], quizPoints: 1840, total: 2340 }, { name: 'Jana Nováková', team: T[0], quizPoints: 1690, total: 1690 }, { name: 'Ondřej Veselý', team: T[4], quizPoints: 1520, total: 1820 },
        { name: 'Klára Dvořáková', team: T[1], quizPoints: 980, total: 980 }, { name: 'Tomáš Černý', team: T[5], quizPoints: 870, total: 1170 } ] };
    }
    if (on('exit') && !s.exit) {
      s.exit = { outcomes: {}, teams: s.teams.map((t, i) => ({ team: t.id, kind: ['acquired', 'ipo', 'hold', 'writeoff', 'acquired', 'hold'][i], multiple: [3, 6.5, 1, 0, 1.8, 1][i], V: t.V * [3, 6.5, 1, 0, 1.8, 1][i] })),
        ranking: [{ name: 'Petr Malý', team: T[2], value: 4120000, returnPct: 312 }, { name: 'Jana Nováková', team: T[0], value: 3550000, returnPct: 255 }, { name: 'Ondřej Veselý', team: T[4], value: 2010000, returnPct: 101 }],
        contrarian: { name: 'Klára Dvořáková', team: T[1], multiple: 4.2 } };
      s.phase = 'final';
    }
    const me = s.me;
    if (me) {
      if (!me.myTeamCap) { const t = s.teams.find((x) => x.id === me.team); me.myTeamCap = { ...t.cap, history: [{ label: 'Start', founders: 100 }, { label: 'Blok 1', founders: Math.min(100, t.cap.founders + 12) }, { label: 'Přecenění 4. 11.', founders: Math.min(100, t.cap.founders + 12) }, { label: 'Blok 2', founders: t.cap.founders }] }; }
      if (!me.track) me.track = { value: me.portfolio, start: 1000000, returnPct: me.start ? ((me.portfolio - me.start) / me.start) * 100 : 0, rank: 4, of: 19, bestCall: { team: T.find((x) => x !== me.team), multiple: 1.42 }, awards: [{ id: 'a1', kind: 'analyst', note: 'Nejostřejší otázka na pitch týmu StudyBuddy', block: 1 }] };
      if (!me.points) me.points = { total: 2290, rank: 3, of: 19, recent: [
        { id: 'p1', ts: t0 - 6e5, block: 2, playerId: me.id, amt: 850, kind: 'quiz', note: 'Kvíz: otázka 1' }, { id: 'p2', ts: t0 - 9e5, block: 2, playerId: me.id, amt: 300, kind: 'milestone', note: 'Milník: Byznys model v2' },
        { id: 'p3', ts: t0 - 4e6, block: 1, playerId: me.id, amt: 500, kind: 'award', note: 'Nejlepší analytik' }, { id: 'p4', ts: t0 - 5e6, block: 1, playerId: me.id, amt: 640, kind: 'quiz', note: 'Kvíz: otázka 4' } ] };
      if (s.quiz && !me.quiz) {
        const q = s.quiz;
        me.quiz = { myChoice: q.state === 'question' ? quizChoice : q.state === 'reveal' ? 3 : null, myCorrect: q.state === 'reveal' ? true : null, myPoints: q.state === 'reveal' ? 812 : 0, runPoints: 1690, rank: 2 };
      }
      if (on('msgs') && !(me.msgs || []).some((m) => m.kind === 'market')) {
        me.msgs = [{ ts: t0 - 1e5, block: s.block, kind: 'tranche', amt: 500000, cond: 'MVP na veřejné adrese' }, { ts: t0 - 2e5, block: s.block, kind: 'market', title: 'Boom AI nástrojů', text: 'Studenti masově přecházejí na AI pomocníky.', pct: 30 }, ...(me.msgs || [])];
      }
    }
    return s;
  }

  async function post(body, real) {
    const fake = (r) => new Promise((res) => setTimeout(() => res(r), 250));
    if (body.op === 'quizAnswer' && quizMode) { if (quizChoice != null) return fake({ ok: false, error: 'Odpověď už máš odeslanou.' }); quizChoice = body.choice; return fake({ ok: true }); }
    if (body.op === 'card') { const r = await real(body); if (r.ok || /Neznámá akce|vypnutá/.test(r.error || '')) { myCard = { oneLiner: body.oneLiner, sub: body.sub }; return { ok: true }; } return r; }
    if (body.op === 'roundTerms') { const r = await real(body); if (r.ok || /Neznámá akce|vypnutá/.test(r.error || '')) { myPre = body.pre; return { ok: true }; } return r; }
    return real(body);
  }

  window.PlayDemo = { patch, post };
})();
