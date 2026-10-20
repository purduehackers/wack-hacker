import type { Client, InValue } from "@libsql/client";
import { jsonCodec } from "@repo/shared/json";
import { z } from "zod";

import { limits, snapshotSchema, type Snapshot } from "./snapshot.ts";

const rowSchema = z.object({
  scope: z.string(),
  generation: z.uuid(),
  revision: z.int().nonnegative(),
  commit_id: z.uuid(),
  snapshot: z.string().max(limits.snapshotBytes),
  deleted: z.literal([0, 1]),
});

export interface WorkspaceRecord {
  readonly scope: string;
  readonly generation: string;
  readonly revision: number;
  readonly commitId: string;
  readonly snapshot: Snapshot;
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
  private readonly client: Pick<Client, "execute">;
  constructor(client: Pick<Client, "execute">) {
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
    };
  }

  async read(scope: string, generation: string): Promise<WorkspaceRecord> {
    const row = await this.row(scope);
    if (row === undefined || row.generation !== generation) throw new StaleWorkspaceError();
    return this.decode(row);
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
            sql: "UPDATE agent_workspaces SET generation = ?, revision = 0, commit_id = ?, snapshot = ?, deleted = 0, updated_at = ? WHERE scope = ? AND generation = ? AND deleted = 1",
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
    if (current === undefined || current.deleted === 1 || current.generation !== generation) return;
    await this.mutate({
      prior: this.decode(current),
      commitId: crypto.randomUUID(),
      deleted: true,
      encoded: "{}",
    });
  }
}
