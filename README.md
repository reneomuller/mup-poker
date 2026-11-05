# Investiční stůl · RainbowJet × MUP

A poker-table investment game for the MUP course. Every student gets $1M to invest in the other teams. RainbowJet adds $10M of smart money, and the projector shows the money landing on the table.

| Page | Who | What |
| --- | --- | --- |
| `/play` | students (phones) | register, invest, write reasons and notes |
| `/table` | projector | poker table, pot, showdown, smart money, leaderboard |
| `/dealer` | RainbowJet | run the phases, enter smart money, revalue teams, export |

## Rules the game enforces

- Never into your own team. Reasons are optional and can be added or edited after submitting.
- First round (Block 1, or a student's first time): invest exactly $1M. Nothing can be taken out.
- From Block 2: take out up to $300k per block and reinvest all of it the same block (or change nothing).
- RainbowJet: $10M in Block 1, then up to 30 % of the fund per block. Hidden until "Odhalit smart money".
- Stakes, not votes: money buys a share at the team's current valuation (all start at $1M by default; change it in Dealer → Týmy → Výchozí ocenění before anyone has invested). Revaluing a team moves every investor's stake.

## Deploy on Vercel

1. vercel.com → **Add New… → Project** → import `reneomuller/mup-poker` → **Deploy** (no settings needed).
2. In the project: **Storage → Create Database → Upstash for Redis** (free plan) → **Connect** to this project.
3. **Deployments → ⋯ → Redeploy**, so the database is picked up.
4. Open `/dealer` and check there's no "Chybí databáze" warning.

The dealer screen is open (no password) for testing. To lock it: **Settings → Environment Variables** → `DEALER_LOCK` = `1` and `DEALER_PASSWORD` = your password → Redeploy.

## Before class

1. `/dealer` → **Týmy**: type the six startup names → Uložit.
2. Rehearse once with 2–3 phones, then **Nová hra** (keeps players) or **Smazat vše**.
3. Projector: open `/table`, press **F** for fullscreen. **B** toggles the leaderboard locally.

## In class (Block 1)

Lobby (QR on the table) → students join on `/play` → Spustit pitch per team → Otevřít sázky → Zavřít sázky → Showdown třídy → enter smart money in the dealer screen (any time before) → Odhalit smart money → discussion.

Between blocks: **Přecenit** in the dealer screen (twice a week), then **Další blok →** at the start of the next session.
Mistake? **Vrátit poslední krok** undoes the last showdown, reveal, revaluation or block change.

## Local preview

```
npm install
npm run dev   # http://localhost:3000, in-memory data
```

## API (v2)

One endpoint, `/api/game`. `GET` = state (`?view=dealer`, `?view=log`, `?view=archives`, `?view=archive&id=…`, `?view=data` for the dealer). `POST { op, … }` = action; students send `sid` + `pin`. The contract is `docs/V2-SPEC.md`; implementation notes:

- New state lives in `meta` (`features`, `cards[t].milestones`, `milestoneDefs`, `drivers`, `rounds`, `market`, `tranches`, `rjPrincipal`, `lots`, `awards`, `quizSets`, `quiz`, `quizLog`, `points`, `exit`, `v2ArchivedAt`); older states get defaults on read (`api/_lib/features.js` → `normalize`). The first load of an old game saves an archive „Stav před v2“ (gid and rev are kept).
- Student-written data never goes through `meta`: card texts and round terms are fields of hash `tx` (`card:<team>`, `rt:<block>:<team>`), quiz answers are one small hash per question `qa:<runId>:<idx>` (field = sid, written once with HSETNX). A GET reads at most two extra keys: `tx`, and that question's answers only while a question is open or revealed.
- Archives: hash `arch` (full objects) + hash `archi` (index for `?view=archives`). Auto archives before Další blok, Nová hra, exit, Vyčistit tabuli.
- Student ops: `quizAnswer { choice, idx? }`, `card { oneLiner, sub }`, `roundTerms { pre }`. Dealer ops: `features`, `archive`, `archiveDelete`, `clearBoard`, `card`, `milestoneDefs`, `roundTerms`, `quizSave`, `quizDelete`, `quizStart`, `quizNext`, `quizReveal`, `quizBoard`, `quizEnd` (second press → `idle`), `pointsAdd`, `pointsRemove`, `award`, `awardRemove`, `marketCard`, `trancheAdd`, `trancheRelease`, `trancheCancel`, `exitSet`; `revalue` takes optional `reason`.
- `?view=dealer` adds `dealer.quizSets` (with correct answers), `dealer.quiz` (run state + current question + who answered), `dealer.points` (ledger), `dealer.awards`, `dealer.rounds`, `dealer.roundTerms`, `dealer.rjFund`, `dealer.tranches`, `dealer.exit`.
- `undo` reverts the game (money, valuations, phase, drivers, lots, market, tranches, exit) and keeps quiz, points, awards, cards and flags.
- Tests: `tests/a-*.mjs` (server), run each against a fresh server: `BASE=http://localhost:3101/api/game node tests/a-quiz.mjs`.
