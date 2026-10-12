/* The model is named in one place. It defaults to the current Sonnet, and
   ANTHROPIC_MODEL overrides it. The health route reports the same model the
   poster reader sends. */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "auth-secret";
process.env.ANTHROPIC_API_KEY = "test-key";

const url = (p) => new URL("../" + p, import.meta.url).href;
const sent = [];
globalThis.fetch = async (_u, init) => {
  sent.push(JSON.parse(init.body));
  return { ok: true, json: async () => ({ content: [{ type: "text", text: '{"title":"x"}' }] }) };
};

mock.module(url("lib/auth.js"), { namedExports: { gate: () => true, isAuthed: () => false } });

const health = (await import(url("api/health.js"))).default;
const readPoster = (await import(url("api/read-poster.js"))).default;

const run = (handler, req) => new Promise((resolve) => {
  handler(req, { status() { return this; }, json: resolve });
});

beforeEach(() => { sent.length = 0; });

test("the default is the current Sonnet", async () => {
  const body = await run(health, { headers: {} });
  assert.equal(body.model, "claude-sonnet-5-5");
});

test("the poster reader sends that model", async () => {
  await run(readPoster, { method: "POST", headers: {}, body: { prompt: "p", data: "ZGF0YQ==" } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].model, "claude-sonnet-5-5");
});
