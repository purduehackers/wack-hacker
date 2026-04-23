import type { TurnUsage } from "./types.ts";

/**
 * Shape of an AI SDK tool call entry on a step's `toolCalls`. Every call
 * carries a stable string name which we mirror into span attributes / wide
 * events so operators can see what ran. Other fields are ignored here.
 */
interface ToolCallLike {
  toolName?: string;
}

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
  private orchestratorInputTokens = 0;
  private orchestratorOutputTokens = 0;
  private orchestratorTotalTokens = 0;
  private orchestratorToolCalls = 0;
  private stepCount = 0;
  private orchestratorToolNames: string[] = [];
  private subagentToolNames: string[] = [];

  /** Add a subagent delegation's contribution. */
  addSubagent(delta: { tokens: number; toolCalls: number; toolNames: readonly string[] }): void {
    this.subagentTokens += delta.tokens;
    this.subagentToolCalls += delta.toolCalls;
    this.subagentToolNames.push(...delta.toolNames);
  }

  /**
   * Record the orchestrator's terminal usage + step trace for this turn.
   * Coerces undefined tokens from the AI SDK to 0 at the boundary so the
   * internal TurnUsage contract stays numeric.
   */
  recordOrchestrator(args: {
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    steps: ReadonlyArray<{ toolCalls: ReadonlyArray<unknown> }>;
  }): void {
    this.orchestratorInputTokens = args.usage.inputTokens ?? 0;
    this.orchestratorOutputTokens = args.usage.outputTokens ?? 0;
    this.orchestratorTotalTokens = args.usage.totalTokens ?? 0;
    this.orchestratorToolCalls = args.steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
    this.stepCount = args.steps.length;
    this.orchestratorToolNames = args.steps.flatMap((step) =>
      step.toolCalls.flatMap((call) => {
        const name = (call as ToolCallLike).toolName;
        return typeof name === "string" ? [name] : [];
      }),
    );
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
    return this.orchestratorTotalTokens + this.subagentTokens;
  }

  /** Combined orchestrator + subagent tool names in call order. */
  get totalToolNames(): string[] {
    return [...this.orchestratorToolNames, ...this.subagentToolNames];
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
