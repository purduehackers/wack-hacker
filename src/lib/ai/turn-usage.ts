import type { TurnUsage } from "./types.ts";

/**
 * Mutable accumulator for one orchestrator turn's worth of usage.
 *
 * Subagents call `addSubagent` to fold in their per-delegation totals as they
 * complete; the streaming layer calls `recordOrchestrator` once with the
 * orchestrator's terminal usage + step trace. `toTurnUsage` produces the
 * persisted `TurnUsage` shape (subagent totals + orchestrator totals merged).
 */
export class TurnUsageTracker {
  private subagentTokens = 0;
  private subagentToolCalls = 0;
  private orchestratorInputTokens: number | undefined;
  private orchestratorOutputTokens: number | undefined;
  private orchestratorTotalTokens: number | undefined;
  private orchestratorToolCalls = 0;
  private stepCount = 0;

  /** Add a subagent delegation's contribution. */
  addSubagent(delta: { tokens: number; toolCalls: number }): void {
    this.subagentTokens += delta.tokens;
    this.subagentToolCalls += delta.toolCalls;
  }

  /** Record the orchestrator's terminal usage + step trace for this turn. */
  recordOrchestrator(args: {
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    steps: ReadonlyArray<{ toolCalls: ReadonlyArray<unknown> }>;
  }): void {
    this.orchestratorInputTokens = args.usage.inputTokens;
    this.orchestratorOutputTokens = args.usage.outputTokens;
    this.orchestratorTotalTokens = args.usage.totalTokens;
    this.orchestratorToolCalls = args.steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
    this.stepCount = args.steps.length;
  }

  /** Convenience accessor for the post-stream tool-call total (orchestrator + subagent). */
  get totalToolCalls(): number {
    return this.orchestratorToolCalls + this.subagentToolCalls;
  }

  /** Convenience accessor for the post-stream step count. */
  get totalSteps(): number {
    return this.stepCount;
  }

  /** Convenience accessor for the post-stream merged token total. */
  get totalTokens(): number {
    return (this.orchestratorTotalTokens ?? 0) + this.subagentTokens;
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
  };
}

/** Sum two TurnUsage values into a fresh object — used by the workflow to
 * accumulate per-turn usage into a conversation-wide running total. */
export function addTurnUsage(total: TurnUsage, turn: TurnUsage): TurnUsage {
  return {
    inputTokens: (total.inputTokens ?? 0) + (turn.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (turn.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (turn.totalTokens ?? 0),
    subagentTokens: total.subagentTokens + turn.subagentTokens,
    toolCallCount: total.toolCallCount + turn.toolCallCount,
    stepCount: total.stepCount + turn.stepCount,
  };
}
