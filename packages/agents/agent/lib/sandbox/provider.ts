import { createHash } from "node:crypto";
import { posix } from "node:path";

import type {
  SandboxProviderImplementation,
  SandboxProviderPrepareContext,
} from "eve/sandbox/provider";
import { z } from "zod";

import { workspaceScope } from "./operation.ts";
import { DurableSession, handle } from "./session.ts";
import { capture, restore, snapshotSchema } from "./snapshot.ts";
import { WorkspaceStore } from "./store.ts";

const artifactSchema = z.strictObject({
  version: z.literal(2),
  key: z.string().length(64),
  snapshot: snapshotSchema,
});
const stateSchema = z.strictObject({
  version: z.literal(2),
  scope: z.string().length(64),
  generation: z.uuid(),
});
export type Artifact = z.output<typeof artifactSchema>;
export type State = z.output<typeof stateSchema>;

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function prepare(ctx: SandboxProviderPrepareContext): Promise<Artifact> {
  const fs = await restore({ version: 1, entries: [] });
  await fs.mkdir("/home/wack", { recursive: true });
  for (const tree of [ctx.resources.workspace, ctx.resources.skills]) {
    if (tree === undefined) continue;
    const target = tree.targetPath.replace(/^\$HOME(?=\/|$)/u, "/home/wack");
    for (const file of tree.files) {
      const path = posix.resolve(target, file.relativePath);
      if (!path.startsWith(`${target}/`)) throw new Error("Invalid sandbox seed path");
      await fs.mkdir(posix.dirname(path), { recursive: true });
      await fs.writeFile(path, file.content);
    }
  }
  const snapshot = await capture(fs);
  // Timestamp-independent artifact identity. Durable scope remains session-owned
  // across compatible artifacts; the artifact itself carries all seed bytes.
  const key = hash(
    JSON.stringify([
      "wack-durable-bash-v2",
      ctx.sourceRevision,
      snapshot.entries.map((entry) => (entry.kind === "symlink" ? entry : { ...entry, mtime: 0 })),
    ]),
  );
  return { version: 2, key, snapshot };
}

function validateState(sessionId: string, input: Artifact, state: State): State {
  artifactSchema.parse(input);
  const parsed = stateSchema.parse(state);
  if (parsed.scope !== workspaceScope(sessionId))
    throw new Error("Workspace state does not belong to this session and provider protocol");
  return parsed;
}

/** Export the implementation factory for lifecycle tests with a local database. */
export function durableBashImplementation(
  store: () => WorkspaceStore,
): SandboxProviderImplementation<undefined, Artifact, State, DurableSession> {
  return {
    prepare,
    async start(ctx, _options, input) {
      const artifact = artifactSchema.parse(input);
      const database = store();
      const record = await database.open(workspaceScope(ctx.session.id), artifact.snapshot);
      return {
        handle: handle(database, record),
        state: { version: 2, scope: record.scope, generation: record.generation },
      };
    },
    async resume(ctx, artifact, input) {
      const state = validateState(ctx.session.id, artifact, input);
      const database = store();
      return handle(database, await database.read(state.scope, state.generation));
    },
    async onSessionEnd(ctx, artifact, input) {
      const state = validateState(ctx.session.id, artifact, input);
      await store().delete(state.scope, state.generation);
    },
  };
}
