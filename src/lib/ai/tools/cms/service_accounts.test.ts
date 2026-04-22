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

const {
  list_service_accounts,
  get_service_account,
  create_service_account,
  update_service_account,
  delete_service_account,
} = await import("./service_accounts.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("organizer visibility", () => {
  it("read/create/update tools remain visible after filterAdmin (organizer role)", () => {
    const tools = {
      list_service_accounts,
      get_service_account,
      create_service_account,
      update_service_account,
    };
    expect(Object.keys(filterAdmin(tools)).sort()).toEqual([
      "create_service_account",
      "get_service_account",
      "list_service_accounts",
      "update_service_account",
    ]);
  });
});

describe("list_service_accounts", () => {
  it("applies revoked_only filter", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    await list_service_accounts.execute!({ revoked_only: true }, toolOpts);
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "service-accounts",
      limit: 25,
      page: 1,
      where: { revoked: { equals: true } },
    });
  });

  it("projects name + revoked + roles", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 1,
      totalPages: 1,
      page: 1,
      docs: [{ id: 1, name: "wack", revoked: false, roles: ["wack_hacker"] }],
    });
    const raw = await list_service_accounts.execute!({}, toolOpts);
    expect(JSON.parse(raw as string).docs[0]).toMatchObject({
      id: 1,
      name: "wack",
      revoked: false,
      roles: ["wack_hacker"],
    });
  });
});

describe("get_service_account", () => {
  it("returns a single projected record", async () => {
    mocks.findByID.mockResolvedValueOnce({ id: 2, name: "a" });
    const raw = await get_service_account.execute!({ id: 2 }, toolOpts);
    expect(JSON.parse(raw as string)).toMatchObject({
      id: 2,
      href: "https://cms.purduehackers.com/admin/collections/service-accounts/2",
    });
  });
});

describe("create_service_account", () => {
  it("defaults revoked false when not provided", async () => {
    mocks.create.mockResolvedValueOnce({ id: 3 });
    await create_service_account.execute!({ name: "bot", roles: ["wack_hacker"] }, toolOpts);
    expect(mocks.create).toHaveBeenCalledWith({
      collection: "service-accounts",
      data: { name: "bot", roles: ["wack_hacker"], revoked: false },
    });
  });
});

describe("update_service_account", () => {
  it("only patches provided fields", async () => {
    mocks.update.mockResolvedValueOnce({ id: 1 });
    await update_service_account.execute!({ id: 1, revoked: true }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "service-accounts",
      id: 1,
      data: { revoked: true },
    });
  });
});

describe("delete_service_account", () => {
  it("is approval-gated", () => {
    expect(hasApprovalMarker(delete_service_account)).toBe(true);
  });

  it("remains visible to organizer (no admin marker)", () => {
    expect(filterAdmin({ delete_service_account })).toEqual({ delete_service_account });
  });
});
