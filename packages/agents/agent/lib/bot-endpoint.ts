import {
  readActiveBotGeneration,
  type ActiveBotGenerationReader,
} from "@repo/shared/bot-generation";

/**
 * Resolve the fenced live Sandbox domain. A static host remains the fallback
 * for non-Sandbox deployments; malformed, unreadable, or expired active state
 * fails closed rather than routing work to a stale generation.
 */
export async function resolveBotBaseUrl(
  redis: ActiveBotGenerationReader,
  fallback: string,
  now = new Date(),
): Promise<string> {
  const active = await readActiveBotGeneration(redis);
  if (active === undefined) return fallback;
  if (Date.parse(active.expiresAt) <= now.getTime()) {
    throw new Error("active bot Sandbox generation has expired");
  }
  const base = new URL(active.healthUrl);
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  return base.toString();
}
