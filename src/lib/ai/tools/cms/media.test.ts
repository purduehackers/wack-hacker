import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockFetch, payloadSDKClass, toolOpts } from "@/lib/test/fixtures";

import { hasApprovalMarker } from "../../approvals/index.ts";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  findByID: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@payloadcms/sdk", () => ({
  PayloadSDK: payloadSDKClass(mocks),
  PayloadSDKError: class extends Error {
    status = 0;
  },
}));

process.env.PAYLOAD_CMS_API_KEY = "k";

const { list_media, get_media, upload_media, delete_media } = await import("./media.ts");

let restoreFetch: () => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  restoreFetch();
});

describe("list_media", () => {
  it("builds where from source + batch_id filters", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    await list_media.execute!({ source: "hack-night", batch_id: "b1" }, toolOpts);
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "media",
      limit: 25,
      page: 1,
      where: { source: { equals: "hack-night" }, batchId: { equals: "b1" } },
    });
  });

  it("projects camelCase fields to snake_case", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 1,
      totalPages: 1,
      page: 1,
      docs: [
        {
          id: 1,
          alt: "x",
          thumbnailURL: "https://cdn/x.png",
          mimeType: "image/png",
          batchId: "b",
          discordMessageId: "m",
          discordUserId: "u",
        },
      ],
    });
    const raw = await list_media.execute!({}, toolOpts);
    expect(JSON.parse(raw as string).docs[0]).toMatchObject({
      thumbnail_url: "https://cdn/x.png",
      mime_type: "image/png",
      batch_id: "b",
      discord_message_id: "m",
      discord_user_id: "u",
    });
  });
});

describe("get_media", () => {
  it("returns a single projected media record", async () => {
    mocks.findByID.mockResolvedValueOnce({ id: 1, alt: "alt" });
    const raw = await get_media.execute!({ id: 1 }, toolOpts);
    expect(JSON.parse(raw as string)).toMatchObject({
      id: 1,
      alt: "alt",
      href: "https://cms.purduehackers.com/admin/collections/media/1",
    });
  });
});

describe("upload_media", () => {
  it("fetches the URL then creates media with the derived filename", async () => {
    ({ restore: restoreFetch } = mockFetch(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    ));
    mocks.create.mockResolvedValueOnce({
      id: 9,
      alt: "alt text",
      filename: "banner.png",
    });
    await upload_media.execute!(
      {
        url: "https://cdn.example.com/pics/banner.png",
        alt: "alt text",
      },
      toolOpts,
    );
    const call = mocks.create.mock.calls[0][0];
    expect(call.collection).toBe("media");
    expect(call.data).toMatchObject({ alt: "alt text" });
    expect(call.file).toBeDefined();
    expect((call.file as File).name).toBe("banner.png");
  });

  it("threads source/batch/discord metadata into the create payload", async () => {
    ({ restore: restoreFetch } = mockFetch(
      () => new Response(new Uint8Array([1]), { status: 200 }),
    ));
    mocks.create.mockResolvedValueOnce({ id: 9 });
    await upload_media.execute!(
      {
        url: "https://cdn.example.com/pic.jpg",
        alt: "a",
        source: "hack-night",
        batch_id: "b1",
        discord_message_id: "m1",
        discord_user_id: "u1",
      },
      toolOpts,
    );
    expect(mocks.create.mock.calls[0][0].data).toEqual({
      alt: "a",
      source: "hack-night",
      batchId: "b1",
      discordMessageId: "m1",
      discordUserId: "u1",
    });
  });

  it("throws when the source URL returns non-OK", async () => {
    ({ restore: restoreFetch } = mockFetch(() => new Response("nope", { status: 404 })));
    await expect(
      upload_media.execute!({ url: "https://cdn/none.jpg", alt: "a" }, toolOpts),
    ).rejects.toThrow(/Failed to fetch/);
  });
});

describe("delete_media", () => {
  it("is approval-gated", () => {
    expect(hasApprovalMarker(delete_media)).toBe(true);
  });
});
