import { tool, type ToolCallOptions } from "ai";
import { z } from "zod";

import { countMetric } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";

import type { ApprovalOptions } from "../../approvals/types.ts";

import { approval } from "../../approvals/index.ts";
import { admin } from "../../skills/admin.ts";

/**
 * Access semantics for a tool, applied uniformly by `defineTool`:
 * - `"open"` — visible to any role that can reach the domain.
 * - `"admin"` — stripped for non-admin roles (see `filterAdmin`).
 * - `"approval"` — requires per-call user approval (see `wrapApprovalTools`).
 *
 * Pass `{ approval: {...} }` to attach `ApprovalOptions` (e.g. a static reason).
 * This is the seam where plan 09's richer access descriptor slots in later —
 * tool files declare intent here instead of wrapping exports by hand.
 * (Kept module-private: exported string unions are disallowed, and call sites
 * only ever pass literals.)
 */
type AccessSpec = "open" | "admin" | "approval" | { approval: ApprovalOptions };

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

function applyAccess<T>(t: T, access: AccessSpec): T {
  if (access === "admin") return admin(t);
  if (access === "approval") return approval(t);
  if (typeof access === "object") return approval(t, access.approval);
  return t;
}

/**
 * Uniform authoring surface for the tool catalog. Wraps the AI SDK's `tool()`
 * with the four cross-cutting behaviors every tool needs:
 *
 * 1. Access — applies the `admin()`/`approval()` markers from `access`, so
 *    call sites stop hand-wrapping exports.
 * 2. Error envelope — failures come back as a one-line, model-actionable
 *    string (classified not-found / permission / rate-limit / invalid-input /
 *    transient), never a stack. Counted as `tool.error{domain, tool, class}`.
 *    Errors are returned, not rethrown — throws are reserved for bugs.
 * 3. Output budget — results beyond `outputBudget` chars (default 4000) are
 *    truncated with an explicit marker, item-aware for JSON list payloads.
 * 4. Telemetry — a `tool.execute` span (domain/tool/outcome attrs) plus
 *    `tool.called{domain, tool}`, cheap aggregates independent of sampling.
 *
 * Approval denials happen in `wrapApprovalTools`, outside this wrapper, so the
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
  execute: (input: z.output<I>, ctx: ToolCallOptions) => Promise<unknown>;
}) {
  const { name, domain, access, outputBudget = DEFAULT_OUTPUT_BUDGET } = spec;

  const wrapped = tool({
    description: spec.description,
    inputSchema: spec.input,
    execute: (input: z.output<I>, ctx: ToolCallOptions) =>
      withSpan("tool.execute", { "tool.domain": domain, "tool.name": name }, async (span) => {
        countMetric("tool.called", { domain, tool: name });
        try {
          const result = await spec.execute(input, ctx);
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
      }),
  });

  (wrapped as unknown as Record<symbol, ToolMeta>)[TOOL_META] = {
    name,
    domain,
    access,
    outputBudget,
  };
  return applyAccess(wrapped, access);
}
