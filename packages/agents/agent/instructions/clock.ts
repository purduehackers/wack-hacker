import { defineDynamic, defineInstructions } from "eve/instructions";

/**
 * Tell the agent what time it is.
 *
 * `identity.md` says to interpret unqualified clock times in
 * `America/Indiana/Indianapolis`, but nothing ever told the model the current
 * time. Asked to schedule something "five minutes from now" it did the only
 * thing left: called `bash` to run `date -u`, which provisions a Vercel Sandbox
 * to read a clock the runtime already has.
 *
 * Resolved per turn rather than per session. A Discord conversation is one Eve
 * session that can stay open for hours, so a timestamp fixed at `session.started`
 * would be wrong by more than the granularity anything here schedules at. It
 * cannot be a static module either: a module-backed prompt is captured into the
 * compiled manifest at build time and never re-runs, so the whole deployment
 * would share the instant it was built.
 */
export default defineDynamic({
  events: {
    "turn.started": () => {
      const now = new Date();
      return defineInstructions({
        markdown: [
          "# Now",
          "",
          `The current time is ${now.toISOString()}.`,
          "",
          "Use it directly for relative times like “in five minutes”. Do not shell",
          "out to read the clock — that starts a sandbox to learn something you",
          "already know.",
        ].join("\n"),
      });
    },
  },
});
