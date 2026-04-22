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
  list_ugrants,
  get_ugrant,
  create_ugrant,
  update_ugrant,
  delete_ugrant,
  publish_ugrant,
  unpublish_ugrant,
} = await import("./ugrants.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_ugrants", () => {
  it("applies visible_only and maps fields to snake_case", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 1,
      totalPages: 1,
      page: 1,
      docs: [
        {
          id: 1,
          name: "N",
          author: "A",
          authorUrl: "https://a",
          projectUrl: "https://p",
        },
      ],
    });
    await list_ugrants.execute!({ visible_only: true }, toolOpts);
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "ugrants",
      limit: 25,
      page: 1,
      where: { visible: { equals: true } },
    });
  });

  it("projects author_url + project_url fields", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 1,
      totalPages: 1,
      page: 1,
      docs: [{ id: 1, name: "N", authorUrl: "https://a", projectUrl: "https://p" }],
    });
    const raw = await list_ugrants.execute!({}, toolOpts);
    expect(JSON.parse(raw as string).docs[0]).toMatchObject({
      author_url: "https://a",
      project_url: "https://p",
    });
  });
});

describe("get_ugrant", () => {
  it("returns projected doc", async () => {
    mocks.findByID.mockResolvedValueOnce({ id: 2, name: "N" });
    const raw = await get_ugrant.execute!({ id: 2 }, toolOpts);
    expect(JSON.parse(raw as string)).toMatchObject({
      id: 2,
      name: "N",
      href: "https://cms.purduehackers.com/admin/collections/ugrants/2",
    });
  });
});

describe("create_ugrant", () => {
  it("maps snake_case inputs to Payload's camelCase fields and defaults visible false", async () => {
    mocks.create.mockResolvedValueOnce({ id: 3 });
    await create_ugrant.execute!(
      {
        name: "N",
        author: "A",
        description: "D",
        image_id: 4,
        author_url: "https://a",
        project_url: "https://p",
      },
      toolOpts,
    );
    expect(mocks.create).toHaveBeenCalledWith({
      collection: "ugrants",
      data: {
        name: "N",
        author: "A",
        description: "D",
        image: 4,
        authorUrl: "https://a",
        projectUrl: "https://p",
        visible: false,
      },
    });
  });

  it("omits optional urls when not provided", async () => {
    mocks.create.mockResolvedValueOnce({ id: 3 });
    await create_ugrant.execute!(
      { name: "N", author: "A", description: "D", image_id: 4 },
      toolOpts,
    );
    const data = mocks.create.mock.calls[0][0].data;
    expect(data.authorUrl).toBeUndefined();
    expect(data.projectUrl).toBeUndefined();
  });
});

describe("update_ugrant", () => {
  it("only patches provided fields, camelCasing urls", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await update_ugrant.execute!({ id: 1, author_url: "https://new" }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "ugrants",
      id: 1,
      data: { authorUrl: "https://new" },
    });
  });
});

describe("delete_ugrant", () => {
  it("is approval-gated", () => {
    expect(hasApprovalMarker(delete_ugrant)).toBe(true);
  });
});

describe("publish/unpublish", () => {
  it("publish sets visible true", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await publish_ugrant.execute!({ id: 1 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "ugrants",
      id: 1,
      data: { visible: true },
    });
  });

  it("unpublish sets visible false", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await unpublish_ugrant.execute!({ id: 1 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "ugrants",
      id: 1,
      data: { visible: false },
    });
  });
});
