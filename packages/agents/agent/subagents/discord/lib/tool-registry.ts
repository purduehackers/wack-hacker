/**
 * The Discord domain tool catalog.
 *
 * Every operation runs against this deployment's own Discord REST identity, the
 * same way the Linear subagent calls the Linear SDK. There is no RPC hop to the
 * bot and no hand-written request/response contract: the modules below own their
 * input schemas, their `Routes.*` calls, and their response projections.
 *
 * The bot keeps what only it can do — the gateway, community handlers, HITL
 * interaction responses, and rendering the agent's replies. Rendering has always
 * had its own REST client (`packages/bot/src/agent/render/discord-rest.ts`) with
 * nonce-enforced idempotency; it never crossed this seam.
 *
 * Authorization is unchanged and shared: each entry is a `defineDomainTool` with
 * an `access` descriptor, resolved by the common domain runtime.
 */

import { ASSET_OPERATIONS } from "./operations/assets.ts";
import { GUILD_OPERATIONS } from "./operations/guild.ts";
import { MEMBER_OPERATIONS } from "./operations/members.ts";
import { MESSAGE_OPERATIONS } from "./operations/messages.ts";
import { ROLE_CHANNEL_OPERATIONS } from "./operations/roles-channels.ts";

export const DISCORD_TOOLS = {
  ...GUILD_OPERATIONS,
  ...ROLE_CHANNEL_OPERATIONS,
  ...MEMBER_OPERATIONS,
  ...ASSET_OPERATIONS,
  ...MESSAGE_OPERATIONS,
} as const;
