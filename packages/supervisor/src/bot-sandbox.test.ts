import { describe, expect, test } from "bun:test";

import {
  decodeActiveBotGeneration,
  type ActiveBotGeneration,
} from "../../shared/src/bot-generation.ts";
import { Result, type Result as ResultType } from "../../shared/src/result/index.ts";
import {
  BOT_ACTIVE_GENERATION_KEY,
  BOT_SANDBOX_REFRESH_WINDOW_MS,
  BotSandboxUnhealthy,
  BotSupervisorFenceLost,
  InvalidBotActiveGeneration,
  createBotSandboxSupervisor,
  type BotProcessEnvironment,
  type BotSandboxClient,
  type BotSandboxRedisClient,
  type BotSandboxSupervisorDeps,
  type ManagedBotCommand,
  type ManagedBotSandbox,
  type ManagedBotSandboxListEntry,
} from "./bot-sandbox.ts";

const IMAGE_DIGEST = "a".repeat(64);
const IMAGE = `wack/bot@sha256:${IMAGE_DIGEST}`;
const START = Date.parse("2026-08-06T12:00:00.000Z");
const OWNER_UUID = "00000000-0000-4000-8000-000000000001";
const CANDIDATE_UUID = "00000000-0000-4000-8000-000000000002";

const BOT_ENV = {
  DISCORD_BOT_TOKEN: "discord-token",
  DISCORD_BOT_CLIENT_ID: "discord-client",
  AGENT_URL: "https://agent.example.test",
  AGENT_INGRESS_SECRET: "agent-secret",
  BOT_INGRESS_SECRET: "bot-secret",
  UPSTASH_REDIS_REST_URL: "https://redis.example.test",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
  PRIVACY_DB_API_KEY: "privacy-key",
  VERCEL_API_TOKEN: "vercel-token",
  DASHBOARD_EDGE_CONFIG: "edge-config",
  PAYLOAD_CMS_API_KEY: "payload-key",
  SHIP_API_KEY: "ship-key",
  PHACK_API_TOKEN: "phack-token",
  GROQ_API_KEY: "groq-key",
} satisfies BotProcessEnvironment;

function activeGeneration(
  generation: number,
  sandboxName: string,
  healthUrl = `https://${sandboxName}.example.test/health`,
): ActiveBotGeneration {
  return {
    version: 1,
    generation,
    sandboxName,
    commandId: `command-${sandboxName}`,
    image: IMAGE,
    healthUrl,
    activatedAt: new Date(START - 60_000).toISOString(),
    expiresAt: new Date(START + 2 * 60 * 60_000).toISOString(),
  };
}

function decodeActive(raw: unknown): ActiveBotGeneration | undefined {
  try {
    return decodeActiveBotGeneration(raw);
  } catch {
    return undefined;
  }
}

class RedisFake implements BotSandboxRedisClient {
  activeRaw: ActiveBotGeneration | string | undefined;
  fence: number;
  mutex: string | undefined;
  renewCount = 0;
  readonly events: string[];
  beforeCommit: (() => void) | undefined;
  onRenew: ((count: number) => void) | undefined;

  constructor(active: ActiveBotGeneration | undefined, events: string[] = []) {
    this.activeRaw = active;
    this.fence = active?.generation ?? 0;
    this.events = events;
  }

  readonly get: BotSandboxRedisClient["get"] = async (key) =>
    key === BOT_ACTIVE_GENERATION_KEY ? this.activeRaw : undefined;

  readonly eval: BotSandboxRedisClient["eval"] = async (script, _keys, args) => {
    if (script.includes("wack:bot-sandbox:acquire")) return this.acquire(args);
    if (script.includes("wack:bot-sandbox:renew")) return this.renew(args);
    if (script.includes("wack:bot-sandbox:release")) return this.release(args);
    if (script.includes("wack:bot-sandbox:commit")) return this.commit(args);
    throw new Error("unexpected Redis script");
  };

  stealLease(value: string, fence: number, active?: ActiveBotGeneration): void {
    this.mutex = value;
    this.fence = fence;
    if (active !== undefined) this.activeRaw = active;
  }

  private acquire(args: unknown[]): string | false {
    if (this.mutex !== undefined) return false;
    this.fence += 1;
    this.mutex = `${String(args[0])}:${this.fence}`;
    this.events.push(`acquire:${this.fence}`);
    return JSON.stringify({ lease: this.mutex, generation: this.fence });
  }

  private renew(args: unknown[]): number {
    this.renewCount += 1;
    this.onRenew?.(this.renewCount);
    const renewed = Number(this.mutex === String(args[0]));
    this.events.push(`renew:${this.renewCount}:${renewed}`);
    return renewed;
  }

  private release(args: unknown[]): number {
    const released = Number(this.mutex === String(args[0]));
    if (released === 1) this.mutex = undefined;
    this.events.push(`release:${released}`);
    return released;
  }

  private commit(args: unknown[]): number {
    this.events.push("commit");
    this.beforeCommit?.();
    if (this.mutex !== String(args[0])) return -1;

    const previousGeneration = String(args[1]);
    const previousName = String(args[2]);
    const current = decodeActive(this.activeRaw);
    const previousChanged =
      (previousGeneration === "" && current !== undefined) ||
      (previousGeneration !== "" &&
        (current === undefined ||
          String(current.generation) !== previousGeneration ||
          current.sandboxName !== previousName));
    if (previousChanged) return 0;

    const next = decodeActive(String(args[3]));
    const fencedGeneration = Number(args[4]);
    if (
      next === undefined ||
      next.generation !== fencedGeneration ||
      (current !== undefined && next.generation <= current.generation)
    ) {
      return -2;
    }
    this.activeRaw = next;
    return 1;
  }
}

class CommandFake implements ManagedBotCommand {
  readonly cmdId: string;
  readonly events: string[];
  killed = false;
  waited = false;

  constructor(cmdId: string, events: string[]) {
    this.cmdId = cmdId;
    this.events = events;
  }

  readonly kill: ManagedBotCommand["kill"] = async () => {
    this.killed = true;
    this.events.push(`kill:${this.cmdId}`);
  };

  readonly wait: ManagedBotCommand["wait"] = async () => {
    this.waited = true;
    this.events.push(`wait:${this.cmdId}`);
  };
}

interface SandboxFakeOptions {
  readonly name: string;
  readonly domain?: string;
  readonly image?: string;
  readonly expiresAt?: Date;
  readonly tags?: Record<string, string>;
  readonly events: string[];
  readonly onDelete?: () => void;
}

class SandboxFake implements ManagedBotSandbox {
  readonly name: string;
  readonly persistent = false;
  readonly vcpus = 1;
  readonly image: string | undefined;
  readonly expiresAt: Date | undefined;
  readonly tags: Record<string, string> | undefined;
  status: ManagedBotSandbox["status"] = "running";
  readonly command: CommandFake;
  readonly events: string[];
  readonly publicDomain: string;
  readonly onDelete: (() => void) | undefined;
  stopped = false;
  deleted = false;

  constructor(options: SandboxFakeOptions) {
    this.name = options.name;
    this.image = options.image ?? IMAGE;
    this.expiresAt = options.expiresAt ?? new Date(START + 2 * 60 * 60_000);
    this.tags = options.tags;
    this.events = options.events;
    this.publicDomain = options.domain ?? `https://${options.name}.example.test`;
    this.onDelete = options.onDelete;
    this.command = new CommandFake(`command-${options.name}`, options.events);
  }

  readonly domain: ManagedBotSandbox["domain"] = () => this.publicDomain;

  readonly runCommand: ManagedBotSandbox["runCommand"] = async () => {
    this.events.push(`run:${this.name}`);
    return this.command;
  };

  readonly getCommand: ManagedBotSandbox["getCommand"] = async (commandId) => {
    if (commandId !== this.command.cmdId) throw new Error(`unknown command ${commandId}`);
    return this.command;
  };

  readonly stop: ManagedBotSandbox["stop"] = async () => {
    this.stopped = true;
    this.status = "stopped";
    this.events.push(`stop:${this.name}`);
  };

  readonly delete: ManagedBotSandbox["delete"] = async () => {
    this.deleted = true;
    this.events.push(`delete:${this.name}`);
    this.onDelete?.();
  };
}

class SandboxClientFake implements BotSandboxClient {
  readonly sandboxes = new Map<string, SandboxFake>();
  readonly created: SandboxFake[] = [];
  readonly events: string[];
  candidateDomain: string | undefined;

  constructor(events: string[] = []) {
    this.events = events;
  }

  add(options: Omit<SandboxFakeOptions, "onDelete">): SandboxFake {
    const sandbox = new SandboxFake({
      ...options,
      events: this.events,
      onDelete: () => this.sandboxes.delete(options.name),
    });
    this.sandboxes.set(sandbox.name, sandbox);
    return sandbox;
  }

  readonly create: BotSandboxClient["create"] = async (input) => {
    if (input.name === undefined) throw new Error("candidate name was omitted");
    const name = input.name;
    const candidate = new SandboxFake({
      name,
      ...(this.candidateDomain === undefined ? {} : { domain: this.candidateDomain }),
      ...(input.image === undefined ? {} : { image: input.image }),
      expiresAt: new Date(START + 24 * 60 * 60_000),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      events: this.events,
      onDelete: () => this.sandboxes.delete(name),
    });
    this.created.push(candidate);
    this.sandboxes.set(name, candidate);
    this.events.push(`create:${name}`);
    return candidate;
  };

  readonly get: BotSandboxClient["get"] = async (input) => {
    const sandbox = this.sandboxes.get(input.name);
    if (sandbox === undefined) throw new Error(`missing fake sandbox ${input.name}`);
    this.events.push(`get:${input.name}`);
    return sandbox;
  };

  readonly list: BotSandboxClient["list"] = async () => this.entries();

  has(name: string): boolean {
    return this.sandboxes.has(name);
  }

  private async *entries(): AsyncIterable<ManagedBotSandboxListEntry> {
    this.events.push("list");
    for (const sandbox of this.sandboxes.values()) {
      yield {
        name: sandbox.name,
        persistent: sandbox.persistent,
        createdAt: START,
        updatedAt: START,
        currentSessionId: `session-${sandbox.name}`,
        status: sandbox.status,
        image: sandbox.image,
        expiresAt: sandbox.expiresAt?.getTime(),
        tags: sandbox.tags,
      } satisfies ManagedBotSandboxListEntry;
    }
  }
}

class ClockFake {
  milliseconds = START;
  readonly sleeps: number[] = [];

  readonly now = (): Date => new Date(this.milliseconds);

  readonly sleep = async (milliseconds: number): Promise<void> => {
    this.sleeps.push(milliseconds);
    this.milliseconds += milliseconds;
  };
}

function healthResponse(ready: boolean): Response {
  return Response.json({ ready, websocketPingMs: ready ? 12 : -1, uptimeSeconds: 30 });
}

function fetchFake(handler: (url: string) => Response): typeof globalThis.fetch {
  const implementation = async (
    ...input: Parameters<typeof globalThis.fetch>
  ): Promise<Response> => {
    const request = input[0];
    const url =
      typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    return handler(url);
  };
  implementation.preconnect = (
    ..._input: Parameters<typeof globalThis.fetch.preconnect>
  ): void => {};
  return implementation;
}

function supervisorDeps(
  redis: RedisFake,
  client: SandboxClientFake,
  clock: ClockFake,
  doFetch: typeof globalThis.fetch,
): BotSandboxSupervisorDeps {
  const uuids = [OWNER_UUID, CANDIDATE_UUID];
  return {
    redis,
    sandboxClient: client,
    image: IMAGE,
    botEnv: BOT_ENV,
    fetch: doFetch,
    now: clock.now,
    sleep: clock.sleep,
    randomUUID: () => {
      const value = uuids.shift();
      if (value === undefined) throw new Error("UUID fixture exhausted");
      return value;
    },
    healthReadyTimeoutMs: 20,
    healthPollIntervalMs: 10,
    healthRequestTimeoutMs: 100,
    drainTimeoutMs: 100,
    mutexTtlMs: 1_000,
  };
}

function unwrap<T, E>(result: ResultType<T, E>): T {
  if (Result.isError(result)) throw result.error;
  return result.value;
}

function unwrapError<T, E>(result: ResultType<T, E>): E {
  if (!Result.isError(result)) throw new Error("expected an error result");
  return result.error;
}

function expectBefore(eventLog: readonly string[], first: string, second: string): void {
  const firstIndex = eventLog.findIndex((entry) => entry === first);
  const secondIndex = eventLog.findIndex((entry) => entry === second);
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThan(firstIndex);
}

// oxlint-disable-next-line oxclippy/too-many-lines -- lifecycle scenarios stay together so their shared strict fakes remain visible.
describe("bot Sandbox supervisor", () => {
  test("reuses a healthy active generation with enough lifetime", async () => {
    const events: string[] = [];
    const active = activeGeneration(4, "active");
    const redis = new RedisFake(active, events);
    const client = new SandboxClientFake(events);
    client.add({ name: "active", domain: "https://active.example.test", events });
    const clock = new ClockFake();
    const fetched: string[] = [];
    const supervisor = createBotSandboxSupervisor(
      supervisorDeps(
        redis,
        client,
        clock,
        fetchFake((url) => {
          fetched.push(url);
          return healthResponse(true);
        }),
      ),
    );

    const outcome = unwrap(await supervisor.ensure());

    expect(outcome.status).toBe("healthy");
    if (outcome.status !== "healthy") throw new Error("expected healthy outcome");
    expect(outcome.active).toEqual(active);
    expect(outcome.remainingMs).toBe(2 * 60 * 60_000);
    expect(fetched).toEqual(["https://active.example.test/health"]);
    expect(client.created).toHaveLength(0);
    expect(client.has("active")).toBe(true);
    expect(redis.mutex).toBeUndefined();
  });

  test("rotates near expiry with overlap, then commits before stopping the old bot", async () => {
    const events: string[] = [];
    const active = activeGeneration(7, "old");
    const redis = new RedisFake(active, events);
    const client = new SandboxClientFake(events);
    const old = client.add({
      name: "old",
      expiresAt: new Date(START + BOT_SANDBOX_REFRESH_WINDOW_MS),
      events,
    });
    const clock = new ClockFake();
    let oldWasLiveDuringReadiness = false;
    let oldWasAuthoritativeDuringReadiness = false;
    const supervisor = createBotSandboxSupervisor(
      supervisorDeps(
        redis,
        client,
        clock,
        fetchFake(() => {
          oldWasLiveDuringReadiness = client.has("old") && !old.stopped;
          oldWasAuthoritativeDuringReadiness = decodeActive(redis.activeRaw)?.sandboxName === "old";
          events.push("candidate-ready");
          return healthResponse(true);
        }),
      ),
    );

    const outcome = unwrap(await supervisor.ensure());

    expect(outcome.status).toBe("replaced");
    if (outcome.status !== "replaced") throw new Error("expected replacement outcome");
    const candidate = client.created[0];
    if (candidate === undefined) throw new Error("candidate was not created");
    expect(outcome.previousSandboxName).toBe("old");
    expect(outcome.active.generation).toBe(8);
    expect(decodeActive(redis.activeRaw)).toEqual(outcome.active);
    expect(oldWasLiveDuringReadiness).toBe(true);
    expect(oldWasAuthoritativeDuringReadiness).toBe(true);
    expectBefore(events, `create:${candidate.name}`, "candidate-ready");
    expectBefore(events, "candidate-ready", "commit");
    expectBefore(events, "commit", `kill:${old.command.cmdId}`);
    expect(old.deleted).toBe(true);
  });

  test("honors the Redis active-generation CAS and removes only the losing candidate", async () => {
    const events: string[] = [];
    const active = activeGeneration(10, "old");
    const competing = activeGeneration(12, "winner");
    const redis = new RedisFake(active, events);
    const client = new SandboxClientFake(events);
    const old = client.add({
      name: "old",
      expiresAt: new Date(START + BOT_SANDBOX_REFRESH_WINDOW_MS),
      events,
    });
    redis.beforeCommit = () => {
      redis.activeRaw = competing;
    };
    const supervisor = createBotSandboxSupervisor(
      supervisorDeps(
        redis,
        client,
        new ClockFake(),
        fetchFake(() => healthResponse(true)),
      ),
    );

    const error = unwrapError(await supervisor.ensure());
    const candidate = client.created[0];
    if (candidate === undefined) throw new Error("candidate was not created");

    expect(InvalidBotActiveGeneration.is(error)).toBe(true);
    expect(decodeActive(redis.activeRaw)).toEqual(competing);
    expect(candidate.command.killed).toBe(true);
    expect(candidate.deleted).toBe(true);
    expect(old.stopped).toBe(false);
    expect(client.has("old")).toBe(true);
  });

  test("a stale supervisor cannot commit or delete a newer fenced generation", async () => {
    const events: string[] = [];
    const active = activeGeneration(7, "old");
    const newer = activeGeneration(9, "newer");
    const redis = new RedisFake(active, events);
    const client = new SandboxClientFake(events);
    const old = client.add({
      name: "old",
      expiresAt: new Date(START + BOT_SANDBOX_REFRESH_WINDOW_MS),
      events,
    });
    const newerSandbox = client.add({ name: "newer", tags: { generation: "9" }, events });
    redis.onRenew = (count) => {
      if (count === 4) redis.stealLease("new-owner:9", 9, newer);
    };
    const supervisor = createBotSandboxSupervisor(
      supervisorDeps(
        redis,
        client,
        new ClockFake(),
        fetchFake(() => healthResponse(true)),
      ),
    );

    const error = unwrapError(await supervisor.ensure());
    const staleCandidate = client.created[0];
    if (staleCandidate === undefined) throw new Error("candidate was not created");

    expect(BotSupervisorFenceLost.is(error)).toBe(true);
    expect(decodeActive(redis.activeRaw)).toEqual(newer);
    expect(staleCandidate.deleted).toBe(true);
    expect(newerSandbox.deleted).toBe(false);
    expect(old.deleted).toBe(false);
    expect(events).not.toContain("commit");
  });

  test("keeps the old generation active when candidate readiness times out", async () => {
    const events: string[] = [];
    const active = activeGeneration(3, "old");
    const redis = new RedisFake(active, events);
    const client = new SandboxClientFake(events);
    const old = client.add({
      name: "old",
      expiresAt: new Date(START + BOT_SANDBOX_REFRESH_WINDOW_MS),
      events,
    });
    const clock = new ClockFake();
    const supervisor = createBotSandboxSupervisor(
      supervisorDeps(
        redis,
        client,
        clock,
        fetchFake(() => healthResponse(false)),
      ),
    );

    const error = unwrapError(await supervisor.ensure());
    const candidate = client.created[0];
    if (candidate === undefined) throw new Error("candidate was not created");

    expect(BotSandboxUnhealthy.is(error)).toBe(true);
    expect(decodeActive(redis.activeRaw)).toEqual(active);
    expect(clock.sleeps).toEqual([10, 10]);
    expect(candidate.command.killed).toBe(true);
    expect(candidate.command.waited).toBe(true);
    expect(candidate.deleted).toBe(true);
    expect(old.stopped).toBe(false);
    expect(events).not.toContain("commit");
  });

  test("cleans the previous generation and only orphans within its fence", async () => {
    const events: string[] = [];
    const active = activeGeneration(7, "old");
    const redis = new RedisFake(active, events);
    const client = new SandboxClientFake(events);
    const old = client.add({
      name: "old",
      expiresAt: new Date(START + BOT_SANDBOX_REFRESH_WINDOW_MS),
      tags: { generation: "7" },
      events,
    });
    const oldOrphan = client.add({ name: "orphan-old", tags: { generation: "2" }, events });
    const sameFenceOrphan = client.add({
      name: "orphan-same-fence",
      tags: { generation: "8" },
      events,
    });
    const newerOrphan = client.add({ name: "orphan-newer", tags: { generation: "9" }, events });
    const untaggedOrphan = client.add({ name: "orphan-untagged", events });
    const malformedOrphan = client.add({
      name: "orphan-malformed",
      tags: { generation: "08" },
      events,
    });
    const supervisor = createBotSandboxSupervisor(
      supervisorDeps(
        redis,
        client,
        new ClockFake(),
        fetchFake(() => healthResponse(true)),
      ),
    );

    const outcome = unwrap(await supervisor.ensure());

    expect(outcome.status).toBe("replaced");
    expect(old.command.killed).toBe(true);
    expect(old.deleted).toBe(true);
    expect(oldOrphan.deleted).toBe(true);
    expect(sameFenceOrphan.deleted).toBe(true);
    expect(newerOrphan.deleted).toBe(false);
    expect(untaggedOrphan.deleted).toBe(false);
    expect(malformedOrphan.deleted).toBe(false);
    expect(client.has("orphan-newer")).toBe(true);
    expect(client.has("orphan-untagged")).toBe(true);
    expect(client.has("orphan-malformed")).toBe(true);
  });

  test("rotates a mismatched active endpoint and publishes a sanitized candidate URL", async () => {
    const events: string[] = [];
    const active = activeGeneration(5, "old", "https://wrong.example.test/health");
    const redis = new RedisFake(active, events);
    const client = new SandboxClientFake(events);
    client.add({ name: "old", domain: "https://old.example.test", events });
    client.candidateDomain =
      "https://ignored:secret@candidate.example.test/internal?credential=leak#fragment";
    const fetched: string[] = [];
    const supervisor = createBotSandboxSupervisor(
      supervisorDeps(
        redis,
        client,
        new ClockFake(),
        fetchFake((url) => {
          fetched.push(url);
          return healthResponse(true);
        }),
      ),
    );

    const outcome = unwrap(await supervisor.ensure());

    expect(outcome.status).toBe("replaced");
    if (outcome.status !== "replaced") throw new Error("expected replacement outcome");
    expect(fetched).toEqual(["https://candidate.example.test/health"]);
    expect(outcome.active.healthUrl).toBe("https://candidate.example.test/health");
    expect(decodeActive(redis.activeRaw)?.healthUrl).toBe("https://candidate.example.test/health");
  });

  test("fails closed on a decorated active endpoint from Redis", async () => {
    const events: string[] = [];
    const active = activeGeneration(
      6,
      "old",
      "https://user:secret@old.example.test/health?credential=leak#fragment",
    );
    const redis = new RedisFake(active, events);
    const client = new SandboxClientFake(events);
    let fetchCount = 0;
    const supervisor = createBotSandboxSupervisor(
      supervisorDeps(
        redis,
        client,
        new ClockFake(),
        fetchFake(() => {
          fetchCount += 1;
          return healthResponse(true);
        }),
      ),
    );

    const error = unwrapError(await supervisor.ensure());

    expect(InvalidBotActiveGeneration.is(error)).toBe(true);
    expect(fetchCount).toBe(0);
    expect(client.created).toHaveLength(0);
    expect(redis.activeRaw).toEqual(active);
  });

  test("rejects a non-HTTPS candidate endpoint without changing the active record", async () => {
    const events: string[] = [];
    const active = activeGeneration(2, "old");
    const redis = new RedisFake(active, events);
    const client = new SandboxClientFake(events);
    client.add({
      name: "old",
      expiresAt: new Date(START + BOT_SANDBOX_REFRESH_WINDOW_MS),
      events,
    });
    client.candidateDomain = "http://candidate.example.test";
    let fetchCount = 0;
    const supervisor = createBotSandboxSupervisor(
      supervisorDeps(
        redis,
        client,
        new ClockFake(),
        fetchFake(() => {
          fetchCount += 1;
          return healthResponse(true);
        }),
      ),
    );

    const error = unwrapError(await supervisor.ensure());
    const candidate = client.created[0];
    if (candidate === undefined) throw new Error("candidate was not created");

    expect(BotSandboxUnhealthy.is(error)).toBe(true);
    expect(decodeActive(redis.activeRaw)).toEqual(active);
    expect(fetchCount).toBe(0);
    expect(candidate.command.killed).toBe(true);
    expect(candidate.deleted).toBe(true);
  });
});
