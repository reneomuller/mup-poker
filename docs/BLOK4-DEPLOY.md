# Blok 4 (Thu 19 Nov 2026, 9:00) — deploy and production setup

Branch `blok4-simple` (local commits only, based on `origin/main` de5b39f). It adds:

- **7th team PLUGG** (dealer op `teamAdd`; a 7-seat projector layout; colour `#2EC4C9`).
- **Invest-only mode** (feature `simple`, preset `investOnly`). `/play` shows login → split up to $1M → confirm (no tabs, notes or reasons; the unallocated rest stays cash). Demand pricing is off.
- **New round** (dealer op `newRound`). The open block-1 investments are handed back without a showdown. Everyone starts with $1M again, the game goes to block 2 lobby, an archive is saved first and a summary is kept in `meta.voided`. The block-1 slips stay stored in `slip:1`.
- **Minule → Dnes** on `/table`. Each plate shows "Minule X" and a ▲/▼ % chip, and the board screen becomes a Minule → Dnes table (dealer: Plátno → Žebříček, or the button in the Blok 4 card).
- **PIN fallback** (feature `pinFallback`). On `/play`, „Zapomněli jste PIN?“ takes name + team, fuzzy-matches the team („plug“ → „Myslíte PLUGG?“) and optionally an existing player („Jsi Eliška Kučerová?“). The student then gets a new PIN from the server and is recorded as **unverified** (raw typed name/team + time). The list and CSV export are under Dealer → Hráči → „Přihlášení bez PINu“.

Everything below uses `B=https://mup-poker.vercel.app/api/game`. Production's dealer is open (no `DEALER_LOCK`), so any `x-dealer` value works. The code checks `x-dealer` only when `DEALER_LOCK=1` (then it must equal `DEALER_PASSWORD`). `view=data` needs the header to be present. Use `-H 'x-dealer: mup-dealer'` everywhere.

```bash
B=https://mup-poker.vercel.app/api/game
X='x-dealer: mup-dealer'
op() { curl -s -H 'content-type: application/json' -H "$X" -d "$1" "$B" | python3 -c "import json,sys; d=json.load(sys.stdin); d.pop('dump',None); print(json.dumps(d,ensure_ascii=False)[:600])"; }
```
(Every successful dealer POST also returns a full `dump` with student data; the helper drops it. Don't paste it anywhere.)

## (a) Production backup (GET only, before anything else)

```bash
TS=$(date +%Y%m%d-%H%M); mkdir -p ~/mup-poker-backups
curl -s -H "$X" "$B?view=dealer&dump=1&all=1" -o ~/mup-poker-backups/blok4-$TS-dealer-dump.json   # full state: meta, players (PIN hashes), slips, content, board, tx, walls
curl -s -H "$X" "$B?view=log&limit=5000"       -o ~/mup-poker-backups/blok4-$TS-action-log.json  # action log (no PINs)
curl -s -H "$X" "$B?view=archives"             -o ~/mup-poker-backups/blok4-$TS-archives.json    # archive index
python3 -c "import json;d=json.load(open('$HOME/mup-poker-backups/blok4-$TS-dealer-dump.json'));m=d['dealer']['dump']['meta'];print(m['block'],m['phase'],m['rev'],len(d['dealer']['dump']['players']),len(d['dealer']['all']['1']))"
# expect: 1 closed <rev≈67> 21 20   (21 players incl. the dealer's ghost; 20 block-1 slips = 19 sent + 1 notes-only)
```
These files hold real student data. Never commit them (the repo is public).

## (b) Push / merge to main

```bash
cd ~/mup-poker && git fetch origin
git log --oneline -1 origin/main            # must still be de5b39f; if not, read the new commits / docs/HANDOFF.md first
cd ~/mup-poker/.worktrees/deploy-main       # worktree on main (at de5b39f)
git pull --ff-only origin main
git merge --ff-only blok4-simple            # fast-forward, no merge commit
git push origin main                        # push ONLY main; never push blok4-simple (a preview would hit the production DB; vercel.json now also disables blok4-* previews)
```

## (c) Wait for Vercel "Ready" and check the new build is live (GET only)

Vercel → Deployments → the new production deployment for the pushed commit → Ready. Then:
```bash
curl -s "$B" | python3 -c "import json,sys; f=json.load(sys.stdin)['features']; print('simple' in f, 'pinFallback' in f)"   # True True = new API code
curl -s https://mup-poker.vercel.app/table | grep -c mvscreen                                                            # 1 = new table
curl -s https://mup-poker.vercel.app/play.js | grep -c "op: 'fallback'"                                                   # 2 = new phone app
```
Right after "Ready", a request can still land on the previous deployment (lesson from 5 Nov). Run the checks 3× a few seconds apart. Before the admin ops, all three must say "new". The old code answers `newRound` / `teamAdd` with „Neznámá akce.“, which is harmless. It answers `features {preset}` with **ok but no change**, so always verify each op with the GET in (e).

## (d) Admin ops — in this order

All are `POST $B` with headers `content-type: application/json` and `x-dealer: mup-dealer`. The dealer UI (Hra → card „Blok 4 · jednoduché kolo“) has buttons for steps 1–3 in the same order.

| # | What | Body | Undo |
|---|------|------|------|
| 1 | **New round**: hand back the 19 open block-1 investments, everyone $1M, block 2 lobby, archive first | `{"op":"newRound","confirm":"NOVE KOLO","prev":"shown","label":"Blok 4 · investiční kolo"}` | `{"op":"undo"}` (back to block 1 closed with the 19 slips; undo is LIFO, so undo later backup ops first) |
| 2 | **PLUGG = t7** at $1M (+ card text) | `{"op":"teamAdd","id":"t7","name":"PLUGG","oneLiner":"YOUR GEAR. WHENEVER YOU NEED IT.","sub":"Samoobslužné automaty se sluchátky, kabely, powerbankami a adaptéry na univerzitách, kolejích a v hotelech.","startV":1000000}` | `{"op":"undo"}` (only if it was the last backup op; the card text stays in `tx`, harmless) |
| 3 | **Invest-only + demand off + PIN fallback on** | `{"op":"features","preset":"investOnly"}` | `{"op":"features","preset":"restore"}` (switches back exactly what was on before) |
| 4 | Registration open (it already is) | `{"op":"reg","open":true}` | `{"op":"reg","open":false}` |

Run step 1 **before** step 3. `prev:"shown"` stores, as „Minule“, what the projector shows right now: the October projection with demand ON. That is Seeto 3.20M, Zdravotni Prehled 2.52M, Vestity 0.82M, AssetLink 1.74M, Billi 10.00M and Zdravotni Pomucky 11.94M, plus PLUGG 1.00M. **Owner decision:** use `"prev":"base"` instead to compare with the official valuations (all 1.00M, since the block-1 showdown never ran). „Minule“ can be changed at any time, even after the showdown, without touching money: `{"op":"movementPrev","prev":"base"}` (all = current settled valuations, i.e. 1.00M before today's showdown), or a map `{"op":"movementPrev","prev":{"t1":3195284,"t2":2522179,"t3":822979,"t4":1740000,"t5":10001842,"t6":11942811,"t7":1000000}}` (the October projection, exact). You can also edit the fields in the Blok 4 card → „Uložit Minule“.

Optional (owner's choice, any time, no money effect): team names with diacritics, `{"op":"teams","teams":[{"id":"t2","name":"Zdravotní přehled"},{"id":"t6","name":"Zdravotní pomůcky"}]}`. The fuzzy matching works either way.

**In class** (dealer UI top button follows these steps in invest-only mode; no pitches or smart money):
- open investing `{"op":"phase","phase":"betting","minutes":0}`
- close `{"op":"phase","phase":"closed"}`
- showdown `{"op":"showdown"}` (undo: `{"op":"undo"}`)
- Minule → Dnes table on the projector `{"op":"screen","screen":"board"}`, back with `{"op":"screen","screen":"table"}`

With demand off, each team ends at 1M + money in, and each investor's portfolio equals what they invested (plus their cash).

**After class:** Dealer → Hráči → „Přihlášení bez PINu“ (typed name/team, matched team, existing/new, time, amount invested, „Ověřit“) → Export CSV. API: `GET $B?view=dealer` → `dealer.rows[]` with `unverified` (`rawName`, `rawTeam`, `teamId`, `matched`, `first`, `last`, `events[]`, `checked`). Mark one as checked: `{"op":"unverifiedMark","sid":"<id>","checked":true}`. Fix a wrong team: `{"op":"movePlayer","sid":"<id>","team":"t5"}`. A student whose name matched an existing player received a new PIN, so the old PIN no longer works for them. If that was someone else, the real student can use the fallback again, and the dealer sees both events.

## (e) Verification checklist (GET only)

After the deploy (c) and after the ops (d):
```bash
curl -s "$B" | python3 -c "
import json,sys; d=json.load(sys.stdin); f=d['features']; m=d.get('movement') or {}
print('block', d['block'], 'phase', d['phase'], 'bets', d['betCount'], 'holdings', d['anyHoldings'])     # 2 lobby 0 False
print('teams', len(d['teams']), [ (t['id'], t['name'], t['V']) for t in d['teams'] if t['id']=='t7'])      # 7 [('t7','PLUGG',1000000)]
print('simple', f['simple'], 'pinFallback', f['pinFallback'], 'demand', f['demand'], 'quiz', f['quiz'], 'tape', f['tape'])  # True True False False False
print('movement', m.get('label'), m.get('prevFrom'), {k:v['prev'] for k,v in (m.get('teams') or {}).items()})
"
curl -s -H "$X" "$B?view=dealer" | python3 -c "import json,sys; D=json.load(sys.stdin)['dealer']; v=D['voided'][-1]; print(v['open'], v['openTotal'], v['archiveId'], bool(D['featuresBefore']))"   # 19 19000000 <id> True
curl -s -H "$X" "$B?view=archives" | python3 -c "import json,sys; print([a['label'] for a in json.load(sys.stdin)['archives']][:3])"   # „Před novým kolem (blok 1, investice vráceny)“ on top
curl -s -H "$X" "$B?view=dealer&all=1" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['dealer']['all']['1']))"   # 20 (October slips kept: 19 sent + 1 notes-only)
```
- `/table` on the projector at 1920×1080 shows 7 plates (PLUGG bottom centre), the kicker „BLOK 4 · INVESTIČNÍ KOLO“ and „Minule …“ under each value. The ▲/▼ chips appear once investing opens.
- `/play` on a phone: the login card has „Zapomněli jste PIN?“. A logged-in student sees one screen: „Máš 1 000 000 $“ (lobby), then „Rozděl až 1 000 000 $“ when investing opens.
- `/dealer` → Hra: the Blok 4 card shows step 1 „Hotovo“, step 2 with 7 teams, and step 3 with „Vrátit původní funkce“. The top button shows „Otevřít investování“.

## Rollback

Vercel → Deployments → previous production deployment (de5b39f) → Instant Rollback. The data stays. The old code ignores `movement`, `voided`, `featuresBefore` and the `simple`/`pinFallback` flags. Block 2 then runs with the old exact-$1M rule. PLUGG (t7) still works, but the old table has no CSS for a 7th seat (it would sit unstyled). Undo the ops first if you need the October state back (`undo` ×N, then `features preset restore`).

## Rehearsal on a copy of production (done 19 Nov ~02:30, local memory server, dump deleted afterwards)

The production dealer dump (GET) was restored into a local in-memory server, and steps 1–3 were run there. The projection matched the numbers above to the dollar. 19 open slips ($19M) were handed back and block 2 started in the lobby with 7 teams. „Minule“ = the October projection with PLUGG at 1.00M. The block-1 slips were kept. A real student name typed in lowercase with a 6-letter team prefix matched the right team and player. A flexible 400k investment went through, and the showdown with demand off moved that team by exactly +400k. Then `undo` ×3 + `preset restore` returned the exact October state (block 1 closed, 19 bets, 6 teams, demand on).

## Tests (local, memory storage)

- `BASE=http://localhost:<port>/api/game node tests/v5-blok4.mjs` on a fresh `PORT=<port> node dev-server.js` gives 77 checks: fuzzy matching, flexible split, newRound, teamAdd, preset, the fallback flows, unverified list, showdown with demand off, Minule → Dnes, movementPrev and undo ×3 back to the October state.
- `bash tests/run-all.sh -n 1 -m mem -A` runs all API suites in memory mode (v5 included).
- A puppeteer drive of the whole flow (dealer card → 3 phones: PIN, name+team existing „zdravotni prehled“, name+team new „plug“ → close → showdown → Minule → Dnes) was run against a local server; it produced no page errors.
