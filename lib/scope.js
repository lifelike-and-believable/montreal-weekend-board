/* What the daily routine's token may do in the store.

   The routine reads the taste profile, and reads and writes the captured
   posters under spotted/. That is all its instructions use, so that is all
   it is given: a page it reads from the web cannot turn the token into
   edits of plans, the board or the taste profile, or into deletes.

   Matched against the path as sent, not as cleaned, so anything that needs
   cleaning is refused. */

const POSTER = /^spotted\/[A-Za-z0-9_\-.]{1,120}$/;

const poster = (path) => POSTER.test(path) && !path.includes("..");

export function jobMayUseDb(body) {
  const { op, path } = body && typeof body === "object" ? body : {};
  if (typeof path !== "string") return false;
  if (op === "get") return path === "taste/profile" || poster(path);
  if (op === "list") return path === "spotted";
  if (op === "set") return poster(path);
  return false;
}
