import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Cart } from "./types.ts";

const mockRedis = {
  data: new Map<string, unknown>(),
  opts: new Map<string, Record<string, unknown> | undefined>(),
  evalCalls: [] as Array<{ script: string; keys: string[]; args: string[] }>,

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  },
  async set(key: string, value: unknown, opts?: Record<string, unknown>) {
    if (opts?.nx && this.data.has(key)) return null;
    this.data.set(key, value);
    this.opts.set(key, opts);
    return "OK";
  },
  async del(key: string) {
    this.data.delete(key);
    this.opts.delete(key);
    return 1;
  },
  async eval(script: string, keys: string[], args: string[]) {
    this.evalCalls.push({ script, keys, args });
    const stored = this.data.get(keys[0]);
    if (stored === args[0]) {
      this.data.delete(keys[0]);
      return 1;
    }
    return 0;
  },

  reset() {
    this.data.clear();
    this.opts.clear();
    this.evalCalls = [];
  },
};

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => mockRedis },
}));

const { getCart, updateCart, clearCart } = await import("./cart.ts");

const CART_KEY = "shopping:cart:global";
const LOCK_KEY = "shopping:cart:lock";

describe("shopping cart persistence", () => {
  beforeEach(() => mockRedis.reset());

  it("returns an empty cart when none has been saved", async () => {
    const cart = await getCart();
    expect(cart.items).toEqual([]);
    expect(cart.updatedAt).toBeTypeOf("string");
  });

  it("updateCart persists mutations and refreshes updatedAt", async () => {
    mockRedis.data.set(CART_KEY, {
      items: [{ asin: "B01", title: "T", price: 1, quantity: 1 }],
      updatedAt: "2020-01-01T00:00:00Z",
    } satisfies Cart);
    await updateCart((cart) => {
      cart.items.push({ asin: "B02", title: "U", price: 2, quantity: 1 });
    });
    const stored = mockRedis.data.get(CART_KEY) as Cart;
    expect(stored.items).toHaveLength(2);
    expect(stored.updatedAt).not.toBe("2020-01-01T00:00:00Z");
  });

  it("updateCart returns the mutator's result", async () => {
    const result = await updateCart(() => ({ ok: true }));
    expect(result).toEqual({ ok: true });
  });

  it("updateCart sets the TTL on write", async () => {
    await updateCart((cart) => {
      cart.items.push({ asin: "B01", title: "T", price: 1, quantity: 1 });
    });
    expect(mockRedis.opts.get(CART_KEY)?.ex).toBe(60 * 60 * 24 * 30);
  });

  it("updateCart releases the lock after a successful write", async () => {
    await updateCart(() => undefined);
    expect(mockRedis.data.has(LOCK_KEY)).toBe(false);
    expect(mockRedis.evalCalls).toHaveLength(1);
  });

  it("updateCart releases the lock even when the mutator throws", async () => {
    await expect(
      updateCart(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(mockRedis.data.has(LOCK_KEY)).toBe(false);
  });

  it("clearCart wipes the cart and releases the lock", async () => {
    mockRedis.data.set(CART_KEY, { items: [{} as never], updatedAt: "" });
    await clearCart();
    expect(mockRedis.data.has(CART_KEY)).toBe(false);
    expect(mockRedis.data.has(LOCK_KEY)).toBe(false);
  });
});
