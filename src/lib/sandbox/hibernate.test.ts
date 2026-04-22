import { describe, expect, it } from "vitest";

import { createMemoryRedis, createTestSandboxProvider } from "@/lib/test/fixtures";

import type { SandboxSessionMetadata } from "./types.ts";

import { hibernateSession, readSession } from "./session.ts";

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
    const { provider } = createTestSandboxProvider({ name: "sb-1" });
    const result = await hibernateSession("T1", { redis, provider });
    expect(result).toBe("skipped-missing");
  });

  it("returns skipped-already when session is already hibernated", async () => {
    const redis = createMemoryRedis();
    const { provider } = createTestSandboxProvider({ name: "sb-1" });
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
    const executed: string[] = [];
    const pv = createTestSandboxProvider({
      name: "sb-1",
      execHandler: async (command) => {
        executed.push(command);
        return { exitCode: 0, stdout: "", stderr: "", truncated: false };
      },
    });
    await redis.set("sandbox:session:T1", seedMetadata(), { ex: 60 });

    const result = await hibernateSession("T1", { redis, provider: pv.provider });
    expect(result).toBe("hibernated");
    expect(executed.some((c) => c.includes("git add -A"))).toBe(true);
    expect(executed.some((c) => c.includes("git commit"))).toBe(true);

    const stored = await readSession("T1", redis);
    expect(stored?.hibernated).toBe(true);
    expect(stored?.snapshotId).toMatch(/^in-mem-sb-1-/);
  });

  it("returns skipped-missing when the reconnect blows up", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider({ name: "sb-1", reconnectFails: true });
    await redis.set("sandbox:session:T1", seedMetadata(), { ex: 60 });

    const result = await hibernateSession("T1", { redis, provider: pv.provider });
    expect(result).toBe("skipped-missing");

    const stored = await readSession("T1", redis);
    expect(stored?.hibernated).toBeFalsy();
  });

  it("still snapshots when the WIP commit step errors", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider({
      name: "sb-1",
      execHandler: async () => {
        throw new Error("git not found");
      },
    });
    await redis.set("sandbox:session:T1", seedMetadata(), { ex: 60 });

    const result = await hibernateSession("T1", { redis, provider: pv.provider });
    expect(result).toBe("hibernated");

    const stored = await readSession("T1", redis);
    expect(stored?.hibernated).toBe(true);
    expect(stored?.snapshotId).toMatch(/^in-mem-sb-1-/);
  });
});
