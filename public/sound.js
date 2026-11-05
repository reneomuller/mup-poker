// v4 sound lane: an ORIGINAL quiz-show soundtrack for the projector, synthesised with WebAudio (no audio files,
// no dependencies). Bouncy F-major lobby groove, a D-minor countdown pulse, stings and a fanfare, all "slightly
// wonky": a slow tape-wow LFO detunes every melodic voice by a few cents, a soft waveshaper adds crunch, and
// a few notes in the data scoop in from flat ("~") or fall from sharp ("!") on purpose.
//   window.MupSound: unlock(), setEnabled(b), enabled, setVolume(0..1), setWobble(0..1), cue(name, opts), stopAll()
//   cues: lobby, question ({ endsAt, serverNow }), tick, reveal ({ crowd }), correctCrowd, board, streak, podium,
//         showdown, marketOpen; every cue also takes { delay } in seconds.
(function () {
  'use strict';
  const LSK = { on: 'mup.sound.on', vol: 'mup.sound.vol', wob: 'mup.sound.wobble' };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(+x) ? +x : a));
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  // ---------- notes and melodies as data ----------
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(s) {
    const m = /^([A-G])(#|b?)(\d)$/.exec(s);
    if (!m) throw new Error('MupSound: bad note ' + s);
    return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  // "C5:2 ~Ab4:2 -:4" = note:length in 16ths, "-" is a rest, "~" scoops up from flat, "!" falls from sharp
  function mel(str, tr = 0) {
    const out = [];
    let s = 0;
    for (const tok of str.trim().split(/\s+/)) {
      const [nm, d] = tok.split(':');
      const len = Number(d) || 1;
      if (nm !== '-') {
        const w = nm[0] === '~' ? -1 : nm[0] === '!' ? 1 : 0;
        out.push({ s, d: len, n: midi(w ? nm.slice(1) : nm) + tr, w });
      }
      s += len;
    }
    out.len = s;
    return out;
  }
  // chord name -> bass root + close voicing (all transposable by semitones)
  const CH = {
    F: ['F2', 'A3 C4 F4'], Dm: ['D3', 'A3 D4 F4'], Bb: ['Bb2', 'Bb3 D4 F4'], C: ['C3', 'G3 C4 E4'], C7: ['C3', 'G3 Bb3 E4'],
    Am: ['A2', 'A3 C4 E4'], Gm: ['G2', 'G3 Bb3 D4'], A: ['A2', 'A3 C#4 E4'], D: ['D3', 'A3 D4 F#4'],
  };
  const chord = (name, tr = 0) => ({ root: midi(CH[name][0]) + tr, notes: CH[name][1].split(' ').map((x) => midi(x) + tr) });
  const halves = (c) => (Array.isArray(c) ? c : [c, c]);

  // Lobby: 16 bars in F major, played twice (32 bars) with a glockenspiel pass and a drum breakdown the 2nd time.
  const LOBBY = {
    bpm: 116, swing: 0.2, bars: 32, loop: true,
    ch: ['F', 'Dm', 'Bb', 'C', 'F', 'Dm', ['Gm', 'C'], 'F', 'Bb', 'C', 'Am', 'Dm', 'Gm', 'C', 'F', 'C7'],
    mel: [
      'C5:2 A4:2 C5:2 F5:4 E5:2 D5:2 C5:2',
      'D5:3 A4:3 F4:2 A4:2 D5:2 E5:2 F5:2',
      'G5:4 F5:2 D5:2 Bb4:4 -:2 D5:2',
      'C5:2 Bb4:2 A4:2 G4:2 ~Ab4:2 G4:2 E4:4',
      'F4:2 A4:2 C5:2 F5:2 -:2 F5:1 G5:1 A5:2 F5:2',
      'D5:4 F5:2 E5:2 D5:2 A4:4 -:2',
      'Bb4:2 D5:2 G5:2 F5:2 E5:2 G5:2 C5:2 E5:2',
      'F5:6 -:2 C5:1 D5:1 E5:1 -:1 F5:2 -:2',
      'D5:2 F5:2 D5:2 Bb4:2 -:2 Bb4:2 C5:2 D5:2',
      'E5:2 G5:2 E5:2 C5:2 -:4 G4:2 C5:2',
      'A5:3 G5:3 E5:2 C5:2 E5:2 A4:4',
      'F5:3 E5:3 D5:2 A4:4 -:2 A4:1 C5:1',
      'D5:2 Bb4:2 G4:2 Bb4:2 D5:2 G5:4 F5:2',
      'E5:2 F5:2 G5:2 E5:2 C5:4 ~F#5:2 G5:2',
      'A5:4 F5:2 C5:2 A4:2 C5:2 F5:4',
      'E5:2 -:2 G4:2 Bb4:2 C5:2 D5:2 E5:2 G5:2',
    ],
  };
  // bass per half bar: [step, semitones above root, length]
  const BOUNCE = [[0, 0, 3], [3, 12, 2], [6, 7, 2]];
  LOBBY.bar = function (b, tr) {
    const i = b % 16, pass = b >> 4, ev = [];
    halves(this.ch[i]).forEach((name, h) => {
      const c = chord(name, tr);
      for (const [s, iv, d] of BOUNCE) ev.push({ s: h * 8 + s, d, i: 'bass', n: c.root + iv, v: s ? 0.8 : 1 });
      for (const s of [2, 6]) for (const n of c.notes) ev.push({ s: h * 8 + s, d: 1.5, i: 'mallet', n, v: 0.55 });
    });
    const glock = pass === 1 && i < 8;
    for (const e of mel(this.mel[i], tr)) ev.push({ ...e, i: glock ? 'mallet' : 'lead', n: e.n + (glock ? 12 : 0), v: glock ? 1.25 : 1 });
    const brk = pass === 1 && i >= 8 && i < 12;
    if (!brk) { ev.push({ s: 0, i: 'kick' }, { s: 8, i: 'kick' }); if (i % 2) ev.push({ s: 10, i: 'kick', v: 0.6 }); }
    if (i === 15) for (const s of [12, 13, 14, 15]) ev.push({ s, i: 'snare', v: 0.45 + (s - 12) * 0.15 });
    else ev.push({ s: 4, i: 'clap' }, { s: 12, i: 'clap' });
    for (let s = 0; s < 16; s += 2) ev.push({ s, i: 'hat', v: s % 4 ? 0.9 : 0.5, open: s === 14 && i % 4 === 3 });
    if (i === 0) ev.push({ s: 0, i: 'crash', v: 0.7 });
    return ev;
  };

  // Question: 8 bars in D minor, a driving 8th-note bass pulse; in the last 5 s the tempo climbs 126 -> 150 BPM,
  // the hats go to 16ths and a noise riser builds, with a tick on each of the last five seconds.
  const QUESTION = {
    bpm: 126, hotBpm: 150, bars: 8, loop: true,
    ch: ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A'],
    motif: { 3: 'A5:1 -:1 G5:1 -:1 F5:1 -:1 E5:1 -:1 ~F5:2 -:2 D5:2 -:2', 7: 'E5:1 -:1 F5:1 -:1 E5:1 -:1 C#5:1 -:1 !E5:2 -:2 A4:2 -:2' },
  };
  const PULSE = [0, 0, 12, 0, 0, 12, 0, 7];
  const ARP = [0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2, 1, 2, 0, 2];
  QUESTION.bar = function (b, tr) {
    const c = chord(this.ch[b], tr), ev = [];
    PULSE.forEach((iv, k) => ev.push({ s: k * 2, d: 1.6, i: 'bass', n: c.root + iv, v: k % 2 ? 0.7 : 0.95 }));
    ARP.forEach((k, s) => ev.push({ s, d: 0.9, i: 'pluck', n: c.notes[k] + 12 + (b % 2 && s >= 8 ? 12 : 0), v: s % 4 ? 0.6 : 0.9, arp: 1 }));
    for (const s of [0, 4, 8, 12]) ev.push({ s, i: 'kick', v: 0.8 });
    for (const s of [2, 6, 10, 14]) ev.push({ s, i: 'hat', v: 0.6 });
    for (const s of [4, 12]) ev.push({ s, i: 'clap', v: 0.45 });
    if (this.motif[b]) for (const e of mel(this.motif[b], tr)) ev.push({ ...e, i: 'lead', v: 0.75 });
    return ev;
  };

  // Leaderboard jingle: two bouncy bars and a landing chord.
  const BOARD = {
    bpm: 132, swing: 0.15, bars: 3, loop: false,
    ch: ['F', ['Bb', 'C'], 'F'],
    mel: ['A4:2 C5:2 F5:2 A5:2 G5:3 F5:1 D5:2 E5:2', 'F5:2 D5:1 F5:1 Bb5:4 G5:2 E5:1 G5:1 ~C6:4', 'A5:8 -:8'],
  };
  BOARD.bar = function (b, tr) {
    const ev = [];
    if (b === 2) {
      const c = chord('F', tr);
      ev.push({ s: 0, i: 'kick' }, { s: 0, i: 'crash', v: 0.8 }, { s: 0, d: 8, i: 'bass', n: c.root });
      for (const n of [...c.notes, c.notes[2] + 4]) ev.push({ s: 0, d: 7, i: 'brass', n, v: 0.8 });
    } else {
      halves(this.ch[b]).forEach((name, h) => {
        const c = chord(name, tr);
        for (const [s, iv, d] of BOUNCE) ev.push({ s: h * 8 + s, d, i: 'bass', n: c.root + iv });
        for (const s of [2, 6]) for (const n of c.notes) ev.push({ s: h * 8 + s, d: 1.5, i: 'mallet', n, v: 0.6 });
      });
      ev.push({ s: 0, i: 'kick' }, { s: 8, i: 'kick' }, { s: 4, i: 'clap' }, { s: 12, i: b ? 'snare' : 'clap', v: 0.8 });
      if (b === 1) ev.push({ s: 14, i: 'snare', v: 0.6 }, { s: 15, i: 'snare', v: 0.8 });
      for (let s = 0; s < 16; s += 2) ev.push({ s, i: 'hat', v: s % 4 ? 0.9 : 0.5 });
    }
    for (const e of mel(this.mel[b], tr)) ev.push({ ...e, i: 'lead', v: b === 2 ? 0.9 : 1 });
    return ev;
  };

  // Final fanfare: four bars of brass + lead in unison, a long tonic chord, and a cheeky out-of-place "pling" at the end.
  const PODIUM = {
    bpm: 104, bars: 6, loop: false,
    ch: ['F', ['Bb', 'C'], ['Dm', 'Bb'], ['C', 'C7'], 'F', 'F'],
    mel: [
      'C5:1 C5:1 C5:2 F5:6 A5:2 G5:2 F5:2',
      'D5:2 F5:2 Bb5:4 C6:3 Bb5:1 A5:2 G5:2',
      'A5:4 F5:2 D5:2 F5:3 G5:1 ~A5:2 Bb5:2',
      'C6:6 A5:1 Bb5:1 G5:4 E5:2 G5:2',
      'F5:14 -:2', '-:16',
    ],
  };
  PODIUM.bar = function (b, tr) {
    const ev = [];
    if (b === 5) { ev.push({ s: 2, d: 1, i: 'mallet', n: midi('C6') + tr, v: 1.2 }, { s: 4, d: 2, i: 'mallet', n: midi('F#6') + tr, v: 1.2, w: -1 }); return ev; }
    halves(this.ch[b]).forEach((name, h) => {
      const c = chord(name, tr), long = b === 4;
      ev.push({ s: h * 8, d: long ? 15 : 7, i: 'bass', n: c.root, v: 0.9 });
      if (!long || !h) for (const n of c.notes) ev.push({ s: h * 8, d: long ? 15 : 6, i: 'brass', n, v: 0.7 });
    });
    for (const e of mel(this.mel[b], tr)) ev.push({ ...e, i: 'brass', v: 0.9 }, { ...e, i: 'lead', v: 0.6 });
    if (b === 0 || b === 4) ev.push({ s: 0, i: 'crash' });
    if (b === 4) ev.push({ s: 0, i: 'kick' });
    else {
      ev.push({ s: 0, i: 'kick' }, { s: 8, i: 'kick' }, { s: 4, i: 'snare', v: 0.6 }, { s: 12, i: 'snare', v: 0.6 });
      for (let s = 0; s < 16; s += 2) ev.push({ s, i: 'hat', v: 0.5 });
    }
    if (b === 3) for (const s of [12, 13, 14, 15]) ev.push({ s, i: 'tom', v: 0.5 + (s - 12) * 0.15 });
    return ev;
  };
  const SONGS = { lobby: LOBBY, question: QUESTION, board: BOARD, podium: PODIUM };

  // ---------- synth engine (one per AudioContext, so the same code renders offline for tests) ----------
  const curve = (f, n = 2049) => { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = f((i / (n - 1)) * 2 - 1); return c; };
  // linear up to 0.6, then a soft knee that never exceeds 0.85: the last safety net after the limiter
  const softClip = (x) => { const a = Math.abs(x); return Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.25 * Math.tanh((a - 0.6) / 0.25)); };
  const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  function Engine(ctx) {
    const E = { ctx, rnd: rng(7) };
    const gain = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const filt = (type, f, q = 0.7) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    E.gain = gain; E.filt = filt;
    const bus = gain(1), dry = gain(1), wet = gain(0), crunch = ctx.createWaveShaper();
    crunch.curve = curve((x) => Math.tanh(3 * x) / Math.tanh(3)); crunch.oversample = 'none';
    const tone = filt('lowpass', 8500, 0.5), vol = gain(0.5);
    const comp = ctx.createDynamicsCompressor(), lim = ctx.createDynamicsCompressor();
    const set = (n, o) => { for (const k in o) n[k].value = o[k]; };
    set(comp, { threshold: -20, knee: 10, ratio: 3, attack: 0.004, release: 0.25 });
    set(lim, { threshold: -6, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
    const post = gain(0.6), clip = ctx.createWaveShaper();
    clip.curve = curve(softClip); clip.oversample = 'none';
    bus.connect(dry); bus.connect(crunch); crunch.connect(wet);
    dry.connect(tone); wet.connect(tone); tone.connect(vol); vol.connect(comp); comp.connect(lim); lim.connect(post); post.connect(clip); clip.connect(ctx.destination);
    // a short dark echo for the melodic voices (one delay line: cheap)
    E.fx = gain(0.16);
    const dl = ctx.createDelay(1), fb = gain(0.25), dlp = filt('lowpass', 2400);
    dl.delayTime.value = 0.39;
    E.fx.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(bus);
    // tape wow (two slow sines) + flutter, in cents, shared by every melodic oscillator
    E.wow = gain(0);
    E.lfos = [[0.53, 1], [0.21, 0.6], [6.1, 0.22]].map(([f, a]) => { const o = ctx.createOscillator(); o.frequency.value = f; const k = gain(a); o.connect(k); k.connect(E.wow); o.start(); return o; });
    E.bus = bus;
    E.setVolume = (v) => vol.gain.setTargetAtTime(Math.pow(clamp(v, 0, 1), 1.6) * 1.1, ctx.currentTime, 0.03);
    E.setWobble = (w) => {
      w = clamp(w, 0, 1);
      const t = ctx.currentTime;
      E.wow.gain.setTargetAtTime((w * 16) / 1.8, t, 0.05); // up to ~16 cents peak at full wobble
      wet.gain.setTargetAtTime(w * 0.5, t, 0.05);
      dry.gain.setTargetAtTime(1 - w * 0.3, t, 0.05);
    };
    E.noise = (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0), r = rng(99);
      for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
      return b;
    })();
    return E;
  }

  // ---------- voices ----------
  function cleanup(src, nodes, wowTo) {
    src.onended = () => { try { src.disconnect(); if (wowTo) wowTo.E.wow.disconnect(wowTo.p); for (const n of nodes) n.disconnect(); } catch {} };
  }
  function osc(E, dest, type, f, t, end, det = 0, wob = true) {
    const o = E.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (det) o.detune.setValueAtTime(det, t);
    if (wob) E.wow.connect(o.detune);
    o.connect(dest); o.start(t); o.stop(end);
    o._wob = wob;
    return o;
  }
  function noise(E, dest, t, end) {
    const s = E.ctx.createBufferSource();
    s.buffer = E.noise; s.loop = true;
    s.connect(dest); s.start(t, E.rnd() * 0.9); s.stop(end);
    return s;
  }
  function adsr(p, t, dur, peak, a, d, s, r) {
    dur = Math.max(dur, a + 0.01);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(peak * s, t + a, d / 3);
    p.setTargetAtTime(0, t + dur, r / 5);
    return t + dur + r;
  }
  const bend = (o, t, w, det = 0) => { if (!w) return; o.detune.setValueAtTime(det + w * 70, t); o.detune.linearRampToValueAtTime(det, t + 0.14); };
  function decay(p, t, peak, len, a = 0.002) { p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a); p.exponentialRampToValueAtTime(0.0006, t + len); }
  // each melodic voice: (E, dest, t, dur, midi, vel, wonk)
  const INST = {
    lead(E, dest, t, dur, n, v = 1, w = 0) {
      const f = hz(n), vg = E.gain(0), lp = E.filt('lowpass', 1600, 2);
      const end = adsr(vg.gain, t, dur, 0.07 * v, 0.006, 0.2, 0.55, 0.09);
      lp.frequency.setValueAtTime(900, t); lp.frequency.linearRampToValueAtTime(3400, t + 0.02); lp.frequency.setTargetAtTime(1700, t + 0.02, 0.12);
      lp.connect(vg); vg.connect(dest); vg.connect(E.fx);
      const a = osc(E, lp, 'square', f, t, end), b = osc(E, lp, 'triangle', f, t, end, 7);
      bend(a, t, w); bend(b, t, w, 7);
      cleanup(a, [], { E, p: a.detune }); cleanup(b, [lp, vg], { E, p: b.detune });
    },
    bass(E, dest, t, dur, n, v = 1) {
      const f = hz(n), vg = E.gain(0), lp = E.filt('lowpass', 1600, 4);
      const end = adsr(vg.gain, t, dur, 0.15 * v, 0.004, 0.14, 0.55, 0.06);
      lp.frequency.setValueAtTime(1900, t); lp.frequency.setTargetAtTime(360, t, 0.07);
      lp.connect(vg); vg.connect(dest);
      const a = osc(E, lp, 'sawtooth', f, t, end, 0, false), b = osc(E, vg, 'sine', f, t, end, 0, false);
      cleanup(a, []); cleanup(b, [lp, vg]);
    },
    mallet(E, dest, t, dur, n, v = 1, w = 0) {
      const f = hz(n), vg = E.gain(0), hi = E.gain(0.16), end = t + 0.5 + dur * 0.2;
      decay(vg.gain, t, 0.06 * v, end - t);
      hi.connect(vg); vg.connect(dest); vg.connect(E.fx);
      const a = osc(E, vg, 'sine', f, t, end), b = osc(E, hi, 'sine', f * 4, t, end);
      bend(a, t, w); bend(b, t, w);
      cleanup(a, [], { E, p: a.detune }); cleanup(b, [hi, vg], { E, p: b.detune });
    },
    pluck(E, dest, t, dur, n, v = 1) {
      const vg = E.gain(0), end = t + 0.22;
      decay(vg.gain, t, 0.05 * v, 0.22);
      vg.connect(dest);
      const a = osc(E, vg, 'triangle', hz(n), t, end);
      cleanup(a, [vg], { E, p: a.detune });
    },
    brass(E, dest, t, dur, n, v = 1, w = 0) {
      const f = hz(n), vg = E.gain(0), lp = E.filt('lowpass', 600, 1);
      const end = adsr(vg.gain, t, dur, 0.045 * v, 0.03, 0.35, 0.7, 0.2);
      lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(2800, t + 0.06); lp.frequency.setTargetAtTime(1500, t + 0.06, 0.3);
      lp.connect(vg); vg.connect(dest);
      const a = osc(E, lp, 'sawtooth', f, t, end, -8), b = osc(E, lp, 'sawtooth', f, t, end, 8);
      bend(a, t, w, -8); bend(b, t, w, 8);
      cleanup(a, [], { E, p: a.detune }); cleanup(b, [lp, vg], { E, p: b.detune });
    },
    bell(E, dest, t, dur, n, v = 1) {
      const f = hz(n), len = Math.max(1, dur);
      const P = [[0.56, 1, 1], [0.92, 0.67, 0.9], [1.19, 1, 0.65], [1.71, 1.3, 0.55], [2, 1.3, 0.33], [2.74, 1, 0.35], [3, 0.9, 0.25], [4.07, 0.7, 0.2]];
      for (const [r, a, d] of P) {
        const g = E.gain(0);
        decay(g.gain, t, 0.022 * a * v, len * d, 0.001);
        g.connect(dest); g.connect(E.fx);
        cleanup(osc(E, g, 'sine', f * r, t, t + len * d + 0.05, 0, false), [g]);
      }
    },
    kick(E, dest, t, dur, n, v = 1) {
      const g = E.gain(0), o = osc(E, g, 'sine', 150, t, t + 0.4, 0, false);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.13);
      decay(g.gain, t, 0.5 * v, 0.38);
      g.connect(dest); cleanup(o, [g]);
    },
    tom(E, dest, t, dur, n, v = 1) {
      const g = E.gain(0), o = osc(E, g, 'sine', 140, t, t + 0.35, 0, false);
      o.frequency.exponentialRampToValueAtTime(85, t + 0.3);
      decay(g.gain, t, 0.3 * v, 0.32);
      g.connect(dest); cleanup(o, [g]);
    },
    snare(E, dest, t, dur, n, v = 1) {
      const bp = E.filt('bandpass', 1800, 0.9), g = E.gain(0), tg = E.gain(0);
      decay(g.gain, t, 0.2 * v, 0.17); decay(tg.gain, t, 0.12 * v, 0.09);
      bp.connect(g); g.connect(dest); tg.connect(dest);
      cleanup(noise(E, bp, t, t + 0.2), [bp, g]);
      const o = osc(E, tg, 'triangle', 190, t, t + 0.12, 0, false);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.08); cleanup(o, [tg]);
    },
    clap(E, dest, t, dur, n, v = 1) {
      const bp = E.filt('bandpass', 1300, 1.1), g = E.gain(0), p = g.gain, pk = 0.2 * v;
      p.setValueAtTime(0, t);
      for (const k of [0, 0.011, 0.022]) { p.setValueAtTime(pk, t + k); p.exponentialRampToValueAtTime(pk * 0.15, t + k + 0.009); }
      p.setValueAtTime(pk * 0.8, t + 0.033); p.exponentialRampToValueAtTime(0.0006, t + 0.2);
      bp.connect(g); g.connect(dest);
      cleanup(noise(E, bp, t, t + 0.22), [bp, g]);
    },
    hat(E, dest, t, dur, n, v = 1, w, e) {
      const hp = E.filt('highpass', 7200, 0.8), g = E.gain(0), len = e && e.open ? 0.22 : 0.045;
      decay(g.gain, t, 0.045 * v, len, 0.001);
      hp.connect(g); g.connect(dest);
      cleanup(noise(E, hp, t, t + len + 0.02), [hp, g]);
    },
    crash(E, dest, t, dur, n, v = 1) {
      const hp = E.filt('highpass', 3800, 0.6), g = E.gain(0), len = 1.5;
      decay(g.gain, t, 0.09 * v, len, 0.002);
      hp.connect(g); g.connect(dest);
      cleanup(noise(E, hp, t, t + len + 0.05), [hp, g]);
    },
    tock(E, dest, t, dur, n, v = 1, w, e) {
      const g = E.gain(0), ng = E.gain(0), bp = E.filt('bandpass', 2600, 3);
      decay(g.gain, t, 0.22 * v, 0.09, 0.001); decay(ng.gain, t, 0.12 * v, 0.025, 0.001);
      g.connect(dest); bp.connect(ng); ng.connect(dest);
      cleanup(osc(E, g, 'sine', e && e.hi ? 1568 : 1175, t, t + 0.1, 0, false), [g]);
      cleanup(noise(E, bp, t, t + 0.04), [bp, ng]);
    },
    riser(E, dest, t, dur, n, v = 1) {
      const bp = E.filt('bandpass', 300, 3), g = E.gain(0), end = t + dur;
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(5000, end);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1 * v, end - 0.05); g.gain.linearRampToValueAtTime(0, end + 0.04);
      bp.connect(g); g.connect(dest);
      cleanup(noise(E, bp, t, end + 0.06), [bp, g]);
    },
  };
  const play = (E, dest, i, t, dur, n, v, w, e) => INST[i](E, dest, t, dur, n, v == null ? 1 : v, w || 0, e);

  // ---------- sequencer (pattern data -> events, lookahead scheduling on the audio clock) ----------
  function compile(song, tr) {
    const steps = song.bars * 16, at = Array.from({ length: steps }, () => []);
    for (let b = 0; b < song.bars; b++) for (const e of song.bar(b, tr)) at[b * 16 + e.s].push(e);
    return { steps, at };
  }
  const loopSeconds = (name) => (SONGS[name] ? (SONGS[name].bars * 240) / SONGS[name].bpm : 0);
  // P.pump(until) schedules every step that starts before `until`; real time calls it every ~30 ms, offline once.
  function Player(E, song, dest, t0, o = {}) {
    const c = compile(song, o.tr || 0);
    const P = { loop: !!song.loop, step: 0, t: t0, done: false, end: o.end ?? Infinity, ticks: [] };
    P.hot = (t) => (P.end === Infinity ? 0 : clamp(1 - (P.end - t) / 5, 0, 1));
    P.pump = function (until) {
      for (const k of P.ticks) if (!k.done && k.t < until) { k.done = true; if (k.t >= E.ctx.currentTime) play(E, dest, k.i || 'tock', k.t, k.dur || 0, 0, k.v ?? (k.hi ? 1 : 0.8), 0, k); }
      while (!P.done && P.t < until) {
        if ((!P.loop && P.step >= c.steps) || P.t >= P.end - 1e-4) { P.done = true; if (P.end < Infinity && o.onEnd) o.onEnd(P.end); break; }
        const hot = P.hot(P.t);
        const sd = 15 / (song.bpm + ((song.hotBpm || song.bpm) - song.bpm) * hot);
        const sw = P.step % 2 ? (song.swing || 0) * sd : 0, t = P.t + sw;
        for (const e of c.at[P.step % c.steps]) play(E, dest, e.i, t, (e.d || 1) * sd * 0.9, e.n, (e.v ?? 1) * (e.arp ? 1 + 0.5 * hot : 1), e.w, e);
        if (hot > 0 && P.step % 2) play(E, dest, 'hat', t, 0, 0, 0.35 + 0.35 * hot);
        P.t += sd; P.step++;
      }
      return P.done;
    };
    return P;
  }

  // ---------- cues ----------
  // each returns a Player for sequenced cues (lobby, question, board, podium) or schedules everything at once.
  const CUES = {
    lobby: (E, out, t0, o) => Player(E, LOBBY, out, t0, o),
    question(E, out, t0, o) {
      const left = (Number(o.endsAt) - Number(o.serverNow ?? Date.now())) / 1000;
      const secs = Number.isFinite(left) ? left : 20;
      if (secs < 0.4) return null;
      const end = t0 + secs;
      const P = Player(E, QUESTION, out, t0, { ...o, end, onEnd: (te) => { play(E, out, 'kick', te, 0, 0, 1); play(E, out, 'crash', te, 0, 0, 0.8); play(E, out, 'brass', te, 0.5, midi('D4'), 0.7); play(E, out, 'brass', te, 0.5, midi('A4'), 0.7); } });
      for (let k = 5; k >= 1; k--) if (secs - k > 0.05) P.ticks.push({ t: end - k, hi: k === 1 });
      if (secs > 5.2) P.ticks.push({ t: end - 5, i: 'riser', dur: 5, v: 1 });
      return P;
    },
    tick(E, out, t0, o) { play(E, out, 'tock', t0, 0, 0, 1, 0, { hi: !!o.hi }); return 0.2; },
    reveal(E, out, t0, o) {
      // "ta-DAA": two pickup notes, then a big F chord that sags a little at the end like tired tape
      play(E, out, 'snare', t0, 0, 0, 0.5); play(E, out, 'snare', t0 + 0.035, 0, 0, 0.7);
      play(E, out, 'lead', t0, 0.08, midi('G4'), 0.9); play(E, out, 'lead', t0 + 0.11, 0.08, midi('C5'), 0.9);
      const t = t0 + 0.24;
      play(E, out, 'kick', t, 0, 0, 1); play(E, out, 'crash', t, 0, 0, 0.9);
      play(E, out, 'bass', t, 0.9, midi('F2'), 1);
      for (const n of ['F4', 'A4', 'C5']) play(E, out, 'brass', t, 0.85, midi(n), 0.9);
      play(E, out, 'lead', t, 0.85, midi('F5'), 1);
      if (o.crowd) CUES.correctCrowd(E, out, t0 + 0.75, {});
      return o.crowd ? 3.2 : 1.8;
    },
    correctCrowd(E, out, t0) {
      const notes = ['F4', 'A4', 'C5', 'F5', 'A5', 'C6'].map(midi);
      notes.forEach((n, k) => { play(E, out, 'mallet', t0 + k * 0.075, 0.1, n, 1.3); play(E, out, 'pluck', t0 + k * 0.075, 0.1, n, 1); });
      play(E, out, 'bell', t0 + 0.48, 1.6, midi('F6'), 0.9);
      play(E, out, 'lead', t0 + 0.48, 0.12, midi('A6'), 0.45); play(E, out, 'lead', t0 + 0.6, 0.3, midi('C7'), 0.45, 1);
      // applause: short band-passed noise claps, dense at first then thinning out
      const r = rng(31);
      for (let k = 0; k < 34; k++) {
        const t = t0 + 0.15 + Math.pow(r(), 1.6) * 1.9;
        const bp = E.filt('bandpass', 900 + r() * 1700, 1.4), g = E.gain(0);
        decay(g.gain, t, (0.05 + r() * 0.05) * (1 - (t - t0) / 2.4), 0.04 + r() * 0.04, 0.001);
        bp.connect(g); g.connect(out);
        cleanup(noise(E, bp, t, t + 0.1), [bp, g]);
      }
      return 2.4;
    },
    board: (E, out, t0, o) => Player(E, BOARD, out, t0, o),
    streak(E, out, t0) {
      // whoosh + crackle + three rising stabs, the last one overshooting and sliding down into place
      play(E, out, 'riser', t0, 0.45, 0, 1.1);
      const r = rng(5);
      for (let k = 0; k < 14; k++) {
        const t = t0 + 0.3 + r() * 0.9, hp = E.filt('highpass', 2500, 0.7), g = E.gain(0);
        decay(g.gain, t, 0.04 + r() * 0.05, 0.012, 0.0005);
        hp.connect(g); g.connect(out); cleanup(noise(E, hp, t, t + 0.03), [hp, g]);
      }
      const stabs = [['Bb3 D4 F4', 0.45], ['C4 E4 G4', 0.6], ['D4 F#4 A4', 0.75]];
      stabs.forEach(([ns, t], k) => {
        for (const n of ns.split(' ')) play(E, out, 'brass', t0 + t, k === 2 ? 0.6 : 0.1, midi(n), 0.8, k === 2 ? 1 : 0);
        play(E, out, k === 2 ? 'kick' : 'tom', t0 + t, 0, 0, 0.8);
      });
      play(E, out, 'lead', t0 + 0.75, 0.55, midi('A5'), 0.9, 1);
      play(E, out, 'crash', t0 + 0.75, 0, 0, 0.6);
      return 2;
    },
    podium: (E, out, t0, o) => Player(E, PODIUM, out, t0, o),
    showdown(E, out, t0) {
      // 2.4 s snare roll that speeds up and swells over a rising low tom, then C7 -> F "ta-DAAA"
      const R = 2.4;
      let t = 0;
      while (t < R) { const k = t / R; play(E, out, 'snare', t0 + t, 0, 0, 0.15 + 0.5 * k * k); t += 1 / (11 + 17 * k); }
      const g = E.gain(0), o = osc(E, g, 'sine', 55, t0, t0 + R + 0.1, 0, false);
      o.frequency.linearRampToValueAtTime(82, t0 + R);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.12, t0 + R); g.gain.linearRampToValueAtTime(0, t0 + R + 0.08);
      g.connect(out); cleanup(o, [g]);
      const a = t0 + R, b = a + 0.2;
      for (const n of ['C4', 'E4', 'Bb4']) play(E, out, 'brass', a, 0.14, midi(n), 0.9);
      play(E, out, 'snare', a, 0, 0, 0.9);
      play(E, out, 'kick', b, 0, 0, 1); play(E, out, 'crash', b, 0, 0, 1);
      play(E, out, 'bass', b, 1.4, midi('F2'), 1);
      for (const n of ['F3', 'C4', 'F4', 'A4', 'C5']) play(E, out, 'brass', b, 1.3, midi(n), 0.85);
      play(E, out, 'lead', b, 1.3, midi('F5'), 0.9);
      return R + 2.4;
    },
    marketOpen(E, out, t0) {
      // the opening bell: ding-ding-ding
      for (const k of [0, 0.32, 0.64]) play(E, out, 'bell', t0 + k, 2.4, midi('A5'), k ? 0.85 : 1);
      return 3.2;
    },
  };
  const LOOPS = { lobby: 1, question: 1 };
  const ENDS_LOOP = { reveal: 1, board: 1, podium: 1, showdown: 1 };

  // ---------- real-time manager ----------
  const M = {
    ctx: null, E: null, loop: null, timer: 0, want: null, outs: new Set(), last: null,
    enabled: lsGet(LSK.on, '1') !== '0', allowed: true,
    vol: clamp(lsGet(LSK.vol, '0.7'), 0, 1), wob: clamp(lsGet(LSK.wob, '0.35'), 0, 1),
  };
  const pnow = () => (window.performance ? performance.now() : Date.now());
  const ready = () => !!(M.enabled && M.allowed && M.ctx && M.ctx.state === 'running');
  const notify = () => { try { API.onchange && API.onchange(API); } catch {} };
  function dropOut(out, at) {
    const t = M.ctx.currentTime;
    out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.setTargetAtTime(0, Math.max(t, at || t), 0.04);
    setTimeout(() => { try { out.disconnect(); } catch {} M.outs.delete(out); }, Math.max(0, ((at || t) - t) * 1000) + 500);
  }
  function stopLoop() {
    if (M.timer) clearTimeout(M.timer);
    M.timer = 0;
    if (M.loop) { M.loop.done = true; dropOut(M.loop.out); M.loop = null; }
  }
  function silence() { stopLoop(); if (M.ctx) for (const o of [...M.outs]) dropOut(o); }
  function pumpLoop() {
    M.timer = 0;
    const L = M.loop;
    if (!L || !M.ctx) return;
    const ahead = document.hidden ? 1.6 : 0.2;
    if (L.pump(M.ctx.currentTime + ahead)) { M.loop = null; dropOut(L.out, M.ctx.currentTime + 2.5); return; }
    M.timer = setTimeout(pumpLoop, document.hidden ? 500 : 30);
  }
  function cue(name, opts) {
    const o = opts && typeof opts === 'object' ? { ...opts } : {};
    if (!CUES[name]) return false;
    if (LOOPS[name]) M.want = { name, o, at: pnow() };
    else if (ENDS_LOOP[name]) M.want = null;
    if (!ready()) return false;
    try {
      // the final board plays the fanfare; „done“ right after it must not play it again
      if (name === 'podium' && M.last === 'podium') return false;
      if (name !== 'tick' && name !== 'streak' && name !== 'correctCrowd') M.last = name;
      if (LOOPS[name] && M.loop && M.loop.name === name && M.loop.key === String(o.endsAt)) return true;
      if (LOOPS[name] || ENDS_LOOP[name]) stopLoop();
      const E = M.E, out = E.gain(1);
      out.connect(E.bus); M.outs.add(out);
      const t0 = M.ctx.currentTime + 0.04 + clamp(o.delay, 0, 10);
      const r = CUES[name](E, out, t0, o);
      if (r && r.pump) {
        r.out = out; r.name = name; r.key = String(o.endsAt);
        if (r.loop) { M.loop = r; pumpLoop(); }
        else { r.pump(Infinity); dropOut(out, r.t + 3); }
      } else dropOut(out, t0 + (typeof r === 'number' ? r : 0.1) + 0.5);
      return true;
    } catch (e) { console.warn('MupSound', e); return false; }
  }
  // a loop asked for while audio was locked / muted starts as soon as it may (question: only the time that is left)
  function resumeWant() {
    notify();
    const w = M.want;
    if (!w || !ready() || M.loop) return;
    const o = { ...w.o };
    if (w.name === 'question' && o.serverNow != null) o.serverNow = Number(o.serverNow) + (pnow() - w.at);
    cue(w.name, o);
  }
  function unlock() {
    if (!AC) return false;
    try {
      if (!M.ctx) {
        M.ctx = new AC({ latencyHint: 'playback' });
        M.E = Engine(M.ctx);
        M.E.setVolume(M.vol); M.E.setWobble(M.wob);
        M.ctx.onstatechange = notify;
      }
      if (M.ctx.state !== 'running') M.ctx.resume().then(resumeWant, () => {});
      else resumeWant();
      return true;
    } catch (e) { console.warn('MupSound', e); return false; }
  }

  // offline render of a cue for tests and the demo page: Promise<AudioBuffer> (mono, 44.1 kHz)
  function renderOffline(name, secs, opts = {}) {
    if (!OAC || !CUES[name]) return Promise.reject(new Error('no offline audio / unknown cue'));
    const sr = opts.sampleRate || 44100, ctx = new OAC(1, Math.ceil(secs * sr), sr);
    const E = Engine(ctx);
    E.setVolume(opts.volume ?? 1); E.setWobble(opts.wobble ?? M.wob);
    const out = E.gain(1);
    out.connect(E.bus);
    const r = CUES[name](E, out, 0.05, { endsAt: 12000, serverNow: 0, ...opts });
    if (r && r.pump) {
      // same lookahead idea as real time: schedule ~1 s ahead, then let the render catch up
      r.pump(1.2);
      for (let t = 1; t < secs; t += 1) ctx.suspend(t).then(() => { r.pump(t + 1.2); return ctx.resume(); });
    }
    return ctx.startRendering();
  }

  const API = {
    unlock,
    cue,
    stopAll() { M.want = null; silence(); },
    setEnabled(b) { M.enabled = !!b; lsSet(LSK.on, M.enabled ? '1' : '0'); if (M.enabled) unlock(); else silence(); notify(); },
    get enabled() { return M.enabled; },
    get unlocked() { return !!(M.ctx && M.ctx.state === 'running'); },
    get playing() { return ready(); },
    // feature flag `sound` from the server: off = silent, nothing scheduled
    setAllowed(b) { b = !!b; if (b === M.allowed) return; M.allowed = b; if (b) resumeWant(); else silence(); notify(); },
    get allowed() { return M.allowed; },
    setVolume(v) { M.vol = clamp(v, 0, 1); lsSet(LSK.vol, M.vol); if (M.E) M.E.setVolume(M.vol); },
    get volume() { return M.vol; },
    setWobble(w) { M.wob = clamp(w, 0, 1); lsSet(LSK.wob, M.wob); if (M.E) M.E.setWobble(M.wob); },
    get wobble() { return M.wob; },
    cues: Object.keys(CUES),
    loopSeconds,
    renderOffline,
    get _debug() { return { loop: M.loop ? M.loop.name : null, step: M.loop ? M.loop.step : null, outs: M.outs.size, t: M.ctx ? +M.ctx.currentTime.toFixed(2) : null, state: M.ctx ? M.ctx.state : 'none', want: M.want ? M.want.name : null }; },
    _songs: SONGS, _mel: mel,
    onchange: null,
  };
  window.MupSound = API;
})();
