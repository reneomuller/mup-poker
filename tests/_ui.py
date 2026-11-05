# Shared helpers for agent E's Playwright UI smoke suites (stable hooks from docs/V2-SPEC.md §12 only).
# Output contract (run-all.sh counts these): "ok   …" pass, "FAIL …" failure, "WARN …" soft finding.
import json, os, sys, time, traceback, urllib.request

SITE = os.environ.get('BASE', 'http://localhost:3105').replace('/api/game', '').rstrip('/')
API = SITE + '/api/game'
SHOTS = os.environ.get('SHOTS', '/tmp/shots-E')
os.makedirs(SHOTS, exist_ok=True)
_pass = _fail = _warn = 0


def ok(c, m):
    global _pass, _fail
    if c:
        _pass += 1; print('ok   ' + m, flush=True)
    else:
        _fail += 1; print('FAIL ' + m, flush=True)
    return bool(c)


def warn(c, m):
    global _warn
    if not c:
        _warn += 1; print('WARN ' + m, flush=True)
    return bool(c)


def info(m):
    print('info ' + m, flush=True)


def done():
    print(f'\nSUMMARY pass={_pass} fail={_fail} warn={_warn}', flush=True)
    sys.exit(1 if _fail else 0)


def run(fn):
    try:
        fn()
    except Exception:
        ok(False, 'suite crashed: ' + traceback.format_exc().replace('\n', ' | ')[-1500:])
    done()


def _req(method, body=None, headers=None, q=''):
    h = {'content-type': 'application/json'}
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + q, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return json.loads(resp.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {'ok': False, 'error': str(e)}


def get(q='', headers=None):
    return _req('GET', None, headers, q)


def post(body, headers=None):
    return _req('POST', body, headers)


def dealer(op, **x):
    x['op'] = op
    return _req('POST', x, {'x-dealer': 'mup-dealer'})


def dget(q):
    return _req('GET', None, {'x-dealer': 'mup-dealer'}, q)


def me(sid, pin):
    return get('', {'x-sid': sid, 'x-pin': pin})


def fresh(n=0, features=None, names=('Lumio', 'Parkly', 'Tutorix', 'GreenBox', 'Hrajsport', 'Vetly')):
    dealer('reset', confirm='RESET', keepPlayers=False)
    if features:
        dealer('features', set=features)
    st = get()
    T = [t['id'] for t in st['teams']]
    dealer('teams', teams=[{'id': t, 'name': names[i]} for i, t in enumerate(T)])
    dealer('reg', open=True)
    S = []
    for i in range(n):
        team = T[i % len(T)]
        pin = str(5000 + i)
        r = post({'op': 'register', 'name': f'Studentka {i + 1}', 'team': team, 'pin': pin})
        S.append({'sid': r.get('sid'), 'pin': pin, 'team': team, 'name': f'Studentka {i + 1}'})
    return T, S


def initial_slip(T, own, i):
    o = [t for t in T if t != own]
    a, b = o[i % len(o)], o[(i + 2) % len(o)]
    return {'in': {a: {'amt': 600000, 'why': f'Důvod {i}'}, b: {'amt': 400000, 'why': ''}}}


def wait_until(fn, timeout=8.0, step=0.2):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception:
            last = None
        time.sleep(step)
    return last


class Console:
    """Collects console errors and page errors of a page."""

    NET = ('ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NAME_NOT_RESOLVED', 'ERR_INTERNET_DISCONNECTED', 'ERR_PROXY', 'ERR_CERT', 'ERR_CONNECTION_REFUSED', 'ERR_BLOCKED')

    def __init__(self, page, label):
        self.errors = []
        self.external = set()
        self.label = label
        page.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: self.errors.append('pageerror: ' + str(e)))
        page.on('requestfailed', lambda r: self.external.add(r.url[:100]) if not r.url.startswith(SITE) else self.errors.append('local request failed: ' + r.url))

    def check(self, what=''):
        # the sandbox has no internet: failed loads of external resources (photos, CDN) are not app errors
        errs = [e for e in self.errors if 'favicon' not in e and not any(n in e for n in self.NET)]
        if self.external:
            info(f'{self.label}: external resources unreachable in the sandbox: {sorted(self.external)[:4]}')
            self.external.clear()
        ok(not errs, f'{self.label}{(" " + what) if what else ""}: no console errors' + (f' → {errs[:3]}' if errs else ''))
        self.errors.clear()


def no_hscroll(page):
    return page.evaluate('() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth + 1')


def shot(page, name):
    p = os.path.join(SHOTS, name + '.png')
    try:
        page.screenshot(path=p, full_page=False)
    except Exception as e:
        info(f'screenshot {name} failed: {e}')
    return p
