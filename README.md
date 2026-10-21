# Investiční stůl · RainbowJet × MUP

A poker-table investment game for the MUP course. Every student gets $1M to invest in the other teams. RainbowJet adds $10M of smart money, and the projector shows the money landing on the table.

| Page | Who | What |
| --- | --- | --- |
| `/play` | students (phones) | register, invest, write reasons and notes |
| `/table` | projector | poker table, pot, showdown, smart money, leaderboard |
| `/dealer` | RainbowJet | run the phases, enter smart money, revalue teams, export |

## Rules the game enforces

- Never into your own team; every investment needs a reason.
- First round (Block 1, or a student's first time): invest exactly $1M. Nothing can be taken out.
- From Block 2: take out up to $300k per block and reinvest all of it the same block (or change nothing).
- RainbowJet: $10M in Block 1, then up to 30 % of the fund per block. Hidden until "Odhalit smart money".
- Stakes, not votes: money buys a share at the team's current valuation (all start at $10M). Revaluing a team moves every investor's stake.

## Deploy on Vercel

1. vercel.com → **Add New… → Project** → import `reneomuller/mup-poker` → **Deploy** (no settings needed).
2. In the project: **Storage → Create Database → Upstash for Redis** (free plan) → **Connect** to this project.
3. **Settings → Environment Variables** → add `DEALER_PASSWORD` = your dealer password.
4. **Deployments → ⋯ → Redeploy**, so the database and password are picked up.
5. Open `/dealer`, log in, and check there's no red warning at the top.

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
npm run dev   # http://localhost:3000, in-memory data, dealer password "mup-dealer"
```
