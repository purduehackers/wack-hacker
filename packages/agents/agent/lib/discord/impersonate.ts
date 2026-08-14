/**
 * Invoke the agent as a real Discord member, for testing.
 *
 * `eve invoke` reaches a deployed agent over HTTP and creates a session with no
 * principal. Every interesting path refuses on the spot — anything
 * admin-gated, the whole subagent relay — because `roleFromMemberRoles` has
 * nothing to derive a tier from. That makes the loop useless for exactly the
 * things worth exercising, which is why this exists.
 *
 * Two rules keep it from being a way in.
 *
 * **Never in production.** A principal chosen by an environment variable is
 * privilege escalation if it survives the deployment that matters. The gate is
 * a property of the deployment rather than of the request, the same shape eve's
 * own `localDev()` uses. No header can therefore flip it.
 *
 * **Roles always come from the guild, never from the caller.** Roles passed in
 * would mint an admin who does not exist. Because roles come from Discord, this
 * can only ever impersonate somebody who already holds the access, and revoking
 * their role revokes this too.
 */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import type { Principal } from "@repo/shared/wire";
import type { SessionAuthContext } from "eve/context";
import { z } from "zod";

import { env } from "../../env.ts";
import { authFor } from "./auth.ts";

/** Only the fields that go into a principal. */
const guildMemberSchema = z.looseObject({
  roles: z.array(z.string()),
  nick: z.string().nullish(),
  user: z.looseObject({
    id: z.string(),
    username: z.string(),
    global_name: z.string().nullish(),
  }),
});

/**
 * A deployment that may impersonate.
 *
 * The platform sets `VERCEL_ENV` on every deployment and local runs lack it.
 * Anything that is not explicitly a production deployment therefore qualifies:
 * local development, and preview deployments. Previews are the surface worth
 * testing on, because they run the same code against the same infrastructure.
 */
function impersonationAllowed(): boolean {
  return process.env["VERCEL_ENV"] !== "production";
}

async function readGuildMember(userId: string, token: string): Promise<Principal> {
  const response = await fetch(
    `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${userId}`,
    { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) {
    throw new Error(`Discord returned ${response.status} reading member ${userId}`);
  }
  const member = guildMemberSchema.parse(await response.json());
  return {
    userId: member.user.id,
    username: member.user.username,
    nickname: member.nick ?? member.user.global_name ?? member.user.username,
    memberRoles: member.roles,
  };
}

/**
 * The assertion an impersonated invocation runs under, or nothing.
 *
 * Refuses loudly rather than falling back to an unprivileged session. A test
 * that quietly runs as nobody reports a policy denial as though it were the
 * behaviour under test. That is worse than one that will not start.
 */
export async function impersonatedAuth(): Promise<SessionAuthContext | undefined> {
  const userId = process.env["DISCORD_IMPERSONATE_USER_ID"];
  if (userId === undefined || userId === "") return undefined;

  if (!impersonationAllowed()) {
    throw new Error("DISCORD_IMPERSONATE_USER_ID is set on a production deployment");
  }
  const token = env.DISCORD_BOT_TOKEN;
  if (token === undefined) {
    throw new Error("DISCORD_IMPERSONATE_USER_ID needs DISCORD_BOT_TOKEN to read the member");
  }

  const principal = await readGuildMember(userId, token);
  console.info(
    JSON.stringify({
      event: "discord.impersonated",
      userId: principal.userId,
      username: principal.username,
      roles: principal.memberRoles.length,
    }),
  );
  // No channel and no dispatch: an impersonated session has somewhere to act
  // from but nowhere to paint, so the render path stays inert and nothing
  // reaches Discord.
  return authFor(principal, { channelId: "", source: "chat" });
}
