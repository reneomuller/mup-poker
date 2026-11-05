# v3 quiz auto-advance in the admin (docs/V3-SPEC.md §8): two dealer tabs with „Automaticky“ on, the dealer only presses
# „Další ▶“ (#qzadvance) or space; reveal and board happen on their own; no step is ever skipped or doubled.
import threading, time
from playwright.sync_api import sync_playwright
from _ui import ok, warn, info, run, get, post, dealer, fresh, wait_until, Console, no_hscroll, shot, SITE


def main():
    T, S = fresh(3)
    r = dealer('quizSave', set={'id': 'uiq', 'title': 'UI kvíz', 'questions': [
        {'q': 'Otázka jedna', 'a': ['A', 'B', 'C', 'D'], 'correct': 1, 'time': 5},
        {'q': 'Otázka dvě', 'a': ['A', 'B'], 'correct': 0, 'time': 5}]})
    ok(r.get('ok'), 'quizSave short set')
    ok(dealer('quizStart', setId='uiq').get('ok'), 'quizStart (lobby)')
    seen, stop = [], threading.Event()

    def watch():
        while not stop.is_set():
            try:
                q = get().get('quiz') or {}
                k = (q.get('state'), q.get('idx'))
                if not seen or seen[-1] != k:
                    seen.append(k)
            except Exception:
                pass
            time.sleep(0.15)

    th = threading.Thread(target=watch, daemon=True)
    th.start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 900}, locale='cs-CZ')
        tabs = []
        for i in range(2):
            pg = ctx.new_page()
            con = Console(pg, f'dealer tab {i + 1}')
            pg.goto(SITE + '/dealer')
            pg.click('[data-atab="kviz"]')
            pg.wait_for_selector('#qzadvance', timeout=10000)
            tabs.append((pg, con))
        a, b = tabs[0][0], tabs[1][0]
        ok(a.is_checked('#qzauto') and b.is_checked('#qzauto'), '„Automaticky“ is on by default in both tabs')
        ok(wait_until(lambda: not a.is_disabled('#qzadvance'), 6), '„Další ▶“ enabled in the lobby')
        a.click('#qzadvance')
        ok(wait_until(lambda: (get().get('quiz') or {}).get('state') == 'question', 5), 'Další → question 1')
        # time 5 s + grace 1.5 s → auto reveal, then 5 s → auto board; then it waits for the dealer
        ok(wait_until(lambda: (get().get('quiz') or {}).get('state') == 'reveal', 12), 'auto reveal after time-up')
        ok(wait_until(lambda: (get().get('quiz') or {}).get('state') == 'board', 10), 'auto board after the reveal')
        time.sleep(3)
        q = get().get('quiz') or {}
        ok(q.get('state') == 'board' and q.get('idx') == 0, 'board waits for the dealer (no auto next question)')
        b.bring_to_front()
        b.locator('body').click(position={'x': 5, 'y': 890})
        b.keyboard.press(' ')
        ok(wait_until(lambda: (get().get('quiz') or {}).get('idx') == 1 and (get().get('quiz') or {}).get('state') == 'question', 5), 'space in tab 2 → question 2')
        # everyone answers → reveal right away (before time-up)
        for s in S:
            post({'op': 'quizAnswer', 'sid': s['sid'], 'pin': s['pin'], 'choice': 0})
        ok(wait_until(lambda: (get().get('quiz') or {}).get('state') == 'reveal', 4), 'auto reveal when everyone answered')
        ok(wait_until(lambda: (get().get('quiz') or {}).get('state') == 'board', 10), 'auto board after reveal 2')
        time.sleep(2.5)
        a.bring_to_front()
        a.click('#qzadvance')
        ok(wait_until(lambda: (get().get('quiz') or {}).get('state') == 'done', 5), 'Další after the last board → done')
        time.sleep(2)
        stop.set()
        th.join(2)
        info(f'states seen: {seen}')
        want = [('board', -1), ('question', 0), ('reveal', 0), ('board', 0), ('question', 1), ('reveal', 1), ('board', 1), ('done', 1)]
        got = [k for k in seen if k[0] != 'done'] + [k for k in seen if k[0] == 'done'][:1]
        ok([k[0] for k in got] == [k[0] for k in want] and [k[1] for k in got[:-1]] == [k[1] for k in want[:-1]], 'two tabs: every step exactly once, in order')
        pts = [x for x in (get('?view=data', {'x-dealer': 'mup-dealer'}).get('points') or []) if x.get('kind') == 'quiz']
        ok(len(pts) == len(S), f'question 2 scored once per correct student ({len(pts)} entries)')
        for pg, con in tabs:
            ok(no_hscroll(pg), 'Kvíz tab: no horizontal scroll')
            con.check('quiz')
        shot(a, 'v3-dealer-quiz')
        br.close()


run(main)
