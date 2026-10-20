import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type Client } from "@libsql/client";

import { durableBashImplementation } from "../../agent/lib/sandbox/provider.ts";
import { DurableSession } from "../../agent/lib/sandbox/session.ts";
import { capture, limits, restore, snapshotSchema } from "../../agent/lib/sandbox/snapshot.ts";
import { StaleWorkspaceError, WorkspaceStore } from "../../agent/lib/sandbox/store.ts";
import { trackedSandbox, testOperation } from "./sandbox-fixtures.ts";
import { prepareContext, sessionContext } from "./sandbox-fixtures.ts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function failure(operation: PromiseLike<unknown>, message?: string): Promise<unknown> {
  let error: unknown;
  try {
    await operation;
  } catch (cause) {
    error = cause;
  }
  expect(error).toBeInstanceOf(Error);
  if (message !== undefined && error instanceof Error) expect(error.message).toContain(message);
  return error;
}

async function database(url = "file::memory:") {
  const client = createClient({ url });
  cleanup.push(() => client.close());
  await client.execute(
    await Bun.file(
      new URL("../../../shared/migrations/0001_agent_workspaces.sql", import.meta.url),
    ).text(),
  );
  await client.executeMultiple(
    await Bun.file(
      new URL("../../../shared/migrations/0002_workspace_operations.sql", import.meta.url),
    ).text(),
  );
  return client;
}

async function fixture(client?: Client) {
  const store = new WorkspaceStore(client ?? (await database()));
  const provider = durableBashImplementation(() => store);
  const artifact = await provider.prepare(prepareContext());
  const ctx = sessionContext();
  const opened = await provider.start(ctx, undefined, artifact);
  cleanup.push(() => opened.handle.onRuntimeShutdown());
  return { store, provider, artifact, ctx, opened, sandbox: trackedSandbox(opened.handle.sandbox) };
}

test("cold process restores committed bytes without a host cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wack-bash-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const url = `file:${join(directory, "workspace.db")}`;
  const { store, opened, sandbox } = await fixture(await database(url));
  await sandbox.writeTextFile({ path: "saved.txt", content: "survived" });
  await opened.handle.onRuntimeShutdown();
  const child = Bun.spawn(
    [
      process.execPath,
      new URL("./sandbox-cold-process.ts", import.meta.url).pathname,
      url,
      opened.state.scope,
      opened.state.generation,
    ],
    { stdout: "pipe", stderr: "pipe", env: {} },
  );
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toBe("survived");
  const next = new DurableSession(
    store,
    await store.read(opened.state.scope, opened.state.generation),
  );
  expect(await next.readTextFile({ path: "child.txt" })).toBe("restored");
});

test("binary, directories, symlinks, modes and removal survive new handles", async () => {
  const { provider, artifact, ctx, sandbox, opened } = await fixture();
  const bytes = new Uint8Array([0, 255, 128, 10]);
  await sandbox.writeBinaryFile({ path: "dir/data.bin", content: bytes });
  expect(
    (await sandbox.run({ command: "chmod 600 dir/data.bin; ln -s data.bin dir/link" })).exitCode,
  ).toBe(0);
  const resumed = await provider.resume(ctx, artifact, opened.state);
  expect(await resumed.sandbox.readBinaryFile({ path: "dir/link" })).toEqual(bytes);
  expect((await resumed.sandbox.run({ command: "stat -c %a dir/data.bin" })).stdout.trim()).toBe(
    "600",
  );
  await resumed.sandbox.removePath({ path: "dir", recursive: true }, testOperation());
  const again = await provider.resume(ctx, artifact, opened.state);
  expect(await again.sandbox.readBinaryFile({ path: "dir/data.bin" })).toBeNull();
});

test("stale writers cannot overwrite another handle", async () => {
  const { provider, artifact, ctx, sandbox, opened } = await fixture();
  const other = await provider.resume(ctx, artifact, opened.state);
  await sandbox.writeTextFile({ path: "winner", content: "first" });
  expect(
    await failure(
      other.sandbox.writeTextFile({ path: "winner", content: "second" }, testOperation()),
    ),
  ).toBeInstanceOf(StaleWorkspaceError);
  const latest = await provider.resume(ctx, artifact, opened.state);
  expect(await latest.sandbox.readTextFile({ path: "winner" })).toBe("first");
});

test("isolation, missing state, cleanup and fresh generations fail closed", async () => {
  const { provider, artifact, ctx, sandbox, opened } = await fixture();
  await sandbox.writeTextFile({ path: "private", content: "private" });
  await failure(
    provider.resume(sessionContext("other"), artifact, opened.state),
    "does not belong",
  );
  const other = await provider.start(sessionContext("other"), undefined, artifact);
  expect(await other.handle.sandbox.readTextFile({ path: "private" })).toBeNull();
  await opened.handle.onSandboxStop();
  const resumed = await provider.resume(ctx, artifact, opened.state);
  expect(await resumed.sandbox.readTextFile({ path: "private" })).toBe("private");
  await resumed.onSandboxDelete();
  await failure(provider.resume(ctx, artifact, opened.state));
  const fresh = await provider.start(ctx, undefined, artifact);
  expect(fresh.state.generation).not.toBe(opened.state.generation);
  await provider.onSessionEnd?.(ctx, artifact, opened.state, { reason: "completed" });
  expect(await fresh.handle.sandbox.readTextFile({ path: "seed.txt" })).toBe("seed");
  await provider.onSessionEnd?.(ctx, artifact, fresh.state, { reason: "completed" });
  await provider.onSessionEnd?.(ctx, artifact, fresh.state, { reason: "completed" });
  await failure(provider.resume(ctx, artifact, fresh.state));
});

test("audit workloads run in shell, Python/WASM and QuickJS", async () => {
  const { sandbox } = await fixture();
  expect(
    (
      await sandbox.run({
        command: "printf '3\\n1\\n2\\n' | sort -n | awk '{sum+=$1} END {print sum}'",
      })
    ).stdout,
  ).toBe("6\n");
  const python = await sandbox.run({
    command:
      'python3 -c \'import json,datetime; rows=[{"id":str(x)} for x in range(5)]; open("members.json","w").write(json.dumps(rows)); print(datetime.date(2026,10,19).isoformat()); print(len(rows))\'',
  });
  expect(python.exitCode).toBe(0);
  expect(python.stdout).toBe("2026-10-19\n5\n");
  expect((await sandbox.run({ command: "jq 'length' members.json" })).stdout).toBe("5\n");
  const javascript = await sandbox.run({
    command: "js-exec -c 'console.log(String(BigInt(\"123456789012345678\") >> 22n))'",
  });
  expect(javascript.exitCode).toBe(0);
  expect(javascript.stdout).toBe("29434392216\n");
}, 30_000);

test("shell state is per-command and host capabilities are absent", async () => {
  const { sandbox } = await fixture();
  process.env["WACK_SANDBOX_TEST_SECRET"] = "host-only-secret";
  cleanup.push(() => {
    delete process.env["WACK_SANDBOX_TEST_SECRET"];
  });
  expect(
    (await sandbox.run({ command: "mkdir -p sub; cd sub; export LOCAL=value; pwd" })).stdout,
  ).toBe("/workspace/sub\n");
  expect(
    (
      await sandbox.run({
        command: 'printf \'%s:%s:%s\' "$PWD" "$LOCAL" "$WACK_SANDBOX_TEST_SECRET"',
      })
    ).stdout,
  ).toBe("/workspace::");
  for (const command of [
    "cat /etc/passwd",
    "cat /proc/self/environ",
    "curl https://example.com",
    "node -e 'console.log(1)'",
    "bun --version",
  ]) {
    const result = await sandbox.run({ command });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("host-only-secret");
  }
  const python = await sandbox.run({
    command: 'python3 -c \'import os; print(os.environ.get("WACK_SANDBOX_TEST_SECRET","absent"))\'',
  });
  expect(python.stdout).toBe("absent\n");
  const javascript = await sandbox.run({
    command: "js-exec -c 'console.log(process.env.WACK_SANDBOX_TEST_SECRET ?? \"absent\")'",
  });
  expect(javascript.stdout).toBe("absent\n");
}, 30_000);

test("language shims cannot start host processes or access a local network listener", async () => {
  const { sandbox } = await fixture();
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      requests += 1;
      return new Response("host");
    },
  });
  cleanup.push(() => server.stop(true));
  const network = await sandbox.run({
    command: `js-exec -c 'fetch("http://127.0.0.1:${server.port}").then(() => console.log("connected")).catch(e => console.log(String(e)))'`,
  });
  expect(network.stdout).toContain("Network access not configured");
  expect(requests).toBe(0);
  const javascript = await sandbox.run({
    command:
      'js-exec -c \'console.log(require("child_process").spawnSync("node", ["--version"]).status)\'',
  });
  expect(javascript.stdout).toBe("1\n");
  const python = await sandbox.run({
    command: 'python3 -c \'import subprocess; subprocess.run(["echo", "host-process"])\'',
  });
  expect(python.exitCode).not.toBe(0);
  expect(python.stderr).toContain("does not support processes");
}, 30_000);

test("limits, cancellation, immutable virtual system paths and hard links", async () => {
  const { sandbox } = await fixture();
  await failure(
    sandbox.writeBinaryFile({ path: "large", content: new Uint8Array(limits.fileBytes + 1) }),
    "file limit",
  );
  await failure(sandbox.writeTextFile({ path: "/etc/config", content: "no" }));
  expect((await sandbox.run({ command: "ln seed.txt hard-link" })).exitCode).not.toBe(0);
  expect((await sandbox.run({ command: "ln -s /bin /workspace/escape" })).exitCode).not.toBe(0);
  await failure(sandbox.run({ command: "x".repeat(limits.sourceBytes + 1) }), "source limit");
  const signal = AbortSignal.abort();
  await failure(sandbox.run({ command: "touch cancelled", abortSignal: signal }));
  expect(await sandbox.readTextFile({ path: "cancelled" })).toBeNull();
  await failure(
    sandbox.run({
      command: "touch before; sleep 5; touch after",
      abortSignal: AbortSignal.timeout(30),
    }),
  );
  expect(await sandbox.readTextFile({ path: "before" })).toBeNull();
  const output = await sandbox.run({ command: "yes x | head -c 400000" });
  expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(limits.outputBytes);
  await sandbox.writeBinaryFile({ path: "first", content: new Uint8Array(limits.fileBytes) });
  await failure(
    sandbox.writeBinaryFile({ path: "second", content: new Uint8Array(2 * 1024 * 1024) }),
  );
  expect(await sandbox.readTextFile({ path: "second" })).toBeNull();
  await failure(
    restore({
      version: 1,
      entries: Array.from({ length: limits.entries + 1 }, (_, index) => ({
        kind: "directory",
        path: `/workspace/${index}`,
        mode: 0o755,
        mtime: 0,
      })),
    }),
  );
});
async function faultStore(client: Client, afterCommit: boolean) {
  let armed = false;
  const store = new WorkspaceStore({
    batch: (...args) => client.batch(...args),
    execute: async (statement) => {
      if (!armed) return await client.execute(statement);
      armed = false;
      if (afterCommit) await client.execute(statement);
      throw new Error("lost database response");
    },
  });
  const original = await capture(await restore({ version: 1, entries: [] }));
  const prior = await store.open("receipt", original);
  const fs = await restore(original);
  await fs.writeFile("/workspace/value", "committed");
  return {
    store,
    prior,
    snapshot: await capture(fs),
    arm: () => {
      armed = true;
    },
  };
}

test("lost response reconciles the matching commit receipt", async () => {
  const { store, prior, snapshot, arm } = await faultStore(await database(), true);
  arm();
  const result = await store.commit(prior, snapshot);
  expect(result.revision).toBe(1);
  expect((await store.read(prior.scope, prior.generation)).commitId).toBe(result.commitId);
});

test("unconfirmed commit reports failure without changing saved bytes", async () => {
  const { store, prior, snapshot, arm } = await faultStore(await database(), false);
  arm();
  await failure(store.commit(prior, snapshot), "not confirmed");
  expect((await store.read(prior.scope, prior.generation)).snapshot).toEqual(prior.snapshot);
});

test("simultaneous CAS commits have exactly one winner", async () => {
  const { store, prior, snapshot } = await faultStore(await database(), false);
  const outcomes = await Promise.allSettled([
    store.commit(prior, snapshot),
    store.commit(prior, snapshot),
  ]);
  expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect((await store.read(prior.scope, prior.generation)).revision).toBe(1);
});

test("compatible redeploys preserve old files rather than applying new seeds", async () => {
  const { provider, artifact, ctx, sandbox, opened } = await fixture();
  await sandbox.writeTextFile({ path: "seed.txt", content: "edited" });
  const nextArtifact = {
    ...artifact,
    key: "f".repeat(64),
    snapshot: { ...artifact.snapshot, entries: [] },
  };
  const resumed = await provider.resume(ctx, nextArtifact, opened.state);
  expect(await resumed.sandbox.readTextFile({ path: "seed.txt" })).toBe("edited");
  await failure(
    provider.resume(ctx, nextArtifact, { ...opened.state, generation: crypto.randomUUID() }),
  );
});

test("queued reads and stalled upload streams honor cancellation", async () => {
  const { sandbox } = await fixture();
  const work = sandbox.run({ command: "sleep 0.05" });
  const read = sandbox.readFile({ path: "seed.txt", abortSignal: AbortSignal.timeout(5) });
  await failure(read);
  await work;
  let cancelled = false;
  const content = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await failure(
    sandbox.writeFile({ path: "stalled", content, abortSignal: AbortSignal.timeout(10) }),
  );
  expect(cancelled).toBe(true);
  expect(await sandbox.readTextFile({ path: "stalled" })).toBeNull();
});

test("failed and caught oversized mutations leave original files unchanged", async () => {
  const { sandbox } = await fixture();
  const original = new Uint8Array(limits.fileBytes).fill(65);
  await sandbox.writeBinaryFile({ path: "full", content: original });
  // just-bash propagates redirect errors outside `||`; the provider discards them.
  await failure(sandbox.run({ command: "printf B >> full || true" }), "file limit");
  const result = await sandbox.run({
    command:
      'js-exec -c \'try { require("fs").writeFileSync("/workspace/full", "B".repeat(3145729)); } catch { console.log("recovered"); }\'',
  });
  expect(result.stdout).toBe("recovered\n");
  expect(await sandbox.readBinaryFile({ path: "full" })).toEqual(original);
  const copy = await sandbox.run({ command: "cp full duplicate || true; echo recovered" });
  expect(copy.stdout).toBe("recovered\n");
  expect(await sandbox.readTextFile({ path: "duplicate" })).toBeNull();
  await sandbox.writeBinaryFile({ path: "filler", content: new Uint8Array(512 * 1024) });
  const total = await sandbox.run({
    command:
      'js-exec -c \'try { require("fs").writeFileSync("/workspace/overflow", "B".repeat(1048576)); } catch { console.log("recovered"); }\'',
  });
  expect(total.stdout).toBe("recovered\n");
  expect(await sandbox.readTextFile({ path: "overflow" })).toBeNull();
  expect(await sandbox.readBinaryFile({ path: "full" })).toEqual(original);
}, 30_000);

test("encoded snapshot bounds reject oversized transport before touching storage", async () => {
  const { store, prior } = await faultStore(await database(), false);
  const snapshot = {
    ...prior.snapshot,
    entries: [
      {
        kind: "file",
        path: "/workspace/large",
        mode: 0o600,
        mtime: 0,
        data: Buffer.alloc(limits.fileBytes).toString("base64"),
      },
      {
        kind: "file",
        path: "/workspace/small",
        mode: 0o600,
        mtime: 0,
        data: Buffer.alloc(1024 * 1024).toString("base64"),
      },
      ...Array.from({ length: 1000 }, (_, index) => ({
        kind: "directory",
        path: `/workspace/${"x".repeat(990)}/${index}`,
        mode: 0o755,
        mtime: 0,
      })),
    ],
  };
  // Validate the external fixture just as an adapter would, with literal kinds retained.
  const parsed = snapshotSchema.parse(snapshot);
  await failure(store.commit(prior, parsed), "snapshot limit");
  expect((await store.read(prior.scope, prior.generation)).revision).toBe(0);
});

test("invalid and oversized saved snapshots fail closed", async () => {
  const client = await database();
  const { store, prior } = await faultStore(client, false);
  for (const snapshot of ["{invalid", '{"version":2,"entries":[]}', "é".repeat(4 * 1024 * 1024)]) {
    await client.execute({
      sql: "UPDATE agent_workspaces SET snapshot = ? WHERE scope = ?",
      args: [snapshot, prior.scope],
    });
    await failure(store.read(prior.scope, prior.generation));
  }
});

test("delete racing a writer fences future writes and can be retried", async () => {
  const { store, prior, snapshot } = await faultStore(await database(), false);
  await Promise.allSettled([
    store.commit(prior, snapshot),
    store.delete(prior.scope, prior.generation),
  ]);
  await store.delete(prior.scope, prior.generation);
  await failure(store.commit(prior, snapshot));
  await failure(store.read(prior.scope, prior.generation));
});

test("a later receipt makes a lost response ambiguous, never a false success", async () => {
  const client = await database();
  let armed = false;
  const store = new WorkspaceStore({
    batch: (...args) => client.batch(...args),
    execute: async (statement) => {
      const result = await client.execute(statement);
      if (armed) {
        armed = false;
        await client.execute({
          sql: "UPDATE agent_workspaces SET revision = revision + 1, commit_id = ?",
          args: [crypto.randomUUID()],
        });
        throw new Error("response lost after another writer");
      }
      return result;
    },
  });
  const snapshot = await capture(await restore({ version: 1, entries: [] }));
  const prior = await store.open("ambiguous", snapshot);
  armed = true;
  await failure(store.commit(prior, snapshot), "not confirmed");
  expect((await store.read(prior.scope, prior.generation)).revision).toBe(2);
});

test("unscoped replay of an append is refused without any file mutation", async () => {
  const { provider, artifact, ctx, sandbox, opened } = await fixture();
  await sandbox.run({ command: "printf event >> replay.log" });
  // A Workflow step may replay after its file commit but before its checkpoint.
  const replay = await provider.resume(ctx, artifact, opened.state);
  await failure(replay.sandbox.run({ command: "printf event >> replay.log" }), "Unscoped");
  expect(await replay.sandbox.readTextFile({ path: "replay.log" })).toBe("event");
});
