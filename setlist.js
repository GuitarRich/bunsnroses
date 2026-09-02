/** Setlist scoring, selection, and ordering. Browser global + ES module. */

export const WEIGHTS = { 3: 6, 2: 2, 1: 1, 0: -4 };
/** One set. The show is sized by song count, not by a clock target. */
export const TARGET_SONGS = 17;   // default only — the sheet's Settings tab wins
export const MIN_SONGS = 1;
export const MAX_SONGS = 60;
export const MAX_PER_ARTIST = 1;
export const BAND = ["Rich", "Joel", "Anders", "Pete"];
export const TAGS = ["opener", "closer", "ballad", "dedication", "slow"];

/** How well a band member knows a song. Blank/unknown reads as "not-started". */
export const STATUSES = ["not-started", "in-progress", "know-it"];
export const STATUS_LABEL = {
  "not-started": "Not started",
  "in-progress": "In progress",
  "know-it": "Know song",
};

export function normStatus(v) {
  const s = String(v == null ? "" : v)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (s === "know-song" || s === "known" || s === "know") return "know-it";
  if (s === "in-progress" || s === "progress" || s === "wip") return "in-progress";
  return STATUSES.includes(s) ? s : "not-started";
}

export function voteWeight(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Object.prototype.hasOwnProperty.call(WEIGHTS, n) ? WEIGHTS[n] : 0;
}

export function artistKey(a) {
  return String(a || "")
    .trim()
    .toLowerCase();
}

export function tagsOf(s) {
  const raw = s && s.tags;
  const list = Array.isArray(raw)
    ? raw
    : String(raw || "")
        .split(/[,;]/)
        .map((t) => t.trim().toLowerCase());
  return list.filter((t) => t && t !== "-" && t !== "none");
}

export function energyOf(s) {
  const e = Number(s && s.energy);
  return e > 0 ? e : 0;
}

export function isSlow(s) {
  if (tagsOf(s).includes("slow")) return true;
  const e = energyOf(s);
  return e > 0 && e <= 2;
}

/** The old two-set split is now era metadata only; it no longer divides the show. */
export function eraLabel(s) {
  return Number(s && s.set) === 2 ? "90s+" : "70s/80s";
}

export function scoreSongs(songs, pool) {
  const who = Object.keys(pool || {}).filter((n) => Object.keys(pool[n] || {}).length);
  return songs.map((s) => {
    let sum = 0,
      n = 0,
      musts = 0;
    who.forEach((name) => {
      const v = pool[name][s.k];
      if (v === undefined || v === null || v === "") return;
      sum += voteWeight(v);
      n++;
      if (Number(v) === 3) musts++;
    });
    return { ...s, sum, n, musts };
  });
}

export function rankSongs(rows) {
  return rows.slice().sort((a, b) => b.sum - a.sum || b.musts - a.musts || a.dur - b.dur);
}

function keySet(list) {
  const out = new Set();
  (list || []).forEach((k) => {
    if (k) out.add(String(k));
  });
  return out;
}

/**
 * Pick the songs for the single set.
 *
 * Manual state wins over the vote in both directions: an "out" key never makes
 * the set however it scored, and an "in" key is always in the set even with a
 * negative score, a capped artist, or no room left in the count. Everything
 * else fills the remaining slots by rank, skipping vetoed songs and artists
 * already spoken for.
 */
export function selectSet(rows, opts) {
  const o = opts || {};
  const limit = Number(o.targetSongs) > 0 ? Number(o.targetSongs) : TARGET_SONGS;
  const maxPer = Number(o.maxPerArtist) > 0 ? Number(o.maxPerArtist) : MAX_PER_ARTIST;
  const inSet = keySet(o.include);
  const outSet = keySet(o.exclude);

  const ranked = rankSongs(rows);
  const used = {};
  const keep = [];
  const rest = [];

  // Forced picks first so they claim their artist before the auto fill runs.
  ranked.forEach((r) => {
    if (outSet.has(r.k) || !inSet.has(r.k)) return;
    keep.push({ ...r, why: "in", forced: true });
    used[artistKey(r.artist)] = (used[artistKey(r.artist)] || 0) + 1;
  });

  ranked.forEach((r) => {
    if (inSet.has(r.k) && !outSet.has(r.k)) return; // already forced in
    const a = artistKey(r.artist);
    if (outSet.has(r.k)) {
      rest.push({ ...r, why: "out", forced: true });
      return;
    }
    if (r.sum < 0) {
      rest.push({ ...r, why: "neg" });
      return;
    }
    if ((used[a] || 0) >= maxPer) {
      rest.push({ ...r, why: "CAP" });
      return;
    }
    if (keep.length >= limit) {
      rest.push({ ...r, why: "count" });
      return;
    }
    keep.push(r);
    used[a] = (used[a] || 0) + 1;
  });

  const bad = keep.filter((r) => !r.dur || r.dur <= 0);
  if (bad.length) {
    return {
      ok: false,
      error:
        "Can't build the set — missing length on: " +
        bad.map((r) => r.name || r.k).join(", "),
      bad,
      keep: [],
      rest: [],
      run: 0,
      ranked,
      usedArtists: used,
    };
  }

  return {
    ok: true,
    keep,
    rest,
    run: keep.reduce((a, r) => a + r.dur, 0),
    ranked,
    usedArtists: used,
    error: "",
  };
}

export function targetEnergy(i, n) {
  if (n <= 1) return 4.5;
  const t = i / (n - 1);
  return 4.5 - 8 * t * (1 - t) + 0.5 * t;
}

export function seedOrder(songs) {
  const n = songs.length;
  if (n <= 1) return songs.slice();
  const remaining = songs.slice();
  const order = new Array(n).fill(null);

  const closerAt = remaining.findIndex((s) => tagsOf(s).includes("closer"));
  if (closerAt >= 0) order[n - 1] = remaining.splice(closerAt, 1)[0];

  const openerAt = remaining.findIndex((s) => tagsOf(s).includes("opener"));
  if (openerAt >= 0 && !order[0]) order[0] = remaining.splice(openerAt, 1)[0];

  for (let i = 0; i < n; i++) {
    if (order[i]) continue;
    const target = targetEnergy(i, n);
    let best = 0;
    let bestD = Infinity;
    remaining.forEach((s, j) => {
      const e = energyOf(s);
      const d = Math.abs((e || target) - target);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    order[i] = remaining.splice(best, 1)[0];
  }
  return order;
}

export function orderCost(songs) {
  const n = songs.length;
  if (!n) return 0;
  let cost = 0;
  const slow = songs.map(isSlow);
  const total = songs.reduce((a, s) => a + (s.dur || 0), 0) || 1;

  for (let i = Math.max(0, n - 3); i < n; i++) if (slow[i]) cost += 30;
  for (let i = 0; i < Math.min(3, n); i++) if (slow[i]) cost += 20;
  for (let i = 0; i < n - 1; i++) if (slow[i] && slow[i + 1]) cost += 18;

  let t = 0;
  songs.forEach((s) => {
    if (tagsOf(s).includes("dedication") && t / total < 0.4) cost += 18;
    t += s.dur || 0;
  });

  const third = Math.ceil(n / 3);
  for (let i = 0; i < third; i++) if (tagsOf(songs[i]).includes("ballad")) cost += 16;

  for (let i = 0; i < n - 2; i++) {
    const a = String(songs[i].lead || "").trim();
    if (!a) continue;
    const b = String(songs[i + 1].lead || "").trim();
    const c = String(songs[i + 2].lead || "").trim();
    if (a && a === b && a === c) cost += 15;
  }

  const hasCloser = songs.some((s) => tagsOf(s).includes("closer"));
  if (hasCloser && !tagsOf(songs[n - 1]).includes("closer")) cost += 14;

  for (let i = Math.max(0, n - 3); i < n; i++) {
    const e = energyOf(songs[i]);
    if (e > 0 && e < 4) cost += (4 - e) * 9;
  }

  for (let i = 0; i <= n - 4; i++) {
    const es = songs.slice(i, i + 4).map(energyOf);
    if (es.some((e) => e <= 0)) continue;
    const avg = es.reduce((a, b) => a + b, 0) / 4;
    if (avg < 3.1) cost += (3.1 - avg) * 14;
  }

  return cost;
}

export function repairOrder(songs) {
  let order = songs.slice();
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 400) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      const cur = orderCost(order);
      const swapped = order.slice();
      const tmp = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = tmp;
      if (orderCost(swapped) < cur - 1e-9) {
        order = swapped;
        improved = true;
      }
    }
  }
  return order;
}

export function orderSet(keep) {
  return repairOrder(seedOrder(keep));
}

/** Reorder by identity keys. Dropped songs are skipped; new songs append in auto order. */
export function applySavedOrder(autoOrder, savedKeys) {
  if (!savedKeys || !savedKeys.length) return autoOrder.slice();
  const byK = {};
  autoOrder.forEach((s) => {
    byK[s.k] = s;
  });
  const used = new Set();
  const out = [];
  savedKeys.forEach((k) => {
    if (byK[k] && !used.has(k)) {
      out.push(byK[k]);
      used.add(k);
    }
  });
  autoOrder.forEach((s) => {
    if (!used.has(s.k)) out.push(s);
  });
  return out;
}

/** Select then order the one set. opts.orderKeys applies a saved running order. */
export function generateSet(rows, opts) {
  const sel = selectSet(rows, opts);
  if (!sel.ok) return { ...sel, auto: [], ordered: [] };
  const auto = orderSet(sel.keep);
  const ordered = applySavedOrder(auto, opts && opts.orderKeys);
  return { ...sel, auto, ordered };
}

export function searchLinks(song) {
  const q = encodeURIComponent((song.artist || "") + " " + (song.name || song.song || ""));
  return {
    ug:
      "https://www.ultimate-guitar.com/search.php?search_type=title&order=myweight&value=" + q,
    songsterr: "https://www.songsterr.com/?pattern=" + q,
    musescore: "https://www.musescore.com/sheetmusic?text=" + q,
    genius: "https://genius.com/search?q=" + q,
  };
}

export function parseLen(v) {
  const MAX_ITEM = 15 * 60;
  const t = String(v == null ? "" : v)
    .trim()
    .toUpperCase()
    .replace(/\s*[AP]M$/, "");
  const m = t.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]\d))?$/);
  if (!m) return 0;
  let secs;
  if (m[3] === undefined) secs = +m[1] * 60 + +m[2];
  else {
    secs = +m[1] * 3600 + +m[2] * 60 + +m[3];
    if (secs > MAX_ITEM) secs = +m[1] * 60 + +m[2];
  }
  return secs > 0 && secs <= MAX_ITEM ? secs : 0;
}

export function mmss(s) {
  s = Number(s) || 0;
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

export function moveKey(keys, from, to) {
  const next = keys.slice();
  const item = next.splice(from, 1)[0];
  next.splice(to, 0, item);
  return next;
}

/** Identity key shared by the pages and the Tunings sheet tab. */
export function songKey(name, artist) {
  const slug = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "x";
  return slug(name) + "-" + slug(artist);
}

/** Read one member's status for one song out of the shared progress map. */
export function statusOf(progress, k, member) {
  const row = progress && progress[k];
  if (!row) return "not-started";
  const hit = Object.keys(row).find(
    (n) => n.toLowerCase() === String(member || "").toLowerCase()
  );
  return hit ? normStatus(row[hit]) : "not-started";
}

/** Counts per status across the band for one song, for the readiness bar. */
export function statusTally(progress, k, members) {
  const out = { "not-started": 0, "in-progress": 0, "know-it": 0 };
  (members || []).forEach((m) => {
    out[statusOf(progress, k, m)]++;
  });
  return out;
}

/**
 * Clamp a hand-typed song limit into something buildable. Anything unreadable
 * falls back to the default rather than collapsing the set to nothing.
 */
export function normLimit(v, fallback) {
  const base = Number(fallback) > 0 ? Math.round(Number(fallback)) : TARGET_SONGS;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return base;
  return Math.min(MAX_SONGS, Math.max(MIN_SONGS, n));
}

/** Column layout of the Settings sheet tab. */
export const SETTINGS_HEADERS = ["Setting", "Value"];

/** Settings sheet rows -> { songLimit }. Unknown rows are ignored. */
export function parseSettings(rows) {
  const out = { songLimit: TARGET_SONGS };
  (rows || []).forEach((r) => {
    const name = String(r[0] || "").trim().toLowerCase();
    if (name === "song limit") out.songLimit = normLimit(r[1], TARGET_SONGS);
  });
  return out;
}

/** Column layout of the Progress sheet tab before the per-member columns. */
export const PROGRESS_BASE = ["Key", "Title", "Artist"];

/**
 * Setlist sheet rows -> { states, order }. State forces a song in or out regardless of
 * the vote; Position is the manual running order. A blank Position means the
 * song sits wherever the generator puts it.
 */
export function parseSetlist(rows) {
  const states = {};
  const placed = [];
  (rows || []).forEach((r, i) => {
    const key = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!key) return;
    const state = String(r[3] || "").trim().toLowerCase();
    if (state === "in" || state === "out") states[key] = state;
    const pos = Number(r[4]);
    if (pos > 0) placed.push({ key, pos, i });
  });
  placed.sort((a, b) => a.pos - b.pos || a.i - b.i);
  return { states, order: placed.map((p) => p.key) };
}

/**
 * Progress sheet rows -> { key: { member: status } }. Member columns are whatever the
 * header row says after Key/Title/Artist, so adding a band member is just a
 * new column.
 */
export function parseProgress(rows) {
  const out = {};
  if (!rows || !rows.length) return out;
  const head = rows[0] || [];
  const members = [];
  for (let c = PROGRESS_BASE.length; c < head.length; c++) {
    const n = String(head[c] || "").trim();
    if (n) members.push({ name: n, c });
  }
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const key = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!key) continue;
    const row = {};
    members.forEach((m) => {
      const v = String(r[m.c] || "").trim();
      if (v) row[m.name] = normStatus(v);
    });
    if (Object.keys(row).length) out[key] = row;
  }
  return out;
}

/**
 * Researched default tunings. The Tunings sheet tab is the source of truth once
 * a row exists there — these only seed missing rows and cover the no-API
 * fallback. Names/artists match the catalog spelling exactly (typos included)
 * so the keys line up.
 */
export const TUNING_SEEDS = [
  { name: "I Wanna Be Your Dog", artist: "The Stooges", tuning: "E standard" },
  { name: "You Really Got Me", artist: "Van Halen", tuning: "E standard (record ~1/2 flat)" },
  { name: "Ramble On", artist: "Led Zepplin", tuning: "E standard" },
  { name: "Rockin` in the Free World", artist: "Neil Young", tuning: "E standard" },
  { name: "Born On The Bayou", artist: "Creedence Clearwater Revival", tuning: "E standard" },
  { name: "Kiss", artist: "Prince", tuning: "E standard" },
  { name: "Mississippi Queen", artist: "Mountain", tuning: "E standard" },
  { name: "Sharp Dressed Man", artist: "ZZ Top", tuning: "E standard" },
  { name: "Riff Raff", artist: "AC/DC", tuning: "E standard" },
  { name: "Blitzkrieg Bop", artist: "Ramones", tuning: "E standard" },
  { name: "Rock And Roll All Nite", artist: "KISS", tuning: "E standard (record Eb)" },
  { name: "Cochise", artist: "Audioslave", tuning: "E standard (verify)" },
  { name: "Cherub Rock", artist: "The Smashing Pumpkins", tuning: "Eb standard" },
  { name: "Superunknown", artist: "Soundgarden", tuning: "Drop D (verify)" },
  { name: "Sad But True", artist: "Metallica", tuning: "D standard (play drop D)" },
  { name: "Hey Man, Nice Shot", artist: "Filter", tuning: "Drop D" },
  { name: "Freak", artist: "Silverchair", tuning: "Drop D" },
  { name: "Trippin' on a Hole in a Paper Heart", artist: "Stone Temple Pilots", tuning: "E standard" },
  { name: "Make It Wit Chu", artist: "Queens of the Stone Age", tuning: "E standard" },
  { name: "Dam That River", artist: "Alice In Chains", tuning: "Drop C# (drop D, 1/2 down)" },
  { name: "Dissident", artist: "Pearl Jam", tuning: "E standard" },
  { name: "Bleed American", artist: "Jimmy Eat World", tuning: "Drop D" },
  { name: "Sabotage", artist: "Beastie Boys", tuning: "E standard (riff is bass)" },
  { name: "Machinehead", artist: "Bush", tuning: "E standard (verify)" },
  { name: "Territorial Pissings", artist: "Nirvana", tuning: "E standard" },
  { name: "Sleep Now In the Fire", artist: "Rage Against The Machine", tuning: "E standard (Whammy, no detune)" },
];

const SEED_TUNINGS = {};
TUNING_SEEDS.forEach((t) => {
  SEED_TUNINGS[songKey(t.name, t.artist)] = t.tuning;
});

/**
 * Resolve a song's tuning. A key present in the sheet map wins even when its
 * value is blank — a cleared cell means "no tuning", not "fall back" (gotcha 3).
 */
export function tuningFor(map, name, artist) {
  const k = songKey(name, artist);
  if (map && Object.prototype.hasOwnProperty.call(map, k)) return String(map[k] || "");
  return SEED_TUNINGS[k] || "";
}

const api = {
  WEIGHTS,
  TARGET_SONGS,
  MAX_PER_ARTIST,
  BAND,
  TAGS,
  STATUSES,
  STATUS_LABEL,
  normStatus,
  voteWeight,
  artistKey,
  tagsOf,
  energyOf,
  isSlow,
  eraLabel,
  scoreSongs,
  rankSongs,
  selectSet,
  targetEnergy,
  seedOrder,
  orderCost,
  repairOrder,
  orderSet,
  applySavedOrder,
  generateSet,
  searchLinks,
  parseLen,
  mmss,
  moveKey,
  songKey,
  statusOf,
  statusTally,
  normLimit,
  parseSettings,
  SETTINGS_HEADERS,
  MIN_SONGS,
  MAX_SONGS,
  parseSetlist,
  parseProgress,
  PROGRESS_BASE,
  TUNING_SEEDS,
  tuningFor,
};

if (typeof window !== "undefined") window.Setlist = api;
export default api;
