/* The model the app calls, named once. Defaults to the current Sonnet;
   ANTHROPIC_MODEL overrides it. There is no alias that follows the newest
   model, so this id is bumped by hand when a newer Sonnet ships. */
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
