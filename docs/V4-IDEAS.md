# MUP poker v4 — overnight ideas branch (NOT for main yet)

Production runs v2. **v3** (`docs/V3-SPEC.md`) is finished and tested on local `main`, waiting for the owner to deploy it. v4 is a set of improvements built overnight on top of v3, on branch `v4-ideas`. The owner reviews it in the morning and decides what ships. Everything in V2-SPEC and V3-SPEC still holds.

## Who it's for

~20 university students on phones (and some laptops) in a live 90-minute class, a projector read from the back of the room, and the organisers (MUP + RainbowJet) on `/dealer`. The tone is playful but useful: it teaches startup investing.

## Shared rules for every lane

- Work only in your own worktree and on your own branch (`v4-<lane>`, based on `v4-base`). Never push, never touch `main`, never deploy, never set real DB/Redis env vars.
- **Feature flags:** every new visible feature sits behind a feature flag in `FEATURE_DEFAULTS` (`api/_lib/features.js`). Pick the default sensibly and document it. With the flag off, behaviour is identical to v3.
- **Keep merges clean:** put new logic in NEW files (`api/_lib/<lane>.js`, `public/<area>-<lane>.js|css`) and keep hooks in shared files (`api/game.js`, `play.js`, `dealer.js`, `table.js`, `features.js`, `_e-lib.mjs`, `a-flags.mjs`) to a few lines. List every hook in your report.
- **Cost:** no extra Redis commands on a plain GET (`tests/a-perf.mjs` and the v2-quiz GET-cost check must pass). No new runtime dependencies. Vendor small files only if truly needed.
- **UI:** Czech text („ “ quotes, en dash –, nbsp after single-letter prepositions). Works at 360×640 phone, laptop (1280+) and the 4 projector sizes. Light and dark mode, no horizontal scroll, accessible labels.
- **Tests:** add tests for new server behaviour in `tests/v4-<lane>.mjs` (style of `tests/v3-*.mjs`, `tests/_e-lib.mjs`). Never skipped tests. Run memory mode: `tests/run-all.sh -m mem -n 1 -A -p <your port base>`. Only the integrator runs pg/redis.
- Never commit anything from `~/mup-poker-backups/` (real student data; the repo is public).
- Commit messages: `<lane>: …`, ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Don't commit package-lock.json.
- **Report** (≤ 250 words): what, why, how · flags and defaults · hooks · commits · tests · open issues.

## Lanes

| Lane | Branch | Port base | Owns |
|---|---|---|---|
| sound | v4-sound | 3300 | `public/sound.js` (new), small hooks in table*.js, a dealer toggle |
| recap | v4-recap | 3310 | `api/_lib/recap.js`, `public/play-recap.js/.css`, `public/report.html/.js` |
| startup | v4-startup | 3320 | `public/play-startup.js/.css` (startup detail sheet on the phone) |
| wallplus | v4-wallplus | 3330 | `public/wall.js/.css`, `api/_lib/wall.js`, the walls part of `archive.js` |
| guard | v4-guard | 3340 | `api/_lib/guard.js` (rate limits), `public/play-net.js` (offline/retry), test infra fixes |
| quizplus | v4-quizplus | 3350 | `api/_lib/quiz.js`, `public/table-quiz.js`, the quiz parts of `quiz-auto.js` / the Kvíz editor |
| regie | v4-regie | 3360 | `public/dealer-regie.js/.css`, a presence endpoint in `api/_lib/presence.js` |
| tape | v4-tape | 3370 | the projector: `public/table.js/.css`, `table-screens.css` (market tape, polish) |

The lane briefs are in each agent's prompt. The integrator merges them all into `v4-ideas` and writes `docs/V4-OVERVIEW.md` (what / why / how / how to enable).
