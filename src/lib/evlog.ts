import { createInstrumentation } from "evlog/next/instrumentation";
import { createSentryDrain } from "evlog/sentry";

export const { register, onRequestError } = createInstrumentation({
  service: "wack-hacker",
  drain: createSentryDrain({
    dsn:
      process.env.SENTRY_DSN ??
      "https://23174d7cbef96f2fd9276db93bd566cf@o4510744753405952.ingest.us.sentry.io/4511219848904704",
  }),
});
