import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryRedis } from "@/lib/test/fixtures/redis";

import type { SandboxSessionMetadata } from "./session.ts";

import { InMemorySandbox } from "./in-memory-sandbox.ts";

const createdSandboxes: InMemorySandbox[] = [];

// Hoisted so the mock modules (also hoisted) can close over the same functions
// we later use to assert calls against. This sidesteps the unbound-method lint
// rule that fires when passing `Class.method` refs to `vi.mocked`.
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

mocks.createCodingSandbox.mockImplementation(async () => {
  const sandbox = new InMemorySandbox({ name: `created-${createdSandboxes.length}` });
  createdSandboxes.push(sandbox);
  return sandbox;
});

const { getOrCreateSession, releaseSession } = await import("./session.ts");

const reconnectMock = mocks.reconnect;
const createCodingSandboxMock = mocks.createCodingSandbox;

const baseParams = {
  threadKey: "T1",
  repo: "purduehackers/agent-sandbox-test",
  githubToken: "ghs_token",
  gitUser: { name: "Phoenix Bot", email: "bot@example.com" },
};

function mockReconnectToReturn(sandbox: InMemorySandbox): InMemorySandbox {
  reconnectMock.mockResolvedValueOnce(sandbox as unknown as never);
  return sandbox;
}

function resetAll() {
  createdSandboxes.length = 0;
  reconnectMock.mockReset();
  createCodingSandboxMock.mockClear();
}

describe("getOrCreateSession — fresh provisioning", () => {
  beforeEach(resetAll);

  it("provisions a new sandbox when no session is cached", async () => {
    const redis = createMemoryRedis();
    const session = await getOrCreateSession({ ...baseParams, redis });

    expect(session.fresh).toBe(true);
    expect(createCodingSandboxMock).toHaveBeenCalledOnce();
    expect(session.sandbox).toBeInstanceOf(InMemorySandbox);
    expect(session.metadata.repo).toBe(baseParams.repo);
    expect(session.metadata.branch).toMatch(/^phoenix-agent\/agent-sandbox-test-/);
    expect(session.metadata.sandboxId).toBe("created-0");
    expect(session.metadata.expiresAt).toBeGreaterThan(Date.now());
  });

  it("persists the session metadata to Redis after provisioning", async () => {
    const redis = createMemoryRedis();
    await getOrCreateSession({ ...baseParams, redis });

    const stored = await redis.get<SandboxSessionMetadata>(
      `sandbox:session:${baseParams.threadKey}`,
    );
    expect(stored).not.toBeNull();
    expect(stored?.repo).toBe(baseParams.repo);
  });
});

describe("getOrCreateSession — reusing a cached session", () => {
  beforeEach(resetAll);

  it("reconnects to the cached sandbox and bumps its timeout", async () => {
    const redis = createMemoryRedis();
    const existing: SandboxSessionMetadata = {
      sandboxId: "sb-existing",
      repo: baseParams.repo,
      branch: "phoenix-agent/existing",
      repoDir: "/vercel/sandbox",
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    await redis.set(`sandbox:session:${baseParams.threadKey}`, existing, { ex: 60 });

    const reconnected = new InMemorySandbox({ name: "sb-existing" });
    mockReconnectToReturn(reconnected);

    const session = await getOrCreateSession({ ...baseParams, redis });

    expect(session.fresh).toBe(false);
    expect(session.metadata.sandboxId).toBe("sb-existing");
    expect(session.metadata.branch).toBe("phoenix-agent/existing");
    expect(session.sandbox).toBe(reconnected);
    expect(createCodingSandboxMock).not.toHaveBeenCalled();
  });

  it("provisions fresh if the cached sandbox cannot be reconnected", async () => {
    const redis = createMemoryRedis();
    await redis.set(
      `sandbox:session:${baseParams.threadKey}`,
      {
        sandboxId: "sb-dead",
        repo: baseParams.repo,
        branch: "phoenix-agent/dead",
        repoDir: "/vercel/sandbox",
        expiresAt: Date.now() + 10 * 60 * 1000,
      },
      { ex: 60 },
    );
    reconnectMock.mockRejectedValueOnce(new Error("404 not found"));

    const session = await getOrCreateSession({ ...baseParams, redis });

    expect(session.fresh).toBe(true);
    expect(createCodingSandboxMock).toHaveBeenCalledOnce();
  });

  it("discards and stops the cached sandbox when the repo changes", async () => {
    const redis = createMemoryRedis();
    await redis.set(
      `sandbox:session:${baseParams.threadKey}`,
      {
        sandboxId: "sb-old",
        repo: "purduehackers/other-repo",
        branch: "phoenix-agent/old",
        repoDir: "/vercel/sandbox",
        expiresAt: Date.now() + 10 * 60 * 1000,
      },
      { ex: 60 },
    );
    const old = new InMemorySandbox({ name: "sb-old" });
    mockReconnectToReturn(old);

    const session = await getOrCreateSession({ ...baseParams, redis });

    expect(session.fresh).toBe(true);
    // Old sandbox.stop() was called — InMemorySandbox's `stopped` is private, so we
    // verify by attempting a readFile, which throws after stop.
    await expect(old.readFile("/vercel/sandbox/README.md")).rejects.toThrow(/stopped/);
    expect(createCodingSandboxMock).toHaveBeenCalledOnce();
  });
});

describe("releaseSession", () => {
  beforeEach(resetAll);

  it("stops the sandbox and clears the Redis entry", async () => {
    const redis = createMemoryRedis();
    await redis.set(
      `sandbox:session:${baseParams.threadKey}`,
      {
        sandboxId: "sb-release",
        repo: baseParams.repo,
        branch: "phoenix-agent/release",
        repoDir: "/vercel/sandbox",
        expiresAt: Date.now() + 10 * 60 * 1000,
      },
      { ex: 60 },
    );
    const sandbox = new InMemorySandbox({ name: "sb-release" });
    mockReconnectToReturn(sandbox);

    await releaseSession(baseParams.threadKey, { redis, githubToken: "ghs" });

    expect(await redis.get(`sandbox:session:${baseParams.threadKey}`)).toBeNull();
    await expect(sandbox.readFile("/vercel/sandbox/anything")).rejects.toThrow(/stopped/);
  });

  it("is a no-op when no session is stored", async () => {
    const redis = createMemoryRedis();
    await expect(releaseSession(baseParams.threadKey, { redis })).resolves.toBeUndefined();
    expect(reconnectMock).not.toHaveBeenCalled();
  });

  it("deletes the Redis entry even if sandbox.stop throws", async () => {
    const redis = createMemoryRedis();
    await redis.set(
      `sandbox:session:${baseParams.threadKey}`,
      {
        sandboxId: "sb-broken",
        repo: baseParams.repo,
        branch: "phoenix-agent/broken",
        repoDir: "/vercel/sandbox",
        expiresAt: Date.now() + 10 * 60 * 1000,
      },
      { ex: 60 },
    );
    reconnectMock.mockRejectedValueOnce(new Error("network down"));
    await releaseSession(baseParams.threadKey, { redis });
    expect(await redis.get(`sandbox:session:${baseParams.threadKey}`)).toBeNull();
  });
});
