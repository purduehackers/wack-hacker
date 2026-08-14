import { createHash, randomUUID } from "node:crypto";

import { actionAudit, getDb } from "@repo/shared/db";
import type { Db, TursoConfig } from "@repo/shared/db";
import type { AuditDecision } from "@repo/shared/db/enums";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import { createRedactor } from "../json.ts";
import { countAgentEvent, currentTraceId } from "../telemetry.ts";
import type { PolicyPrincipal, RiskLevel } from "./types.ts";

const MAX_PREVIEW = 1_000;

/** Tighter caps than the Eve JSON boundary: the preview lands in a 1000-char column. */
const redact = createRedactor({
  sensitiveKey:
    /authorization|cookie|credential|password|secret|token|api[-_]?key|private[-_]?key/iu,
  maxArrayItems: 50,
  maxEntries: 100,
});

/** Hash-and-preview projection of a tool input, sized for the audit row. */
interface AuditInputDigest {
  readonly hash: string;
  readonly preview: string;
}

function auditInput(input: unknown): AuditInputDigest {
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
  readonly decision: AuditDecision;
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
