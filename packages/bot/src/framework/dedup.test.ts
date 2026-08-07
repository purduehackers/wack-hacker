import { describe, expect, spyOn, test } from "bun:test";

import { DEDUP_TTL_MS, createDeduplicator, type DedupStore } from "./dedup.ts";

describe("Redis event deduplication", () => {
  test("uses an atomic five-minute claim and rejects an existing key", async () => {
    const calls: {
      readonly key: string;
      readonly options: { readonly nx: true; readonly px: number };
    }[] = [];
    let first = true;
    const store: DedupStore = {
      set: async (key, _value, options) => {
        calls.push({ key, options });
        if (first) {
          first = false;
          return "OK";
        }
        return undefined;
      },
    };
    const dedup = createDeduplicator(store);

    expect(await dedup.claim("praise:message-1")).toBe(true);
    expect(await dedup.claim("praise:message-1")).toBe(false);
    expect(calls).toEqual([
      { key: "dedup:praise:message-1", options: { nx: true, px: DEDUP_TTL_MS } },
      { key: "dedup:praise:message-1", options: { nx: true, px: DEDUP_TTL_MS } },
    ]);
  });

  test("fails closed and emits an operational event when Redis is unavailable", async () => {
    const unavailable = new TypeError("Redis unavailable");
    const store: DedupStore = {
      set: async () => {
        throw unavailable;
      },
    };
    const logged = spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(await createDeduplicator(store).claim("ship:message-2")).toBe(false);
      expect(logged).toHaveBeenCalledWith(
        JSON.stringify({
          event: "discord.dedup.unavailable",
          key: "ship:message-2",
          failureType: "TypeError",
        }),
      );
    } finally {
      logged.mockRestore();
    }
  });
});
