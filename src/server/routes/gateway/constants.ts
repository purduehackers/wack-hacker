export const HANDOFF_WAIT_MS = 8_000;
export const READY_TIMEOUT_MS = 30_000;

/**
 * Keepalive cadence for the gateway listener's Sentry check-in monitor. The
 * Vercel cron that actually pings `/api/discord/gateway` mirrors this as a
 * literal in `vercel.ts` (its config loader can't import the value), so keep
 * the two in sync.
 */
export const GATEWAY_KEEPALIVE_CRON = "*/9 * * * *";
