// v4 sound lane: the `sound` flag (default on, switchable, in the public state), the projector loads the synth and its
// glue, phones never do, and the synth is self-contained (no network, no audio files, valid syntax).
//   BASE=http://localhost:3300/api/game node tests/v4-sound.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ok, info, section, main, client, FEATURE_DEFAULTS } from './_e-lib.mjs';

const c = client();
const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ORIGIN = new URL(process.env.BASE || 'http://localhost:3105/api/game').origin;
const page = async (p) => { const r = await fetch(ORIGIN + p); return { status: r.status, text: await r.text() }; };

await main(async () => {
  section('flag');
  ok(FEATURE_DEFAULTS.sound === true, 'sound is on by default in the test defaults');
  await c.dealer('reset', { confirm: 'RESET', keepPlayers: false });
  let st = await c.get();
  ok(st.features?.sound === true, 'fresh game: features.sound === true');
  ok((await c.dealer('features', { set: { sound: false } })).ok, 'features op switches sound off');
  st = await c.get();
  ok(st.features.sound === false && st.features.quiz === true, 'sound off, other flags untouched');
  const plain = await (await fetch(ORIGIN + '/api/game')).json();
  ok(plain.features?.sound === false, 'the projector (no dealer header) sees the flag too');
  await c.dealer('features', { set: { sound: true } });
  ok((await c.get()).features.sound === true, 'switched back on');

  section('pages');
  const tbl = await page('/table.html');
  ok(tbl.status === 200 && /<script src="\/sound\.js"><\/script>/.test(tbl.text) && /<script src="\/table-sound\.js"><\/script>/.test(tbl.text), 'table.html loads sound.js + table-sound.js');
  ok(tbl.text.indexOf('/sound.js') < tbl.text.indexOf('/table.js') && tbl.text.indexOf('/table-sound.js') < tbl.text.indexOf('/table-quiz.js'), 'script order: synth before table.js, glue before the quiz screen');
  for (const p of ['/play.html', '/dealer.html', '/index.html']) {
    const r = await page(p);
    ok(r.status === 200 && !/sound\.js/.test(r.text), `${p} never loads the synth (phones stay silent)`);
  }
  const js = await page('/sound.js'), demo = await page('/sound-demo.html'), glue = await page('/table-sound.js');
  ok(js.status === 200 && demo.status === 200 && glue.status === 200, 'sound.js, table-sound.js and sound-demo.html are served');
  ok(!/\bfetch\(|XMLHttpRequest|new Audio\(|\.(mp3|ogg|wav|m4a)\b|import\s/.test(js.text), 'synth is self-contained: no network, no audio files, no imports');
  for (const cue of ['lobby', 'question', 'tick', 'reveal', 'correctCrowd', 'board', 'streak', 'podium', 'showdown', 'marketOpen']) ok(new RegExp(`\\b${cue}\\b`).test(js.text), `cue ${cue} defined`);
  for (const f of ['public/sound.js', 'public/table-sound.js']) {
    let good = true;
    try { execFileSync(process.execPath, ['--check', path.join(DIR, f)], { stdio: 'pipe' }); } catch { good = false; }
    ok(good, `node --check ${f}`);
  }
  // every melody bar in the data adds up to a whole 4/4 bar of 16ths
  const src = fs.readFileSync(path.join(DIR, 'public/sound.js'), 'utf8');
  const bars = [...src.matchAll(/'((?:[~!]?(?:[A-G][#b]?\d|-):\d+\s*)+)'/g)].map((m) => m[1]);
  const bad = bars.filter((b) => b.trim().split(/\s+/).reduce((a, t) => a + Number(t.split(':')[1]), 0) % 16 !== 0);
  info(`${bars.length} melody bars`);
  ok(bars.length >= 25 && !bad.length, 'every melody bar is a whole number of 4/4 bars' + (bad.length ? ': ' + bad.join(' | ') : ''));
});
