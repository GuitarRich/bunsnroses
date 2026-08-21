import { google } from "googleapis";

const VOTES_TAB = "Votes";
const SONGS_TAB = "AddedSongs";
const GRID_TAB = "Grid";

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
  const missing = [VOTES_TAB, SONGS_TAB, GRID_TAB].filter((t) => !have.has(t));
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
        range: `${SONGS_TAB}!A1:E1`,
        valueInputOption: "RAW",
        requestBody: { values: [["Key", "Title", "Artist", "Seconds", "Set"]] },
      });
    }
  }
  return { VOTES_TAB, SONGS_TAB, GRID_TAB };
}

export async function readAll() {
  await ensureTabs();
  const sheets = sheetsClient();
  const id = sheetId();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: [`${VOTES_TAB}!A2:E200`, `${SONGS_TAB}!A2:E500`],
  });
  const [voteRows = [], songRows = []] = res.data.valueRanges.map((r) => r.values || []);

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
    .map((r) => ({
      k: r[0],
      name: r[1],
      artist: r[2] || "",
      dur: Number(r[3]) || 210,
      set: Number(r[4]) === 2 ? 2 : 1,
    }));

  return { voters, custom };
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
    range: `${SONGS_TAB}!A2:E500`,
  });
  if (!custom.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${SONGS_TAB}!A2`,
    valueInputOption: "RAW",
    requestBody: {
      values: custom.map((c) => [c.k, c.name, c.artist, c.dur, c.set]),
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
    return [
      s.name,
      s.artist,
      s.year || "",
      s.set,
      mmss(s.dur),
      ...cells,
      cast.reduce((a, b) => a + b, 0),
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
