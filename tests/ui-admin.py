# Admin smoke test: every [data-atab] opens without console errors (laptop + phone width), [data-feature] switches change
# state.features, phase controls exist, and #qzstart/#qznext/#qzreveal/#qzboard run a question while 3 phones answer.
from playwright.sync_api import sync_playwright
from _ui import ok, warn, info, run, get, post, dealer, dget, me, fresh, wait_until, Console, no_hscroll, shot, SITE

TABS = ['hra', 'investice', 'rj', 'oceneni', 'startupy', 'kviz', 'body', 'hraci', 'funkce', 'data', 'texty']


def open_admin(br, w, h, label):
    ctx = br.new_context(viewport={'width': w, 'height': h}, locale='cs-CZ')
    page = ctx.new_page()
    con = Console(page, f'admin {label}')
    page.on('dialog', lambda d: (info(f'admin confirm dialog: {d.message[:80]}'), d.accept()))
    page.goto(SITE + '/dealer')
    page.locator('[data-atab]:visible, #dpw:visible').first.wait_for(timeout=10000)
    if page.locator('#dpw').is_visible():
        page.fill('#dpw', 'mup-dealer')
        page.click('#dgo')
    page.wait_for_selector('[data-atab]', state='visible', timeout=10000)
    return ctx, page, con


def click_tab(page, t):
    page.click(f'[data-atab="{t}"]')
    return wait_until(lambda: page.evaluate(f"() => {{ const b = document.querySelector('[data-atab=\"{t}\"]'); return b && (b.classList.contains('s-on') || b.classList.contains('on') || b.getAttribute('aria-selected') === 'true' || location.hash === '#{t}'); }}"), 3)


def main():
    T, S = fresh(3)
    with sync_playwright() as p:
        br = p.chromium.launch()
        for (w, h, label) in [(1366, 768, 'laptop'), (390, 844, 'phone')]:
            ctx, page, con = open_admin(br, w, h, label)
            found = [t for t in TABS if page.locator(f'[data-atab="{t}"]').count()]
            ok(len(found) >= 10, f'{label}: admin tabs present ({len(found)}/11: missing {[t for t in TABS if t not in found]})')
            for t in found:
                if t == 'texty':
                    continue  # may navigate to /cms
                on = click_tab(page, t)
                page.wait_for_timeout(300)
                ok(bool(on), f'{label}: tab [data-atab="{t}"] opens')
                warn(no_hscroll(page), f'{label}: no horizontal scroll on tab {t}')
                shot(page, f'admin-{label}-{t}')
                con.check(f'tab {t}')
            if label == 'laptop':
                click_tab(page, 'hra')
                page.wait_for_timeout(400)
                ids = ['blobby', 'bpitch', 'bbet', 'bclose', 'bshow', 'brj', 'bnext', 'bfinal']
                present = [i for i in ids if page.locator('#' + i).count()]
                warn(len(present) == len(ids), f'phase controls present in Hra tab: {present} (missing {[i for i in ids if i not in present]})')
                # feature switches
                click_tab(page, 'funkce')
                page.wait_for_selector('[data-feature="market"]', timeout=5000)
                ok(page.locator('[data-feature]').count() >= 10, f'{page.locator("[data-feature]").count()} feature switches')
                before = get()['features']['market']
                page.click('[data-feature="market"]')
                flipped = wait_until(lambda: get()['features']['market'] != before, 5)
                ok(bool(flipped), f'[data-feature="market"] toggles state.features.market ({before} → {not before})')
                page.click('[data-feature="market"]')
                back = wait_until(lambda: get()['features']['market'] == before, 5)
                ok(bool(back), '[data-feature="market"] toggles back')
                before_q = get()['features']['quiz']
                page.click('[data-feature="quiz"]')
                ok(bool(wait_until(lambda: get()['features']['quiz'] != before_q, 5)), '[data-feature="quiz"] toggles')
                page.click('[data-feature="quiz"]')
                ok(bool(wait_until(lambda: get()['features']['quiz'] == before_q, 5)), 'quiz switched back on')
                con.check('feature switches')
                # quiz with 3 phones
                phones = []
                for s in S:
                    pc = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
                    pp = pc.new_page()
                    pcon = Console(pp, 'phone ' + s['name'])
                    pp.goto(f"{SITE}/play#ghost={s['sid']}:{s['pin']}")
                    pp.wait_for_selector('[data-nav="invest"]', state='visible', timeout=10000)
                    phones.append((pc, pp, pcon, s))
                click_tab(page, 'kviz')
                page.wait_for_selector('#qzstart', timeout=5000)
                page.click('#qzstart')
                ok(bool(wait_until(lambda: get()['quiz']['state'] == 'board', 5)), '#qzstart starts the quiz (board)')
                page.wait_for_selector('#qznext:not([disabled])', timeout=5000)
                page.click('#qznext')
                ok(bool(wait_until(lambda: get()['quiz']['state'] == 'question', 5)), '#qznext opens question 1')
                for i, (pc, pp, pcon, s) in enumerate(phones):
                    pp.wait_for_selector(f'[data-quiz="{i}"]', state='visible', timeout=8000)
                    pp.click(f'[data-quiz="{i}"]')
                answered = wait_until(lambda: all(me(s['sid'], s['pin'])['me']['quiz']['myChoice'] == i for i, (_, _, _, s) in enumerate(phones)), 6)
                ok(bool(answered), '3 phones answered via [data-quiz]')
                live = wait_until(lambda: '3' in page.inner_text('body'), 4)
                warn(bool(live), 'admin shows the live answered count')
                shot(page, 'admin-quiz-question')
                page.click('#qzreveal')
                ok(bool(wait_until(lambda: get()['quiz']['state'] == 'reveal', 5)), '#qzreveal reveals')
                ok(sum(get()['quiz'].get('counts') or []) == 3, 'reveal counts the 3 phone answers')
                for pc, pp, pcon, s in phones:
                    pp.wait_for_timeout(300)
                shot(phones[0][1], 'admin-quiz-phone-reveal')
                page.click('#qzboard')
                ok(bool(wait_until(lambda: get()['quiz']['state'] == 'board', 5)), '#qzboard shows the board')
                shot(page, 'admin-quiz-board')
                if page.locator('#qzend').count():
                    page.click('#qzend')
                    ok(bool(wait_until(lambda: get()['quiz']['state'] in ('done', 'idle'), 5)), '#qzend ends the quiz')
                con.check('quiz')
                for pc, pp, pcon, s in phones:
                    pcon.check('quiz')
                    pc.close()
            ctx.close()
        br.close()


run(main)
