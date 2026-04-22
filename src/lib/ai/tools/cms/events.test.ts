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

const {
  list_events,
  get_event,
  create_event,
  update_event,
  delete_event,
  publish_event,
  unpublish_event,
  send_blast,
} = await import("./events.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_events", () => {
  it("paginates and projects the events response", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 2,
      totalPages: 1,
      page: 1,
      docs: [
        {
          id: 1,
          name: "Hack Night",
          published: true,
          eventType: "hack-night",
          start: "2026-05-01",
          sentAt: "2026-04-20",
        },
      ],
    });
    const raw = await list_events.execute!({}, toolOpts);
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "events",
      limit: 25,
      page: 1,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.total_docs).toBe(2);
    expect(parsed.docs[0]).toMatchObject({
      id: 1,
      name: "Hack Night",
      published: true,
      event_type: "hack-night",
      href: "https://cms.purduehackers.com/admin/collections/events/1",
    });
  });

  it("applies published_only filter", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    await list_events.execute!({ published_only: true }, toolOpts);
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "events",
      limit: 25,
      page: 1,
      where: { published: { equals: true } },
    });
  });
});

describe("get_event", () => {
  it("returns the projected event", async () => {
    mocks.findByID.mockResolvedValueOnce({ id: 7, name: "Test" });
    const raw = await get_event.execute!({ id: 7 }, toolOpts);
    expect(mocks.findByID).toHaveBeenCalledWith({ collection: "events", id: 7 });
    expect(JSON.parse(raw as string)).toMatchObject({
      id: 7,
      name: "Test",
      href: "https://cms.purduehackers.com/admin/collections/events/7",
    });
  });
});

describe("create_event", () => {
  it("wraps description as Lexical and defaults eventType", async () => {
    mocks.create.mockResolvedValueOnce({ id: 10, name: "New", published: false });
    await create_event.execute!(
      { name: "New", start: "2026-05-01", description: "hello world" },
      toolOpts,
    );
    const call = mocks.create.mock.calls[0][0];
    expect(call.collection).toBe("events");
    expect(call.data.eventType).toBe("hack-night");
    expect(call.data.published).toBe(false);
    const root = call.data.description.root;
    expect(root.children[0].children[0].text).toBe("hello world");
  });
});

describe("update_event", () => {
  it("passes through only the provided fields", async () => {
    mocks.update.mockResolvedValueOnce({ id: 3, name: "Renamed" });
    await update_event.execute!({ id: 3, name: "Renamed" }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "events",
      id: 3,
      data: { name: "Renamed" },
    });
  });

  it("rewraps description when provided", async () => {
    mocks.update.mockResolvedValueOnce({ id: 3 });
    await update_event.execute!({ id: 3, description: "updated prose" }, toolOpts);
    const data = mocks.update.mock.calls[0][0].data;
    expect(data.description.root.children[0].children[0].text).toBe("updated prose");
  });
});

describe("delete_event", () => {
  it("is approval-gated", () => {
    expect(hasApprovalMarker(delete_event)).toBe(true);
  });

  it("returns a delete confirmation", async () => {
    mocks.delete.mockResolvedValueOnce({ id: 5 });
    const raw = await delete_event.execute!({ id: 5 }, toolOpts);
    expect(mocks.delete).toHaveBeenCalledWith({ collection: "events", id: 5 });
    expect(JSON.parse(raw as string)).toEqual({ deleted: true, id: 5 });
  });
});

describe("publish_event / unpublish_event", () => {
  it("patches published true", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1, published: true });
    await publish_event.execute!({ id: 1 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "events",
      id: 1,
      data: { published: true },
    });
  });

  it("patches published false", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1, published: false });
    await unpublish_event.execute!({ id: 1 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "events",
      id: 1,
      data: { published: false },
    });
  });
});

describe("send_blast", () => {
  it("is approval-gated", () => {
    expect(hasApprovalMarker(send_blast)).toBe(true);
  });

  it("flips send: true to trigger Payload's afterChange hook", async () => {
    mocks.update.mockResolvedValueOnce({ id: 4, send: false, sentAt: "2026-04-22" });
    const raw = await send_blast.execute!({ id: 4 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "events",
      id: 4,
      data: { send: true },
    });
    expect(JSON.parse(raw as string)).toMatchObject({ triggered: true, id: 4 });
  });
});
