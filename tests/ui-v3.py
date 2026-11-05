# v3 UI checks (docs/V3-SPEC.md): Tým tab, live investors, private team walls (UI + API), dealer Nástěnky with
# „Poslat všem týmům“, laptop sidebar, dealer preview /play?as=<sid> (read-only, device login untouched),
# one-time login link (#login=<sid>:<token>) and the quiz „Další ▶“ button.
from playwright.sync_api import sync_playwright
from _ui import ok, warn, info, run, get, post, dealer, dget, me, fresh, wait_until, Console, no_hscroll, shot, SITE


def wall_api(s):
    return get('?view=wall', {'x-sid': s['sid'], 'x-pin': s['pin']})


def texts(r):
    return [x.get('text') for x in (r.get('stickers') or [])]


def login(ctx, s, path='/play'):
    pg = ctx.new_page()
    pg.goto(SITE + '/play')
    pg.wait_for_load_state('networkidle')
    pg.evaluate(f"() => {{ localStorage.setItem('mup.sid', {s['sid']!r}); localStorage.setItem('mup.pin', {s['pin']!r}); }}")
    pg.goto(SITE + path)
    pg.wait_for_selector('[data-nav="profile"]', state='visible', timeout=10000)
    return pg


def open_team(pg):
    pg.click('[data-nav="profile"]')
    pg.wait_for_selector('#wallbox .mw-root', timeout=10000)
    pg.wait_for_timeout(800)


def main():
    T, S = fresh(6)
    A, B = S[0], S[1]  # A in T[0], B in T[1]
    dealer('phase', phase='betting', minutes=5)
    r = post({'op': 'submit', 'sid': B['sid'], 'pin': B['pin'],
              'in': {T[0]: {'amt': 700000, 'why': 'Věřím jejich prototypu'}, T[2]: {'amt': 300000, 'why': ''}}})
    ok(r.get('ok'), 'B submits a slip into team A with a reason')
    # --- API: walls are private ---
    ra = post({'op': 'wallPost', 'sid': A['sid'], 'pin': A['pin'], 'kind': 'q', 'text': 'TAJNE-A otázka'})
    rb = post({'op': 'wallPost', 'sid': B['sid'], 'pin': B['pin'], 'kind': 'task', 'text': 'TAJNE-B úkol'})
    ok(ra.get('ok') and rb.get('ok'), 'students post on their own walls')
    ok('TAJNE-A otázka' not in texts(wall_api(B)) and 'TAJNE-B úkol' not in texts(wall_api(A)), 'API: no team sees another team\'s wall')
    aid = next((x['id'] for x in wall_api(A).get('stickers', []) if x['text'] == 'TAJNE-A otázka'), None)
    x = post({'op': 'wallReply', 'sid': B['sid'], 'pin': B['pin'], 'id': aid, 'text': 'cizí odpověď'})
    ok(not x.get('ok'), 'API: replying to another team\'s sticker is refused')
    x = post({'op': 'wallReply', 'sid': B['sid'], 'pin': B['pin'], 'team': T[0], 'id': aid, 'text': 'cizí odpověď'})
    ok(not x.get('ok'), 'API: a student cannot pick another team with team=')
    x = get(f'?view=wall&team={T[0]}', {'x-sid': B['sid'], 'x-pin': B['pin']})
    ok('TAJNE-A otázka' not in texts(x) and 'TAJNE-A otázka' not in str(x.get('walls', '')), 'API: ?view=wall&team=<other> as a student does not leak')
    x = get(f'?view=wall&as={A["sid"]}', {'x-sid': B['sid'], 'x-pin': B['pin']})
    ok('TAJNE-A otázka' not in str(x), 'API: as=<other sid> without the dealer header does not leak')
    x = get(f'?as={A["sid"]}', {'x-sid': B['sid'], 'x-pin': B['pin']})
    ok(not x.get('asDealer') and ((x.get('me') or {}).get('id') in (None, B['sid'])), 'API: as= without the dealer header is ignored')

    with sync_playwright() as p:
        br = p.chromium.launch()
        phone = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='cs-CZ')
        # --- phone A: Tým tab ---
        ca = br.new_context(**phone)
        pa = login(ca, A)
        con = Console(pa, 'phone A')
        ok('Tým' in pa.inner_text('[data-nav="profile"]'), 'bottom tab reads „Tým“')
        open_team(pa)
        txt = pa.inner_text('[data-view="profile"]')
        ok('Investoři' in txt and B['name'] in txt and 'Věřím jejich prototypu' in txt, 'Tým › Investoři lists B by name with the reason (live)')
        ok('Nástěnka týmu' in txt, 'Tým shows „Nástěnka týmu“')
        ok('TAJNE-A otázka' in txt, 'UI: A sees its own sticker')
        ok('TAJNE-B úkol' not in txt, 'UI: A does not see team B\'s sticker')
        Vnow = next(t['Vnow'] for t in get()['teams'] if t['id'] == T[0])
        info(f'team A Vnow={Vnow}')
        # post a task through the composer
        pa.click('#wallbox .mw-seg-btn[data-kind="task"]')
        pa.fill('#wallbox textarea.mw-input', 'UI-UKOL-A dodělat pitch')
        pa.click('#wallbox .mw-send')
        got = wait_until(lambda: next((s for s in wall_api(A).get('stickers', []) if s['text'] == 'UI-UKOL-A dodělat pitch'), None), 8)
        ok(got and got.get('kind') == 'task', 'UI: composer posts a task (Úkol chosen before posting)')
        ok('UI-UKOL-A dodělat pitch' not in texts(wall_api(B)), 'API: the UI-posted task stays off team B\'s wall')
        # tap to expand, reply
        note = pa.locator('#wallbox [data-id]', has_text='TAJNE-A otázka').first
        note.click()
        mod = wait_until(lambda: pa.locator('.mw-modal').count() > 0, 5)
        ok(mod, 'UI: tapping a sticker opens the detail sheet')
        if mod:
            pa.fill('.mw-modal .mw-reply-input', 'odpověď z UI')
            pa.locator('.mw-modal .mw-reply-input').press('Enter')
            rep = wait_until(lambda: any(rr['text'] == 'odpověď z UI' for s in wall_api(A).get('stickers', []) if s['id'] == aid for rr in s.get('replies', [])), 6)
            if not rep:
                btn = pa.locator('.mw-modal .mw-reply-form button[type="submit"], .mw-modal .mw-reply-form button').first
                if btn.count():
                    btn.click()
                rep = wait_until(lambda: any(rr['text'] == 'odpověď z UI' for s in wall_api(A).get('stickers', []) if s['id'] == aid for rr in s.get('replies', [])), 6)
            ok(rep, 'UI: reply from the sheet is saved')
            shot(pa, 'v3-phone-wall-sheet')
            pa.keyboard.press('Escape')
            pa.wait_for_timeout(400)
        ok(no_hscroll(pa), 'phone A Tým: no horizontal scroll')
        shot(pa, 'v3-phone-tym')
        con.check('Tým')

        # --- phone B: sees only its own wall ---
        cb = br.new_context(**phone)
        pb = login(cb, B)
        conb = Console(pb, 'phone B')
        open_team(pb)
        tb = pb.inner_text('[data-view="profile"]')
        ok('TAJNE-B úkol' in tb, 'UI: B sees its own task')
        ok(not any(s in tb for s in ('TAJNE-A otázka', 'UI-UKOL-A', 'odpověď z UI')), 'UI: B sees nothing from team A\'s wall')

        # --- dealer: Nástěnky ---
        cd = br.new_context(viewport={'width': 1440, 'height': 900}, locale='cs-CZ')
        pd = cd.new_page()
        pd.on('dialog', lambda d: d.accept())
        cond = Console(pd, 'dealer')
        pd.goto(SITE + '/dealer')
        pd.click('[data-atab="walls"]')
        pd.wait_for_selector('[data-wteam="all"]', timeout=10000)
        pd.click(f'[data-wteam="{T[0]}"]')
        ok(wait_until(lambda: 'TAJNE-A otázka' in pd.inner_text('#wallbox'), 8), 'dealer sees team A\'s wall')
        ok('TAJNE-B úkol' not in pd.inner_text('#wallbox'), 'dealer team A view does not mix in team B')
        pd.click('[data-wteam="all"]')
        ok(wait_until(lambda: 'TAJNE-B úkol' in pd.inner_text('#wallbox') and 'TAJNE-A otázka' in pd.inner_text('#wallbox'), 8), 'dealer „Všechny týmy“ shows every wall')
        pd.click('#wallbox .mw-seg-btn[data-kind="task"]')
        allbox = pd.locator('#wallbox .mw-all-box')
        ok(allbox.count() == 1, 'dealer composer has „Poslat všem týmům“')
        if allbox.count():
            allbox.check()
            pd.fill('#wallbox textarea.mw-input', 'VSEM úkol od MUP')
            pd.click('#wallbox .mw-send')
            each = wait_until(lambda: all('VSEM úkol od MUP' in texts(wall_api(s)) for s in S), 8)
            ok(each, 'dealer „Poslat všem týmům“ lands on every team\'s wall')
            sts = [next((x for x in wall_api(s).get('stickers', []) if x['text'] == 'VSEM úkol od MUP'), {}) for s in S]
            ok(len({x.get('group') for x in sts}) == 1 and sts[0].get('group') and all(x.get('kind') == 'task' for x in sts), 'send-to-all: shared group, kind task')
        ok(wait_until(lambda: 'VSEM úkol od MUP' in pb.inner_text('[data-view="profile"]'), 10), 'phone B shows the dealer task live (poll)')
        ok(no_hscroll(pd), 'dealer Nástěnky: no horizontal scroll')
        shot(pd, 'v3-dealer-walls')
        # Kvíz tab: „Další ▶“
        pd.click('[data-atab="kviz"]')
        ok(wait_until(lambda: pd.locator('#qzadvance').count() == 1 and pd.locator('#qzauto').count() == 1, 6), 'Kvíz tab has #qzadvance „Další ▶“ and #qzauto')
        cond.check('Nástěnky + Kvíz')
        conb.check('Tým')

        # --- laptop: sidebar + 2 columns ---
        cl = br.new_context(viewport={'width': 1280, 'height': 800}, locale='cs-CZ')
        pl = login(cl, A)
        conl = Console(pl, 'laptop')
        boxes = [pl.locator(f'[data-nav="{v}"]').first.bounding_box() for v in ('invest', 'portfolio', 'startups', 'profile')]
        ok(all(b and b['x'] < 320 for b in boxes) and len({round(b['y']) for b in boxes}) == 4, 'laptop: [data-nav] buttons form a left sidebar')
        ok(no_hscroll(pl), 'laptop: no horizontal scroll')
        open_team(pl)
        ok(no_hscroll(pl), 'laptop Tým: no horizontal scroll')
        shot(pl, 'v3-laptop-tym')
        conl.check('laptop')

        # --- dealer preview ---
        cp = br.new_context(viewport={'width': 1280, 'height': 800}, locale='cs-CZ')
        pp = cp.new_page()
        pp.goto(SITE + '/play')
        pp.wait_for_load_state('networkidle')
        pp.evaluate("() => { localStorage.setItem('mup.dealer', 'mup-dealer'); localStorage.setItem('mup.sid', 'device-own-sid'); localStorage.setItem('mup.pin', '9999'); }")
        conp = Console(pp, 'preview')
        pp.goto(SITE + f'/play?as={B["sid"]}')
        ok(wait_until(lambda: f'Náhled: {B["name"]}' in pp.inner_text('.pa-bar'), 10), 'preview banner „Náhled: <jméno> (<tým>) – jen pro čtení“')
        pp.click('[data-nav="profile"]')
        pp.wait_for_selector('#wallbox .mw-root', timeout=10000)
        ok(wait_until(lambda: 'TAJNE-B úkol' in pp.inner_text('[data-view="profile"]'), 8), 'preview shows B\'s team wall')
        ok('TAJNE-A otázka' not in pp.inner_text('[data-view="profile"]'), 'preview of B does not show team A\'s wall')
        ta = pp.locator('#wallbox textarea').first
        ok(ta.count() == 0 or ta.is_disabled(), 'preview: wall composer is disabled')
        n0 = len(wall_api(B).get('stickers', []))
        if ta.count():
            pp.evaluate("() => { const t = document.querySelector('#wallbox textarea'); if (t) { t.disabled = false; t.value = 'PREVIEW-ZAPIS'; } const f = document.querySelector('#wallbox form'); f && f.requestSubmit && f.requestSubmit(); }")
            pp.wait_for_timeout(1200)
        ok(len(wall_api(B).get('stickers', [])) == n0 and 'PREVIEW-ZAPIS' not in texts(wall_api(B)), 'preview: nothing is written')
        ls = pp.evaluate("() => [localStorage.getItem('mup.sid'), localStorage.getItem('mup.pin')]")
        ok(ls == ['device-own-sid', '9999'], 'preview never touches mup.sid / mup.pin')
        shot(pp, 'v3-preview')
        conp.check('preview')

        # --- one-time login link ---
        C = S[2]
        r = dealer('loginLink', sid=C['sid'])
        ok(r.get('ok') and str(r.get('url', '')).startswith('/play#login='), 'dealer loginLink returns /play#login=…')
        ct = br.new_context(**phone)
        pt = ct.new_page()
        cont = Console(pt, 'token login')
        pt.goto(SITE + r.get('url', '/play'))
        shown = wait_until(lambda: 'nový PIN' in pt.inner_text('body'), 10)
        ok(shown, 'token login shows „Tvůj nový PIN …“')
        ls = pt.evaluate("() => [localStorage.getItem('mup.sid'), localStorage.getItem('mup.pin')]")
        ok(ls[0] == C['sid'] and ls[1] and ls[1] != C['pin'] and len(ls[1]) == 4, 'token login stores sid + a new 4-digit PIN')
        ok(ls[1] and (me(C['sid'], ls[1]).get('me') or {}).get('id') == C['sid'], 'the new PIN works for API login')
        ok(not (me(C['sid'], C['pin']).get('me')), 'the old PIN no longer works')
        x = post({'op': 'tokenLogin', 'sid': C['sid'], 'token': r.get('url', '').split(':')[-1]})
        ok(not x.get('ok') and 'neplatí' in str(x.get('error', '')), 'the link works only once („Odkaz už neplatí…“)')
        shot(pt, 'v3-token-login')
        cont.check('token login')
        br.close()


run(main)
