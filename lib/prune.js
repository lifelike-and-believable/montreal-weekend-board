import { list, del } from "@vercel/blob";
import { listDocs, deleteDoc, photoPrefix } from "./store.js";

/* Nothing in this app ever reclaimed anything. Three surfaces, one root:

   - spotted documents for posters whose dates have long passed. The board
     stops showing them the moment their end date falls before the weekend
     (see splitSpotted), so they were invisible but permanent.
   - the Blob photo behind each of those, and behind every record the owner
     deleted by hand: dropSpotted removes the document only, and nothing in
     the repo ever called del().
   - plans/<weekendId>, one document per weekend, forever.

   The refresh is the right place to do this. It is the only moment the app
   knows the weekend has turned over, it runs on a schedule, and it already
   holds the new weekend's span.

   Deletion is irreversible and takes photographs with it, so every rule
   here is deliberately conservative:

   - a record expires only if it carries a date AND that date is more than
     SPOTTED_GRACE_DAYS behind the new weekend. The grace period buys
     nothing visible — the board already hides these — but it means one
     mistyped WEEKEND date cannot empty the store.
   - a photo is deleted only when no surviving record refers to it. If no
     record ever did, it must also be older than ORPHAN_GRACE_DAYS: the
     capture flow uploads the photo before it writes the record, and a
     refresh landing inside that window must not delete a photo that is
     about to be claimed.
   - a record with no date at all is never touched. That is a poster still
     waiting to be read, sitting in the holding pen. */

const SPOTTED_GRACE_DAYS = 30;
const ORPHAN_GRACE_DAYS = 7;
const PLAN_RETAIN_DAYS = 120;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEL_CHUNK = 50;
const MAX_BLOB_PAGES = 20;

const pad = (n) => (n < 10 ? "0" + n : String(n));

/** "YYYY-MM-DD" shifted by whole days, still "YYYY-MM-DD". */
function shift(iso, days) {
  const p = iso.split("-");
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + days));
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

const msg = (e) => String((e && e.message) || e);

/** Every photo blob we hold, across pages. */
async function allPhotos() {
  const prefix = photoPrefix();
  const out = [];
  let cursor;
  for (let page = 0; page < MAX_BLOB_PAGES; page++) {
    const r = await list({ prefix, cursor, limit: 1000 });
    for (const b of r.blobs || []) out.push(b);
    if (!r.hasMore || !r.cursor) return { blobs: out, complete: true };
    cursor = r.cursor;
  }
  /* More pages than we are willing to walk. Orphan sweeping is only safe
     when the picture of what exists is complete, so say so. */
  return { blobs: out, complete: false };
}

/* Returns how many were actually deleted. A chunk that fails must not
   hide the ones that went, nor stop the ones after it: this is the half
   of the job that cannot be re-derived from the store afterwards. */
async function delMany(urls, report) {
  let done = 0;
  for (let i = 0; i < urls.length; i += DEL_CHUNK) {
    const chunk = urls.slice(i, i + DEL_CHUNK);
    try {
      await del(chunk);
      done += chunk.length;
    } catch (e) {
      report.errors.push(`deleting ${chunk.length} photo(s): ` + msg(e));
    }
  }
  return done;
}

/**
 * Reclaim what the weekend starting `weekendStart` has left behind.
 * Never throws: a refresh that stored its listings has succeeded, whatever
 * happens here. Returns a report, with `errors` listing what it could not do.
 */
export async function pruneBoard({ weekendStart, dryRun = false } = {}) {
  const report = {
    dryRun: !!dryRun,
    spotted: 0, photos: 0, plans: 0,
    errors: []
  };

  if (!weekendStart || !ISO_DATE.test(weekendStart)) {
    report.errors.push(`refusing to prune: weekendStart "${weekendStart}" is not a date`);
    return report;
  }

  const spottedCutoff = shift(weekendStart, -SPOTTED_GRACE_DAYS);
  const planCutoff = shift(weekendStart, -PLAN_RETAIN_DAYS);
  const orphanCutoff = Date.now() - ORPHAN_GRACE_DAYS * 86400000;
  report.cutoffs = { spotted: spottedCutoff, plans: planCutoff };

  /* ---- spotted records ------------------------------------------- */
  let records = null;
  try {
    records = await listDocs("spotted");
  } catch (e) {
    report.errors.push("reading spotted: " + msg(e));
  }

  const expired = [], survivors = [];
  for (const r of records || []) {
    const d = r.data || {};
    const end = d.endDate || d.startDate || null;
    if (end && String(end) < spottedCutoff) expired.push(r);
    else survivors.push(r);
  }

  for (const r of expired) {
    if (dryRun) { report.spotted++; continue; }
    try {
      await deleteDoc("spotted/" + r.id);
      report.spotted++;
    } catch (e) {
      report.errors.push(`deleting spotted/${r.id}: ` + msg(e));
    }
  }

  /* ---- photos ------------------------------------------------------
     Only reconcile when the record list was readable: without it every
     photo looks like an orphan. */
  if (records) {
    const live = new Set(), known = new Set();
    for (const r of survivors) if (r.data && r.data.photoId) live.add(String(r.data.photoId));
    for (const r of records) if (r.data && r.data.photoId) known.add(String(r.data.photoId));

    try {
      const { blobs, complete } = await allPhotos();
      const prefix = photoPrefix();
      const doomed = [];
      for (const b of blobs) {
        const id = String(b.pathname || "").slice(prefix.length);
        if (!id || live.has(id)) continue;
        const uploaded = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
        /* Unknown to every record: only once it is too old to be a photo
           mid-capture. Known to a record we just deleted: goes now. */
        const claimed = known.has(id);   // a record we just expired held it
        if (!claimed && !(uploaded && uploaded < orphanCutoff)) continue;
        if (!claimed && !complete) continue;
        doomed.push(b.url);
      }
      report.photos = dryRun ? doomed.length
                             : (doomed.length ? await delMany(doomed, report) : 0);
      if (!complete) report.errors.push("photo list truncated: orphan sweep skipped");
    } catch (e) {
      report.errors.push("reclaiming photos: " + msg(e));
    }
  }

  /* ---- old plan documents ----------------------------------------- */
  try {
    const plans = await listDocs("plans");
    for (const p of plans) {
      if (!ISO_DATE.test(p.id) || p.id >= planCutoff) continue;
      if (dryRun) { report.plans++; continue; }
      try {
        await deleteDoc("plans/" + p.id);
        report.plans++;
      } catch (e) {
        report.errors.push(`deleting plans/${p.id}: ` + msg(e));
      }
    }
  } catch (e) {
    report.errors.push("reading plans: " + msg(e));
  }

  return report;
}
