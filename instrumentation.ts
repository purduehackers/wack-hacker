import * as Sentry from "@sentry/nextjs";

export async function register() {
  const { initLogger } = await import("evlog");
  const { createSentryDrain } = await import("evlog/sentry");

  initLogger({
    env: { service: "wack-hacker" },
    drain: createSentryDrain({
      dsn:
        process.env.SENTRY_DSN ??
        "https://23174d7cbef96f2fd9276db93bd566cf@o4510744753405952.ingest.us.sentry.io/4511219848904704",
    }),
  });

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export function onRequestError(
  ...args: Parameters<typeof Sentry.captureRequestError>
): ReturnType<typeof Sentry.captureRequestError> {
  return Sentry.captureRequestError(...args);
}
