/**
 * The seam: the bot's gateway on one side, a durable agent session on the other.
 *
 * A custom channel rather than eve's built-in Discord one, for two reasons. The
 * built-in channel speaks HTTP Interactions, which cannot see the message events
 * a gateway bot exists to handle. Rendering also remains a repo decision: this
 * adapter publishes semantic desired state and the bot materializes it.
 *
 * Three things this file owns:
 *
 * 1. **Trust.** The bot authenticates with a shared bearer and then *asserts* who
 *    the Discord user is. That assertion becomes `SessionAuthContext`, and every
 *    downstream capability gate — which subagents exist, which tools are visible,
 *    which skills appear — reads from it. Getting the attributes right here is
 *    what makes the permission model work at all.
 * 2. **Addressing.** The channel-local address is the Discord thread or channel
 *    id, so a conversation maps to a durable session with nothing else to look
 *    up. `continuationKey` on the wire is that address; it reaches Eve through
 *    `from(address)` and `resolveSession(address)`.
 * 3. **Delivery.** The `events` map drives durable, coalesced render intent.
 */

import { createHash } from "node:crypto";

import { bearerMatches } from "@repo/shared/bearer";
import { createConversationStore } from "@repo/shared/conversations";
import { RecoveryRequired, serializeError, Transient } from "@repo/shared/errors";
import { getRedis } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { sliceText } from "@repo/shared/text";
import {
  BOT_ROUTES,
  decodeDeliveryPayload,
  decodeInteractionPayload,
  decodeResetRequestPayload,
  decodeSteerRequestPayload,
  WIRE_ROUTES,
} from "@repo/shared/wire";
import type { DeliveryPayload, ParkedPayload, RenderIntent, WireResponse } from "@repo/shared/wire";
import * as Sentry from "@sentry/node";
import type { UserContent } from "ai";
import { defineChannel, POST, type Session } from "eve/channels";
import { createUnauthorizedResponse } from "eve/channels/auth";
import type { SessionContext } from "eve/context";
import { z } from "zod";

import { env } from "../env.ts";
import { resolveBotBaseUrl } from "../lib/bot/endpoint.ts";
import { authFor } from "../lib/discord/auth.ts";
import { applyInputRequests } from "../lib/discord/input-requests.ts";
import { createRenderPublisher, renderFooter } from "../lib/discord/render-intent.ts";
import {
  appendStreamingMessage,
  beginDiscordTurn,
  completeStreamingMessage,
  initialDiscordState,
  isWaitingForHuman,
  stateForMessage,
} from "../lib/discord/state.ts";
import type { DiscordChannelState } from "../lib/discord/state.ts";
import { ApprovalPolicyStore } from "../lib/policy/approval-record.ts";
import { discordSnowflake, storedInt, storedJson } from "../lib/schema.ts";
import { currentTraceparent, traceHeaders, turnTokenKey } from "../lib/telemetry.ts";

const redis = getRedis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});
const conversations = createConversationStore({ redis });

/**
 * Cancels a turn that a newly arrived message supersedes.
 *
 * Someone who types while the agent is working is correcting it, not waiting in
 * line behind it. Cancelling the live turn lets the replacement act on the
 * correction; without this the agent finishes researching the wrong thing and
 * answers the question that was already withdrawn.
 *
 * A session parked on an input request is left alone: its turn is suspended
 * rather than working, and cancelling it would kill the request the person is
 * being asked to answer. `cancel` reports `no_active_turn` on its own when
 * nothing is running, so the only case worth checking here is the parked one.
 */
async function steerActiveTurn(
  active: Session | undefined,
  continuationKey: string,
): Promise<void> {
  if (active === undefined) return;
  const parked = await conversations.queue.parked(continuationKey);
  if (Result.isError(parked) || parked.value !== undefined) return;
  const cancelled = await active.cancel();
  if (cancelled.status !== "accepted") return;
  console.info(
    JSON.stringify({ event: "discord.turn.steered", continuationKey, sessionId: active.id }),
  );
}

const renderPublisher = createRenderPublisher({
  store: conversations.renderPublication,
  botUrl: () => resolveBotBaseUrl(redis, env.BOT_URL),
  botSecret: env.BOT_INGRESS_SECRET,
});
const approvalPolicyStore = new ApprovalPolicyStore(redis);

const RESET_DRAIN_TIMEOUT_MS = 8_000;

async function waitForResetCutover(
  continuationKey: string,
  resetId: string,
): Promise<"ready" | "stale" | "busy"> {
  const deadline = Date.now() + RESET_DRAIN_TIMEOUT_MS;
  do {
    const status = await conversations.resetCutoverStatus(continuationKey, resetId);
    if (status !== "busy") return status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  return "busy";
}

/** The bot's bearer, compared in constant time by the shared helper. */
function botAuthenticated(request: Request): boolean {
  return bearerMatches(request.headers.get("authorization") ?? undefined, env.AGENT_INGRESS_SECRET);
}

/**
 * Turns the bot's assertion into the caller identity the agent runs as.
 *
 * `principalType: "user"` matters beyond permissions: user-scoped Vercel Connect
 * OAuth refuses to start without a user principal, so a session created any
 * other way could never authorize an integration on someone's behalf.
 *
 * The role is derived here rather than trusted from the wire. The bot sends raw
 * role snowflakes; a bot that could name its own access tier would make the
 * permission model advisory.
 */
function ok(sessionId: string, continuationToken: string): Response {
  const body: WireResponse = { ok: true, sessionId, continuationToken };
  return Response.json(body);
}

function failed(error: Error, status = 400): Response {
  const { tag, message } = serializeError(error);
  const body: WireResponse = { ok: false, tag, message };
  return Response.json(body, { status });
}

/**
 * The fields `conversations.interactions.accept` writes that an accepted retry
 * replays. Redis hands the receipt back either already deserialized or as the
 * raw JSON text it stored, so `storedJson` accepts both.
 */
const acceptedReceiptSchema = storedJson(
  z.object({ sessionId: z.string(), continuationToken: z.string() }),
);

async function acceptedInteractionResponse(interactionId: string): Promise<Response> {
  const receipt = acceptedReceiptSchema.safeParse(
    await conversations.interactions.read(interactionId),
  );
  if (!receipt.success) {
    return failed(new Error("accepted interaction receipt is malformed"), 500);
  }
  return ok(receipt.data.sessionId, receipt.data.continuationToken);
}

/** What `context` builds, and therefore what the `channel` argument carries. */
interface DiscordChannelContext {
  state: DiscordChannelState;
}

const RENDER_PUBLISH_INTERVAL_MS = 1_500;
const LIVE_TEXT_CHARS = 4_000;
const FINAL_TEXT_CHARS = 12_000;

function currentUserId(ctx: Pick<SessionContext, "session">): string | undefined {
  return discordSnowflake.safeParse(ctx.session.auth.current?.principalId).data;
}

/**
 * `abort: true` matters: without it the credential refinement below still runs
 * on a string the URL check already rejected, and `new URL` throws there.
 * `normalize: true` supplies the normalized href the caller used to build by
 * hand with `url.toString()`.
 */
const authorizationUrlSchema = z
  .url({ protocol: /^https$/u, normalize: true, abort: true })
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return url.username === "" && url.password === "";
  }, "expected an HTTPS URL without embedded credentials");

function safeAuthorizationUrl(value: string | undefined): string | undefined {
  return authorizationUrlSchema.safeParse(value).data;
}

function safeExpiration(value: string | undefined): string | undefined {
  return value !== undefined && value.length <= 64 && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

function authorizationId(turnId: string, stepIndex: number, name: string): string {
  return createHash("sha256")
    .update(JSON.stringify([turnId, stepIndex, name]))
    .digest("base64url")
    .slice(0, 22);
}

function challengeTtl(expiresAt: string | undefined): number {
  if (expiresAt === undefined) return 10 * 60;
  const ttl = Math.ceil((Date.parse(expiresAt) - Date.now()) / 1_000);
  if (ttl < 1) return 1;
  return ttl > 60 * 60 ? 60 * 60 : ttl;
}

async function publishDesiredRender(
  state: DiscordChannelState,
  input: {
    readonly sessionId: string;
    readonly eveTurnId: string;
    readonly phase: RenderIntent["phase"];
    readonly footer?: string;
    readonly force?: boolean;
  },
): Promise<boolean> {
  const dispatchId = state.activeDispatchId;
  const messageId = state.activeMessageId;
  if (dispatchId === undefined || messageId === undefined || state.channelId === "") return false;
  // `eveTurnId` fences every render write in Redis — `if active.eveTurnId ~=
  // ARGV[5] then return -1`. An empty one is not a harmless blank: every empty
  // id compares equal to every other, so publishing one would let an unrelated
  // turn's render satisfy this turn's fence. The bot rejects the intent at its
  // wire boundary, which is correct but leaves the render silently undelivered;
  // refuse here instead, where the reason is visible.
  if (input.eveTurnId === "") {
    console.warn("render intent skipped: no active eve turn to fence it to");
    return false;
  }

  const liveText =
    input.phase === "streaming" ? sliceText(state.text, LIVE_TEXT_CHARS) : state.text;
  const inputRequests = state.renderInputRequests.slice(0, 1);
  const authorizations = state.renderAuthorizations.slice(0, 5);
  const preview = JSON.stringify([
    state.activity,
    sliceText(liveText, 1_900),
    inputRequests,
    authorizations,
  ]);
  if (input.phase === "streaming" && !input.force && preview === state.lastRenderPreview)
    return true;

  const now = Date.now();
  if (!input.force && now - state.lastRenderPublishedAt < RENDER_PUBLISH_INTERVAL_MS) {
    return true;
  }

  const revision = state.renderRevision + 1;
  const traceparent = currentTraceparent();
  const intent: RenderIntent = {
    dispatchId,
    continuationKey: state.threadId ?? state.channelId,
    messageId,
    sessionId: input.sessionId,
    eveTurnId: input.eveTurnId,
    revision,
    phase: input.phase,
    text: liveText,
    activity: state.activity,
    ...(input.footer === undefined ? {} : { footer: input.footer }),
    ...(traceparent === undefined ? {} : { traceparent }),
    authoredAt: new Date().toISOString(),
    ...(inputRequests.length === 0 ? {} : { inputRequests }),
    ...(authorizations.length === 0 ? {} : { authorizations }),
  };

  try {
    const accepted = await renderPublisher.publish(intent);
    if (accepted) {
      state.renderRevision = revision;
      state.lastRenderPublishedAt = now;
      if (input.phase === "streaming") state.lastRenderPreview = preview;
    }
    return accepted;
  } catch (cause) {
    warnFailure("publish Discord render intent", cause);
    return false;
  }
}

// Both type arguments are explicit: supplying one turns off inference for the
// rest, so leaving the second off would silently give every handler a `void`
// context instead of the state it needs.
export default defineChannel<DiscordChannelState, DiscordChannelContext>({
  state: initialDiscordState(),

  /**
   * Builds the `channel` argument handed to every event handler. Without it the
   * handlers receive no state at all, and mutations made here are written back
   * to adapter state by the framework.
   */
  context: (state) => ({ state }),

  /**
   * Projected for dynamic resolvers, which read it to decide which capabilities
   * a session gets. Only what a resolver could legitimately branch on.
   */
  metadata: (state) => ({
    channelId: state.channelId,
    threadId: state.threadId ?? "",
  }),

  routes: [
    /** A user turn: a mention that opens a conversation, or a follow-up. */
    POST(WIRE_ROUTES.message, async (request, { from, resolveSession }) => {
      if (!botAuthenticated(request)) {
        return createUnauthorizedResponse({ status: 401, message: "bad bearer" });
      }

      const decoded = decodeDeliveryPayload(await request.json());
      if (Result.isError(decoded)) return failed(decoded.error);
      const payload = decoded.value;

      // Context is durable history. Add the lead-in only when this delivery
      // creates the session; resending it on every follow-up duplicates history.
      const active = await resolveSession(payload.continuationKey);
      const context =
        active === undefined
          ? [...(payload.recentMessages ?? []), ...(payload.referencedContext ?? [])]
          : [];

      await steerActiveTurn(active, payload.continuationKey);
      const renderChannelId = payload.thread?.id ?? payload.channel.id;

      // Last side effect before Eve: after this fence becomes live, a crash must
      // wedge safely rather than risk starting this dispatch twice.
      const admission = await conversations.admission.start(payload);
      if (admission.status === "accepted") {
        return ok(admission.sessionId, payload.continuationKey);
      }
      if (admission.status === "recovery-required") {
        return failed(
          new RecoveryRequired({
            operation: "discord delivery admission",
            detail: "an earlier delivery may have reached Eve without acknowledgement",
            remediation: "reset this conversation before retrying",
          }),
          409,
        );
      }
      if (admission.status !== "start") {
        return failed(
          new Transient({
            operation: "discord delivery admission",
            detail:
              admission.status === "in-progress"
                ? "this dispatch is already being accepted"
                : admission.status === "resetting"
                  ? "this conversation is being reset"
                  : "this dispatch is no longer active",
          }),
          409,
        );
      }

      try {
        const session = await from(payload.continuationKey).send(messageContent(payload), {
          // Eve refreshes current auth on every delivery even though state seeds
          // are ignored for existing sessions. Transport targeting therefore
          // rides in this trusted assertion and is adopted at `turn.started`.
          auth: authFor(payload.principal, {
            channelId: payload.channel.id,
            ...(payload.thread === undefined ? {} : { threadId: payload.thread.id }),
            messageId: payload.messageId,
            dispatchId: payload.dispatchId,
            renderChannelId,
            source: payload.kind === "scheduled" ? "scheduled" : "chat",
            ...(payload.scheduleId === undefined ? {} : { scheduleId: payload.scheduleId }),
            ...(payload.occurrenceId === undefined ? {} : { occurrenceId: payload.occurrenceId }),
          }),
          ...(context.length === 0 ? {} : { context }),
          state: stateForMessage(payload),
        });

        const confirmed = await conversations.admission.confirm(payload, session.id);
        if (!confirmed) {
          return failed(
            new RecoveryRequired({
              operation: "discord delivery admission",
              detail: "admission ownership expired while Eve was accepting the turn",
              remediation: "reset this conversation before retrying",
            }),
            409,
          );
        }
        return ok(session.id, payload.continuationKey);
      } finally {
        await conversations.admission.finish(payload.continuationKey, admission.admissionAttemptId);
      }
    }),

    /** A component click answering a pending approval or question. */
    POST(WIRE_ROUTES.interaction, async (request, { from }) => {
      if (!botAuthenticated(request)) {
        return createUnauthorizedResponse({ status: 401, message: "bad bearer" });
      }

      const decoded = decodeInteractionPayload(await request.json());
      if (Result.isError(decoded)) return failed(decoded.error);
      const payload = decoded.value;
      const { claim, receiptIdentity } = await conversations.interactions.claim(payload);
      if (claim === 2) {
        await conversations.admission.finish(payload.continuationKey, payload.interactionId);
        return acceptedInteractionResponse(payload.interactionId);
      }
      if (claim !== 1) {
        return failed(
          new Error(
            claim === 0
              ? "interaction delivery is already in progress"
              : "input request is stale or invalid",
          ),
          409,
        );
      }

      try {
        const session = await from(payload.continuationKey).respond(
          [
            {
              requestId: payload.requestId,
              ...(payload.optionId === undefined ? {} : { optionId: payload.optionId }),
              ...(payload.freeform === undefined ? {} : { text: payload.freeform }),
            },
          ],
          {
            auth: authFor(payload.principal, {
              channelId: payload.authChannelId,
              ...(payload.authThreadId === undefined ? {} : { threadId: payload.authThreadId }),
              inputRequestId: payload.requestId,
              ...(payload.approvalRequester === undefined
                ? {}
                : { approvalRequester: payload.approvalRequester }),
            }),
          },
        );

        await conversations.interactions.accept(
          payload.interactionId,
          receiptIdentity,
          session.id,
          payload.continuationKey,
        );
        return ok(session.id, payload.continuationKey);
      } finally {
        await conversations.admission.finish(payload.continuationKey, payload.interactionId);
      }
    }),

    /** Explicit `/new`-style retirement. */
    POST(WIRE_ROUTES.reset, async (request, { from }) => {
      if (!botAuthenticated(request)) {
        return createUnauthorizedResponse({ status: 401, message: "bad bearer" });
      }

      const decoded = decodeResetRequestPayload(await request.json());
      if (Result.isError(decoded)) return failed(decoded.error);

      const cutover = await waitForResetCutover(
        decoded.value.continuationKey,
        decoded.value.resetId,
      );
      if (cutover !== "ready") {
        return failed(
          new Transient({
            operation: "drain Discord delivery before reset",
            detail:
              cutover === "busy"
                ? "an admitted delivery is still entering Eve"
                : "reset cutover ownership was lost",
          }),
          cutover === "busy" ? 503 : 409,
        );
      }

      const outcome = await from(decoded.value.continuationKey).reset({
        reason: decoded.value.reason,
      });
      return Response.json({ ok: true, status: outcome.status });
    }),

    /**
     * Someone typed while a turn was running: stop it so the queue can move.
     *
     * The message itself is already durable on the bot's pending queue. This
     * only cancels, and the cancellation is what releases `agent:active` — the
     * fence that otherwise refuses every later delivery on this conversation.
     */
    POST(WIRE_ROUTES.steer, async (request, { resolveSession }) => {
      if (!botAuthenticated(request)) {
        return createUnauthorizedResponse({ status: 401, message: "bad bearer" });
      }
      const decoded = decodeSteerRequestPayload(await request.json());
      if (Result.isError(decoded)) return failed(decoded.error);
      const { continuationKey } = decoded.value;
      await steerActiveTurn(await resolveSession(continuationKey), continuationKey);
      return Response.json({ ok: true, status: "accepted" });
    }),
  ],

  events: {
    "turn.started"(data, channel, ctx) {
      beginDiscordTurn(channel.state, ctx.session.auth.current?.attributes ?? {}, Date.now());
      channel.state.activeEveTurnId = data.turnId;
    },

    async "message.appended"(data, channel, ctx) {
      const state = channel.state;
      appendStreamingMessage(state, data);
      await publishDesiredRender(state, {
        sessionId: ctx.session.id,
        eveTurnId: data.turnId,
        phase: "streaming",
      });
    },

    "message.completed"(data, channel) {
      completeStreamingMessage(channel.state, data);
    },

    async "input.requested"(data, channel, ctx) {
      await applyInputRequests({
        state: channel.state,
        requests: data.requests,
        userId: currentUserId(ctx),
        sessionId: ctx.session.id,
        approvalPolicies: approvalPolicyStore,
      });
    },

    async "authorization.required"(data, channel, ctx) {
      const state = channel.state;
      const id = authorizationId(data.turnId, data.stepIndex, data.name);
      state.pendingAuthorizationNames = [...new Set([...state.pendingAuthorizationNames, id])];

      const userId = currentUserId(ctx);
      const dispatchId = state.activeDispatchId;
      if (userId !== undefined && dispatchId !== undefined) {
        const challenge = data.authorization;
        const url = safeAuthorizationUrl(challenge?.url);
        const expiresAt = safeExpiration(challenge?.expiresAt);
        const storedChallenge = {
          description: sliceText(data.description, 1_000),
          ...(url === undefined ? {} : { url }),
          ...(challenge?.userCode === undefined
            ? {}
            : { userCode: sliceText(challenge.userCode, 128) }),
          ...(expiresAt === undefined ? {} : { expiresAt }),
          ...(challenge?.instructions === undefined
            ? {}
            : { instructions: sliceText(challenge.instructions, 1_000) }),
        };
        await conversations.authorizations.store(
          dispatchId,
          id,
          storedChallenge,
          challengeTtl(expiresAt),
          60 * 60,
        );
        const authorization = {
          id,
          name: data.name === "" ? "connection" : sliceText(data.name, 128),
          recipientUserId: userId,
          ...(challenge?.displayName === undefined
            ? {}
            : { displayName: sliceText(challenge.displayName, 128) }),
        };
        state.renderAuthorizations = [
          ...state.renderAuthorizations.filter((current) => current.id !== id),
          authorization,
        ];
      }

      await publishDesiredRender(state, {
        sessionId: ctx.session.id,
        eveTurnId: data.turnId,
        phase: "streaming",
        force: true,
      });
    },

    async "authorization.completed"(data, channel, ctx) {
      const state = channel.state;
      const id = authorizationId(data.turnId, data.stepIndex, data.name);
      const index = state.renderAuthorizations.findIndex(
        (authorization) => authorization.id === id,
      );
      const completed = index < 0 ? undefined : state.renderAuthorizations[index];
      if (completed === undefined) {
        state.pendingAuthorizationNames = state.pendingAuthorizationNames.filter(
          (pendingId) => pendingId !== id,
        );
      } else {
        const dispatchId = state.activeDispatchId;
        if (dispatchId !== undefined) {
          await conversations.authorizations.delete(dispatchId, completed.id);
        }
        state.pendingAuthorizationNames = state.pendingAuthorizationNames.filter(
          (id) => id !== completed.id,
        );
        state.renderAuthorizations.splice(index, 1);
      }
      await publishDesiredRender(state, {
        sessionId: ctx.session.id,
        eveTurnId: data.turnId,
        phase: "streaming",
        force: true,
      });
    },

    async "actions.requested"(data, channel, ctx) {
      const state = channel.state;
      state.toolCalls += data.actions.length;

      // Each action kind names itself differently and reads differently to a
      // person watching — a tool call is the agent working, a subagent call is
      // it handing off. The switch is written against eve's union rather than a
      // structural guess, so a kind added upstream fails to compile here instead
      // of silently blanking the status line.
      const phrases = data.actions.map((action) => {
        switch (action.kind) {
          case "tool-call":
            return `calling ${action.toolName}`;
          case "subagent-call":
            return `delegating to ${action.subagentName}`;
          case "remote-agent-call":
            return `asking ${action.remoteAgentName}`;
          case "load-skill": {
            const name = z.string().safeParse(action.input["name"]).data;
            return name === undefined ? "loading a skill" : `loading ${name}`;
          }
        }
      });

      if (phrases.length > 0) {
        state.activity = `${phrases.join(", ")}…`;
        await publishDesiredRender(state, {
          sessionId: ctx.session.id,
          eveTurnId: data.turnId,
          phase: "streaming",
        });
      }
    },

    async "action.result"(data, channel, ctx) {
      // Work finished; drop the status line rather than leaving a stale one.
      channel.state.activity = "";
      await publishDesiredRender(channel.state, {
        sessionId: ctx.session.id,
        eveTurnId: data.turnId,
        phase: "streaming",
      });
    },

    async "turn.completed"(data, channel, ctx) {
      const state = channel.state;
      if (isWaitingForHuman(state)) {
        state.activity = "waiting for input…";
        await publishDesiredRender(state, {
          sessionId: ctx.session.id,
          eveTurnId: data.turnId,
          phase: "streaming",
          force: true,
        });
        return;
      }

      state.activity = "";
      state.finalRenderPhase = "completed";
      const tokens = await readTurnTokens(ctx.session.id, data.turnId);
      state.finalRenderFooter = renderFooter({
        referenceId: ctx.session.id.slice(-8),
        ...(state.turnStartedAt === undefined
          ? {}
          : { durationMs: Date.now() - state.turnStartedAt }),
        ...(tokens === undefined ? {} : { tokens }),
        toolCalls: state.toolCalls,
      });
    },

    async "turn.cancelled"(data, channel, ctx) {
      // Steered out of the way — and this has to release the delivery, because
      // nothing else will. `session.completed` does not follow a cancellation,
      // so the queue release that normally rides on it never happens: the
      // active record stays live, the message that did the steering is never
      // claimed, and the conversation is held until its lease expires. That is
      // what "steering breaks the agent" looked like — two "Thinking…" anchors,
      // neither of which could ever finish.
      //
      // The earlier note here said the replacement turn would paint over this.
      // It cannot. The replacement turn is the thing being blocked.
      const state = channel.state;
      state.activity = "";
      state.finalRenderPhase ??= "completed";
      state.finalRenderFooter ??= renderFooter({
        referenceId: ctx.session.id.slice(-8),
        ...(state.turnStartedAt === undefined
          ? {}
          : { durationMs: Date.now() - state.turnStartedAt }),
        toolCalls: state.toolCalls,
      });
      await settleAndNotifyParked(state, ctx.session.id, data.turnId);
    },

    async "turn.failed"(data, channel) {
      const state = channel.state;
      state.activity = "";
      state.finalRenderPhase = "failed";
      state.finalRenderFooter = publicFailureFooter("something went wrong", data.turnId);
    },

    async "session.completed"(_data, channel, ctx) {
      const state = channel.state;
      const eveTurnId = state.activeEveTurnId;
      if (eveTurnId === undefined) return;
      state.activity = "";
      state.finalRenderPhase ??= "completed";
      await settleAndNotifyParked(state, ctx.session.id, eveTurnId);
    },

    async "session.failed"(data, channel) {
      // Terminal failures do not necessarily emit `turn.failed` or a following
      // waiting boundary. Final desired paint and queue release share one CAS.
      const state = channel.state;
      const eveTurnId = state.activeEveTurnId ?? `session:${data.sessionId}`;
      state.activity = "";
      state.pendingInputRequestIds = [];
      state.pendingAuthorizationNames = [];
      state.finalRenderPhase = "failed";
      state.finalRenderFooter = publicFailureFooter("session ended unexpectedly", data.sessionId);
      await settleAndNotifyParked(state, data.sessionId, eveTurnId);
    },

    async "session.waiting"(_data, channel, ctx) {
      // Input/authorization parks are resumptions of this Discord turn, not a
      // boundary at which an unrelated queued user message may enter.
      if (isWaitingForHuman(channel.state)) return;
      const eveTurnId = channel.state.activeEveTurnId;
      if (eveTurnId === undefined || eveTurnId !== ctx.session.turn.id) return;
      channel.state.finalRenderPhase ??= "completed";
      // Terminal paint and the parked recovery marker become durable together.
      await settleAndNotifyParked(channel.state, ctx.session.id, eveTurnId);
    },
  },
});

const turnTokensSchema = storedInt.pipe(z.int().positive());

async function readTurnTokens(sessionId: string, turnId: string): Promise<number | undefined> {
  const key = turnTokenKey(sessionId, turnId);
  try {
    return turnTokensSchema.safeParse(await redis.get<number | string>(key)).data;
  } catch {
    return undefined;
  }
}

function publicFailureFooter(prefix: string, fallbackReference: string): string {
  const span = Sentry.getActiveSpan();
  const traceId = span === undefined ? undefined : Sentry.spanToJSON(span).trace_id;
  const reference = traceId === undefined ? fallbackReference.slice(-8) : traceId.slice(-8);
  return `${prefix} — reference ${reference}`;
}

function warnFailure(operation: string, error: unknown): void {
  const serialized = serializeError(error);
  console.warn(`${operation}: ${serialized.tag}: ${serialized.message}`);
}

async function settleAndNotifyParked(
  state: DiscordChannelState,
  sessionId: string,
  eveTurnId: string,
): Promise<void> {
  if (state.renderSettled) return;
  const continuationKey = state.threadId ?? state.channelId;
  const messageId = state.activeMessageId;
  const dispatchId = state.activeDispatchId;
  if (continuationKey === "" || messageId === undefined || dispatchId === undefined) return;

  const payload: ParkedPayload = {
    continuationKey,
    sessionId,
    messageId,
    dispatchId,
    eveTurnId,
  };
  const revision = state.renderRevision + 1;
  const traceparent = currentTraceparent();
  const phase = state.finalRenderPhase ?? "completed";
  const intent: RenderIntent = {
    dispatchId,
    continuationKey,
    messageId,
    sessionId,
    eveTurnId,
    revision,
    phase,
    text: sliceText(state.text, FINAL_TEXT_CHARS),
    activity: state.activity,
    ...(state.finalRenderFooter === undefined ? {} : { footer: state.finalRenderFooter }),
    ...(traceparent === undefined ? {} : { traceparent }),
    authoredAt: new Date().toISOString(),
  };

  const settledRevision = await renderPublisher.settleAndPark(intent, payload);
  // A stale replay must not wake the bot or overwrite a newer turn's marker.
  if (settledRevision === undefined) return;
  state.renderRevision = settledRevision;
  state.renderSettled = true;

  try {
    const botUrl = await resolveBotBaseUrl(redis, env.BOT_URL);
    const response = await fetch(new URL(BOT_ROUTES.parked, botUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.BOT_INGRESS_SECRET}`,
        ...traceHeaders(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`bot callback returned ${response.status}`);
  } catch (cause) {
    // Both markers are durable; HTTP is only the low-latency wakeup.
    console.warn(
      "bot callback failed; its recovery sweep will consume the parked/render markers",
      cause,
    );
  }
}
function messageContent(payload: DeliveryPayload): string | UserContent {
  if (payload.attachments === undefined || payload.attachments.length === 0) return payload.content;
  return [
    { type: "text", text: payload.content },
    ...payload.attachments.map((attachment) => ({
      type: "file" as const,
      data: new URL(attachment.url),
      filename: attachment.filename,
      mediaType: attachment.contentType ?? "application/octet-stream",
    })),
  ];
}
