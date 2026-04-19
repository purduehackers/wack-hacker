import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hcbGet, hcbOrgSlug, hcbPaginate, hcbTxnUrl } from "./client.ts";

const originalFetch = globalThis.fetch;

function mockFetch(impl: (url: URL) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = input as URL;
    return impl(url);
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  process.env.HCB_ORG_SLUG = "purdue-hackers";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("hcbOrgSlug", () => {
  it("returns the configured slug", () => {
    expect(hcbOrgSlug()).toBe("purdue-hackers");
  });

  it("throws a helpful error when the slug is not configured", () => {
    const original = process.env.HCB_ORG_SLUG;
    delete process.env.HCB_ORG_SLUG;
    try {
      expect(() => hcbOrgSlug()).toThrow(/HCB_ORG_SLUG/);
    } finally {
      if (original !== undefined) process.env.HCB_ORG_SLUG = original;
    }
  });
});

describe("hcbTxnUrl", () => {
  it("builds the HCB web UI link for a transaction id", () => {
    expect(hcbTxnUrl("txn_abc")).toBe("https://hcb.hackclub.com/hcb/txn_abc");
  });
});

describe("hcbGet", () => {
  it("hits the v3 base URL and returns parsed JSON", async () => {
    const fetchMock = mockFetch((url) => {
      expect(url.origin).toBe("https://hcb.hackclub.com");
      expect(url.pathname).toBe("/api/v3/organizations/purdue-hackers");
      return new Response(JSON.stringify({ name: "Purdue Hackers" }), { status: 200 });
    });
    const data = await hcbGet<{ name: string }>("/organizations/purdue-hackers");
    expect(data.name).toBe("Purdue Hackers");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("serializes query params, skipping null/undefined", async () => {
    mockFetch((url) => {
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("per_page")).toBe("100");
      expect(url.searchParams.has("skip")).toBe(false);
      return new Response("[]", { status: 200 });
    });
    await hcbGet("/organizations/purdue-hackers/transactions", {
      page: 2,
      per_page: 100,
      skip: undefined,
      other: null,
    });
  });

  it("appends array query params as repeated keys", async () => {
    mockFetch((url) => {
      expect(url.searchParams.getAll("status")).toEqual(["open", "paid"]);
      return new Response("[]", { status: 200 });
    });
    await hcbGet("/anything", { status: ["open", "paid"] });
  });

  it("throws a helpful 404 error", async () => {
    mockFetch(() => new Response("not found", { status: 404 }));
    await expect(hcbGet("/organizations/missing")).rejects.toThrow(/404/);
  });

  it("throws a specific message on 429", async () => {
    mockFetch(() => new Response("rate limited", { status: 429 }));
    await expect(hcbGet("/x")).rejects.toThrow(/rate limited/i);
  });

  it("throws with status + body for unexpected errors", async () => {
    mockFetch(() => new Response("server exploded", { status: 500 }));
    await expect(hcbGet("/x")).rejects.toThrow(/500/);
  });
});

describe("hcbPaginate", () => {
  it("stops when a page returns an empty array", async () => {
    const pages: Record<string, unknown[]> = {
      "1": [{ id: "a" }, { id: "b" }],
      "2": [],
    };
    mockFetch((url) => {
      const page = url.searchParams.get("page") ?? "1";
      return new Response(JSON.stringify(pages[page]), { status: 200 });
    });
    const rows = await hcbPaginate<{ id: string }>("/transactions", {}, { perPage: 2 });
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("stops when a partial page is returned (signals last page)", async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      const page = url.searchParams.get("page") ?? "1";
      calls.push(page);
      return new Response(JSON.stringify([{ id: `p${page}` }]), { status: 200 });
    });
    const rows = await hcbPaginate<{ id: string }>("/x", {}, { perPage: 50 });
    expect(calls).toEqual(["1"]);
    expect(rows).toHaveLength(1);
  });

  it("respects the maxItems cap", async () => {
    mockFetch((url) => {
      const page = Number(url.searchParams.get("page") ?? "1");
      const rows = Array.from({ length: 3 }, (_, i) => ({ id: `${page}-${i}` }));
      return new Response(JSON.stringify(rows), { status: 200 });
    });
    const rows = await hcbPaginate<{ id: string }>(
      "/x",
      {},
      {
        perPage: 3,
        maxItems: 4,
        maxPages: 10,
      },
    );
    expect(rows).toHaveLength(4);
  });

  it("respects the maxPages cap", async () => {
    const seen: string[] = [];
    mockFetch((url) => {
      seen.push(url.searchParams.get("page") ?? "?");
      return new Response(JSON.stringify([{ id: "x" }, { id: "y" }]), { status: 200 });
    });
    await hcbPaginate<{ id: string }>("/x", {}, { perPage: 2, maxPages: 2, maxItems: 1000 });
    expect(seen).toEqual(["1", "2"]);
  });
});
