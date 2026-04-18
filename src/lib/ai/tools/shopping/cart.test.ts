import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

import type { Cart } from "../../../shopping/types.ts";

const state: { cart: Cart } = {
  cart: { items: [], updatedAt: "" },
};

vi.mock("@/lib/shopping/cart", () => ({
  getCart: vi.fn(async () => state.cart),
  updateCart: vi.fn(async <T>(mutate: (cart: Cart) => T | Promise<T>): Promise<T> => {
    const result = await mutate(state.cart);
    state.cart = { ...state.cart, updatedAt: "mocked" };
    return result;
  }),
  clearCart: vi.fn(async () => {
    state.cart = { items: [], updatedAt: "" };
  }),
}));

const { add_to_cart, remove_from_cart, update_quantity, view_cart, clear_cart } =
  await import("./cart.ts");
const { updateCart, clearCart: clearCartMock } = await import("@/lib/shopping/cart");

function resetState() {
  state.cart = { items: [], updatedAt: "" };
  vi.mocked(updateCart).mockClear();
  vi.mocked(clearCartMock).mockClear();
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
    expect(state.cart.items).toHaveLength(1);
  });

  it("merges quantity when adding an existing ASIN", async () => {
    state.cart.items.push({ asin: "B01", title: "Widget", price: 10, quantity: 2 });
    const raw = await add_to_cart.execute!(
      { asin: "B01", title: "Widget", price: 10, quantity: 3 },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.item_count).toBe(5);
    expect(state.cart.items).toHaveLength(1);
    expect(state.cart.items[0].quantity).toBe(5);
  });

  it("computes subtotal across mixed items", async () => {
    state.cart.items.push({ asin: "B01", title: "A", price: 5, quantity: 2 });
    const raw = await add_to_cart.execute!(
      { asin: "B02", title: "B", price: 3.5, quantity: 2 },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.subtotal).toBe(17);
  });

  it("routes mutations through updateCart for locking", async () => {
    await add_to_cart.execute!({ asin: "B01", title: "W", price: 1, quantity: 1 }, toolOpts);
    expect(vi.mocked(updateCart)).toHaveBeenCalledOnce();
  });
});

describe("remove_from_cart", () => {
  beforeEach(resetState);

  it("removes an existing item", async () => {
    state.cart.items.push(
      { asin: "B01", title: "A", price: 5, quantity: 1 },
      { asin: "B02", title: "B", price: 5, quantity: 1 },
    );
    const raw = await remove_from_cart.execute!({ asin: "B01" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.removed.asin).toBe("B01");
    expect(parsed.item_count).toBe(1);
    expect(state.cart.items).toHaveLength(1);
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
    state.cart.items.push({ asin: "B01", title: "A", price: 5, quantity: 1 });
    const raw = await update_quantity.execute!({ asin: "B01", quantity: 4 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.quantity).toBe(4);
    expect(state.cart.items[0].quantity).toBe(4);
  });

  it("removes the item when quantity is 0", async () => {
    state.cart.items.push({ asin: "B01", title: "A", price: 5, quantity: 3 });
    await update_quantity.execute!({ asin: "B01", quantity: 0 }, toolOpts);
    expect(state.cart.items).toHaveLength(0);
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
    state.cart.items.push({ asin: "B01", title: "A", price: 2, quantity: 3 });
    state.cart.updatedAt = "2026-01-01T00:00:00Z";
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
      state.cart.items.push({ asin: `B${i}`, title: `T${i}`, price: 1, quantity: 1 });
    }
    const first = JSON.parse((await view_cart.execute!({ page: 1 }, toolOpts)) as string);
    const last = JSON.parse((await view_cart.execute!({ page: 3 }, toolOpts)) as string);
    expect(first.total_pages).toBe(3);
    expect(first.items).toHaveLength(10);
    expect(last.items).toHaveLength(5);
    expect(last.page).toBe(3);
  });

  it("clamps page beyond the last page to the last page", async () => {
    state.cart.items.push({ asin: "B01", title: "A", price: 1, quantity: 1 });
    const raw = await view_cart.execute!({ page: 99 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.page).toBe(1);
  });
});

describe("clear_cart", () => {
  beforeEach(resetState);

  it("clears the cart", async () => {
    state.cart.items.push({ asin: "B01", title: "A", price: 1, quantity: 1 });
    const raw = await clear_cart.execute!({}, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.cleared).toBe(true);
    expect(vi.mocked(clearCartMock)).toHaveBeenCalledOnce();
  });
});
