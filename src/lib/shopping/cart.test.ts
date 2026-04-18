import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Cart } from "./types.ts";

const mockRedis = {
  data: new Map<string, unknown>(),
  opts: new Map<string, Record<string, unknown> | undefined>(),

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  },
  async set(key: string, value: unknown, opts?: Record<string, unknown>) {
    this.data.set(key, value);
    this.opts.set(key, opts);
    return "OK";
  },
  async del(key: string) {
    this.data.delete(key);
    this.opts.delete(key);
    return 1;
  },

  reset() {
    this.data.clear();
    this.opts.clear();
  },
};

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => mockRedis },
}));

const { getCart, saveCart, clearCart } = await import("./cart.ts");

const CART_KEY = "shopping:cart:global";

describe("shopping cart persistence", () => {
  beforeEach(() => mockRedis.reset());

  it("returns an empty cart when none has been saved", async () => {
    const cart = await getCart();
    expect(cart.items).toEqual([]);
    expect(cart.updatedAt).toBeTypeOf("string");
  });

  it("saves and retrieves a cart round-trip", async () => {
    const cart: Cart = {
      items: [{ asin: "B01", title: "Thing", price: 9.99, quantity: 2 }],
      updatedAt: "2026-04-01T00:00:00Z",
    };
    await saveCart(cart);
    const loaded = await getCart();
    expect(loaded.items).toEqual(cart.items);
  });

  it("refreshes updatedAt on save", async () => {
    const cart: Cart = {
      items: [],
      updatedAt: "2020-01-01T00:00:00Z",
    };
    await saveCart(cart);
    const stored = mockRedis.data.get(CART_KEY) as Cart;
    expect(stored.updatedAt).not.toBe("2020-01-01T00:00:00Z");
  });

  it("sets the TTL on save", async () => {
    await saveCart({ items: [], updatedAt: "" });
    const opts = mockRedis.opts.get(CART_KEY);
    expect(opts?.ex).toBe(60 * 60 * 24 * 30);
  });

  it("clears the cart", async () => {
    await saveCart({
      items: [{ asin: "B01", title: "Thing", price: 1, quantity: 1 }],
      updatedAt: "",
    });
    await clearCart();
    const cart = await getCart();
    expect(cart.items).toEqual([]);
  });
});
