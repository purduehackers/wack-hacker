import { describe, it, expect, vi } from "vitest";

import { fetchCatalog, fetchModelInfo, matchModel } from "./models-dev.ts";

const catalog = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    models: {
      "claude-sonnet-4-6-20260301": {
        id: "claude-sonnet-4-6-20260301",
        release_date: "2026-03-01",
        last_updated: "2026-03-01",
        cost: { input: 3, output: 15 },
        limit: { context: 200_000, output: 64_000 },
      },
      "claude-sonnet-4-6-20260115": {
        id: "claude-sonnet-4-6-20260115",
        release_date: "2026-01-15",
        last_updated: "2026-01-15",
        cost: { input: 3, output: 15 },
        limit: { context: 200_000, output: 64_000 },
      },
      "claude-haiku-4-5-20260101": {
        id: "claude-haiku-4-5-20260101",
        release_date: "2026-01-01",
        cost: { input: 1, output: 5 },
        limit: { context: 200_000, output: 32_000 },
      },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      "gpt-5": {
        id: "gpt-5",
        cost: { input: 10, output: 30 },
        limit: { context: 128_000, output: 32_000 },
      },
    },
  },
};

describe("matchModel", () => {
  it("returns null for identifiers without a slash", () => {
    expect(matchModel(catalog, "claude-sonnet-4.6")).toBeNull();
  });

  it("returns null when provider is missing", () => {
    expect(matchModel(catalog, "fakeco/whatever")).toBeNull();
  });

  it("returns null when no model matches", () => {
    expect(matchModel(catalog, "anthropic/claude-sonnet-9.9")).toBeNull();
  });

  it("matches exact model ID after dot-to-dash normalization", () => {
    const catalogWithExact = {
      ...catalog,
      anthropic: {
        ...catalog.anthropic,
        models: {
          "claude-sonnet-4-6": {
            id: "claude-sonnet-4-6",
            cost: { input: 3, output: 15 },
            limit: { context: 200_000, output: 64_000 },
          },
        },
      },
    };
    const info = matchModel(catalogWithExact, "anthropic/claude-sonnet-4.6");
    expect(info).toEqual({
      id: "claude-sonnet-4-6",
      provider: "anthropic",
      cost: { input: 3, output: 15 },
      limit: { context: 200_000, output: 64_000 },
    });
  });

  it("picks the latest dated variant when prefix matches multiple", () => {
    const info = matchModel(catalog, "anthropic/claude-sonnet-4.6");
    expect(info?.id).toBe("claude-sonnet-4-6-20260301");
  });

  it("returns null when the matched entry is missing cost or limit", () => {
    const bad = {
      anthropic: {
        models: {
          "claude-sonnet-4-6-x": { id: "claude-sonnet-4-6-x" },
        },
      },
    };
    expect(matchModel(bad, "anthropic/claude-sonnet-4.6")).toBeNull();
  });

  it("matches haiku prefix for a different gateway id", () => {
    const info = matchModel(catalog, "anthropic/claude-haiku-4.5");
    expect(info?.id).toBe("claude-haiku-4-5-20260101");
  });

  it("handles the openai namespace as a second provider", () => {
    const info = matchModel(catalog, "openai/gpt-5");
    expect(info?.provider).toBe("openai");
    expect(info?.limit.context).toBe(128_000);
  });

  it("rejects a provider id that ends with a slash", () => {
    expect(matchModel(catalog, "anthropic/")).toBeNull();
  });

  it("rejects a bare slash", () => {
    expect(matchModel(catalog, "/")).toBeNull();
  });
});

describe("fetchCatalog", () => {
  it("returns the parsed body on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => catalog,
    });
    const out = await fetchCatalog(fetchImpl as unknown as typeof fetch);
    expect(out).toEqual(catalog);
  });

  it("passes timeout + no-store cache options", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => catalog });
    await fetchCatalog(fetchImpl as unknown as typeof fetch);
    const [, opts] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(opts.cache).toBe("no-store");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null on non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await fetchCatalog(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it("returns null on fetch throw", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    expect(await fetchCatalog(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it("uses the global fetch when no implementation is provided", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    expect(await fetchCatalog()).toBeNull();
    expect(globalFetch).toHaveBeenCalledWith(
      "https://models.dev/api.json",
      expect.objectContaining({ cache: "no-store" }),
    );
    globalFetch.mockRestore();
  });
});

describe("fetchModelInfo", () => {
  it("returns null when catalog fetch fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(
      await fetchModelInfo("anthropic/claude-sonnet-4.6", fetchImpl as unknown as typeof fetch),
    ).toBeNull();
  });

  it("resolves a known model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => catalog });
    const info = await fetchModelInfo(
      "anthropic/claude-sonnet-4.6",
      fetchImpl as unknown as typeof fetch,
    );
    expect(info?.id).toBe("claude-sonnet-4-6-20260301");
  });

  it("uses the global fetch when no implementation is provided", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    expect(await fetchModelInfo("anthropic/claude-sonnet-4.6")).toBeNull();
    globalFetch.mockRestore();
  });
});

describe("matchModel: pickLatest date fallbacks", () => {
  it("falls back to release_date when last_updated is missing", () => {
    const mixedCatalog = {
      anthropic: {
        models: {
          "claude-x-20250101": {
            id: "claude-x-20250101",
            release_date: "2025-01-01",
            cost: { input: 1, output: 2 },
            limit: { context: 10, output: 20 },
          },
          "claude-x-20260301": {
            id: "claude-x-20260301",
            release_date: "2026-03-01",
            cost: { input: 1, output: 2 },
            limit: { context: 10, output: 20 },
          },
        },
      },
    };
    const info = matchModel(mixedCatalog, "anthropic/claude-x");
    expect(info?.id).toBe("claude-x-20260301");
  });

  it("handles entries with neither last_updated nor release_date", () => {
    const dateless = {
      anthropic: {
        models: {
          "claude-y-a": {
            id: "claude-y-a",
            cost: { input: 1, output: 2 },
            limit: { context: 10, output: 20 },
          },
          "claude-y-b": {
            id: "claude-y-b",
            cost: { input: 1, output: 2 },
            limit: { context: 10, output: 20 },
          },
        },
      },
    };
    const info = matchModel(dateless, "anthropic/claude-y");
    // With empty strings both compare equal — sort is stable, first one wins.
    expect(info?.id).toBe("claude-y-a");
  });
});
