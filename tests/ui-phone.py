# Phone smoke test at 390×844: register, invest exactly 300k-style rules (block 1 = 1M, block 2 = exactly 300k),
# a wrong sum shows an error, reload keeps the login, tab bar works, quiz tiles answer.
from playwright.sync_api import sync_playwright
from _ui import ok, warn, info, run, get, post, dealer, dget, me, fresh, initial_slip, wait_until, Console, no_hscroll, shot, SITE


def set_amt(page, kind, team, value):
    inp = page.locator(f'[data-k="{kind}"][data-t="{team}"] input.amt').first
    inp.scroll_into_view_if_needed()
    inp.click()
    inp.fill(str(value))
    inp.press('Tab')


def body_text(page):
    return page.inner_text('body')


def main():
    T, others = fresh(5)
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='cs-CZ')
        page = ctx.new_page()
        con = Console(page, 'phone')
        page.goto(SITE + '/play')
        # --- register ---
        page.wait_for_selector('#lname', timeout=10000)
        ok(page.locator('[data-tab="new"]').count() == 1 and page.locator('[data-tab="old"]').count() == 1, 'login tabs [data-tab=new|old]')
        shot(page, 'phone-login')
        page.fill('#lname', 'Testovací Telefon')
        page.select_option('#lteam', T[0])
        page.fill('#lpin', '4826')
        page.click('#lgo')
        page.wait_for_selector('[data-nav="invest"]', state='visible', timeout=10000)
        st = get()
        reg = [x for x in st['players'] if x['name'] == 'Testovací Telefon']
        ok(len(reg) == 1 and reg[0]['team'] == T[0], 'registered via #lname/#lteam/#lpin/#lgo')
        sid = page.evaluate("localStorage.getItem('mup.sid')")
        pin = page.evaluate("localStorage.getItem('mup.pin')")
        ok(bool(sid) and pin == '4826', 'phone keeps sid + pin locally')
        ok(no_hscroll(page), 'no horizontal scroll (lobby)')
        # --- invest, block 1 ---
        dealer('phase', phase='betting', minutes=5)
        row = f'[data-k="in"][data-t="{T[1]}"] input.amt'
        page.wait_for_selector(row, timeout=10000)
        ok(page.locator('[data-k="in"][data-t="' + T[0] + '"]').count() == 0, 'no invest row for the own team')
        set_amt(page, 'in', T[1], 500000)
        set_amt(page, 'in', T[2], 300000)
        page.click('#go')
        page.wait_for_timeout(600)
        m = me(sid, pin)
        ok(not (m.get('me', {}).get('slip') or {}).get('submitted'), 'wrong sum (800 000) not submitted')
        txt = body_text(page)
        ok(any(w in txt for w in ['přesně', 'Rozděl', 'zbývá', 'Zbývá', 'chybí', 'Chybí', 'zbylo', 'Zbylo']), 'wrong sum shows an error / remaining amount')
        shot(page, 'phone-wrongsum')
        set_amt(page, 'in', T[2], 500000)
        page.click('#go')
        sub = wait_until(lambda: (me(sid, pin).get('me', {}).get('slip') or {}).get('submitted'), 8)
        ok(bool(sub), 'exactly 1 000 000 submitted with #go')
        sl = me(sid, pin)['me']['slip']
        ok(sl['in'].get(T[1], {}).get('amt') == 500000 and sl['in'].get(T[2], {}).get('amt') == 500000, 'amounts typed are the amounts stored')
        shot(page, 'phone-submitted')
        con.check('after investing')
        # --- reload stays logged in ---
        page.reload()
        page.wait_for_selector('[data-nav="invest"]', state='visible', timeout=10000)
        ok(page.locator('#lname').count() == 0 or not page.locator('#lname').is_visible(), 'reload: still logged in')
        # --- tab bar ---
        for v in ['portfolio', 'startups', 'profile', 'invest']:
            page.click(f'[data-nav="{v}"]')
            on = wait_until(lambda: page.evaluate(f"() => {{ const b = document.querySelector('[data-nav=\"{v}\"]'); return b.getAttribute('aria-current') === 'page' || b.classList.contains('s-on'); }}"), 3)
            ok(bool(on), f'tab bar [data-nav="{v}"] opens')
            ok(no_hscroll(page), f'no horizontal scroll on {v}')
            shot(page, f'phone-tab-{v}')
        con.check('tab bar')
        # --- block 2: exactly 300k ---
        for i, s in enumerate(others):
            post({'op': 'submit', 'sid': s['sid'], 'pin': s['pin'], **initial_slip(T, s['team'], i)})
        dealer('phase', phase='closed')
        dealer('showdown')
        dealer('nextBlock')
        dealer('phase', phase='betting')
        page.click('[data-nav="invest"]')
        page.wait_for_selector(f'[data-k="out"][data-t="{T[1]}"] input.amt', timeout=10000)
        set_amt(page, 'out', T[1], 200000)
        set_amt(page, 'in', T[3], 200000)
        page.click('#go')
        page.wait_for_timeout(600)
        ok(not (me(sid, pin)['me'].get('slip') or {}).get('submitted'), 'block 2: moving only 200 000 is not submitted')
        shot(page, 'phone-b2-wrong')
        set_amt(page, 'out', T[1], 300000)
        set_amt(page, 'in', T[3], 300000)
        page.click('#go')
        sub = wait_until(lambda: (me(sid, pin).get('me', {}).get('slip') or {}).get('submitted'), 8)
        ok(bool(sub), 'block 2: exactly 300 000 out and in submitted')
        if sub:
            sl = me(sid, pin)['me']['slip']
            ok(sum(e['amt'] for e in sl['out'].values()) == 300000 and sum(e['amt'] for e in sl['in'].values()) == 300000, 'block 2 slip = 300 000 / 300 000')
        shot(page, 'phone-b2-done')
        con.check('block 2')
        # --- quiz tiles ---
        dealer('quizSave', set={'id': 'ui', 'title': 'UI kvíz', 'questions': [{'q': 'Co je MVP?', 'a': ['Hráč', 'Produkt', 'Plán', 'Výnos'], 'correct': 1, 'time': 30}]})
        dealer('quizStart', setId='ui')
        dealer('quizNext')
        page.wait_for_selector('[data-quiz="1"]', state='visible', timeout=8000)
        ok(page.locator('[data-quiz]').count() >= 4, 'four answer tiles [data-quiz]')
        shot(page, 'phone-quiz')
        page.click('[data-quiz="1"]')
        ans = wait_until(lambda: me(sid, pin)['me'].get('quiz', {}).get('myChoice') == 1, 6)
        ok(bool(ans), 'tapping [data-quiz="1"] answers')
        page.wait_for_timeout(500)
        shot(page, 'phone-quiz-sent')
        dealer('quizReveal')
        page.wait_for_timeout(3000)
        shot(page, 'phone-quiz-reveal')
        ok(no_hscroll(page), 'no horizontal scroll in the quiz')
        dealer('quizBoard')
        page.wait_for_timeout(3000)
        shot(page, 'phone-quiz-board')
        dealer('quizEnd'); dealer('quizEnd')
        page.wait_for_timeout(2500)
        ok(page.locator('[data-nav="invest"]').is_visible(), 'back to the app after the quiz')
        con.check('quiz')
        # --- ghost link ---
        g = dealer('ghost', team=T[4])
        p2 = ctx.new_page()
        con2 = Console(p2, 'ghost phone')
        p2.goto(f"{SITE}/play#ghost={g['sid']}:{g['pin']}")
        p2.wait_for_selector('[data-nav="invest"]', state='visible', timeout=10000)
        ok(True, 'ghost link #ghost=sid:pin logs in')
        con2.check()
        br.close()


run(main)
