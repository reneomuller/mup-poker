# v2 handoff (5 Nov 2026, 01:55)

Read `docs/V2-SPEC.md` first. It is the contract every part was built against.

## Where things are

| Branch | What | State |
|---|---|---|
| `v2-int` | **Everything merged, plus integration fixes. Deploy this.** | All API suites pass in memory, Postgres and Redis+Postgres modes |
| `v2-server` | API: 10 features, flags, archive, data view, quiz, points | done |
| `v2-phone` | Student app (`/play`) in the stand design | done |
| `v2-table` | Projector (`/table`) | done |
| `v2-admin` | Admin (`/dealer`, `/cms`) | done |
| `v2-qa` | Independent tests + `tests/run-all.sh` | done |
| `v2-base` | Spec, stand design system, fonts | base of all branches |

Each branch on GitHub carries one extra top commit that turns off Vercel preview deploys for `v2-*` branches. A preview would otherwise run v2 code against the production database. That commit is harmless on `main`.

Production (`main`, mup-poker.vercel.app) is still on the old code. Block 1 is `closed` there, with 19 players and 19 investments, and **the showdown has not run yet**.

## Run it locally

```
git fetch origin && git checkout -B v2-int origin/v2-int && npm install
PORT=3000 node dev-server.js          # /play  /table  /dealer  /cms
```
Without database env vars the game lives in memory, and a restart gives a fresh game. Dealer calls need the header `x-dealer: mup-dealer`; the dealer is currently open without a password.

## Tests

```
bash tests/run-all.sh -n 3                    # API, in memory, 3 runs on fresh servers
bash tests/run-all.sh -n 1 -U                 # UI (Playwright): pip install playwright && playwright install chromium
bash tests/run-all.sh -n 1 -m all -A          # API in mem + Postgres + Redis-mock+Postgres
for t in tests/a-*.mjs; do echo $t; done      # agent A's own suites (BASE=http://localhost:PORT/api/game node <file>)
```
Postgres mode expects a local Postgres with user `postgres`, password `pw` and database `mup_e`. With Docker:
`docker run -d --name mup-pg -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:16 && sleep 3 && docker exec mup-pg createdb -U postgres mup_e`

Last results on `v2-int`:
- **API** (4560f44): every suite passes in all 3 modes. That's 1,169 checks in memory mode (more in Redis mode), including a 511-check full five-block game, migration from the old server, and 18 concurrent students.
- **UI** (f24996c): phone 31, table 97, admin 59 and old-clients 79 checks, all passing in 3/3 runs. The fixes after that commit were server-only.

## Deploy

1. `git checkout main && git pull && git merge --no-ff origin/v2-int && git push origin main`. Vercel deploys `main` automatically.
2. Check: `https://mup-poker.vercel.app/api/game` should show `"storage":"redis+postgres"`, `"block":1`, `"phase":"closed"`, `"betCount":19` and a `features` object.
3. Open `/dealer`, go to **Data**, and confirm the **„Stav před v2“** archive is pinned at the top. It holds Block 1's notes, reasons and question board.
4. Open `/table` and `/play` on a phone. Everyone stays logged in, and the old localStorage keys are unchanged.

**Rollback:** in Vercel, open Deployments, pick the previous production deployment and choose Instant Rollback. The data stays. Old code reading v2-written data was **not** tested in that direction, so treat rollback as a last resort.

## In class

- Admin top bar: the main button follows the game. With today's state it reads **„Showdown třídy“**. Press it, skip smart money (RJ didn't invest), then press **Další blok**.
- Features that are on by default: cap table, startup cards, valuation drivers, track record, quiz, points. Off by default: priced rounds, market cards, RJ tranches, exit. Switch them in **Funkce**.
- The quiz set „Blok 2 – slovník“ (15 questions) is preloaded. Start it in **Kvíz**. Show **Žebříček** before **Ukončit**, because the projector hides the quiz once it ends.
- To lock the dealer, set `DEALER_LOCK=1` and `DEALER_PASSWORD` in Vercel and redeploy. Don't do this right before class unless everyone knows the password.

## Known, not blocking

- Tranches need room in the RJ fund. Turn them on before RJ's first investment.
- The pitch order is remembered per laptop.
- With 5 or more pinned notes, the clouds can overlap the plates on the projector.
- A revalue driver shows the reason label, not the private `why` text, to keep team messages private.
- `quizEnd` on a finished quiz moves it to `idle`.

Agent reports and decisions are summarised in the commit messages on each branch.
