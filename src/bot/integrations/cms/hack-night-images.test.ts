import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockFetch, payloadSDKClass } from "@/lib/test/fixtures";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
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

const {
  uploadHackNightImage,
  hasHackNightImageForMessage,
  listHackNightImages,
  deleteHackNightImagesForMessage,
} = await import("./hack-night-images.ts");

const SLUG = "hack-night-2026-04-24";

function uploadInput(overrides: Partial<Parameters<typeof uploadHackNightImage>[0]> = {}) {
  return {
    url: "https://cdn.discordapp.com/attachments/1/2/pic.png",
    slug: SLUG,
    discordMessageId: "m1",
    discordUserId: "u1",
    filename: "pic.png",
    contentType: "image/png",
    ...overrides,
  };
}

let restoreFetch: () => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  restoreFetch();
});

describe("uploadHackNightImage happy path", () => {
  it("fetches the URL and creates a media record with hack-night metadata", async () => {
    ({ restore: restoreFetch } = mockFetch(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    ));
    mocks.create.mockResolvedValueOnce({
      id: 42,
      filename: "pic.png",
      url: "https://cdn.purduehackers.com/media/pic.png",
      discordMessageId: "m1",
      discordUserId: "u1",
      createdAt: "2026-04-24T20:00:00Z",
    });

    const result = await uploadHackNightImage(uploadInput());

    const call = mocks.create.mock.calls[0][0];
    expect(call.collection).toBe("media");
    expect(call.data).toEqual({
      alt: "Hack Night 2026-04-24 photo — pic.png",
      source: "hack-night",
      batchId: SLUG,
      discordMessageId: "m1",
      discordUserId: "u1",
    });
    expect((call.file as File).name).toBe("pic.png");
    expect(result).toEqual({
      id: 42,
      filename: "pic.png",
      url: "https://cdn.purduehackers.com/media/pic.png",
      discordMessageId: "m1",
      discordUserId: "u1",
      uploadedAt: "2026-04-24T20:00:00Z",
    });
  });

  it("falls back to provided contentType when the blob has no type", async () => {
    ({ restore: restoreFetch } = mockFetch(
      () => new Response(new Uint8Array([1]), { status: 200 }),
    ));
    mocks.create.mockResolvedValueOnce({ id: 1 });
    await uploadHackNightImage(uploadInput({ filename: "pic.jpg", contentType: "image/jpeg" }));
    const file = mocks.create.mock.calls[0][0].file as File;
    expect(file.type).toBe("image/jpeg");
  });

  it("passes a timeout signal into fetch", async () => {
    const { fetch: fetchMock, restore } = mockFetch(
      () => new Response(new Uint8Array([1]), { status: 200 }),
    );
    restoreFetch = restore;
    mocks.create.mockResolvedValueOnce({ id: 1 });
    await uploadHackNightImage(uploadInput());
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("uploadHackNightImage error paths", () => {
  it("throws when the source URL returns non-OK", async () => {
    ({ restore: restoreFetch } = mockFetch(() => new Response("nope", { status: 404 })));
    await expect(uploadHackNightImage(uploadInput())).rejects.toThrow(/Failed to fetch/);
  });

  it("translates AbortSignal timeouts into a human-readable error", async () => {
    ({ restore: restoreFetch } = mockFetch(() => {
      throw new DOMException("timeout", "TimeoutError");
    }));
    await expect(uploadHackNightImage(uploadInput())).rejects.toThrow(/Timed out fetching/);
  });
});

describe("hasHackNightImageForMessage", () => {
  it("queries by source + batchId + discordMessageId with limit 1", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 1, totalPages: 1, page: 1, docs: [] });
    const out = await hasHackNightImageForMessage(SLUG, "m1");
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "media",
      limit: 1,
      where: {
        source: { equals: "hack-night" },
        batchId: { equals: SLUG },
        discordMessageId: { equals: "m1" },
      },
    });
    expect(out).toBe(true);
  });

  it("returns false when no records match", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    expect(await hasHackNightImageForMessage(SLUG, "m1")).toBe(false);
  });
});

describe("listHackNightImages error wrapping", () => {
  it("normalizes non-Error SDK rejections through wrapPayloadError", async () => {
    mocks.find.mockRejectedValueOnce("network down");
    await expect(listHackNightImages(SLUG)).rejects.toThrow(/network down/);
  });
});

describe("deleteHackNightImagesForMessage error wrapping", () => {
  it("normalizes non-Error SDK rejections on find through wrapPayloadError", async () => {
    mocks.find.mockRejectedValueOnce("network down");
    await expect(deleteHackNightImagesForMessage(SLUG, "m1")).rejects.toBeInstanceOf(Error);
  });
});

describe("listHackNightImages", () => {
  it("accumulates results across multiple pages", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 150,
      totalPages: 2,
      page: 1,
      docs: [{ id: 1, filename: "a.png", discordUserId: "u1" }],
    });
    mocks.find.mockResolvedValueOnce({
      totalDocs: 150,
      totalPages: 2,
      page: 2,
      docs: [{ id: 2, filename: "b.png", discordUserId: "u2" }],
    });

    const out = await listHackNightImages(SLUG);
    expect(out.map((i) => i.id)).toEqual([1, 2]);
    expect(mocks.find).toHaveBeenCalledTimes(2);
    expect(mocks.find.mock.calls[0][0]).toMatchObject({ page: 1, limit: 100 });
    expect(mocks.find.mock.calls[1][0]).toMatchObject({ page: 2, limit: 100 });
  });

  it("stops at the page cap even if more pages exist", async () => {
    mocks.find.mockResolvedValue({
      totalDocs: 9999,
      totalPages: 99,
      page: 1,
      docs: [{ id: 1, filename: "x.png", discordUserId: "u1" }],
    });
    const out = await listHackNightImages(SLUG);
    expect(mocks.find).toHaveBeenCalledTimes(20);
    expect(out).toHaveLength(20);
  });

  it("filters by source + batchId and sorts by createdAt", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    await listHackNightImages(SLUG);
    expect(mocks.find.mock.calls[0][0]).toMatchObject({
      sort: "createdAt",
      where: {
        source: { equals: "hack-night" },
        batchId: { equals: SLUG },
      },
    });
  });
});

describe("deleteHackNightImagesForMessage", () => {
  it("deletes each matching record and returns the count", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 2,
      totalPages: 1,
      page: 1,
      docs: [{ id: 1 }, { id: 2 }],
    });
    mocks.delete.mockResolvedValue({});

    const removed = await deleteHackNightImagesForMessage(SLUG, "m1");
    expect(removed).toBe(2);
    expect(mocks.delete).toHaveBeenCalledTimes(2);
    expect(mocks.delete.mock.calls[0][0]).toEqual({ collection: "media", id: 1 });
    expect(mocks.delete.mock.calls[1][0]).toEqual({ collection: "media", id: 2 });
  });

  it("returns 0 when nothing matches", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    expect(await deleteHackNightImagesForMessage(SLUG, "m1")).toBe(0);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("counts only successful deletes when one throws", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 2,
      totalPages: 1,
      page: 1,
      docs: [{ id: 1 }, { id: 2 }],
    });
    mocks.delete.mockResolvedValueOnce({});
    mocks.delete.mockRejectedValueOnce(new Error("boom"));
    expect(await deleteHackNightImagesForMessage(SLUG, "m1")).toBe(1);
  });
});
