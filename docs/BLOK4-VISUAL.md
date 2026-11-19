# Blok 4 — hyper-real look for /table and /play (19 Nov 2026)

Branch `blok4-visual` (local only, based on `origin/main` d2d22b6). It touches only the visual layer. It doesn't change the API, data, rules, flows, or any element ID or class that JS uses.

## What changed

| File | Change |
|------|--------|
| `public/table-real.css` (new, 16 KB) | The material layer for the projector. `table.html` loads it last. |
| `public/play-real.css` (new, 8 KB) | The material layer for phones. `play.html` loads it last. |
| `public/img/real/{felt,wood,leather,paper}.webp` (new, 40 KB total) | Procedural, seamless texture tiles with no photos. Regenerate them with `python3 tools/gen-textures.py` (seeded). |
| `tools/gen-textures.py` (new) | The texture generator (numpy + Pillow). Nothing serves it. |
| `public/table.html` | One `<link>` to `/table-real.css`. |
| `public/play.html` | One `<link>` to `/play-real.css`. `theme-color` is now walnut `#20120a` (was navy). |

**/table (projector)**
- **Room:** a warm overhead lamp lights the table, and the room falls off into a dark vignette. The vignette sits above the table and below the cards, plates and text.
- **Table:** tilted back by 11° (`perspective` on `.tbl` only). The plates, chips, cards and pot are separate layers, so the 7-seat layout is unchanged. It casts a layered drop shadow on the floor.
- **Rail:** walnut grain with lacquer highlights (lit from above on the far side, darker on the near side), then a leather welt and a polished brass bead before the felt.
- **Felt:** baize fabric tile (overlay blend) under a lamp hotspot, with darker edges and the rail's shadow on the felt. The betting line is printed in gold ink as a double rule.
- **Placards:** brass bevel frame, smoked-glass face over leather grain, four brass screws, an enamel team-colour inlay, engraved name and ivory numbers. Contact shadow plus ambient shadow. The rank chip and the Minule → Dnes ▲/▼ chips are enamel badges at the same size and font, with slightly higher contrast. The showdown deltas are enamel pills.
- **Chips:** clay with edge inserts. In a stack they are 3D: an elliptical top face over a striped cylinder edge, with a contact shadow.
- **Cards:** linen-finish stock, oxblood backs with a cream lattice and an inner frame line, and a layered shadow. Face cards have embossed pips.
- **Pot:** ivory certificate slips with a brass rule.
- **Join panel and QR:** brass-framed.
- **Minule → Dnes screen:** brass-framed leather rows on a dark walnut wall under the lamp. The rank #1 is a gold coin. Text sizes are unchanged.
- **Motion** (all one-shot, none continuous):
  - chips settle when added;
  - hole cards are dealt in when the round leaves the lobby;
  - one light sweep crosses a placard when its value pops at the showdown.
  - Everything above is off under `prefers-reduced-motion` (checked: `animationName: none`).

**/play (phones)**
- The stand tokens are re-pointed to the table's materials:
  - **Page:** felt background.
  - **Cards:** dark leather with a brass hairline.
  - **Header and dock:** walnut with a brass rule.
  - **Labels:** brass.
- **Primary button:** polished brass with dark text (white on brass would not read).
- **Slider:** brass groove, and the thumb is a clay chip in the team colour.
- **Avatar:** a chip in the team colour.
- **Amount fields:** recessed and brass-rimmed. The select keeps its chevron (now brass).
- **Lighter than before:** no `backdrop-filter` blur on the header or dock (solid fills instead), no fixed background, and no new animation.

## Verification (local memory server, copy of production)

- Production was read with **GET only**: `?view=dealer&dump=1&all=1`. The dump was restored into a local memory server (`op: restore`). State: block 2 lobby, 7 teams, invest-only. The dump copy was deleted afterwards.
- Puppeteer drive with 5 local test players: lobby → investing (4 API slips + 1 phone slip typed into the real form and confirmed) → closed → showdown → Minule → Dnes board. Screens:
  - table at 1920×1080, plus 1400×1050 (4:3) and 1366×768;
  - phone at 390×844 @2x;
  - laptop /play at 1280×800;
  - PIN-fallback form ("plug" → „Myslíte PLUGG?“).
  - No page errors. The 7 plates don't overlap, PLUGG is bottom centre, nothing is cut off, and the text is crisp.
- **Tests:** `node tests/v5-blok4.mjs` gives **77/77**. `bash tests/run-all.sh -n 1 -m mem -A` gives all 28 API suites, 0 fail.
- **CPU on /table** (Chrome performance metrics, main thread, with vs without `table-real.css`):

  | Phase | Main-thread task time | Frame rate |
  |-------|-----------------------|------------|
  | Investing open, idle | 7.3 % vs 7.1 % | 60 fps |
  | Showdown reveal | 7.5 % vs 7.7 % | 60 fps |

  The textures are static tiles, and the tilted table is one composited layer.

Screenshots are outside the repo, in `~/Desktop/MUP_Blok4/sandbox/game-visual/shots/`:
- `before/` is d2d22b6, taken with the two `-real.css` files blocked, which is pixel-identical to main.
- `after/` is this branch.
- `compare/` has side-by-side sheets: one per table state, `play-phones.png` (8 phone states) and `play-laptop-1280.png`.

The drive scripts are in `…/game-visual/tools/` (`drive.mjs`, `extra.mjs`, `perf.mjs`).

## Deploy / roll back

- **Deploy:** fast-forward `main` to `blok4-visual` and push `main` only. Static files only, so no API change.
- **Check it is live** (GET): `curl -s https://mup-poker.vercel.app/table | grep -c table-real` must print `1`, and `curl -sI https://mup-poker.vercel.app/img/real/felt.webp` must return 200.
- **Roll back:**
  - Vercel → Deployments → the d2d22b6 production deployment → **Instant Rollback**. Nothing in the data depends on this change.
  - **Partial roll back** (keep one side): remove the `<link rel="stylesheet" href="/table-real.css">` line from `table.html` (or the `/play-real.css` line from `play.html`) and redeploy.
