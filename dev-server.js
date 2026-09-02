/**
 * Offline dev server. Serves the pages and fakes the API in memory, so you can
 * work on the UI with no Google credentials and no network.
 *
 *     npm run dev          then open http://localhost:8900
 *
 * Nothing here touches the real sheet. State lives in this process and is gone
 * when you stop it. Any access code is accepted. Use `npm run dev:real` when
 * you need to exercise the actual Sheets code path.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSetlist, parseProgress, normStatus } from "./setlist.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8900;
const OWNER = (process.env.OWNER_NAME || "Rich").toLowerCase();
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".ico": "image/x-icon" };

/* Fake sheet. Seeded with plausible votes so the setlist has something to build from. */
const PATTERNS = { Rich: [3, 2, 1, 0, 2, 3], Joel: [2, 3, 0, 1, 2, 1], Anders: [1, 2, 3, 2, 0, 3], Pete: [3, 1, 2, 3, 1, 0] };
const voters = {};
for (const [name, p] of Object.entries(PATTERNS)) {
  const votes = {};
  for (let i = 0; i < 63; i++) votes["b" + i] = p[i % p.length];
  voters[name] = { votes, ts: 1 };
}
let custom = [];
let setlistRows = [];   // rows as the Setlist tab would hold them
let progressRows = [];  // rows as the Progress tab would hold them

const plan = () => ({ ...parseSetlist(setlistRows), progress: parseProgress(progressRows) });

const readBody = (req) =>
  new Promise((res, rej) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { res(raw ? JSON.parse(raw) : {}); } catch (e) { rej(e); } });
    req.on("error", rej);
  });

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

/** Mirrors writeSetlist: one row per song, State + Position derived from the payload. */
function applySetlist(songs, states, order) {
  const pos = {};
  order.forEach((k, i) => { if (k && pos[k] === undefined) pos[k] = i + 1; });
  setlistRows = songs.map((s) => [s.k, s.name, s.artist || "", states[s.k] === "in" || states[s.k] === "out" ? states[s.k] : "", pos[s.k] === undefined ? "" : pos[s.k]]);
}

/** Mirrors writeProgress: merge one member's column into the grid. */
function applyProgress(songs, member, updates) {
  const head = progressRows.length ? progressRows[0].slice() : ["Key", "Title", "Artist"];
  let col = head.findIndex((h, i) => i >= 3 && String(h || "").toLowerCase() === member.toLowerCase());
  if (col < 0) { col = Math.max(head.length, 3); head[col] = member; }
  const byKey = {};
  progressRows.slice(1).forEach((r) => { if (r[0]) byKey[r[0]] = r.slice(); });
  const body = songs.map((s) => {
    const r = byKey[s.k] || [s.k, s.name, s.artist || ""];
    r[0] = s.k; r[1] = s.name; r[2] = s.artist || "";
    if (Object.prototype.hasOwnProperty.call(updates, s.k)) r[col] = normStatus(updates[s.k]);
    return r;
  });
  const width = body.reduce((w, r) => Math.max(w, r.length), head.length);
  const pad = (r) => { const o = r.slice(); for (let i = 0; i < width; i++) if (o[i] == null) o[i] = ""; return o.slice(0, width); };
  progressRows = [pad(head), ...body.map(pad)];
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  try {
    if (p === "/api/health") {
      return json(res, 200, { ok: true, sheetTitle: "(offline dev stub)", tabs: ["Votes", "AddedSongs", "Grid", "Tunings", "Setlist", "Progress"], env: { OFFLINE: true }, hint: "This is dev-server.js, not the real sheet." });
    }

    if (p === "/api/votes") {
      if (req.method === "POST") {
        const b = await readBody(req);
        if (!b.name) return json(res, 400, { ok: false, error: "Missing name." });
        const clean = {};
        for (const [k, v] of Object.entries(b.votes || {})) {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 0 && n <= 3) clean[k] = n;
        }
        voters[b.name] = { votes: clean, ts: Number(b.ts) || Date.now() };
        if (Array.isArray(b.custom) && b.name.trim().toLowerCase() === OWNER) custom = b.custom;
      }
      return json(res, 200, { ok: true, voters, custom, tunings: {}, plan: plan() });
    }

    if (p === "/api/plan") {
      if (req.method === "GET") return json(res, 200, { ok: true, plan: plan() });
      const b = await readBody(req);
      const songs = (b.songs || []).filter((s) => s && s.k && s.name);
      if (!b.name) return json(res, 400, { ok: false, error: "Missing name." });
      if (!songs.length) return json(res, 400, { ok: false, error: "Missing song list." });

      if (b.kind === "setlist") {
        if (b.name.trim().toLowerCase() !== OWNER) {
          return json(res, 403, { ok: false, error: "Only the owner can change the setlist." });
        }
        const states = {};
        for (const [k, v] of Object.entries(b.states || {})) {
          const s = String(v || "").toLowerCase();
          if (s === "in" || s === "out") states[k] = s;
        }
        applySetlist(songs, states, (b.order || []).map(String).filter(Boolean));
        return json(res, 200, { ok: true, plan: plan() });
      }
      if (b.kind === "progress") {
        const updates = {};
        for (const [k, v] of Object.entries(b.progress || {})) updates[k] = normStatus(v);
        if (!Object.keys(updates).length) return json(res, 400, { ok: false, error: "Nothing to update." });
        applyProgress(songs, b.name.trim(), updates);
        return json(res, 200, { ok: true, plan: plan() });
      }
      return json(res, 400, { ok: false, error: 'kind must be "setlist" or "progress".' });
    }

    const file = path.join(ROOT, p === "/" ? "index.html" : p.replace(/^\/+/, ""));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(file));
  } catch (e) {
    json(res, 500, { ok: false, error: e.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log("Offline dev server on http://localhost:" + PORT);
  console.log("  vote page:  http://localhost:" + PORT + "/");
  console.log("  setlist:    http://localhost:" + PORT + "/results.html");
  console.log("  owner is '" + OWNER + "'; any access code works; nothing reaches the real sheet.");
});
