import type { Client, InValue } from "@libsql/client";
import { jsonCodec } from "@repo/shared/json";
import { z } from "zod";

import {
  operationLimits,
  operationResultSchema,
  type RecordedOperation,
  type OperationResult,
  type WorkspaceReference,
} from "./operation.ts";
import { limits, snapshotSchema, type Snapshot } from "./snapshot.ts";

const rowSchema = z.object({
  scope: z.string(),
  generation: z.uuid(),
  revision: z.int().nonnegative(),
  commit_id: z.uuid(),
  snapshot: z.string().max(limits.snapshotBytes),
  deleted: z.literal([0, 1]),
  receipt_count: z.int().nonnegative(),
  receipt_bytes: z.int().nonnegative(),
});

export interface WorkspaceRecord {
  readonly scope: string;
  readonly generation: string;
  readonly revision: number;
  readonly commitId: string;
  readonly snapshot: Snapshot;
  readonly receiptCount: number;
  readonly receiptBytes: number;
}

export class StaleWorkspaceError extends Error {
  constructor() {
    super("Workspace changed concurrently or was deleted. Reopen it before continuing.");
  }
}

function encode(snapshot: Snapshot): string {
  const text = z.encode(jsonCodec(snapshotSchema), snapshot);
  if (Buffer.byteLength(text) > limits.snapshotBytes)
    throw new Error("Encoded workspace snapshot limit exceeded");
  return text;
}

/** Only this trusted adapter sees database credentials. Commands receive virtual bytes. */
export class WorkspaceStore {
  private readonly client: Pick<Client, "execute" | "batch">;
  constructor(client: Pick<Client, "execute" | "batch">) {
    this.client = client;
  }

  private async row(scope: string) {
    const result = await this.client.execute({
      sql: "SELECT * FROM agent_workspaces WHERE scope = ?",
      args: [scope],
    });
    const first = result.rows[0];
    return first === undefined ? undefined : rowSchema.parse(first);
  }

  private decode(row: z.output<typeof rowSchema>): WorkspaceRecord {
    if (row.deleted === 1) throw new StaleWorkspaceError();
    if (Buffer.byteLength(row.snapshot) > limits.snapshotBytes)
      throw new Error("Encoded workspace snapshot limit exceeded");
    return {
      scope: row.scope,
      generation: row.generation,
      revision: row.revision,
      commitId: row.commit_id,
      snapshot: jsonCodec(snapshotSchema).parse(row.snapshot),
      receiptCount: row.receipt_count,
      receiptBytes: row.receipt_bytes,
    };
  }

  async read(scope: string, generation: string): Promise<WorkspaceRecord> {
    const row = await this.row(scope);
    if (row === undefined || row.generation !== generation) throw new StaleWorkspaceError();
    return this.decode(row);
  }

  async reference(scope: string): Promise<WorkspaceReference> {
    const row = await this.row(scope);
    if (row === undefined || row.deleted === 1)
      throw new Error(
        "Open the workspace with workspace_open or read_file before using bash or write_file.",
      );
    return { scope, generation: row.generation };
  }

  /** Start retries recover the active generation; explicit delete permits a fresh one. */
  async open(scope: string, snapshot: Snapshot): Promise<WorkspaceRecord> {
    const prior = await this.row(scope);
    if (prior !== undefined && prior.deleted === 0) return this.decode(prior);
    const generation = crypto.randomUUID();
    const commitId = crypto.randomUUID();
    const encoded = encode(snapshot);
    const query =
      prior === undefined
        ? {
            sql: "INSERT INTO agent_workspaces (scope, generation, revision, commit_id, snapshot, deleted, updated_at) VALUES (?, ?, 0, ?, ?, 0, ?) ON CONFLICT(scope) DO NOTHING",
            args: [scope, generation, commitId, encoded, Date.now()],
          }
        : {
            sql: "UPDATE agent_workspaces SET generation = ?, revision = 0, commit_id = ?, snapshot = ?, deleted = 0, receipt_count = 0, receipt_bytes = 0, updated_at = ? WHERE scope = ? AND generation = ? AND deleted = 1",
            args: [generation, commitId, encoded, Date.now(), scope, prior.generation],
          };
    // INSERT/UPDATE may commit even if its HTTP response is lost. Read the active
    // generation instead of blindly repeating the write or creating another row.
    let failure: unknown;
    try {
      await this.client.execute(query);
    } catch (error) {
      failure = error;
    }
    const current = await this.row(scope);
    if (current === undefined || current.deleted === 1) {
      throw new Error("Workspace creation was not confirmed", { cause: failure });
    }
    return this.decode(current);
  }

  async commit(prior: WorkspaceRecord, snapshot: Snapshot): Promise<WorkspaceRecord> {
    const commitId = crypto.randomUUID();
    const encoded = encode(snapshot);
    await this.mutate({ prior, commitId, deleted: false, encoded });
    return { ...prior, revision: prior.revision + 1, commitId, snapshot };
  }

  async receipt(
    reference: WorkspaceReference,
    operation: RecordedOperation,
  ): Promise<OperationResult | undefined> {
    const result = await this.client.execute({
      sql: "SELECT owner, fingerprint, result FROM agent_workspace_operations WHERE scope = ? AND generation = ? AND operation_key = ?",
      args: [reference.scope, reference.generation, operation.key],
    });
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const receipt = z
      .object({ owner: z.string(), fingerprint: z.string(), result: z.string() })
      .parse(row);
    if (receipt.owner !== operation.owner)
      throw new Error(
        "Ambiguous workspace call: a different Workflow run already committed this turn/call identity. Inspect the workspace before issuing any replacement command.",
      );
    if (receipt.fingerprint !== operation.fingerprint)
      throw new Error("Workspace operation identity was reused with a different payload");
    return jsonCodec(operationResultSchema).parse(receipt.result);
  }

  /** Both statements commit in one libSQL write transaction, or neither does. */
  async commitOperation(
    prior: WorkspaceRecord,
    snapshot: Snapshot,
    operation: RecordedOperation,
    output: OperationResult,
  ): Promise<OperationResult> {
    const encoded = encode(snapshot);
    const result = z.encode(jsonCodec(operationResultSchema), output);
    const bytes = Buffer.byteLength(result);
    if (bytes > limits.outputBytes * 12 + 1024)
      throw new Error("Workspace operation result limit exceeded");
    const commitId = crypto.randomUUID();
    let failure: unknown;
    try {
      await this.client.batch(
        [
          {
            sql: "UPDATE agent_workspaces SET revision = revision + 1, commit_id = ?, snapshot = ?, receipt_count = receipt_count + 1, receipt_bytes = receipt_bytes + ?, updated_at = ? WHERE scope = ? AND generation = ? AND revision = ? AND deleted = 0 AND receipt_count < ? AND receipt_bytes + ? <= ? AND NOT EXISTS (SELECT 1 FROM agent_workspace_operations WHERE scope = ? AND generation = ? AND operation_key = ?)",
            args: [
              commitId,
              encoded,
              bytes,
              Date.now(),
              prior.scope,
              prior.generation,
              prior.revision,
              operationLimits.count,
              bytes,
              operationLimits.bytes,
              prior.scope,
              prior.generation,
              operation.key,
            ],
          },
          {
            sql: "INSERT INTO agent_workspace_operations (scope, generation, operation_key, owner, fingerprint, result, created_at) SELECT scope, generation, ?, ?, ?, ?, ? FROM agent_workspaces WHERE scope = ? AND generation = ? AND commit_id = ? AND deleted = 0",
            args: [
              operation.key,
              operation.owner,
              operation.fingerprint,
              result,
              Date.now(),
              prior.scope,
              prior.generation,
              commitId,
            ],
          },
        ],
        "write",
      );
    } catch (cause) {
      failure = cause;
    }
    // Immutable per-call receipts survive later writes. A lost response is safe
    // to retry only with this exact identity, even when confirmation also fails.
    const receipt = await this.receipt(prior, operation);
    if (receipt !== undefined) return receipt;
    if (failure !== undefined)
      throw new Error(
        "Workspace operation commit was not confirmed; retry only the same Workflow operation",
        { cause: failure },
      );
    const current = await this.read(prior.scope, prior.generation);
    if (
      current.receiptCount >= operationLimits.count ||
      current.receiptBytes + bytes > operationLimits.bytes
    )
      throw new Error(
        "Workspace operation receipt limit reached; an operator must retire this workspace",
      );
    throw new StaleWorkspaceError();
  }

  private async mutate(input: {
    prior: WorkspaceRecord;
    commitId: string;
    deleted: boolean;
    encoded: string;
  }): Promise<void> {
    const { prior, commitId, deleted, encoded } = input;
    const args: InValue[] = [
      commitId,
      encoded,
      Number(deleted),
      Date.now(),
      prior.scope,
      prior.generation,
      prior.revision,
    ];
    try {
      const result = await this.client.execute({
        sql: "UPDATE agent_workspaces SET revision = revision + 1, commit_id = ?, snapshot = ?, deleted = ?, updated_at = ? WHERE scope = ? AND generation = ? AND revision = ? AND deleted = 0",
        args,
      });
      if (result.rowsAffected === 1) return;
    } catch (cause) {
      // A matching durable receipt proves success after a lost response. If a
      // later writer has advanced it, the outcome is ambiguous: fail closed.
      const current = await this.row(prior.scope);
      if (current?.generation === prior.generation && current.commit_id === commitId) return;
      throw new Error("Workspace commit was not confirmed; reopen and inspect before retrying", {
        cause,
      });
    }
    throw new StaleWorkspaceError();
  }

  async delete(scope: string, generation: string): Promise<void> {
    const current = await this.row(scope);
    // An old handle or repeated cleanup must never delete a newer generation.
    if (current !== undefined && current.deleted === 0 && current.generation === generation) {
      await this.mutate({
        prior: this.decode(current),
        commitId: crypto.randomUUID(),
        deleted: true,
        encoded: "{}",
      });
    }
    // Retried cleanup still clears receipts after the snapshot became a tombstone.
    await this.client.execute({
      sql: "DELETE FROM agent_workspace_operations WHERE scope = ? AND generation = ?",
      args: [scope, generation],
    });
  }
}
