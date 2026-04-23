import type { ToolSet, UIMessage } from "ai";
import type { z } from "zod";

import type { AgentContext } from "./context.ts";
import type { SkillBundle } from "./skills/types.ts";
import type { TurnUsageTracker } from "./turn-usage.ts";

export interface ChannelInfo {
  id: string;
  name: string;
}

export interface ThreadInfo {
  id: string;
  name: string;
  parentChannel: ChannelInfo;
}

export interface Attachment {
  url: string;
  filename: string;
  contentType?: string;
}

export interface RecentMessage {
  /** Discord message ID — used to dedupe against other context batches. Not rendered. */
  id: string;
  author: string;
  content: string;
  timestamp: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SerializedAgentContext {
  userId: string;
  username: string;
  nickname: string;
  channel: ChannelInfo;
  thread?: ThreadInfo;
  date: string;
  attachments?: Attachment[];
  memberRoles?: string[];
  recentMessages?: RecentMessage[];
  /**
   * True when `recentMessages` were fetched from the thread itself (i.e. the
   * mention that started this workflow was already in a thread). False when
   * they came from a parent channel (a fresh mention that created a new
   * thread). Controls the `<recent_thread_messages>` vs `<recent_channel_messages>`
   * tag in the system prompt so the model isn't told thread context when the
   * lead-in is actually channel chatter.
   */
  recentMessagesFromThread?: boolean;
  /**
   * Extra lead-in fetched when the triggering mention was a reply to another
   * message: the referenced message plus up to 14 messages immediately
   * preceding it, in chronological order. Only set when the reply target is
   * not already included in `recentMessages`.
   */
  referencedContext?: RecentMessage[];
}

export interface FooterMeta {
  elapsedMs: number;
  totalTokens: number | undefined;
  toolCallCount: number;
  stepCount: number;
  /**
   * Full OTEL trace id for the turn (32-char hex). Rendered into the footer as
   * `Trace: <id>` so operators can paste it into Sentry to pull up the full
   * agent trace for a specific Discord reply.
   */
  traceId?: string;
}

/**
 * Usage accounting for a single orchestrator turn. Captured from the AI SDK's
 * `result.totalUsage` plus the subagent metrics accumulator. Stored in the
 * context snapshot so the /inspect-context command can report real, non-estimated
 * token numbers for the last completed turn.
 */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  /** Total including subagent tokens; matches the footer value. */
  totalTokens: number;
  subagentTokens: number;
  toolCallCount: number;
  stepCount: number;
  /**
   * Names of tools called during this turn, in call order. Includes both
   * orchestrator-level calls (delegation tools) and subagent-level calls
   * (tools run inside delegated subagents). Surfaced on spans and wide events
   * so operators can see *what* ran, not just *how many*.
   */
  toolNames: string[];
}

export interface ModelInfo {
  id: string;
  provider: string;
  limit: { context: number; output: number };
  cost: { input: number; output: number };
}

export interface CategoryBreakdown {
  label: string;
  chars: number;
  estimatedTokens: number;
  /** Optional per-item breakdown (e.g. per-tool token counts within the Tools category). */
  items?: CategoryItem[];
}

export interface CategoryItem {
  name: string;
  estimatedTokens: number;
  /**
   * Loadable subskills nested under this item — populated only for delegate
   * agents (subskills load on demand inside the subagent via `load_skill`).
   * Not counted toward the orchestrator's input total.
   */
  skills?: CategoryItem[];
}

export interface ContextBreakdown {
  model: string;
  modelInfo: ModelInfo | null;
  categories: CategoryBreakdown[];
  /** Sum of per-category estimatedTokens (chars/4). */
  estimatedInputTokens: number;
  /** Cumulative API usage across every turn this conversation has run. */
  totalUsage: TurnUsage;
  turnCount: number;
  messageCount: number;
  /** Cumulative dollar cost across every turn — modelInfo + usage required. */
  totalCostUsd?: { input: number; output: number; total: number };
}

/**
 * Builder signature used to inject `experimental_context` into the nested
 * `ToolLoopAgent.stream()` call (e.g. the coding subagent passes
 * `{ sandbox, repoDir, branch, threadKey, repo }` so every code tool's
 * `execute` can resolve the target sandbox).
 */
export type BuildSubagentContext = (input: unknown, agentContext: AgentContext) => unknown;

/**
 * Post-finish hook for subagents that need to do work *after* the nested
 * agent's tool loop completes — e.g. the coding subagent auto-commits,
 * pushes, and opens a PR once the model has stopped editing. Yielded
 * `UIMessage`s are forwarded to the parent's stream so the final Discord
 * output includes the PR URL.
 */
export type SubagentPostFinish = (args: {
  input: unknown;
  agentContext: AgentContext;
  experimentalContext: unknown;
  lastAssistantText: string;
}) => AsyncGenerator<UIMessage, void, void>;

export interface SubagentSpec {
  /** Stable identifier used for telemetry/tracing. */
  name: string;
  /** Short description shown to the orchestrator as the delegation tool's description. */
  description: string;
  /** Full subagent system prompt. `{{SKILL_MENU}}` placeholder is replaced at runtime. */
  systemPrompt: string;
  /** All tools available to the subagent (includes base + skill-gated). */
  tools: ToolSet;
  /** Sub-skill manifest for progressive disclosure within the subagent. */
  subSkills: Record<string, SkillBundle>;
  /** Tool names always visible to the subagent (base tools). */
  baseToolNames: readonly string[];
  /** Override the default `SUBAGENT_MODEL` (e.g. Claude for coding). */
  model?: string;
  /** Override the default `stepCountIs(15)` cap. */
  stopSteps?: number;
  /**
   * Override the default `{ task: z.string() }` input schema. Required when
   * the delegation tool needs extra structured input (e.g. the code subagent
   * takes `{ repo, task }`).
   */
  inputSchema?: z.ZodType;
  /**
   * Build the `experimental_context` passed to the subagent's
   * `ToolLoopAgent.stream()`. Invoked once per delegation call, before the
   * agent starts, with the tool's validated input + the orchestrator's
   * `AgentContext`. Tools receive the returned object via their
   * `experimental_context` parameter.
   */
  buildExperimentalContext?: BuildSubagentContext;
  /**
   * Runs after the nested `ToolLoopAgent`'s stream is fully drained. The
   * yielded `UIMessage`s are forwarded to the parent stream — used by the
   * coding subagent to commit/push/open a PR and relay the result.
   */
  postFinish?: SubagentPostFinish;
}

/**
 * Structural subset of the `ToolLoopAgent` interface that `streamTurn` uses —
 * scoped to just `.stream()` so tests can hand-roll a fake without pulling in
 * the AI SDK's full generic machinery.
 */
export interface OrchestratorAgent {
  stream(input: { messages: unknown[] }): Promise<{
    fullStream: AsyncIterable<unknown>;
    totalUsage: Promise<unknown>;
    steps: Promise<unknown>;
  }>;
}

/**
 * Telemetry metadata passed through to every AI SDK `experimental_telemetry.metadata`
 * call in an orchestrator + its subagents. Flat key/value pairs; the AI SDK
 * flattens these into `ai.telemetry.metadata.<key>` span attributes so Axiom
 * can query by `chat.id` across the whole conversation. Undefined values are
 * tolerated so callers can build metadata from optional fields without first
 * filtering them out.
 */
export type TelemetryMetadata = Record<string, string | number | undefined>;

/**
 * Factory signature for `createOrchestrator`. Exported so tests can inject a
 * fake through `streamTurn`'s options bag without mocking our own modules.
 */
export type OrchestratorFactory = (
  ctx: AgentContext,
  tracker: TurnUsageTracker,
  extraMetadata?: TelemetryMetadata,
) => OrchestratorAgent;

/**
 * Return shape of `streamTurn`. Carries the reply text + usage accounting
 * needed by the workflow, plus observability hooks (`discordMessageId`,
 * `model`) that let the run_turn step emit a complete wide event for each
 * turn without re-computing them.
 */
export interface StreamTurnResult {
  text: string;
  usage: TurnUsage;
  /**
   * Primary Discord message id for the reply (either the edited placeholder
   * or a fallback `createMessage`). Always a string because `streamTurn`
   * runs `renderer.init()` before it can reach `finalize()`, and `finalize()`
   * throws if that invariant is broken.
   */
  discordMessageId: string;
  /**
   * Full gateway model slug used by the orchestrator for this turn, e.g.
   * `anthropic/claude-sonnet-4.6`. Included so the wide event records what
   * actually ran, independent of whatever constant was read at build time.
   */
  model: string;
}

/**
 * Options bag for `streamTurn`. Split out so production callers don't need to
 * deal with the test-injection hooks.
 */
export interface StreamTurnOptions {
  /** Task ID to include in the message footer (e.g. for scheduled runs). */
  taskId?: string;
  /** Dependency-injected orchestrator factory; defaults to `createOrchestrator`. */
  createAgent?: OrchestratorFactory;
  /**
   * Workflow run id for the containing chat workflow. Used to populate
   * `chat.*` attributes on the turn span + every AI SDK span so a whole
   * conversation is one Axiom query (`chat.id == <workflowRunId>`).
   */
  workflowRunId?: string;
  /** Turn number within the conversation (1 = first turn). */
  turnIndex?: number;
  /**
   * Pre-created "> Thinking..." placeholder id. When provided, the renderer
   * edits this message instead of posting a new one. Used on the first turn
   * of a fresh workflow — the mention handler posts the placeholder before
   * enqueuing the workflow so it's visible ahead of workflow cold-start.
   */
  placeholderMessageId?: string;
}
