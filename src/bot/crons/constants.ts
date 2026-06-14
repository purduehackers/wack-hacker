/**
 * Keepalive cadence for the gateway listener. Single source of truth shared by
 * the Vercel cron that pings `/api/discord/gateway` (`vercel.ts`) and the Sentry
 * check-in monitor for it (`server/routes/gateway`), so the two can't drift.
 *
 * Lives under `bot/crons` (not the gateway module) because `vercel.ts` is
 * evaluated by Vercel at deploy time and can only resolve the lightweight
 * cron-domain modules it already imports — importing the gateway route module
 * (server runtime code) breaks that config evaluation.
 */
export const GATEWAY_KEEPALIVE_CRON = "*/9 * * * *";
