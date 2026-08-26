import { google } from "googleapis";
import { voteWeight, songKey, TUNING_SEEDS } from "../setlist.js";

const VOTES_TAB = "Votes";
const SONGS_TAB = "AddedSongs";
const GRID_TAB = "Grid";
const TUNINGS_TAB = "Tunings";
const SONG_HEADERS = ["Key", "Title", "Artist", "Seconds", "Set", "Energy", "Tags", "Lead"];
const TUNING_HEADERS = ["Key", "Title", "Artist", "Tuning"];

let cached = null;

export function sheetsClient() {
  if (cached) return cached;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY");
  // Vercel env vars usually arrive with literal \n rather than real newlines.
  key = key.replace(/\\n/g, "\n").trim();
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cached = google.sheets({ version: "v4", auth });
  return cached;
}

export const sheetId = () => {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error("Missing SHEET_ID");
  return id;
};

/** Create any tab that doesn't exist yet, and write header rows. */
export async function ensureTabs() {
  const sheets = sheetsClient();
  const id = sheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const have = new Set(meta.data.sheets.map((s) => s.properties.title));
  const missing = [VOTES_TAB, SONGS_TAB, GRID_TAB, TUNINGS_TAB].filter((t) => !have.has(t));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
    if (missing.includes(VOTES_TAB)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `${VOTES_TAB}!A1:E1`,
        valueInputOption: "RAW",
        requestBody: { values: [["Name", "UpdatedAt", "AppVersion", "VoteCount", "VotesJSON"]] },
      });
    }
    if (missing.includes(SONGS_TAB)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `${SONGS_TAB}!A1:H1`,
        valueInputOption: "RAW",
        requestBody: { values: [SONG_HEADERS] },
      });
    }
    if (missing.includes(TUNINGS_TAB)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `${TUNINGS_TAB}!A1:D1`,
        valueInputOption: "RAW",
        requestBody: { values: [TUNING_HEADERS] },
      });
    }
  }
  await ensureSongMetaHeaders(sheets, id);
  return { VOTES_TAB, SONGS_TAB, GRID_TAB };
}

async function ensureSongMetaHeaders(sheets, id) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${SONGS_TAB}!A1:H1`,
  });
  const have = (res.data.values && res.data.values[0]) || [];
  const same = SONG_HEADERS.every((h, i) => have[i] === h);
  if (same) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${SONGS_TAB}!A1:H1`,
    valueInputOption: "RAW",
    requestBody: { values: [SONG_HEADERS] },
  });
}

export async function readAll() {
  await ensureTabs();
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: [`${VOTES_TAB}!A2:E200`, `${SONGS_TAB}!A2:H500`, `${TUNINGS_TAB}!A2:D500`],
  });
  const [voteRows = [], songRows = [], tuningRows = []] = res.data.valueRanges.map(
    (r) => r.values || []
  );

  const voters = {};
  for (const r of voteRows) {
    const [name, updatedAt, , , json] = r;
    if (!name) continue;
    let votes = {};
    try {
      votes = JSON.parse(json || "{}");
    } catch {
      votes = {};
    }
    voters[name] = { votes, ts: Number(updatedAt) || 0 };
  }

  const custom = songRows
    .filter((r) => r[0] && r[1])
    .map((r) => {
      const energy = Number(r[5]);
      return {
        k: r[0],
        name: r[1],
        artist: r[2] || "",
        dur: Number(r[3]) || 210,
        set: Number(r[4]) === 2 ? 2 : 1,
        energy: energy > 0 ? energy : "",
        tags: String(r[6] || ""),
        lead: String(r[7] || ""),
      };
    });

  // A row's presence makes it authoritative, even with a blank tuning cell.
  const tunings = {};
  for (const r of tuningRows) {
    const key = String(r[0] || "").trim() || (r[1] ? songKey(r[1], r[2]) : "");
    if (!key) continue;
    tunings[key] = String(r[3] || "").replace(/[<>&]/g, "").trim();
  }

  const seeded = await syncTunings(
    [...TUNING_SEEDS, ...custom.map((c) => ({ name: c.name, artist: c.artist, tuning: "" }))],
    tunings
  );

  return { voters, custom, tunings: seeded };
}

/**
 * Append rows to the Tunings tab for any song it doesn't know yet. Existing
 * rows are never touched — the sheet stays the source of truth for edits.
 * Returns the tunings map including anything just seeded.
 */
export async function syncTunings(entries, existing) {
  const sheets = sheetsClient();
  const id = sheetId();
  const have = existing || {};
  const fresh = [];
  const seen = new Set(Object.keys(have));
  for (const e of entries) {
    const key = songKey(e.name, e.artist);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push([key, e.name, e.artist || "", e.tuning || ""]);
  }
  if (fresh.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${TUNINGS_TAB}!A2:D2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: fresh },
    });
  }
  const out = { ...have };
  fresh.forEach((r) => {
    out[r[0]] = r[3];
  });
  return out;
}

/** Upsert one voter's row, keyed by name (case-insensitive). */
export async function writeVoter({ name, votes, ts, version }) {
  await ensureTabs();
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${VOTES_TAB}!A2:A200`,
  });
  const names = (res.data.values || []).map((r) => (r[0] || "").toLowerCase());
  const idx = names.indexOf(String(name).toLowerCase());
  const row = [name, String(ts), version || "", Object.keys(votes).length, JSON.stringify(votes)];

  if (idx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${VOTES_TAB}!A${idx + 2}:E${idx + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `${VOTES_TAB}!A2:E2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  }
}

/** Replace the whole added-songs tab. Owner-only, enforced by the caller. */
export async function writeSongs(custom) {
  await ensureTabs();
  const sheets = sheetsClient();
  const id = sheetId();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `${SONGS_TAB}!A2:H500`,
  });
  if (!custom.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${SONGS_TAB}!A2`,
    valueInputOption: "RAW",
    requestBody: {
      values: custom.map((c) => [
        c.k,
        c.name,
        c.artist,
        c.dur,
        c.set,
        Number(c.energy) > 0 ? Number(c.energy) : "",
        c.tags || "",
        c.lead || "",
      ]),
    },
  });
}

/** Human-readable grid: one row per song, one column per voter. */
export async function writeGrid(songs, voters) {
  await ensureTabs();
  const sheets = sheetsClient();
  const id = sheetId();
  const who = Object.keys(voters).filter((n) => Object.keys(voters[n].votes || {}).length);
  const header = ["Song", "Artist", "Year", "Set", "Length", ...who, "Total", "Votes cast"];
  const mmss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  const rows = songs.map((s) => {
    const cells = who.map((n) => {
      const v = voters[n].votes[s.k];
      return v === undefined ? "" : v;
    });
    const cast = cells.filter((c) => c !== "");
    const total = cast.reduce((a, b) => a + voteWeight(b), 0);
    return [
      s.name,
      s.artist,
      s.year || "",
      s.set,
      mmss(s.dur),
      ...cells,
      total,
      cast.length,
    ];
  });
  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${GRID_TAB}!A1:Z400` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${GRID_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [header, ...rows] },
  });
}

export function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
