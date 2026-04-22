import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mockFetch } from "@/lib/test/fixtures";

import type { CreateShipInput } from "./types.ts";

import { ShipsClient } from "./client.ts";

const BASE = "https://ships.purduehackers.com";
const KEY = "test-key";

function sampleInput(): CreateShipInput {
  return {
    userId: "u1",
    username: "nicky",
    avatarUrl: "https://cdn/avatar.png",
    messageId: "m1",
    title: "my ship",
    content: "look at this cool thing",
    attachments: [
      {
        sourceUrl: "https://cdn.discord.com/x.png",
        type: "image/png",
        filename: "x.png",
        width: 100,
        height: 100,
      },
    ],
  };
}

let restoreFetch: () => void = () => {};

beforeEach(() => {});
afterEach(() => {
  restoreFetch();
});

describe("ShipsClient.createShip", () => {
  it("POSTs to /api/ships with bearer auth and the full body", async () => {
    const { fetch, restore } = mockFetch(() => {
      return new Response(JSON.stringify({ ok: true, id: "ship-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    restoreFetch = restore;

    const client = new ShipsClient(KEY);
    const out = await client.createShip(sampleInput());

    expect(out).toMatchObject({ ok: true, id: "ship-1" });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/api/ships`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      userId: "u1",
      messageId: "m1",
      attachments: [{ sourceUrl: "https://cdn.discord.com/x.png" }],
    });
  });

  it("normalizes non-2xx responses as Ships API errors", async () => {
    ({ restore: restoreFetch } = mockFetch(() => new Response("boom", { status: 500 })));
    const client = new ShipsClient(KEY);
    await expect(client.createShip(sampleInput())).rejects.toThrow(/Ships API 500/);
  });
});

describe("ShipsClient.deleteShipByMessageId", () => {
  it("DELETEs to /api/ships/{messageId} and parses the response", async () => {
    const { fetch, restore } = mockFetch(
      () =>
        new Response(JSON.stringify({ ok: true, id: "ship-1", attachmentsRemoved: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    restoreFetch = restore;

    const client = new ShipsClient(KEY);
    const out = await client.deleteShipByMessageId("m1");

    expect(out).toEqual({ deleted: true, id: "ship-1", attachmentsRemoved: 2 });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/api/ships/m1`);
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("treats 404 as a non-error: deleted=false, attachmentsRemoved=0", async () => {
    ({ restore: restoreFetch } = mockFetch(
      () => new Response(JSON.stringify({ ok: false }), { status: 404 }),
    ));
    const client = new ShipsClient(KEY);
    const out = await client.deleteShipByMessageId("missing");
    expect(out).toEqual({ deleted: false, attachmentsRemoved: 0 });
  });

  it("throws on other non-2xx responses", async () => {
    ({ restore: restoreFetch } = mockFetch(() => new Response("nope", { status: 500 })));
    const client = new ShipsClient(KEY);
    await expect(client.deleteShipByMessageId("m1")).rejects.toThrow(/Ships API 500/);
  });

  it("URL-encodes message ids with reserved characters", async () => {
    const { fetch, restore } = mockFetch(
      () => new Response(JSON.stringify({ ok: true, id: "x" }), { status: 200 }),
    );
    restoreFetch = restore;
    const client = new ShipsClient(KEY);
    await client.deleteShipByMessageId("weird/id with space");
    expect(String(fetch.mock.calls[0][0])).toBe(`${BASE}/api/ships/weird%2Fid%20with%20space`);
  });
});
