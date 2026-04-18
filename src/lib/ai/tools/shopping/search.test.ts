import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterAll(() => {
  vi.unstubAllGlobals();
});

const { search_products } = await import("./search.ts");

function fetchResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

async function runSearch(query = "q", max_results = 5) {
  const raw = await search_products.execute!({ query, max_results }, toolOpts);
  return JSON.parse(raw as string);
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("search_products normalization", () => {
  it("returns normalized products from SerpAPI", async () => {
    mockFetch.mockResolvedValueOnce(
      fetchResponse({
        organic_results: [
          {
            asin: "B01",
            title: "Widget",
            extracted_price: 19.99,
            rating: 4.5,
            thumbnail: "https://img.example/1.jpg",
            link_clean: "https://www.amazon.com/dp/B01",
          },
          {
            asin: "B02",
            title: "Gadget",
            price: "$9.50",
            rating: 3.9,
          },
        ],
      }),
    );

    const parsed = await runSearch("widgets");
    expect(parsed.query).toBe("widgets");
    expect(parsed.count).toBe(2);
    expect(parsed.products[0]).toMatchObject({
      asin: "B01",
      title: "Widget",
      price: 19.99,
      rating: 4.5,
      image: "https://img.example/1.jpg",
      url: "https://www.amazon.com/dp/B01",
    });
    expect(parsed.products[1].price).toBe(9.5);
    expect(parsed.products[1].image).toBeNull();
    expect(parsed.products[1].url).toContain("B02");
  });

  it("skips results missing asin or title", async () => {
    mockFetch.mockResolvedValueOnce(
      fetchResponse({
        organic_results: [
          { title: "Missing ASIN" },
          { asin: "B01", title: "Valid" },
          { asin: "B02" },
        ],
      }),
    );
    const parsed = await runSearch();
    expect(parsed.count).toBe(1);
    expect(parsed.products[0].asin).toBe("B01");
  });

  it("returns null price when price string can't be parsed", async () => {
    mockFetch.mockResolvedValueOnce(
      fetchResponse({
        organic_results: [{ asin: "B01", title: "T", price: "See price on Amazon" }],
      }),
    );
    const parsed = await runSearch();
    expect(parsed.products[0].price).toBeNull();
  });
});

describe("search_products limits and errors", () => {
  it("clamps output to max_results", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      asin: `B${i.toString().padStart(3, "0")}`,
      title: `Item ${i}`,
      extracted_price: i,
    }));
    mockFetch.mockResolvedValueOnce(fetchResponse({ organic_results: many }));
    const parsed = await runSearch("things", 3);
    expect(parsed.count).toBe(3);
  });

  it("throws when SerpAPI responds with an error payload", async () => {
    mockFetch.mockResolvedValueOnce(fetchResponse({ error: "Invalid API key" }));
    await expect(runSearch()).rejects.toThrow("Invalid API key");
  });

  it("throws when the HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce(fetchResponse({ error: "x" }, false, 500));
    await expect(runSearch()).rejects.toThrow(/SerpAPI returned 500/);
  });

  it("returns an empty products array when SerpAPI has no organic_results", async () => {
    mockFetch.mockResolvedValueOnce(fetchResponse({}));
    const parsed = await runSearch();
    expect(parsed.products).toEqual([]);
  });
});
