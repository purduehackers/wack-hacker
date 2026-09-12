import { expect, spyOn, test } from "bun:test";

import { createCmsClient } from "./cms.ts";

test("upcoming published events paginate with source filters and accept Payload's nullable end", async () => {
  const calls: URL[] = [];
  const request = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input);
        calls.push(url);
        expect(url.origin).toBe("https://cms.purduehackers.com");
        const id = calls.length;
        return new Response(
          `{"docs":[{"id":${id},"slug":"event-${id}","name":"Event","published":true,"end":null}],"totalPages":2}`,
          { headers: { "content-type": "application/json" } },
        );
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const after = new Date("2026-09-12T13:00:00Z");
    const cms = createCmsClient({ apiKey: "test-key" });
    const listed = (await cms.listUpcomingPublishedEvents(after)).unwrap();
    expect(listed.map((event) => event.id)).toEqual([1, 2]);
    expect(calls.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
    for (const url of calls) {
      expect(url.searchParams.get("where[published][equals]")).toBe("true");
      expect(url.searchParams.get("where[start][greater_than]")).toBe(after.toISOString());
      expect(url.searchParams.get("sort")).toBe("start");
    }
  } finally {
    request.mockRestore();
  }
});
