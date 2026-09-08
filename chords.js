/**
 * Guitar chord shapes for the lyric book.
 *
 * The shapes are worked out, not looked up: a symbol is parsed into pitch
 * classes, then voicings are searched against the actual open strings of the
 * song's tuning. That matters here because half this set is in Drop D or Eb —
 * a canned "Am is x02210" table would be wrong on those songs — and because
 * nothing in this app fetches from a third-party site.
 */

const PC = {
  C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4,
  "E#": 5, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10,
  Bb: 10, B: 11, Cb: 11,
};

/** Named tunings, lowest string first, as MIDI note numbers. */
export const TUNINGS = {
  "e standard": [40, 45, 50, 55, 59, 64],
  "drop d": [38, 45, 50, 55, 59, 64],
  "eb standard": [39, 44, 49, 54, 58, 63],
  "drop c#": [37, 44, 49, 54, 58, 63],
  "d standard": [38, 43, 48, 53, 57, 62],
  "drop c": [36, 43, 48, 53, 57, 62],
  "dadgad": [38, 45, 50, 55, 57, 62],
  "open g": [38, 43, 50, 55, 59, 62],
  "open d": [38, 45, 50, 54, 57, 62],
  "open e": [40, 47, 52, 56, 59, 64],
};

/**
 * Turn a song's free-text tuning tag into strings. The tags in the sheet are
 * written by people ("E standard (riff is bass)", "Drop D", "Half step down"),
 * so anything unrecognised falls back to standard rather than failing.
 */
export function stringsFor(label) {
  let t = String(label || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z# ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return TUNINGS["e standard"];
  if (/half step down|eb tuning|e flat/.test(t)) t = "eb standard";
  if (/^standard$/.test(t)) t = "e standard";
  if (TUNINGS[t]) return TUNINGS[t];
  const hit = Object.keys(TUNINGS).find((k) => t.startsWith(k) || t.includes(k));
  return TUNINGS[hit] || TUNINGS["e standard"];
}

/**
 * Chord symbol -> the notes in it.
 *
 * Returns pitch classes relative to nothing — absolute 0-11 — plus which of
 * them is the root and which the bass, because a voicing is only right if the
 * lowest sounding string is the bass of a slash chord.
 */
export function parseChord(sym) {
  let s = String(sym || "").trim().replace(/♯/g, "#").replace(/♭/g, "b");
  const m = /^([A-G][#b]?)(.*)$/.exec(s);
  if (!m) return null;
  const root = PC[m[1]];
  if (root == null) return null;

  let q = m[2];
  let bass = null;
  const bm = /\/([A-G][#b]?)\s*$/.exec(q);
  if (bm) {
    bass = PC[bm[1]];
    if (bass == null) return null;
    q = q.slice(0, bm.index);
  }
  q = q.replace(/[()\s]/g, "");

  // Pull each quality marker out of the string as it is recognised, so what's
  // left at the end tells us whether the symbol was understood at all.
  const eat = (re) => {
    const hit = re.exec(q);
    if (!hit) return null;
    q = q.slice(0, hit.index) + q.slice(hit.index + hit[0].length);
    return hit;
  };

  let third = 4;
  let fifth = 7;
  let seventh = null;
  const extra = [];

  if (eat(/^(?:dim|°|o)7/)) { third = 3; fifth = 6; seventh = 9; }
  else if (eat(/^(?:dim|°|o)/)) { third = 3; fifth = 6; }
  else if (eat(/^(?:ø|m7b5|min7b5|m7-5|-7b5)/)) { third = 3; fifth = 6; seventh = 10; }
  else if (eat(/^(?:aug|\+)/)) { fifth = 8; }
  else if (eat(/^(?:maj|Maj|MAJ|M)(?=7|9|11|13)/)) { seventh = 11; }
  else if (eat(/^(?:min|m|-)(?!aj)/)) { third = 3; }

  // A major seventh written after the quality: Cmmaj7, Am(maj7).
  if (seventh === null && eat(/^(?:maj|M)(?=7|9|11|13)/)) seventh = 11;

  if (eat(/^sus2/)) third = 2;
  else if (eat(/^sus4?/)) third = 5;

  if (eat(/^6/)) extra.push(9);
  if (eat(/^13/)) { if (seventh === null) seventh = 10; extra.push(2, 9); }
  else if (eat(/^11/)) { if (seventh === null) seventh = 10; extra.push(2, 5); }
  else if (eat(/^9/)) { if (seventh === null) seventh = 10; extra.push(2); }
  else if (eat(/^7/)) { if (seventh === null) seventh = 10; }

  if (eat(/^add9/)) extra.push(2);
  if (eat(/^add11/)) extra.push(5);
  if (eat(/^b9/)) extra.push(1);
  if (eat(/^#9/)) extra.push(3);
  if (eat(/^#11/)) extra.push(6);
  if (eat(/^b13/)) extra.push(8);
  if (eat(/^b5/)) fifth = 6;
  if (eat(/^#5/)) fifth = 8;
  if (eat(/^5/)) third = null;   // power chord: no third at all

  if (q.replace(/[.\-]/g, "")) return null;   // leftovers mean we misread it

  const set = new Set([0, fifth]);
  if (third !== null) set.add(third);
  if (seventh !== null) set.add(seventh);
  extra.forEach((i) => set.add(i));

  return {
    root,
    bass: bass == null ? root : bass,
    slash: bass != null && bass !== root,
    // Absolute pitch classes, and the degrees kept apart so the search can
    // tell an omittable fifth from a third it must not drop.
    pcs: new Set([...set].map((i) => (root + i) % 12)),
    third: third === null ? null : (root + third) % 12,
    fifth: (root + fifth) % 12,
    seventh: seventh === null ? null : (root + seventh) % 12,
  };
}

/**
 * Fingers 1-4 over a shape.
 *
 * Two strings on the same fret need two fingers unless one finger is barring
 * them, so this is also what decides whether a shape is playable at all: the
 * caller rejects anything that comes back needing a fifth finger.
 *
 * A barre is only reached for when the shape can't be fingered without one.
 * Deciding by "the lowest fret carries more than one string" draws a bar over
 * ordinary shapes like D (xx0232), which nobody barres.
 */
export function fingering(frets) {
  const fretted = frets.map((f, i) => ({ f, i })).filter((x) => x.f > 0);
  if (!fretted.length) return { fingers: frets.map(() => 0), barre: null, count: 0 };

  const plain = assign(frets, fretted, null);
  if (plain.count <= 4) return plain;

  const low = Math.min(...fretted.map((x) => x.f));
  const atLow = fretted.filter((x) => x.f === low);
  const from = Math.min(...atLow.map((x) => x.i));
  const to = Math.max(...atLow.map((x) => x.i));
  // An open string inside the span rules the barre out — the finger would be
  // lying across it. So does having nothing above the barre to hold down.
  const blocked = frets.some((f, i) => i > from && i < to && f === 0);
  if (atLow.length < 2 || blocked || !fretted.some((x) => x.f > low)) return plain;

  return assign(frets, fretted, { fret: low, from, to });
}

/** Hand out fingers low fret first, with the barre (if any) taking finger 1. */
function assign(frets, fretted, barre) {
  const fingers = frets.map(() => 0);
  let next = 1;
  if (barre) {
    frets.forEach((f, i) => { if (f === barre.fret) fingers[i] = 1; });
    next = 2;
  }
  fretted
    .filter((x) => !(barre && x.f === barre.fret))
    .sort((a, b) => a.f - b.f || a.i - b.i)
    .forEach((x) => { fingers[x.i] = next++; });
  return { fingers, barre, count: next - 1 };
}

/**
 * Best shape for one chord symbol in one tuning.
 *
 * The search rules are all about what a hand can actually do: a four-fret
 * window, muted strings only at the ends of the shape (x32010, not x3x010),
 * open strings only down near the nut, at most four fingers, and the bass note
 * on the lowest string that sounds.
 */
export function chordShape(sym, strings) {
  const ch = parseChord(sym);
  if (!ch) return null;
  const S = strings && strings.length ? strings : TUNINGS["e standard"];
  const N = S.length;
  const MAX_FRET = 15;
  const minVoices = ch.pcs.size <= 2 ? 2 : 3;

  let best = null;
  let bestScore = Infinity;

  for (let win = 0; win <= MAX_FRET - 3; win++) {
    const choices = [];
    for (let i = 0; i < N; i++) {
      const opts = [-1];                                    // always allowed: mute it
      if (ch.pcs.has(S[i] % 12)) opts.push(0);
      for (let f = Math.max(1, win); f <= win + 3; f++) {
        if (ch.pcs.has((S[i] + f) % 12)) opts.push(f);
      }
      choices.push(opts);
    }

    const frets = new Array(N).fill(-1);
    const walk = (n, voices) => {
      if (voices + (N - n) < minVoices) return;             // can't reach a chord from here
      if (n === N) {
        const score = rate(frets, S, ch);
        if (score != null && score < bestScore) { bestScore = score; best = frets.slice(); }
        return;
      }
      for (const f of choices[n]) {
        frets[n] = f;
        walk(n + 1, voices + (f >= 0 ? 1 : 0));
      }
      frets[n] = -1;
    };
    walk(0, 0);
  }

  if (!best) return null;
  const { fingers, barre } = fingering(best);
  const fretted = best.filter((f) => f > 0);
  // A shape that fits in the first four frets is drawn against the nut;
  // anything higher gets a position number beside it instead.
  const baseFret = fretted.length && Math.max(...fretted) > 4 ? Math.min(...fretted) : 1;
  return { name: String(sym).trim(), frets: best, fingers, barre, baseFret };
}

/** Score one candidate. Lower is better; null rejects it outright. */
function rate(frets, S, ch) {
  const sounding = [];
  for (let i = 0; i < frets.length; i++) if (frets[i] >= 0) sounding.push(i);
  if (sounding.length < (ch.pcs.size <= 2 ? 2 : 3)) return null;

  // The lowest string that sounds has to be the bass of the chord.
  if ((S[sounding[0]] + frets[sounding[0]]) % 12 !== ch.bass) return null;

  const heard = new Set(sounding.map((i) => (S[i] + frets[i]) % 12));
  if (!heard.has(ch.root)) return null;
  if (ch.third != null && !heard.has(ch.third)) return null;
  if (ch.seventh != null && !heard.has(ch.seventh)) return null;

  const fretted = sounding.map((i) => frets[i]).filter((f) => f > 0);
  const highest = fretted.length ? Math.max(...fretted) : 0;
  const span = fretted.length ? highest - Math.min(...fretted) : 0;
  if (span > 3) return null;

  const opens = sounding.filter((i) => frets[i] === 0).length;
  // Open strings only ring in first position; a hand up at the 7th fret isn't
  // also holding an open-string shape.
  if (opens && highest > 5) return null;

  const { count, barre } = fingering(frets);
  if (count > 4) return null;

  // The index finger in two places, three or more strings apart, with higher
  // notes in between and no barre to hold them down. That is what rules out
  // shapes like x10331 for Bb, which a search otherwise likes for its open
  // string. Two strings apart is fine and ordinary — it's how D (xx0232) and
  // A7 (x02020) are fingered.
  if (!barre) {
    const lowest = Math.min(...fretted);
    const at = sounding.filter((i) => frets[i] === lowest);
    if (at.length > 1 && at[at.length - 1] - at[0] >= 3) {
      for (let i = at[0] + 1; i < at[at.length - 1]; i++) {
        if (frets[i] > lowest) return null;
      }
    }
  }

  const muted = frets.length - sounding.length;
  const tail = frets.length - 1 - sounding[sounding.length - 1];
  let holes = 0;                           // muted strings inside the shape
  for (let i = sounding[0]; i < sounding[sounding.length - 1]; i++) if (frets[i] < 0) holes++;
  // A power chord is meant to be two or three strings, so the usual "play as
  // many strings as you can" bias has to come off or it invents six-string
  // stretches for D5.
  const perMute = ch.pcs.size <= 2 ? 1.5 : 5;

  let score = 0;
  score += highest * 1.7;                  // stay near the nut
  score += span * 1.6;                     // stay compact
  score -= opens * 1.1;                    // open strings are free
  score += muted * perMute;                // a fuller chord is better
  score += tail * 3;                       // muting treble strings is rarer
  score += holes * 7;                      // and a hole in the middle rarer still
  score += count * 0.9;                    // fewer fingers is better
  if (barre) score += 0.8;
  if (!heard.has(ch.fifth)) score += 1.6;  // the fifth may go, reluctantly
  return score;
}
