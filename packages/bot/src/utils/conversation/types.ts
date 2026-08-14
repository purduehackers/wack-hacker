/** Shared shapes for the conversation reconciler. Nothing here has behavior. */

import type { ConversationStore, HitlClaimInput } from "@repo/shared/conversations";
import type { KnownError } from "@repo/shared/errors";
import type { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import type {
  InteractionPayload,
  MessagePayload,
  RenderIntent,
  RenderTarget,
  ResetPayload,
  ScheduledFirePayload,
} from "@repo/shared/wire";

import type { AgentClient, AgentError } from "../../agent/client.ts";
import type { DiscordRest } from "../../agent/render/discord-rest.ts";
import type { RendererProjection } from "../../agent/render/renderer.ts";
import type { ScheduledDiscordAdapter } from "../../agent/scheduled.ts";
import type { TurnMessageWriter } from "../../agent/turn-messages.ts";

export interface ConversationFlowDeps {
  readonly eve: AgentClient;
  readonly store: ConversationStore;
  readonly rest: DiscordRest;
  readonly turnMessages: TurnMessageWriter;
  readonly schedules: ScheduledDiscordAdapter;
  readonly reporter: Reporter;
}

export interface ConversationAnswer {
  readonly claim: HitlClaimInput;
  readonly payload: InteractionPayload;
}

export type ConversationAnswerResult =
  | { readonly status: "accepted" }
  | { readonly status: "taken" | "stale" }
  | { readonly status: "failed"; readonly error: AgentError };

export interface RenderWork {
  readonly intent: RenderIntent;
  readonly target: RenderTarget;
  readonly projection: RendererProjection;
  readonly appliedRevision: number;
}

export interface ConversationWake {
  readonly dispatchId?: string;
  readonly continuationKey?: string;
}

export interface ConversationFlow {
  submit(payload: MessagePayload): Promise<Result<void, AgentError>>;
  reset(payload: ResetPayload): Promise<Result<void, KnownError>>;
  answer(answer: ConversationAnswer): Promise<ConversationAnswerResult>;
  admitSchedule(payload: ScheduledFirePayload): Promise<void>;
  wake(hint?: ConversationWake): void;
  sweep(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * The reconciler's shared state, as seen by one sweep step.
 *
 * The runtime holds the two pending sets by reference, and a step reads
 * `isStopped` at the moment it is about to do more work. Those are the same
 * points the flow always observed a stop, so a shutdown landing mid-sweep
 * still cuts in where it did.
 */
export interface FlowRuntime {
  readonly deps: ConversationFlowDeps;
  readonly pendingDispatches: Set<string>;
  readonly pendingContinuations: Set<string>;
  readonly isStopped: () => boolean;
}
