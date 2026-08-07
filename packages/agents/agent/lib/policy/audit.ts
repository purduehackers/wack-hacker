import { createHash, randomUUID } from "node:crypto";

import { AuditDecision, actionAudit, getDb } from "@repo/shared/db";
import type { Db, TursoConfig } from "@repo/shared/db";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import { countAgentEvent, currentTraceId } from "../telemetry.ts";
import type { PolicyPrincipal, RiskLevel } from "./types.ts";

const SECRET_KEY =
  /authorization|cookie|credential|password|secret|token|api[-_]?key|private[-_]?key/iu;
const MAX_PREVIEW = 1_000;

function redact(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (depth >= 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, "", depth + 1));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 100)
      .map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey, depth + 1)]),
  );
}

export function auditInput(input: unknown): { readonly hash: string; readonly preview: string } {
  const serialized = JSON.stringify(redact(input)) ?? "null";
  return {
    hash: createHash("sha256").update(serialized).digest("hex"),
    preview:
      serialized.length <= MAX_PREVIEW
        ? serialized
        : `${serialized.slice(0, MAX_PREVIEW)}…[truncated]`,
  };
}

export interface ActionAuditRecord {
  readonly id?: string;
  readonly at?: Date;
  readonly principal: PolicyPrincipal;
  readonly delegate?: string;
  readonly tool: string;
  readonly risk: RiskLevel;
  readonly input: unknown;
  readonly reason?: string;
  readonly decision: (typeof AuditDecision)[keyof typeof AuditDecision];
  readonly decidedBy?: string;
  readonly traceId?: string;
}

/** Append-only Turso writer. Audit failure is observable but never authorizes an action. */
export class AuditStore {
  private readonly config: TursoConfig;
  private db: Db | undefined;

  constructor(config: TursoConfig) {
    this.config = config;
  }

  async record(record: ActionAuditRecord): Promise<Result<void, Transient>> {
    return Result.tryPromise({
      try: async () => {
        const protectedInput = auditInput(record.input);
        this.db ??= getDb(this.config);
        await this.db.insert(actionAudit).values({
          id: record.id ?? randomUUID(),
          at: (record.at ?? new Date()).toISOString(),
          userId: record.principal.userId,
          role: record.principal.role,
          source: record.principal.source,
          delegate: record.delegate,
          tool: record.tool,
          risk: record.risk,
          inputHash: protectedInput.hash,
          inputPreview: protectedInput.preview,
          reason: record.reason,
          decision: record.decision,
          decidedBy: record.decidedBy,
          traceId: record.traceId ?? currentTraceId(),
        });
        countAgentEvent("agent.policy.audit", {
          decision: record.decision,
          risk: record.risk,
          delegate: record.delegate ?? "root",
          tool: record.tool,
          status: "recorded",
        });
      },
      catch: (cause) => {
        countAgentEvent("agent.policy.audit", {
          decision: record.decision,
          risk: record.risk,
          delegate: record.delegate ?? "root",
          tool: record.tool,
          status: "unavailable",
        });
        return new Transient({
          operation: "append action audit",
          detail: cause instanceof Error ? cause.name : "audit store unavailable",
        });
      },
    });
  }
}

export function createAuditStore(config: TursoConfig): AuditStore {
  return new AuditStore(config);
}
