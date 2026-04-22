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
  list_shelter_projects,
  get_shelter_project,
  create_shelter_project,
  update_shelter_project,
  delete_shelter_project,
  publish_shelter_project,
  unpublish_shelter_project,
} = await import("./shelter_projects.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_shelter_projects", () => {
  it("passes visible_only filter through", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    await list_shelter_projects.execute!({ visible_only: true }, toolOpts);
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "shelter-projects",
      limit: 25,
      page: 1,
      where: { visible: { equals: true } },
    });
  });

  it("flattens expanded image media to image_id + url", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 1,
      totalPages: 1,
      page: 1,
      docs: [{ id: 1, name: "X", image: { id: 7, url: "https://cdn/a.png" } }],
    });
    const raw = await list_shelter_projects.execute!({}, toolOpts);
    expect(JSON.parse(raw as string).docs[0]).toMatchObject({
      id: 1,
      image_id: 7,
      image_url: "https://cdn/a.png",
    });
  });
});

describe("get_shelter_project", () => {
  it("returns projected doc with href", async () => {
    mocks.findByID.mockResolvedValueOnce({ id: 2, name: "A" });
    const raw = await get_shelter_project.execute!({ id: 2 }, toolOpts);
    expect(JSON.parse(raw as string).href).toBe(
      "https://cms.purduehackers.com/admin/collections/shelter-projects/2",
    );
  });
});

describe("create_shelter_project", () => {
  it("maps image_id → image and defaults visible false", async () => {
    mocks.create.mockResolvedValueOnce({ id: 3 });
    await create_shelter_project.execute!(
      {
        name: "N",
        last_division: "D",
        last_owner: "O",
        description: "desc",
        image_id: 4,
      },
      toolOpts,
    );
    expect(mocks.create).toHaveBeenCalledWith({
      collection: "shelter-projects",
      data: {
        name: "N",
        last_division: "D",
        last_owner: "O",
        description: "desc",
        image: 4,
        visible: false,
      },
    });
  });
});

describe("update_shelter_project", () => {
  it("renames image_id → image in the patch", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await update_shelter_project.execute!({ id: 1, image_id: 9 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "shelter-projects",
      id: 1,
      data: { image: 9 },
    });
  });
});

describe("delete_shelter_project", () => {
  it("is approval-gated", () => {
    expect(hasApprovalMarker(delete_shelter_project)).toBe(true);
  });
});

describe("publish/unpublish", () => {
  it("publish sets visible true", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await publish_shelter_project.execute!({ id: 1 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "shelter-projects",
      id: 1,
      data: { visible: true },
    });
  });

  it("unpublish sets visible false", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await unpublish_shelter_project.execute!({ id: 1 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "shelter-projects",
      id: 1,
      data: { visible: false },
    });
  });
});
