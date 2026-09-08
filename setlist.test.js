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
  parseLyrics,
  lyricsFor,
  lyricBlocks,
  isChordLine,
  chordParts,
  isSectionLine,
  expandChordPro,
  lyricLines,
  hasChords,
  scrollPlan,
  clampSpeed,
  advanceScroll,
  esc,
} from "./setlist.js";
import { chordShape, parseChord, stringsFor, fingering, TUNINGS } from "./chords.js";

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

describe("lyrics", () => {
  it("reads the sheet rows into a map, keyed like everything else", () => {
    const map = parseLyrics([
      ["", "Would?", "Alice In Chains", "line one\nline two"],
      ["custom1", "A Song", "A Band", "words"],
      ["", "", "", "orphan"],
    ]);
    assert.equal(map[songKey("Would?", "Alice In Chains")], "line one\nline two");
    assert.equal(map.custom1, "words");
    assert.equal(Object.keys(map).length, 2);
  });

  it("a row with a blank cell means no lyrics yet, not a missing song", () => {
    const map = parseLyrics([["", "Would?", "Alice In Chains", ""]]);
    assert.ok(songKey("Would?", "Alice In Chains") in map);
    assert.equal(lyricsFor(map, "Would?", "Alice In Chains"), "");
    assert.equal(lyricsFor({}, "Would?", "Alice In Chains"), "");
  });

  it("normalises windows line endings and trims the outer whitespace", () => {
    const map = parseLyrics([["k1", "T", "A", "\r\n one \r\n two \r\n"]]);
    assert.equal(map.k1.includes("\r"), true);
    assert.equal(lyricsFor({ k1: map.k1 }, "T", "A"), "");
    assert.equal(lyricsFor(parseLyrics([["", "T", "A", "\r\none\r\ntwo\r\n"]]), "T", "A"), "one\ntwo");
  });

  it("splits into blocks on blank lines so a verse survives a page break", () => {
    assert.deepEqual(lyricBlocks("one\ntwo\n\n\nthree"), ["one\ntwo", "three"]);
    assert.deepEqual(lyricBlocks(""), []);
    assert.deepEqual(lyricBlocks("   \n\n  "), []);
  });
});

describe("esc", () => {
  it("neutralises markup from song titles and member names", () => {
    assert.equal(esc('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
    assert.equal(esc('<script>x</script>'), "&lt;script&gt;x&lt;/script&gt;");
    assert.equal(esc('" onmouseover="evil()'), "&quot; onmouseover=&quot;evil()");
    assert.equal(esc("it's & that"), "it&#39;s &amp; that");
  });

  it("leaves ordinary titles alone and survives blanks", () => {
    assert.equal(esc("Rock 'n' Roll"), "Rock &#39;n&#39; Roll");
    assert.equal(esc("Would?"), "Would?");
    assert.equal(esc(null), "");
    assert.equal(esc(undefined), "");
    assert.equal(esc(0), "0");
  });
});

describe("chords", () => {
  it("recognises chord symbols people actually write", () => {
    for (const c of ["G", "Am", "C#m7", "Dsus4", "F#m7b5", "Cmaj7", "G/B", "Bb",
                     "A7sus4", "Em9", "Ab/C", "Bm7/A", "Eb", "D°"]) {
      assert.equal(isChordLine(c), true, c);
    }
  });

  it("leaves lyrics alone even when they open with a note letter", () => {
    for (const w of ["Bad", "Cage", "Gas", "Adam", "Balm", "Cause", "Aim", "Dad",
                     "Gem", "Add", "Aug", "Bass", "Fade", "Dance",
                     "Someone left the cake out in the rain",
                     "Am I the only one who cares"]) {
      assert.equal(isChordLine(w), false, w);
    }
    assert.equal(isChordLine(""), false);
    assert.equal(isChordLine("   "), false);
  });

  it("reads a chord line with bars and repeat marks", () => {
    assert.equal(isChordLine("G      D       Em     C"), true);
    assert.equal(isChordLine("| Am | F | C | G  x2"), true);
    assert.equal(isChordLine("N.C."), false);   // no real chord on the line
    assert.equal(isChordLine("| | |"), false);
  });

  it("reads a riff written in bars, with the chord glued to the bar line", () => {
    assert.equal(isChordLine("|A5 |A5 | 8x"), true);
    assert.equal(isChordLine("|D Dsus4 D |D |D Dsus4 D |Dsus4 D |"), true);
    assert.equal(isChordLine("|E5 |E5 | 2x"), true);
    assert.equal(isChordLine("|A5 |A5 | x8"), true);
    // and it still knows words when it sees them
    assert.equal(isChordLine("See it on television, every day"), false);
  });

  it("splits a bar line off the chord so only the chord is tappable", () => {
    assert.deepEqual(chordParts("|A5"), { lead: "|", core: "A5", trail: "", chord: true });
    assert.deepEqual(chordParts("|A5|"), { lead: "|", core: "A5", trail: "|", chord: true });
    assert.deepEqual(chordParts("Dsus4"), { lead: "", core: "Dsus4", trail: "", chord: true });
    assert.equal(chordParts("|").chord, false);
    assert.equal(chordParts("|").core, "");
    assert.equal(chordParts("8x").chord, false);
    assert.equal(chordParts("").chord, false);
  });

  it("tells a section label from a chord in brackets", () => {
    for (const t of ["[Chorus]", "Verse 2", "(Solo)", "Pre-Chorus", "Intro", "Middle 8"]) {
      assert.equal(isSectionLine(t), true, t);
    }
    assert.equal(isSectionLine("[G]"), false);
    assert.equal(isSectionLine("[Am7]"), false);
    assert.equal(isSectionLine("Bridge over troubled water"), false);
    assert.equal(isSectionLine(""), false);
  });

  it("expands inline ChordPro into a chord row over the words", () => {
    const r = expandChordPro("[G]Someone left the [D]cake out");
    assert.equal(r.words, "Someone left the cake out");
    assert.equal(r.chords, "G                D");
    assert.equal(r.chords.indexOf("D"), r.words.indexOf("cake"));
  });

  it("never lets two inline chords touch", () => {
    const r = expandChordPro("[C][G]go");
    assert.equal(r.words, "go");
    assert.equal(r.chords, "C G");
  });

  it("passes plain text and bracketed labels through untouched", () => {
    assert.equal(expandChordPro("just some words"), null);
    assert.equal(expandChordPro("[Chorus] words"), null);
    assert.equal(expandChordPro(""), null);
  });

  it("types every line of a block so the book can style them apart", () => {
    assert.deepEqual(lyricLines("[Chorus]\nG       D\nHello there"), [
      { type: "section", text: "Chorus" },
      { type: "chord", text: "G       D" },
      { type: "words", text: "Hello there" },
    ]);
    assert.deepEqual(lyricLines("plain words"), [{ type: "words", text: "plain words" }]);
    assert.equal(lyricLines("")[0].type, "gap");
  });

  it("flags only the blocks that need the monospace grid", () => {
    assert.equal(hasChords(lyricLines("G  D\nwords")), true);
    assert.equal(hasChords(lyricLines("[Chorus]\njust words")), false);
    assert.equal(hasChords([]), false);
  });
});

describe("chord shapes", () => {
  const E = TUNINGS["e standard"];
  const grid = (sym, strings) => {
    const s = chordShape(sym, strings || E);
    return s ? s.frets.map((f) => (f < 0 ? "x" : f)).join("") : null;
  };

  it("finds the shape a guitarist would actually play", () => {
    const want = {
      C: "x32010", Am: "x02210", G: "320003", D: "xx0232", E: "022100",
      Em: "022000", Dm: "xx0231", A: "x02220", A7: "x02020", E7: "020100",
      D7: "xx0212", G7: "320001", Cmaj7: "x32000", Am7: "x02010", Em7: "020000",
      "G/B": "x20003", "C/G": "332010",
    };
    for (const [sym, frets] of Object.entries(want)) assert.equal(grid(sym), frets, sym);
  });

  it("reaches for a barre only when the shape needs one", () => {
    assert.equal(chordShape("D", E).barre, null);       // xx0232 is three fingers
    assert.equal(chordShape("A7", E).barre, null);      // x02020, index and ring
    assert.equal(grid("F"), "133211");
    assert.equal(chordShape("F", E).barre.fret, 1);
    assert.equal(grid("Bm"), "x24432");
    assert.equal(chordShape("Bm", E).barre.fret, 2);
  });

  it("puts the bass of a slash chord on the lowest string that sounds", () => {
    const g = chordShape("G/B", E);
    const low = g.frets.findIndex((f) => f >= 0);
    assert.equal((E[low] + g.frets[low]) % 12, 11);     // B
    const c = chordShape("C/G", E);
    const lowC = c.frets.findIndex((f) => f >= 0);
    assert.equal((E[lowC] + c.frets[lowC]) % 12, 7);    // G
  });

  it("works the shapes out again for a different tuning", () => {
    // Everything moves a fret when the whole guitar is a semitone down.
    assert.equal(grid("Eb", TUNINGS["eb standard"]), grid("E", E));
    assert.notEqual(grid("D", TUNINGS["drop d"]), grid("D", E));
    assert.equal(grid("D", TUNINGS["drop d"]), "000232");
  });

  it("reads the tuning tags the sheet actually contains", () => {
    assert.deepEqual(stringsFor("E standard"), TUNINGS["e standard"]);
    assert.deepEqual(stringsFor("E standard (riff is bass)"), TUNINGS["e standard"]);
    assert.deepEqual(stringsFor("Drop D"), TUNINGS["drop d"]);
    assert.deepEqual(stringsFor("Half step down"), TUNINGS["eb standard"]);
    assert.deepEqual(stringsFor(""), TUNINGS["e standard"]);
    assert.deepEqual(stringsFor("nonsense"), TUNINGS["e standard"]);
  });

  it("reads the notes out of a chord symbol", () => {
    assert.deepEqual([...parseChord("C").pcs].sort((a, b) => a - b), [0, 4, 7]);
    assert.deepEqual([...parseChord("Am").pcs].sort((a, b) => a - b), [0, 4, 9]);
    assert.deepEqual([...parseChord("G7").pcs].sort((a, b) => a - b), [2, 5, 7, 11]);
    assert.equal(parseChord("C5").third, null);        // power chord has no third
    assert.equal(parseChord("Csus4").third, 5);
    assert.equal(parseChord("G/B").slash, true);
    assert.equal(parseChord("G/B").bass, 11);
    assert.equal(parseChord("H"), null);
    assert.equal(parseChord("Cwobble"), null);
  });

  it("never asks for a fifth finger", () => {
    for (const sym of ["C", "F", "Bb", "Bm", "F#m", "Ab", "Eb", "B7", "C#m", "Bbm", "Dm7"]) {
      const s = chordShape(sym, E);
      assert.ok(s, sym);
      assert.ok(Math.max(...s.fingers) <= 4, sym + " needs " + Math.max(...s.fingers) + " fingers");
      const fretted = s.frets.filter((f) => f > 0);
      assert.ok(Math.max(...fretted) - Math.min(...fretted) <= 3, sym + " spans too far");
    }
  });

  it("keeps open strings out of shapes played up the neck", () => {
    for (const sym of ["C", "F", "Bb", "Eb", "Ab", "C#m", "F#", "B7", "D5"]) {
      const s = chordShape(sym, E);
      const fretted = s.frets.filter((f) => f > 0);
      if (fretted.length && Math.max(...fretted) > 5) {
        assert.ok(!s.frets.includes(0), sym + " mixes open strings with a high position");
      }
    }
  });

  it("gives the barre finger 1 and hands the rest out low fret first", () => {
    const f = fingering([1, 3, 3, 2, 1, 1]);
    assert.deepEqual(f.fingers, [1, 3, 4, 2, 1, 1]);
    assert.deepEqual(f.barre, { fret: 1, from: 0, to: 5 });
    assert.deepEqual(fingering([-1, 0, 2, 2, 1, 0]).fingers, [0, 0, 2, 3, 1, 0]);
    assert.equal(fingering([0, 0, 0, 0, 0, 0]).count, 0);
  });
});

describe("autoscroll pacing", () => {
  it("ends with the last line at the bottom of the screen, not off the top", () => {
    const p = scrollPlan(1000, 3000, 800, 300);
    assert.equal(p.from, 1000);
    assert.equal(p.to, 3200);          // 1000 + 3000 - 800
    assert.equal(p.distance, 2200);
  });

  it("paces itself to the length of the song", () => {
    const short = scrollPlan(0, 2000, 800, 120);
    const long = scrollPlan(0, 2000, 800, 300);
    assert.ok(short.pxPerSec > long.pxPerSec);
    assert.equal(long.pxPerSec * 300, long.distance);
  });

  it("has nowhere to go when the song already fits on screen", () => {
    const p = scrollPlan(1000, 500, 800, 300);
    assert.equal(p.distance, 0);
    assert.equal(p.pxPerSec, 0);       // and no division by nothing
    assert.equal(p.to, p.from);
  });

  it("survives a song with no running time on it", () => {
    for (const dur of [0, -5, null, undefined, "", "abc"]) {
      assert.equal(scrollPlan(0, 3000, 800, dur).pxPerSec, 0, String(dur));
    }
  });

  it("never scrolls above the top of the page", () => {
    assert.equal(scrollPlan(-500, 3000, 800, 300).from, 0);
  });

  it("keeps the speed override inside something readable", () => {
    assert.equal(clampSpeed(1.1), 1.1);
    assert.equal(clampSpeed(0.1), 0.25);
    assert.equal(clampSpeed(99), 4);
    assert.equal(clampSpeed("nonsense"), 1);
    assert.equal(clampSpeed(undefined), 1);
    assert.equal(clampSpeed(1.0000001), 1);   // rounded, so the readout stays short
  });
});

describe("autoscroll frames", () => {
  const plan = scrollPlan(1000, 3000, 800, 200);   // 2200px over 200s = 11px/s

  it("moves at the song's pace", () => {
    const f = advanceScroll(plan, plan.from, 1, 1);
    assert.equal(Math.round(f.pos), 1011);
    assert.equal(f.done, false);
  });

  it("takes the length of the song to get to the end", () => {
    let pos = plan.from;
    let ticks = 0;
    while (ticks < 1000) {
      const f = advanceScroll(plan, pos, 1, 1);
      pos = f.pos;
      ticks++;
      if (f.done) break;
    }
    assert.equal(ticks, 200);
    assert.equal(pos, plan.to);
  });

  it("stops itself at the end and goes no further", () => {
    const f = advanceScroll(plan, plan.to - 1, 10, 1);
    assert.equal(f.pos, plan.to);
    assert.equal(f.done, true);
    assert.equal(f.progress, 1);
    assert.equal(f.remaining, 0);
    // and a frame after the end stays put rather than running off the page
    assert.equal(advanceScroll(plan, plan.to, 5, 1).pos, plan.to);
  });

  it("honours the speed override", () => {
    const one = advanceScroll(plan, plan.from, 1, 1).pos - plan.from;
    const two = advanceScroll(plan, plan.from, 1, 2).pos - plan.from;
    const half = advanceScroll(plan, plan.from, 1, 0.5).pos - plan.from;
    assert.ok(Math.abs(two - one * 2) < 1e-9);
    assert.ok(Math.abs(half - one / 2) < 1e-9);
    // out-of-range overrides are clamped, not obeyed
    assert.equal(advanceScroll(plan, plan.from, 1, 99).pos, advanceScroll(plan, plan.from, 1, 4).pos);
  });

  it("reports the time left, and shortens it when you speed up", () => {
    assert.equal(Math.round(advanceScroll(plan, plan.from, 0, 1).remaining), 200);
    assert.equal(Math.round(advanceScroll(plan, plan.from, 0, 2).remaining), 100);
  });

  it("picks up from wherever the reader dragged the page to", () => {
    const dragged = advanceScroll(plan, 2000, 1, 1);
    assert.equal(Math.round(dragged.pos), 2011);
    assert.ok(dragged.progress > 0.45 && dragged.progress < 0.46);
    // dragged above the start, it clamps rather than scrolling backwards
    assert.equal(advanceScroll(plan, 0, 0, 1).pos, plan.from);
  });

  it("does nothing for a song that already fits on screen", () => {
    const flat = scrollPlan(0, 500, 800, 200);
    const f = advanceScroll(flat, flat.from, 10, 1);
    assert.equal(f.pos, flat.from);
    assert.equal(f.done, true);
    assert.equal(f.remaining, 0);
  });

  it("shrugs off a junk frame time", () => {
    for (const dt of [-1, NaN, undefined, null, "x"]) {
      assert.equal(advanceScroll(plan, plan.from, dt, 1).pos, plan.from, String(dt));
    }
  });
});
