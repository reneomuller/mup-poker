# v3 handoff (5 Nov 2026, 04:00)

Read `docs/V3-SPEC.md` (on top of `docs/V2-SPEC.md`). `main` = v3 plus the overnight audit and security fixes. Production ran v2 until this is pushed.

## What v3 adds
- Demand pricing (`demand`): after a block, price × (money in ÷ average per startup), clamped to ×0.1–×10. Rebalance blocks use 1 + net ÷ average inflow. Live during investing: the projected number equals the post-showdown number.
- Tým tab (was Profil): live stats and named investors with reasons.
- Private team sticker walls (`wall`). Wall writes never rewrite `meta`: the badge counter is `tx` field `wr:<team>`.
- Quiz: Kahoot base score plus a streak bonus of +50 per correct answer in a row, max +250. `quizAdvance`, with `public/quiz-auto.js` for the „Další ▶“ / Automaticky buttons.
- Login QR for lost PINs (`loginLink` / `tokenLogin`), dealer preview `/play?as=<sid>`, laptop layout for `/play`.
- Security: client keys can never resolve to Object.prototype (`api/_lib/safe.js`). Student `restore` only brings back slips the server lost and checks them like submit. The wall/data views need the dealer header.

## Tests
- `bash tests/run-all.sh -m all -n 1 -A` (needs local Postgres `mup_e`, see below). Last run on `main`: 57 suite runs, 4399 checks, all green.
- UI (Playwright, Python): `pip install playwright && playwright install chromium`, then `bash tests/run-all.sh -U -n 1`. Last run: admin 59, oldclients 79, phone 31, quiz 18, table 97, v3 60, all green.
- `OLD_DIR=<a v2-base checkout> node tests/a-perf.mjs` checks the Redis commands per GET. Make sure nothing else listens on :8098/:8099 first.
- An upgrade from v2 production data was simulated (v2 code on Redis+Postgres, then v3 on the same storage): state intact, live values correct, showdown with 19 slips.

## In class (new)
- The plates show live demand values during investing. **Showdown třídy** locks them in, so the numbers don't jump.
- From Block 2, save RJ's sales only after the showdown, because repricing can make an earlier split invalid.
- Small rebalance blocks can give extreme multiples (e.g. ×0,14). That's the formula as specified.
- With „Automaticky“ ticked in ANY open admin tab, the quiz reveals by itself. Tick it in one tab only.
- To roll back a mistake, use ↶ undo. Dealer `restore` only fills in data the server lost; an older backup leaves the state as it is (`restored: false`).
- The dealer is open (no password) by the owner's choice. Lock it with `DEALER_LOCK=1` + `DEALER_PASSWORD` in Vercel, then redeploy.

## Not in main
Branch `v4-ideas` holds the overnight improvements (`docs/V4-IDEAS.md`, `docs/V4-OVERVIEW.md`). It is for review and not merged.

---

# Earlier: v2 handoff (5 Nov 2026, 01:55)

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
