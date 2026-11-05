# MUP poker v2 — specification

This file is the contract between the server, the three screens and the tests. Build exactly this; if something here is impossible or contradictory, write it under "Open issues" at the bottom of your report instead of improvising a different contract.

The live game is used tomorrow by ~20 students on phones, a school PC on a projector, and the RainbowJet team on the admin page. **Production data must survive the deploy**: Block 1 is in production with 19 players and 19 submitted investment slips in `slip:1`, phase `closed`, showdown **not yet run**. After deploy the dealer will run Showdown for Block 1, then move to Block 2.

## 0. Ground rules

- One endpoint `/api/game` (`api/game.js`). `GET` = state; `POST {op, ...}` = action. Students authenticate with `sid` + `pin` (body) / `x-sid` + `x-pin` (headers). Dealer is open unless `DEALER_LOCK=1` (`x-dealer` header).
- Storage via `api/_lib/store.js` (Redis + Postgres mirror in production, memory locally). Keys: `meta` (JSON), hashes `players`, `slip:<block>`, `qs`, `qv`, `qr`, `content`, `backups`.
- **All new game state lives inside `meta`** unless stated. Every existing field and op keeps working.
- Money: integer USD. Texts shown to users: Czech, precise, typographic quotes „ “, en dash –, non-breaking space after single-letter prepositions where relevant.
- Feature flags gate **display and ops**, never data loss. When a feature is off, its ops return `fail('Tato funkce je vypnutá.')` and its public fields may be omitted; recording (drivers, lots) happens regardless.
- Ghost players (`p.ghost`) never affect money, counts, leaderboards, awards, contrarian, or exports (except flagged rows in the data view).

## 1. Feature flags

`meta.features` with defaults applied when a key is missing:
`{ captable: true, cards: true, drivers: true, track: true, quiz: true, points: true, rounds: false, market: false, tranches: false, exit: false }`

- `publicState.features` = the effective object.
- Dealer op `features { set: { <key>: boolean, ... } }` → merges, saves.

## 2. Archive and data access

- Hash `arch`: field = archive id, value = `{ id, ts, label, auto, block, dump }`, `dump` = the existing `makeDump()` output (meta, players, slips by block, content, board). Add `'arch'` to `HASHES` in `store.js` so Postgres mirrors it. `arch` is **not** part of `makeDump()`.
- Automatic archives:
  1. On the first `load()` after the v2 deploy, when `meta.v2ArchivedAt` is missing: create archive `label: "Stav před v2"`, `auto: true`, then set `meta.v2ArchivedAt` and save. Must be safe if two server instances race (duplicates acceptable, data loss not).
  2. Before `nextBlock` → `"Před blokem <N+1>"`; before `reset` → `"Před novou hrou"`; before `exitSet` → `"Před exitem"`.
- Dealer ops: `archive { label }` → `{ id }`; `archiveDelete { id }`; `clearBoard {}` → archive `"Otázky z tabule"` then delete hashes `qs`, `qv`, `qr`.
- Dealer GETs:
  - `?view=archives` → `{ ok, archives: [{ id, ts, label, auto, block, sizeKB }] }` newest first.
  - `?view=archive&id=<id>` → `{ ok, archive }` (full object, for download).
  - `?view=data` → `{ ok, generated, teams, players, allocations }`:
    - `teams: [{ id, name, color, V, S, founderPct, cls, rj, oneLiner, sub }]`
    - `players: [{ id, name, team, teamName, created, ghost, hasPin, portfolio, returnPct, holdings: { <teamId>: <$ value> } }]`
    - `allocations: [{ block, playerId, name, team, submitted, ts, in: { <teamId>: { amt, why } }, out: {...}, notes: { <teamId>: { like, doubt } } }]` for every block 1…current (RJ slip included with `playerId: 'rj'`).
- Phones never show notes or reasons of any block other than the current one.

## 3. Cap table (`captable`)

`FOUNDER_SHARES = 1 000 000` per team (unchanged). For team t: `S = ledger.S[t]`; founders' share = `FOUNDER_SHARES / S`.

- `publicState.teams[i].cap = { founders, cls, rj, investors }` — percentages 0–100 with one decimal; `investors` = number of distinct non-ghost students holding > 0 in t.
- `snapshot()` additionally stores `F: { <teamId>: founders% }` so history shows dilution over time (older snapshots simply lack `F`).
- `meState.myTeamCap` = the own team's `cap` plus `history: [{ label, founders }]` from snapshots that have `F`.

## 4. Startup cards (`cards`)

- `meta.cards = { <teamId>: { oneLiner (≤ 90 chars), sub (≤ 220 chars), milestones: { <key>: true }, updatedAt, updatedBy } }`
- `meta.milestoneDefs = [{ key, label, block }]`, defaults:
  `m1a` „Potvrzený problém a one-liner“ (1) · `m1b` „Tři nejrizikovější předpoklady“ (1) · `m2a` „Byznys model v2“ (2) · `m2b` „Přehled konkurence“ (2) · `m2c` „Memo s důkazy“ (2) · `m2d` „MVP brief“ (2) · `m3a` „MVP na veřejné adrese“ (3) · `m4a` „Růstový motor běží“ (4) · `m5a` „Byznys model a pitch“ (5)
- `publicState.cards = { <teamId>: { oneLiner, sub, milestones } }`, `publicState.milestoneDefs`.
- Student op `card { oneLiner, sub }` → own team only (ghosts refused). Dealer op `card { team, oneLiner?, sub?, milestones?: { <key>: boolean } }`; dealer op `milestoneDefs { defs }`.

## 5. Valuation drivers (`drivers`)

- `meta.drivers = [{ ts, block, team, kind, delta, note }]`, newest last, capped at 600. `delta` = change of the team's valuation in $.
- Recorded on every valuation change:
  - `class` — student money at a showdown (net in − out for the team)
  - `rj` — RJ reveal or tranche release
  - `revalue` — dealer revaluation. `revalue` op gains optional `reason: { <teamId>: 'milestone'|'traction'|'team'|'risk'|'market'|'other' }`; note = the existing `why` text (or the reason label)
  - `round` — priced-round repricing (note „Up round“ / „Down round“ / „Flat round“)
  - `market` — market card (note = card title)
  - `exit`
- Reason labels: milestone „Splněný milník“, traction „Trakce“, team „Tým“, risk „Riziko“, market „Trh“, other „Jiné“. Export them as `publicState.reasonLabels`.
- `publicState.drivers = { <teamId>: [last 8, newest first] }`.

## 6. Priced rounds (`rounds`)

- `meta.rounds = { <block>: { <teamId>: { pre, prev, ts, by } } }`
- Setting terms: while the current block is in phase `lobby` or `pitch` (and its showdown has not run), a team member (student op `roundTerms { pre }`) or the dealer (op `roundTerms { team, pre }`) sets the pre-money valuation. Allowed range: 50 %–200 % of the team's current valuation, rounded to the nearest 10 000 $. Outside → `fail('Ocenění kola musí být mezi X a Y.')`. Ghosts refused. `prev` = valuation at the time of setting.
- When the dealer moves the phase to `betting` and `rounds` is on: for every team with terms, `P[t] = pre / S[t]`; driver `round`; history snapshot „Kolo bloku N“ if anything changed; terms lock (further `roundTerms` fail).
- Trades of the block execute at that price (existing behaviour).
- `publicState.rounds = { <teamId>: { pre, prev, kind: 'up'|'flat'|'down', pct } }` for the current block (`pct` one decimal; `flat` when |pct| < 0.5).
- No terms = flat round.

## 7. Market cards (`market`)

- `meta.market = { flipped: [{ id, block, ts, title, text, effects: { <teamId>: pct } }] }`
- Dealer op `marketCard { title (≤ 60), text (≤ 240), effects: { <teamId>: pct } }`, pct number −60…+100 (0 or missing = no effect). Refused during `betting`/`closed` (same rule as revalue).
  - `P[t] *= 1 + pct/100`; driver `market`; team message in `meta.fb[t]`: `{ kind: 'market', title, text, pct }`.
  - history snapshot „Karta: <title>“, `recordPf`, `meta.reveal = { seq, block, kind: 'market', title, text, delta: { <teamId>: $ } }`.
- `publicState.market = { flipped }`.
- The admin ships ~12 Czech preset cards (frontend only) with suggested effects, editable per team before flipping.

## 8. RJ tranches (`tranches`)

- `meta.tranches = [{ id, team, amt, cond, due, status: 'locked'|'released'|'cancelled', ts, doneAt }]`
- RJ fund = `RJ_CAPITAL` (10 M). Track `meta.rjPrincipal` = $ RJ has put in (sum of RJ `in` at reveals + releases − RJ `out`). `available = 10 M − rjPrincipal − Σ locked`.
- When `tranches` is on, RJ's first investment no longer has to be all-in: RJ may invest any amount ≤ `available` (rules for RJ: `mode 'fund'`, `capital: available`).
- Dealer ops: `trancheAdd { team, amt, cond, due }` (amt ≤ available); `trancheRelease { id }` → RJ buys `amt` of the team at the current price (shares issued), driver `rj`, team message `{ kind: 'tranche', amt, cond }`, `meta.reveal = { seq, block, kind: 'tranche', team, amt }`; `trancheCancel { id }`.
- `publicState.tranches = [{ id, team, amt, cond, due, status }]`, `publicState.rjFund = { capital, invested, locked, available }`.

## 9. Track record (`track`)

- Lots: from v2 on, `G.apply` records `meta.lots[<investor>] = [{ team, shares, price, block, ts, low }]`; withdrawals consume that investor's lots in the team FIFO. `low = true` when the team's valuation was at or below the median of all teams at the time of buying.
- `meState.track = { value, start: 1 000 000, returnPct, rank, of, bestCall: { team, multiple } | null, awards: [{ id, kind, note, block }] }`; rank among non-ghost students by portfolio value.
- `meta.awards = [{ id, block, kind: 'sharpest'|'analyst'|'contrarian'|'custom', playerId, note }]`; dealer ops `award { kind, playerId, note }`, `awardRemove { id }`.
- `publicState.leaders` (top 5) gains `returnPct`; `publicState.awards = [{ id, block, kind, name, team, note }]`; `publicState.contrarian = { name, team, multiple } | null` = best current multiple (current price ÷ lot price) among students' `low` lots.

## 10. Exit (`exit`)

- Dealer op `exitSet { outcomes: { <teamId>: { kind: 'acquired'|'ipo'|'hold'|'writeoff', multiple } } }` (multiple 0.5…20 for acquired/ipo): auto-archive, `backup()` (so `undo` reverts it), then acquired/ipo → `P *= multiple`; writeoff → `P = 0`; hold → unchanged. Drivers `exit`, `phase = 'final'`, history „Exit“, `recordPf`, `meta.reveal = { seq, block, kind: 'exit' }`, `meta.exit = { ts, outcomes }`.
- `publicState.exit = { outcomes, teams: [{ team, kind, multiple, V }], ranking: [{ name, team, value, returnPct }] (top 10 students), contrarian }` when `meta.exit` is set.
- Never NaN/Infinity anywhere: a team at P = 0 has stake value 0, can't be withdrawn from, and divisions by S or P are guarded.

## 10b. Quiz (`quiz`) and points (`points`)

An in-app quiz in the spirit of a classroom quiz show, plus a points ledger that adds up across activities. Feature defaults: `quiz: true`, `points: true` (add both to the defaults in §1). Do **not** copy Kahoot's branding, colours or shapes: answers are A/B/C/D tiles in the stand palette (blue `#3586D1`, violet `#6754DF`, pink `#FF5574`, orange `#FF8A47`).

**State**
- `meta.quizSets = [{ id, title, questions: [{ q (≤ 160), a: [4 × ≤ 80], correct: 0..3, time: 5..120 s }] }]`. On first load when `meta.quizSets` is missing, seed it with one set `{ id: 'blok2', title: 'Blok 2 – slovník' }` whose questions are in `docs/quiz-blok2.json` (copy them into `api/_lib/quiz-seed.js` as a JS export; do not read the docs folder at runtime).
- `meta.quiz = { runId, setId, idx, state: 'idle'|'question'|'reveal'|'board'|'done', startedAt, endsAt, seq }`. `seq` increments on every state change.
- Answers: hash `qa`, field `<runId>:<idx>:<sid>` → `{ choice, ms, ts }` (`ms` = ms after `startedAt`). One write per student per question; **a second answer is refused** („Odpověď už máš odeslanou.“). Add `'qa'` to `HASHES` in `store.js`. Read `qa` only when needed (reveal, board, data view), never on every GET.
- Points ledger: `meta.points = [{ id, ts, block, playerId, amt, kind: 'quiz'|'award'|'milestone'|'manual', note }]`. Totals are computed from it.

**Scoring** (at reveal, written once per question to `meta.points` as one entry per correct student, kind `quiz`, note = „Kvíz: otázka N“): correct → `round(1000 × (1 − 0.5 × ms / (time × 1000)))`, clamped 500…1000; wrong or no answer → 0. Ghosts never receive points.

**Ops**
- Dealer: `quizSave { set }` (create or replace by id; validate lengths, 2–4 answers allowed, `correct` in range), `quizDelete { id }`, `quizStart { setId }` (new `runId`, `idx = -1`, state `board` with an empty board = „lobby“ of the quiz), `quizNext` (idx + 1, state `question`, `startedAt = now`, `endsAt = now + time`), `quizReveal` (state `reveal`, score the question; idempotent), `quizBoard` (state `board`), `quizEnd` (state `done`, then `idle` on next `quizStart`). `quizNext` after the last question → `done`. Answers after `endsAt + 1500 ms` are refused („Čas vypršel.“).
- Student: `quizAnswer { choice }` for the current question while state is `question`.
- Dealer: `pointsAdd { playerId | team, amt (−5000…5000, ≠ 0), note, kind? }` (a `team` gives the points to every non-ghost member), `pointsRemove { id }`. `award` (§9) also adds 500 points (kind `award`) when `points` is on. `card` milestones newly set to true add 300 points to every member of the team (kind `milestone`).

**Views**
- `publicState.quiz`:
  - always: `{ state, seq, setTitle, idx, total, serverNow }`
  - state `question`: `+ { q, a, time, startedAt, endsAt, answered }` (`answered` = count of answers so far — keep a counter in meta or a cheap `hlen`; it may lag by one poll). **Never the correct index.**
  - state `reveal`: `+ { q, a, correct, counts: [n per answer], answered, fastest: { name, team, ms } | null }`
  - state `board` / `done`: `+ { leaders: top 10 [{ name, team, quizPoints, total }] }` (quizPoints = this run).
- `meState.quiz = { myChoice | null, myCorrect | null (reveal only), myPoints (this question), runPoints, rank }`.
- `publicState.points = { leaders: top 10 [{ name, team, total }], teams: { <teamId>: avg points per member } }`; `meState.points = { total, rank, of, recent: last 8 entries }`.
- `?view=data` gains `points` (full ledger) and `quizRuns: [{ runId, setId, idx, answers: { <sid>: { choice, ms } } }]`.
- Phones poll every 1 s while `publicState.quiz.state` is `question` and every 2.5 s otherwise; the table every 1 s during a quiz. Keep the server cheap: a GET must not grow by more than one Redis command because of the quiz.

## 11. Invariants the tests check

- Every existing op still works: register, login, restore, submit, notes, reasons, ask/vote/answer/react, showdown, rjSave, rjReveal, revalue, nextBlock, pin, unpin, qpin, qhide, content, startValuation, teams, resetPin, movePlayer, removePlayer, undo, reset, ghost, restore (dealer), features, archive, … .
- Students in rebalance mode move **exactly** 300 000 $ (out = in = 300 000).
- Money conservation: Σ stake values of all investors + founders' value = Σ team valuations (± rounding); class money at a showdown = Σ submitted `in`.
- `makeDump()` / dealer `restore` carry every new meta field (they live in `meta`).
- 18 students acting concurrently never lose a write.

## 12. Screens

Stable hooks for automated tests (keep these ids or add these `data-test` attributes):
- Phone login: `#lname`, `#lteam`, `#lpin`, `#lgo`, `#lwho`, tabs `[data-tab="new"]` / `[data-tab="old"]`.
- Phone investing: rows `[data-k="in"|"out"][data-t="<teamId>"]` with an `input.amt`; submit `#go`.
- Phone navigation: `[data-nav="invest"|"portfolio"|"startups"|"profile"]`. Quiz answer tiles `[data-quiz="0"…"3"]`.
- Admin quiz controls: `#qzstart`, `#qznext`, `#qzreveal`, `#qzboard`, `#qzend`.
- Admin phase controls: `#blobby`, `#bpitch`, `#bbet`, `#bclose`, `#bshow` (showdown), `#brj`, `#bnext`, `#bfinal`; feature switches `[data-feature="<key>"]`; admin tabs `[data-atab="<name>"]`.
- Table: plates `[data-seat="<teamId>"]`.

**Phone (`/play`)** — stand design (`/fonts/stand-fonts.css`, `/stand.css`). Bottom tab bar: Investovat · Portfolio · Startupy · Profil. Keep every current behaviour (login/register, ghost link `#ghost=sid:pin`, silent restore after server loss, tap-to-type amounts, exact 300k, notes inside the first investment, editable reasons after submitting, RJ messages, stonks chart). Add the feature UIs: cap table (own team, Portfolio), startup cards (Startupy), team card editor and round terms (Profil, for own team, when allowed), track record and awards (Profil), market card and tranche messages (messages), exit result.

**Quiz on screens** — Phone: full-screen four big A/B/C/D answer tiles (question text is on the projector, repeat it small on the phone), instant „Odesláno“ state, then correct/wrong + points at reveal, rank at board. Projector: question, answers, countdown ring, answered counter, then the answer split bars and the fastest correct answer, then the top-10 board with a short rise animation. Admin: a Kvíz tab with the set editor (add/edit/reorder questions, import JSON), Start / Další otázka / Odhalit / Žebříček / Ukončit controls, live answered count; and a Body tab (ledger, add/remove points for a player or a whole team, top list).

**Projector (`/table`)** — polished poker table, readable from the back of a classroom, correct at 1920×1080, 1366×768, 1280×720 and 1024×768. Keep seats, valuations, live incoming money, reveal animations, clouds, QR join, timer glass, board screen. Add: community cards = flipped market cards; Up/Down round badge and founders % on plates; locked tranche chips; drivers ticker on the board screen; exit finale screen; awards spotlight.

**Admin (`/dealer`)** — stand design, tabs: Hra · Investice · RJ · Ocenění · Startupy · Kvíz · Body · Hráči · Funkce · Data · Texty (link to `/cms`). Usable on a laptop and a phone. Data tab: teams/players/allocations tables from `?view=data`, CSV + JSON export, archives (create, download, delete), action log download, „Vyčistit tabuli otázek“.

## Open issues

(Agents: add anything that blocked you here in your final report, not in this file.)
