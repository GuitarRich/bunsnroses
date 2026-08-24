# Bun's & Roses — Setlist Vote (v12)

Static page + two serverless functions on Vercel. All votes live in one Google Sheet.

    index.html          the app
    setlist.js          scoring, selection, ordering
    api/votes.js        GET all votes / POST one voter
    api/health.js       setup diagnostics
    api/_sheets.js      Google Sheets helper

## Scoring

Stored votes are still integers 0–3. Weights:

    3 Must play   +6
    2 Yes         +2
    1 Maybe       +1
    0 Pass        −4   (a veto — outweighs two Yes votes)
    blank         0

Each set is built separately (Set 1 = 45 min 70s/80s, Set 2 = 60 min 90s+):
select highest score first until the budget is full, skip negatives, cap at 1
song per artist across both sets (set 1 is built first, so it gets first claim
on a shared artist), then order the chosen songs for pacing. Drag-reorder is
saved in this browser only, not the sheet.

## Sheet tabs (created automatically on first call)

| Tab | What's in it |
|---|---|
| `Votes` | One row per person: Name, UpdatedAt, AppVersion, VoteCount, VotesJSON |
| `AddedSongs` | Songs Rich has added: Key, Title, Artist, Seconds, Set, Energy, Tags, Lead |
| `Grid` | Readable matrix — one row per song, one column per voter. Rewritten on each save. Total is the weighted score. |

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

    npm i -g vercel
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
- Only `OWNER_NAME` can add or remove songs. Enforced server-side in
  `api/votes.js`, not just hidden in the UI.
- Vote values are validated server-side: integers 0–3 only, anything else dropped.
- The **Copy my code** / paste-codes feature still works as an offline backup.
