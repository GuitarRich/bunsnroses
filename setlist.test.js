import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  voteWeight,
  scoreSongs,
  selectSet,
  orderCost,
  seedOrder,
  orderSet,
  applySavedOrder,
  generateSet,
  moveKey,
  parseLen,
  mmss,
  songKey,
  tuningFor,
  normStatus,
  statusOf,
  statusTally,
  parseSetlist,
  parseProgress,
  parseSettings,
  normLimit,
  TARGET_SONGS,
  MAX_SONGS,
  eraLabel,
  TUNING_SEEDS,
} from "./setlist.js";

function song(partial) {
  return {
    k: partial.k || partial.name,
    name: partial.name || partial.k,
    artist: partial.artist || "X",
    dur: partial.dur ?? 180,
    set: partial.set ?? 1,
    energy: partial.energy ?? 0,
    tags: partial.tags || "",
    lead: partial.lead || "",
    sum: partial.sum ?? 0,
    n: partial.n ?? 1,
    musts: partial.musts ?? 0,
  };
}

describe("weights", () => {
  it("maps stored 0-3 to 6/2/1/-4 and blank to 0", () => {
    assert.equal(voteWeight(3), 6);
    assert.equal(voteWeight(2), 2);
    assert.equal(voteWeight(1), 1);
    assert.equal(voteWeight(0), -4);
    assert.equal(voteWeight(undefined), 0);
    assert.equal(voteWeight(""), 0);
  });

  it("scores a pool with MUST and Pass", () => {
    const songs = [song({ k: "a", name: "A" })];
    const pool = { Rich: { a: 3 }, Joel: { a: 0 } };
    const [row] = scoreSongs(songs, pool);
    assert.equal(row.sum, 2);
    assert.equal(row.musts, 1);
    assert.equal(row.n, 2);
  });
});

describe("selectSet", () => {
  it("takes the top scorers up to the song target", () => {
    const rows = [
      song({ k: "a", sum: 9, artist: "A" }),
      song({ k: "b", sum: 8, artist: "B" }),
      song({ k: "c", sum: 7, artist: "C" }),
    ];
    const sel = selectSet(rows, { targetSongs: 2 });
    assert.deepEqual(sel.keep.map((r) => r.k), ["a", "b"]);
    assert.deepEqual(sel.rest.map((r) => [r.k, r.why]), [["c", "count"]]);
  });

  it("never includes a negative total, even with room left", () => {
    const rows = [
      song({ k: "good", sum: 4, artist: "A" }),
      song({ k: "vetoed", sum: -2, artist: "B" }),
    ];
    const sel = selectSet(rows, { targetSongs: 10 });
    assert.deepEqual(sel.keep.map((r) => r.k), ["good"]);
    assert.equal(sel.rest[0].why, "neg");
  });

  it("caps an artist at one song across the whole set", () => {
    const rows = [
      song({ k: "a1", sum: 9, artist: "Nirvana" }),
      song({ k: "a2", sum: 8, artist: "Nirvana" }),
      song({ k: "b1", sum: 7, artist: "Ramones" }),
    ];
    const sel = selectSet(rows, { targetSongs: 10 });
    assert.deepEqual(sel.keep.map((r) => r.k), ["a1", "b1"]);
    assert.equal(sel.rest.find((r) => r.k === "a2").why, "CAP");
  });

  it("keeps a manually included song that lost the vote", () => {
    const rows = [
      song({ k: "loser", sum: -9, artist: "A" }),
      song({ k: "winner", sum: 9, artist: "B" }),
    ];
    const sel = selectSet(rows, { targetSongs: 10, include: ["loser"] });
    const keys = sel.keep.map((r) => r.k);
    assert.ok(keys.includes("loser"), "forced song must be in the set");
    assert.ok(keys.includes("winner"));
    assert.equal(sel.keep.find((r) => r.k === "loser").why, "in");
  });

  it("a forced song claims its artist so the cap still holds", () => {
    const rows = [
      song({ k: "deep", sum: 1, artist: "AC/DC" }),
      song({ k: "hit", sum: 9, artist: "AC/DC" }),
    ];
    const sel = selectSet(rows, { targetSongs: 10, include: ["deep"] });
    assert.deepEqual(sel.keep.map((r) => r.k), ["deep"]);
    assert.equal(sel.rest.find((r) => r.k === "hit").why, "CAP");
  });

  it("a forced song takes a slot, so the set stays at the target size", () => {
    const rows = [
      song({ k: "a", sum: 9, artist: "A" }),
      song({ k: "b", sum: 8, artist: "B" }),
      song({ k: "pet", sum: 1, artist: "C" }),
    ];
    const sel = selectSet(rows, { targetSongs: 2, include: ["pet"] });
    assert.deepEqual(sel.keep.map((r) => r.k).sort(), ["a", "pet"]);
    assert.equal(sel.rest.find((r) => r.k === "b").why, "count");
  });

  it("forced songs all go in even when they overrun the target", () => {
    const rows = [
      song({ k: "p1", sum: 0, artist: "A" }),
      song({ k: "p2", sum: 0, artist: "B" }),
      song({ k: "p3", sum: 0, artist: "C" }),
      song({ k: "auto", sum: 9, artist: "D" }),
    ];
    const sel = selectSet(rows, { targetSongs: 2, include: ["p1", "p2", "p3"] });
    assert.deepEqual(sel.keep.map((r) => r.k).sort(), ["p1", "p2", "p3"]);
    assert.equal(sel.rest.find((r) => r.k === "auto").why, "count");
  });

  it("drops an excluded song however well it scored", () => {
    const rows = [
      song({ k: "banned", sum: 99, artist: "A" }),
      song({ k: "ok", sum: 1, artist: "B" }),
    ];
    const sel = selectSet(rows, { targetSongs: 10, exclude: ["banned"] });
    assert.deepEqual(sel.keep.map((r) => r.k), ["ok"]);
    assert.equal(sel.rest.find((r) => r.k === "banned").why, "out");
  });

  it("exclude beats include when a key is in both", () => {
    const rows = [song({ k: "x", sum: 5, artist: "A" })];
    const sel = selectSet(rows, { targetSongs: 10, include: ["x"], exclude: ["x"] });
    assert.equal(sel.keep.length, 0);
    assert.equal(sel.rest[0].why, "out");
  });

  it("frees the artist slot when its song is excluded", () => {
    const rows = [
      song({ k: "a1", sum: 9, artist: "Nirvana" }),
      song({ k: "a2", sum: 8, artist: "Nirvana" }),
    ];
    const sel = selectSet(rows, { targetSongs: 10, exclude: ["a1"] });
    assert.deepEqual(sel.keep.map((r) => r.k), ["a2"]);
  });

  it("refuses to build when a song in the set has no length", () => {
    const rows = [song({ k: "a", name: "No Length", sum: 5, dur: 0 })];
    const sel = selectSet(rows, { targetSongs: 10 });
    assert.equal(sel.ok, false);
    assert.match(sel.error, /No Length/);
  });

  it("ignores the era field when choosing — one set now, not two", () => {
    const rows = [
      song({ k: "old", sum: 5, set: 1, artist: "A" }),
      song({ k: "new", sum: 4, set: 2, artist: "B" }),
    ];
    const sel = selectSet(rows, { targetSongs: 10 });
    assert.deepEqual(sel.keep.map((r) => r.k), ["old", "new"]);
  });
});

describe("ordering", () => {
  it("puts a closer last and an opener first", () => {
    const rows = [
      song({ k: "mid", energy: 3 }),
      song({ k: "end", tags: "closer", energy: 5 }),
      song({ k: "top", tags: "opener", energy: 5 }),
    ];
    const order = seedOrder(rows);
    assert.equal(order[0].k, "top");
    assert.equal(order[order.length - 1].k, "end");
  });

  it("charges for a slow song in the last three slots", () => {
    const fast = [song({ k: "a", energy: 5 }), song({ k: "b", energy: 5 }), song({ k: "c", energy: 5 })];
    const slowEnd = [song({ k: "a", energy: 5 }), song({ k: "b", energy: 5 }), song({ k: "c", energy: 1 })];
    assert.ok(orderCost(slowEnd) > orderCost(fast));
  });

  it("orderSet returns every song exactly once", () => {
    const rows = [1, 2, 3, 4, 5].map((i) => song({ k: "s" + i, energy: (i % 5) + 1 }));
    const out = orderSet(rows);
    assert.equal(out.length, rows.length);
    assert.deepEqual(new Set(out.map((r) => r.k)).size, rows.length);
  });
});

describe("applySavedOrder", () => {
  it("follows the saved keys, skips dropped songs, appends new ones", () => {
    const auto = [song({ k: "a" }), song({ k: "b" }), song({ k: "c" })];
    const out = applySavedOrder(auto, ["c", "gone", "a"]);
    assert.deepEqual(out.map((r) => r.k), ["c", "a", "b"]);
  });

  it("falls back to the automatic order when nothing is saved", () => {
    const auto = [song({ k: "a" }), song({ k: "b" })];
    assert.deepEqual(applySavedOrder(auto, []).map((r) => r.k), ["a", "b"]);
  });
});

describe("generateSet", () => {
  it("selects, orders, then applies the manual running order", () => {
    const rows = [
      song({ k: "a", sum: 9, artist: "A", energy: 4 }),
      song({ k: "b", sum: 8, artist: "B", energy: 4 }),
      song({ k: "c", sum: 7, artist: "C", energy: 4 }),
    ];
    const gen = generateSet(rows, { targetSongs: 3, orderKeys: ["c", "b", "a"] });
    assert.equal(gen.ok, true);
    assert.deepEqual(gen.ordered.map((r) => r.k), ["c", "b", "a"]);
    assert.equal(gen.ordered.length, gen.auto.length);
  });

  it("reports the failure instead of a half-built set", () => {
    const gen = generateSet([song({ k: "a", name: "Broken", sum: 5, dur: 0 })], { targetSongs: 5 });
    assert.equal(gen.ok, false);
    assert.deepEqual(gen.ordered, []);
  });
});

describe("moveKey", () => {
  it("moves an item without losing any", () => {
    assert.deepEqual(moveKey(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
    assert.deepEqual(moveKey(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  });
});

describe("learning status", () => {
  it("normalises whatever the sheet holds", () => {
    assert.equal(normStatus("Know Song"), "know-it");
    assert.equal(normStatus("in progress"), "in-progress");
    assert.equal(normStatus("WIP"), "in-progress");
    assert.equal(normStatus(""), "not-started");
    assert.equal(normStatus("nonsense"), "not-started");
  });

  it("reads a member's status case-insensitively and defaults to not started", () => {
    const progress = { a: { Rich: "know-it" } };
    assert.equal(statusOf(progress, "a", "rich"), "know-it");
    assert.equal(statusOf(progress, "a", "Joel"), "not-started");
    assert.equal(statusOf(progress, "missing", "Rich"), "not-started");
  });

  it("tallies the band for the readiness bar", () => {
    const progress = { a: { Rich: "know-it", Joel: "in-progress" } };
    assert.deepEqual(statusTally(progress, "a", ["Rich", "Joel", "Pete"]), {
      "not-started": 1,
      "in-progress": 1,
      "know-it": 1,
    });
  });
});

describe("plan sheet parsing", () => {
  it("reads in/out state and orders by position", () => {
    const { states, order } = parseSetlist([
      ["b1", "One", "A", "in", 2],
      ["b2", "Two", "B", "", ""],
      ["b3", "Three", "C", "out", ""],
      ["b4", "Four", "D", "", 1],
    ]);
    assert.deepEqual(states, { b1: "in", b3: "out" });
    assert.deepEqual(order, ["b4", "b1"]);
  });

  it("ignores rows with no key and junk state values", () => {
    const { states, order } = parseSetlist([["", "", "", "in", 1], ["b1", "One", "A", "maybe", ""]]);
    assert.deepEqual(states, {});
    assert.deepEqual(order, []);
  });

  it("falls back to a title/artist key when the Key cell is blank", () => {
    const { states } = parseSetlist([["", "Kiss", "Prince", "in", ""]]);
    assert.deepEqual(states, { [songKey("Kiss", "Prince")]: "in" });
  });

  it("reads member columns out of the progress grid header", () => {
    const progress = parseProgress([
      ["Key", "Title", "Artist", "Rich", "Joel"],
      ["b1", "One", "A", "Know Song", ""],
      ["b2", "Two", "B", "", "in progress"],
      ["b3", "Three", "C", "", ""],
    ]);
    assert.deepEqual(progress, { b1: { Rich: "know-it" }, b2: { Joel: "in-progress" } });
  });

  it("returns an empty map for an empty tab", () => {
    assert.deepEqual(parseProgress([]), {});
    assert.deepEqual(parseProgress([["Key", "Title", "Artist"]]), {});
  });
});

describe("song limit", () => {
  it("clamps a hand-typed limit into range", () => {
    assert.equal(normLimit(12), 12);
    assert.equal(normLimit("12"), 12);
    assert.equal(normLimit(4.6), 5);
    assert.equal(normLimit(9999), MAX_SONGS);
    assert.equal(normLimit(0), TARGET_SONGS);
    assert.equal(normLimit(-3), TARGET_SONGS);
    assert.equal(normLimit("nonsense"), TARGET_SONGS);
    assert.equal(normLimit(undefined), TARGET_SONGS);
  });

  it("falls back to the value given, not just the default", () => {
    assert.equal(normLimit("", 20), 20);
    assert.equal(normLimit(null, 20), 20);
  });

  it("reads the limit off the Settings tab, case-insensitively", () => {
    assert.deepEqual(parseSettings([["Song limit", 21]]), { songLimit: 21 });
    assert.deepEqual(parseSettings([["  SONG LIMIT ", "21"]]), { songLimit: 21 });
  });

  it("defaults when the tab is empty or holds junk", () => {
    assert.deepEqual(parseSettings([]), { songLimit: TARGET_SONGS });
    assert.deepEqual(parseSettings([["Song limit", "many"]]), { songLimit: TARGET_SONGS });
    assert.deepEqual(parseSettings([["Unrelated", 5]]), { songLimit: TARGET_SONGS });
  });

  it("drives how many songs the set takes", () => {
    const rows = [1, 2, 3, 4, 5].map((i) => song({ k: "s" + i, sum: 10 - i, artist: "A" + i }));
    assert.equal(selectSet(rows, { targetSongs: 2 }).keep.length, 2);
    assert.equal(selectSet(rows, { targetSongs: 5 }).keep.length, 5);
  });
});

describe("parseLen / mmss", () => {
  it("reads m:ss and rejects nonsense", () => {
    assert.equal(parseLen("3:45"), 225);
    assert.equal(parseLen("0:30"), 30);
    assert.equal(parseLen("nope"), 0);
    assert.equal(parseLen("99:00"), 0);
  });

  it("round-trips through mmss", () => {
    assert.equal(mmss(225), "3:45");
    assert.equal(mmss(60), "1:00");
    assert.equal(mmss(0), "0:00");
  });
});

describe("eras", () => {
  it("labels the old set field as an era, not a set", () => {
    assert.equal(eraLabel({ set: 1 }), "70s/80s");
    assert.equal(eraLabel({ set: 2 }), "90s+");
  });
});

describe("tunings", () => {
  it("keys on name and artist alike regardless of punctuation", () => {
    assert.equal(songKey("Would?", "Alice In Chains"), songKey("would", "alice in chains"));
  });

  it("a blank sheet cell means no tuning, not fall back to the seed", () => {
    const seeded = TUNING_SEEDS[0];
    const k = songKey(seeded.name, seeded.artist);
    assert.equal(tuningFor({}, seeded.name, seeded.artist), seeded.tuning);
    assert.equal(tuningFor({ [k]: "" }, seeded.name, seeded.artist), "");
    assert.equal(tuningFor({ [k]: "Drop C" }, seeded.name, seeded.artist), "Drop C");
  });
});
