import { beforeEach, describe, expect, it, vi } from "vitest";

import { notionClientClass, toolOpts } from "@/lib/test/fixtures";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  pagesRetrieve: vi.fn(),
  pagesUpdate: vi.fn(),
}));

vi.mock("@notionhq/client", () => ({
  Client: notionClientClass({
    dataSourcesQuery: mocks.query,
    pagesRetrieve: mocks.pagesRetrieve,
    pagesUpdate: mocks.pagesUpdate,
  }),
}));

const {
  list_contacts,
  get_contact,
  update_contact_status,
  update_contact_email,
  set_contact_last_outreach,
} = await import("./contacts.ts");
const { CONTACTS_DATA_SOURCE_ID } = await import("./constants.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_contacts", () => {
  it("queries the Contacts data source", async () => {
    mocks.query.mockResolvedValueOnce({
      results: [{ id: "c-1", properties: { Name: {} } }],
      has_more: false,
      next_cursor: null,
    });
    const raw = await list_contacts.execute!({ page_size: 5 }, toolOpts);
    expect(JSON.parse(raw as string).results[0].id).toBe("c-1");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: CONTACTS_DATA_SOURCE_ID, page_size: 5 }),
    );
  });
});

describe("get_contact", () => {
  it("retrieves a contact page", async () => {
    mocks.pagesRetrieve.mockResolvedValueOnce({ id: "c-2", properties: {} });
    const raw = await get_contact.execute!({ contact_id: "c-2" }, toolOpts);
    expect(JSON.parse(raw as string).id).toBe("c-2");
    expect(mocks.pagesRetrieve).toHaveBeenCalledWith({ page_id: "c-2" });
  });
});

describe("update_contact_status", () => {
  it("writes the Status select", async () => {
    mocks.pagesUpdate.mockResolvedValueOnce({ id: "c-3" });
    await update_contact_status.execute!({ contact_id: "c-3", status: "Active" }, toolOpts);
    expect(mocks.pagesUpdate).toHaveBeenCalledWith({
      page_id: "c-3",
      properties: { Status: { select: { name: "Active" } } },
    });
  });
});

describe("update_contact_email", () => {
  it("writes the Email property", async () => {
    mocks.pagesUpdate.mockResolvedValueOnce({ id: "c-4" });
    await update_contact_email.execute!({ contact_id: "c-4", email: "bob@example.com" }, toolOpts);
    expect(mocks.pagesUpdate).toHaveBeenCalledWith({
      page_id: "c-4",
      properties: { Email: { email: "bob@example.com" } },
    });
  });
});

describe("set_contact_last_outreach", () => {
  it("writes outreach tracking props with Sent status", async () => {
    mocks.pagesUpdate.mockResolvedValueOnce({ id: "c-5" });
    await set_contact_last_outreach.execute!(
      { contact_id: "c-5", email_id: "re_999", sent_at: "2026-04-19T00:00:00Z" },
      toolOpts,
    );
    expect(mocks.pagesUpdate).toHaveBeenCalledWith({
      page_id: "c-5",
      properties: {
        "Last Outreach ID": { rich_text: [{ text: { content: "re_999" } }] },
        "Outreach Status": { select: { name: "Sent" } },
        "Outreach Last Event At": { date: { start: "2026-04-19T00:00:00Z" } },
      },
    });
  });
});
