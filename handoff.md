# Build spec: a group voting page backed by a Google Sheet

Hand this whole file to a new chat. It describes a system that has been built,
debugged and used for real, so treat the "gotchas" section as findings rather
than suggestions — every one of them is a bug that shipped and had to be fixed.

The original instance was a band voting on a setlist. The voting machinery is
domain-agnostic; the setlist-specific parts are marked **[DOMAIN]** and are the
bits you replace.

---

## 1. What it is

A page where a fixed group of named people vote on a list of items, the votes
land in a Google Sheet automatically, and a results page shows a live tally plus
an auto-generated shortlist.

Hard requirements that shaped every decision:

- **No logins.** Voters are a handful of ordinary people. Not one of them will
  create an account, and several don't have a Google account at all.
- **No server to run or pay for.**
- **No copy/paste.** Votes write straight to the sheet.
- **The sheet is the source of truth.** Adding or removing an item must never
  require a code change or a deploy.

## 2. Architecture

Three pieces, no server:

```
GitHub Pages (static HTML/JS)  ->  Apps Script Web App (/exec)  ->  Google Sheet
```

- **GitHub Pages** hosts three static pages. Free, public URL, no auth.
- **Apps Script Web App** deployed as _Execute as: Me_ / _Who has access: Anyone_.
  This is the trick that makes it loginless — the script runs with the sheet
  owner's permissions, so anonymous visitors can read and write without ever
  touching Google auth.
- **Google Sheet** stores everything. The owner can also just edit it by hand,
  which matters more than it sounds: when something goes wrong, the fix is
  usually "open the sheet and retype a cell".

Why not a database or a real backend: the whole thing has to outlive the
project's attention span. A sheet is something a non-technical owner can still
operate in six months.

### Files

| File             | Role                                                                |
| ---------------- | ------------------------------------------------------------------- |
| `index.html`     | The ballot. Pick your name, vote, save.                             |
| `results.html`   | Live tally, everyone's votes, generated shortlist.                  |
| `admin.html`     | Add / edit / remove items. Key-gated.                               |
| `config.js`      | The only file anyone edits: the `/exec` URL and voter names.        |
| `apps-script.gs` | The backend. Pasted into the Sheet's Apps Script editor.            |
| `.nojekyll`      | Stops GitHub Pages' Jekyll from eating files. Empty file. Required. |

`config.js` is separate on purpose so the owner can repoint the API without
touching a page:

```js
window.SETLIST_API = "https://script.google.com/macros/s/AKfy.../exec";
window.SETLIST_VOTERS = [
  "Rich",
  "Ashley",
  "CJ",
  "Justin",
  "Isaac",
  "Julie",
  "Organiser",
];
```

With `SETLIST_API` empty, both pages fall back to manual copy/paste and admin
disables itself. Always ship that fallback — it means the site is never fully
broken.

## 3. Sheet layout

Header on **row 3** (rows 1–2 are a human-readable title block). Data starts
row 4. One item per row.

| Cols | Contents                                                                 |
| ---- | ------------------------------------------------------------------------ |
| A–F  | Item details **[DOMAIN]** — here: #, Section, Song, Artist, Lead, Length |
| G–M  | One column per voter. The only cells a voter writes.                     |
| N    | `SCORE` — ARRAYFORMULA, see below                                        |
| O    | `MUSTs` — count of MUST votes, tiebreaker                                |
| P–Q  | `Energy`, `Tags` **[DOMAIN]** — ordering hints                           |
| R    | `Order` — manual running order; blank = automatic                        |

Column C is the "does this row exist" sentinel (the item title). The score
formulas key off it so blank rows stay blank.

`setupSheet()` writes the headers, the formulas and the conditional formatting
in one go. Have the owner run it once. It is idempotent — safe to re-run after
changing voters or weights, which is exactly what you want, because the voter
names _will_ be wrong the first time.

The score formula is generated from the weights object so there is one source
of truth:

```js
var terms = Object.keys(WEIGHTS)
  .map(function (k) {
    return "(" + vRange + '="' + k + '")*(' + WEIGHTS[k] + ")";
  })
  .join("+");
sh.getRange(first, COL_SCORE).setFormula(
  "=ARRAYFORMULA(IF(" +
    cRange +
    '="","",MMULT(' +
    terms +
    ",SEQUENCE(7,1,1,0))))",
);
```

`MMULT(..., SEQUENCE(n,1,1,0))` is how you sum across a row inside an
ARRAYFORMULA — a plain `SUM` collapses the whole range to one number. The `7`
is the voter count; derive it, don't hardcode it twice.

Range ceiling `MAX_ROW = 300` so the formulas already cover rows that don't
exist yet and new items score without anyone dragging a formula down.

## 4. Backend contract

`doGet` returns everything in one call:

```json
{
  "ok": true,
  "data": {
    "voters": ["Rich", "..."],
    "weights": { "MUST": 6, "YES": 2, "MAYBE": 1, "NO": -4 },
    "limits": { "maxPerArtist": 2 },
    "rows": [
      {
        "row": 4,
        "song": "...",
        "artist": "...",
        "lead": "V1",
        "len": "3:42",
        "energy": 4,
        "tags": ["opener"],
        "order": 0,
        "votes": { "Rich": "MUST" }
      }
    ]
  }
}
```

Serving `weights` and `limits` from the backend rather than duplicating them in
the pages is worth doing from day one. Changing a number in `apps-script.gs`
then changes the sheet formula _and_ both pages.

`doPost` takes `{action:'vote'|'admin', ...}`. Two things matter:

**Send `Content-Type: text/plain;charset=utf-8`.** Apps Script does not answer
CORS preflight. `application/json` triggers a preflight and the request dies in
the browser with an opaque error. `text/plain` is a "simple request" and goes
straight through. Parse `e.postData.contents` as JSON server-side anyway.

**Wrap `doPost` in `LockService.getScriptLock()`.** Six people voting at once
on a phone will otherwise interleave writes and lose votes.

A vote writes **only that voter's column**, found by name in the header row —
never a whole-row write. Admin actions are gated on a shared `ADMIN_KEY`
constant. That is deliberately weak security: it stops a bandmate deleting a
row by accident, nothing more. Say so out loud rather than implying it's real
auth.

## 5. Scoring

Four values plus blank:

| Vote  | Weight |
| ----- | ------ |
| MUST  | 6      |
| YES   | 2      |
| MAYBE | 1      |
| NO    | −4     |
| blank | 0      |

The scale started as MUST 3 / YES 1 / NO −2. When MAYBE was added later, every
weight was **doubled** rather than inserting a fraction — that let MAYBE be 1
without re-ranking a single existing vote. If you ever add a value mid-flight,
scale the existing set instead of squeezing the new one in. It's the difference
between "nothing changed" and "everyone's votes moved".

NO at −4 is deliberately heavier than YES at +2. One person who hates a thing
should outweigh one person who likes it, because the group has to live with it.

## 6. Selection, then ordering — keep them separate

This is the single most important structural idea.

- **Selection** is pure score. Take items highest-first until the budget is
  full. Never promote or demote against the vote.
- **Ordering** is a completely separate pass over the already-chosen items.

Keeping them apart means you can explain any result: "it's in because it scored,
it's in _that slot_ because of pacing." Mixing them produces a system nobody
trusts, because a low-scoring item appearing high looks like the vote was
ignored.

Two hard limits in selection:

- Negative total is never included, even with budget spare.
- **Max N per group** (`MAX_PER_ARTIST = 2`) **[DOMAIN]** — diversity cap.
  Locked items count towards the allowance but are never dropped. Since the
  list is score-ordered, a group keeps its best N and the rest get marked `CAP`
  in the ranking view so nobody thinks their vote vanished.

The ordering pass **[DOMAIN]** is a cost model: assign items to slots against a
target curve, then run pairwise repair passes. See gotcha 5 — it is where all
the subtle bugs live.

## 7. Gotchas — all of these actually bit

**1. Google Sheets silently retypes `3:23` as a time value.**
Read the sheet with **`getDisplayValues()`, never `getValues()`**. Reading a
time cell back as a Date and reformatting it is timezone-dependent and produced
runtimes in the hundreds of hours. Do **not** try to salvage a raw date string
by scraping digits out of it — that was attempted, and it silently produced
wrong-but-plausible numbers, which is far worse than failing.

The parser must also accept Sheets' _rendered_ forms (`3:23:00`, `3:23:00 AM`)
and treat anything over a sane ceiling as a misparse:

```js
const MAX_ITEM = 15 * 60;
function parseLen(v) {
  const t = String(v == null ? "" : v)
    .trim()
    .toUpperCase()
    .replace(/\s*[AP]M$/, "");
  const m = t.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]\d))?$/);
  if (!m) return 0;
  let secs;
  if (m[3] === undefined) {
    secs = +m[1] * 60 + +m[2];
  } else {
    secs = +m[1] * 3600 + +m[2] * 60 + +m[3];
    if (secs > MAX_ITEM) secs = +m[1] * 60 + +m[2];
  } // "3:23:00" means 3m23s
  return secs > 0 && secs <= MAX_ITEM ? secs : 0;
}
```

**2. A zero from a failed parse doesn't stay local — it breaks a limit
somewhere else.** When lengths parsed to 0, the runtime cap never bound and the
generator emitted 45 items instead of 20, including ones voted down. The
symptom was nowhere near the cause. **Hard-fail loudly instead:** if any pooled
item has no readable length, refuse to build and show a banner naming the bad
rows. A visible refusal beats a plausible wrong answer every time.

**3. A blank cell is a value, not an absence.** There was a built-in fallback
map of sensible defaults for well-known items. Clearing a cell in the sheet made
the row fall back to that map, so deleting a tag appeared to do nothing and the
user rightly said the feature was broken. Fix: treat a row as **curated** if it
has a value in the anchor column (`Energy`), and for curated rows use the sheet
exactly as written including blank:

```js
const curated = r.energy > 0;
const sheetTags = (r.tags || []).filter((t) => t && !/^(-|none)$/i.test(t));
const cleared = curated || (r.tags || []).some((t) => /^(-|none)$/i.test(t));
const m = {
  e: curated ? r.energy : fb.e,
  tags: sheetTags.length ? sheetTags : cleared ? [] : fb.tags || [],
};
```

Any invisible fallback needs an explicit way to say "no, really, empty".

**4. Defaults that look like data.** The admin page defaulted Energy to 3, so
every row read 3 and the ordering had nothing to work with while looking
perfectly populated. Either force the field or make the default visibly
distinct from a real value.

**5. Penalty weights in a cost model must be commensurable.** Three separate
bugs traced to this one root cause. "Protect the ending" was weighted 3 while
"don't cluster slow items" was weighted 18–25, so the ending protection simply
never won and the closer kept drifting to slot 6. Put every penalty on one
scale, written in one place, and read the list top to bottom asking "is this
really worth six times that?":

```
slow in last three            +30
slow in first three           +20
two slow adjacent             +18
dedication before 40%         +18
ballad in first third         +16
three sharing a lead          +15
closer not in last slot       +14
sub-4 energy in last three    (4-e)*9
4-item window avg < 3.1       (3.1-avg)*14
```

**6. An auto-generated order that keeps moving is infuriating.** Votes trickle
in, the order changes, and the group loses confidence in it. Add manual
override: drag/arrow reordering, saved to a dedicated sheet column, with three
explicit states — _automatic_, _unsaved local change_, _saved for everyone_ —
and a one-click "back to automatic". Store positions keyed by item identity,
not by index, so items that later drop out don't corrupt the saved order.

**7. Link to copyrighted material, never copy it.** Lyrics and tabs are
copyrighted. Build search deep links from the item fields, so nothing needs
maintaining in the sheet and items added later get links for free:

```js
const q = (s) => encodeURIComponent(s.artist + " " + s.song);
"https://www.ultimate-guitar.com/search.php?search_type=title&order=myweight&value=" +
  q(s);
"https://www.songsterr.com/?pattern=" + q(s);
"https://musescore.com/sheetmusic?text=" + q(s);
"https://genius.com/search?q=" + q(s);
```

Search URLs beat fixed page URLs: a bad title match is one click from the right
answer instead of a dead link.

**8. Editing `apps-script.gs` is not enough.** Changes only go live via
**Deploy → Manage deployments → edit → Version: New version → Deploy.** Saving
the editor does nothing to the live URL. Say this every single time you hand
over a backend change, because it will otherwise look like the change didn't
work.

## 8. Testing without touching the live sheet

Worth the hour it costs. A tiny Node mock of the Apps Script endpoint on
`localhost:8899` serving the same JSON shape, plus headless Chromium via
Playwright driving the real pages against it. That is how the reorder loop was
verified end to end: automatic order → drag → banner flips to unsaved → save →
reload as a fresh visitor → same order → back to automatic → matches the
original.

Give the mock a flag that reproduces the date-value bug from gotcha 1, so the
hard-fail path stays tested.

## 9. Setup runbook (give this to the owner verbatim)

1. Create the Google Sheet. **Extensions → Apps Script.**
2. Delete `Code.gs`, paste in `apps-script.gs`.
3. Change `ADMIN_KEY` and the `VOTERS` list at the top. Save.
4. Run `setupSheet` once, approve the permission prompt.
5. **Deploy → New deployment → Web app.** Execute as **Me**, who has access
   **Anyone**. Deploy, approve, copy the `/exec` URL.
6. Paste that URL into `window.SETLIST_API` in `config.js`.
7. Push to a GitHub repo with Pages enabled. Live in about a minute.

## 10. What to change for a different voting list

Keep as-is: the sheet/Apps Script/Pages architecture, the doGet/doPost contract,
`text/plain` POST, the lock, the weights model, the per-voter column write, the
selection-then-ordering split, admin key gating, and every gotcha above.

Replace: columns A–F, the budget (90 minutes here — could be a headcount, a
spend, or nothing at all), the diversity cap dimension, and the entire ordering
pass. **If the new list has no natural sequence, drop ordering completely** and
ship selection plus the ranking table. Most of the complexity in this build is
in the ordering, and most voting problems don't need it.

Ask the owner three questions before writing anything:

1. Who votes, by name? (Fixed roster, no logins — get the exact spelling. It
   was wrong on the first pass here and every wrong name is a broken column.)
2. What is the budget that decides where the list gets cut?
3. Is there a diversity rule — a maximum per category?
