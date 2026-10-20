import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type Client } from "@libsql/client";
import { InMemoryFs } from "just-bash";

import {
  hash,
  operationIdentity,
  operationLimits,
  operationPayload,
} from "../../agent/lib/sandbox/operation.ts";
import { durableBashImplementation } from "../../agent/lib/sandbox/provider.ts";
import { DurableSession } from "../../agent/lib/sandbox/session.ts";
import { capture, restore, WorkspaceFs } from "../../agent/lib/sandbox/snapshot.ts";
import { WorkspaceStore } from "../../agent/lib/sandbox/store.ts";
import { prepareContext, sessionContext, testOperation } from "./sandbox-fixtures.ts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function database(url = "file::memory:") {
  const client = createClient({ url });
  cleanup.push(() => client.close());
  for (const migration of ["0001_agent_workspaces", "0002_workspace_operations"]) {
    await client.executeMultiple(
      await Bun.file(
        new URL(`../../../shared/migrations/${migration}.sql`, import.meta.url),
      ).text(),
    );
  }
  return client;
}

async function fixture(client?: Client) {
  const databaseClient = client ?? (await database());
  const store = new WorkspaceStore(databaseClient);
  const provider = durableBashImplementation(() => store);
  const context = sessionContext();
  const artifact = await provider.prepare(prepareContext());
  const opened = await provider.start(context, undefined, artifact);
  cleanup.push(() => opened.handle.onRuntimeShutdown());
  const fresh = async () =>
    new DurableSession(store, await store.read(opened.state.scope, opened.state.generation));
  return {
    client: databaseClient,
    store,
    provider,
    context,
    artifact,
    opened,
    sandbox: opened.handle.sandbox,
    fresh,
  };
}

async function failure(promise: PromiseLike<unknown>, message?: string) {
  let error: unknown;
  try {
    await promise;
  } catch (cause) {
    error = cause;
  }
  expect(error).toBeInstanceOf(Error);
  if (message !== undefined && error instanceof Error) expect(error.message).toContain(message);
}

test("replay after later mutations returns the exact original result without another append", async () => {
  const { sandbox, fresh } = await fixture();
  const identity = testOperation("append");
  const command = "printf event >> replay.log; cat replay.log";
  const original = await sandbox.run({ command }, identity);
  await sandbox.run({ command: "printf later >> replay.log" }, testOperation());
  const replay = await fresh();
  expect(await replay.run({ command }, identity)).toEqual(original);
  expect(original.stdout).toBe("event");
  expect(await replay.readTextFile({ path: "replay.log" })).toBe("eventlater");
});

test("a fresh process replays its durable receipt with an empty host environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wack-replay-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const url = `file:${join(directory, "workspace.db")}`;
  const { sandbox, opened } = await fixture(await database(url));
  const command = "printf event >> replay.log; cat replay.log";
  const original = await sandbox.run({ command }, testOperation("restart"));
  const child = Bun.spawn(
    [
      process.execPath,
      new URL("./sandbox-replay-process.ts", import.meta.url).pathname,
      url,
      opened.state.scope,
      opened.state.generation,
      "restart",
      command,
    ],
    { env: {}, stdout: "pipe", stderr: "pipe" },
  );
  const output = await new Response(child.stdout).json();
  expect(await new Response(child.stderr).text()).toBe("");
  expect(await child.exited).toBe(0);
  expect(output).toEqual(original);
  expect(await sandbox.readTextFile({ path: "replay.log" })).toBe("event");
});

test("concurrent duplicate calls commit one snapshot and return one result", async () => {
  const { fresh, store, opened } = await fixture();
  const sessions = await Promise.all(Array.from({ length: 12 }, fresh));
  const results = await Promise.all(
    sessions.map((sandbox) =>
      sandbox.run(
        {
          command: "printf event >> replay.log; cat replay.log",
        },
        testOperation("concurrent"),
      ),
    ),
  );
  expect(results.every((output) => output.stdout === "event")).toBe(true);
  const record = await store.read(opened.state.scope, opened.state.generation);
  expect(record.revision).toBe(1);
  expect(record.receiptCount).toBe(1);
  expect(await (await fresh()).readTextFile({ path: "replay.log" })).toBe("event");
});

test("identical text in distinct calls executes twice; a reused identity with different payload is rejected", async () => {
  const { sandbox } = await fixture();
  const command = "printf event >> replay.log";
  await sandbox.run({ command }, testOperation("one"));
  await sandbox.run({ command }, testOperation("two"));
  await failure(
    sandbox.run({ command: "printf wrong >> replay.log" }, testOperation("one")),
    "different payload",
  );
  await failure(
    sandbox.run({ command, env: { VALUE: "changed" } }, testOperation("one")),
    "different payload",
  );
  await failure(
    sandbox.run({ command, workingDirectory: "/tmp" }, testOperation("one")),
    "different payload",
  );
  expect(await sandbox.readTextFile({ path: "replay.log" })).toBe("eventevent");
});

test("provider call IDs reused in later turns remain distinct", async () => {
  const { sandbox } = await fixture();
  const command = "printf event >> replay.log";
  for (const turnId of ["turn-one", "turn-two"]) {
    const identity = operationIdentity({
      sessionId: "session-a",
      turnId,
      callId: "call_0",
      toolName: "bash",
      workflowRunId: `run-for-${turnId}`,
    });
    await sandbox.run({ command }, identity);
    await sandbox.run({ command }, identity);
  }
  expect(await sandbox.readTextFile({ path: "replay.log" })).toBe("eventevent");
});

test("duplicate dispatch runs or reused IDs within a turn fail closed after one publication", async () => {
  const { fresh, store, opened } = await fixture();
  const sessions = await Promise.all([fresh(), fresh()]);
  const identities = ["first-run", "dispatch-retry"].map((workflowRunId) =>
    operationIdentity({
      sessionId: "session-a",
      turnId: "same-turn",
      callId: "call_0",
      toolName: "bash",
      workflowRunId,
    }),
  );
  const command = "printf event >> replay.log; cat replay.log";
  const results = await Promise.allSettled(
    sessions.map((sandbox, index) => sandbox.run({ command }, identities[index])),
  );
  expect(results.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((attempt) => attempt.status === "rejected");
  expect(rejected?.reason).toBeInstanceOf(Error);
  expect(String(rejected?.reason)).toContain("Ambiguous workspace call");
  const sandbox = await fresh();
  expect(await sandbox.readTextFile({ path: "replay.log" })).toBe("event");
  expect((await store.read(opened.state.scope, opened.state.generation)).receiptCount).toBe(1);
});

test("the additive receipt migration preserves existing v1 workspace rows", async () => {
  const client = createClient({ url: "file::memory:" });
  cleanup.push(() => client.close());
  const migration = async (name: string) =>
    await Bun.file(new URL(`../../../shared/migrations/${name}.sql`, import.meta.url)).text();
  await client.executeMultiple(await migration("0001_agent_workspaces"));
  await client.execute({
    sql: "INSERT INTO agent_workspaces (scope, generation, revision, commit_id, snapshot, deleted, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: ["retained-v1", crypto.randomUUID(), 7, crypto.randomUUID(), "{}", 0, 123],
  });
  const before = (await client.execute("SELECT * FROM agent_workspaces")).rows[0];
  await client.executeMultiple(await migration("0002_workspace_operations"));
  const after = (await client.execute("SELECT * FROM agent_workspaces")).rows[0];
  expect({ ...after }).toEqual({ ...before, receipt_count: 0, receipt_bytes: 0 });
});

test("the snapshot, receipt and byte accounting roll back together when receipt insertion fails", async () => {
  const { sandbox, store, opened, client } = await fixture();
  const before = await store.read(opened.state.scope, opened.state.generation);
  // The database constraint fails the second statement after the CAS UPDATE ran.
  await failure(
    sandbox.run({ command: "printf wrong >> replay.log" }, { ...testOperation(), key: "invalid" }),
    "not confirmed",
  );
  expect(await store.read(opened.state.scope, opened.state.generation)).toEqual(before);
  expect(
    (await client.execute("SELECT count(*) AS count FROM agent_workspace_operations")).rows[0]?.[
      "count"
    ],
  ).toBe(0);
});

test("lost commit response is reconciled even after a later independent writer", async () => {
  const { store, opened, client } = await fixture();
  let armed = true;
  const faulty = new WorkspaceStore({
    execute: (statement) => client.execute(statement),
    batch: async (...args) => {
      const result = await client.batch(...args);
      if (armed) {
        armed = false;
        const other = new DurableSession(
          store,
          await store.read(opened.state.scope, opened.state.generation),
        );
        await other.run({ command: "printf later >> replay.log" }, testOperation("later"));
        throw new Error("lost committed response");
      }
      return result;
    },
  });
  const sandbox = new DurableSession(
    faulty,
    await faulty.read(opened.state.scope, opened.state.generation),
  );
  expect(
    (
      await sandbox.run(
        { command: "printf event >> replay.log; cat replay.log" },
        testOperation("lost"),
      )
    ).stdout,
  ).toBe("event");
  expect(await sandbox.readTextFile({ path: "replay.log" })).toBe("eventlater");
});

test("lost response and unavailable confirmation can safely replay the same operation", async () => {
  const { store, opened, client, fresh } = await fixture();
  let loseRead = false;
  const faulty = new WorkspaceStore({
    execute: async (statement) => {
      if (loseRead) throw new Error("confirmation unavailable");
      return await client.execute(statement);
    },
    batch: async (...args) => {
      await client.batch(...args);
      loseRead = true;
      throw new Error("lost committed response");
    },
  });
  const sandbox = new DurableSession(
    faulty,
    await store.read(opened.state.scope, opened.state.generation),
  );
  const command = "printf event >> replay.log; cat replay.log";
  await failure(sandbox.run({ command }, testOperation("unknown")), "confirmation unavailable");
  const replay = await fresh();
  expect((await replay.run({ command }, testOperation("unknown"))).stdout).toBe("event");
  expect(await replay.readTextFile({ path: "replay.log" })).toBe("event");
});

test("recorded writes and removals replay without overwriting or deleting later changes", async () => {
  const { sandbox } = await fixture();
  const write = testOperation("write");
  await sandbox.writeTextFile({ path: "value", content: "first" }, write);
  await sandbox.writeTextFile({ path: "value", content: "later" }, testOperation());
  await sandbox.writeTextFile({ path: "value", content: "first" }, write);
  expect(await sandbox.readTextFile({ path: "value" })).toBe("later");
  await failure(
    sandbox.writeBinaryFile({ path: "value", content: new Uint8Array([1]) }, write),
    "different payload",
  );
  const remove = testOperation("remove");
  await sandbox.removePath({ path: "value" }, remove);
  await sandbox.writeTextFile({ path: "value", content: "restored" }, testOperation());
  await sandbox.removePath({ path: "value" }, remove);
  expect(await sandbox.readTextFile({ path: "value" })).toBe("restored");
});

test("write_file compare-and-swap returns its original receipt after subsequent edits", async () => {
  const { sandbox } = await fixture();
  const identity = testOperation("replace");
  const input = { path: "value", content: "first", expectedSha256: "missing" };
  const original = await sandbox.replaceFile(input, identity);
  expect(original).toEqual({ existed: false, path: "/workspace/value", sha256: hash("first") });
  await sandbox.replaceFile(
    { path: "value", content: "later", expectedSha256: hash("first") },
    testOperation(),
  );
  expect(await sandbox.replaceFile(input, identity)).toEqual(original);
  await failure(
    sandbox.replaceFile(
      { ...input, content: "wrong", expectedSha256: hash("first") },
      testOperation(),
    ),
    "File changed",
  );
  expect(await sandbox.readTextFile({ path: "value" })).toBe("later");
});

test("ordinary nonzero exits commit once; exceptions and precommit cancellation leave no receipt or files", async () => {
  const { sandbox, store, opened } = await fixture();
  const identity = testOperation("nonzero");
  const command = "printf event >> replay.log; printf error >&2; exit 7";
  expect(await sandbox.run({ command }, identity)).toEqual({
    exitCode: 7,
    stdout: "",
    stderr: "error",
  });
  expect(await sandbox.run({ command }, identity)).toEqual({
    exitCode: 7,
    stdout: "",
    stderr: "error",
  });
  await failure(
    sandbox.run(
      { command: "printf wrong >> replay.log; sleep 1", abortSignal: AbortSignal.timeout(10) },
      testOperation(),
    ),
    "timed out",
  );
  expect(await sandbox.readTextFile({ path: "replay.log" })).toBe("event");
  expect((await store.read(opened.state.scope, opened.state.generation)).receiptCount).toBe(1);
});

test("caller cancellation during snapshot capture discards completed private execution", async () => {
  const { sandbox, store, opened } = await fixture();
  const controller = new AbortController();
  let captured = 0;
  const interception = spyOn(WorkspaceFs.prototype, "readFileBuffer").mockImplementation(
    async function (this: WorkspaceFs, path: string) {
      const bytes = await InMemoryFs.prototype.readFileBuffer.call(this, path);
      if (path === "/workspace/cancelled.txt") {
        captured += 1;
        controller.abort(new Error("cancelled during snapshot capture"));
      }
      return bytes;
    },
  );
  try {
    await failure(
      sandbox.run(
        { command: "printf private > cancelled.txt", abortSignal: controller.signal },
        testOperation(),
      ),
      "cancelled during snapshot capture",
    );
  } finally {
    interception.mockRestore();
  }
  expect(captured).toBe(1);
  expect(await sandbox.readTextFile({ path: "cancelled.txt" })).toBeNull();
  expect((await store.read(opened.state.scope, opened.state.generation)).receiptCount).toBe(0);
});

test("unscoped mutating routes fail closed; verified attachments import idempotently and are immutable", async () => {
  const { sandbox } = await fixture();
  await failure(sandbox.run({ command: "printf no > forbidden" }), "Unscoped");
  const spawned = await sandbox.spawn({ command: "printf no > forbidden" });
  await failure(spawned.wait(), "Unscoped");
  await failure(sandbox.removePath({ path: "seed.txt" }), "Unscoped");
  await failure(sandbox.writeTextFile({ path: "forbidden", content: "no" }), "Unscoped");
  const content = new TextEncoder().encode("attachment");
  const path = `/workspace/.eve/attachments/${hash(content).slice(0, 16)}/file.txt`;
  await sandbox.writeBinaryFile({ path, content });
  await sandbox.writeBinaryFile({ path, content });
  expect(await sandbox.readTextFile({ path })).toBe("attachment");
  await failure(
    sandbox.writeBinaryFile({ path, content: new TextEncoder().encode("different") }),
    "Unscoped",
  );
  for (const command of [
    `printf wrong > ${path}`,
    "rm -r /workspace/.eve",
    `mv ${path} /workspace/moved`,
    `chmod 777 ${path}`,
  ])
    await failure(sandbox.run({ command }, testOperation()), "immutable");
  await sandbox.run(
    { command: `ln -s ${path} /workspace/alias; printf wrong > alias` },
    testOperation(),
  );
  expect((await sandbox.run({ command: `cat ${path}` })).stdout).toBe("attachment");
  expect(await sandbox.readTextFile({ path: "forbidden" })).toBeNull();
});

test("receipt caps fail closed and terminal cleanup releases receipts without reviving old generations", async () => {
  const { sandbox, store, client, opened, provider, context, artifact } = await fixture();
  await sandbox.run({ command: "printf event >> replay.log" }, testOperation("old"));
  await client.execute({
    sql: "UPDATE agent_workspaces SET receipt_count = ? WHERE scope = ?",
    args: [operationLimits.count, opened.state.scope],
  });
  await failure(
    sandbox.run({ command: "printf wrong >> replay.log" }, testOperation()),
    "receipt limit",
  );
  expect(await sandbox.readTextFile({ path: "replay.log" })).toBe("event");
  await opened.handle.onSandboxDelete();
  expect(
    (await client.execute("SELECT count(*) AS count FROM agent_workspace_operations")).rows[0]?.[
      "count"
    ],
  ).toBe(0);
  await failure(store.read(opened.state.scope, opened.state.generation), "deleted");
  const replacement = await provider.start(context, undefined, artifact);
  expect(replacement.state.generation).not.toBe(opened.state.generation);
  expect(await replacement.handle.sandbox.readTextFile({ path: "replay.log" })).toBeNull();
  await provider.onSessionEnd?.(context, artifact, opened.state, { reason: "completed" });
  expect(await replacement.handle.sandbox.readTextFile({ path: "seed.txt" })).toBe("seed");
});

test("no workspace reference invents a generation; protocol v1 state is rejected", async () => {
  const { store, provider, context, artifact, opened } = await fixture();
  await failure(store.reference("missing-scope"), "workspace_open");
  expect(await store.reference(opened.state.scope)).toEqual({
    scope: opened.state.scope,
    generation: opened.state.generation,
  });
  // Validate the wire boundary rather than lying to TypeScript about a v1 state.
  const state = structuredClone(opened.state);
  Reflect.set(state, "version", 1);
  await failure(provider.resume(context, artifact, state));
});

test("receipt payload validation rejects changed output structure before database mutation", async () => {
  const { store, opened } = await fixture();
  const before = await store.read(opened.state.scope, opened.state.generation);
  const snapshot = await capture(await restore(before.snapshot));
  const identity = operationPayload(testOperation("direct"), "run", ["test"]);
  await store.commitOperation(before, snapshot, identity, {
    exitCode: 0,
    stdout: "ok",
    stderr: "",
  });
  expect(await store.receipt(before, identity)).toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
  await failure(
    store.receipt(before, { ...identity, fingerprint: hash("changed") }),
    "different payload",
  );
});
