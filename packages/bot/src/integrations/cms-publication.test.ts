import { afterAll, afterEach, expect, spyOn, test } from "bun:test";

import { Result } from "@repo/shared/result";

import { createCmsClient } from "./cms.ts";
import type { CmsSyncEvent } from "./cms.ts";

const EVENT: CmsSyncEvent = {
  id: 217,
  slug: "7.6",
  name: "Hack Night 7.6",
  eventType: "hack-night",
  start: "2026-10-24T00:00:00.000Z",
  end: "2026-10-24T06:00:00.000Z",
  location_name: "HIVE (BHEE 270/280)",
  published: false,
  updatedAt: "2026-10-11T21:33:00.000Z",
};
const fetchSpy = spyOn(globalThis, "fetch");
afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());

type Outcome = "success" | "hook-failure" | "rejected" | "lost-response";

function respond(
  handler: (input: string | Request | URL, init?: RequestInit) => Promise<Response>,
) {
  fetchSpy.mockImplementation(Object.assign(handler, { preconnect: () => {} }));
}

function harness(current: CmsSyncEvent = EVENT, outcome: Outcome = "success") {
  let stored = structuredClone(current);
  const patches: RequestInit[] = [];
  respond(async (_url, init) => {
    if (init?.method === "PATCH") {
      patches.push(init);
      if (outcome === "rejected") return new Response("refused", { status: 403 });
      stored = { ...stored, published: true, updatedAt: "2026-10-19T12:55:00.000Z" };
      if (outcome === "hook-failure") return new Response("afterChange failed", { status: 500 });
      if (outcome === "lost-response") throw new Error("response lost after commit");
      return Response.json({ doc: stored });
    }
    return Response.json(stored);
  });
  return { cms: createCmsClient({ apiKey: "test-key" }), patches };
}

test("publication changes only published and verifies the saved record", async () => {
  const check = harness();
  expect((await check.cms.publishEventIfUnchanged(EVENT)).unwrap()).toBe(true);
  expect(check.patches).toHaveLength(1);
  expect(check.patches[0]?.body).toBe('{"published":true}');
  expect(fetchSpy).toHaveBeenCalledTimes(3);
});

test.each(["hook-failure", "lost-response"] satisfies Outcome[])(
  "%s after commit is reconciled without another PATCH",
  async (outcome) => {
    const check = harness(EVENT, outcome);
    expect((await check.cms.publishEventIfUnchanged(EVENT)).unwrap()).toBe(true);
    expect(check.patches).toHaveLength(1);
    expect((await check.cms.publishEventIfUnchanged(EVENT)).unwrap()).toBe(false);
    expect(check.patches).toHaveLength(1);
  },
);

test("an actual rejection is returned after checking the saved state", async () => {
  const check = harness(EVENT, "rejected");
  expect(Result.isError(await check.cms.publishEventIfUnchanged(EVENT))).toBe(true);
  expect(check.patches).toHaveLength(1);
  expect(fetchSpy).toHaveBeenCalledTimes(3);
});

test.each([
  { ...EVENT, updatedAt: "2026-10-19T12:54:00.000Z" },
  { ...EVENT, start: "2026-10-24T01:00:00.000Z" },
  { ...EVENT, slug: "7.06" },
])("an edit between selection and publication blocks the PATCH", async (current) => {
  const check = harness(current);
  expect(Result.isError(await check.cms.publishEventIfUnchanged(EVENT))).toBe(true);
  expect(check.patches).toHaveLength(0);
});

test("a missing revision timestamp cannot authorize a write", async () => {
  const { updatedAt: _updatedAt, ...withoutRevision } = EVENT;
  const check = harness(withoutRevision);
  expect(Result.isError(await check.cms.publishEventIfUnchanged(withoutRevision))).toBe(true);
  expect(check.patches).toHaveLength(0);
});

test("listing drafts does not change the existing published-only listing", async () => {
  const urls: string[] = [];
  respond(async (input) => {
    const address =
      input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    urls.push(address);
    return Response.json({ docs: [EVENT], totalPages: 1 });
  });
  const cms = createCmsClient({ apiKey: "test-key" });
  const after = new Date("2026-10-19T12:55:00Z");
  expect(Result.isOk(await cms.listUpcomingEvents(after))).toBe(true);
  expect(Result.isOk(await cms.listUpcomingPublishedEvents(after))).toBe(true);
  expect(new URL(urls[0] ?? "").searchParams.has("where[published][equals]")).toBe(false);
  expect(new URL(urls[1] ?? "").searchParams.get("where[published][equals]")).toBe("true");
});
