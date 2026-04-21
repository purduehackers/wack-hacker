import { describe, expect, it } from "vitest";

import { createMemoryRedis } from "@/lib/test/fixtures/redis";

import type {
  SandboxProvider,
  SandboxSessionMetadata,
  VercelSandboxReconnectOptions,
} from "./types.ts";

import { InMemorySandbox } from "./in-memory-sandbox.ts";
import { hibernateSession, readSession } from "./session.ts";

interface ProviderState {
  provider: SandboxProvider;
  reconnectCalls: { id: string; options: VercelSandboxReconnectOptions }[];
  sandbox: InMemorySandbox;
  executed: string[];
  snapshotId?: string;
}

function providerWithLiveSandbox(options: { reconnectFails?: boolean } = {}): ProviderState {
  const executed: string[] = [];
  const sandbox = new InMemorySandbox({
    name: "sb-1",
    execHandler: async (command) => {
      executed.push(command);
      return { exitCode: 0, stdout: "", stderr: "", truncated: false };
    },
  });
  let snapshotId: string | undefined;
  // Capture the id emitted by InMemorySandbox.snapshot() so the test can
  // assert it was persisted back to Redis.
  const originalSnapshot = sandbox.snapshot.bind(sandbox);
  sandbox.snapshot = async () => {
    const result = await originalSnapshot();
    snapshotId = result.snapshotId;
    return result;
  };
  const reconnectCalls: { id: string; options: VercelSandboxReconnectOptions }[] = [];
  const provider: SandboxProvider = {
    create: async () => sandbox,
    reconnect: async (id, opts) => {
      reconnectCalls.push({ id, options: opts });
      if (options.reconnectFails) throw new Error("reconnect failed");
      return sandbox;
    },
  };
  return {
    provider,
    reconnectCalls,
    sandbox,
    executed,
    get snapshotId() {
      return snapshotId;
    },
  };
}

function seedMetadata(expiresIn = 10 * 60 * 1000): SandboxSessionMetadata {
  return {
    sandboxId: "sb-1",
    repo: "purduehackers/agent-sandbox-test",
    branch: "phoenix-agent/a",
    repoDir: "/vercel/sandbox",
    expiresAt: Date.now() + expiresIn,
  };
}

describe("hibernateSession", () => {
  it("returns skipped-missing when no session is stored", async () => {
    const redis = createMemoryRedis();
    const { provider } = providerWithLiveSandbox();
    const result = await hibernateSession("T1", { redis, provider });
    expect(result).toBe("skipped-missing");
  });

  it("returns skipped-already when session is already hibernated", async () => {
    const redis = createMemoryRedis();
    const { provider } = providerWithLiveSandbox();
    await redis.set(
      "sandbox:session:T1",
      { ...seedMetadata(), hibernated: true, snapshotId: "snap-old" },
      { ex: 60 },
    );
    const result = await hibernateSession("T1", { redis, provider });
    expect(result).toBe("skipped-already");
  });

  it("commits WIP, snapshots, and flips metadata to hibernated", async () => {
    const redis = createMemoryRedis();
    const state = providerWithLiveSandbox();
    await redis.set("sandbox:session:T1", seedMetadata(), { ex: 60 });

    const result = await hibernateSession("T1", { redis, provider: state.provider });
    expect(result).toBe("hibernated");

    expect(state.executed.some((c) => c.includes("git add -A"))).toBe(true);
    expect(state.executed.some((c) => c.includes("git commit"))).toBe(true);

    const stored = await readSession("T1", redis);
    expect(stored?.hibernated).toBe(true);
    expect(stored?.snapshotId).toBe(state.snapshotId);
    expect(stored?.snapshotId).toMatch(/^in-mem-sb-1-/);
  });

  it("returns skipped-missing when the reconnect blows up", async () => {
    const redis = createMemoryRedis();
    const state = providerWithLiveSandbox({ reconnectFails: true });
    await redis.set("sandbox:session:T1", seedMetadata(), { ex: 60 });

    const result = await hibernateSession("T1", { redis, provider: state.provider });
    expect(result).toBe("skipped-missing");

    const stored = await readSession("T1", redis);
    // Metadata is left alone so the lifecycle workflow can decide what to do
    // next; only a successful hibernate flips `hibernated`.
    expect(stored?.hibernated).toBeFalsy();
  });

  it("still snapshots when the WIP commit step errors", async () => {
    const redis = createMemoryRedis();
    // Custom sandbox whose exec throws — simulates the pre-commit git step
    // failing (e.g. no git inside). Snapshot should still be attempted.
    const sandbox = new InMemorySandbox({
      name: "sb-1",
      execHandler: async () => {
        throw new Error("git not found");
      },
    });
    let snapshotCalled = false;
    const originalSnapshot = sandbox.snapshot.bind(sandbox);
    sandbox.snapshot = async () => {
      snapshotCalled = true;
      return originalSnapshot();
    };
    const provider: SandboxProvider = {
      create: async () => sandbox,
      reconnect: async () => sandbox,
    };

    await redis.set("sandbox:session:T1", seedMetadata(), { ex: 60 });

    const result = await hibernateSession("T1", { redis, provider });
    expect(result).toBe("hibernated");
    expect(snapshotCalled).toBe(true);
  });
});
