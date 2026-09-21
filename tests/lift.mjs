/* Lift a function out of the board's inline script by walking its braces,
   so what the tests run is what ships. No regex, so nothing depends on
   escaping surviving a shell. Safe as long as the body carries no
   unbalanced brace inside a string or a regex literal.

   hood-html.test.mjs had the first copy of this; it stays where it is so
   that test keeps proving the board script is liftable on its own. */
import assert from "node:assert/strict";
import fs from "node:fs";

export const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

export function lift(name) {
  const decl = "function " + name + "(";
  const i = html.indexOf(decl);
  assert.notEqual(i, -1, name + " not found in index.html");
  const argEnd = html.indexOf(")", i + decl.length);
  const args = html.slice(i + decl.length, argEnd);
  const bodyStart = html.indexOf("{", argEnd) + 1;
  let depth = 1, j = bodyStart;
  while (j < html.length && depth > 0) {
    const c = html[j++];
    if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  assert.equal(depth, 0, name + " braces did not balance");
  return { args, body: html.slice(bodyStart, j - 1) };
}

/** Build a lifted function, with the names it reaches for passed in. */
export function build(name, deps = {}) {
  const { args, body } = lift(name);
  const keys = Object.keys(deps);
  return new Function(...keys, "return function (" + args + ") {" + body + "}")(
    ...keys.map((k) => deps[k]));
}
