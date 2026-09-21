/* Montreal metro stations by line.

   Verified against Wikipedia's "List of Montreal Metro stations",
   September 2026 — not written from memory. A wrong line colour is worse
   than no colour at all: a missing tint is invisible, while calling
   Laurier green is the kind of thing a Montrealer spots at a glance.
   Anything not listed here returns null and simply gets no colour.

   Keys are ASCII: lowercased, accents stripped, apostrophes dropped,
   everything else collapsed to hyphens (see `stationKey`). That way the
   table never has to agree with the listings about how to spell
   Universite-de-Montreal, and this file stays pure ASCII.

   Interchanges carry every line they serve. The renderer's rule is that
   more than one line means no single-line tint — picking one arbitrarily
   reads as a bug to anyone who uses the station. */

const GREEN = "green", ORANGE = "orange", YELLOW = "yellow", BLUE = "blue";

const STATIONS = {
  // Green
  "angrignon": [GREEN], "monk": [GREEN], "jolicoeur": [GREEN], "verdun": [GREEN],
  "de-leglise": [GREEN], "lasalle": [GREEN], "charlevoix": [GREEN], "atwater": [GREEN],
  "guy-concordia": [GREEN], "peel": [GREEN], "mcgill": [GREEN],
  "place-des-arts": [GREEN], "saint-laurent": [GREEN], "beaudry": [GREEN],
  "papineau": [GREEN], "frontenac": [GREEN], "prefontaine": [GREEN],
  "joliette": [GREEN], "pie-ix": [GREEN], "viau": [GREEN], "assomption": [GREEN],
  "cadillac": [GREEN], "langelier": [GREEN], "radisson": [GREEN],
  "honore-beaugrand": [GREEN],

  // Orange
  "cote-vertu": [ORANGE], "du-college": [ORANGE], "de-la-savane": [ORANGE],
  "namur": [ORANGE], "plamondon": [ORANGE], "cote-sainte-catherine": [ORANGE],
  "villa-maria": [ORANGE], "vendome": [ORANGE], "place-saint-henri": [ORANGE],
  "georges-vanier": [ORANGE], "lucien-lallier": [ORANGE], "bonaventure": [ORANGE],
  "square-victoria-oaci": [ORANGE], "place-darmes": [ORANGE],
  "champ-de-mars": [ORANGE], "sherbrooke": [ORANGE], "mont-royal": [ORANGE],
  "laurier": [ORANGE], "rosemont": [ORANGE], "beaubien": [ORANGE], "jarry": [ORANGE],
  "cremazie": [ORANGE], "sauve": [ORANGE], "henri-bourassa": [ORANGE],
  "cartier": [ORANGE], "de-la-concorde": [ORANGE], "montmorency": [ORANGE],

  // Yellow
  "jean-drapeau": [YELLOW], "longueuil-universite-de-sherbrooke": [YELLOW],

  // Blue
  "cote-des-neiges": [BLUE], "universite-de-montreal": [BLUE],
  "edouard-montpetit": [BLUE], "outremont": [BLUE], "acadie": [BLUE],
  "parc": [BLUE], "de-castelnau": [BLUE], "fabre": [BLUE], "diberville": [BLUE],
  "saint-michel": [BLUE],

  // Interchanges
  "lionel-groulx": [GREEN, ORANGE],
  "berri-uqam": [GREEN, ORANGE, YELLOW],
  "snowdon": [ORANGE, BLUE],
  "jean-talon": [ORANGE, BLUE]
};

/* How the listings write a station versus how this table keys it. */
const ALIASES = {
  "square-victoria": "square-victoria-oaci",
  "lassomption": "assomption",
  "universite-de-montreal-udem": "universite-de-montreal",
  "berri-uqam-berri": "berri-uqam"
};

/** Fold a station name to its ASCII lookup key. */
export function stationKey(name) {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // drop accents
    .toLowerCase()
    .replace(/['‘’]/g, "")                     // drop apostrophes
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Look a station up, tolerating trailing qualifiers the listings add
 * ("Montmorency then shuttle"). Drops trailing words until something
 * matches, so a note after the name cannot hide the station.
 * Returns { key, lines, line } or null when nothing matches.
 */
export function findStation(name) {
  let parts = stationKey(name).split("-").filter(Boolean);
  while (parts.length) {
    const k = parts.join("-");
    const resolved = ALIASES[k] || k;
    const lines = STATIONS[resolved];
    if (lines) {
      return { key: resolved, lines: lines.slice(), line: lines.length === 1 ? lines[0] : null };
    }
    parts = parts.slice(0, -1);
  }
  return null;
}

export const LINES = [GREEN, ORANGE, YELLOW, BLUE];
export const STATION_COUNT = Object.keys(STATIONS).length;
