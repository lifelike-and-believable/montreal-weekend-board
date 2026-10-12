/* Which places are the same place.

   A place's ledger (lib/sources.js) is keyed by a slug made from its name,
   region and country, so "NYC", "New York" and "Brooklyn, NY" would each
   start a ledger of their own and a return trip would find none of it.
   Places the owner goes back to are folded together here: a small table of
   well-known ones, and (stored, see lib/sources.js) aliases the routine
   adds for the rest. Pure; no I/O. */

const ascii = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** "N.Y.C.", "New  York" -> "nyc", "new york": lowercase, ascii, letters
    and digits with single spaces. */
export function placeKey(s) {
  return ascii(s).replace(/[.'’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const US = ["us", "usa", "united states", "united states of america"];
const CA = ["canada", "ca"];

/* name/region/country/slug are what the ledger is filed under (the slug is
   fixed here, so editing the table never moves a ledger); aliases are other
   names for the whole place; regions are what a region can be written as. */
export const KNOWN_PLACES = [
  { name: "New York", slug: "new-york-ny", region: "NY", country: "USA", countries: US, regions: ["ny", "new york"],
    aliases: ["nyc", "new york city", "new york", "new york ny", "manhattan", "brooklyn", "queens",
      "the bronx", "bronx", "staten island", "ny city"] },
  { name: "Washington", slug: "washington-dc", region: "DC", country: "USA", countries: US, regions: ["dc", "district of columbia"],
    aliases: ["washington dc", "washington d c", "dc", "washington district of columbia"] },
  { name: "Boston", slug: "boston-ma", region: "MA", country: "USA", countries: US, regions: ["ma", "massachusetts"],
    aliases: ["boston", "boston ma", "cambridge ma"] },
  { name: "Philadelphia", slug: "philadelphia-pa", region: "PA", country: "USA", countries: US, regions: ["pa", "pennsylvania"],
    aliases: ["philadelphia", "philly"] },
  { name: "Los Angeles", slug: "los-angeles-ca", region: "CA", country: "USA", countries: US, regions: ["ca", "california"],
    aliases: ["los angeles", "la", "l a"] },
  { name: "San Francisco", slug: "san-francisco-ca", region: "CA", country: "USA", countries: US, regions: ["ca", "california"],
    aliases: ["san francisco", "sf", "san fran"] },
  { name: "Toronto", slug: "toronto-on", region: "ON", country: "Canada", countries: CA, regions: ["on", "ontario"],
    aliases: ["toronto", "the 6ix"] },
  { name: "Ottawa", slug: "ottawa-on", region: "ON", country: "Canada", countries: CA, regions: ["on", "ontario"],
    aliases: ["ottawa"] },
  { name: "Vancouver", slug: "vancouver-bc", region: "BC", country: "Canada", countries: CA, regions: ["bc", "british columbia"],
    aliases: ["vancouver"] }
];

const INDEX = new Map();
for (const k of KNOWN_PLACES) for (const a of k.aliases) INDEX.set(placeKey(a), k);

/**
 * The well-known place this is, as { name, region, country, slug }, or null.
 * A region or country that is given and disagrees rules it out: Boston,
 * Lincolnshire is not Boston, MA.
 */
export function canonicalPlace(p) {
  if (!p || typeof p !== "object") return null;
  /* "Washington" + "DC" is "washington dc", which a bare "washington" is not */
  const k = INDEX.get(placeKey(p.name)) || INDEX.get(placeKey(`${p.name || ""} ${p.region || ""}`));
  if (!k) return null;
  const region = placeKey(p.region), country = placeKey(p.country);
  if (region && !k.regions.includes(region)) return null;
  if (country && !k.countries.includes(country)) return null;
  return { name: k.name, region: k.region, country: k.country, slug: k.slug };
}
