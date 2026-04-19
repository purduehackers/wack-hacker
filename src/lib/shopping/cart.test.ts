import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const client = createClient({ url: "file::memory:?cache=shared" });
  const db = actual.buildDb(client);

  const migrationsDir = "./drizzle";
  const migrationFiles = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrationFiles) {
    const raw = readFileSync(join(migrationsDir, migration), "utf-8");
    for (const statement of raw.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.execute(trimmed);
    }
  }

  return { ...actual, getDb: () => db };
});

const { getDb } = await import("@/lib/db");
const { getCart, addCartItem, removeCartItem, setCartItemQuantity, clearCart } =
  await import("./cart.ts");
const { shoppingCartItems } = await import("@/lib/db/schemas/shopping-cart-items");
const { shoppingCarts } = await import("@/lib/db/schemas/shopping-carts");

beforeEach(async () => {
  const db = getDb();
  await db.delete(shoppingCartItems);
  await db.delete(shoppingCarts);
});

describe("getCart", () => {
  it("returns an empty snapshot before anything exists", async () => {
    const snapshot = await getCart();
    expect(snapshot.items).toEqual([]);
    expect(snapshot.updatedAt).toBeNull();
  });
});

describe("addCartItem", () => {
  it("inserts a new item and returns it with the snapshot", async () => {
    const { item, snapshot } = await addCartItem({
      asin: "B01",
      title: "Widget",
      price: 10,
      quantity: 2,
    });
    expect(item).toMatchObject({ asin: "B01", title: "Widget", price: 10, quantity: 2 });
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.updatedAt).toBeTypeOf("string");
  });

  it("merges quantity for existing ASIN and refreshes title/price", async () => {
    await addCartItem({ asin: "B01", title: "Old", price: 5, quantity: 1 });
    const { item, snapshot } = await addCartItem({
      asin: "B01",
      title: "New",
      price: 9.99,
      quantity: 3,
    });
    expect(item.quantity).toBe(4);
    expect(item.title).toBe("New");
    expect(item.price).toBe(9.99);
    expect(snapshot.items).toHaveLength(1);
  });
});

describe("removeCartItem", () => {
  it("removes an existing item and returns it", async () => {
    await addCartItem({ asin: "B01", title: "A", price: 1, quantity: 1 });
    await addCartItem({ asin: "B02", title: "B", price: 2, quantity: 1 });
    const result = await removeCartItem("B01");
    expect(result?.item.asin).toBe("B01");
    expect(result?.snapshot.items).toHaveLength(1);
    expect(result?.snapshot.items[0].asin).toBe("B02");
  });

  it("returns null when the ASIN is not in the cart", async () => {
    expect(await removeCartItem("missing")).toBeNull();
  });
});

describe("setCartItemQuantity", () => {
  it("updates the quantity for an existing item", async () => {
    await addCartItem({ asin: "B01", title: "A", price: 2, quantity: 1 });
    const result = await setCartItemQuantity("B01", 5);
    expect(result?.item.quantity).toBe(5);
    expect(result?.snapshot.items[0].quantity).toBe(5);
  });

  it("deletes the item when the new quantity is 0", async () => {
    await addCartItem({ asin: "B01", title: "A", price: 2, quantity: 3 });
    const result = await setCartItemQuantity("B01", 0);
    expect(result?.item.asin).toBe("B01");
    expect(result?.snapshot.items).toEqual([]);
  });

  it("returns null when the ASIN is not in the cart", async () => {
    expect(await setCartItemQuantity("missing", 2)).toBeNull();
  });
});

describe("clearCart", () => {
  it("removes every item", async () => {
    await addCartItem({ asin: "B01", title: "A", price: 1, quantity: 1 });
    await addCartItem({ asin: "B02", title: "B", price: 1, quantity: 1 });
    await clearCart();
    const snapshot = await getCart();
    expect(snapshot.items).toEqual([]);
  });

  it("is a no-op when the cart is already empty", async () => {
    await clearCart();
    const snapshot = await getCart();
    expect(snapshot.items).toEqual([]);
  });
});
