/** Setlist scoring, selection, and ordering. Browser global + ES module. */

export const WEIGHTS = { 3: 6, 2: 2, 1: 1, 0: -4 };
export const TARGET = { 1: 45 * 60, 2: 60 * 60 };
export const MAX_PER_ARTIST = 2;
export const BAND = ["Rich", "Joel", "Anders", "Pete"];
export const TAGS = ["opener", "closer", "ballad", "dedication", "slow"];

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

/**
 * Select songs for one set. Skip-and-continue on time.
 * Negative scores never make the cut. Artist cap marks CAP, does not drop from ranking.
 */
export function selectSet(rows, setNum, opts) {
  const target = (opts && opts.target) || TARGET[setNum];
  const maxPer = (opts && opts.maxPerArtist) || MAX_PER_ARTIST;
  const pool = rows.filter((r) => r.set === setNum);
  const bad = pool.filter((r) => !r.dur || r.dur <= 0);
  if (bad.length) {
    return {
      ok: false,
      error:
        "Can't build set " +
        setNum +
        " — missing length on: " +
        bad.map((r) => r.name || r.k).join(", "),
      bad,
      keep: [],
      rest: [],
      run: 0,
      ranked: rankSongs(pool),
    };
  }

  const ranked = rankSongs(pool);
  const keep = [];
  const rest = [];
  const nBy = {};
  let run = 0;

  ranked.forEach((r) => {
    const a = artistKey(r.artist);
    if (r.sum < 0) {
      rest.push({ ...r, why: "neg" });
      return;
    }
    if ((nBy[a] || 0) >= maxPer) {
      rest.push({ ...r, why: "CAP" });
      return;
    }
    if (run + r.dur > target) {
      rest.push({ ...r, why: "time" });
      return;
    }
    keep.push(r);
    nBy[a] = (nBy[a] || 0) + 1;
    run += r.dur;
  });

  return { ok: true, keep, rest, run, ranked, error: "" };
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

export function generateSet(rows, setNum, opts) {
  const sel = selectSet(rows, setNum, opts);
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

const api = {
  WEIGHTS,
  TARGET,
  MAX_PER_ARTIST,
  BAND,
  TAGS,
  voteWeight,
  artistKey,
  tagsOf,
  energyOf,
  isSlow,
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
};

if (typeof window !== "undefined") window.Setlist = api;
export default api;
