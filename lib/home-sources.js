/* The Montreal list as it stood in the refresh instructions, the day it
   moved into the store.

   This is only a seed. While sources/montreal has never been written,
   reads see this list; the first write stores it, merged with whatever
   that write brought, and from then on the stored document is the list.
   Editing this file after that changes nothing: add, pin or drop a
   Montreal source with POST /api/trip {op:"sources", place:"home", ...}.

   Every entry is pinned, so none is dropped or flagged dead however often
   it misses. `required` marks the ones an update run (Tuesday to Sunday)
   must fetch. Out-of-town sources cover "afield". The order is the rank
   among equals, so the first eight are the footer until uses say otherwise. */

const SEEDED_AT = Date.parse("2026-10-26T00:00:00.000Z");

const LIST = [
  { url: "https://cultmtl.com/events/", name: "Cult MTL", kind: "listings", required: true,
    note: "Best single source for dated listings." },
  { url: "https://www.lavitrine.com/en", name: "La Vitrine", kind: "listings", required: true,
    note: "Cross-check for dated listings." },
  { url: "https://www.evenko.ca/en/events", name: "Evenko", kind: "ticketing", covers: ["music"], required: true,
    note: "Concerts." },
  { url: "https://www.mtl.org/en/experience/things-to-do-september", name: "Tourisme Montréal", kind: "official",
    covers: ["festival"], note: "Festivals. Swap the month in the url for the current one." },
  { url: "https://www.quartierdesspectacles.com/en/festivals-and-events", name: "Quartier des Spectacles",
    kind: "official", covers: ["festival", "outdoor"], required: true, note: "Festivals and outdoor events." },
  { url: "https://www.oldportofmontreal.com/events", name: "Old Port", kind: "official", note: "Old Port events." },
  { url: "https://www.timeout.com/montreal", name: "Time Out", kind: "press", note: "Cross-check." },
  { url: "https://www.lamppostsocial.com/events/city/montreal", name: "LampPost Social", kind: "community",
    required: true, note: "Comedy nights, local gigs, pop-ups. Also /live-music/city/montreal." },
  { url: "https://www.placedesarts.com/en", name: "Place des Arts", kind: "venue",
    covers: ["theatre", "dance", "classical"], required: true, note: "Theatre, dance, classical." },
  { url: "https://cinemamoderne.com/en", name: "Cinéma Moderne", kind: "venue", covers: ["film"], required: true,
    note: "Repertory showtimes." },
  { url: "https://www.cinemaclock.com/movie-theaters/cinema-du-parc", name: "Cinéma du Parc (Cinemaclock)",
    kind: "listings", covers: ["film"], required: true,
    note: "Cinéma du Parc showtimes. The venue's own site blocks fetching, so read them here." },
  { url: "https://www.cinematheque.qc.ca/en/program", name: "Cinémathèque québécoise", kind: "venue",
    covers: ["film"], required: true, note: "Programme with dated screenings." },
  { url: "https://fnc.ca/en", name: "Festival du nouveau cinéma", kind: "official", covers: ["film", "festival"],
    note: "October. The programme lists every screening with date, time and venue; read RIDM, Fantasia, Image+Nation and FIFA the same way." },
  { url: "https://sat.qc.ca/en", name: "SAT", kind: "venue", note: "Satosphere and rooftop events." },
  { url: "https://www.centaurtheatre.com", name: "Centaur Theatre", kind: "venue", covers: ["theatre"],
    note: "English-language theatre. The site renders poorly: search for the current production instead." },
  { url: "https://www.segalcentre.org", name: "Segal Centre", kind: "venue", covers: ["theatre"],
    note: "English-language theatre. The site renders poorly: search for the current production instead." },
  { url: "https://www.musee-mccord-stewart.ca/en", name: "McCord Stewart Museum", kind: "venue",
    covers: ["exhibition"], note: "Exhibitions." },
  { url: "https://www.mbam.qc.ca/en", name: "Montreal Museum of Fine Arts", kind: "venue",
    covers: ["exhibition"], note: "Exhibitions." },
  { url: "https://espacepourlavie.ca", name: "Space for Life", kind: "venue",
    note: "Botanical Garden, Biodôme, Insectarium, Planétarium." },
  { url: "https://casadelpopolo.com/en", name: "Casa del Popolo", kind: "venue", covers: ["music"], required: true,
    note: "Small room." },
  { url: "https://www.barleritzpdb.com", name: "Bar Le Ritz PDB", kind: "venue", covers: ["music"], required: true,
    note: "Small room." },
  { url: "https://www.theatrerialto.ca", name: "Théâtre Rialto", kind: "venue", required: true, note: "Small room." },
  { url: "https://www.marchespublics-mtl.com/en/events", name: "Montreal public markets", kind: "official",
    covers: ["food", "market"], note: "Market events." },
  /* out of town */
  { url: "https://www.sepaq.com", name: "Sépaq", kind: "official", covers: ["afield"], note: "Provincial parks." },
  { url: "https://www.quebecvacances.com/en/events", name: "Québec Getaways", kind: "listings", covers: ["afield"],
    note: "Events across Quebec." },
  { url: "https://www.easterntownships.org", name: "Eastern Townships", kind: "official", covers: ["afield"],
    note: "Regional tourism." },
  { url: "https://www.bonjourquebec.com", name: "Bonjour Québec", kind: "official", covers: ["afield"],
    note: "Provincial tourism." },
  { url: "https://www.laurentides.com/en/events", name: "Laurentides", kind: "official", covers: ["afield"],
    note: "Laurentians events." },
  { url: "https://www.upa.qc.ca", name: "UPA", kind: "official", covers: ["afield", "food"], note: "Farm open days." },
  { url: "https://exo.quebec", name: "exo", kind: "official", covers: ["afield"],
    note: "Commuter trains and buses, for car-free day trips." }
];

/** The seed, as stored sources: pinned, never used, in list order. */
export function homeSeed() {
  return LIST.map((s, i) => ({ covers: [], ...s, pinned: true, addedAt: new Date(SEEDED_AT + i * 1000).toISOString() }));
}
