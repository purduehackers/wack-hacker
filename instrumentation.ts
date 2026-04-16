import * as Sentry from "@sentry/nextjs";

export async function register() {
  const { register } = await import("./src/lib/evlog");
  register();

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
  const { onRequestError } = await import("./src/lib/evlog");
  const [error, request, context] = args;
  onRequestError(
    error as { digest?: string } & Error,
    request as { path: string; method: string; headers: Record<string, string> },
    context as {
      routerKind: string;
      routePath: string;
      routeType: string;
      renderSource: string;
    },
  );
  return Sentry.captureRequestError(...args);
}
