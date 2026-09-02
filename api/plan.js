/**
 * The show plan: which songs are in the set, in what order, and how far along
 * each band member is on learning them.
 *
 * Two kinds of write share this endpoint because they share the same gate and
 * the same reply shape:
 *   kind "setlist"  — owner only. Forced in/out, the running order, and the
 *                     song limit for the set.
 *   kind "progress" — any band member, but only ever their own column.
 */
import { readAll, writeSetlist, writeProgress, writeSettings, readBody } from "./_sheets.js";
import { normStatus, normLimit } from "../setlist.js";

const OWNER = (process.env.OWNER_NAME || "Rich").toLowerCase();

function appSecret() {
  let s = (process.env.APP_SECRET || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function cleanSongs(songs) {
  return (Array.isArray(songs) ? songs : [])
    .filter((s) => s && s.k && s.name)
    .map((s) => ({ k: String(s.k), name: String(s.name), artist: String(s.artist || "") }));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const data = await readAll();
      return res.status(200).json({ ok: true, plan: data.plan });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const { secret, name, kind, songs } = body || {};

      const expected = appSecret();
      if (expected && String(secret || "").trim() !== expected) {
        return res.status(401).json({ ok: false, error: "Wrong access code." });
      }
      if (!name || typeof name !== "string") {
        return res.status(400).json({ ok: false, error: "Missing name." });
      }
      const list = cleanSongs(songs);
      if (!list.length) {
        return res.status(400).json({ ok: false, error: "Missing song list." });
      }

      if (kind === "setlist") {
        if (name.trim().toLowerCase() !== OWNER) {
          return res.status(403).json({ ok: false, error: "Only the owner can change the setlist." });
        }
        const states = {};
        for (const [k, v] of Object.entries(body.states || {})) {
          const s = String(v || "").toLowerCase();
          if (s === "in" || s === "out") states[String(k)] = s;
        }
        const order = (Array.isArray(body.order) ? body.order : []).map(String).filter(Boolean);
        const plan = await writeSetlist(list, states, order);
        // A limit only rides along when the client sends one, so an ordinary
        // in/out save can't silently reset it.
        let settings = null;
        if (body.limit !== undefined && body.limit !== null && body.limit !== "") {
          settings = await writeSettings({ songLimit: normLimit(body.limit) });
        }
        const fresh = await readAll();
        return res.status(200).json({
          ok: true,
          plan: {
            ...plan,
            progress: fresh.plan.progress,
            songLimit: settings ? settings.songLimit : fresh.plan.songLimit,
          },
        });
      }

      if (kind === "progress") {
        const updates = {};
        for (const [k, v] of Object.entries(body.progress || {})) updates[String(k)] = normStatus(v);
        if (!Object.keys(updates).length) {
          return res.status(400).json({ ok: false, error: "Nothing to update." });
        }
        const progress = await writeProgress(list, name.trim(), updates);
        const fresh = await readAll();
        return res
          .status(200)
          .json({
            ok: true,
            plan: {
              states: fresh.plan.states,
              order: fresh.plan.order,
              songLimit: fresh.plan.songLimit,
              progress,
            },
          });
      }

      return res.status(400).json({ ok: false, error: 'kind must be "setlist" or "progress".' });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
}
