import { z } from "zod";

/**
 * Stable response returned by the bot liveness/readiness endpoint.
 *
 * Deliberately not a `strictObject`: a newer bot may report a field this reader
 * has never heard of, and a rolling deploy must not turn that into a failed
 * readiness probe.
 */
export const healthReportSchema = z.object({
  ready: z.boolean(),
  /** -1 means the gateway has not measured a heartbeat yet. */
  websocketPingMs: z.int().min(-1),
  uptimeSeconds: z.int().nonnegative(),
});

export type HealthReport = z.output<typeof healthReportSchema>;

/** A successful supervisor/release probe must be structurally valid and ready. */
export const readyHealthReportSchema = z.object({
  ...healthReportSchema.shape,
  ready: z.literal(true),
});
