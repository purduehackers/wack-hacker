import { expect, test } from "bun:test";

import { writePhackLink } from "./phack.ts";

const destination = "https://purduehackers.com/events";

test.each([
  {
    status: 200,
    body: { slug: "events", d: destination, status: "created" },
    kind: "created",
    reads: 0,
  },
  {
    status: 200,
    body: { slug: "events", d: destination, status: "existing" },
    kind: "same",
    reads: 0,
  },
  { status: 409, body: { message: "Already used" }, kind: "exists", reads: 0 },
  { status: 401, body: { message: "Unauthorized" }, kind: "error", reads: 0 },
  { status: 503, body: { message: "Response lost after commit" }, kind: "same", reads: 1 },
  {
    status: 200,
    body: { slug: "wrong-slug", d: destination, status: "created" },
    kind: "same",
    reads: 1,
  },
])("API result $status/$kind preserves the slug and does not repeat writes", async (scenario) => {
  let writes = 0;
  let reads = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      expect(request.headers.get("authorization")).toBe("Bearer test-key");
      if (request.method === "POST") {
        writes += 1;
        expect(new URL(request.url).pathname).toBe("/api/links");
        expect(await request.json()).toEqual({ slug: "events", destination });
        return Response.json(scenario.body, { status: scenario.status });
      }
      reads += 1;
      expect(new URL(request.url).pathname).toBe("/api/links/events");
      return Response.json({ d: destination, v: 0 });
    },
  });
  try {
    const result = await writePhackLink({
      slug: "events",
      destination,
      token: "test-key",
      url: server.url.origin,
      signal: AbortSignal.timeout(3_000),
    });
    expect(result.kind).toBe(scenario.kind);
    expect(writes).toBe(1);
    expect(reads).toBe(scenario.reads);
  } finally {
    await server.stop(true);
  }
});

test("unavailable writes and reconciliation never claim success", async () => {
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      requests += 1;
      return new Response("Unavailable", { status: 503 });
    },
  });
  try {
    const result = await writePhackLink({
      slug: "events",
      destination,
      token: "test-key",
      url: server.url.origin,
      signal: AbortSignal.timeout(3_000),
    });
    expect(result.kind).toBe("unverified");
    expect(requests).toBe(2);
  } finally {
    await server.stop(true);
  }
});
