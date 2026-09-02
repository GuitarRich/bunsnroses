# Bun's & Roses — Setlist Vote (v18)

Two static pages + serverless functions on Vercel. Everything lives in one Google Sheet.

    index.html          voting — one song at a time
    results.html        the setlist, standings, pooling, diagnostics
    catalog.js          the song catalog, band roster, version log
    setlist.js          scoring, selection, ordering, plan parsing
    store.js            shared state and server access for both pages
    app.css             shared styles
    dev-server.js       offline dev stub — no Google credentials needed
    api/votes.js        GET everything / POST one voter
    api/plan.js         GET/POST the setlist and learning status
    api/health.js       setup diagnostics
    api/_sheets.js      Google Sheets helper

## Run it locally

**Offline, no credentials** — the usual way to work on the UI:

    pnpm install
    pnpm dev               # http://localhost:8900

`dev-server.js` serves the pages and fakes the API in memory, seeded with
plausible votes. Any access code is accepted, the owner is `Rich`, and nothing
touches the real sheet. State resets when you stop it.

**Against the real sheet** — when you need to exercise the Sheets code itself:

    pnpm install
    pnpm env               # vercel env pull .env.development.local
    pnpm dev:real          # vercel dev, http://localhost:3000

This reads and writes the live sheet the band is using. `pnpm env` needs
`vercel login` first, and writes credentials to a gitignored file.

    pnpm test              # scoring, selection, ordering, plan parsing

## Scoring

Stored votes are still integers 0–3. Weights:

    3 Must play   +6
    2 Yes         +2
    1 Maybe       +1
    0 Pass        −4   (a veto — outweighs two Yes votes)
    blank         0

One set, sized by song count. Rich sets the number on `results.html` (the
**Songs in the set** stepper) and it is stored in the sheet's `Settings` tab, so
the whole band sees the same target; `TARGET_SONGS` is only the fallback.
Highest score first until the set is full, skipping negatives and capping each
artist at one song, then the chosen songs are ordered for pacing. The old Set 1 / Set 2 field is era metadata now
(70s/80s vs 90s+) and no longer divides the show.

Rich can override the vote from `results.html`. **In** forces a song into the
set past a veto, the artist cap, and the song count; **Out** drops it however
well it scored. Forced songs take a slot, so the set stays at the target size.
Drag-reorder and the in/out state save to the sheet, so the whole band sees the
same set.

Each member marks their own learning status on set songs — Not started, In
progress, Know song — and the row shows one pip per member.

## Sheet tabs (created automatically on first call)

| Tab | What's in it |
|---|---|
| `Votes` | One row per person: Name, UpdatedAt, AppVersion, VoteCount, VotesJSON |
| `AddedSongs` | Songs Rich has added: Key, Title, Artist, Seconds, Set, Energy, Tags, Lead |
| `Grid` | Readable matrix — one row per song, one column per voter. Rewritten on each save. Total is the weighted score. |
| `Tunings` | Key, Title, Artist, Tuning. Edit freely — the sheet wins over the built-in defaults, and a blank cell means "no tuning". |
| `Setlist` | Key, Title, Artist, State, Position. `State` is `in`, `out` or blank; `Position` is the manual running order. Editable by hand. |
| `Progress` | One row per song, one column per band member. Values: `not-started`, `in-progress`, `know-it`. Adding a member is just a new column. |
| `Settings` | `Song limit` — how many songs the set holds. Editable here or from the page; out-of-range values fall back to the default. |

`Votes` is the source of truth. `Grid` is for reading and arguing over — edits there are overwritten.


## Setup

**1. Make the sheet.** New Google Sheet, any name. Copy the id from the URL:
`docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

**2. Service account.** console.cloud.google.com → new project → enable the
**Google Sheets API** → Credentials → Create credentials → Service account.
Then Keys → Add key → JSON. Download it.

**3. Share the sheet** with the service account's email (ends
`.iam.gserviceaccount.com`) as an **Editor**. Skipping this is the most common
cause of a 403 later.

**4. Deploy.**

    pnpm add -g vercel
    vercel

**5. Environment variables** — in the Vercel dashboard, Settings →
Environment Variables. From the downloaded JSON:

| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON, whole thing including BEGIN/END |
| `SHEET_ID` | the id from step 1 |
| `APP_SECRET` | any string — this is the code the band types in |
| `OWNER_NAME` | `Rich` (optional, defaults to Rich) |

Then redeploy: `vercel --prod`

**6. Check it.** Visit `/api/health`. You want `"ok": true` plus the sheet
title and tab names. If not, the `hint` field says what's wrong.

## Notes

- `APP_SECRET` is one shared code for the whole band, entered once and
  remembered in the browser. It stops strangers writing to the sheet; it is not
  real per-person auth.
- Only `OWNER_NAME` can add or remove songs, or change the setlist. Enforced
  server-side in `api/votes.js` and `api/plan.js`, not just hidden in the UI.
  Learning status is writable by anyone with the code, but only into their own
  column.
- Vote values are validated server-side: integers 0–3 only, anything else dropped.
- The **Copy my code** / paste-codes feature still works as an offline backup.
