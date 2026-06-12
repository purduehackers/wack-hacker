import { trace } from "@opentelemetry/api";
import { log } from "evlog";
import { createHash } from "node:crypto";

import { getDb } from "@/lib/db/index.ts";
import { actionAudit } from "@/lib/db/schemas/action-audit.ts";
import { countMetric } from "@/lib/metrics";

import type { ActionAuditEntry, AuditLogLike } from "./types.ts";

const PREVIEW_MAX_LEN = 300;

/** Stable-enough content hash for correlating audit rows with identical inputs. */
export function hashInput(input: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(input ?? null) ?? "null";
  } catch {
    serialized = "<unserializable>";
  }
  return createHash("sha256").update(serialized).digest("hex");
}

/** Truncated JSON preview safe to render in Discord / dashboards. */
export function previewInput(input: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(input ?? null) ?? "null";
  } catch {
    serialized = "<unserializable>";
  }
  return serialized.length <= PREVIEW_MAX_LEN
    ? serialized
    : `${serialized.slice(0, PREVIEW_MAX_LEN - 1)}…`;
}

type Db = ReturnType<typeof getDb>;

/**
 * Turso-backed append-only audit writer. `record()` never throws — an audit
 * outage must not block the action it describes — but failures are counted
 * and logged so silence is observable.
 */
export class AuditLog implements AuditLogLike {
  constructor(private db?: Db) {}

  async record(entry: ActionAuditEntry): Promise<void> {
    try {
      const db = this.db ?? getDb();
      await db.insert(actionAudit).values({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        userId: entry.userId,
        role: entry.role,
        source: entry.source,
        delegate: entry.delegate ?? null,
        tool: entry.tool,
        risk: entry.risk,
        inputHash: hashInput(entry.input),
        inputPreview: previewInput(entry.input),
        reason: entry.reason ?? null,
        decision: entry.decision,
        decidedBy: entry.decidedBy ?? null,
        traceId: entry.traceId ?? trace.getActiveSpan()?.spanContext().traceId ?? null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      countMetric("policy.audit_write_failed");
      log.warn("audit", `Failed to record ${entry.decision} for ${entry.tool}: ${message}`);
    }
  }
}
