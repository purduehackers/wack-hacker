import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const queryMock = vi.fn();
const retrieveMock = vi.fn();
const updateMock = vi.fn();

vi.mock("./client.ts", () => ({
  notion: {
    dataSources: { query: queryMock },
    pages: { retrieve: retrieveMock, update: updateMock },
  },
}));
vi.mock("./constants.ts", () => ({
  CONTACTS_DATA_SOURCE_ID: "contacts-ds",
}));

const {
  list_contacts,
  get_contact,
  update_contact_status,
  update_contact_email,
  set_contact_last_outreach,
} = await import("./contacts.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_contacts", () => {
  it("queries the Contacts data source", async () => {
    queryMock.mockResolvedValueOnce({
      results: [{ id: "c-1", properties: { Name: {} } }],
      has_more: false,
      next_cursor: null,
    });
    const raw = await list_contacts.execute!({ page_size: 5 }, toolOpts);
    expect(JSON.parse(raw as string).results[0].id).toBe("c-1");
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: "contacts-ds", page_size: 5 }),
    );
  });
});

describe("get_contact", () => {
  it("retrieves a contact page", async () => {
    retrieveMock.mockResolvedValueOnce({ id: "c-2", properties: {} });
    const raw = await get_contact.execute!({ contact_id: "c-2" }, toolOpts);
    expect(JSON.parse(raw as string).id).toBe("c-2");
    expect(retrieveMock).toHaveBeenCalledWith({ page_id: "c-2" });
  });
});

describe("update_contact_status", () => {
  it("writes the Status select", async () => {
    updateMock.mockResolvedValueOnce({ id: "c-3" });
    await update_contact_status.execute!({ contact_id: "c-3", status: "Active" }, toolOpts);
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "c-3",
      properties: { Status: { select: { name: "Active" } } },
    });
  });
});

describe("update_contact_email", () => {
  it("writes the Email property", async () => {
    updateMock.mockResolvedValueOnce({ id: "c-4" });
    await update_contact_email.execute!({ contact_id: "c-4", email: "bob@example.com" }, toolOpts);
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "c-4",
      properties: { Email: { email: "bob@example.com" } },
    });
  });
});

describe("set_contact_last_outreach", () => {
  it("writes outreach tracking props with Sent status", async () => {
    updateMock.mockResolvedValueOnce({ id: "c-5" });
    await set_contact_last_outreach.execute!(
      { contact_id: "c-5", email_id: "re_999", sent_at: "2026-04-19T00:00:00Z" },
      toolOpts,
    );
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "c-5",
      properties: {
        "Last Outreach ID": { rich_text: [{ text: { content: "re_999" } }] },
        "Outreach Status": { select: { name: "Sent" } },
        "Outreach Last Event At": { date: { start: "2026-04-19T00:00:00Z" } },
      },
    });
  });
});
