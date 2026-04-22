import { beforeEach, describe, expect, it, vi } from "vitest";

import { payloadSDKClass, toolOpts } from "@/lib/test/fixtures";

import { hasApprovalMarker } from "../../approvals/index.ts";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  findByID: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@payloadcms/sdk", () => ({
  PayloadSDK: payloadSDKClass(mocks),
  PayloadSDKError: class extends Error {
    status = 0;
  },
}));

process.env.PAYLOAD_CMS_API_KEY = "k";

const { list_rsvps, get_rsvp, create_rsvp, update_rsvp, delete_rsvp } = await import("./rsvps.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_rsvps", () => {
  it("flattens expanded event relationship into event_id", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 1,
      totalPages: 1,
      page: 1,
      docs: [{ id: 1, email: "a@b.com", name: "A", event: { id: 42 } }],
    });
    const raw = await list_rsvps.execute!({}, toolOpts);
    expect(JSON.parse(raw as string).docs[0].event_id).toBe(42);
  });

  it("builds a where clause from filter params", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    await list_rsvps.execute!({ event_id: 1, unsubscribed: false }, toolOpts);
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "rsvps",
      limit: 25,
      page: 1,
      where: { event: { equals: 1 }, unsubscribed: { equals: false } },
    });
  });
});

describe("get_rsvp", () => {
  it("returns a projected rsvp", async () => {
    mocks.findByID.mockResolvedValueOnce({ id: 5, email: "a@b.com", event: 1 });
    const raw = await get_rsvp.execute!({ id: 5 }, toolOpts);
    expect(JSON.parse(raw as string)).toMatchObject({ id: 5, email: "a@b.com", event_id: 1 });
  });
});

describe("create_rsvp", () => {
  it("maps event_id to event relationship and defaults unsubscribed", async () => {
    mocks.create.mockResolvedValueOnce({ id: 10 });
    await create_rsvp.execute!({ event_id: 2, email: "a@b.com", name: "A" }, toolOpts);
    expect(mocks.create).toHaveBeenCalledWith({
      collection: "rsvps",
      data: { event: 2, email: "a@b.com", name: "A", unsubscribed: false },
    });
  });
});

describe("update_rsvp", () => {
  it("renames event_id → event in the patch", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await update_rsvp.execute!({ id: 1, event_id: 99 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "rsvps",
      id: 1,
      data: { event: 99 },
    });
  });
});

describe("delete_rsvp", () => {
  it("is approval-gated", () => {
    expect(hasApprovalMarker(delete_rsvp)).toBe(true);
  });

  it("returns delete confirmation", async () => {
    mocks.delete.mockResolvedValueOnce({ id: 3 });
    const raw = await delete_rsvp.execute!({ id: 3 }, toolOpts);
    expect(JSON.parse(raw as string)).toEqual({ deleted: true, id: 3 });
  });
});
