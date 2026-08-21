import { readAll, writeVoter, writeSongs, writeGrid, readBody } from "./_sheets.js";

const OWNER = (process.env.OWNER_NAME || "Rich").toLowerCase();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const data = await readAll();
      return res.status(200).json({ ok: true, ...data });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const { secret, name, votes, ts, version, custom, songs } = body || {};

      if (process.env.APP_SECRET && secret !== process.env.APP_SECRET) {
        return res.status(401).json({ ok: false, error: "Wrong access code." });
      }
      if (!name || typeof name !== "string") {
        return res.status(400).json({ ok: false, error: "Missing name." });
      }
      const clean = {};
      for (const [k, v] of Object.entries(votes || {})) {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0 && n <= 3) clean[k] = n;
      }

      await writeVoter({
        name: name.trim(),
        votes: clean,
        ts: Number(ts) || Date.now(),
        version: version || "",
      });

      // Only the owner may change the song list.
      if (Array.isArray(custom) && name.trim().toLowerCase() === OWNER) {
        await writeSongs(
          custom
            .filter((c) => c && c.k && c.name)
            .map((c) => ({
              k: String(c.k),
              name: String(c.name),
              artist: String(c.artist || ""),
              dur: Number(c.dur) || 210,
              set: Number(c.set) === 2 ? 2 : 1,
            }))
        );
      }

      const fresh = await readAll();

      // Best-effort readable grid; never fail the save because of it.
      if (Array.isArray(songs) && songs.length) {
        try {
          await writeGrid(songs, fresh.voters);
        } catch (e) {
          console.error("grid write failed:", e.message);
        }
      }

      return res.status(200).json({ ok: true, ...fresh });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
}
