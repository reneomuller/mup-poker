# MUP poker v3 — demand pricing, live numbers, Tým tab, team sticker walls

Contract between the server, the screens and the tests, on top of `docs/V2-SPEC.md` (everything there still holds unless this file changes it). Production runs v2 right now: Block 1 is `closed` with 19 submitted slips and **the showdown has not run**. The dealer will press Showdown in class after this deploys, so Block 1 must settle with the new pricing. Production data must survive the deploy exactly as in v2.

Ground rules from v2 still apply: one endpoint `/api/game`, money in integer USD, Czech UI text with „ “ quotes, en dash – and a non-breaking space after single-letter prepositions, ghosts never affect money or counts, and feature flags gate display and ops, never data.

## 1. Demand pricing (`demand`, default **on**)

Add `demand: true` to `FEATURE_DEFAULTS`. It's like a stock market: a startup's share price moves with how much money it attracted compared with the other startups.

For the class trades of the current block (submitted, non-ghost, non-RJ slips, the same set the showdown applies):
- `in_t` = Σ `in[t].amt`, `out_t` = Σ `out[t].amt`, `net_t = in_t − out_t`
- `avgIn` = mean of `in_t` over all teams, `avgNet` = mean of `net_t` over all teams
- `mult_t = clamp(1 + (net_t − avgNet) / avgIn, 0.1, 10)`, and `mult_t = 1` for every team when `avgIn = 0`

In Block 1 (only buying) this is exactly `in_t / avgIn`. In rebalance blocks (exactly 300 000 moved, so `avgNet = 0`) it is `1 + net_t / avgIn`.

**At showdown** (op `showdown`, class settle): apply the trades at the old price exactly as now (`G.apply`), **then** `ledger.P[t] *= mult_t` for every team. Then record drivers, snapshot and `recordPf` as now. So valuations, founders' value, every investor's stake and every portfolio change together, and money conservation (Σ stakes + founders' value = Σ valuations) still holds. Record a valuation driver `kind: 'demand'` per team, with delta = valuation after repricing − valuation before repricing and label „Poptávka v bloku N (×1,63)“. Store `meta.demand[block] = { mult: {t: x}, in: {t}, out: {t}, avgIn }` for the views and the data export. RJ smart money and the manual `revalue` keep working afterwards, at the new prices.

When `demand` is off, the showdown behaves exactly as in v2.

**Pure function, used twice.** Put the math in one exported function (e.g. `G.demand(meta, slips, players)` → `{ mult, in, out, avgIn }`, plus a helper that returns the *projected* ledger: the ledger cloned, the pending class trades applied, prices multiplied). The showdown and the live views must use the same code, so the live number equals the post-showdown number.

## 2. Live numbers everywhere

While class trades are pending (`phase` is `betting` or `closed` and `!meta.settled[block + 'c']`), every number shown as a current valuation, share price, stake or portfolio uses the **projected** ledger from §1. Otherwise it uses the real ledger.

`publicState.teams[i]` gains:
- `Vnow`: projected valuation (= `V` when nothing is pending)
- `mult`: this block's live demand multiple (1 when not pending or `demand` off)
- `rank`: 1 = highest `Vnow`
- `chg`: `Vnow / V_at_start_of_block − 1`, as a fraction

Keep `V`, `cls`, `rj` and `live` with their v2 meaning, because old clients rely on them.

`publicState.leaders` (portfolio leaderboard) uses projected portfolios while pending. `meState` gains `portfolioNow`, `stakesNow` and `rankNow` (projected), and keeps `portfolio` and `stakes` with their v2 meaning. The 700 ms GET cache stays. **No extra Redis commands per GET** (slips are already read for `live`); the a-perf and v2-quiz command-count checks must still pass.

## 3. Tým tab (phone): `meState.myTeam`

`meState.myTeam` (for the student's own team; ghosts get their team too):
```
{ id, name, color, Vnow, V, P, Pnow, mult, rank, of, chg, founders, investorsNow,
  history: [{ label, block, V }],                      // from meta.history snapshots, plus a live point while pending
  flows: [{ block, settled, totalIn, totalOut, mult,
            investors: [{ id, name, team, in, out, whyIn, whyOut }] }] }
```
- `flows`: one entry per block (newest first). Per investor, the class money they put into or took out of **this** team, with their written reasons (`in[t].why`, `out[t].why`). Real names: the class plays it like a stock market.
- A settled block lists every investor by name. In the current, unsettled block, `investors` lists the submitted slips so far, also by name, so founders watch it fill up live. Ghosts are never listed. RJ is listed only after the RJ reveal of that block, as `{ id: 'rj', name: 'RainbowJet' }`.
- `investorsNow` = number of distinct non-ghost students holding shares in the team (projected).

## 4. Team sticker walls (`wall`, default **on**)

Every team has a private wall of stickers, like M4brain's post-its. The dealer (MUP / RainbowJet) and the team's own students post questions and tasks there, answer them, and tick tasks off. **No team ever sees another team's wall.**

**Storage:** one hash per team, `wall:<teamId>`. Different fields so that concurrent writers never overwrite each other:
- `s:<stickerId>` → `{ id, kind: 'q'|'task', text (1..500), by: { role: 'dealer'|'student', id?, name }, ts, group?, ghost? }`
- `r:<stickerId>:<replyId>` → `{ id, text (1..500), by, ts, ghost? }`
- `d:<stickerId>` → `{ done: true|false, by, ts }` (tasks only)

Limits: 300 stickers per team, 100 replies per sticker. Ids: short random. Include every `wall:<teamId>` hash in `makeDump()` (as `walls: { <teamId>: { field: value } }`) and in dealer `restore`, and add `walls` to `?view=data`.

**Ops:**
- Student (own team only, `wall` on): `wallPost { kind, text }`, `wallReply { id, text }`, `wallDone { id, done }` (task stickers only), `wallDelete { id, reply? }` (only their own sticker or reply).
- Dealer: `wallPost { team | all: true, kind, text }`. `all: true` creates one sticker on **every** team's wall with a shared `group` id, and each team's done state stays separate. Also `wallReply { team, id, text }`, `wallDone { team, id, done }`, `wallDelete { team, id, reply? }` (any sticker, and any reply).
- Errors are Czech, e.g. „Text je prázdný.“, „Tahle nástěnka patří jinému týmu.“

**Views.** These are not part of the plain GET, so they add no Redis commands to it:
- Student `GET /api/game?view=wall` (with x-sid / x-pin) → `{ ok, team, stickers: [ { id, kind, text, by, ts, group?, mine, done, doneBy?, replies: [{ id, text, by, ts, mine }] } ] }`, newest first, open tasks before done ones. A ghost's stickers and replies are visible only to that ghost and the dealer.
- Dealer `GET ?view=wall&team=<id>` → the same for that team (with `mine` false); `team=all` → `{ ok, walls: { <teamId>: [stickers] } }`.
- A cheap badge for phones: `meState.wallRev` = a per-team counter kept in hash `tx`, field `wr:<team>` = `{ n, ts }` (read by every GET already), incremented on every non-ghost wall write. Not in `meta`: a student request must never rewrite meta, or it can undo a dealer op saved on another instance at the same moment. The dealer state carries `wallRev: { <teamId>: n }` for the Nástěnky badges. The phone polls `?view=wall` every 4 s while the Tým tab is open, and otherwise only when `wallRev` changes.

## 5. Screens

**Phone (`/play`).**
- The bottom tab "Profil" becomes **„Tým“**. Keep the hook `[data-nav="profile"]` so the tests still find it.
- Tým shows, top to bottom:
  1. Team header: name, `Vnow` large and live, the change in %, rank „#2 z 6“, founders %, number of investors.
  2. A small valuation chart from `myTeam.history`.
  3. **Investoři**: per block, each investor's name, amount in/out and reason, with the current block filling live.
  4. **Nástěnka týmu** (the wall component, §6).
  5. Everything that was on Profil: team card editor, round terms, track record, awards, account.
- Every valuation, portfolio and stake number shown during investing uses the `…Now` fields, so it updates live.

**Admin (`/dealer`).**
- New tab **„Nástěnky“** with hook `[data-atab="walls"]`. Team chips plus „Všechny týmy“ (an overview of all walls side by side or stacked), and the wall component in dealer mode: a composer with an **Otázka / Úkol** selector chosen before posting, plus a „Poslat všem týmům“ checkbox for tasks. Reply, tick off and delete on any sticker, with a confirm before delete.
- The Investice and Startupy tabs show `Vnow`, `mult` and `rank` live.
- The Funkce tab gains switches for `demand` and `wall` (they come from `features`).

**Projector (`/table`).** The plates' main valuation number is `Vnow` (tweened, live during investing). Show the live change („▲ 63 %“ / „▼ 25 %“) and the rank, and keep „+x v tomto kole“. At the showdown the number must not jump or animate twice, because it is already at the final value; the reveal can still celebrate the change. The board screen ranks by `Vnow`. Walls never appear on the projector.

## 6. Wall UI component (`public/wall.js` + `public/wall.css`)

A standalone component used by both `/play` and `/dealer`. Load it with `<link rel="stylesheet" href="/wall.css">` and `<script src="/wall.js"></script>`.
```
const w = window.MupWall.mount(containerEl, {
  role: 'student' | 'dealer',
  teams: [{ id, name, color }],      // dealer only: for the composer target and the overview
  team: '<teamId>' | 'all',           // which wall to show (dealer can switch with w.setTeam(id))
  api: {                              // all return Promises; the component never calls fetch itself
    list(team),                       // → stickers array (student: own team; dealer: team id), or { walls } for 'all'
    post({ team?, all?, kind, text }), reply({ team?, id, text }), done({ team?, id, done }), del({ team?, id, reply? }),
  },
  canSendAll: true|false,             // dealer: show „Poslat všem týmům“ (tasks only)
  pollMs: 4000,                        // component polls list() while visible (document.visibilityState) and mounted
});
w.refresh(); w.setTeam(id); w.destroy();
```
**Look:** M4brain post-its.
- Paper `#fbf0b0` (dark `#e2d48a`) for questions, mint `#cfeccf` (dark `#9fcf9f`) for tasks. Ink `#073034`, muted ink `#5c5220`, border `#9a8420`.
- `border-radius: 3px`, a soft shadow, a folded bottom-right corner (`clip-path` triangle in the edge colour at 50 %), and a tilt of ±3–10° from a hash of the id. Only the paper turns; the text stays upright.
- A small kind chip „Otázka“ / „Úkol“, and an „MUP“ badge on dealer stickers. A done task has struck-through muted ink.
- A responsive grid of square-ish notes: 2 columns at 360 px, more on wider screens.
- The preview is clamped to about 5 lines. **Tap to expand**: a modal or sheet with the full text, the replies thread, a reply box, the done checkbox for tasks, and delete (for the author or dealer, with a confirm).
- Composer: segmented control **Otázka | Úkol** first, then the textarea (counter /500), then the send button. Optimistic insert, and errors shown inline.
- It must work at 360×640 and on a 1440 px laptop, in light and dark (`prefers-color-scheme`), with no external dependencies.

## 7. Tests

- New suites `tests/v3-demand.mjs` (the math on known slips, including the exact Block 1 numbers from the spec, rebalance blocks, clamping, demand off = v2 behaviour, live = final, conservation) and `tests/v3-wall.mjs` (privacy between teams, the student and dealer ops, send-to-all, ghosts, concurrent replies, limits, dump/restore, Redis flush).
- Existing suites that assert fixed-price v2 numbers either switch `demand` off at their start (`features { set: { demand: false } }`) or get their expectations updated. The §11 invariants of V2-SPEC must hold with `demand` on.
- `tests/run-all.sh -m all -A` must be all green, plus `a-perf` (no extra commands per GET).
- The real production state must still migrate. Restore the production-shaped dump (19 slips in Block 1, showdown pending) and run the showdown: the valuations must match §1 (Zdravotní pomůcky ≈ 11.94M, Billi ≈ 10.00M, Seeto ≈ 3.20M, Zdravotní přehled ≈ 2.52M, AssetLink ≈ 1.74M, Vestity ≈ 0.82M) and the portfolios must range from about 0.76M to 1.79M.

## 8. Quiz: streak bonus and auto-advance

These are implemented on the `v3-quiz` branch. The base score stays as in V2 §10b. A streak bonus `min(250, 50 × (streak − 1))` is added; a wrong or missing answer resets the streak. A dealer op `quizAdvance { seq, auto? }` steps through lobby → question → reveal → board → next question / `done`. `public/quiz-auto.js` adds a „Další ▶“ button (`#qzadvance`) and an „Automaticky“ checkbox (`#qzauto`) to the Kvíz tab.

## 9. Lost PIN: login QR (dealer → student)

- The dealer op `loginLink { sid }` creates a **one-time token** for that player: 16 random bytes in base64url. Only its hash is stored, as `p.lt = { h, exp }`, valid for 10 minutes. A new link replaces the previous one. The op returns `{ ok, url: '/play#login=<sid>:<token>', exp }`. Ghosts are allowed.
- The student op `tokenLogin { sid, token }` checks the hash and the expiry, then deletes `p.lt` (one use only). It sets a **new random 4-digit PIN** (`p.pin = pinHash(...)`, as at registration) and returns `{ ok, sid, pin, name, team }`. The phone then stores `mup.sid` / `mup.pin` as at a normal login and shows the new PIN once („Tvůj nový PIN je 4821 – zapamatuj si ho.“). A wrong or expired token returns „Odkaz už neplatí. Požádej o nový.“ and gets the same rate limiting as PIN tries, if any exists.
- The `resetPin` op stays as it is, as a fallback.

## 10. Dealer preview of the student view (`/play?as=<sid>`)

- Server: a dealer `GET /api/game?as=<sid>` (with `x-dealer`) returns the normal GET, with `me` = `meState` for that player exactly as their phone sees it, plus `asDealer: true`. Under `?view=wall`, a dealer `as=<sid>` returns that player's team wall with the student-shaped fields (`mine` computed for that player). This is read-only: there is no write access as a student.
- Phone: `/play?as=<sid>` reads the dealer password from `localStorage['mup.dealer']`. It must never read or write `mup.sid` / `mup.pin`, so the device's own student login stays untouched. It renders the full student UI read-only: a sticky banner „Náhled: <jméno> (<tým>) – jen pro čtení“ with a „Zavřít“ button, inputs and buttons disabled, and posts blocked on the client. Without a dealer password it shows a short note with a link to `/dealer`.
- Admin: in the Hráči tab, add per-player „Náhled“ (opens `/play?as=<sid>` in a new tab) and „QR“ buttons. „QR“ calls `loginLink`, then shows a modal with a large QR code (`/vendor/qrcode.js`, as on the table) of the absolute URL, the URL as text with a copy button, and a countdown to expiry. Do the same in the Nástěnky / Startupy team views: „Náhled týmu“ previews the first non-ghost member.

## 11. Student view on a laptop

`/play` must work well on a laptop, 1280×800 and larger, not only as a phone column:
- From 1024 px, the bottom tab bar becomes a left sidebar (the same `[data-nav]` buttons).
- Content gets a wider max width (about 1100 px), with two columns where it helps: Startupy cards in a grid, the Tým header and chart next to Investoři, a wide sticker wall, and Portfolio with the chart next to the stakes.
- The invest dock and form stay usable with a mouse and keyboard. The quiz tiles become a 2×2 grid at a comfortable size.
- The phone layout below 1024 px stays unchanged.
