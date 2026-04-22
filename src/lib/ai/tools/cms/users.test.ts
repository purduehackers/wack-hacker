import { beforeEach, describe, expect, it, vi } from "vitest";

import { payloadSDKClass, toolOpts } from "@/lib/test/fixtures";

import { hasApprovalMarker } from "../../approvals/index.ts";
import { filterAdmin } from "../../skills/index.ts";

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

const { list_users, get_user, create_user, update_user, delete_user } = await import("./users.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin gating", () => {
  it("filterAdmin drops every exported user tool", () => {
    const tools = { list_users, get_user, create_user, update_user, delete_user };
    expect(Object.keys(filterAdmin(tools))).toEqual([]);
  });
});

describe("list_users", () => {
  it("filters by email when provided", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    await list_users.execute!({ email: "ray@purdue.edu" }, toolOpts);
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "users",
      limit: 25,
      page: 1,
      where: { email: { equals: "ray@purdue.edu" } },
    });
  });

  it("projects roles field", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 1,
      totalPages: 1,
      page: 1,
      docs: [{ id: 1, email: "a@b.com", roles: ["admin", "editor"] }],
    });
    const raw = await list_users.execute!({}, toolOpts);
    expect(JSON.parse(raw as string).docs[0].roles).toEqual(["admin", "editor"]);
  });
});

describe("get_user", () => {
  it("returns a projected user with href", async () => {
    mocks.findByID.mockResolvedValueOnce({ id: 3, email: "a@b" });
    const raw = await get_user.execute!({ id: 3 }, toolOpts);
    expect(JSON.parse(raw as string)).toMatchObject({
      id: 3,
      href: "https://cms.purduehackers.com/admin/collections/users/3",
    });
  });
});

describe("create_user", () => {
  it("posts email, password, roles", async () => {
    mocks.create.mockResolvedValueOnce({ id: 4, email: "new@ph.com", roles: ["viewer"] });
    await create_user.execute!(
      { email: "new@ph.com", password: "password1", roles: ["viewer"] },
      toolOpts,
    );
    expect(mocks.create).toHaveBeenCalledWith({
      collection: "users",
      data: { email: "new@ph.com", password: "password1", roles: ["viewer"] },
    });
  });
});

describe("update_user", () => {
  it("only patches provided fields", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1, roles: ["admin"] });
    await update_user.execute!({ id: 1, roles: ["admin"] }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "users",
      id: 1,
      data: { roles: ["admin"] },
    });
  });
});

describe("delete_user", () => {
  it("is approval-gated and admin-marked", () => {
    expect(hasApprovalMarker(delete_user)).toBe(true);
    expect(filterAdmin({ delete_user })).toEqual({});
  });
});
