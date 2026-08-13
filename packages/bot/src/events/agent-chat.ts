/**
 * Opening and closing a conversation with the agent.
 *
 * Two handlers, kept together because they are the two ends of one behaviour: a
 * mention starts a conversation, and a ✅ on the reply ends it.
 *
 * The bot's share of the work is deciding *where* the conversation lives,
 * gathering context the agent cannot see, and giving the person immediate
 * feedback that something is happening.
 */

import { RECOVERY_FOOTER, RECOVERY_TEXT } from "@repo/shared/conversations";
import { DISCORD_GUILD_ID, roleAtLeast, roleFromMemberRoles, UserRole } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import { continuationKeyFor } from "@repo/shared/wire";
import type { MessagePayload, Principal } from "@repo/shared/wire";
import { ChannelType } from "discord.js";
import type { AnyThreadChannel, Message } from "discord.js";

import { fetchLeadIn } from "../agent/lead-in.ts";
import type { TurnMessageReader } from "../agent/turn-messages.ts";
import type { ReactorLike } from "../framework/events.ts";
import { defineEvent } from "../framework/events.ts";
import { activeTraceparent } from "../framework/observability.ts";
import type { ConversationFlow } from "../utils/conversation/index.ts";
import { stripBotMention } from "../utils/mention.ts";

/** Shown until the agent's first tokens replace it. */
const PLACEHOLDER = "> Thinking...";

const DELIVERY_FAILURE_NOTICE = `${RECOVERY_TEXT}\n\n${RECOVERY_FOOTER}`;

/** Discord's cap is 100; the author's name and separator take the rest. */
const MAX_THREAD_NAME_CHARS = 54;

/** Threads close themselves after an hour of quiet. */
const THREAD_ARCHIVE_MINUTES = 60;

/** What the bot says when mentioned with nothing else. */
const EMPTY_MENTION_REPLY = "Hey! What can I help you with?";

/**
 * Identity as the bot observes it, for the agent to resolve into an access tier.
 *
 * Raw role snowflakes, never a resolved role. The bot is trusted to say *who*
 * someone is; it is deliberately not trusted to say what they may do. Roles are
 * re-read on every turn, so a follow-up from a second person in the thread is
 * evaluated as that person rather than as whoever opened it.
 */
function principalOf(message: Message): Principal {
  return {
    userId: message.author.id,
    username: message.author.username,
    nickname: message.member?.displayName ?? message.author.username,
    memberRoles: [...(message.member?.roles.cache.keys() ?? [])].filter(
      // Discord models @everyone as a role whose id is the guild id. It tells
      // us nothing and would appear on every principal.
      (roleId) => roleId !== DISCORD_GUILD_ID,
    ),
  };
}

/**
 * Identity of someone who reacted, rather than someone who posted.
 *
 * A reaction carries only a user, so guild roles have to be fetched. The lookup
 * is best-effort: failing it yields a principal with no roles, which the agent
 * resolves to the lowest access tier. Degrading to *less* access on an
 * infrastructure failure is the safe direction.
 */
async function principalOfReactor(
  user: ReactorLike,
  message: Pick<Message, "guild">,
): Promise<Principal> {
  // A partial user carries no username, so the snowflake is the only name
  // available until the member fetch below fills it in.
  const username = user.username ?? "";
  const name = username === "" ? user.id : username;
  const member = await message.guild?.members.fetch(user.id).catch(() => undefined);

  return {
    userId: user.id,
    username: name,
    nickname: member?.displayName ?? name,
    memberRoles: [...(member?.roles.cache.keys() ?? [])].filter(
      (roleId) => roleId !== DISCORD_GUILD_ID,
    ),
  };
}

/**
 * Opens a thread for the conversation, or reports that we should stay put.
 *
 * Best-effort by design: a missing Create Threads permission should downgrade
 * the experience to an in-channel conversation, not swallow the message. The
 * conversation still works, it is just noisier in the parent channel.
 */
async function openThread(
  message: Message,
  content: string,
): Promise<Message["channel"] | undefined> {
  const name =
    `${message.member?.displayName ?? message.author.username} — ${content.slice(0, MAX_THREAD_NAME_CHARS)}`.trim();

  try {
    return await message.startThread({ name, autoArchiveDuration: THREAD_ARCHIVE_MINUTES });
  } catch {
    return undefined;
  }
}

function attachmentsOf(message: Message): NonNullable<MessagePayload["attachments"]> {
  return [...message.attachments.values()].slice(0, 10).map((attachment) => ({
    url: attachment.url,
    filename: attachment.name,
    size: attachment.size,
    ...(attachment.contentType === null ? {} : { contentType: attachment.contentType }),
  }));
}

export interface AgentChatDeps {
  readonly agent: ConversationFlow;
}

export interface ConversationDoneDeps extends AgentChatDeps {
  readonly turnMessages: TurnMessageReader;
}

/**
 * A mention, or a reply to the bot inside a thread.
 *
 * Registered as `kind: "mention"`, so it runs to completion before the plain
 * `message` handlers see the same message — which is what lets those handlers
 * check `ctx.isBotMention` and stay out of the way.
 */
export function agentChat(deps: AgentChatDeps) {
  return defineEvent({
    name: "agent-chat",
    kind: "mention",
    dedupKey: (message) => message.id,
    handle: async (message, context) => {
      const prompt = stripBotMention(message.content, context.botUserId);

      // A bare mention is a greeting, not a request. Answering directly costs
      // nothing and avoids spinning up a session to say hello.
      const attachments = attachmentsOf(message);
      if (prompt === "" && attachments.length === 0) {
        await message.reply(EMPTY_MENTION_REPLY).catch(() => undefined);
        return Result.ok(undefined);
      }

      const inThread = message.channel.isThread();

      // Thread creation and the lead-in fetch are independent — they only meet
      // when the payload is assembled — so running them together saves a
      // Discord round trip on the path where someone is waiting.
      const [thread, leadIn] = await Promise.all([
        inThread ? undefined : openThread(message, prompt),
        fetchLeadIn(message),
      ]);

      const target = thread ?? message.channel;
      const targetId = target.id;
      const traceparent = activeTraceparent();

      // Posted before the agent is even reachable, because the whole point is to
      // acknowledge instantly. The bot renderer claims it as the anchor; its stable nonce also makes a
      // fallback create converge if this response was lost.
      const placeholder = await postPlaceholder(target, message.id);

      const payload: MessagePayload = {
        kind: inThread ? "followup" : "mention",
        continuationKey: continuationKeyFor({
          channelId: message.channelId,
          ...(inThread || thread !== undefined ? { threadId: targetId } : {}),
        }),
        content: prompt,
        messageId: message.id,
        ...(attachments.length === 0 ? {} : { attachments }),
        principal: principalOf(message),
        channel: channelRefOf(message),
        ...threadRefOf(message, thread),
        ...(leadIn.recentMessages.length === 0
          ? {}
          : { recentMessages: [...leadIn.recentMessages] }),
        ...(leadIn.referencedContext.length === 0
          ? {}
          : { referencedContext: [...leadIn.referencedContext] }),
        ...(placeholder === undefined ? {} : { anchorMessageId: placeholder.id }),
        ...(traceparent === undefined ? {} : { traceparent }),
      };

      const submitted = await deps.agent.submit(payload);
      if (Result.isError(submitted) && placeholder !== undefined) {
        await placeholder.edit(DELIVERY_FAILURE_NOTICE).catch(() => undefined);
      }
      return submitted;
    },
  });
}

async function postPlaceholder(
  target: Message["channel"],
  sourceMessageId: string,
): Promise<Message | undefined> {
  if (!target.isSendable()) return undefined;
  try {
    const posted = await target.send({
      content: PLACEHOLDER,
      nonce: `${sourceMessageId}:0`,
      enforceNonce: true,
      allowedMentions: { parse: [] },
    });
    return posted;
  } catch {
    return undefined;
  }
}

/**
 * Everything the channel reference can be built from: the channel a message
 * arrived in, or the parent a thread hangs off.
 */
type NameableChannel = Message["channel"] | NonNullable<AnyThreadChannel["parent"]>;

/**
 * A channel's name, as a plain string.
 *
 * discord.js types a name as nullable and omits it entirely on DM channels, and
 * the wire schema requires a non-empty string. Everything unnameable collapses
 * to one placeholder here so no caller has to re-derive the same three checks.
 */
function nameOf(channel: NameableChannel): string {
  const name = ("name" in channel ? channel.name : undefined) ?? "";
  return name === "" ? "unknown" : name;
}

/** A channel's category, or undefined when it has none or cannot have one. */
function categoryOf(channel: NameableChannel): string | undefined {
  const parentId = "parentId" in channel ? channel.parentId : undefined;
  return parentId ?? undefined;
}

function channelRefOf(message: Message): MessagePayload["channel"] {
  const channel = message.channel;
  // A thread's parent is the channel the conversation belongs to; for a
  // top-level message it is the channel itself. `?? undefined` because
  // discord.js reports a parent it cannot resolve as null.
  const source = channel.isThread() ? (channel.parent ?? undefined) : channel;
  if (source === undefined) return { id: message.channelId, name: "unknown" };

  const categoryId = categoryOf(source);
  return {
    id: source.id,
    name: nameOf(source),
    ...(categoryId === undefined ? {} : { categoryId }),
  };
}

function threadRefOf(
  message: Message,
  created: Message["channel"] | undefined,
): { thread?: MessagePayload["thread"] } {
  const channel = message.channel;

  if (channel.isThread()) {
    const parent = channel.parent ?? undefined;
    // A thread whose parent cannot be resolved still works as a conversation —
    // the continuation key is the thread id — so the reference is simply omitted
    // rather than treated as an error.
    if (parent === undefined) return {};
    return { thread: { id: channel.id, parentId: parent.id, parentName: nameOf(parent) } };
  }

  if (created === undefined || created.type === ChannelType.DM) return {};
  return {
    thread: { id: created.id, parentId: message.channelId, parentName: nameOf(channel) },
  };
}

interface ConversationResetInput {
  readonly continuationKey: string;
  readonly requesterUserId: string;
  readonly principal: Principal;
}

/** The authorization decision, kept independent of how the principal was fetched. */
async function resetConversationForPrincipal(
  agent: Pick<ConversationFlow, "reset">,
  input: ConversationResetInput,
) {
  if (
    input.principal.userId !== input.requesterUserId &&
    !roleAtLeast(roleFromMemberRoles(input.principal.memberRoles), UserRole.Organizer)
  ) {
    return Result.ok(undefined);
  }
  return agent.reset({
    continuationKey: input.continuationKey,
    reason: `ended by ${input.principal.username} with ✅`,
    principal: input.principal,
  });
}

/**
 * ✅ on one of the bot's replies ends the conversation early.
 *
 * Restricted to bot-authored messages so a ✅ on someone's *question* in the
 * thread does not kill the conversation they are having. The bot also adds ✅
 * itself — on hack-night uploads — so its own reactions are ignored too.
 *
 * The prior implementation had to distinguish "workflow resumed" from "workflow
 * already expired" and clean up a stale Redis key in the second case. Retiring a
 * session that has already ended is a no-op in eve, so there is nothing to
 * reconcile.
 */
export function conversationDone(deps: ConversationDoneDeps) {
  return defineEvent({
    name: "conversation-done",
    kind: "reactionAdd",
    dedupKey: ({ reaction, user }) =>
      `${reaction.message.id}:${user.id}:${reaction.emoji.id ?? reaction.emoji.name ?? "unknown"}`,
    handle: async ({ reaction, user }, context) => {
      if (reaction.emoji.name !== "✅") return Result.ok(undefined);
      if (user.id === context.botUserId) return Result.ok(undefined);

      // The renderer index is the sole proof this is an agent reply. This works
      // for partials and prevents ✅ on unrelated bot output from resetting Eve.
      const turn = await deps.turnMessages.get(reaction.message.id);
      if (turn === undefined) return Result.ok(undefined);

      // The principal is whoever reacted, not the bot-authored message. Only
      // the original requester or a freshly resolved organizer may reset it.
      const principal = await principalOfReactor(user, reaction.message);
      return resetConversationForPrincipal(deps.agent, {
        continuationKey: reaction.message.channelId,
        requesterUserId: turn.requesterUserId,
        principal,
      });
    },
  });
}
