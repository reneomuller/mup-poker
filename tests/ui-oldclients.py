# Deploy moment: phones, projector and dealer pages opened BEFORE the deploy keep running the OLD JavaScript (v2-base public/)
# against the NEW API until someone reloads them. Serves old public/ with the new api/ and checks the old pages keep working.
import os, subprocess, sys, time, shutil
from urllib.parse import urlparse

_base = os.environ.get('BASE', 'http://localhost:3105').replace('/api/game', '').rstrip('/')
PORT = (urlparse(_base).port or 3105) + 1
os.environ['BASE'] = f'http://localhost:{PORT}'
from playwright.sync_api import sync_playwright  # noqa: E402
from _ui import ok, warn, info, run, get, post, dealer, me, fresh, initial_slip, wait_until, Console, shot, SITE  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD = f'/tmp/oldpubE{PORT}'
# The pages open in class at deploy time run the code currently in production: origin/main (v2) before the
# v3 deploy. Override with OLD_REF=<git ref> (e.g. origin/v2-base for the pre-v2 pages).
OLD_REF = os.environ.get('OLD_REF') or next((r for r in ('origin/main', 'origin/v2-base', 'v2-base')
                                             if subprocess.run(['git', '-C', ROOT, 'rev-parse', '-q', '--verify', r + '^{commit}'],
                                                               capture_output=True).returncode == 0), 'origin/main')
TAG = f'tagE{PORT}'


def prepare():
    shutil.rmtree(OLD, ignore_errors=True)
    os.makedirs(OLD)
    subprocess.run(f'set -o pipefail; git -C {ROOT} archive {OLD_REF} public | tar -x -C {OLD}', shell=True, check=True, executable='/bin/bash')
    os.symlink(os.path.join(ROOT, 'api'), os.path.join(OLD, 'api'))
    shutil.copy(os.path.join(ROOT, 'dev-server.js'), os.path.join(OLD, 'dev-server.js'))
    shutil.copy(os.path.join(ROOT, 'package.json'), os.path.join(OLD, 'package.json'))
    os.symlink(os.path.join(ROOT, 'node_modules'), os.path.join(OLD, 'node_modules'))


def main():
    info(f"old pages from {OLD_REF}")
    prepare()
    subprocess.run(['pkill', '-f', f'^node dev-server.js {TAG}$'])
    env = {k: v for k, v in os.environ.items() if not any(x in k for x in ('KV_', 'UPSTASH', 'DATABASE_URL', 'POSTGRES', 'MUP_PG'))}
    env['PORT'] = str(PORT)
    srv = subprocess.Popen(['node', 'dev-server.js', TAG], cwd=OLD, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import urllib.request
        wait_until(lambda: urllib.request.urlopen(SITE + '/', timeout=2).status == 200, 10)
        T, S = fresh(8, features={'market': True, 'tranches': True, 'exit': True})
        with sync_playwright() as p:
            br = p.chromium.launch()
            pages = []
            for (path, w, h, label) in [('/play', 390, 844, 'old phone'), ('/table', 1366, 768, 'old table'), ('/dealer', 1366, 768, 'old dealer')]:
                ctx = br.new_context(viewport={'width': w, 'height': h}, locale='cs-CZ', is_mobile=(label == 'old phone'))
                pg = ctx.new_page()
                con = Console(pg, label)
                pg.on('dialog', lambda d: d.accept())
                url = SITE + path + (f"#ghost={S[0]['sid']}:{S[0]['pin']}" if label == 'old phone' else '')
                pg.goto(url)
                pages.append((label, pg, con))
            time.sleep(3)
            steps = []

            def step(name, fn):
                fn()
                time.sleep(3.2)
                for label, pg, con in pages:
                    alive = pg.evaluate('() => document.body && document.body.innerText.length > 20')
                    ok(alive, f'{label} after "{name}": page still renders')
                    con.check(f'after "{name}"')
                    shot(pg, f'old-{label.split()[1]}-{name.replace(" ", "-")}')
                steps.append(name)

            step('lobby', lambda: None)
            step('betting', lambda: dealer('phase', phase='betting', minutes=3))

            def invest():
                for i, s in enumerate(S):
                    post({'op': 'submit', 'sid': s['sid'], 'pin': s['pin'], **initial_slip(T, s['team'], i)})
            step('submitted', invest)
            step('showdown', lambda: (dealer('phase', phase='closed'), dealer('showdown')))
            step('rj reveal', lambda: (dealer('rjSave', **{'in': {T[1]: {'amt': 6000000, 'why': 'RJ'}}}), dealer('rjReveal')))
            step('revalue reason', lambda: dealer('revalue', V={T[2]: 2500000}, reason={T[2]: 'traction'}, why={T[2]: 'Trakce'}))
            step('market card', lambda: dealer('marketCard', title='Recese', text='Trh zpomaluje.', effects={T[0]: -20}))
            step('tranche', lambda: (dealer('trancheAdd', team=T[3], amt=1000000, cond='MVP', due='Blok 3'), dealer('trancheRelease', id=get()['tranches'][0]['id'])))
            step('quiz question', lambda: (dealer('quizStart', setId='blok2'), dealer('quizNext')))
            step('quiz reveal', lambda: (dealer('quizReveal'), dealer('quizBoard'), dealer('quizEnd'), dealer('quizEnd')))
            step('award', lambda: dealer('award', kind='sharpest', playerId=S[1]['sid'], note='Nejlepší call'))
            step('next block', lambda: dealer('nextBlock'))
            m = me(S[0]['sid'], S[0]['pin'])
            ok(m.get('me') and m['me']['portfolio'] > 0, 'old phone student still has a portfolio')
            step('exit', lambda: dealer('exitSet', outcomes={T[0]: {'kind': 'ipo', 'multiple': 2}, T[1]: {'kind': 'writeoff'}}))
            br.close()
    finally:
        srv.terminate()
        subprocess.run(['pkill', '-f', f'^node dev-server.js {TAG}$'])


run(main)
