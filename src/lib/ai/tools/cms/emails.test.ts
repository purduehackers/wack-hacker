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

const { list_emails, get_email, create_email, update_email, delete_email, send_email } =
  await import("./emails.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_emails", () => {
  it("filters by event_id when provided", async () => {
    mocks.find.mockResolvedValueOnce({ totalDocs: 0, totalPages: 0, page: 1, docs: [] });
    await list_emails.execute!({ event_id: 1 }, toolOpts);
    expect(mocks.find).toHaveBeenCalledWith({
      collection: "emails",
      limit: 25,
      page: 1,
      where: { event: { equals: 1 } },
    });
  });

  it("flattens expanded event ref to event_id", async () => {
    mocks.find.mockResolvedValueOnce({
      totalDocs: 1,
      totalPages: 1,
      page: 1,
      docs: [{ id: 10, event: { id: 5 }, subject: "hi" }],
    });
    const raw = await list_emails.execute!({}, toolOpts);
    expect(JSON.parse(raw as string).docs[0].event_id).toBe(5);
  });
});

describe("get_email", () => {
  it("returns projected email", async () => {
    mocks.findByID.mockResolvedValueOnce({ id: 2, subject: "s", body: "b", event: 7 });
    const raw = await get_email.execute!({ id: 2 }, toolOpts);
    expect(JSON.parse(raw as string)).toMatchObject({ id: 2, event_id: 7 });
  });
});

describe("create_email", () => {
  it("creates with send: false and maps event_id", async () => {
    mocks.create.mockResolvedValueOnce({ id: 11, event: 3 });
    await create_email.execute!({ event_id: 3, subject: "s", body: "b" }, toolOpts);
    expect(mocks.create).toHaveBeenCalledWith({
      collection: "emails",
      data: { event: 3, subject: "s", body: "b", send: false },
    });
  });
});

describe("update_email", () => {
  it("only patches provided fields", async () => {
    mocks.update.mockResolvedValueOnce({ id: 4 });
    await update_email.execute!({ id: 4, subject: "new" }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "emails",
      id: 4,
      data: { subject: "new" },
    });
  });
});

describe("delete_email", () => {
  it("is approval-gated", () => {
    expect(hasApprovalMarker(delete_email)).toBe(true);
  });
});

describe("send_email", () => {
  it("is approval-gated", () => {
    expect(hasApprovalMarker(send_email)).toBe(true);
  });

  it("flips send: true", async () => {
    mocks.update.mockResolvedValueOnce({ id: 8, send: false });
    const raw = await send_email.execute!({ id: 8 }, toolOpts);
    expect(mocks.update).toHaveBeenCalledWith({
      collection: "emails",
      id: 8,
      data: { send: true },
    });
    expect(JSON.parse(raw as string)).toMatchObject({ triggered: true, id: 8 });
  });
});
