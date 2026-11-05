# v4 overview — overnight ideas (5 Nov 2026), NOT merged into main

`v4-ideas` = v3 (everything on `main`, including the overnight audit and security fixes) + eight feature lanes + a second-pass review that fixed 25 cross-feature issues. Every feature has a switch in **Funkce** (`FEATURE_DEFAULTS` in `api/_lib/features.js`, all on). With a switch off, that part behaves exactly as in v3. The brief and rules are in `docs/V4-IDEAS.md`; the readable overview for the owner is the Claude Doc „MUP poker – overnight overview (5 Nov)“.

Try it locally (memory store, nothing touches production):
```
cd ~/mup-poker/.worktrees/v4-ideas && PORT=3000 node dev-server.js
# /play  /table  /dealer  /cms  /report.html  /sound-demo.html  /wall-demo.html
```

| Flag | What | Why | How (main files) |
|---|---|---|---|
| `startupPage` | Startup detail sheet on the phone (live value, chart, numbers, card, drivers, „Proč investovali“, „Investovat sem“) | Due diligence like a trading app | `public/play-startup.*`, `api/_lib/startup-view.js` (`GET ?view=startup`; named reasons only for settled blocks) |
| `quizplus` | `why` explanations (written for the 15 Blok 2 questions), ×2 questions, podium finale, 2/3-answer layouts, image per question, results export + CSV, lobby „Připraveno“ | The quiz teaches and has an ending | `api/_lib/quizplus.js`, `public/play-quizplus.*`, `public/dealer-quizplus.js`, `table-quiz.js` |
| `wallplus` | Reactions, pins, accepted answer, task due + assignee + overdue, send-to-all questions, „Rozesláno všem“, templates, filters, unread dots | Walls useful in class | `api/_lib/wall.js` (one hash field per writer; tombstones), `public/wall.*` (MupWall v2, backward compatible) |
| `recap` | End-of-game „Wrapped“ story cards + share PNG; printable class report `/report.html` + CSV | Memorable ending, teaching record | `api/_lib/recap.js` (`?view=recap` own / `?view=report` dealer), `public/play-recap.*`, `public/report.*`; the showdown records `meta.px` |
| `regie` | Run-of-show checklist + „Další krok ▶“, class health (not invested, online, dropped), nudges, shortcuts, named undo | Running a 90-min class while presenting | `public/dealer-regie.*`, `api/_lib/presence.js` (heartbeat every 30 s while visible); action log in `meta.regieLog` (0 extra commands) |
| `sound` | Original quiz-show soundtrack on the projector (no Kahoot or other known melody), slightly wonky | Fun | `public/sound.js` (WebAudio synth), `public/table-sound.js` (🔊 button), `/sound-demo.html`. Phones are silent |
| `guard` | PIN brute-force limits (8 per student / 200 per IP per 10 min; QR or PIN reset unlocks), phone offline banner + retry queue, request dedupe | Flaky school Wi-Fi; 4-digit PINs | `api/_lib/guard.js` (`MUP_GUARD_MAX`, `MUP_GUARD_IP_MAX`, `MUP_GUARD_WINDOW_S`), `public/play-net.js`. Only failed attempts cost Redis commands |
| `tape`, `tapeNames` | Market ticker of trades on the projector, „Burza uzavřena“ banner, board sparklines; also cloud layout and readability fixes (not flagged) | Stock-market feel | `api/_lib/tape.js` (from slips the GET already reads), `public/table-tape.*`; names `initials` (default) / `first` / `off` |

## Verification (04:30)
- API suites in memory, Postgres and Redis + Postgres, the UI suites (Playwright), `a-perf` (0 extra Redis commands per GET), a-quiz, a-econ and a-flags: see the overview doc for the last numbers. A fresh reviewer used every feature in a browser at phone, laptop and projector sizes and fixed 25 issues (`review:` commits).
- Known minor items: repeated Režie reminders post duplicate tasks; `/report.html` uses „M $ / k $“ where the app uses „mil. $ / tis. $“; a one-point „Moje pozice“ chart is a lone dot; a wall reaction someone took back can reappear after a restore.
