import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

// Swap libsql for an in-memory SQLite so the real cart module runs end-to-end
// over ephemeral test data. Mocks the third-party SDK, not `@/lib/db`.
const { memoryClient } = await vi.hoisted(async () => {
  const actual = await import("@libsql/client");
  return { memoryClient: actual.createClient({ url: "file::memory:?cache=shared" }) };
});

vi.mock("@libsql/client", async () => {
  const actual = await vi.importActual<typeof import("@libsql/client")>("@libsql/client");
  return {
    ...actual,
    createClient: vi.fn(() => memoryClient),
  };
});

const { add_to_cart, remove_from_cart, update_quantity, view_cart, clear_cart } =
  await import("./cart.ts");
const { shoppingCartItems } = await import("@/lib/db/schemas/shopping-cart-items");
const { shoppingCarts } = await import("@/lib/db/schemas/shopping-carts");
const { getDb } = await import("@/lib/db");

beforeAll(async () => {
  const migrationsDir = "./drizzle";
  const migrationFiles = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrationFiles) {
    const raw = readFileSync(join(migrationsDir, migration), "utf-8");
    for (const statement of raw.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await memoryClient.execute(trimmed);
    }
  }
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(shoppingCartItems);
  await db.delete(shoppingCarts);
});

describe("add_to_cart", () => {
  it("adds a new item with default quantity 1", async () => {
    const raw = await add_to_cart.execute!(
      { asin: "B01", title: "Widget", price: 10, quantity: 1 },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.added.quantity).toBe(1);
    expect(parsed.subtotal).toBe(10);
    expect(parsed.item_count).toBe(1);
  });

  it("merges quantity via addCartItem for existing ASIN", async () => {
    await add_to_cart.execute!({ asin: "B01", title: "Widget", price: 10, quantity: 2 }, toolOpts);
    const raw = await add_to_cart.execute!(
      { asin: "B01", title: "Widget", price: 10, quantity: 3 },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.item_count).toBe(5);
    expect(parsed.added.quantity).toBe(5);
  });

  it("computes subtotal across mixed items", async () => {
    await add_to_cart.execute!({ asin: "B01", title: "A", price: 5, quantity: 2 }, toolOpts);
    const raw = await add_to_cart.execute!(
      { asin: "B02", title: "B", price: 3.5, quantity: 2 },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.subtotal).toBe(17);
  });
});

describe("remove_from_cart", () => {
  it("removes an existing item", async () => {
    await add_to_cart.execute!({ asin: "B01", title: "A", price: 5, quantity: 1 }, toolOpts);
    await add_to_cart.execute!({ asin: "B02", title: "B", price: 5, quantity: 1 }, toolOpts);
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
  it("updates the quantity of an existing item", async () => {
    await add_to_cart.execute!({ asin: "B01", title: "A", price: 5, quantity: 1 }, toolOpts);
    const raw = await update_quantity.execute!({ asin: "B01", quantity: 4 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.quantity).toBe(4);
    expect(parsed.item_count).toBe(4);
  });

  it("removes the item when quantity is 0", async () => {
    await add_to_cart.execute!({ asin: "B01", title: "A", price: 5, quantity: 3 }, toolOpts);
    await update_quantity.execute!({ asin: "B01", quantity: 0 }, toolOpts);
    const raw = await view_cart.execute!({ page: 1 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.items).toHaveLength(0);
  });

  it("errors when the item is not in the cart", async () => {
    const raw = await update_quantity.execute!({ asin: "nope", quantity: 2 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toContain("nope");
  });
});

describe("view_cart", () => {
  it("returns items and totals with a default page", async () => {
    await add_to_cart.execute!({ asin: "B01", title: "A", price: 2, quantity: 3 }, toolOpts);
    const raw = await view_cart.execute!({ page: 1 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.page).toBe(1);
    expect(parsed.total_pages).toBe(1);
    expect(parsed.subtotal).toBe(6);
    expect(parsed.item_count).toBe(3);
    expect(parsed.updated_at).toBeTypeOf("string");
  });

  it("paginates when more than ten items exist", async () => {
    for (let i = 0; i < 25; i++) {
      await add_to_cart.execute!(
        { asin: `B${i}`, title: `T${i}`, price: 1, quantity: 1 },
        toolOpts,
      );
    }
    const first = JSON.parse((await view_cart.execute!({ page: 1 }, toolOpts)) as string);
    const last = JSON.parse((await view_cart.execute!({ page: 3 }, toolOpts)) as string);
    expect(first.total_pages).toBe(3);
    expect(first.items).toHaveLength(10);
    expect(last.items).toHaveLength(5);
    expect(last.page).toBe(3);
  });

  it("clamps page beyond the last page to the last page", async () => {
    await add_to_cart.execute!({ asin: "B01", title: "A", price: 1, quantity: 1 }, toolOpts);
    const raw = await view_cart.execute!({ page: 99 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.page).toBe(1);
  });
});

describe("clear_cart", () => {
  it("clears the cart", async () => {
    await add_to_cart.execute!({ asin: "B01", title: "A", price: 1, quantity: 1 }, toolOpts);
    const raw = await clear_cart.execute!({}, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.cleared).toBe(true);

    const view = JSON.parse((await view_cart.execute!({ page: 1 }, toolOpts)) as string);
    expect(view.items).toHaveLength(0);
  });
});
