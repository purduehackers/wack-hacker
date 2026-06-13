import { tool, type ToolCallOptions, type UIMessage } from "ai";
import { z } from "zod";

import { countMetric } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";

import type { AccessSpec } from "../../policy/types.ts";

/**
 * `defineTool` declares a tool's access with plan 09's `AccessSpec`
 * (`{ risk, minRole?, confirm?, reason? }`) and stamps it via the policy
 * `access()` marker, so `applyPolicy` enforces defineTool'd tools and
 * hand-`access()`-wrapped tools through one path. Tool files declare intent
 * here instead of wrapping exports by hand.
 */
type ToolErrorClass =
  | "not-found"
  | "permission"
  | "rate-limit"
  | "invalid-input"
  | "transient"
  | "unknown";

interface ToolMeta {
  name: string;
  domain: string;
  access: AccessSpec;
  outputBudget: number;
}

const TOOL_META = Symbol("toolMeta");

const DEFAULT_OUTPUT_BUDGET = 4000;

/** Read the metadata `defineTool` stamped on a tool, or null for hand-rolled tools. */
export function getToolMeta(t: unknown): ToolMeta | null {
  if (!t || typeof t !== "object") return null;
  const meta = (t as Record<symbol, unknown>)[TOOL_META];
  return meta ? (meta as ToolMeta) : null;
}

function extractStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const status = [e.status, e.statusCode, e.response?.status].find(
    (candidate): candidate is number => typeof candidate === "number",
  );
  return status ?? null;
}

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // The envelope is model-facing: keep the first line (no stacks) and cap it.
  const firstLine = raw.split("\n")[0] ?? "";
  return firstLine.length > 500 ? `${firstLine.slice(0, 500)}…` : firstLine;
}

export function classifyToolError(err: unknown): ToolErrorClass {
  if (err instanceof z.ZodError) return "invalid-input";
  const status = extractStatus(err);
  if (status === 404) return "not-found";
  if (status === 401 || status === 403) return "permission";
  if (status === 429) return "rate-limit";
  if (status === 400 || status === 422) return "invalid-input";
  if (status !== null && status >= 500) return "transient";

  const msg = errorMessage(err).toLowerCase();
  if (/\bnot found\b|\bno such\b|\bdoes not exist\b|\b404\b/.test(msg)) return "not-found";
  if (/\bunauthorized\b|\bforbidden\b|\bpermission\b|\baccess denied\b|\b401\b|\b403\b/.test(msg))
    return "permission";
  if (/\brate limit\b|\btoo many requests\b|\b429\b/.test(msg)) return "rate-limit";
  if (/\binvalid\b|\bvalidation\b|\bbad request\b|\b422\b/.test(msg)) return "invalid-input";
  if (
    /\btimeout\b|\btimed out\b|\babort|\beconn|\benotfound\b|\bfetch failed\b|\bnetwork\b|\bsocket\b|\b5\d\d\b/.test(
      msg,
    )
  )
    return "transient";
  return "unknown";
}

const ERROR_HINTS: Record<ToolErrorClass, string> = {
  "not-found": "Check the identifier — a matching list_/search_ tool can confirm it exists.",
  permission: "The current credentials don't allow this operation.",
  "rate-limit": "Hit a rate limit — wait a moment and retry, or narrow the request.",
  "invalid-input": "Adjust the arguments to match the input schema and try again.",
  transient: "Transient upstream failure — retry once; if it persists, report the error.",
  unknown: "If retrying doesn't help, report this error to the user.",
};

function errorEnvelope(name: string, cls: ToolErrorClass, err: unknown): string {
  return `${name} failed (${cls}): ${errorMessage(err)} — ${ERROR_HINTS[cls]}`;
}

/**
 * Shrink a JSON payload to `budget` chars by dropping trailing items from its
 * dominant array (the root, or an object's single non-empty array field), so
 * the model sees well-formed JSON plus an explicit truncation marker instead
 * of a mid-token cut. Returns null when there is no such array to shrink.
 */
function truncateItems(text: string, budget: number): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  let items: unknown[];
  let rebuild: (slice: unknown[]) => unknown;
  if (Array.isArray(parsed)) {
    items = parsed;
    rebuild = (slice) => slice;
  } else if (parsed && typeof parsed === "object") {
    const arrays = Object.entries(parsed).filter(
      (entry): entry is [string, unknown[]] => Array.isArray(entry[1]) && entry[1].length > 0,
    );
    if (arrays.length !== 1) return null;
    const [key, arr] = arrays[0]!;
    items = arr;
    rebuild = (slice) => ({ ...(parsed as object), [key]: slice });
  } else {
    return null;
  }

  const total = items.length;
  const marker = (kept: number) =>
    `\n[truncated — ${kept} of ${total} items shown; refine your query or paginate]`;

  // Serialized length grows monotonically with kept items, so binary-search
  // the largest prefix that fits.
  let lo = 1;
  let hi = total - 1;
  let best: string | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = JSON.stringify(rebuild(items.slice(0, mid))) + marker(mid);
    if (candidate.length <= budget) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function enforceBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const itemTruncated = truncateItems(text, budget);
  if (itemTruncated) return itemTruncated;
  return (
    text.slice(0, budget) +
    `\n[truncated — ${budget} of ${text.length} chars shown; refine your query or paginate]`
  );
}

/**
 * Uniform authoring surface for the tool catalog. Wraps the AI SDK's `tool()`
 * with the four cross-cutting behaviors every tool needs:
 *
 * 1. Access — records the policy `AccessSpec` on the tool's metadata (the
 *    single marker `applyPolicy` reads via `resolveAccessSpec`), so the tool
 *    is gated/confirmed uniformly and call sites stop hand-wrapping exports.
 * 2. Error envelope — failures come back as a one-line, model-actionable
 *    string (classified not-found / permission / rate-limit / invalid-input /
 *    transient), never a stack. Counted as `tool.error{domain, tool, class}`.
 *    Errors are returned, not rethrown — throws are reserved for bugs.
 * 3. Output budget — results beyond `outputBudget` chars (default 4000) are
 *    truncated with an explicit marker, item-aware for JSON list payloads.
 * 4. Telemetry — a `tool.execute` span (domain/tool/outcome attrs) plus
 *    `tool.called{domain, tool}`, cheap aggregates independent of sampling.
 *
 * `execute` may be a normal async function or an async generator. Streaming
 * tools (e.g. the sandbox's `bash`) take the generator path: their chunks pass
 * through untouched (no mid-stream budget truncation), with telemetry and a
 * final error envelope still applied — yielded as a UIMessage text part so a
 * streaming tool's `toModelOutput` surfaces it rather than dropping it.
 *
 * Approval denials happen in `applyPolicy`, outside this wrapper, so the
 * envelope can never swallow them.
 */
export function defineTool<I extends z.ZodObject>(spec: {
  /** Must match the export name — enforced by the domain coverage tests. */
  name: string;
  domain: string;
  description: string;
  access: AccessSpec;
  input: I;
  outputBudget?: number;
  /**
   * Optional passthrough to the AI SDK's `tool().toModelOutput` — maps the
   * yielded/returned value to the model-facing output. Streaming tools (e.g.
   * `bash`) use it to pick the final text part out of their UIMessage stream.
   */
  toModelOutput?: (options: { output: unknown }) => { type: "text"; value: string };
  execute: (input: z.output<I>, ctx: ToolCallOptions) => Promise<unknown> | AsyncIterable<unknown>;
}) {
  const { name, domain, access: accessSpec, outputBudget = DEFAULT_OUTPUT_BUDGET } = spec;
  const isStreaming = spec.execute.constructor.name === "AsyncGeneratorFunction";

  const streamingExecute = async function* (input: z.output<I>, ctx: ToolCallOptions) {
    countMetric("tool.called", { domain, tool: name });
    try {
      yield* spec.execute(input, ctx) as AsyncIterable<unknown>;
    } catch (err) {
      const cls = classifyToolError(err);
      countMetric("tool.error", { domain, tool: name, class: cls });
      // Yield the envelope as a UIMessage text part, not a bare string. A
      // streaming tool's `toModelOutput` reads the final chunk's `parts`
      // (see `bash`), so a bare string would be dropped to its fallback and
      // the model would never see the classified error. This mirrors the
      // UIMessage chunks streaming tools yield on their happy path.
      yield {
        id: `${name}-error`,
        role: "assistant",
        parts: [{ type: "text", text: errorEnvelope(name, cls, err) }],
      } as unknown as UIMessage;
    }
  };

  const bufferedExecute = (input: z.output<I>, ctx: ToolCallOptions) =>
    withSpan("tool.execute", { "tool.domain": domain, "tool.name": name }, async (span) => {
      countMetric("tool.called", { domain, tool: name });
      try {
        const result = await (spec.execute(input, ctx) as Promise<unknown>);
        const text =
          typeof result === "string" ? result : (JSON.stringify(result) ?? String(result));
        span.setAttribute("tool.outcome", "ok");
        return enforceBudget(text, outputBudget);
      } catch (err) {
        const cls = classifyToolError(err);
        countMetric("tool.error", { domain, tool: name, class: cls });
        span.setAttribute("tool.outcome", "error");
        span.setAttribute("tool.error_class", cls);
        return errorEnvelope(name, cls, err);
      }
    });

  const wrapped = tool({
    description: spec.description,
    inputSchema: spec.input,
    execute: isStreaming ? streamingExecute : bufferedExecute,
    ...(spec.toModelOutput ? { toModelOutput: spec.toModelOutput } : {}),
  });

  // Single marker: the access spec lives only on the tool meta, read by
  // `applyPolicy` via `resolveAccessSpec`. No separate `access()` stamp.
  (wrapped as unknown as Record<symbol, ToolMeta>)[TOOL_META] = {
    name,
    domain,
    access: accessSpec,
    outputBudget,
  };
  return wrapped;
}
