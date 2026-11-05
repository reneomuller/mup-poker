// Demo fixtures for the projector, active only with ?demo=<state>[,<state>…]. Shapes follow docs/V2-SPEC.md.
// States: features (cap table, rounds, tranches, market cards), board, market (flip after 3 s), tranche (release after 3 s),
// award (spotlight after 3 s), quiz-lobby, quiz, quiz-long, quiz-reveal, quiz-board, exit (finale after 2 s), exit-final.
(function () {
  const want = new URLSearchParams(location.search).get('demo');
  if (!want) return;
  const D = new Set(want.split(','));
  const t0 = Date.now();
  const after = (ms) => Date.now() - t0 > ms;
  const NAMES = ['Anna Nováková', 'Petr Svoboda', 'Jana Dvořáková', 'Tomáš Černý', 'Eva Procházková', 'Lukáš Kučera', 'Kateřina Veselá', 'Jakub Horák', 'Lucie Němcová', 'Martin Marek', 'Tereza Pokorná'];
  let seqBase = 0;
  const QZ = { q: 'Co znamená CAC?', a: ['Kolik stojí získat jednoho zákazníka', 'Kolik zákazník utratí za rok', 'Podíl zákazníků, kteří za období odejdou', 'Měsíční opakované tržby'] };
  const VS = [4200000, 2600000, 1800000, 3100000, 950000, 1400000];

  window.TABLE_DEMO = function (s) {
    const ids = s.teams.map((t) => t.id);
    const tid = (i) => ids[i % ids.length];
    if (!seqBase) seqBase = (s.reveal?.seq || 0) + 1000;
    s.features = { ...(s.features || {}) };
    const feat = (...k) => k.forEach((x) => { s.features[x] = true; });
    const values = () => s.teams.forEach((t, i) => { t.V = VS[i % 6]; t.cls = Math.round(VS[i % 6] * 0.45); t.rj = Math.round(VS[i % 6] * 0.25); });
    if (D.has('features') || D.has('board') || D.has('market') || D.has('tranche')) {
      feat('captable', 'rounds', 'tranches', 'market', 'drivers', 'track', 'points', 'cards');
      values();
      s.teams.forEach((t, i) => { const f = [62.4, 48.1, 71, 55.5, 80.2, 66.6][i % 6]; t.cap = { founders: f, cls: Math.round((100 - f) * 6.5) / 10, rj: Math.round((100 - f) * 3.5) / 10, investors: 3 + i }; });
      const kinds = [['up', 18.5], ['down', -12], ['flat', 0], ['up', 6.2], ['down', -30], ['flat', 0]];
      s.rounds = Object.fromEntries(ids.map((id, i) => [id, { pre: 1, prev: 1, kind: kinds[i % 6][0], pct: kinds[i % 6][1] }]));
      if (s.phase === 'lobby') s.phase = 'betting';
      s.tranches = [{ id: 'tr1', team: tid(1), amt: 500000, cond: 'MVP na veřejné adrese', due: 3, status: 'locked' }, { id: 'tr2', team: tid(4), amt: 1000000, cond: '50 platících zákazníků', due: 4, status: 'locked' }];
      s.market = { flipped: [
        { id: 'm1', block: 1, ts: 1, title: 'Úrokové sazby rostou', text: 'Peníze jsou dražší, investoři zpomalují.', effects: { [tid(0)]: -10, [tid(3)]: -5 } },
        { id: 'm2', block: 2, ts: 2, title: 'AI regulace v EU', text: 'Nová pravidla pro AI produkty zdražují vývoj.', effects: { [tid(2)]: -15 } },
      ] };
      s.cards = Object.fromEntries(ids.map((id, i) => [id, { oneLiner: ['Budík, který tě vzbudí pivem', 'Doučování od spolužáků za pár korun', 'Zelené střechy pro paneláky', 'Drony na inventuru skladů', 'Kafe předplatným pro kanceláře', 'Léky domů do hodiny'][i % 6], sub: '', milestones: {} }]));
    }
    if (D.has('market') && after(3000)) {
      s.market.flipped.push({ id: 'm3', block: 2, ts: 3, title: 'Velký zákazník odešel', text: 'Největší pilotní zákazník tří týmů ruší smlouvu. Kdo stojí na jednom zákazníkovi, ztrácí.', effects: { [tid(1)]: -20, [tid(4)]: 35, [tid(5)]: 12 } });
      s.teams.forEach((t, i) => { const e = s.market.flipped[2].effects[t.id]; if (e) t.V = Math.round(VS[i % 6] * (1 + e / 100)); });
      s.reveal = { seq: seqBase + 1, block: s.block, kind: 'market', title: 'Velký zákazník odešel', text: s.market.flipped[2].text, delta: {} };
      if (s.phase === 'betting') s.phase = 'rj';
    }
    if (D.has('tranche') && after(3000)) {
      s.tranches[0].status = 'released';
      s.teams[1].V += 500000; s.teams[1].rj += 500000;
      s.reveal = { seq: seqBase + 2, block: s.block, kind: 'tranche', team: tid(1), amt: 500000 };
    }
    if (D.has('board')) {
      s.screen = 'board';
      s.history = [{ label: 'Start', V: Object.fromEntries(ids.map((id) => [id, 1000000])) }, { label: 'Blok 1', V: Object.fromEntries(ids.map((id, i) => [id, VS[i % 6] * 0.7])) }, { label: 'Karta: Úrokové sazby rostou', V: Object.fromEntries(ids.map((id, i) => [id, VS[i % 6] * 0.8])) }, { label: 'Blok 2', V: Object.fromEntries(ids.map((id, i) => [id, VS[i % 6]])) }];
      s.leaders = NAMES.slice(0, 5).map((n, i) => ({ name: n, team: tid(i), value: 1650000 - i * 160000, returnPct: 65 - i * 16 }));
      s.points = { leaders: NAMES.slice(0, 10).map((n, i) => ({ name: n, team: tid(i + 2), total: 4200 - i * 330 })), teams: {} };
      const D2 = [['class', 1200000, ''], ['rj', 1500000, ''], ['revalue', -300000, 'Riziko'], ['market', -120000, 'Úrokové sazby rostou'], ['round', 400000, 'Up round'], ['revalue', 500000, 'Splněný milník']];
      s.drivers = Object.fromEntries(ids.map((id, i) => [id, [{ ts: 100 - i, block: 2, team: id, kind: D2[i % 6][0], delta: D2[i % 6][1], note: D2[i % 6][2] }]]));
    }
    if (D.has('award')) {
      feat('track');
      s.awards = after(3000) ? [{ id: 'a1', block: s.block, kind: 'sharpest', name: 'Kateřina Veselá', team: tid(2), note: 'Jako jediná vsadila na Dronex, když stál nejníž.' }] : [];
    }
    const quiz = (state, extra) => { feat('quiz'); s.quiz = { state, seq: 50 + ['board', 'question', 'reveal'].indexOf(state), setTitle: 'Blok 2 – slovník', idx: 2, total: 15, serverNow: Date.now(), ...extra }; };
    if (D.has('quiz-lobby')) quiz('board', { idx: -1, leaders: [] });
    if (D.has('quiz')) quiz('question', { ...QZ, time: 20, startedAt: t0 + 1000 - 0, endsAt: t0 + 21000, answered: Math.min(14, Math.floor((Date.now() - t0) / 900)) });
    if (D.has('quiz-long')) quiz('question', { q: 'Startup má měsíční opakované tržby 40 000 $, churn 5 % měsíčně a CAC 1 200 $. Který z následujících kroků nejvíc zlepší poměr LTV ku CAC během půl roku?', a: ['Snížit churn na polovinu díky lepšímu onboardingu a pravidelné péči o stávající zákazníky', 'Zdvojnásobit rozpočet na placenou reklamu a doufat, že se CAC časem sám sníží', 'Zavést roční předplatné se slevou, které zákazníky udrží déle a zlepší cash flow', 'Najmout dalšího obchodníka, i když zatím nemáme opakovatelný prodejní proces'], time: 30, startedAt: t0, endsAt: t0 + 30000, answered: 3 });
    if (D.has('quiz-reveal')) quiz('reveal', { ...QZ, correct: 0, counts: [9, 3, 4, 1], answered: 17, fastest: { name: 'Lukáš Kučera', team: tid(5), ms: 2380 } });
    if (D.has('quiz-board')) quiz('board', { leaders: NAMES.slice(0, 10).map((n, i) => ({ name: n, team: tid(i), quizPoints: 2900 - i * 210, total: 4100 - i * 300 })) });
    if (D.has('exit') || D.has('exit-final')) {
      if (D.has('exit-final') || after(2000)) {
        feat('exit');
        values();
        const O = [['ipo', 8], ['acquired', 3.5], ['hold', 1], ['writeoff', 0], ['acquired', 1.6], ['hold', 1]];
        s.exit = {
          outcomes: Object.fromEntries(ids.map((id, i) => [id, { kind: O[i % 6][0], multiple: O[i % 6][1] }])),
          teams: ids.map((id, i) => ({ team: id, kind: O[i % 6][0], multiple: O[i % 6][1], V: O[i % 6][0] === 'writeoff' ? 0 : Math.round(VS[i % 6] * O[i % 6][1]) })),
          ranking: NAMES.slice(0, 10).map((n, i) => ({ name: n, team: tid(i + 1), value: 5400000 - i * 430000, returnPct: 440 - i * 43 })),
          contrarian: { name: 'Tereza Pokorná', team: tid(3), target: tid(0), multiple: 6.4 },
        };
        s.phase = 'final';
      }
    }
    // v3: fake the server's Vnow / mult / rank / chg (docs/V3-SPEC.md §1–2) on top of a real v2 GET
    if (D.has('v3')) {
      const pend = s.phase === 'betting' || s.phase === 'closed';
      const L = s.teams.map((t) => t.live || 0);
      const avgNet = L.reduce((a, b) => a + b, 0) / (L.length || 1), avgIn = L.reduce((a, b) => a + Math.max(0, b), 0) / (L.length || 1);
      const F = {};
      for (const [b, m] of Object.entries(V3.mult)) if (+b < s.block || (+b === s.block && !pend)) for (const id in m) F[id] = (F[id] || 1) * m[id];
      const vs = (V3.start[s.block] = V3.start[s.block] || {});
      s.drivers = { ...(s.drivers || {}) };
      s.teams.forEach((t) => {
        t.V = Math.round(t.V * (F[t.id] || 1));
        const m = pend && avgIn ? Math.min(10, Math.max(0.1, 1 + ((t.live || 0) - avgNet) / avgIn)) : 1;
        if (pend) (V3.mult[s.block] = V3.mult[s.block] || {})[t.id] = m;
        t.mult = Math.round(m * 100) / 100;
        t.Vnow = pend ? Math.round((t.V + (t.live || 0)) * m) : t.V;
        if (vs[t.id] == null) vs[t.id] = pend ? t.V : t.V;
        t.chg = vs[t.id] ? t.Vnow / vs[t.id] - 1 : 0;
      });
      [...s.teams].sort((a, b) => b.Vnow - a.Vnow).forEach((t, i) => { t.rank = i + 1; });
      s.demand = {};
      for (const [b, m] of Object.entries(V3.mult)) {
        if (+b === s.block && pend) continue;
        s.demand[b] = { mult: m };
        for (const t of s.teams) {
          const x = m[t.id] || 1;
          const note = 'Poptávka v bloku ' + b + ' (×' + x.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ')';
          s.drivers[t.id] = [...(s.drivers[t.id] || []), { ts: Date.now() - 1000 * +b, block: +b, team: t.id, kind: 'demand', delta: Math.round(t.V - t.V / x), note }];
        }
      }
      if (D.has('longnames')) s.teams.forEach((t, i) => { if (i % 2 === 0) t.name = t.name + ' – Zdravotní pomůcky pro seniory'; });
    }
    return s;
  };
  const V3 = { mult: {}, start: {} };
})();
