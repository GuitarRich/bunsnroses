/** Song catalog, band roster, and version log. Shared by both pages. */
import { songKey } from "./setlist.js";

/* name, artist, seconds, year, bpm, era(1=70s/80s 2=90s+), energy, tags, lead */
export const TRACKS=[
["I Wanna Be Your Dog","The Stooges",189,1969,121,1,4,"opener",""],
["Green River","Creedence Clearwater Revival",154,1969,142,1,4,"",""],
["Born On The Bayou","Creedence Clearwater Revival",315,1969,117,1,3,"",""],
["Fortunate Son","Creedence Clearwater Revival",141,1969,133,1,4,"",""],
["Mississippi Queen","Mountain",151,1970,140,1,4,"",""],
["Run Through The Jungle","Creedence Clearwater Revival",185,1970,137,1,4,"",""],
["War Pigs","Black Sabbath",474,1970,91,1,2,"slow",""],
["Bang a Gong (Get It On)","T. Rex",262,1971,127,1,4,"",""],
["Baba O'Riley","The Who",300,1971,117,1,5,"opener",""],
["Back In the Saddle","Aerosmith",280,1976,122,1,4,"",""],
["Rock And Roll All Nite","KISS",168,1975,144,1,5,"closer",""],
["Beat on the Brat","Ramones",152,1976,157,1,4,"",""],
["Blitzkrieg Bop","Ramones",133,1976,177,1,5,"opener",""],
["Liar","Sex Pistols",162,1977,150,1,4,"",""],
["Pretty Vacant","Sex Pistols",198,1977,145,1,4,"",""],
["Holidays in the Sun","Sex Pistols",203,1977,148,1,4,"",""],
["Let There Be Rock","AC/DC",367,1977,182,1,5,"closer",""],
["Riff Raff","AC/DC",313,1978,185,1,5,"opener",""],
["Fat Bottomed Girls","Queen",256,1978,88,1,3,"",""],
["Rock 'n' Roll","Motorhead",228,1987,124,1,4,"",""],
["Delivering the Goods","Judas Priest",258,1979,158,1,4,"",""],
["Stay Clean","Motorhead",160,1979,145,1,4,"",""],
["See Me Burning","Motorhead",180,1979,161,1,4,"",""],
["Jamie's Cryin'","Van Halen",210,1978,128,1,3,"",""],
["Dance the Night Away","Van Halen",188,1979,129,1,3,"",""],
["China Girl","David Bowie",257,1983,134,1,3,"",""],
["Sharp Dressed Man","ZZ Top",258,1983,125,1,4,"",""],
["For Whom The Bell Tolls","Metallica",310,1984,117,1,4,"",""],
["Kiss","Prince",226,1986,111,1,3,"",""],
["School","Nirvana",162,1989,164,2,5,"opener",""],
["We Die Young","Alice In Chains",152,1990,125,2,4,"",""],
["Rusty Cage","Soundgarden",266,1991,101,2,4,"",""],
["Slaves & Bulldozers","Soundgarden",416,1991,130,2,3,"",""],
["Territorial Pissings","Nirvana",143,1991,182,2,5,"",""],
["Sad But True","Metallica",325,1991,89,2,3,"",""],
["Dam That River","Alice In Chains",189,1992,124,2,4,"",""],
["Them Bones","Alice In Chains",149,1992,165,2,5,"",""],
["Would?","Alice In Chains",207,1992,100,2,2,"slow",""],
["Wicked Garden","Stone Temple Pilots",245,1992,153,2,4,"",""],
["Piece of Pie","Stone Temple Pilots",324,1992,146,2,4,"",""],
["Creep","Stone Temple Pilots",334,1992,107,2,2,"ballad,slow",""],
["Frances Farmer Will Have Her Revenge On Seattle","Nirvana",250,1993,117,2,3,"",""],
["Dissident","Pearl Jam",215,1993,146,2,4,"",""],
["Sabotage","Beastie Boys",178,1994,168,2,5,"opener",""],
["Machinehead","Bush",256,1994,171,2,5,"",""],
["Superunknown","Soundgarden",307,1994,133,2,3,"",""],
["Let Me Drown","Soundgarden",233,1994,187,2,4,"",""],
["Spin the Black Circle","Pearl Jam",168,1994,217,2,5,"",""],
["Hey Man, Nice Shot","Filter",314,1995,177,2,4,"",""],
["Where Boys Fear To Tread","The Smashing Pumpkins",264,1995,113,2,3,"",""],
["Bound For The Floor","Local H",223,1996,119,2,4,"",""],
["Trippin' on a Hole in a Paper Heart","Stone Temple Pilots",176,1996,106,2,4,"",""],
["Freak","Silverchair",226,1997,118,2,3,"",""],
["Testify","Rage Against The Machine",210,1999,117,2,5,"",""],
["Sleep Now In the Fire","Rage Against The Machine",206,1999,127,2,5,"closer",""],
["The Everlasting Gaze","The Smashing Pumpkins",241,2000,146,2,4,"",""],
["Bleed American","Jimmy Eat World",181,2001,160,2,4,"",""],
["Gasoline","Audioslave",279,2002,92,2,3,"",""],
["Cochise","Audioslave",222,2002,80,2,5,"opener",""],
["Medication","Queens of the Stone Age",114,2002,165,2,4,"",""],
["Slither","Velvet Revolver",248,2004,141,2,4,"",""],
["Little Sister","Queens of the Stone Age",174,2005,161,2,4,"",""],
["Make It Wit Chu","Queens of the Stone Age",290,2007,91,2,2,"slow",""]
];

export const BAND = ["Rich", "Joel", "Anders", "Pete"];
export const OWNER = "Rich";            // only this person edits songs and the setlist
export const VERSION = "v17";
export const LABEL = { 3: "Must play", 2: "Yes", 1: "Maybe", 0: "Pass" };
export const NB = TRACKS.length;        // built-in count (code positions never change)

export const CHANGES = {
 "v17":"One set of 17 — standings moved to /results.html, with manual in/out, running order, and per-member learning status",
 "v16":"Guitar tunings on every song — edit them in the sheet's Tunings tab",
 "v15":"Riff Raff tagged as opener — generator now locks it at set 1, track 1",
 "v14":"Ranking — full pool now collapses so both setlists fit on screen",
 "v13":"At most 1 song from any one artist across both sets — set 1 gets first claim",
 "v12":"Pass is a veto (−4). Weighted scores, generated running order, max 2 per artist still applies",
 "v11":"Each setlist takes at most 2 songs from any one artist, votes or not",
 "v10":"Hosted on Vercel with a Google Sheet backend — votes sync for everyone",
 "v9":"Pool stored inside your own record; timestamps settle conflicts; storage check panel",
 "v8":"Imports save every voter, not just yours",
 "v7":"Only Rich can add songs",
 "v6":"CSV import",
 "v5":"Add songs to the list",
 "v4":"Read before write; verified saves",
 "v3":"Per-member votes in Standings; codes",
 "v2":"Skip and go back; edit votes from Standings",
 "v1":"First version"
};

export const keyOf = songKey;

function meta(t) {
  return { energy: t[6] || 0, tags: t[7] || "", lead: t[8] || "" };
}

/** Built-ins keep their positional keys b0..bN so old vote codes still line up. */
export function buildSongs(custom) {
  const out = TRACKS.map((t, i) => ({
    k: "b" + i, name: t[0], artist: t[1], dur: t[2], year: t[3], bpm: t[4], set: t[5], ...meta(t),
  }));
  (custom || [])
    .slice()
    .sort((a, b) => (a.k < b.k ? -1 : 1))
    .forEach((c) => out.push({ ...c, added: true }));
  return out;
}
