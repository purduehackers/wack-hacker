import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ??
    "https://23174d7cbef96f2fd9276db93bd566cf@o4510744753405952.ingest.us.sentry.io/4511219848904704",

  // Capture everything — see sentry.server.config.ts for the rationale.
  tracesSampleRate: 1.0,

  sendDefaultPii: true,
  enableLogs: true,
});
