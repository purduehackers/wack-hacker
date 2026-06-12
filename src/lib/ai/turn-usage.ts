import type { SubagentUsage, TurnUsage, UsageLike } from "./types.ts";

/**
 * Shape of an AI SDK tool call entry on a step's `toolCalls`. Every call
 * carries a stable string name which we mirror into span attributes / wide
 * events so operators can see what ran. Other fields are ignored here.
 */
interface ToolCallLike {
  toolName?: string;
}

/**
 * Cache-read token count from an AI SDK usage object. Prefers the
 * non-deprecated `inputTokenDetails.cacheReadTokens`, falls back to the
 * deprecated top-level alias, and coerces missing values to 0.
 */
export function extractCachedInputTokens(usage: UsageLike): number {
  return usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
}

/**
 * Mutable accumulator for one orchestrator turn's worth of usage.
 *
 * Subagents call `addSubagent` to fold in their per-delegation usage records
 * as they complete; the streaming layer calls `recordOrchestrator` once with
 * the orchestrator's terminal usage + step trace. `toTurnUsage` produces the
 * persisted `TurnUsage` shape (subagent totals + orchestrator totals merged),
 * while `subagentUsage`/`orchestratorUsage` expose the per-model splits the
 * cost-attribution metrics are computed from at turn end.
 */
export class TurnUsageTracker {
  private subagents: SubagentUsage[] = [];
  private orchestratorInputTokens = 0;
  private orchestratorOutputTokens = 0;
  private orchestratorTotalTokens = 0;
  private orchestratorCachedInputTokens = 0;
  private orchestratorToolCalls = 0;
  private stepCount = 0;
  private orchestratorToolNames: string[] = [];

  /** Add a subagent delegation's usage record. */
  addSubagent(record: SubagentUsage): void {
    this.subagents.push(record);
  }

  /**
   * Record the orchestrator's terminal usage + step trace for this turn.
   * Coerces undefined tokens from the AI SDK to 0 at the boundary so the
   * internal TurnUsage contract stays numeric.
   */
  recordOrchestrator(args: {
    usage: UsageLike;
    steps: ReadonlyArray<{ toolCalls: ReadonlyArray<unknown> }>;
  }): void {
    this.orchestratorInputTokens = args.usage.inputTokens ?? 0;
    this.orchestratorOutputTokens = args.usage.outputTokens ?? 0;
    this.orchestratorTotalTokens = args.usage.totalTokens ?? 0;
    this.orchestratorCachedInputTokens = extractCachedInputTokens(args.usage);
    this.orchestratorToolCalls = args.steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
    this.stepCount = args.steps.length;
    this.orchestratorToolNames = args.steps.flatMap((step) =>
      step.toolCalls.flatMap((call) => {
        const name = (call as ToolCallLike).toolName;
        return typeof name === "string" ? [name] : [];
      }),
    );
  }

  private get subagentTokens(): number {
    return this.subagents.reduce((sum, s) => sum + s.tokens, 0);
  }

  /** Per-delegation usage records (model + token splits), in completion order. */
  get subagentUsage(): readonly SubagentUsage[] {
    return this.subagents;
  }

  /** Orchestrator terminal usage splits, for pricing at the orchestrator model's rates. */
  get orchestratorUsage(): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
  } {
    return {
      inputTokens: this.orchestratorInputTokens,
      outputTokens: this.orchestratorOutputTokens,
      totalTokens: this.orchestratorTotalTokens,
      cachedInputTokens: this.orchestratorCachedInputTokens,
    };
  }

  /** Cache reads across orchestrator + subagents — the verification metric for prompt caching. */
  get totalCachedInputTokens(): number {
    return (
      this.orchestratorCachedInputTokens +
      this.subagents.reduce((sum, s) => sum + s.cachedInputTokens, 0)
    );
  }

  /** Convenience accessor for the post-stream tool-call total (orchestrator + subagent). */
  get totalToolCalls(): number {
    return this.orchestratorToolCalls + this.subagents.reduce((sum, s) => sum + s.toolCalls, 0);
  }

  /** Convenience accessor for the post-stream step count. */
  get totalSteps(): number {
    return this.stepCount;
  }

  /** Convenience accessor for the post-stream merged token total. */
  get totalTokens(): number {
    return this.orchestratorTotalTokens + this.subagentTokens;
  }

  /** Combined orchestrator + subagent tool names in call order. */
  get totalToolNames(): string[] {
    return [...this.orchestratorToolNames, ...this.subagents.flatMap((s) => s.toolNames)];
  }

  /** Snapshot in the shape persisted to the context-snapshot store. */
  toTurnUsage(): TurnUsage {
    return {
      inputTokens: this.orchestratorInputTokens,
      outputTokens: this.orchestratorOutputTokens,
      totalTokens: this.totalTokens,
      subagentTokens: this.subagentTokens,
      toolCallCount: this.totalToolCalls,
      stepCount: this.stepCount,
      toolNames: this.totalToolNames,
    };
  }
}

/** Initial zero-state for a cumulative TurnUsage accumulator. */
export function emptyTurnUsage(): TurnUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    subagentTokens: 0,
    toolCallCount: 0,
    stepCount: 0,
    toolNames: [],
  };
}

/** Sum two TurnUsage values into a fresh object — used by the workflow to
 * accumulate per-turn usage into a conversation-wide running total. */
export function addTurnUsage(total: TurnUsage, turn: TurnUsage): TurnUsage {
  return {
    inputTokens: total.inputTokens + turn.inputTokens,
    outputTokens: total.outputTokens + turn.outputTokens,
    totalTokens: total.totalTokens + turn.totalTokens,
    subagentTokens: total.subagentTokens + turn.subagentTokens,
    toolCallCount: total.toolCallCount + turn.toolCallCount,
    stepCount: total.stepCount + turn.stepCount,
    toolNames: [...total.toolNames, ...turn.toolNames],
  };
}
