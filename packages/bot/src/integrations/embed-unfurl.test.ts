import { describe, expect, mock, test } from "bun:test";

import { createEmbedWaiter } from "./embed-unfurl.ts";

type Updates = Parameters<typeof createEmbedWaiter>[0];
type Listener = Parameters<Updates["on"]>[1];
const URL = "https://fx.purduehackers.com/t/example/status/123";
const OTHER_URL = "https://fx.purduehackers.com/i/p/ABCDE12";
const noCache = () => undefined;

function gateway(timeoutMs = 100) {
  const listeners = new Set<Listener>();
  const updates = {
    on: mock((_event: "messageUpdate", callback: Listener) => {
      listeners.add(callback);
    }),
    off: mock((_event: "messageUpdate", callback: Listener) => {
      listeners.delete(callback);
    }),
  };
  return {
    updates,
    listeners,
    wait: createEmbedWaiter(updates, timeoutMs),
    emit: (id: string, embeds: { url: string }[]) => {
      for (const callback of listeners) callback({ id, embeds: [] }, { id, embeds });
    },
  };
}

function reply(id = "reply", embeds: { url: string }[] = []) {
  return { id, embeds, fetch: mock(async () => ({ embeds })) };
}

describe("Discord unfurl updates", () => {
  test("already-rendered replies and cached early updates need no listener or REST read", async () => {
    const { wait, updates } = gateway();
    const rendered = reply("rendered", [{ url: URL }]);
    expect(await wait(rendered, [URL], noCache)).toBe(true);
    const early = reply("early");
    expect(await wait(early, [URL], () => [{ url: URL }])).toBe(true);
    expect(updates.on).not.toHaveBeenCalled();
    expect(rendered.fetch).not.toHaveBeenCalled();
    expect(early.fetch).not.toHaveBeenCalled();
  });

  test("resolves on the matching gateway update only after every expected URL arrives", async () => {
    const { wait, emit, listeners } = gateway();
    const message = reply();
    const ready = wait(message, [URL, OTHER_URL], noCache);
    emit("different-reply", [{ url: URL }, { url: OTHER_URL }]);
    emit(message.id, [{ url: URL }]);
    expect(listeners.size).toBe(1);
    emit(message.id, [{ url: URL }, { url: OTHER_URL }]);
    expect(await ready).toBe(true);
    expect(message.fetch).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  test("concurrent replies share one listener and remove it when all waits finish", async () => {
    const { wait, emit, updates, listeners } = gateway();
    const replies = Array.from({ length: 20 }, (_, index) => reply(String(index)));
    const results = replies.map((message) => wait(message, [URL], noCache));
    expect(updates.on).toHaveBeenCalledTimes(1);
    for (const message of replies) emit(message.id, [{ url: URL }]);
    expect(await Promise.all(results)).toEqual(Array.from({ length: 20 }, () => true));
    expect(updates.off).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    for (const message of replies) expect(message.fetch).not.toHaveBeenCalled();
  });

  test("a missed update gets exactly one REST check at the deadline", async () => {
    const { wait, listeners } = gateway(1);
    const message = reply();
    message.fetch.mockResolvedValueOnce({ embeds: [{ url: URL }] });
    expect(await wait(message, [URL], noCache)).toBe(true);
    expect(message.fetch).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  test("an incomplete unfurl times out and releases its listener", async () => {
    const { wait, listeners } = gateway(1);
    const message = reply("partial", [{ url: URL }]);
    expect(await wait(message, [URL, OTHER_URL], noCache)).toBe(false);
    expect(message.fetch).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  test("failed REST checks also release their listeners", async () => {
    const { wait, listeners } = gateway(1);
    const message = reply();
    message.fetch.mockRejectedValueOnce(new Error("message deleted"));
    const failure = await wait(message, [URL], noCache).catch((cause: unknown) => cause);
    expect(failure).toEqual(new Error("message deleted"));
    expect(listeners.size).toBe(0);
  });

  test("an update arriving during the fallback read wins over its older response", async () => {
    const { wait, emit, listeners } = gateway(1);
    const message = reply();
    const fetching = Promise.withResolvers<void>();
    const fetched = Promise.withResolvers<{ embeds: { url: string }[] }>();
    message.fetch.mockImplementationOnce(() => {
      fetching.resolve();
      return fetched.promise;
    });
    const result = wait(message, [URL], noCache);
    await fetching.promise;
    emit(message.id, [{ url: URL }]);
    fetched.resolve({ embeds: [] });
    expect(await result).toBe(true);
    expect(listeners.size).toBe(0);
  });
});
