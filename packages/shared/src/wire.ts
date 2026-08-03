/**
 * The bot↔agent wire contract.
 *
 * This is the seam. The bot listens to the Discord gateway and forwards work
 * here; the agent owns durability, reasoning, and all rendering of agent output.
 * Both sides import these schemas, so the contract cannot drift silently.
 *
 * Three properties are deliberate:
 *
 * 1. **The bot asserts identity, it does not resolve policy.** It sends raw
 *    Discord role snowflakes in `principal.memberRoles`; the agent maps those to
 *    an access tier. Every capability gate then hangs off one place. If the bot
 *    sent a pre-resolved role, two components would own permissions.
 *
 * 2. **`continuationKey` is `threadId ?? channelId`.** It is the address of a
 *    durable agent session, and matches the legacy `conversation:<threadId |
 *    channelId>` Redis key so an in-flight conversation maps across. Thread
 *    first, so parallel threads in one channel do not collide.
 *
 * 3. **Requests are validated, never trusted.** `decodeX` returns a
 *    `Result<T, InvalidInput>` listing every failing path, so a malformed
 *    payload is a typed rejection rather than a runtime surprise deep inside a
 *    turn. A payload that passes transport but fails schema is an
 *    `InvariantViolated` on the *sending* side — it means our own components
 *    disagree.
 *
 * Note that a `Result` is never itself serialized across this boundary.
 * better-result's `hydrate` could rebuild one, but an `Err` carrying an `Error`
 * loses its message to `JSON.stringify` (Error fields are non-enumerable), and
 * an explicit response union is clearer than a rehydrated class. See
 * `WireResponse`.
 */

import { z } from "zod";

import { InvalidInput } from "./errors.ts";
import { Result } from "./result/index.ts";

/** Discord snowflakes are numeric strings; bounds keep obvious junk out. */
const snowflake = z.string().regex(/^\d{17,20}$/, "expected a Discord snowflake");

/** Discord's own ceiling is 4000 characters for a message. */
const MAX_CONTENT_CHARS = 4_000;
/** Lead-in context the agent pins on the first turn only. */
const MAX_LEADIN_MESSAGES = 20;
const MAX_ATTACHMENTS = 10;

export const principalSchema = z.object({
  userId: snowflake,
  username: z.string().min(1).max(64),
  /** Guild display name, which is what the agent should address the user by. */
  nickname: z.string().min(1).max(64),
  /**
   * Raw role snowflakes, resolved to an access tier by the agent. Re-sent on
   * every turn rather than cached: a follow-up from a different person must be
   * evaluated with their roles, not the conversation opener's.
   */
  memberRoles: z.array(snowflake).max(64),
});

export const channelRefSchema = z.object({
  id: snowflake,
  name: z.string().min(1).max(128),
  /** Used to suppress dashboard mirroring for internal categories. */
  categoryId: snowflake.optional(),
});

export const threadRefSchema = z.object({
  id: snowflake,
  parentId: snowflake,
  parentName: z.string().min(1).max(128),
});

export const attachmentSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1).max(256),
  contentType: z.string().min(1).max(128).optional(),
  size: z.number().int().nonnegative(),
});

/**
 * A user turn. `mention` opens or reopens a conversation and carries the lead-in
 * context; `followup` continues one that is already live.
 */
export const messagePayloadSchema = z.object({
  kind: z.enum(["mention", "followup"]),
  continuationKey: snowflake,
  /** The bot has already stripped its own leading mention. */
  content: z.string().max(MAX_CONTENT_CHARS),
  messageId: snowflake,
  principal: principalSchema,
  channel: channelRefSchema,
  thread: threadRefSchema.optional(),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
  /**
   * Recent channel or thread messages, first turn only. The agent pins these
   * for the life of the session so the rendered prompt stays byte-stable and
   * prompt caching keeps working.
   */
  recentMessages: z.array(z.string()).max(MAX_LEADIN_MESSAGES).optional(),
  /** Reply anchor plus its preceding messages, when the turn is a reply. */
  referencedContext: z.array(z.string()).max(MAX_LEADIN_MESSAGES).optional(),
  /**
   * A placeholder message the bot already posted. The agent's paint layer
   * claims it as the anchor to edit, so the user sees a response before the
   * agent has produced one.
   */
  anchorMessageId: snowflake.optional(),
  /** W3C traceparent, so the agent's spans join the bot's trace. */
  traceparent: z.string().max(256).optional(),
});

/**
 * A reaction with meaning. `done` ends a conversation gracefully instead of
 * waiting out a timeout; `feedback` records sentiment against a turn.
 */
export const reactionPayloadSchema = z.object({
  intent: z.enum(["done", "feedback"]),
  continuationKey: snowflake,
  /** The bot message reacted to, which identifies the turn being judged. */
  messageId: snowflake,
  emoji: z.string().min(1).max(64),
  principal: principalSchema,
  traceparent: z.string().max(256).optional(),
});

/**
 * A component click resolving a pending human-in-the-loop request.
 *
 * `principal` is the person who clicked, which is not necessarily the person who
 * asked. That distinction is the whole point for second-party approval, where
 * the clicker must be an organizer *other than* the requester.
 */
export const interactionPayloadSchema = z.object({
  continuationKey: snowflake,
  requestId: z.string().min(1).max(128),
  decision: z.enum(["approve", "deny"]),
  /** Set when the request offered choices rather than approve/deny. */
  optionId: z.string().min(1).max(128).optional(),
  /** Set when the request allowed free text. */
  freeform: z.string().max(MAX_CONTENT_CHARS).optional(),
  principal: principalSchema,
  traceparent: z.string().max(256).optional(),
});

/** Retires the session so the next message starts fresh. */
export const resetPayloadSchema = z.object({
  continuationKey: snowflake,
  reason: z.string().min(1).max(256),
  principal: principalSchema,
});

/**
 * Agent → bot. The only callback in the system, and it carries no rendering:
 * it tells the bot a session has parked so the next queued message for that
 * key can be released.
 *
 * eve does not maintain a durable FIFO queue per session — `continuationToken`
 * is a resume handle, not a mailbox — so ordering is the bot's job. Without
 * this signal the bot cannot know when it is safe to send the next turn.
 */
export const parkedPayloadSchema = z.object({
  continuationKey: snowflake,
  sessionId: z.string().min(1).max(128),
});

export type Principal = z.infer<typeof principalSchema>;
export type ChannelRef = z.infer<typeof channelRefSchema>;
export type ThreadRef = z.infer<typeof threadRefSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type MessagePayload = z.infer<typeof messagePayloadSchema>;
export type ReactionPayload = z.infer<typeof reactionPayloadSchema>;
export type InteractionPayload = z.infer<typeof interactionPayloadSchema>;
export type ResetPayload = z.infer<typeof resetPayloadSchema>;
export type ParkedPayload = z.infer<typeof parkedPayloadSchema>;

/**
 * What the agent answers with. A discriminated union rather than a serialized
 * `Result`, so the failure branch keeps a readable tag and message.
 */
export type WireResponse =
  | { readonly ok: true; readonly sessionId: string; readonly continuationToken: string }
  | { readonly ok: false; readonly tag: string; readonly message: string };

/** Every route on the agent's custom Discord channel. */
export const WIRE_ROUTES = {
  message: "/eve/v1/discord/message",
  reaction: "/eve/v1/discord/reaction",
  interaction: "/eve/v1/discord/interaction",
  reset: "/eve/v1/discord/reset",
} as const;

/** The bot's own internal route, called only by the agent. */
export const BOT_ROUTES = {
  parked: "/internal/agent/parked",
  health: "/health",
} as const;

function decode<T>(schema: z.ZodType<T>, subject: string, input: unknown): Result<T, InvalidInput> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return Result.ok(parsed.data);

  // Every failing path, not just the first — a caller fixing a payload should
  // not have to round-trip once per field.
  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path === "" ? issue.message : `${path}: ${issue.message}`;
  });
  return Result.err(new InvalidInput({ subject, issues }));
}

export function decodeMessagePayload(input: unknown): Result<MessagePayload, InvalidInput> {
  return decode(messagePayloadSchema, "message payload", input);
}

export function decodeReactionPayload(input: unknown): Result<ReactionPayload, InvalidInput> {
  return decode(reactionPayloadSchema, "reaction payload", input);
}

export function decodeInteractionPayload(input: unknown): Result<InteractionPayload, InvalidInput> {
  return decode(interactionPayloadSchema, "interaction payload", input);
}

export function decodeResetPayload(input: unknown): Result<ResetPayload, InvalidInput> {
  return decode(resetPayloadSchema, "reset payload", input);
}

export function decodeParkedPayload(input: unknown): Result<ParkedPayload, InvalidInput> {
  return decode(parkedPayloadSchema, "parked payload", input);
}

/**
 * The session address for a turn. Thread first so two threads in one channel do
 * not share a conversation; matches the legacy ConversationStore key exactly.
 */
export function continuationKeyFor(input: {
  readonly channelId: string;
  readonly threadId?: string;
}): string {
  return input.threadId ?? input.channelId;
}
