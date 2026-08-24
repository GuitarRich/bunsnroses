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
  generateSets,
  moveKey,
  parseLen,
  mmss,
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
  it("never includes a negative total, even with time left", () => {
    const rows = [
      song({ k: "good", name: "Good", sum: 4, dur: 120 }),
      song({ k: "bad", name: "Bad", sum: -4, dur: 120 }),
    ];
    const { keep, rest } = selectSet(rows, 1, { target: 45 * 60 });
    assert.deepEqual(keep.map((s) => s.k), ["good"]);
    assert.equal(rest[0].why, "neg");
  });

  it("caps at 1 per artist by default and tags extras CAP", () => {
    const rows = [
      song({ k: "a1", name: "A1", artist: "Nirvana", sum: 12, dur: 120 }),
      song({ k: "a2", name: "A2", artist: "Nirvana", sum: 10, dur: 120 }),
      song({ k: "a3", name: "A3", artist: "Nirvana", sum: 8, dur: 120 }),
      song({ k: "b1", name: "B1", artist: "Pearl Jam", sum: 6, dur: 120 }),
    ];
    const { keep, rest } = selectSet(rows, 1, { target: 45 * 60 });
    assert.deepEqual(keep.map((s) => s.k), ["a1", "b1"]);
    assert.equal(rest.find((s) => s.k === "a2").why, "CAP");
    assert.equal(rest.find((s) => s.k === "a3").why, "CAP");
  });

  it("still honours an explicit maxPerArtist override", () => {
    const rows = [
      song({ k: "a1", name: "A1", artist: "Nirvana", sum: 12, dur: 120 }),
      song({ k: "a2", name: "A2", artist: "Nirvana", sum: 10, dur: 120 }),
      song({ k: "a3", name: "A3", artist: "Nirvana", sum: 8, dur: 120 }),
      song({ k: "b1", name: "B1", artist: "Pearl Jam", sum: 6, dur: 120 }),
    ];
    const { keep } = selectSet(rows, 1, { target: 45 * 60, maxPerArtist: 2 });
    assert.deepEqual(keep.map((s) => s.k), ["a1", "a2", "b1"]);
  });

  it("carries the artist tally in from a previous set", () => {
    const rows = [
      song({ k: "a2", name: "A2", artist: "Nirvana", sum: 10, dur: 120, set: 2 }),
      song({ k: "b2", name: "B2", artist: "Pearl Jam", sum: 8, dur: 120, set: 2 }),
    ];
    const { keep, rest, usedArtists } = selectSet(rows, 2, { usedArtists: { nirvana: 1 } });
    assert.deepEqual(keep.map((s) => s.k), ["b2"]);
    assert.equal(rest.find((s) => s.k === "a2").why, "CAP");
    assert.deepEqual(usedArtists, { nirvana: 1, "pearl jam": 1 });
  });

  it("does not mutate the usedArtists it was given", () => {
    const rows = [song({ k: "a1", name: "A1", artist: "Nirvana", sum: 10, dur: 120 })];
    const seed = {};
    selectSet(rows, 1, { usedArtists: seed });
    assert.deepEqual(seed, {});
  });

  it("skips a song that overruns and keeps walking for a shorter one", () => {
    const rows = [
      song({ k: "long", name: "Long", artist: "A", sum: 10, dur: 400 }),
      song({ k: "mid", name: "Mid", artist: "B", sum: 8, dur: 200 }),
      song({ k: "short", name: "Short", artist: "C", sum: 6, dur: 100 }),
    ];
    const { keep } = selectSet(rows, 1, { target: 320 });
    assert.deepEqual(keep.map((s) => s.k), ["mid", "short"]);
  });

  it("hard-fails when any pooled song has no length", () => {
    const rows = [
      song({ k: "ok", name: "Ok", sum: 4, dur: 180 }),
      song({ k: "zero", name: "Zero", sum: 10, dur: 0 }),
    ];
    const out = selectSet(rows, 1, { target: 45 * 60 });
    assert.equal(out.ok, false);
    assert.match(out.error, /Zero/);
    assert.equal(out.keep.length, 0);
  });

  it("tie-breaks MUST count then shorter duration", () => {
    const rows = [
      song({ k: "long", name: "Long", artist: "A", sum: 6, musts: 0, dur: 300 }),
      song({ k: "must", name: "Must", artist: "B", sum: 6, musts: 2, dur: 300 }),
      song({ k: "short", name: "Short", artist: "C", sum: 6, musts: 0, dur: 120 }),
    ];
    const { ranked } = selectSet(rows, 1, { target: 45 * 60 });
    assert.deepEqual(ranked.map((s) => s.k), ["must", "short", "long"]);
  });
});

describe("ordering", () => {
  it("penalises a closer that is not last", () => {
    const closer = song({ k: "c", name: "C", tags: "closer", energy: 5, dur: 180 });
    const other = song({ k: "o", name: "O", energy: 4, dur: 180 });
    const wrong = orderCost([closer, other]);
    const right = orderCost([other, closer]);
    assert.ok(wrong > right);
  });

  it("penalises slow songs in the last three more than the first three", () => {
    const slow = song({ k: "s", name: "S", energy: 1, tags: "slow", dur: 180 });
    const hot = (k) => song({ k, name: k, energy: 5, dur: 180 });
    const atEnd = orderCost([hot("a"), hot("b"), hot("c"), slow]);
    const atStart = orderCost([slow, hot("a"), hot("b"), hot("c")]);
    assert.ok(atEnd > atStart);
  });

  it("seed+repair puts a tagged closer last when selected", () => {
    const songs = [
      song({ k: "c", name: "Closer", tags: "closer", energy: 5, dur: 180 }),
      song({ k: "o", name: "Opener", tags: "opener", energy: 5, dur: 180 }),
      song({ k: "m", name: "Mid", energy: 3, dur: 180 }),
    ];
    const ordered = orderSet(songs);
    assert.equal(ordered[ordered.length - 1].k, "c");
    assert.equal(ordered[0].k, "o");
  });

  it("seedOrder prefers opener first", () => {
    const songs = [
      song({ k: "m", name: "Mid", energy: 3 }),
      song({ k: "o", name: "Opener", tags: "opener", energy: 5 }),
    ];
    assert.equal(seedOrder(songs)[0].k, "o");
  });
});

describe("applySavedOrder", () => {
  it("keys by identity, drops missing songs, appends new ones", () => {
    const auto = [song({ k: "a" }), song({ k: "b" }), song({ k: "c" })];
    const out = applySavedOrder(auto, ["c", "gone", "a"]);
    assert.deepEqual(out.map((s) => s.k), ["c", "a", "b"]);
  });

  it("moveKey reorders without losing items", () => {
    assert.deepEqual(moveKey(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  });
});

describe("generateSets", () => {
  it("caps an artist across both sets, earlier set claims it first", () => {
    const rows = [
      song({ k: "a1", name: "A1", artist: "Nirvana", sum: 4, dur: 120, set: 1 }),
      song({ k: "a2", name: "A2", artist: "Nirvana", sum: 99, dur: 120, set: 2 }),
      song({ k: "b2", name: "B2", artist: "Pearl Jam", sum: 8, dur: 120, set: 2 }),
    ];
    const out = generateSets(rows, {});
    assert.deepEqual(out[1].ordered.map((s) => s.k), ["a1"]);
    assert.deepEqual(out[2].ordered.map((s) => s.k), ["b2"]);
    assert.equal(out[2].rest.find((s) => s.k === "a2").why, "CAP");
  });

  it("keeps per-set saved orders apart", () => {
    const rows = [
      song({ k: "a", name: "A", artist: "A", sum: 8, dur: 120, set: 1 }),
      song({ k: "b", name: "B", artist: "B", sum: 6, dur: 120, set: 1 }),
      song({ k: "c", name: "C", artist: "C", sum: 4, dur: 120, set: 2 }),
      song({ k: "d", name: "D", artist: "D", sum: 2, dur: 120, set: 2 }),
    ];
    const out = generateSets(rows, { orderKeys: { 1: ["b", "a"], 2: ["d", "c"] } });
    assert.deepEqual(out[1].ordered.map((s) => s.k), ["b", "a"]);
    assert.deepEqual(out[2].ordered.map((s) => s.k), ["d", "c"]);
  });

  it("a failed set still lets the other set build", () => {
    const rows = [
      song({ k: "zero", name: "Zero", artist: "A", sum: 10, dur: 0, set: 1 }),
      song({ k: "c", name: "C", artist: "C", sum: 4, dur: 120, set: 2 }),
    ];
    const out = generateSets(rows, {});
    assert.equal(out[1].ok, false);
    assert.equal(out[2].ok, true);
    assert.deepEqual(out[2].ordered.map((s) => s.k), ["c"]);
  });
});

describe("generateSet", () => {
  it("selects then orders and honours saved keys", () => {
    const rows = [
      song({ k: "a", name: "A", artist: "A", sum: 8, energy: 5, tags: "opener", dur: 180 }),
      song({ k: "b", name: "B", artist: "B", sum: 6, energy: 3, dur: 180 }),
      song({ k: "c", name: "C", artist: "C", sum: 4, energy: 5, tags: "closer", dur: 180 }),
    ];
    const out = generateSet(rows, 1, { target: 45 * 60, orderKeys: ["c", "b", "a"] });
    assert.equal(out.ok, true);
    assert.deepEqual(out.ordered.map((s) => s.k), ["c", "b", "a"]);
    assert.equal(out.auto[out.auto.length - 1].k, "c");
  });
});

describe("parseLen / mmss", () => {
  it("parses m:ss and rejects junk", () => {
    assert.equal(parseLen("3:45"), 225);
    assert.equal(parseLen("3:23:00"), 203);
    assert.equal(parseLen("nope"), 0);
    assert.equal(mmss(225), "3:45");
  });
});
