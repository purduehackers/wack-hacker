export const HANDOFF_WAIT_MS = 8_000;
export const READY_TIMEOUT_MS = 30_000;

/**
 * Keepalive cadence for the gateway listener. Single source of truth shared by
 * the Vercel cron that pings `/api/discord/gateway` (`vercel.ts`) and the Sentry
 * check-in monitor for it (`gateway/index.ts`), so the two can't drift.
 */
export const GATEWAY_KEEPALIVE_CRON = "*/9 * * * *";
