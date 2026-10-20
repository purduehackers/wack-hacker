import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";

import { createClient } from "@libsql/client";
import { z } from "zod";

import {
  operationIdentity,
  workspaceScope,
  type WorkspaceReference,
} from "../../agent/lib/sandbox/operation.ts";
import { DurableSession } from "../../agent/lib/sandbox/session.ts";
import { capture, restore } from "../../agent/lib/sandbox/snapshot.ts";
import { WorkspaceStore } from "../../agent/lib/sandbox/store.ts";
import type { sandboxWorkflowArtifact } from "./sandbox-artifact.ts";

const contextSchema = z.object({
  callId: z.string(),
  toolName: z.string(),
  session: z.object({ id: z.string(), turn: z.object({ id: z.string() }) }),
});
const referenceSchema = z.object({ scope: z.string(), generation: z.string() });

async function mutateWorkspace(
  store: WorkspaceStore,
  reference: WorkspaceReference,
  context: z.output<typeof contextSchema>,
  rawInput: unknown,
) {
  const sandbox = new DurableSession(
    store,
    await store.read(reference.scope, reference.generation),
  );
  const identity = operationIdentity({
    sessionId: context.session.id,
    turnId: context.session.turn.id,
    callId: context.callId,
    toolName: context.toolName,
    workflowRunId: `run-${context.toolName}`,
  });
  try {
    if (context.toolName === "bash") {
      const input = z.object({ command: z.string() }).parse(rawInput);
      return { status: "completed", ...(await sandbox.run(input, identity)) };
    }
    const input = z
      .object({ filePath: z.string(), content: z.string(), expectedSha256: z.string() })
      .parse(rawInput);
    return await sandbox.replaceFile({ ...input, path: input.filePath }, identity);
  } finally {
    await sandbox.close();
  }
}

/**
 * Execute the emitted workflow body with a simulated durable step journal.
 * The real database commits, but the first mutation's step result is lost.
 * This checks compiled call ordering/arguments, not a deployed Workflow engine.
 */
export async function verifyCompiledWorkspaceReplay(
  artifact: ReturnType<typeof sandboxWorkflowArtifact>,
): Promise<void> {
  const client = createClient({ url: "file::memory:" });
  try {
    for (const name of ["0001_agent_workspaces", "0002_workspace_operations"]) {
      await client.executeMultiple(
        await Bun.file(new URL(`../../../shared/migrations/${name}.sql`, import.meta.url)).text(),
      );
    }
    const store = new WorkspaceStore(client);
    const original = await store.open(
      workspaceScope("compiled-probe"),
      await capture(await restore({ version: 1, entries: [] })),
    );
    for (const toolName of ["bash", "write_file"]) {
      const workflowId = artifact.workflows.find((tool) => tool.name === toolName)?.workflowId;
      assert.ok(workflowId);
      const context = {
        session: { id: "compiled-probe", turn: { id: "turn-1" } },
        callId: `call-${toolName}`,
        toolName,
      };
      let reference: WorkspaceReference | undefined;
      let loseResult = true;
      let committed: unknown;
      const calls: string[] = [];
      const vm = {
        Map,
        URL,
        TextEncoder,
        TextDecoder,
        [Symbol.for("WORKFLOW_USE_STEP")]:
          (name: string) =>
          async (...args: unknown[]) => {
            // Authorization retries are not exercised by this plain context.
            assert.ok(!name.endsWith(":eve-authorization"));
            if (name.endsWith("//resolveWorkspace")) {
              calls.push("resolve");
              assert.deepEqual(contextSchema.parse(args[0]), context);
              reference ??= await store.reference(workspaceScope(context.session.id));
              return structuredClone(reference);
            }
            const expected =
              toolName === "bash" ? "//runWorkspaceCommand" : "//replaceWorkspaceFile";
            assert.ok(name.endsWith(expected));
            calls.push("mutate");
            assert.ok(reference);
            const pinned = referenceSchema.parse(args[0]);
            assert.deepEqual(pinned, reference);
            assert.deepEqual(contextSchema.parse(args[2]), context);
            committed = await mutateWorkspace(store, pinned, context, args[1]);
            if (loseResult) {
              loseResult = false;
              throw new Error("simulated loss before mutation step checkpoint");
            }
            return committed;
          },
      };
      runInNewContext(artifact.driver, vm, { timeout: 1000 });
      const registry = z
        .object({
          __private_workflows: z.map(
            z.string(),
            z.function({ input: [z.unknown(), z.unknown()], output: z.promise(z.unknown()) }),
          ),
        })
        .parse(vm).__private_workflows;
      const execute = registry.get(workflowId);
      assert.ok(execute);
      const input =
        toolName === "bash"
          ? { command: "printf event >> replay.log; cat replay.log" }
          : { filePath: "written.txt", content: "original", expectedSha256: "missing" };
      await assert.rejects(execute(input, context), /simulated loss/u);
      const first = committed;
      assert.deepEqual(await execute(input, context), first);
      assert.deepEqual(calls, ["resolve", "mutate", "resolve", "mutate"]);
    }
    const final = await store.read(original.scope, original.generation);
    const sandbox = new DurableSession(store, final);
    assert.equal(await sandbox.readTextFile({ path: "replay.log" }), "event");
    assert.equal(await sandbox.readTextFile({ path: "written.txt" }), "original");
    assert.equal(final.receiptCount, 2);
    await sandbox.close();
  } finally {
    client.close();
  }
}
