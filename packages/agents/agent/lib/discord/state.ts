/** Durable Discord adapter state and its per-turn transitions. */

import type { DeliveryPayload, RenderAuthorization, RenderInputRequest } from "@repo/shared/wire";
import type { SessionAuthContext } from "eve/context";

type AuthAttributes = SessionAuthContext["attributes"];

export interface DiscordChannelState {
  channelId: string;
  threadId?: string;
  /** Discord user message currently being answered. Correlates the park signal. */
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
  /** Makes `message.completed` idempotent under durable event replay. */
  lastCompletedStepIndex: number;
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

export function initialDiscordState(): DiscordChannelState {
  return {
    channelId: "",
    completedText: "",
    streamingText: "",
    text: "",
    activity: "",
    toolCalls: 0,
    lastCompletedStepIndex: -1,
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

/** Seed used only when Eve creates a new session. Follow-ups are hydrated from auth attributes. */
export function stateForMessage(payload: DeliveryPayload): DiscordChannelState {
  return {
    ...initialDiscordState(),
    channelId: payload.thread?.id ?? payload.channel.id,
    ...(payload.thread === undefined ? {} : { threadId: payload.thread.id }),
    activeMessageId: payload.messageId,
    activeDispatchId: payload.dispatchId,
  };
}

function stringAttribute(attributes: AuthAttributes, key: string): string | undefined {
  const value = attributes[key];
  return typeof value === "string" && value !== "" ? value : undefined;
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
        // Once every required request is covered Eve dismisses any omitted
        // questions, so keeping their controls would manufacture stale turns.
        state.renderInputRequests = [];
        state.pendingInputRequestIds = [];
        state.answeredInputRequestIds = [];
      }
    }
    state.turnStartedAt = now;
    state.streamingText = "";
    state.text = state.completedText;
    state.lastCompletedStepIndex = -1;
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
  state.lastCompletedStepIndex = -1;
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

export function isWaitingForHuman(state: DiscordChannelState): boolean {
  return state.pendingInputRequestIds.length > 0 || state.pendingAuthorizationNames.length > 0;
}

function appendBlock(existing: string, block: string): string {
  if (block === "") return existing;
  return existing === "" ? block : `${existing}\n\n${block}`;
}

export function appendStreamingMessage(
  state: DiscordChannelState,
  input: { readonly stepIndex: number; readonly messageSoFar: string },
): void {
  if (input.stepIndex <= state.lastCompletedStepIndex) return;
  state.streamingText = input.messageSoFar;
  state.text = appendBlock(state.completedText, state.streamingText);
}

/** Preserves preliminary assistant text across tool-call model steps, replay-safely. */
export function completeStreamingMessage(
  state: DiscordChannelState,
  input: { readonly stepIndex: number; readonly message: string | null },
): void {
  if (input.stepIndex <= state.lastCompletedStepIndex) return;
  // Framework boundary: Eve uses null when a step emitted no assistant message.
  if (input.message !== null) state.completedText = appendBlock(state.completedText, input.message);
  state.streamingText = "";
  state.text = state.completedText;
  state.lastCompletedStepIndex = input.stepIndex;
}
