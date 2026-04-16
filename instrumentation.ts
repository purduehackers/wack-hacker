import * as Sentry from "@sentry/nextjs";

export async function register() {
  try {
    const { register } = await import("./src/lib/evlog");
    register();
  } catch (error) {
    console.error("Failed to register evlog during startup.", error);
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export async function onRequestError(
  ...args: Parameters<typeof Sentry.captureRequestError>
): Promise<ReturnType<typeof Sentry.captureRequestError>> {
  const [error, request, context] = args;

  try {
    const { onRequestError: evlogOnRequestError } = await import("./src/lib/evlog");
    evlogOnRequestError(
      error as { digest?: string } & Error,
      request as {
        path: string;
        method: string;
        headers: Record<string, string>;
      },
      context as {
        routerKind: string;
        routePath: string;
        routeType: string;
        renderSource: string;
      },
    );
  } catch {
    // Best-effort evlog emission must not prevent Sentry/Next.js error handling.
  }

  return Sentry.captureRequestError(...args);
}
