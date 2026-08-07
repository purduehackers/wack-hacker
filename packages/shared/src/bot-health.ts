import { z } from "zod";

/** Stable response returned by the bot liveness/readiness endpoint. */
export const healthReportSchema = z.object({
  ready: z.boolean(),
  websocketPingMs: z.number().refine(Number.isInteger, "expected an integer").min(-1),
  uptimeSeconds: z.number().int().nonnegative(),
});

export type HealthReport = z.output<typeof healthReportSchema>;

/** A successful supervisor/release probe must be structurally valid and ready. */
export const readyHealthReportSchema = healthReportSchema.extend({ ready: z.literal(true) });

export type ReadyHealthReport = z.output<typeof readyHealthReportSchema>;
