/**
 * The bot↔agent wire contract.
 *
 * This is the seam. The bot listens to the Discord gateway and forwards work
 * here; the agent owns durability, reasoning, and semantic desired state while
 * the bot alone materializes Discord output. Both sides import these schemas, so
 * the contract cannot drift silently.
 *
 * Three properties are deliberate:
 *
 * 1. **The bot asserts identity, it does not resolve policy.** It sends raw
 *    Discord role snowflakes in `principal.memberRoles`; the agent maps those to
 *    an access tier. Every capability gate then hangs off one place. If the bot
 *    sent a pre-resolved role, two components would own permissions.
 *
 * 2. **`continuationKey` is `threadId ?? channelId`.** It is the address of a
 *    durable agent session. Thread first, so parallel threads in one channel do
 *    not collide.
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

import { ConfirmMode, ScheduleActionType } from "./db/enums.ts";
import { UserRole } from "./discord/roles.ts";
import { InvalidInput } from "./errors.ts";
import { discordSnowflake as snowflake, shortId, traceparent } from "./formats.ts";
import { Result } from "./result/index.ts";

/** Discord's own ceiling is 4000 characters for a user message. */
const MAX_CONTENT_CHARS = 4_000;
/** A scheduled prompt is application-owned and never came from a Discord message. */
const MAX_SCHEDULE_CONTENT_CHARS = 9_000;
/** Lead-in context the agent pins on the first turn only. */
const MAX_LEADIN_MESSAGES = 20;
const MAX_ATTACHMENTS = 10;

const principalSchema = z.strictObject({
  userId: snowflake,
  username: z.string().trim().min(1).max(64),
  /** Guild display name, which is what the agent should address the user by. */
  nickname: z.string().trim().min(1).max(64),
  /**
   * Raw role snowflakes, resolved to an access tier by the agent. Re-sent on
   * every turn rather than cached: a follow-up from a different person must be
   * evaluated with their roles, not the conversation opener's.
   */
  memberRoles: z.array(snowflake).max(64),
});

const channelRefSchema = z.strictObject({
  id: snowflake,
  name: z.string().trim().min(1).max(128),
  /** Used to suppress dashboard mirroring for internal categories. */
  categoryId: snowflake.optional(),
});

const threadRefSchema = z.strictObject({
  id: snowflake,
  parentId: snowflake,
  parentName: z.string().trim().min(1).max(128),
});

const attachmentSchema = z.strictObject({
  url: z.url(),
  filename: z.string().trim().min(1).max(256),
  contentType: z.string().trim().min(1).max(128).optional(),
  size: z.int().nonnegative(),
});

/**
 * A Discord turn. `mention` opens with user lead-in, `followup` continues a live
 * conversation, and `scheduled` is a bot-materialized proactive occurrence.
 */
const messagePayloadSchema = z
  .strictObject({
    kind: z.enum(["mention", "followup", "scheduled"]),
    scheduleId: z.uuid().optional(),
    occurrenceId: shortId.optional(),
    continuationKey: snowflake,
    /** The bot has already stripped its own leading mention. */
    content: z.string().max(MAX_SCHEDULE_CONTENT_CHARS),
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
    /** Originating span retained when Redis recovery performs delivery later. */
    traceparent: traceparent.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== "scheduled" && value.content.length > MAX_CONTENT_CHARS) {
      ctx.addIssue({
        code: "too_big",
        maximum: MAX_CONTENT_CHARS,
        origin: "string",
        inclusive: true,
        message: `user message content must be at most ${MAX_CONTENT_CHARS} characters`,
        path: ["content"],
      });
    }
    const hasScheduleId = value.scheduleId !== undefined;
    const hasOccurrenceId = value.occurrenceId !== undefined;
    if (
      (value.kind === "scheduled" && (!hasScheduleId || !hasOccurrenceId)) ||
      (value.kind !== "scheduled" && (hasScheduleId || hasOccurrenceId))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "scheduled turns require scheduleId and occurrenceId; other turns forbid them",
        path: ["kind"],
      });
    }
  });

/** Bot-assigned idempotency/fencing epoch for one queue delivery. */
const deliveryPayloadSchema = messagePayloadSchema.extend({
  dispatchId: z.uuid(),
});

const renderInputOptionSchema = z.strictObject({
  /** Opaque: it round-trips through a Discord component id, so it is not trimmed. */
  id: z.string().min(1).max(512),
  label: z.string().trim().min(1).max(256),
  description: z.string().max(1_000).optional(),
  style: z.enum(["primary", "danger", "default"]).optional(),
});

/** Safe, presentation-only projection of one Eve HITL request. */
const renderInputRequestSchema = z
  .strictObject({
    /** Opaque: the bot matches it byte-for-byte against the pending request. */
    requestId: z.string().min(1).max(512),
    recipientUserId: snowflake,
    prompt: z.string().trim().min(1).max(2_000),
    kind: z.enum(["question", "session-limit", "tool-approval"]),
    display: z.enum(["confirmation", "select", "text"]).optional(),
    allowFreeform: z.boolean().optional(),
    toolName: z.string().trim().min(1).max(256).optional(),
    inputPreview: z.string().trim().min(1).max(2_000).optional(),
    options: z.array(renderInputOptionSchema).max(100).optional(),
    /**
     * Trusted projection of the policy record; never sourced from a component
     * id. Both come from the storage enums so a tier cannot drift out of the
     * set the policy engine actually persists.
     */
    approvalMode: z.enum(ConfirmMode).exclude(["None"]).optional(),
    approverMinRole: z.enum(UserRole).exclude(["Public"]).optional(),
  })
  .superRefine((request, ctx) => {
    if (request.approvalMode !== undefined && request.kind !== "tool-approval") {
      ctx.addIssue({
        code: "custom",
        path: ["approvalMode"],
        message: "approval policy is only valid for tool approval",
      });
    }
    if ((request.approvalMode === "second-party") !== (request.approverMinRole !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["approverMinRole"],
        message: "second-party approval requires exactly one minimum approver role",
      });
    }
  });

/** Link-free public authorization affordance stored with render intent. */
const renderAuthorizationSchema = z.strictObject({
  id: shortId,
  name: z.string().trim().min(1).max(128),
  recipientUserId: snowflake,
  displayName: z.string().trim().min(1).max(128).optional(),
});

/**
 * `abort` matters here: without it a value that is not a URL at all still
 * reaches the refinement, where `new URL` throws rather than failing the parse.
 */
const privateAuthorizationUrl = z
  .url({ protocol: /^https$/u, abort: true })
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return url.username === "" && url.password === "";
  }, "expected an HTTPS URL without embedded credentials");

/** Short-lived private connection challenge, never materialized in public paint. */
const authorizationChallengeSchema = z.strictObject({
  description: z.string().max(1_000),
  url: privateAuthorizationUrl.optional(),
  userCode: z.string().trim().min(1).max(128).optional(),
  /** Provider-supplied and only ever `Date.parse`d, so not narrowed to ISO 8601. */
  expiresAt: z.string().trim().min(1).max(64).optional(),
  instructions: z.string().max(1_000).optional(),
});

/**
 * A component or modal submission resolving one pending human-input request.
 * The bot has already validated the current render revision and intended user.
 */
const interactionPayloadSchema = z
  .strictObject({
    continuationKey: snowflake,
    interactionId: snowflake,
    dispatchId: z.uuid(),
    renderRevision: z.int().positive(),
    requestId: z.string().min(1).max(512),
    /** Immutable policy target recovered by the bot from the Redis render target. */
    authChannelId: snowflake,
    authThreadId: snowflake.optional(),
    /** Opaque: it must equal the option id the render intent published. */
    optionId: z.string().min(1).max(512).optional(),
    freeform: z.string().trim().min(1).max(MAX_CONTENT_CHARS).optional(),
    principal: principalSchema,
    /** Current requester roles re-fetched by the bot for a second-party decision. */
    approvalRequester: z
      .strictObject({ userId: snowflake, memberRoles: z.array(snowflake).max(64) })
      .optional(),
    traceparent: traceparent.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.optionId === undefined) === (value.freeform === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["optionId"],
        message: "exactly one option or freeform response is required",
      });
    }
    if (
      value.approvalRequester !== undefined &&
      value.approvalRequester.userId === value.principal.userId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["approvalRequester", "userId"],
        message: "second-party approver must differ from requester",
      });
    }
  });

/** Retires the session so the next message starts fresh. */
const resetPayloadSchema = z.strictObject({
  continuationKey: snowflake,
  reason: z.string().trim().min(1).max(256),
  principal: principalSchema,
});

/** Bot-internal reset request after a durable queue cutover has been installed. */
/**
 * Bot → agent: someone typed while a turn was running.
 *
 * Carries no content. The message itself is already durable in the pending
 * queue; this only asks the agent to stop what it is doing so that queue can
 * move. Steering used to ride on the delivery itself, which meant it could only
 * happen after `claim` handed the delivery over — and `claim` refuses while a
 * turn holds the conversation, so it never fired in the one situation it exists
 * for.
 */
const steerRequestPayloadSchema = z.strictObject({
  continuationKey: snowflake,
});

const resetRequestPayloadSchema = z.strictObject({
  ...resetPayloadSchema.shape,
  resetId: z.uuid(),
});

/**
 * Agent → bot durable queue boundary. It carries no render body: the bot first
 * converges the matching Redis render intent, then releases the next turn.
 *
 * eve does not maintain a durable FIFO queue per session — `continuationToken`
 * is a resume handle, not a mailbox — so ordering is the bot's job. Without
 * this signal the bot cannot know when it is safe to send the next turn.
 */
const parkedPayloadSchema = z.strictObject({
  continuationKey: snowflake,
  /** Opaque Eve handles, compared for equality by the Redis transitions. */
  sessionId: z.string().min(1).max(128),
  /** Discord user message for the exact turn that parked. */
  messageId: snowflake,
  /** Exact queue delivery epoch; protects even when a message is retried. */
  dispatchId: z.uuid(),
  /** Eve turn that emitted the waiting boundary. */
  eveTurnId: z.string().min(1).max(128),
});

/** Immutable bot-authored Discord target for a queued delivery. */
const renderTargetSchema = z.strictObject({
  dispatchId: z.uuid(),
  continuationKey: snowflake,
  messageId: snowflake,
  channelId: snowflake,
  /** Parent/thread pair used for Eve auth refresh after a HITL response. */
  authChannelId: snowflake,
  authThreadId: snowflake.optional(),
  requesterUserId: snowflake,
  anchorMessageId: snowflake.optional(),
  replyToMessageId: snowflake.optional(),
});

/** Latest desired Discord presentation for one delivery. */
const renderIntentSchema = z.strictObject({
  dispatchId: z.uuid(),
  continuationKey: snowflake,
  messageId: snowflake,
  sessionId: z.string().min(1).max(128),
  eveTurnId: z.string().min(1).max(128),
  revision: z.int().positive(),
  phase: z.enum(["streaming", "completed", "failed"]),
  text: z.string().max(12_000),
  activity: z.string().max(1_000),
  footer: z.string().max(2_000).optional(),
  /** Eve span that authored this desired state, retained through Redis recovery. */
  traceparent: traceparent.optional(),
  /**
   * When the agent authored this desired state, ISO-8601.
   *
   * Redis holds no time anywhere in the render path, so a stuck or truncated
   * render could not be lined up against anything — not the workflow streams,
   * not the trace, not the Discord message. `traceparent` gives the trace and
   * this gives the moment, which together are what a post-mortem starts from.
   */
  authoredAt: z.iso.datetime().optional(),
  inputRequests: z.array(renderInputRequestSchema).max(1).optional(),
  authorizations: z.array(renderAuthorizationSchema).max(5).optional(),
});

/** Agent → bot low-latency wakeup. Redis remains the durable source of truth. */
const renderWakePayloadSchema = z.strictObject({
  dispatchId: z.uuid(),
});

/** Agent-owned desired state for one stable scheduled occurrence. */
const scheduledFirePayloadSchema = z.strictObject({
  scheduleId: z.uuid(),
  occurrenceId: shortId,
  ownerId: snowflake,
  channelId: snowflake,
  description: z.string().trim().min(1).max(256),
  actionType: z.enum(ScheduleActionType),
  prompt: z.string().trim().min(1).max(8_000),
  /** Creation snapshot; used only when current Discord roles cannot be fetched. */
  memberRoles: z.array(snowflake).max(64).optional(),
  /** Originating schedule span, retained if bot admission retries later. */
  traceparent: traceparent.optional(),
  /** One-based delivery attempt, used only for accurate user-visible remediation. */
  attemptNumber: z.int().min(1).max(100),
  /** True when another automatic retry will not be scheduled after this attempt. */
  finalAttempt: z.boolean(),
  scheduledFor: z.iso.datetime({ offset: true }),
});

export type Principal = z.output<typeof principalSchema>;
export type ChannelRef = z.output<typeof channelRefSchema>;
export type ThreadRef = z.output<typeof threadRefSchema>;
export type MessagePayload = z.output<typeof messagePayloadSchema>;
export type DeliveryPayload = z.output<typeof deliveryPayloadSchema>;
export type InteractionPayload = z.output<typeof interactionPayloadSchema>;
export type RenderInputOption = z.output<typeof renderInputOptionSchema>;
export type RenderInputRequest = z.output<typeof renderInputRequestSchema>;
export type RenderAuthorization = z.output<typeof renderAuthorizationSchema>;
export type AuthorizationChallenge = z.output<typeof authorizationChallengeSchema>;
export type ResetPayload = z.output<typeof resetPayloadSchema>;
export type ResetRequestPayload = z.output<typeof resetRequestPayloadSchema>;
export type SteerRequestPayload = z.output<typeof steerRequestPayloadSchema>;
export type ParkedPayload = z.output<typeof parkedPayloadSchema>;
export type RenderTarget = z.output<typeof renderTargetSchema>;
export type RenderIntent = z.output<typeof renderIntentSchema>;
type RenderWakePayload = z.output<typeof renderWakePayloadSchema>;
export type ScheduledFirePayload = z.output<typeof scheduledFirePayloadSchema>;

/**
 * What the agent answers with. A discriminated union rather than a serialized
 * `Result`, so the failure branch keeps a readable tag and message.
 *
 * The schema lives here with the type derived from it, so the bot's decoder and
 * the agent's producer cannot restate the contract differently.
 *
 * Deliberately not `strictObject`, unlike the payload schemas above. Those are
 * durable records the writer and reader agree on before either is deployed;
 * this is a live response read by whatever bot generation happens to be running
 * when the agent deploys. An additive field on the acknowledgement must not
 * make every older bot treat a successful turn as a contract violation.
 */
export const wireResponseSchema = z
  .discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      sessionId: z.string().min(1),
      continuationToken: z.string().min(1),
    }),
    z.object({ ok: z.literal(false), tag: z.string(), message: z.string() }),
  ])
  .readonly();

export type WireResponse = z.output<typeof wireResponseSchema>;

/**
 * Every route on the agent's custom Discord channel.
 *
 * Mounted exactly as the channel declares them, with no prefix. The `/eve/v1`
 * namespace seen elsewhere is not a framework-wide mount point — eve's built-in
 * channel simply writes that prefix into its own route paths, and a custom
 * channel gets whatever it asks for.
 */
export const WIRE_ROUTES = {
  message: "/discord/message",
  interaction: "/discord/interaction",
  reset: "/discord/reset",
  steer: "/discord/steer",
} as const;

/** The bot's own internal route, called only by the agent. */
export const BOT_ROUTES = {
  parked: "/internal/agent/parked",
  render: "/internal/agent/render",
  scheduled: "/internal/agent/scheduled",
  health: "/health",
} as const;

function decode<S extends z.ZodType>(
  schema: S,
  subject: string,
  input: unknown,
): Result<z.output<S>, InvalidInput> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return Result.ok(parsed.data);

  // Every failing path, not just the first — a caller fixing a payload should
  // not have to round-trip once per field.
  const issues = parsed.error.issues.map((failure) => {
    const path = failure.path.join(".");
    return path === "" ? failure.message : `${path}: ${failure.message}`;
  });
  return Result.err(new InvalidInput({ subject, issues }));
}

export function decodeDeliveryPayload(input: unknown): Result<DeliveryPayload, InvalidInput> {
  return decode(deliveryPayloadSchema, "delivery payload", input);
}

export function decodeInteractionPayload(input: unknown): Result<InteractionPayload, InvalidInput> {
  return decode(interactionPayloadSchema, "interaction payload", input);
}

export function decodeResetRequestPayload(
  input: unknown,
): Result<ResetRequestPayload, InvalidInput> {
  return decode(resetRequestPayloadSchema, "reset request payload", input);
}

export function decodeSteerRequestPayload(
  input: unknown,
): Result<SteerRequestPayload, InvalidInput> {
  return decode(steerRequestPayloadSchema, "steer request payload", input);
}

export function decodeParkedPayload(input: unknown): Result<ParkedPayload, InvalidInput> {
  return decode(parkedPayloadSchema, "parked payload", input);
}

export function decodeAuthorizationChallenge(
  input: unknown,
): Result<AuthorizationChallenge, InvalidInput> {
  return decode(authorizationChallengeSchema, "authorization challenge", input);
}

export function decodeRenderTarget(input: unknown): Result<RenderTarget, InvalidInput> {
  return decode(renderTargetSchema, "render target", input);
}

export function decodeRenderIntent(input: unknown): Result<RenderIntent, InvalidInput> {
  return decode(renderIntentSchema, "render intent", input);
}

export function decodeRenderWakePayload(input: unknown): Result<RenderWakePayload, InvalidInput> {
  return decode(renderWakePayloadSchema, "render wake payload", input);
}

export function decodeScheduledFirePayload(
  input: unknown,
): Result<ScheduledFirePayload, InvalidInput> {
  return decode(scheduledFirePayloadSchema, "scheduled fire payload", input);
}

/**
 * The session address for a turn. Thread first so two threads in one channel do
 * not share a conversation.
 */
export function continuationKeyFor(input: {
  readonly channelId: string;
  readonly threadId?: string;
}): string {
  return input.threadId ?? input.channelId;
}
