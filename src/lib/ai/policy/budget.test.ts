import { afterEach, describe, expect, it } from "vitest";

import { createMemoryRedis } from "@/lib/test/fixtures";

import { UserRole } from "../constants.ts";
import { BudgetStore, readBudgetState, recordTurnTokens } from "./budget.ts";
import { PUBLIC_DAILY_TOKEN_LIMIT } from "./constants.ts";

function poisonedStore(): BudgetStore {
  const client = Object.assign(createMemoryRedis(), {
    get: async () => {
      throw new Error("redis down");
    },
    incrby: async () => {
      throw new Error("redis down");
    },
  });
  return new BudgetStore(client);
}

const savedEnv = {
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
};

afterEach(() => {
  if (savedEnv.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = savedEnv.url;
  if (savedEnv.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = savedEnv.token;
});

describe("BudgetStore", () => {
  it("reads 0 for a user with no spend", async () => {
    const store = new BudgetStore(createMemoryRedis());
    expect(await store.read("u1")).toBe(0);
  });

  it("accumulates adds within the same day bucket", async () => {
    const store = new BudgetStore(createMemoryRedis());
    await store.add("u1", 1_000);
    await store.add("u1", 250);
    expect(await store.read("u1")).toBe(1_250);
  });

  it("tracks users independently", async () => {
    const store = new BudgetStore(createMemoryRedis());
    await store.add("u1", 100);
    await store.add("u2", 7);
    expect(await store.read("u1")).toBe(100);
    expect(await store.read("u2")).toBe(7);
  });
});

describe("readBudgetState", () => {
  it("returns null for organizers and admins without touching the store", async () => {
    const store = poisonedStore();
    expect(await readBudgetState({ userId: "u", role: UserRole.Organizer }, store)).toBeNull();
    expect(await readBudgetState({ userId: "u", role: UserRole.Admin }, store)).toBeNull();
  });

  it("returns used tokens and the public limit for public users", async () => {
    const store = new BudgetStore(createMemoryRedis());
    await store.add("u1", 42);
    expect(await readBudgetState({ userId: "u1", role: UserRole.Public }, store)).toEqual({
      used: 42,
      limit: PUBLIC_DAILY_TOKEN_LIMIT,
    });
  });

  it("fails open (null) when the store errors", async () => {
    expect(
      await readBudgetState({ userId: "u1", role: UserRole.Public }, poisonedStore()),
    ).toBeNull();
  });

  it("skips the dimension when no store is given and Redis env is absent", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(await readBudgetState({ userId: "u1", role: UserRole.Public })).toBeNull();
  });
});

describe("recordTurnTokens", () => {
  it("folds tokens into the counter", async () => {
    const store = new BudgetStore(createMemoryRedis());
    await recordTurnTokens("u1", 500, store);
    expect(await store.read("u1")).toBe(500);
  });

  it("ignores zero and negative totals", async () => {
    const store = new BudgetStore(createMemoryRedis());
    await recordTurnTokens("u1", 0, store);
    await recordTurnTokens("u1", -5, store);
    expect(await store.read("u1")).toBe(0);
  });

  it("swallows store failures (best-effort)", async () => {
    await expect(recordTurnTokens("u1", 100, poisonedStore())).resolves.toBeUndefined();
  });

  it("no-ops without a store when Redis env is absent", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    await expect(recordTurnTokens("u1", 100)).resolves.toBeUndefined();
  });
});
