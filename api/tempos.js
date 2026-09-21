/**
 * The click track's tempos.
 *
 * Every song's BPM starts life in the catalog, but the numbers there are
 * researched rather than played — the band's own tempo is whatever they count
 * in at. The Tempos tab of the sheet is where that gets corrected, either by
 * typing in the cell or by tapping it out on the click page.
 *
 * Reads come down with everything else on /api/votes; this endpoint is the
 * write. Anyone with the access code may set a tempo, not just the owner: the
 * drummer is the one who knows, and the sheet is editable by the whole band
 * anyway.
 */
import { writeTempo, readBody } from "./_sheets.js";
import { songKey, normBpm, normBeats } from "../setlist.js";

function appSecret() {
  let s = (process.env.APP_SECRET || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "POST") {
      const body = await readBody(req);
      const expected = appSecret();
      if (expected && String(body.secret || "").trim() !== expected) {
        return res.status(401).json({ ok: false, error: "Wrong access code." });
      }
      const name = String(body.name || "").trim();
      const artist = String(body.artist || "").trim();
      if (!name) return res.status(400).json({ ok: false, error: "Missing song." });

      const bpm = normBpm(body.bpm);
      if (!bpm) return res.status(400).json({ ok: false, error: "That isn't a playable tempo." });

      const tempos = await writeTempo(songKey(name, artist), name, artist, bpm, normBeats(body.beats));
      return res.status(200).json({ ok: true, tempos });
    }

    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
}
