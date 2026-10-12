import { isAuthed } from "../lib/auth.js";
import { MODEL } from "../lib/model.js";

/* Reports which pieces of configuration are present. Booleans only —
   never a value. Safe to hit unauthenticated so setup can be checked
   before the passcode works. */
export default function handler(req, res) {
  const has = (k) => !!process.env[k];
  res.status(200).json({
    ok: true,
    authed: isAuthed(req),
    config: {
      AUTH_SECRET: has("AUTH_SECRET"),
      BOARD_PASSCODE: has("BOARD_PASSCODE"),
      DOC_SALT: has("DOC_SALT"),
      REFRESH_SECRET: has("REFRESH_SECRET"),
      CALENDAR_SECRET: has("CALENDAR_SECRET"),
      ANTHROPIC_API_KEY: has("ANTHROPIC_API_KEY"),
      redis: has("KV_REST_API_URL") || has("UPSTASH_REDIS_REST_URL"),
      blob: has("BLOB_READ_WRITE_TOKEN"),
      calendarRoutine: has("CALENDAR_ROUTINE_URL") && has("CALENDAR_ROUTINE_TOKEN")
    },
    model: MODEL
  });
}
