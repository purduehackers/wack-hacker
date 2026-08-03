/**
 * Process lifecycle for the long-running bot.
 *
 * The bot is a single always-on process, so shutdown is a real concern rather
 * than an afterthought: whatever host it runs on (Vercel Sandbox, Fly, a
 * homelab box) will eventually send SIGTERM, and the gateway socket, the HTTP
 * server, and any in-flight Redis lock all need releasing before the process
 * goes away. Handlers run in reverse registration order, so a resource always
 * tears down before the thing it depends on.
 */

/** Reverse-order teardown. Registered by whoever owns the resource. */
const handlers: { name: string; run: () => Promise<void> | void }[] = [];

let shuttingDown = false;

export function onShutdown(name: string, run: () => Promise<void> | void): void {
  handlers.push({ name, run });
}

/**
 * Runs every registered handler, newest first. Each handler is isolated: one
 * that throws is reported and the rest still run, because a failed teardown
 * must not strand the resources behind it.
 *
 * Returns the names of handlers that failed, so the caller decides the exit
 * code. Idempotent — a second signal while draining is ignored.
 */
export async function shutdown(reason: string): Promise<readonly string[]> {
  if (shuttingDown) return [];
  shuttingDown = true;

  const failed: string[] = [];
  for (const handler of [...handlers].reverse()) {
    try {
      await handler.run();
    } catch (error) {
      failed.push(handler.name);
      console.error(`shutdown handler "${handler.name}" failed during ${reason}`, error);
    }
  }
  return failed;
}

/**
 * Installs the signal handlers. `graceMs` bounds the drain so a wedged handler
 * cannot hold the process open past the host's own grace period — Vercel
 * Sandbox and most container hosts allow about 30s before SIGKILL.
 */
export function installSignalHandlers(graceMs = 20_000): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void (async () => {
        const timer = setTimeout(() => {
          console.error(`shutdown exceeded ${graceMs}ms after ${signal}; exiting anyway`);
          process.exit(1);
        }, graceMs);
        timer.unref();

        const failed = await shutdown(signal);
        clearTimeout(timer);
        if (failed.length > 0) process.exit(1);
        process.exit(0);
      })();
    });
  }
}

/** Test seam: drops registered handlers and re-arms `shutdown`. */
export function resetLifecycleForTest(): void {
  handlers.length = 0;
  shuttingDown = false;
}
