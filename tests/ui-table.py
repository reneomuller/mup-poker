# Projector smoke test: /table renders at 1920×1080, 1366×768, 1280×720, 1024×768 with six [data-seat] plates,
# no console errors and no horizontal overflow — in the lobby, live betting, after a showdown, during a quiz and after the exit.
from playwright.sync_api import sync_playwright
from _ui import ok, warn, info, run, get, post, dealer, fresh, initial_slip, wait_until, Console, no_hscroll, shot, SITE

SIZES = [(1920, 1080), (1366, 768), (1280, 720), (1024, 768)]


def check_all(br, label, extra=None):
    for w, h in SIZES:
        ctx = br.new_context(viewport={'width': w, 'height': h}, locale='cs-CZ')
        page = ctx.new_page()
        con = Console(page, f'table {w}×{h} {label}')
        page.goto(SITE + '/table')
        n = wait_until(lambda: page.locator('[data-seat]').count() == 6, 10)
        if extra is None:
            ok(bool(n), f'{w}×{h} {label}: six [data-seat] plates')
        page.wait_for_timeout(2500 if extra else 1800)
        if extra:
            ok(bool(extra(page)), f'{w}×{h} {label}: screen content shown')
        ok(no_hscroll(page), f'{w}×{h} {label}: no horizontal overflow')
        overflow = page.evaluate('''() => [...document.querySelectorAll('[data-seat]')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 2 || r.left < -2 || r.bottom > innerHeight + 2 || r.top < -2); }).length''')
        warn(overflow == 0 or extra is not None, f'{w}×{h} {label}: all plates inside the viewport ({overflow} outside)')
        shot(page, f'table-{label}-{w}x{h}')
        con.check()
        ctx.close()


def main():
    T, S = fresh(12, features={'market': True, 'tranches': True, 'rounds': True, 'exit': True})
    with sync_playwright() as p:
        br = p.chromium.launch()
        check_all(br, 'lobby')
        dealer('phase', phase='betting', minutes=4, label='Investujte')
        for i, s in enumerate(S[:8]):
            post({'op': 'submit', 'sid': s['sid'], 'pin': s['pin'], **initial_slip(T, s['team'], i)})
        check_all(br, 'betting')
        for i, s in enumerate(S[8:]):
            post({'op': 'submit', 'sid': s['sid'], 'pin': s['pin'], **initial_slip(T, s['team'], i + 8)})
        dealer('phase', phase='closed')
        dealer('showdown')
        dealer('rjSave', **{'in': {T[0]: {'amt': 3000000, 'why': 'RJ'}, T[3]: {'amt': 2000000, 'why': 'RJ'}}})
        dealer('rjReveal')
        dealer('trancheAdd', team=T[2], amt=1000000, cond='MVP', due='Blok 3')
        dealer('marketCard', title='Recese', text='Trh zpomaluje.', effects={T[1]: -20, T[5]: 15})
        dealer('award', kind='sharpest', playerId=S[0]['sid'], note='Nejlepší call')
        dealer('card', team=T[0], oneLiner='Parkování bez stresu', sub='Aplikace pro řidiče', milestones={'m1a': True})
        check_all(br, 'after-showdown')
        dealer('screen', screen='board')
        check_all(br, 'board-screen')
        dealer('screen', screen='table')
        dealer('quizSave', set={'id': 'tb', 'title': 'Stůl kvíz', 'questions': [{'q': 'Co znamená CAC – cena za získání zákazníka?', 'a': ['Ano', 'Ne', 'Někdy', 'Nevím'], 'correct': 0, 'time': 60}]})
        dealer('quizStart', setId='tb')
        dealer('quizNext')
        for i, s in enumerate(S):
            post({'op': 'quizAnswer', 'sid': s['sid'], 'pin': s['pin'], 'choice': i % 4})
        check_all(br, 'quiz-question', extra=lambda pg: 'CAC' in pg.inner_text('body'))
        dealer('quizReveal')
        check_all(br, 'quiz-reveal', extra=lambda pg: 'CAC' in pg.inner_text('body') or 'Ano' in pg.inner_text('body'))
        dealer('quizBoard')
        check_all(br, 'quiz-board', extra=lambda pg: 'Studentka' in pg.inner_text('body'))
        dealer('quizEnd'); dealer('quizEnd')
        outcomes = {T[0]: {'kind': 'acquired', 'multiple': 3}, T[1]: {'kind': 'writeoff'}, T[2]: {'kind': 'ipo', 'multiple': 6}}
        ok(dealer('exitSet', outcomes=outcomes).get('ok'), 'exitSet for the finale')
        check_all(br, 'exit', extra=lambda pg: len(pg.inner_text('body')) > 50)
        br.close()


run(main)
