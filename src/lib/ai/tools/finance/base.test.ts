import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";
import organizationFixture from "@/lib/test/fixtures/hcb/organization.json";
import transactionsFixture from "@/lib/test/fixtures/hcb/transactions.json";

import { get_balance, get_organization } from "./base.ts";
import { list_card_charges } from "./card-charges.ts";
import { donation_totals } from "./donations.ts";
import { get_receipt_status, list_missing_receipts } from "./receipts.ts";
import { find_transactions, list_transactions } from "./transactions.ts";

const originalFetch = globalThis.fetch;

function mockFetch(impl: (url: URL) => Response) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
    impl(input as URL),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.HCB_ORG_SLUG = "purdue-hackers";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("get_organization", () => {
  it("returns a compact projection of the org profile", async () => {
    mockFetch(() => new Response(JSON.stringify(organizationFixture), { status: 200 }));
    const raw = await get_organization.execute!({}, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed).toMatchObject({
      id: "org_ph1",
      name: "Purdue Hackers",
      slug: "purdue-hackers",
      transparent: true,
      balance_cents: 1_234_567,
      total_raised_cents: 4_321_000,
    });
  });
});

describe("get_balance", () => {
  it("returns only the balance fields", async () => {
    mockFetch(() => new Response(JSON.stringify(organizationFixture), { status: 200 }));
    const raw = await get_balance.execute!({}, toolOpts);
    expect(JSON.parse(raw as string)).toEqual({
      balance_cents: 1_234_567,
      fee_balance_cents: -5000,
      incoming_balance_cents: 25_000,
      total_raised_cents: 4_321_000,
    });
  });
});

describe("list_transactions", () => {
  it("hits the transactions endpoint with default paging", async () => {
    const seen: URL[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input as URL;
      seen.push(url);
      return new Response(JSON.stringify(transactionsFixture), { status: 200 });
    }) as unknown as typeof fetch;
    const raw = await list_transactions.execute!(
      { per_page: undefined, page: undefined },
      toolOpts,
    );
    expect(seen[0].pathname).toBe("/api/v3/organizations/purdue-hackers/transactions");
    expect(seen[0].searchParams.get("per_page")).toBe("50");
    const parsed = JSON.parse(raw as string);
    expect(parsed).toHaveLength(4);
    expect(parsed[0].href).toBe("https://hcb.hackclub.com/hcb/txn_food_1");
  });
});

describe("find_transactions", () => {
  it("filters by memo substring (case-insensitive)", async () => {
    mockFetch((url) => {
      if (Number(url.searchParams.get("page")) > 1) {
        return new Response("[]", { status: 200 });
      }
      return new Response(JSON.stringify(transactionsFixture), { status: 200 });
    });
    const raw = await find_transactions.execute!({ memo_contains: "HACK NIGHT" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.map((t: { id: string }) => t.id).sort()).toEqual(["txn_food_1", "txn_food_2"]);
  });

  it("filters by amount and pending status", async () => {
    mockFetch((url) => {
      if (Number(url.searchParams.get("page")) > 1) {
        return new Response("[]", { status: 200 });
      }
      return new Response(JSON.stringify(transactionsFixture), { status: 200 });
    });
    const raw = await find_transactions.execute!(
      { min_amount_cents: 1, pending: "exclude" },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.map((t: { id: string }) => t.id)).toEqual(["txn_donation_1"]);
  });

  it("filters by ISO date range", async () => {
    mockFetch((url) => {
      if (Number(url.searchParams.get("page")) > 1) {
        return new Response("[]", { status: 200 });
      }
      return new Response(JSON.stringify(transactionsFixture), { status: 200 });
    });
    const raw = await find_transactions.execute!(
      { since: "2026-04-01", until: "2026-04-30" },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.map((t: { id: string }) => t.id).sort()).toEqual([
      "txn_badge_1",
      "txn_donation_1",
    ]);
  });
});

describe("donation_totals", () => {
  it("sums settled donations in the requested window", async () => {
    const donations = [
      { amount_cents: 50_000, status: "deposited", created_at: "2026-04-05", recurring: false },
      { amount_cents: 25_000, status: "deposited", created_at: "2026-04-10", recurring: true },
      { amount_cents: 100_000, status: "deposited", created_at: "2026-05-01", recurring: false },
      { amount_cents: 999, status: "pending", created_at: "2026-04-06", recurring: false },
    ];
    mockFetch((url) => {
      if (Number(url.searchParams.get("page")) > 1) {
        return new Response("[]", { status: 200 });
      }
      return new Response(JSON.stringify(donations), { status: 200 });
    });
    const raw = await donation_totals.execute!(
      { since: "2026-04-01", until: "2026-04-30" },
      toolOpts,
    );
    expect(JSON.parse(raw as string)).toMatchObject({
      total_cents: 75_000,
      count: 2,
      recurring_cents: 25_000,
      one_time_cents: 50_000,
    });
  });
});

describe("list_missing_receipts", () => {
  it("surfaces only transactions flagged missing a receipt", async () => {
    mockFetch((url) => {
      if (Number(url.searchParams.get("page")) > 1) {
        return new Response("[]", { status: 200 });
      }
      return new Response(JSON.stringify(transactionsFixture), { status: 200 });
    });
    const raw = await list_missing_receipts.execute!({ limit: undefined }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.map((t: { id: string }) => t.id).sort()).toEqual(["txn_badge_1", "txn_food_2"]);
    expect(parsed[0].href).toContain("hcb.hackclub.com/hcb/");
  });
});

describe("get_receipt_status", () => {
  it("returns a receipts object consistent with other finance tools", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ id: "txn_food_2", receipts: { count: 0, missing: true } }), {
          status: 200,
        }),
    );
    const raw = await get_receipt_status.execute!({ id: "txn_food_2" }, toolOpts);
    expect(JSON.parse(raw as string)).toEqual({
      id: "txn_food_2",
      receipts: { count: 0, missing: true },
      href: "https://hcb.hackclub.com/hcb/txn_food_2",
    });
  });
});

describe("list_card_charges", () => {
  it("filters by cardholder substring when `user` is provided", async () => {
    const charges = [
      { id: "cc_1", user: { name: "Alice Adams", email: "alice@example.com" }, amount_cents: -500 },
      { id: "cc_2", user: { name: "Bob Baker", email: "bob@example.com" }, amount_cents: -700 },
    ];
    mockFetch((url) => {
      if (Number(url.searchParams.get("page")) > 1) {
        return new Response("[]", { status: 200 });
      }
      return new Response(JSON.stringify(charges), { status: 200 });
    });
    const raw = await list_card_charges.execute!({ user: "alice" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].user).toBe("Alice Adams");
  });
});
