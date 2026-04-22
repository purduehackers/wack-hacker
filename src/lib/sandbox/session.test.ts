import { describe, expect, it } from "vitest";

import { createMemoryRedis, createTestSandboxProvider, InMemorySandbox } from "@/lib/test/fixtures";

import type { SandboxSessionMetadata } from "./types.ts";

import { getOrCreateSession, readSession, releaseSession, writeSession } from "./session.ts";

const baseParams = {
  threadKey: "T1",
  repo: "purduehackers/agent-sandbox-test",
  githubToken: "ghs_token",
  gitUser: { name: "Phoenix Bot", email: "bot@example.com" },
};

function redisKey(threadKey = baseParams.threadKey): string {
  return `sandbox:session:${threadKey}`;
}

function sessionMetadata(overrides: Partial<SandboxSessionMetadata> = {}): SandboxSessionMetadata {
  return {
    sandboxId: "sb-existing",
    repo: baseParams.repo,
    branch: "phoenix-agent/existing",
    repoDir: "/vercel/sandbox",
    expiresAt: Date.now() + 10 * 60 * 1000,
    ...overrides,
  };
}

describe("getOrCreateSession — fresh provisioning", () => {
  it("provisions a new sandbox when no session is cached", async () => {
    const redis = createMemoryRedis();
    const { provider, createCalls } = createTestSandboxProvider();
    let provisionedCount = 0;

    const session = await getOrCreateSession({
      ...baseParams,
      redis,
      provider,
      onProvisioned: async () => {
        provisionedCount += 1;
      },
    });

    expect(session.fresh).toBe(true);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]!.repo).toBe(baseParams.repo);
    expect(createCalls[0]!.skipCloneAndBranch).toBeFalsy();
    expect(session.metadata.branch).toMatch(/^phoenix-agent\/agent-sandbox-test-/);
    expect(session.metadata.sandboxId).toBe("sb-0");
    expect(provisionedCount).toBe(1);
  });

  it("persists the session metadata to Redis after provisioning", async () => {
    const redis = createMemoryRedis();
    const { provider } = createTestSandboxProvider();

    await getOrCreateSession({ ...baseParams, redis, provider, onProvisioned: async () => {} });

    const stored = await readSession(baseParams.threadKey, redis);
    expect(stored?.repo).toBe(baseParams.repo);
    expect(stored?.lastUsedAt).toBeGreaterThan(0);
  });

  it("honors an explicit branch override", async () => {
    const redis = createMemoryRedis();
    const { provider } = createTestSandboxProvider();
    const session = await getOrCreateSession({
      ...baseParams,
      branch: "custom-branch",
      redis,
      provider,
      onProvisioned: async () => {},
    });
    expect(session.metadata.branch).toBe("custom-branch");
  });

  it("passes baseSnapshotId through to createCodingSandbox when set", async () => {
    const redis = createMemoryRedis();
    const { provider, createCalls } = createTestSandboxProvider();
    await getOrCreateSession({
      ...baseParams,
      baseSnapshotId: "snap-base",
      redis,
      provider,
      onProvisioned: async () => {},
    });
    expect(createCalls[0]!.baseSnapshotId).toBe("snap-base");
    expect(createCalls[0]!.skipCloneAndBranch).toBeFalsy();
  });
});

describe("getOrCreateSession — reusing a cached session", () => {
  it("reconnects to the cached sandbox and bumps its timeout", async () => {
    const redis = createMemoryRedis();
    const { provider, reconnectCalls, createCalls } = createTestSandboxProvider();
    const existing = sessionMetadata();
    await redis.set(redisKey(), existing, { ex: 60 });

    const session = await getOrCreateSession({
      ...baseParams,
      redis,
      provider,
      onProvisioned: async () => {},
    });

    expect(session.fresh).toBe(false);
    expect(session.metadata.sandboxId).toBe(existing.sandboxId);
    expect(session.metadata.branch).toBe(existing.branch);
    expect(reconnectCalls).toHaveLength(1);
    expect(reconnectCalls[0]!.id).toBe(existing.sandboxId);
    expect(reconnectCalls[0]!.options.expiresAt).toBe(existing.expiresAt);
    expect(createCalls).toHaveLength(0);
    expect(session.metadata.expiresAt).toBeGreaterThan(existing.expiresAt);
  });

  it("provisions fresh if the cached sandbox cannot be reconnected", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider();
    pv.failReconnectOnce();
    await redis.set(redisKey(), sessionMetadata({ sandboxId: "sb-dead" }), { ex: 60 });

    const session = await getOrCreateSession({
      ...baseParams,
      redis,
      provider: pv.provider,
      onProvisioned: async () => {},
    });

    expect(session.fresh).toBe(true);
    expect(pv.createCalls).toHaveLength(1);
  });

  it("falls through to provisioning when the cached expiry is within 60s", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider();
    await redis.set(redisKey(), sessionMetadata({ expiresAt: Date.now() + 5_000 }), { ex: 60 });

    const session = await getOrCreateSession({
      ...baseParams,
      redis,
      provider: pv.provider,
      onProvisioned: async () => {},
    });

    // Live-reuse guard kicked in; we provisioned fresh instead.
    expect(session.fresh).toBe(true);
    expect(pv.createCalls).toHaveLength(1);
  });
});

describe("getOrCreateSession — repo changed", () => {
  it("discards and stops the cached sandbox when the repo changes", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider();
    await redis.set(
      redisKey(),
      sessionMetadata({ sandboxId: "sb-old", repo: "purduehackers/other-repo" }),
      { ex: 60 },
    );

    const session = await getOrCreateSession({
      ...baseParams,
      redis,
      provider: pv.provider,
      onProvisioned: async () => {},
    });

    expect(session.fresh).toBe(true);
    expect(pv.stoppedIds).toContain("sb-old");
    expect(pv.createCalls).toHaveLength(1);
  });

  it("still discards the Redis entry when stopping the stale sandbox fails", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider();
    pv.failReconnectOnce();
    await redis.set(
      redisKey(),
      sessionMetadata({ sandboxId: "sb-old", repo: "purduehackers/other-repo" }),
      { ex: 60 },
    );

    const session = await getOrCreateSession({
      ...baseParams,
      redis,
      provider: pv.provider,
      onProvisioned: async () => {},
    });

    expect(session.fresh).toBe(true);
    expect(pv.createCalls).toHaveLength(1);
    expect(pv.stoppedIds).not.toContain("sb-old");
  });

  it("does not try to stop a hibernated sandbox on repo change", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider();
    await redis.set(
      redisKey(),
      sessionMetadata({
        sandboxId: "sb-old",
        repo: "purduehackers/other-repo",
        hibernated: true,
        snapshotId: "snap-old",
      }),
      { ex: 60 },
    );

    await getOrCreateSession({
      ...baseParams,
      redis,
      provider: pv.provider,
      onProvisioned: async () => {},
    });

    expect(pv.reconnectCalls.find((c) => c.id === "sb-old")).toBeUndefined();
  });
});

describe("getOrCreateSession — resume from hibernation", () => {
  it("passes the snapshot as baseSnapshotId and skips clone/branch", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider();
    await redis.set(
      redisKey(),
      sessionMetadata({
        sandboxId: "sb-old",
        expiresAt: Date.now() - 10 * 60 * 1000,
        hibernated: true,
        snapshotId: "snap-1",
      }),
      { ex: 60 },
    );

    const session = await getOrCreateSession({
      ...baseParams,
      redis,
      provider: pv.provider,
      onProvisioned: async () => {},
    });

    expect(session.fresh).toBe(true);
    expect(pv.createCalls[0]!.baseSnapshotId).toBe("snap-1");
    expect(pv.createCalls[0]!.skipCloneAndBranch).toBe(true);
    expect(session.metadata.branch).toBe("phoenix-agent/existing");
  });
});

describe("releaseSession", () => {
  it("stops the sandbox and clears the Redis entry", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider();
    await redis.set(redisKey(), sessionMetadata({ sandboxId: "sb-release" }), { ex: 60 });

    await releaseSession(baseParams.threadKey, { redis, provider: pv.provider });

    expect(await redis.get(redisKey())).toBeNull();
    expect(pv.stoppedIds).toContain("sb-release");
  });

  it("is a no-op when no session is stored", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider();
    await expect(
      releaseSession(baseParams.threadKey, { redis, provider: pv.provider }),
    ).resolves.toBeUndefined();
    expect(pv.reconnectCalls).toHaveLength(0);
  });

  it("deletes the Redis entry even if sandbox.stop throws", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider();
    pv.failReconnectOnce();
    await redis.set(redisKey(), sessionMetadata({ sandboxId: "sb-broken" }), { ex: 60 });

    await releaseSession(baseParams.threadKey, { redis, provider: pv.provider });
    expect(await redis.get(redisKey())).toBeNull();
  });

  it("does not try to stop a hibernated sandbox", async () => {
    const redis = createMemoryRedis();
    const pv = createTestSandboxProvider();
    await redis.set(
      redisKey(),
      sessionMetadata({ sandboxId: "sb-hib", hibernated: true, snapshotId: "snap-1" }),
      { ex: 60 },
    );

    await releaseSession(baseParams.threadKey, { redis, provider: pv.provider });
    expect(pv.reconnectCalls).toHaveLength(0);
    expect(await redis.get(redisKey())).toBeNull();
  });
});

describe("writeSession / readSession", () => {
  it("round-trips the metadata", async () => {
    const redis = createMemoryRedis();
    const meta = sessionMetadata();
    await writeSession(baseParams.threadKey, meta, redis);
    expect(await readSession(baseParams.threadKey, redis)).toEqual(meta);
  });

  it("returns null when no entry exists", async () => {
    const redis = createMemoryRedis();
    expect(await readSession(baseParams.threadKey, redis)).toBeNull();
  });

  it("writes hibernated metadata (longer TTL is an internal detail but the entry survives the round-trip)", async () => {
    const redis = createMemoryRedis();
    const meta = sessionMetadata({ hibernated: true, snapshotId: "snap-1" });
    await writeSession(baseParams.threadKey, meta, redis);
    const loaded = await readSession(baseParams.threadKey, redis);
    expect(loaded?.hibernated).toBe(true);
    expect(loaded?.snapshotId).toBe("snap-1");
  });
});

describe("InMemorySandbox (smoke — confirms the fixture round-trips data for session tests)", () => {
  it("reads and writes files by absolute path", async () => {
    const sandbox = new InMemorySandbox();
    await sandbox.writeFile("/vercel/sandbox/a.txt", "hello");
    expect(await sandbox.readFile("/vercel/sandbox/a.txt")).toBe("hello");
  });
});
