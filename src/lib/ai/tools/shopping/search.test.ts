import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { search_products } = await import("./search.ts");

function fetchResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
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

    const raw = await search_products.execute!({ query: "widgets" }, toolOpts);
    const parsed = JSON.parse(raw as string);
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
    const raw = await search_products.execute!({ query: "q" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.count).toBe(1);
    expect(parsed.products[0].asin).toBe("B01");
  });

  it("returns null price when price string can't be parsed", async () => {
    mockFetch.mockResolvedValueOnce(
      fetchResponse({
        organic_results: [{ asin: "B01", title: "T", price: "See price on Amazon" }],
      }),
    );
    const raw = await search_products.execute!({ query: "q" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.products[0].price).toBeNull();
  });
});

describe("search_products limits and errors", () => {
  it("clamps max_results to the limit", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      asin: `B${i.toString().padStart(3, "0")}`,
      title: `Item ${i}`,
      extracted_price: i,
    }));
    mockFetch.mockResolvedValueOnce(fetchResponse({ organic_results: many }));
    const raw = await search_products.execute!({ query: "things", max_results: 3 }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.count).toBe(3);
  });

  it("defaults max_results to 5", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      asin: `B${i}`,
      title: `Item ${i}`,
      extracted_price: 1,
    }));
    mockFetch.mockResolvedValueOnce(fetchResponse({ organic_results: many }));
    const raw = await search_products.execute!({ query: "things" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.count).toBe(5);
  });

  it("throws when SerpAPI responds with an error payload", async () => {
    mockFetch.mockResolvedValueOnce(fetchResponse({ error: "Invalid API key" }));
    await expect(search_products.execute!({ query: "q" }, toolOpts)).rejects.toThrow(
      "Invalid API key",
    );
  });

  it("throws when the HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce(fetchResponse({ error: "x" }, false, 500));
    await expect(search_products.execute!({ query: "q" }, toolOpts)).rejects.toThrow(
      /SerpAPI returned 500/,
    );
  });

  it("returns an empty products array when SerpAPI has no organic_results", async () => {
    mockFetch.mockResolvedValueOnce(fetchResponse({}));
    const raw = await search_products.execute!({ query: "q" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.products).toEqual([]);
  });
});
