/**
 * The lyric book's words.
 *
 * Lyrics live in the sheet's Lyrics tab and nowhere else — the band types them
 * in themselves. This endpoint only reads that tab back out, plus a POST that
 * adds a labelled blank row for any song the tab hasn't got yet so there is
 * always somewhere obvious to paste.
 *
 * It is deliberately separate from /api/votes: lyrics are bulky and only the
 * book needs them, so the poll every page makes stays small.
 */
import { readLyrics, seedLyrics, readBody } from "./_sheets.js";

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
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, lyrics: await readLyrics() });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const expected = appSecret();
      if (expected && String(body.secret || "").trim() !== expected) {
        return res.status(401).json({ ok: false, error: "Wrong access code." });
      }
      const songs = (Array.isArray(body.songs) ? body.songs : [])
        .filter((s) => s && s.k && s.name)
        .map((s) => ({ k: String(s.k), name: String(s.name), artist: String(s.artist || "") }));
      if (!songs.length) return res.status(400).json({ ok: false, error: "Missing song list." });
      return res.status(200).json({ ok: true, lyrics: await seedLyrics(songs) });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
}
