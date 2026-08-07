/** Materialize an agent-owned scheduled fire through the normal bot turn path. */

import { DiscordAPIError } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { continuationKeyFor } from "@repo/shared/wire";
import type {
  ChannelRef,
  MessagePayload,
  Principal,
  ScheduledFirePayload,
  ThreadRef,
} from "@repo/shared/wire";
import { RESTJSONErrorCodes } from "discord-api-types/v10";
import type { Client, Guild, GuildBasedChannel, GuildMember } from "discord.js";

import type { AgentRouter } from "./router.ts";

const PLACEHOLDER = "> Scheduled task is starting…";
const CLAIM_TTL_MS = 2 * 60_000;
const RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

const CLAIM_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if raw then
  local current = cjson.decode(raw)
  if current.scheduleId ~= ARGV[1]
    or current.ownerId ~= ARGV[2]
    or current.channelId ~= ARGV[3]
    or current.actionType ~= ARGV[4]
  then
    return -1
  end
  return current.status == "accepted" and 2 or 0
end
redis.call("SET", KEYS[1], ARGV[5], "PX", tonumber(ARGV[6]), "NX")
return 1
`;

const COMPLETE_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.status ~= "forwarding" or current.claimToken ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[3]))
return 1
`;

const RELEASE_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.status ~= "forwarding" or current.claimToken ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`;

export interface ScheduledFireDeps {
  readonly agent: AgentRouter;
  readonly client: Client;
  readonly redis: RedisClient;
  readonly guildId?: string;
}

function channelName(channel: Pick<GuildBasedChannel, "name">): string {
  return typeof channel.name === "string" && channel.name !== "" ? channel.name : "unknown";
}

function principalOf(member: GuildMember, guildId: string): Principal {
  return {
    userId: member.id,
    username: member.user.username,
    nickname: member.displayName,
    memberRoles: [...member.roles.cache.keys()].filter((roleId) => roleId !== guildId),
  };
}

interface ResolvedScheduleOwner {
  readonly principal: Principal;
  readonly warning?: string;
}

function snapshotPrincipal(
  payload: ScheduledFirePayload,
  memberRoles: readonly string[],
): Principal {
  return {
    userId: payload.ownerId,
    username: payload.ownerId,
    nickname: payload.ownerId,
    memberRoles: [...memberRoles],
  };
}

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function errorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return typeof cause.code === "string" ? cause.code : undefined;
}

/** Narrow fail-closed classifier for outages where a role snapshot is permitted. */
export function isTransientDiscordFailure(cause: unknown): boolean {
  if (cause instanceof DiscordAPIError) return cause.status === 429 || cause.status >= 500;
  if (cause instanceof DOMException) {
    return cause.name === "AbortError" || cause.name === "TimeoutError";
  }
  return (
    cause instanceof TypeError &&
    cause.cause !== undefined &&
    TRANSIENT_NETWORK_CODES.has(errorCode(cause.cause) ?? "")
  );
}

async function resolveScheduleOwner(
  guild: Guild,
  guildId: string,
  payload: ScheduledFirePayload,
): Promise<ResolvedScheduleOwner> {
  try {
    const member = await guild.members.fetch({ user: payload.ownerId, force: true });
    return { principal: principalOf(member, guildId) };
  } catch (cause) {
    if (
      cause instanceof DiscordAPIError &&
      (cause.code === RESTJSONErrorCodes.UnknownMember || cause.status === 404)
    ) {
      return {
        principal: snapshotPrincipal(payload, []),
        warning:
          "The schedule creator is no longer in the guild; this run was downgraded to public access.",
      };
    }
    // Only an explicitly classified Discord/transport outage may reuse
    // privileged creation-time roles. Programming errors and unknown failures
    // retry fail-closed rather than becoming authority.
    if (isTransientDiscordFailure(cause) && payload.memberRoles !== undefined) {
      return {
        principal: snapshotPrincipal(payload, payload.memberRoles),
        warning:
          "Current Discord roles could not be fetched; this run used the creation-time role snapshot.",
      };
    }
    throw cause;
  }
}

async function channelRefs(
  destination: GuildBasedChannel,
): Promise<{ readonly channel: ChannelRef; readonly thread?: ThreadRef }> {
  if (!destination.isThread()) {
    return {
      channel: {
        id: destination.id,
        name: channelName(destination),
        ...(destination.parentId === null ? {} : { categoryId: destination.parentId }),
      },
    };
  }

  const parentId = destination.parentId;
  if (parentId === null) throw new Error("scheduled destination thread has no parent");
  const parent =
    destination.parent ?? (await destination.guild.channels.fetch(parentId, { force: true }));
  if (parent === null) throw new Error("scheduled destination thread has no accessible parent");
  return {
    channel: {
      id: parent.id,
      name: channelName(parent),
      ...(parent.parentId === null ? {} : { categoryId: parent.parentId }),
    },
    thread: {
      id: destination.id,
      parentId: parent.id,
      parentName: channelName(parent),
    },
  };
}

function scheduledPrompt(payload: ScheduledFirePayload): string {
  return [
    `Scheduled task: ${payload.description}`,
    `Occurrence: ${payload.occurrenceId}`,
    `Scheduled for: ${payload.scheduledFor}`,
    "Carry out the creator's task now and report the result in this Discord destination.",
    payload.prompt,
  ].join("\n\n");
}

function receiptKey(occurrenceId: string): string {
  return `agent:scheduled-fire:${occurrenceId}`;
}

async function claimOccurrence(
  redis: RedisClient,
  payload: ScheduledFirePayload,
  claimToken: string,
): Promise<"acquired" | "accepted" | "busy"> {
  const forwarding = JSON.stringify({
    status: "forwarding",
    claimToken,
    scheduleId: payload.scheduleId,
    ownerId: payload.ownerId,
    channelId: payload.channelId,
    actionType: payload.actionType,
  });
  const result = Number(
    await redis.eval(
      CLAIM_SCRIPT,
      [receiptKey(payload.occurrenceId)],
      [
        payload.scheduleId,
        payload.ownerId,
        payload.channelId,
        payload.actionType,
        forwarding,
        CLAIM_TTL_MS,
      ],
    ),
  );
  if (result === 2) return "accepted";
  if (result === 1) return "acquired";
  if (result === 0) return "busy";
  throw new Error("scheduled occurrence identity conflicts with its durable receipt");
}

async function completeOccurrence(
  redis: RedisClient,
  payload: ScheduledFirePayload,
  claimToken: string,
): Promise<boolean> {
  const accepted = JSON.stringify({
    status: "accepted",
    scheduleId: payload.scheduleId,
    ownerId: payload.ownerId,
    channelId: payload.channelId,
    actionType: payload.actionType,
  });
  return (
    Number(
      await redis.eval(
        COMPLETE_SCRIPT,
        [receiptKey(payload.occurrenceId)],
        [claimToken, accepted, RECEIPT_TTL_SECONDS],
      ),
    ) === 1
  );
}

async function releaseOccurrence(
  redis: RedisClient,
  occurrenceId: string,
  claimToken: string,
): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, [receiptKey(occurrenceId)], [claimToken]);
}

export function scheduledFailureMessage(payload: ScheduledFirePayload): string {
  return payload.finalAttempt
    ? "⚠️ This scheduled task could not start after its final automatic attempt. Ask me to list scheduled tasks, then cancel or replace it after fixing its destination or permissions."
    : "⚠️ This scheduled task could not start. It will retry automatically. Ask me to list scheduled tasks if the problem continues.";
}

async function admitOccurrence(
  deps: ScheduledFireDeps,
  guildId: string,
  payload: ScheduledFirePayload,
  claimToken: string,
): Promise<void> {
  const guild = deps.client.guilds.cache.get(guildId);
  if (guild === undefined || !deps.client.isReady()) {
    throw new Error("Discord gateway is not ready for a scheduled fire");
  }

  const destination = await guild.channels.fetch(payload.channelId, { force: true });
  if (destination === null || !destination.isSendable()) {
    throw new Error("scheduled destination is missing or cannot receive messages");
  }

  if (payload.actionType === "message") {
    await destination.send({
      content: payload.prompt,
      nonce: `m:${payload.occurrenceId}`,
      enforceNonce: true,
      allowedMentions: { parse: [] },
    });
  } else {
    let placeholder: Awaited<ReturnType<typeof destination.send>> | undefined;
    try {
      // Force bypasses discord.js's cache. Missing members are downgraded to
      // public; a transient Discord outage alone may use the creation snapshot.
      const owner = await resolveScheduleOwner(guild, guildId, payload);
      if (owner.warning !== undefined) {
        await destination.send({
          content: `-# ⚠️ ${owner.warning}`,
          nonce: `w:${payload.occurrenceId}`,
          enforceNonce: true,
          allowedMentions: { parse: [] },
        });
      }

      // Discord's enforced nonce makes retries of an ambiguous POST converge on
      // the same anchor message. Its 24-character value is occurrence-stable.
      placeholder = await destination.send({
        content: PLACEHOLDER,
        nonce: `s:${payload.occurrenceId}`,
        enforceNonce: true,
        allowedMentions: { parse: [] },
      });
      // A retry can receive the prior enforced-nonce message after it was changed
      // to remediation text. Restore its in-progress state before resubmission.
      if (payload.attemptNumber > 1) await placeholder.edit(PLACEHOLDER);

      const refs = await channelRefs(destination);
      const turn: MessagePayload = {
        kind: "scheduled",
        scheduleId: payload.scheduleId,
        occurrenceId: payload.occurrenceId,
        continuationKey: continuationKeyFor({
          channelId: refs.channel.id,
          ...(refs.thread === undefined ? {} : { threadId: refs.thread.id }),
        }),
        content: scheduledPrompt(payload),
        messageId: placeholder.id,
        anchorMessageId: placeholder.id,
        principal: owner.principal,
        channel: refs.channel,
        ...(refs.thread === undefined ? {} : { thread: refs.thread }),
        ...(payload.traceparent === undefined ? {} : { traceparent: payload.traceparent }),
      };

      const submitted = await deps.agent.submit(turn);
      if (Result.isError(submitted)) throw submitted.error;
    } catch (cause) {
      // The durable store records the technical error. Discord gets a stable,
      // actionable notice instead of a placeholder stuck on “starting”. If the
      // failure happened before an anchor existed, a separate enforced nonce
      // makes repeated notifications converge on one message.
      try {
        const notice =
          placeholder ??
          (await destination.send({
            content: scheduledFailureMessage(payload),
            nonce: `f:${payload.occurrenceId}`,
            enforceNonce: true,
            allowedMentions: { parse: [] },
          }));
        await notice.edit(scheduledFailureMessage(payload));
      } catch (noticeCause) {
        console.warn("could not show scheduled task remediation", noticeCause);
      }
      throw cause;
    }
  }

  if (!(await completeOccurrence(deps.redis, payload, claimToken))) {
    throw new Error("scheduled occurrence admission receipt ownership was lost");
  }
}

export function createScheduledFireHandler(deps: ScheduledFireDeps) {
  const guildId = deps.guildId ?? DISCORD_GUILD_ID;

  return {
    submit: async (payload: ScheduledFirePayload): Promise<void> => {
      const claimToken = crypto.randomUUID();
      const claim = await claimOccurrence(deps.redis, payload, claimToken);
      if (claim === "accepted") return;
      if (claim === "busy") throw new Error("scheduled occurrence is already being admitted");

      try {
        await admitOccurrence(deps, guildId, payload, claimToken);
      } catch (cause) {
        // Release only our forwarding claim. If admission was ambiguous, the
        // stable Discord nonce and AgentRouter queue identity make retry safe.
        await releaseOccurrence(deps.redis, payload.occurrenceId, claimToken).catch(
          (releaseCause: unknown) =>
            console.warn("could not release scheduled occurrence claim", releaseCause),
        );
        throw cause;
      }
    },
  };
}

export type ScheduledFireHandler = ReturnType<typeof createScheduledFireHandler>;
