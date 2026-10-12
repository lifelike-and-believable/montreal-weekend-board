# Daily refresh task: instructions

These are the instructions for the Claude scheduled task "Daily Refresh" that refreshes the board each day. It is a scheduled task, not a routine, and it has "Requires this computer" unchecked, so it runs in the cloud and does not need the owner's machine to be on. This file is the source: when the instructions change, edit them here and paste the new text into the scheduled task's instructions (under Scheduled tasks, not at claude.ai/code/routines), so a change is reviewed with the code it depends on. The task's stored copy is what runs, so the two can drift until someone pastes.

The routine reads the app's `/api/data`, `/api/db`, `/api/trip` and `/api/refresh` endpoints (`api/data.js`, `api/db.js`, `api/trip.js`, `api/refresh.js`) and holds the Google Calendar connector. The separate "Weekend Board: refresh calendar" routine (a routine, unlike this task), started by the board's "check again", is in [routine-calendar-prompt.md](routine-calendar-prompt.md).

The app token in the stored copy is the value of `REFRESH_SECRET`, which this task's calls are limited to: `/api/data`, `/api/refresh`, `/api/trip`, the taste profile, and `spotted/` documents through `/api/db` (see `lib/scope.js`). It is deliberately not written in this file; the line that carries it below is a placeholder. Never commit the real value.

Paste everything under the line into the scheduled task.

---

Refresh the Montreal Weekend Board with current listings, and check the posters the owner has photographed. Work autonomously — nobody is watching, so make reasonable calls and do not ask questions.

THE TARGET is the hosted web app, which is what the owner uses (it is installed on their phone's home screen). The old Claude artifact version of the board has been retired: do not read, edit, republish or write to it or its database in any way.

APP URL: https://montreal-weekend-board-lifelikedevteam.vercel.app
APP TOKEN (used as `Authorization: Bearer <token>` on every app call below): <the REFRESH_SECRET value; kept in the task, not in this repository>

The app's store is reached through one endpoint, POST /api/db with that token and a JSON body {"op", "path", "data"?}. The ops are "get" (one document: {"id","data"}, data null if absent), "list" (a collection: {"docs":[{"id","data"}]}), "set" (REPLACES the whole document with `data` — there is no merge and no version check, so always get the current document first, change only the fields you mean to, and send the complete object back) and "delete".
The board's current listings are served by GET /api/data (same token). The body is JavaScript: parse the JSON after `window.__BOARD_DATA__=` (it holds WEEKEND, STANDING, EVENTS, AFIELD, BUSY).

WORKING EFFICIENTLY. This runs every day, so keep it lean without cutting quality:
- Do app and calendar calls with curl in Bash and save responses to files; look at them with jq or a short script rather than printing whole payloads into the conversation.
- When you fetch a listings page, ask WebFetch for exactly what you need ("every event dated 2–4 October 2026 with date, start time, venue, price, language, sold-out status, and whether it is a last or only performance"), not a summary of the whole page.
- You may split research across up to four helper agents, one per group of sources (for example: film; theatre, dance and classical; music; festivals, markets, exhibitions and out of town). Give each one its fixed sources, the exact dates still to cover, the "never invent a time; drop what you cannot confirm" rule, the allowed `cat` values and the field lists from Step 5, and the note rule (one specific sentence per entry that says what the thing is and anything that matters for going: language and subtitles, last or only performance, sold out, booking needed, transit). The out-of-town helper also gets the day-trip checks from Step 5 in full. Have each return ONLY a compact JSON array in those exact fields, with no prose, so you merge rather than rewrite.
- Build the payload in a JSON file with a script and POST it from that file. Never retype the listings in the conversation.

STEP 0 — Decide the mode.
Check today's date (`date`). Fetch the current board with GET /api/data and save it to a file. The days to show come from the plan in Step 2B (the weekend, plus any day the owner has off), so settle the mode below once you have it.
- FULL run: the board shows a different weekend (a different WEEKEND.id), a different place, is empty, or the fetch failed. In normal running this is the Monday run, when the weekend rolls forward. Research the whole weekend from scratch.
- UPDATE run (Tuesday through Sunday): the board already shows the right weekend. The listings on it are your starting point (Step 4, update mode).
Also work out the days still ahead: the plan's `days` whose date is today or later. Friday evening is still ahead all through Friday. (Before Friday that is all three weekend days plus any days off; on Saturday, Saturday and Sunday; on Sunday, only Sunday.) Days already past are never researched, re-checked or edited again: carry their entries through to the payload exactly as they are on the board, so the app can show them as over.
Say which mode you ran and which days you covered in the report.

WHAT THE OWNER'S HISTORY IS AND IS NOT FOR.
The app records every entry the owner ADDS to a plan and every entry they STAR (a star means "I like this", whether or not they can go), in its document "taste/profile". That history shapes ONLY which three entries you star as highlights. It must NEVER narrow, filter, rank or thin the listings themselves: a singular event they'd never have looked for is exactly what the board exists to surface, and completeness beats personalization everywhere below the highlights panel.
Entries the owner HID are not recorded and are not a signal. A hide usually means a film already seen or a night they're busy, never a dislike. Do not read the "plans" documents, do not infer anything from a hide, and never drop or demote a listing because it resembles something previously hidden.

DATABASE WRITES. You may write ONLY to documents under "spotted/" (Step 3), plus the /api/refresh POST in Step 6. Never write to "taste" or "plans".

STEP 1 — Read the add-and-star history from the app.

    POST https://montreal-weekend-board-lifelikedevteam.vercel.app/api/db
    Authorization: Bearer <APP TOKEN>
    Content-Type: application/json
    {"op":"get","path":"taste/profile"}

If `data` is null there is no history — star on merit alone. Otherwise you get totalAdds, totalStars, categories, venues, afieldAdds, freeAdds, ticketedAdds, and `recent` (the last 60 entries with title, cat, venue, sub, weekend, and `via`: "add" or "star"; an added entry may also carry `starred: true`). Read `recent`, not just the counters — titles say more than categories. Treat a star as a signal of taste as strong as an add: the owner stars things they liked but may not have been able to attend. If this call fails, say so in the report and choose highlights on merit alone.

STEP 2 — Read the owner's own calendar for the weekend, and work out when they are out of town.
Using the Google Calendar connector, list the events on the owner's primary calendar that overlap the window from 00:00 today to 24:00 on the Sunday of the weekend (Step 4), America/Toronto time. That window is wider than the weekend on purpose: Step 2B needs it to find days off. Expand recurring events into their instances. Leave out events the owner has declined and cancelled events. Keep everything else, including all-day events (trips are usually all-day), and including events the owner put there from the board itself — the app recognises those.
For each event keep only: `id` (the calendar event id), `title` (its summary; "Busy" if it has none), `start`, `end`, `location` if it has one, `timeZone`: the event's own time zone as an IANA name ("America/Vancouver"), taken from the event's start time zone, if it has one, `free: true` if the event is marked "free" rather than "busy" in Google Calendar (its transparency is "transparent" / availability "free"; leave the field out otherwise), `eventType` (Google's own: "outOfOffice", "workingLocation", "focusTime" or "default"; leave it out for default), `dayOff: true` if the event is a day off whatever its title (an out-of-office entry, or one the owner has plainly flagged as time off), and `hood` as described below. `start`/`end` are the event's dateTime values as ISO strings WITH their offset, or, for an all-day event, the bare `YYYY-MM-DD` dates exactly as Google gives them (the end date is exclusive; do not adjust it). Do not include descriptions, attendees or anything else. This list is the `BUSY` block in Step 6 (the app cuts it to the plan's days itself).
`free` is how the app tells an occasion from taken time: an anniversary, a birthday or a holiday marked free shows on the board as something to plan around and never as a clash. Send free events in BUSY with the flag; do not drop them. Being marked free does not decide travel: an all-day trip entry is often left as free by default, so still read free events when judging the AWAY stretches below.
`hood`: only when the event's location is in Montreal and you are sure where it is, write its neighbourhood and nearest métro station in exactly the format the listings' own `hood` uses: the neighbourhood, then " · métro ", then the station's official name with its accents and hyphens ("Mile End · métro Laurier", "Little Burgundy · métro Lionel-Groulx", "Old Montreal · métro Place-d'Armes"). Use the location text (address or venue) to place it; look the venue or address up if you need to. Leave `hood` out for anywhere outside Montreal, for online or phone meetings, for an event with no location, and whenever you are unsure. Never guess a station.
Then judge the stretches when the owner is away from the Montreal area and so cannot get to anything in Montreal. The signs: flights, trips, hotel stays, performances or meetings located in another city, all-day entries naming another place. Read titles and locations, not just times. A trip starts when the owner leaves Montreal (a flight's departure from YUL, or the start of the trip) and ends only when they are back in Montreal (a flight landing at YUL, or the trip's end). A flight between two other cities (Kelowna → Vancouver) is not a return. If the calendar shows no return to Montreal before the weekend ends, the stretch runs to 24:00 on the weekend's last day. Send each stretch as {"start", "end", "where"}: `start`/`end` as ISO datetimes with offset, or bare dates (end exclusive) for whole days; `where` a short place name ("Revelstoke"). If a trip starts before the weekend, give its real start. Merge one trip's legs into one stretch. Be conservative: an event in a Montreal suburb, a local appointment, or a vague title is not a trip. If nothing suggests travel, the list is empty. This list is the `AWAY` block in Step 6.
If the calendar cannot be read, OMIT both `BUSY` and `AWAY` from the POST entirely (do not send empty arrays — an empty array tells the app the weekend is free, while omitting them keeps what the last run found) and say so in the report. Never put calendar events into STANDING, EVENTS or AFIELD.

STEP 2B — Plan the days and the place.
Send the events and the away stretches from Step 2 to the app, which decides which days to plan and where the owner is:

    POST https://montreal-weekend-board-lifelikedevteam.vercel.app/api/trip
    Authorization: Bearer <APP TOKEN>
    Content-Type: application/json
    {"op":"plan","events":[...],"away":[...]}

`events` are the Step 2 events as read, `away` the stretches you judged. If a day off is not being picked up, or the place is wrong, correct it with `away` (a stretch with `where` is trusted) rather than guessing in the listings. The response has `days` (each {key, date, name, num, kind}: "weekend" for Friday evening, Saturday and Sunday, "dayoff" for a Monday to Friday the owner has off; the Friday of a normal weekend also carries `evening:true`), `label`, `weekend` (the WEEKEND block to use in Step 6), `place` (absent means home, Montreal), `placeSource`, and `sources` (good listing sources for that place, best first, for travel mode).
Save the response to a file and use it for everything below. If the call fails, fall back to the usual weekend (Friday evening, Saturday and Sunday) in Montreal with no days off, and say so in the report. Do not work out days off or the place yourself.
A day off is planned exactly like a weekend day, but for the whole day: its events carry `day` values like "mon" to "fri" and are not limited to the evening.

STEP 3 — Check the posters the owner photographed.
List them with {"op":"list","path":"spotted"}. Each doc's `data` is an event the owner captured by photographing a poster: id, title, sub, cat, startDate, endDate, time, venue, hood, url, price, free, note, photoId, needsRead, status ("new" | "verified" | "rejected"), star, verifiedNote, capturedAt, editedAt. The app reads the poster itself at capture time, so you do not read photos. The app renders these records on the weekend they fall in — do NOT copy them into EVENTS, STANDING or AFIELD, or they will appear twice.

Leave alone any record with `needsRead: true` or no startDate: those are waiting for the owner to fill in, not for you.

**3a — Verify.** For anything with status "new" whose date range touches the next five weeks — nearest dates first, about eight records per run so the refresh stays quick — search for the event by title and venue and check the venue's own site. Then get the record ({"op":"get","path":"spotted/<id>"}), change only the fields below, and write the whole record back with "set":
   - Correct any field the poster got wrong or the owner mistyped — especially `time`, `startDate`/`endDate`, and `venue`. Fill `hood` in the listings' format only where you are sure of it.
   - Add `url` if you find an official event or ticket page and the record has none or only a bare home page. A real ticket link is the single most useful thing you can add.
   - Fill `price` / `free` if the poster didn't say and the site does.
   - Set `status` to "verified" and `verifiedNote` to one short sentence naming what you checked and anything that changed ("Confirmed on the Casa del Popolo calendar; doors 20:30, not 20:00").
   - If the event is cancelled or postponed, or you find solid evidence it is not happening, set `status` to "rejected" with the reason in `verifiedNote`; the board then stops showing it. Real evidence only, never a mere failure to find anything.
   - If you cannot confirm it either way, leave `status` as "new" and set `verifiedNote` to what you tried, starting with the date you checked ("Checked 28 Sep: no listing found; the poster is the only source"). The board shows it with a "not checked yet" marker, which is the honest state.
   - Never change `id`, `photoId`, `capturedAt`, `source` or `spotted`, and keep `cat` to the allowed values in Step 5.
Skip a "new" record whose `verifiedNote` records an unsuccessful check within the last two days and whose `editedAt` is older than that check, so the same dead end is not re-searched every morning.
A record whose whole date range is already over needs no checking; the refresh prunes old records itself, so do not delete them.

**3b — Stars.** A captured event may earn a highlight slot (see Step 5): set its `star` field to the same two-sentences-maximum text, and clear (`star: null`) any `star` from a previous run that is no longer one of this weekend's three. Same get-then-set rule.

STEP 4 — Research the days in the plan.
The board covers FRIDAY EVENING, SATURDAY and SUNDAY of the upcoming weekend, plus every day off in the plan from Step 2B. From Friday through Sunday, keep showing the weekend in progress — do not roll forward until Monday. When the weekend rolls over, that is a new WEEKEND.id and a fresh set of events. Friday entries carry `day:"fri"` and should be evening only when the plan's Friday has `evening:true` (a Friday that is a day off has no such flag and is researched all day), roughly 5 p.m. onward: curtain times, gigs, openings, late museum hours, Friday-night markets.

TRAVEL MODE. If the plan has a `place`, the board is for somewhere other than Montreal, on the days the owner is there. Research that place instead of Montreal: start with the plan's `sources` (fetch the best first and see what each lists for the days in the plan), then search for more (the place's tourism board, city and local-paper event listings, venue and ticketing pages) and keep the ones that list real, dated events. Everything below that names Montreal sources, Montreal neighbourhoods or métro stations, anglophone-friendliness, Quebec day trips and the Quebec out-of-town sources does not apply: `hood` is the neighbourhood only, with no métro, and AFIELD is day trips from that place. The "never invent a time; drop what you cannot confirm" rule still applies in full. Keep track of which source urls gave you listings you used (`used`), which failed or were empty (`dead`), and the new good sources you found, for Step 6.
At home (no `place`), ignore this paragraph and the sources in the plan response.

The sources (the project doc `montreal-cultural-resources.md` has the full list — read it with the Projects tool on a full run):
- cultmtl.com/events/ — best single source for dated listings
- evenko.ca/en/events — concerts
- placedesarts.com/en — theatre, dance, classical
- cinemamoderne.com/en — repertory showtimes
- cinemaclock.com/movie-theaters/cinema-du-parc — Cinéma du Parc showtimes (the venue's own site blocks fetching)
- cinematheque.qc.ca/en/program — Cinémathèque québécoise
- fnc.ca/en — Festival du nouveau cinéma (October); the programme lists every screening with its date, time and venue. Use the same approach for other film festivals that fall on a weekend (RIDM, Fantasia, Image+Nation, FIFA)
- sat.qc.ca/en — Satosphere and rooftop events
- centaurtheatre.com and segalcentre.org — English-language theatre (their sites render poorly; search for the current production instead)
- musee-mccord-stewart.ca/en and mbam.qc.ca/en — exhibitions
- espacepourlavie.ca — Botanical Garden, Biodôme, Insectarium, Planétarium
- casadelpopolo.com/en, barleritzpdb.com, theatrerialto.ca — small rooms
- mtl.org/en/experience/things-to-do-september (swap the month) and quartierdesspectacles.com/en/festivals-and-events — festivals
- oldportofmontreal.com/events and marchespublics-mtl.com/en/events — Old Port and the public markets
- lavitrine.com/en and timeout.com/montreal — cross-checks
For the out-of-town section: sepaq.com, quebecvacances.com/en/events, easterntownships.org, bonjourquebec.com, laurentides.com/en/events, upa.qc.ca (farm open days), exo.quebec and Navette Nature for car-free trips, and tourism sites for the Laurentians, Montérégie, Eastern Townships, Lanaudière and Quebec City.

**Full mode (Monday).** Use WebSearch and WebFetch across all of the sources above. The owner is anglophone and wants a wide net: theatre, film, music, dance, exhibitions, festivals, outdoor events, food and markets.

**Update mode (Tuesday to Sunday).** Start from the STANDING, EVENTS and AFIELD already on the board, and work only on the days still ahead (Step 0). Every one of these checks is required, not optional:
1. Fetch each of these for the days still ahead: cinemamoderne.com, cinemaclock.com (Cinéma du Parc), cinematheque.qc.ca, cultmtl.com/events, evenko.ca, placedesarts.com, quartierdesspectacles.com, lavitrine.com, casadelpopolo.com, barleritzpdb.com and theatrerialto.ca, plus the programme page of every festival on the board (see Festivals below). cultmtl.com/events is the best single source for dated listings, so fetch it yourself first and hand its entries to the helpers; never leave it to a helper alone or skip it. If a fetch fails, try once more, then record it as failed.
2. Match what each source lists against the board. Refresh every film entry's showtimes (the cinemas publish weekend times late in the week). Fill in any entry still showing `times: []` if a time is now published. Mark sold-out shows in `note` or `price`. Drop anything cancelled or postponed, on real evidence only.
3. Add anything new that a source lists for the days still ahead.
4. On Thursday or Friday, also re-check the AFIELD trips and any STANDING item whose hours depend on weather or season, since those are what change close to the date. On any day, if the AFIELD block fails the day-trip checks in Step 5, research and replace trips until it passes.
5. Correct any entry on the board whose `cat` is not one of the allowed values in Step 5, and write a note for any entry that has none.
Stable entries (exhibition runs, museum hours, long-running festivals) need no re-verification on other days unless a source suggests they changed. Keep entries' existing wording and titles unless the facts changed, since the owner's plan picks and hides are tied to title and time. Never thin the board to save effort, and never drop an entry because it is on a day already past.

**Festivals.** Any festival you find running over the weekend, film or otherwise, becomes a source for that weekend, however you came across it: a search result, a listings site, one of the sources above. Give it a STANDING entry whose `url` is the festival's own programme page (not a news story or an aggregator), so every later run that weekend knows where to look. Then go to that programme for its dated events and list them as timed EVENTS with `sub` set to the festival's name, the date, start time and venue from the programme, and the festival's page for that event as `url`. For a film festival, list about 10–15 screenings across the weekend: favour films in English or with English subtitles and say which in the note, spread them across the days and venues, and include premieres, screenings with a guest Q&A, and opening or closing films. For a music, dance, theatre or other festival with dated shows, list its notable shows the same way. Festival events count on top of the 40–65 target. If a festival's programme is not published yet, say so in the report. In update mode, fetch the programme page of every festival STANDING entry on the board for the days still ahead, add newly published events and correct times. Only festivals that overlap the weekend matter: ignore ones that have already ended or have not begun.

In both modes: verify dates and times against a real page before listing something. If you cannot find a published start time, set `times: []` and add a `bandHint` ("morning" / "afternoon" / "evening" / "late") plus a note telling the reader where to check — never invent a time. Drop anything you cannot confirm.

The owner's calendar (Step 2) never removes or thins listings either: a busy Saturday afternoon, or a whole weekend away, is for the app to flag, not for you to empty.

STEP 5 — Assemble the four data blocks.
Build these as JSON.

**`cat` must be exactly one of these seven values, in every block: `theatre` (plays, comedy, opera, talks and readings), `film`, `music`, `dance`, `museum` (exhibitions, galleries, museum workshops), `fest` (festivals, outdoors, walks, sport, fairs, anything else), `market` (food, drink and markets).** The app silently hides any entry with any other value ("expo", "food", "outdoor", "talk" and so on), so check every entry before you POST.

- `WEEKEND` — the `weekend` object from the plan in Step 2B, unchanged (id, label, `days` with a `kind` of "weekend" or "dayoff" on each, and `place` in travel mode), plus `updated` (current ISO timestamp with the -04:00 or -05:00 offset). Do not rebuild it by hand. A day is `{key:"mon"|"tue"|"wed"|"thu"|"fri"|"sat"|"sun", date, name, num, kind}`, and a day with `evening:true` (the Friday of a normal weekend) is researched from about 5 p.m. only.

- `STANDING` — things running across the whole weekend in town with no single start time (festivals, exhibitions, museum hours). Fields: id, cat, title, url, venue, hood, when, note, and either free:true or price:"...".

- `EVENTS` — timed events. Fields: day (the `key` of a day in the plan, "mon" to "sun"), cat, title, optional sub, times (array of "HH:MM" 24-hour strings — several entries for several showings of the same film), dur (minutes, best estimate), venue, hood (neighbourhood and métro station where you are sure of it), url, note, optional `dropIn`, and either free:true or price:"...".

  **`dropIn`** marks whether missing the start time means missing the event. The board dims a passed entry and says "started 40 min ago" for scheduled things, but only "On now" for come-anytime ones, so this matters. Set `dropIn: true` for anything you can walk into partway — a market, a festival site, a street fair, an all-afternoon day party, a drum circle, a race you watch from the roadside, an open-house. Set `dropIn: false` for anything with a curtain — a film showing, a play, a dance programme, a gig with a support act, a talk, a guided walk that leaves at a fixed time. Omit it and the page guesses from category and length, which gets a guided 8 a.m. bird walk wrong; set it explicitly wherever the answer is clear.

- `AFIELD` — 3 to 5 day and half-day trips out of Montreal, refreshed every week so the section stays interesting. Mix distances: something under an hour (Montérégie orchards, Mont-Saint-Bruno, Vieux-Terrebonne, Îles-de-Boucherville), something in the 1–2 hour band (Eastern Townships, Laurentians, Lanaudière), and occasionally a stretch trip (Quebec City, Charlevoix, Mont-Tremblant) when something there justifies the drive. Prefer entries anchored to a dated event over generic "go for a walk" suggestions. Fields: id, cat, title, url, region, travel (a mono line like "1h45 by car · Autoroute 10 East", naming the car-free option where one exists), when, trip ("Half day" or "Full day"), note, and either free:true or price:"...".

**Day-trip checks (hard requirements, not preferences).** AFIELD must have 3 to 5 trips, and together they must include: (a) at least one under an hour from Montreal; (b) trips in at least two different regions (Montérégie, Laurentians, Eastern Townships, Lanaudière, Quebec City, and so on — four ski hills in one region fails); (c) at least one trip reachable without a car, confirmed on the transit operator's own page (exo train, intercity coach, Navette Nature, river shuttle, a festival shuttle). Look for (c) specifically before settling: check exo.quebec, Navette Nature and the events at towns on the exo lines (Saint-Jérôme, Mont-Saint-Hilaire, Vaudreuil-Hudson, Mascouche, Candiac) and on intercity coach routes. Only if you have genuinely searched and nothing car-free exists that weekend may you leave (c) unmet, and then the report must say which operators and towns you checked. At least two of the trips should be anchored to a dated event rather than being a general visit.

These three lists are a complete, unweighted picture of the weekend. Assemble them before you look at the history again.

**Highlights.** Exactly three entries get starred, across those blocks (via a `star:"..."` field) or on a captured-poster record (Step 3b). The app renders the first three it finds as the "Don't miss" panel. In update mode, keep the existing three unless one has dropped off, sold out, fallen on a day already past, or something clearly stronger has been added; carry their `star` text over unchanged when you keep them. Once the weekend is under way, every highlight should be on a day still ahead or running all weekend.
- **Two weighted slots.** Entries that connect to the add-and-star history — the same venues, the same categories, the same kind of thing as recent adds and stars, or the next step from one. Name the connection in the `star` text when there is a real one: the owner likes a plain reference to what they have planned or starred before ("the same Cinémathèque series as the Maria Chapdelaine screening you planned", "from the company behind the ballet you starred"). Keep it specific and factual; no flattery and no generic "since you love film".
- **One wildcard slot, always.** The most interesting thing on the board with NO relationship to anything they've added or starred — a different form, a different scene, a different part of the province. Never let the weighted logic claim it, and never pick something merely obscure. It has to be genuinely good.
Prefer highlights the owner can actually get to: where you have a real choice between otherwise comparable entries, favour one that does not fall inside an event on their calendar or a stretch when they are away (Step 2). Events marked free (occasions) do not count against a highlight. If they are away the whole weekend, choose on taste and merit as usual. Never mention their calendar or travel in the `star` text.
If there is no history, all three are chosen on merit.
The `star` text is two sentences at most, saying why this one and not the other forty — concrete and specific, no hype, no exclamation marks.

Aim for roughly 40–65 timed events and 5–10 standing items for a normal weekend. A day off adds its own events on top, a handful to a dozen a day, and in travel mode a smaller place may genuinely have fewer: list what you can confirm rather than padding. Keep the writing voice of previous weeks: specific, plain, one useful sentence of `note` on every entry.

Before posting, run a script over the payload that checks: every `cat` is one of the seven values; every EVENTS entry has `day`, `times` (possibly empty, with `bandHint` if so) and a `note`; exactly three `star` fields across the blocks and captured posters; every EVENTS `day` is a day in the plan; AFIELD has 3 to 5 entries spanning at least two regions, with at least one under an hour and at least one whose `travel` names a verified car-free option. Fix anything it flags.

STEP 6 — Publish to the app.
POST the four blocks, plus BUSY and AWAY from Step 2, as strict JSON (quoted keys, no trailing commas, no comments), sent from the file you built:

    POST https://montreal-weekend-board-lifelikedevteam.vercel.app/api/refresh
    Authorization: Bearer <APP TOKEN>
    Content-Type: application/json
    { "WEEKEND": {...}, "STANDING": [...], "EVENTS": [...], "AFIELD": [...], "BUSY": [...], "AWAY": [...] }

In travel mode `WEEKEND.place` is already set from the plan, so leave `AWAY` out of the payload (the app stores it empty there, because the listings are for where the owner is). Leave "BUSY" and "AWAY" out entirely if the calendar could not be read. A 200 returns {ok:true, weekendId, counts}; check the counts match what you assembled (counts.busy and counts.away are per-day segments, so a trip spanning the weekend counts once per day it touches). The endpoint refuses a payload where EVENTS and STANDING are both empty, on purpose: a run that produced nothing is a failed run, not an empty weekend.

In travel mode, once the refresh has succeeded, report what you learned about the place's sources:

    POST https://montreal-weekend-board-lifelikedevteam.vercel.app/api/trip
    Authorization: Bearer <APP TOKEN>
    Content-Type: application/json
    {"op":"sources","place":{"name":"Boston","region":"Massachusetts","country":"United States"},"sources":[{"url":"https://...","name":"...","kind":"...","covers":"...","note":"..."}],"used":["https://..."],"dead":["https://..."]}

`place` is the plan's `place`. If you found out that the owner's place is known by another name (a neighbourhood, a nickname, a different spelling the plan did not fold together), also file it so the next trip finds this list: `POST /api/trip {"op":"alias","alias":"<the other name>","place":<the plan's place>}`. `sources` are NEW good sources you found (https, at most 50); `used` are urls from the plan's list that gave you listings; `dead` are urls that failed or were empty. A failure here does not undo the refresh; say so in the report. At home, send nothing.

If it returns 401, the token has not been accepted — say so clearly in your report. Do not attempt to discover or guess another token.

STEP 7 — Report.
One short paragraph: the mode (full or update), the days covered (and which are days off), the place if the board is in travel mode (and what the plan based it on), the sources you used or marked dead, which weekend the board now covers, roughly how many listings, which three you starred and which was the wildcard, whether the history came from the app (and how many adds and stars it held), how many calendar events you sent as BUSY (how many carried a hood, and how many were marked free) and which away stretches you sent (or that the calendar could not be read), what you did with the captured posters (verified, corrected, rejected, left unconfirmed, or skipped as waiting on the owner), which day trip is the car-free one (or which operators and towns you checked if none exists), and anything notable you could not confirm. State explicitly whether the POST in Step 6 succeeded and what the returned counts were.
In update mode, follow the paragraph with one line per source from Step 4's update list, every source on its own line (do not group sources as "other sources"; ask a helper for per-source results if you need them), and a source you did not fetch is listed as "not fetched" with the reason: the source, whether the fetch worked, how many entries it listed for the days still ahead, and how many of those you matched, added or changed on the board. Then give the totals added, changed and dropped.
Do not create or update any artifact.
