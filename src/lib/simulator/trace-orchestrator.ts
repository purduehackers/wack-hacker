import type { OrchestratorAgent, OrchestratorFactory } from "@/lib/ai/types";

import { DELEGATE_PREFIX } from "@/lib/ai/constants";
import { createOrchestrator } from "@/lib/ai/orchestrator";

import type { SimEventBus } from "./event-bus.ts";

/** The tool-lifecycle parts of the AI SDK fullStream we re-emit as trace rows. */
interface ToolStreamPart {
  type: string;
  toolCallId?: string;
  toolName?: string;
  preliminary?: boolean;
}

/**
 * A delegation surfaces in the orchestrator stream as a `delegate_<domain>`
 * tool call. Split off the domain as the `delegateName` so the Trace tab can
 * render it as a subagent row ("delegate › github") rather than a raw tool name.
 */
function traceLabel(toolName: string): { toolName: string; delegateName?: string } {
  if (toolName.startsWith(DELEGATE_PREFIX)) {
    return { toolName, delegateName: toolName.slice(DELEGATE_PREFIX.length) };
  }
  return { toolName };
}

/**
 * Tee the real orchestrator's `fullStream`: re-emit each tool-lifecycle part as
 * a `trace.tool` SimEvent (so the inspector's Trace tab populates), then yield
 * the part unchanged so `renderStream` still drives the message UX. This
 * re-homes the trace emission MOCK mode used to hardwire — the renderer and the
 * production `streamTurn` stay untouched. Tool-result/-error parts may omit
 * `toolName`; the reducer matches the closing row to its opening row by
 * `toolCallId`, so the label always comes from the `start` row.
 */
async function* teeTrace(
  fullStream: AsyncIterable<unknown>,
  bus: SimEventBus,
): AsyncGenerator<unknown> {
  for await (const raw of fullStream) {
    const part = raw as ToolStreamPart;
    const toolCallId = part.toolCallId ?? "unknown";
    const { toolName, delegateName } = traceLabel(part.toolName ?? "tool");
    if (part.type === "tool-input-start") {
      bus.emit({ type: "trace.tool", toolCallId, toolName, delegateName, phase: "start" });
    } else if (part.type === "tool-result") {
      bus.emit({
        type: "trace.tool",
        toolCallId,
        toolName,
        delegateName,
        phase: "result",
        preliminary: part.preliminary,
      });
    } else if (part.type === "tool-error") {
      bus.emit({ type: "trace.tool", toolCallId, toolName, delegateName, phase: "error" });
    }
    yield raw;
  }
}

/**
 * An {@link OrchestratorFactory} that runs the REAL orchestrator and tees its
 * stream into the {@link SimEventBus} for the inspector's Trace tab. The only
 * `createAgent` the simulator injects now that MOCK mode is gone — a thin
 * tracing passthrough around `createOrchestrator`, not a stand-in for the model.
 *
 * `baseFactory` defaults to the real `createOrchestrator`; tests inject a fake
 * to drive a deterministic stream without a model (mirroring how `streamTurn`
 * accepts an injected factory).
 */
export function createTracingOrchestratorFactory(
  bus: SimEventBus,
  baseFactory: OrchestratorFactory = createOrchestrator,
): OrchestratorFactory {
  return (ctx, tracker, extraMetadata, model, budget): OrchestratorAgent => {
    const agent = baseFactory(ctx, tracker, extraMetadata, model, budget);
    return {
      stream: async (input) => {
        const result = await agent.stream(input);
        return { ...result, fullStream: teeTrace(result.fullStream, bus) };
      },
    };
  };
}
