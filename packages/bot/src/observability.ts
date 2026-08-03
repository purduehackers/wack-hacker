/**
 * The bot's reporter.
 *
 * `@repo/shared` defines `Reporter` as an interface rather than importing Sentry,
 * so each package supplies its own. This is the console-backed implementation:
 * one structured line per unit of work, which is exactly what a container host
 * captures from stdout. Sentry and evlog replace `captureDefect` and `emit` in
 * Phase 7 without touching a single call site.
 *
 * The split it enforces is the point. An expected failure — a role denial, a 404
 * from Linear — is counted and never paged. A defect is our bug and gets the
 * full error. The legacy app blurred these and compensated with an
 * `ignoreErrors` denylist in its Sentry config.
 */

import type { Reporter, WideEvent } from "@repo/shared/result/observe";

function line(event: WideEvent): string {
  const fields: string[] = [`op=${event.op}`, `status=${event.status}`];
  if (event.durationMs !== undefined) fields.push(`duration_ms=${event.durationMs}`);
  if (event.errorTag !== undefined) fields.push(`error_tag=${event.errorTag}`);
  if (event.errorMessage !== undefined) fields.push(`error="${event.errorMessage}"`);
  return fields.join(" ");
}

export const consoleReporter: Reporter = {
  emit: (event) => {
    if (event.status === "ok") console.info(line(event));
    else console.warn(line(event));
  },
  captureDefect: (error, context) => {
    // Defects keep their stack: this is the one place the full error is wanted.
    console.error(`defect op=${context.op}`, error);
  },
};
