import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const hoisted = vi.hoisted(() => ({
  searchAndContents: vi.fn(),
  ExaCtor: vi.fn(),
}));

vi.mock("exa-js", () => {
  // Default export class whose instance exposes `searchAndContents`.
  class Exa {
    constructor(...args: unknown[]) {
      hoisted.ExaCtor(...args);
    }
    searchAndContents = hoisted.searchAndContents;
  }
  return { default: Exa };
});

const { web_search } = await import("./index.ts");

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.searchAndContents.mockReset();
});

describe("web_search", () => {
  it("formats successful results with title, url, and summary", async () => {
    hoisted.searchAndContents.mockResolvedValueOnce({
      results: [
        {
          title: "Hello world",
          url: "https://example.com/hello",
          publishedDate: "2024-05-01T00:00:00.000Z",
          author: "Ada Lovelace",
          summary: "A friendly greeting from the web.",
          highlights: [],
        },
        {
          title: "Second post",
          url: "https://example.com/two",
          summary: "",
          highlights: ["highlight one", "highlight two"],
        },
      ],
    });

    const result = await web_search.execute!({ query: "hello", numResults: 2 } as never, toolOpts);

    expect(typeof result).toBe("string");
    const out = result as string;
    expect(out).toContain("Hello world");
    expect(out).toContain("https://example.com/hello");
    expect(out).toContain("A friendly greeting from the web.");
    expect(out).toContain("Ada Lovelace");
    expect(out).toContain("2024-05-01");
    // falls back to highlights when summary missing
    expect(out).toContain("highlight one");
    expect(out).toContain("highlight two");
  });

  it("returns 'No results found.' for empty results", async () => {
    hoisted.searchAndContents.mockResolvedValueOnce({ results: [] });

    const result = await web_search.execute!({ query: "nothing here" } as never, toolOpts);

    expect(result).toBe("No results found.");
  });

  it("returns a 'Web search failed' string when Exa throws", async () => {
    hoisted.searchAndContents.mockRejectedValueOnce(new Error("boom"));

    const result = await web_search.execute!({ query: "kaboom" } as never, toolOpts);

    expect(typeof result).toBe("string");
    expect(result as string).toContain("Web search failed");
    expect(result as string).toContain("boom");
  });

  it("forwards category and livecrawl params to the SDK", async () => {
    hoisted.searchAndContents.mockResolvedValueOnce({ results: [] });

    await web_search.execute!(
      {
        query: "exa news",
        numResults: 3,
        type: "neural",
        category: "news",
        livecrawl: "always",
        includeDomains: ["example.com"],
        excludeDomains: ["spam.example"],
        includeText: "must include",
        excludeText: "must exclude",
      } as never,
      toolOpts,
    );

    expect(hoisted.searchAndContents).toHaveBeenCalledTimes(1);
    const [calledQuery, calledOpts] = hoisted.searchAndContents.mock.calls[0];
    expect(calledQuery).toBe("exa news");
    expect(calledOpts).toMatchObject({
      numResults: 3,
      type: "neural",
      category: "news",
      livecrawl: "always",
      includeDomains: ["example.com"],
      excludeDomains: ["spam.example"],
      includeText: ["must include"],
      excludeText: ["must exclude"],
      summary: { query: "exa news" },
    });
  });
});
