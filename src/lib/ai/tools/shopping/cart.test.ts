import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

import type { CartItem, CartSnapshot, NewCartItemInput } from "../../../shopping/types.ts";

type Store = { items: CartItem[]; updatedAt: string | null };
const store: Store = { items: [], updatedAt: null };

function makeRow(input: NewCartItemInput, existing?: CartItem): CartItem {
  if (existing) {
    return {
      ...existing,
      title: input.title,
      price: input.price,
      quantity: existing.quantity + input.quantity,
    };
  }
  return {
    id: `id-${input.asin}`,
    cartId: "global",
    asin: input.asin,
    title: input.title,
    price: input.price,
    quantity: input.quantity,
    addedAt: "mocked",
  };
}

function snapshot(): CartSnapshot {
  return { items: store.items, updatedAt: store.updatedAt };
}

vi.mock("@/lib/shopping/cart", () => ({
  getCart: vi.fn(async () => snapshot()),
  addCartItem: vi.fn(async (input: NewCartItemInput) => {
    const existing = store.items.find((entry) => entry.asin === input.asin);
    const row = makeRow(input, existing);
    if (existing) Object.assign(existing, row);
    else store.items.push(row);
    store.updatedAt = "mocked";
    return { item: row, snapshot: snapshot() };
  }),
  removeCartItem: vi.fn(async (asin: string) => {
    const index = store.items.findIndex((entry) => entry.asin === asin);
    if (index === -1) return null;
    const [removed] = store.items.splice(index, 1);
    store.updatedAt = "mocked";
    return { item: removed, snapshot: snapshot() };
  }),
  setCartItemQuantity: vi.fn(async (asin: string, quantity: number) => {
    const existing = store.items.find((entry) => entry.asin === asin);
    if (!existing) return null;
    const before: CartItem = { ...existing };
    if (quantity === 0) {
      store.items = store.items.filter((entry) => entry.asin !== asin);
    } else {
      existing.quantity = quantity;
    }
    store.updatedAt = "mocked";
    return { item: { ...before, quantity }, snapshot: snapshot() };
  }),
  clearCart: vi.fn(async () => {
    store.items = [];
    store.updatedAt = null;
  }),
}));

const { add_to_cart, remove_from_cart, update_quantity, view_cart, clear_cart } =
  await import("./cart.ts");
const cartModule = await import("@/lib/shopping/cart");

function resetState() {
  store.items = [];
  store.updatedAt = null;
  vi.clearAllMocks();
}

describe("add_to_cart", () => {
  beforeEach(resetState);

  it("adds a new item with default quantity 1", async () => {
    const raw = await add_to_cart.execute!(
      { asin: "B01", title: "Widget", price: 10, quantity: 1 },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.added.quantity).toBe(1);
    expect(parsed.subtotal).toBe(10);
    expect(parsed.item_count).toBe(1);
    expect(vi.mocked(cartModule.addCartItem)).toHaveBeenCalledOnce();
  });

  it("merges quantity via addCartItem for existing ASIN", async () => {
    store.items.push({
      id: "id-B01",
      cartId: "global",
      asin: "B01",
      title: "Widget",
      price: 10,
      quantity: 2,
      addedAt: "seed",
    });
    const raw = await add_to_cart.execute!(
      { asin: "B01", title: "Widget", price: 10, quantity: 3 },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.item_count).toBe(5);
    expect(parsed.added.quantity).toBe(5);
  });

  it("computes subtotal across mixed items", async () => {
    store.items.push({
      id: "id-B01",
      cartId: "global",
      asin: "B01",
      title: "A",
      price: 5,
      quantity: 2,
      addedAt: "seed",
    });
    const raw = await add_to_cart.execute!(
      { asin: "B02", title: "B", price: 3.5, quantity: 2 },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.subtotal).toBe(17);
  });
});

describe("remove_from_cart", () => {
  beforeEach(resetState);

  it("removes an existing item", async () => {
    store.items.push(
      {
        id: "id-B01",
        cartId: "global",
        asin: "B01",
        title: "A",
        price: 5,
        quantity: 1,
        addedAt: "seed",
      },
      {
        id: "id-B02",
        cartId: "global",
        asin: "B02",
        title: "B",
        price: 5,
        quantity: 1,
        addedAt: "seed",
      },
    );
    const raw = await remove_from_cart.execute!({ asin: "B01" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.removed.asin).toBe("B01");
    expect(parsed.item_count).toBe(1);
  });

  it("returns an error when ASIN is not present", async () => {
    const raw = await remove_from_cart.execute!({ asin: "missing" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toContain("missing");
  });
});

describe("update_quantity", () => {
  beforeEach(resetState);

  it("updates the quantity of an existing item", async () => {
    store.items.push({
      id: "id-B01",
      cartId: "global",
      asin: "B01",
      title: "A",
      price: 5,
      quantity: 1,
      addedAt: "seed",
    });
    const raw = await update_quantity.execute!({ asin: "B01", quantity: 4 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.quantity).toBe(4);
    expect(parsed.item_count).toBe(4);
  });

  it("removes the item when quantity is 0", async () => {
    store.items.push({
      id: "id-B01",
      cartId: "global",
      asin: "B01",
      title: "A",
      price: 5,
      quantity: 3,
      addedAt: "seed",
    });
    await update_quantity.execute!({ asin: "B01", quantity: 0 }, toolOpts);
    expect(store.items).toHaveLength(0);
  });

  it("errors when the item is not in the cart", async () => {
    const raw = await update_quantity.execute!({ asin: "nope", quantity: 2 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toContain("nope");
  });
});

describe("view_cart", () => {
  beforeEach(resetState);

  it("returns items and totals with a default page", async () => {
    store.items.push({
      id: "id-B01",
      cartId: "global",
      asin: "B01",
      title: "A",
      price: 2,
      quantity: 3,
      addedAt: "seed",
    });
    store.updatedAt = "2026-01-01T00:00:00Z";
    const raw = await view_cart.execute!({ page: 1 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.page).toBe(1);
    expect(parsed.total_pages).toBe(1);
    expect(parsed.subtotal).toBe(6);
    expect(parsed.item_count).toBe(3);
    expect(parsed.updated_at).toBe("2026-01-01T00:00:00Z");
  });

  it("paginates when more than ten items exist", async () => {
    for (let i = 0; i < 25; i++) {
      store.items.push({
        id: `id-${i}`,
        cartId: "global",
        asin: `B${i}`,
        title: `T${i}`,
        price: 1,
        quantity: 1,
        addedAt: "seed",
      });
    }
    const first = JSON.parse((await view_cart.execute!({ page: 1 }, toolOpts)) as string);
    const last = JSON.parse((await view_cart.execute!({ page: 3 }, toolOpts)) as string);
    expect(first.total_pages).toBe(3);
    expect(first.items).toHaveLength(10);
    expect(last.items).toHaveLength(5);
    expect(last.page).toBe(3);
  });

  it("clamps page beyond the last page to the last page", async () => {
    store.items.push({
      id: "id-B01",
      cartId: "global",
      asin: "B01",
      title: "A",
      price: 1,
      quantity: 1,
      addedAt: "seed",
    });
    const raw = await view_cart.execute!({ page: 99 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.page).toBe(1);
  });
});

describe("clear_cart", () => {
  beforeEach(resetState);

  it("clears the cart", async () => {
    store.items.push({
      id: "id-B01",
      cartId: "global",
      asin: "B01",
      title: "A",
      price: 1,
      quantity: 1,
      addedAt: "seed",
    });
    const raw = await clear_cart.execute!({}, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.cleared).toBe(true);
    expect(vi.mocked(cartModule.clearCart)).toHaveBeenCalledOnce();
  });
});
