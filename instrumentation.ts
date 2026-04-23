import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Bump the per-attribute length cap before Sentry's OTEL SDK reads env. The
  // AI SDK stores full prompt messages and tool-call args/results as span
  // attributes, which routinely exceed the 1024 default. 64 KB keeps the full
  // conversation history on `ai.prompt.messages` and tool inputs/outputs so
  // traces in Sentry show the whole agent interaction.
  if (!process.env.OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT) {
    process.env.OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT = "65536";
  }

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
