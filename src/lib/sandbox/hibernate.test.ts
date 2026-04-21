import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryRedis } from "@/lib/test/fixtures/redis";

import type { SandboxSessionMetadata } from "./session.ts";

import { InMemorySandbox } from "./in-memory-sandbox.ts";

const mocks = vi.hoisted(() => ({
  reconnect: vi.fn(),
  createCodingSandbox: vi.fn(),
}));

vi.mock("./factory.ts", () => ({
  createCodingSandbox: mocks.createCodingSandbox,
}));

vi.mock("./vercel-sandbox.ts", () => ({
  VercelSandbox: {
    reconnect: mocks.reconnect,
  },
}));

vi.mock("workflow/api", () => ({
  start: vi.fn(async () => ({ runId: "test-run" })),
}));

const { hibernateSession, readSession } = await import("./session.ts");

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
  beforeEach(() => {
    mocks.reconnect.mockReset();
    mocks.createCodingSandbox.mockReset();
  });

  it("returns skipped-missing when no session is stored", async () => {
    const redis = createMemoryRedis();
    const result = await hibernateSession("T1", { redis });
    expect(result).toBe("skipped-missing");
  });

  it("returns skipped-already when session is already hibernated", async () => {
    const redis = createMemoryRedis();
    await redis.set(
      "sandbox:session:T1",
      { ...seedMetadata(), hibernated: true, snapshotId: "snap-old" },
      { ex: 60 },
    );
    const result = await hibernateSession("T1", { redis });
    expect(result).toBe("skipped-already");
  });

  it("commits WIP, snapshots, and marks session hibernated", async () => {
    const redis = createMemoryRedis();
    await redis.set("sandbox:session:T1", seedMetadata(), { ex: 60 });

    const committed: string[] = [];
    const liveSandbox = new InMemorySandbox({
      name: "sb-1",
      execHandler: async (command) => {
        committed.push(command);
        return { exitCode: 0, stdout: "", stderr: "", truncated: false };
      },
    });
    mocks.reconnect.mockResolvedValueOnce(liveSandbox as unknown as never);

    const result = await hibernateSession("T1", { redis });
    expect(result).toBe("hibernated");
    expect(committed.some((c) => c.includes("git add -A"))).toBe(true);

    const stored = await readSession("T1", redis);
    expect(stored?.hibernated).toBe(true);
    expect(stored?.snapshotId).toMatch(/^in-mem-sb-1-/);
  });

  it("returns skipped-missing when the reconnect blows up", async () => {
    const redis = createMemoryRedis();
    await redis.set("sandbox:session:T1", seedMetadata(), { ex: 60 });
    mocks.reconnect.mockRejectedValueOnce(new Error("404 not found"));

    const result = await hibernateSession("T1", { redis });
    expect(result).toBe("skipped-missing");
  });
});
