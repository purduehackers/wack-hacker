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
  list_hack_night_sessions,
  get_hack_night_session,
  create_hack_night_session,
  update_hack_night_session,
  delete_hack_night_session,
  publish_hack_night_session,
  unpublish_hack_night_session,
} = await import("./hack_night_sessions.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_hack_night_sessions", () => {
  it("passes published_only filter through", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    await list_hack_night_sessions.execute!({ published_only: true }, toolOpts);
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "hack-night-sessions",
      limit: 25,
      page: 1,
      where: { published: { equals: true } },
    });
  });

  it("includes host field in projection", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 1,
      totalPages: 1,
      page: 1,
      docs: [
        {
          id: 1,
          title: "Tuesday",
          host: { preferred_name: "Ray", discord_id: "123" },
        },
      ],
    });
    const raw = await list_hack_night_sessions.execute!({}, toolOpts);
    expect(JSON.parse(raw as string).docs[0].host).toEqual({
      preferred_name: "Ray",
      discord_id: "123",
    });
  });
});

describe("get_hack_night_session", () => {
  it("returns the projected doc", async () => {
    mocks.findByID.mockResolvedValueOnce({ id: 3, title: "x" });
    const raw = await get_hack_night_session.execute!({ id: 3 }, toolOpts);
    expect(JSON.parse(raw as string)).toMatchObject({
      id: 3,
      title: "x",
      href: "https://cms.purduehackers.com/admin/collections/hack-night-sessions/3",
    });
  });
});

describe("create_hack_night_session", () => {
  it("nests host fields into a group and wraps description as Lexical", async () => {
    mocks.create.mockResolvedValueOnce({ id: 1 });
    await create_hack_night_session.execute!(
      {
        title: "Weekly",
        date: "2026-05-01",
        host_preferred_name: "Ray",
        host_discord_id: "abc",
        description: "hi",
      },
      toolOpts,
    );
    const call = mocks.create.mock.calls[0][0];
    expect(call.data.host).toEqual({ preferred_name: "Ray", discord_id: "abc" });
    expect(call.data.description.root.children[0].children[0].text).toBe("hi");
    expect(call.data.published).toBe(false);
  });
});

describe("update_hack_night_session", () => {
  it("rebuilds host group only when a host field is provided", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await update_hack_night_session.execute!({ id: 1, host_preferred_name: "A" }, toolOpts);
    const data = mocks.update.mock.calls[0][0].data;
    expect(data.host).toEqual({ preferred_name: "A" });
  });

  it("omits host when neither host field is provided", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await update_hack_night_session.execute!({ id: 1, title: "x" }, toolOpts);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ title: "x" });
  });
});

describe("delete_hack_night_session", () => {
  it("is approval-gated", () => {
    expect(hasApprovalMarker(delete_hack_night_session)).toBe(true);
  });
});

describe("publish/unpublish", () => {
  it("publish sets published true", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await publish_hack_night_session.execute!({ id: 1 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "hack-night-sessions",
      id: 1,
      data: { published: true },
    });
  });

  it("unpublish sets published false", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await unpublish_hack_night_session.execute!({ id: 1 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "hack-night-sessions",
      id: 1,
      data: { published: false },
    });
  });
});
