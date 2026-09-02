/**
 * Shared state and server access for both pages.
 *
 * The vote page and the results page hold the same picture of the world: who
 * voted for what, which songs were added, the agreed set, and how far along
 * everyone is on learning it. This module owns that picture so neither page
 * has to re-derive it.
 */
import { TRACKS, BAND, OWNER, VERSION, NB, keyOf, buildSongs } from "./catalog.js";
import { parseLen, voteWeight, normStatus } from "./setlist.js";

export const VOTES_API = "/api/votes";
export const PLAN_API = "/api/plan";

export const S = {
  me: null,
  secret: "",
  myVotes: {},
  pool: {},
  poolTs: {},
  custom: [],
  tunings: {},
  plan: { states: {}, order: [], progress: {} },
  list: buildSongs([]),
  storageOK: null,
  lastErr: "",
  diag: [],
};

let onChange = () => {};
/** Pages register here to re-render when the connection state moves. */
export function onStatus(fn) {
  onChange = fn || (() => {});
}

export const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, "") || "x";
export const isOwner = () => !!S.me && slug(S.me) === slug(OWNER);
export const voters = () => Object.keys(S.pool).filter((n) => Object.keys(S.pool[n] || {}).length);

export function log(x) {
  S.diag.push(new Date().toLocaleTimeString() + "  " + x);
  if (S.diag.length > 60) S.diag.shift();
}

export function relist() {
  S.list = buildSongs(S.custom);
  return S.list;
}

/* ---------- codes: BR2-Name~<builtin string>|<added defs>|<added votes> ---------- */
const esc = (x) => String(x).replace(/[~|;^!]/g, "");

export function mkCode(name, v) {
  let bs = "";
  for (let i = 0; i < NB; i++) bs += v["b" + i] === undefined ? "." : v["b" + i];
  const defs = S.custom
    .map((c) =>
      [c.k, esc(c.name), esc(c.artist), c.dur, c.set, c.energy || "", esc(c.tags || ""), esc(c.lead || "")].join("^")
    )
    .join(";");
  const cv = S.custom.filter((c) => v[c.k] !== undefined).map((c) => c.k + ":" + v[c.k]).join(",");
  return "BR2-" + esc(name) + "~" + bs + "|" + defs + "|" + cv;
}

export function rdCode(raw) {
  const c = String(raw).trim();
  let m = c.match(/^BR2-([^~]+)~([0-3.]*)\|([^|]*)\|([^|]*)$/);
  if (m) {
    const v = {};
    for (let i = 0; i < NB && i < m[2].length; i++) {
      const ch = m[2][i];
      if (ch >= "0" && ch <= "3") v["b" + i] = +ch;
    }
    const defs = m[3]
      ? m[3]
          .split(";")
          .filter(Boolean)
          .map((d) => {
            const f = d.split("^");
            if (f.length < 5) return null;
            return { k: f[0], name: f[1], artist: f[2], dur: +f[3], set: +f[4], energy: +f[5] || 0, tags: f[6] || "", lead: f[7] || "" };
          })
          .filter(Boolean)
      : [];
    (m[4] ? m[4].split(",") : []).forEach((pair) => {
      const f = pair.split(":");
      if (f.length === 2 && f[1] !== "") v[f[0]] = +f[1];
    });
    return { name: m[1], votes: v, defs };
  }
  m = c.match(/^BR1-([^~]+)~([0-3.]{1,200})$/); // older codes still work
  if (m) {
    const v = {};
    for (let i = 0; i < NB && i < m[2].length; i++) {
      const ch = m[2][i];
      if (ch >= "0" && ch <= "3") v["b" + i] = +ch;
    }
    return { name: m[1], votes: v, defs: [] };
  }
  return null;
}

export function mergeDefs(defs) {
  let added = 0;
  (defs || []).forEach((d) => {
    if (!S.custom.some((c) => c.k === d.k)) {
      S.custom.push({ k: d.k, name: d.name, artist: d.artist, dur: d.dur, set: d.set, energy: d.energy || "", tags: d.tags || "", lead: d.lead || "" });
      added++;
    }
  });
  if (added) relist();
  return added;
}

/* ---------- backend ---------- */
function absorb(data) {
  const v = data.voters || {};
  if (data.tunings) S.tunings = data.tunings;
  if (data.plan) {
    S.plan = {
      states: data.plan.states || {},
      order: data.plan.order || [],
      progress: data.plan.progress || {},
    };
  }
  mergeDefs(data.custom || []);
  Object.keys(v).forEach((n) => {
    const rec = v[n] || {},
      votes = rec.votes || {},
      ts = rec.ts || 0;
    if (!Object.keys(votes).length) return;
    if (n === S.me) {
      if (ts >= (S.poolTs[n] || 0)) {
        S.myVotes = votes;
        S.poolTs[n] = ts;
      } else {
        Object.keys(votes).forEach((k) => {
          if (S.myVotes[k] === undefined) S.myVotes[k] = votes[k];
        });
      }
    } else if (ts >= (S.poolTs[n] || 0)) {
      S.pool[n] = votes;
      S.poolTs[n] = ts;
    }
  });
  if (S.me) S.pool[S.me] = S.myVotes;
  log("loaded -> " + Object.keys(S.pool).map((n) => n + ":" + Object.keys(S.pool[n] || {}).length).join(", "));
}

function ok(err) {
  S.storageOK = !err;
  S.lastErr = err || "";
  onChange();
}

export async function pull() {
  try {
    const r = await fetch(VOTES_API, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || "HTTP " + r.status);
    absorb(d);
    ok("");
    return true;
  } catch (e) {
    log("load failed: " + (e.message || e));
    ok(e.message || String(e));
    return false;
  }
}

export async function push() {
  if (!S.me) return false;
  try {
    const r = await fetch(VOTES_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: S.secret,
        name: S.me,
        votes: S.myVotes,
        ts: S.poolTs[S.me] || Date.now(),
        version: VERSION,
        custom: isOwner() ? S.custom : undefined,
        songs: isOwner()
          ? S.list.map((x) => ({ k: x.k, name: x.name, artist: x.artist, year: x.year || "", dur: x.dur, set: x.set }))
          : undefined,
      }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || "HTTP " + r.status);
    absorb(d);
    ok("");
    log("saved " + Object.keys(S.myVotes).length + " votes to the sheet");
    return true;
  } catch (e) {
    log("save failed: " + (e.message || e));
    ok(e.message || String(e));
    return false;
  }
}

export async function pushOthers() {
  let saved = 0,
    failed = 0;
  for (const name of Object.keys(S.pool)) {
    if (name === S.me) continue;
    const v = S.pool[name];
    if (!v || !Object.keys(v).length) continue;
    try {
      const r = await fetch(VOTES_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: S.secret, name, votes: v, ts: S.poolTs[name] || Date.now(), version: VERSION }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        saved++;
        log("saved " + name + "'s votes to the sheet");
        absorb(d);
      } else {
        failed++;
        log("could not save " + name + ": " + (d.error || r.status));
      }
    } catch (e) {
      failed++;
      log("could not save " + name + ": " + (e.message || e));
    }
  }
  return { saved, failed };
}

export function persist() {
  S.poolTs[S.me] = Date.now();
  return push();
}

/** Songs stripped down to what the plan tabs need for readable Title/Artist columns. */
const planSongs = () => S.list.map((s) => ({ k: s.k, name: s.name, artist: s.artist }));

async function postPlan(body) {
  try {
    const r = await fetch(PLAN_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: S.secret, name: S.me, songs: planSongs(), ...body }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || "HTTP " + r.status);
    if (d.plan) S.plan = { states: d.plan.states || {}, order: d.plan.order || [], progress: d.plan.progress || {} };
    ok("");
    return true;
  } catch (e) {
    log("plan save failed: " + (e.message || e));
    ok(e.message || String(e));
    return false;
  }
}

/** Owner-only: which songs are forced in or out, and the running order. */
export function saveSetlist(states, order) {
  S.plan.states = { ...states };
  S.plan.order = (order || []).slice();
  log("setlist saved: " + Object.keys(states).length + " overrides, " + S.plan.order.length + " ordered");
  return postPlan({ kind: "setlist", states: S.plan.states, order: S.plan.order });
}

/** Anyone: set your own learning status for one song. */
export function saveStatus(k, status) {
  const st = normStatus(status);
  const row = { ...(S.plan.progress[k] || {}) };
  row[S.me] = st;
  S.plan.progress = { ...S.plan.progress, [k]: row };
  log("status " + k + " -> " + st);
  return postPlan({ kind: "progress", progress: { [k]: st } });
}

/* ---------- CSV import ---------- */
export function parseCSV(text) {
  const rows = [];
  let row = [],
    cur = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") cur += c;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
}

const RESERVED = new Set(["song", "artist", "year", "set", "duration", "added", "total", "votes cast", "notes", "note"]);

export function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { err: "That CSV has no rows under the header." };
  const head = rows[0].map((h) => String(h).trim());
  const find = (re) => head.findIndex((h) => re.test(h));
  const iSong = find(/^song$/i),
    iArt = find(/^artist$/i);
  if (iSong < 0 || iArt < 0) return { err: "Needs a Song column and an Artist column." };
  const iSet = find(/^set$/i),
    iDur = find(/^duration$/i);
  const who = [];
  head.forEach((h, i) => {
    if (h && !RESERVED.has(h.toLowerCase())) who.push({ name: h, i });
  });
  if (!who.length) return { err: "No voter columns found — each voter needs a column headed with their name." };
  const byKey = {};
  TRACKS.forEach((t, i) => (byKey[keyOf(t[0], t[1])] = "b" + i));
  S.custom.forEach((c) => (byKey[c.k] = c.k));
  const fresh = {};
  who.forEach((w) => (fresh[w.name] = {}));
  let matched = 0,
    created = 0,
    skipped = 0,
    blocked = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const title = String(row[iSong] || "").trim(),
      artist = String(row[iArt] || "").trim();
    if (!title || !artist) {
      skipped++;
      continue;
    }
    const k0 = keyOf(title, artist);
    let key = byKey[k0];
    if (!key && !isOwner()) {
      blocked++;
      continue;
    }
    if (!key) {
      const set = iSet >= 0 && +String(row[iSet]).trim() === 2 ? 2 : 1;
      let dur = 210;
      if (iDur >= 0) {
        const secs = parseLen(String(row[iDur] || "").trim());
        if (secs) dur = secs;
      }
      S.custom.push({ k: k0, name: title, artist, dur, set, energy: "", tags: "", lead: "" });
      byKey[k0] = k0;
      key = k0;
      created++;
    } else matched++;
    who.forEach((w) => {
      const v = String(row[w.i] == null ? "" : row[w.i]).trim();
      if (/^[0-3]$/.test(v)) fresh[w.name][key] = +v;
    });
  }
  relist();
  const applied = [],
    now = Date.now();
  who.forEach((w) => {
    if (!Object.keys(fresh[w.name]).length) return; // don't wipe a voter with an empty column
    S.pool[w.name] = fresh[w.name];
    S.poolTs[w.name] = now;
    if (w.name === S.me) S.myVotes = fresh[w.name];
    applied.push(w.name);
  });
  log("CSV import: " + applied.map((n) => n + ":" + Object.keys(fresh[n]).length).join(", "));
  if (!applied.length) return { err: "Found columns for " + who.map((w) => w.name).join(", ") + " but no scores in them." };
  return { applied, matched, created, skipped, blocked, ignored: who.length - applied.length };
}

export { BAND, OWNER, VERSION, voteWeight };
