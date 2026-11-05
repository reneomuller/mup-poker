// v4 tape: the live market tape on the projector. Pure functions on data the GET already loaded
// (meta, the current block's slips, players), so the tape costs no extra Redis commands.
import * as G from './game.js';

export const TAPE_MAX = 15;
export const NAME_MODES = ['initials', 'first', 'off'];

// feature value for `tapeNames`: one of NAME_MODES ('initials' when unknown, 'off' for false)
export function nameMode(v) {
  if (v === false) return 'off';
  return NAME_MODES.includes(v) ? v : 'initials';
}

// what the `features` op stores for `tapeNames`: a valid mode, or a plain boolean (old clients and
// tests switch every flag with true/false: true reads as 'initials', false as 'off')
export const flagValue = (v) => (typeof v === 'boolean' ? v : nameMode(v));

// „Jana Nováková“ → 'initials': „J. N.“, 'first': „Jana N.“, 'off': ''
export function whoOf(name, mode) {
  mode = nameMode(mode);
  if (mode === 'off') return '';
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const ini = (w) => w.charAt(0).toLocaleUpperCase('cs-CZ') + '.';
  const last = parts.length > 1 ? ' ' + ini(parts[parts.length - 1]) : '';
  return mode === 'first' ? parts[0] + last : ini(parts[0]) + last;
}

const amounts = (m, teams) => {
  const out = {};
  for (const [t, e] of Object.entries(m || {})) {
    const a = Math.round(Number(e?.amt) || 0);
    if (a > 0 && teams.has(t)) out[t] = a;
  }
  return out;
};

// The last TAPE_MAX submitted class trades of the current block, newest first.
// Same set as `live`: submitted, non-ghost, non-RJ slips of known players, only while class trades are pending.
export function tapeOf(meta, slips, players) {
  if (!['betting', 'closed'].includes(meta.phase) || meta.settled?.[meta.block + 'c']) return [];
  const mode = nameMode(meta.features?.tapeNames);
  const teams = new Set((meta.teams || []).map((t) => t.id));
  const rows = [];
  for (const [sid, sl] of Object.entries(slips || {})) {
    const p = players?.[sid];
    if (sid === G.RJ || !p || p.ghost || !sl?.submitted) continue;
    const inn = amounts(sl.in, teams), out = amounts(sl.out, teams);
    if (!Object.keys(inn).length && !Object.keys(out).length) continue;
    rows.push({ ts: Number(sl.ts) || 0, who: whoOf(p.name, mode), team: p.team, in: inn, out, _k: sid });
  }
  rows.sort((a, b) => b.ts - a.ts || (a._k < b._k ? -1 : 1));
  return rows.slice(0, TAPE_MAX).map(({ _k, ...r }) => r);
}

// hook for publicState: `...T.publicTape(meta, slips, players)`
export const publicTape = (meta, slips, players) => (meta.features?.tape === false ? {} : { tape: tapeOf(meta, slips, players) });
