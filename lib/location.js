import { findStation, stationKey } from "./metro.js";

/* `hood` is one free-text string doing four jobs at once. Across a single
   weekend's listings it appears as all of:

     "Mile End \u00b7 metro Laurier"              neighbourhood + station
     "1450 rue Sainte-Catherine O \u00b7 metro Guy-Concordia"   address + station
     "Mile End \u00b7 5240 av. du Parc"           neighbourhood + address
     "Ahuntsic-Cartierville"                  neighbourhood alone
     "metro Champ-de-Mars"                    station alone
     "Plateau \u00b7 presented by Blue Skies Turn Black"   and a note

   which is why "Mile End" shows up as three different strings and why a
   filter built straight on this field would silently fail to group them.

   This reads the string into parts without touching it. `hood` keeps
   exactly the text it had — the board renders it verbatim and must go on
   doing so — and everything derived lands under an added `loc`. Nothing
   here is destructive, and a record that yields nothing is returned as it
   came in. */

/** Leading "metro"/"métro", in either spelling. */
const METRO_PREFIX = /^m[eé]tro\s+/i;
const IS_METRO = /^m[eé]tro\b/i;
/** A part that starts with a number is a street address, not a district. */
const IS_ADDRESS = /^\d/;
/** "Montmorency then shuttle" -> "Montmorency". */
const QUALIFIER = /\s+(?:then|via|and|or|\+)\b.*$/i;

/**
 * Read one `hood` string into { area, metro, metroKey, line, lines, addr }.
 * Every field is optional; returns null when nothing could be read.
 * `line` is set only for a station on exactly one line — an interchange
 * gets `lines` and no `line`, because tinting it one colour is a lie.
 */
export function parseHood(hood) {
  const parts = String(hood || "").split("·").map((s) => s.trim()).filter(Boolean);
  const loc = {};

  for (const part of parts) {
    if (IS_METRO.test(part)) {
      if (loc.metro) continue;
      const name = part.replace(METRO_PREFIX, "").replace(QUALIFIER, "").trim();
      if (!name) continue;
      loc.metro = name;
      const hit = findStation(name);
      if (hit) {
        loc.metroKey = hit.key;
        loc.lines = hit.lines;
        if (hit.line) loc.line = hit.line;
      } else {
        /* Unknown station: keep the name, claim no colour. */
        loc.metroKey = stationKey(name);
      }
    } else if (IS_ADDRESS.test(part)) {
      if (!loc.addr) loc.addr = part;
    } else if (!loc.area) {
      loc.area = part;
      loc.areaKey = stationKey(part);
    }
    /* Anything after those is a note — "under La Sala Rossa",
       "presented by ..." — and is deliberately dropped. */
  }

  return Object.keys(loc).length ? loc : null;
}

/** Add `loc` to one record, leaving everything it already had alone. */
export function locate(rec) {
  if (!rec || typeof rec !== "object") return rec;
  if (rec.loc) return rec;                 // already structured upstream
  const loc = parseHood(rec.hood);
  return loc ? { ...rec, loc } : rec;
}

/** Add `loc` across one block. Non-arrays pass straight through. */
export function locateAll(list) {
  return Array.isArray(list) ? list.map(locate) : list;
}

/** What coverage a run achieved, for the refresh to report. */
export function coverage(lists) {
  let total = 0, withMetro = 0, withLine = 0, withArea = 0;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      total++;
      const l = r.loc;
      if (!l) continue;
      if (l.metro) withMetro++;
      if (l.line) withLine++;
      if (l.area) withArea++;
    }
  }
  return { total, withArea, withMetro, withLine };
}
