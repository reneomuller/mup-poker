// Blok 4 PIN fallback: match a typed team name / player name to the nearest one (diacritics and case
// insensitive, typo tolerant). Pure functions, no storage.

// "Zdravotní Přehled!" -> "zdravotni prehled"
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

export function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// 0..1, 1 = same after folding. Takes the best of: whole string, words in any order, prefix, words
// typed without spaces. "plug" vs "plugg" = 0.9, "zdravotni prehled" vs "Zdravotni Prehled" = 1.
// strict (names): every word of both sides must be matched; loose (teams): one typed word may stand for the team
export function similarity(typed, target, strict = false) {
  const a = fold(typed), b = fold(target);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ratio = (x, y) => 1 - lev(x, y) / Math.max(x.length, y.length);
  let best = ratio(a, b);
  const as = a.replace(/ /g, ''), bs = b.replace(/ /g, '');
  if (as === bs) best = Math.max(best, 0.98);
  else best = Math.max(best, ratio(as, bs) - 0.02);
  // prefix: "plug" -> "plugg", "zdrav prehl" is handled by the word pass below
  if (!strict && bs.startsWith(as) && as.length >= 3) best = Math.max(best, 0.8 + 0.2 * (as.length / bs.length));
  // words in any order: each typed word against its best target word
  const aw = a.split(' '), bw = b.split(' ');
  if (aw.length > 1 || bw.length > 1) {
    const used = new Set();
    let score = 0;
    for (const w of aw) {
      let top = 0, at = -1;
      bw.forEach((x, i) => {
        if (used.has(i)) return;
        const r = x.startsWith(w) && w.length >= 3 ? Math.max(ratio(w, x), 0.85) : ratio(w, x);
        if (r > top) { top = r; at = i; }
      });
      if (at >= 0) used.add(at);
      score += top;
    }
    const cover = strict ? score / Math.max(aw.length, bw.length) : (score / aw.length) * (0.75 + 0.25 * Math.min(1, aw.length / bw.length));
    best = Math.max(best, cover - 0.01);
  }
  return Math.max(0, Math.min(1, Math.round(best * 1000) / 1000));
}

// Nearest team to what the student typed. { team, score, sure, ranked } – `sure` when the best is clearly
// the one (high score and ahead of the runner-up); otherwise the phone shows the list to pick from.
export function matchTeam(teams, typed) {
  const ranked = (teams || []).map((t) => ({ id: t.id, name: t.name, score: similarity(typed, t.name) }))
    .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, 'cs'));
  const top = ranked[0] || null;
  const gap = top ? top.score - (ranked[1]?.score || 0) : 0;
  return { team: top && top.score >= 0.34 ? top : null, score: top?.score || 0, sure: !!top && top.score >= 0.75 && gap >= 0.08, ranked };
}

// An existing (non-ghost) player whose name matches the typed one. Prefers the given team.
// Returns { id, name, team, score } or null. Threshold 0.8 (one or two typos in a full name).
export function matchPlayer(players, typedName, teamId) {
  const want = fold(typedName);
  if (want.length < 2) return null;
  let best = null;
  for (const p of Object.values(players || {})) {
    if (!p || p.ghost || !p.name) continue;
    let s = similarity(typedName, p.name, true);
    if (teamId && p.team === teamId) s += 0.05;
    if (!best || s > best.score) best = { id: p.id, name: p.name, team: p.team, score: s };
  }
  return best && best.score >= 0.8 ? { ...best, score: Math.min(1, Math.round(best.score * 1000) / 1000) } : null;
}
