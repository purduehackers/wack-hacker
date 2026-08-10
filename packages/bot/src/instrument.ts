import * as Sentry from "@sentry/bun";
import { z } from "zod";

/**
 * The trace sample rate, parsed rather than coerced.
 *
 * This module is a `--preload`, so it runs before `env.ts` and cannot use it:
 * validating the whole environment here would move every missing-credential
 * failure ahead of `Sentry.init`, which is the one thing that has to survive a
 * bad configuration. Hence a local schema for the single variable it reads.
 *
 * `Number("")` is 0 and `Number("abc")` is NaN — the old `Number.isFinite`
 * guard caught the second and silently accepted the first as "never sample".
 *
 * `z.regexes.number` is `/^-?\d+(?:\.\d+)?$/`, the same pattern the agent's
 * `unitFraction` uses, so both processes accept exactly one spelling. It wants
 * a leading digit: `"0.5"` parses, `".5"` and `"1e-3"` do not, and neither does
 * anything outside [0, 1]. All of those now fall back to the 0.1 default.
 */
const tracesSampleRate = z
  .string()
  .regex(z.regexes.number)
  .transform((value) => Number.parseFloat(value))
  .pipe(z.number().min(0).max(1))
  .catch(0.1)
  .parse(process.env["SENTRY_TRACES_SAMPLE_RATE"]);

Sentry.init({
  dsn: process.env["SENTRY_DSN"],
  enabled: process.env["SENTRY_DSN"] !== undefined,
  environment: process.env["VERCEL_ENV"] ?? process.env["NODE_ENV"] ?? "development",
  release: process.env["SENTRY_RELEASE"],
  sendDefaultPii: false,
  enableLogs: true,
  integrations: [Sentry.consoleLoggingIntegration({ levels: ["info", "warn", "error"] })],
  tracesSampleRate,
});
