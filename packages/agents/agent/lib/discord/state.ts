/** @fileoverview Durable Discord adapter state and its per-turn transitions. */

import type { DeliveryPayload, RenderAuthorization, RenderInputRequest } from "@repo/shared/wire";
import type { SessionAuthContext } from "eve/context";
import { z } from "zod";

type AuthAttributes = SessionAuthContext["attributes"];

/** Attributes are string-or-list valued, and a blank transport id is no id at all. */
const presentAttribute = z.string().min(1);

export interface DiscordChannelState {
  channelId: string;
  threadId?: string;
  /** Discord user message that the current turn answers. Correlates the park signal. */
  activeMessageId?: string;
  /** Exact queue delivery epoch for replay-safe completion. */
  activeDispatchId?: string;
  /** Latest Eve turn for this delivery, used to reject replayed waiting events. */
  activeEveTurnId?: string;
  /** Completed assistant blocks from earlier tool-call steps in this turn. */
  completedText: string;
  /** Cumulative text for the model step currently streaming. */
  streamingText: string;
  /** Full visible assistant text for the current turn. */
  text: string;
  activity: string;
  turnStartedAt?: number;
  toolCalls: number;
  /**
   * The last assistant block appended, so `completeStreamingMessage` recognises
   * a replayed `message.completed` by what it says rather than by where it
   * claimed to be.
   *
   * `stepIndex` cannot do this job. Eve reports `stepIndex: 0` — and
   * `sequence: 0` — for *every* step of a turn that suspends and resumes. A
   * second model call after a subagent is therefore indistinguishable from a
   * replay of the first by either field. Event ids do not work either. Eve
   * emits a retry under a fresh id, so keying on those double-counts a replay
   * instead of dropping it. What actually differs is the text.
   */
  lastCompletedMessage: string;
  /** Outstanding HITL requests keep normal Discord messages queued. */
  pendingInputRequestIds: string[];
  /** Responses already queued into Eve while another required request remains. */
  answeredInputRequestIds: string[];
  pendingAuthorizationNames: string[];
  /** Presentation-safe HITL details copied into the bot-owned render intent. */
  renderInputRequests: RenderInputRequest[];
  /** Private challenges delivered by the bot only to their intended user. */
  renderAuthorizations: RenderAuthorization[];
  renderRevision: number;
  lastRenderPublishedAt: number;
  lastRenderPreview: string;
  /** Final desired state is durable before the normal-message queue advances. */
  renderSettled: boolean;
  finalRenderPhase?: "completed" | "failed";
  finalRenderFooter?: string;
}

/**
 * The empty adapter state a channel starts from. `channelId` stays blank until
 * a delivery supplies a real transport target, because no default channel is a
 * safe place to render into.
 */
export function initialDiscordState(): DiscordChannelState {
  return {
    channelId: "",
    completedText: "",
    streamingText: "",
    text: "",
    activity: "",
    toolCalls: 0,
    lastCompletedMessage: "",
    pendingInputRequestIds: [],
    answeredInputRequestIds: [],
    pendingAuthorizationNames: [],
    renderInputRequests: [],
    renderAuthorizations: [],
    renderRevision: 0,
    lastRenderPublishedAt: 0,
    lastRenderPreview: "",
    renderSettled: false,
  };
}

/** Seed used only when Eve creates a new session. Auth attributes hydrate follow-ups. */
export function stateForMessage(payload: DeliveryPayload): DiscordChannelState {
  return {
    ...initialDiscordState(),
    channelId: payload.thread?.id ?? payload.channel.id,
    ...(payload.thread !== undefined && { threadId: payload.thread.id }),
    activeMessageId: payload.messageId,
    activeDispatchId: payload.dispatchId,
  };
}

function stringAttribute(attributes: AuthAttributes, key: string): string | undefined {
  return presentAttribute.safeParse(attributes[key]).data;
}

/**
 * Adopts the transport target carried by the current delivery's authenticated
 * assertion. Eve ignores `send(..., { state })` for an existing session, while
 * `session.auth.current` is deliberately refreshed for every delivery.
 */
export function beginDiscordTurn(
  state: DiscordChannelState,
  attributes: AuthAttributes,
  now: number,
): void {
  const messageId = stringAttribute(attributes, "discordMessageId");
  const dispatchId = stringAttribute(attributes, "discordDispatchId");
  const renderChannelId = stringAttribute(attributes, "renderChannelId");

  // An inputResponses delivery starts another Eve turn with clicker auth but no
  // message transport attributes. Keep unanswered required requests locally:
  // Eve can remain parked without re-emitting the original batch.
  if (messageId === undefined || dispatchId === undefined || renderChannelId === undefined) {
    const answeredRequestId = stringAttribute(attributes, "discordInputRequestId");
    if (answeredRequestId !== undefined) {
      state.answeredInputRequestIds = [
        ...new Set([...state.answeredInputRequestIds, answeredRequestId]),
      ];
      const represented = new Set(state.renderInputRequests.map(({ requestId }) => requestId));
      const unrenderable = state.pendingInputRequestIds.filter(
        (requestId) => requestId !== answeredRequestId && !represented.has(requestId),
      );
      const remaining = state.renderInputRequests.filter(
        ({ requestId }) => requestId !== answeredRequestId,
      );
      if (remaining.some(({ kind }) => kind !== "question") || unrenderable.length > 0) {
        state.renderInputRequests = remaining;
        state.pendingInputRequestIds = [
          ...remaining.map(({ requestId }) => requestId),
          ...unrenderable,
        ];
      } else {
        // Once answers cover every required request, Eve dismisses any omitted
        // questions, so keeping their controls would manufacture stale turns.
        state.renderInputRequests = [];
        state.pendingInputRequestIds = [];
        state.answeredInputRequestIds = [];
      }
    }
    state.turnStartedAt = now;
    state.streamingText = "";
    state.text = state.completedText;
    state.lastCompletedMessage = "";
    state.activity = "thinking…";
    state.lastRenderPublishedAt = 0;
    state.lastRenderPreview = "";
    state.renderSettled = false;
    delete state.finalRenderPhase;
    delete state.finalRenderFooter;
    return;
  }

  state.channelId = renderChannelId;
  state.activeMessageId = messageId;
  state.activeDispatchId = dispatchId;

  const threadId = stringAttribute(attributes, "threadId");
  if (threadId === undefined) delete state.threadId;
  else state.threadId = threadId;

  state.turnStartedAt = now;
  state.completedText = "";
  state.streamingText = "";
  state.text = "";
  state.lastCompletedMessage = "";
  state.toolCalls = 0;
  state.activity = "thinking…";
  state.pendingInputRequestIds = [];
  state.answeredInputRequestIds = [];
  state.pendingAuthorizationNames = [];
  state.renderInputRequests = [];
  state.renderAuthorizations = [];
  state.renderRevision = 0;
  state.lastRenderPublishedAt = 0;
  state.lastRenderPreview = "";
  state.renderSettled = false;
  delete state.finalRenderPhase;
  delete state.finalRenderFooter;
}

/**
 * True while any HITL request or authorization challenge remains open. The
 * channel must keep the turn parked and its controls on screen. A final
 * render here would settle a turn a human still owes an answer.
 */
export function isWaitingForHuman(state: DiscordChannelState): boolean {
  return state.pendingInputRequestIds.length > 0 || state.pendingAuthorizationNames.length > 0;
}

function appendBlock(existing: string, block: string): string {
  if (block === "") return existing;
  return existing === "" ? block : `${existing}\n\n${block}`;
}

/**
 * Projects a `message.appended` delta into the visible turn text. Safe under
 * replay because the delta carries the whole message so far, never a suffix.
 */
export function appendStreamingMessage(
  state: DiscordChannelState,
  input: { readonly messageSoFar: string },
): void {
  // Naturally idempotent: `messageSoFar` is cumulative, so a replayed delta
  // replaces the in-progress text with the same value rather than doubling it.
  state.streamingText = input.messageSoFar;
  state.text = appendBlock(state.completedText, state.streamingText);
}

/** Preserves preliminary assistant text across tool-call model steps, replay-safely. */
export function completeStreamingMessage(
  state: DiscordChannelState,
  input: { readonly message: string | null },
): void {
  // Framework boundary: Eve uses null when a step emitted no assistant message.
  if (input.message !== null && input.message !== state.lastCompletedMessage) {
    state.completedText = appendBlock(state.completedText, input.message);
    state.lastCompletedMessage = input.message;
  }
  state.streamingText = "";
  state.text = state.completedText;
}
