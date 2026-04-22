import { beforeEach, describe, expect, it, vi } from "vitest";

import { notionClientClass, resendClass, toolOpts } from "@/lib/test/fixtures";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  pagesRetrieve: vi.fn(),
  pagesUpdate: vi.fn(),
}));

vi.mock("@notionhq/client", () => ({
  Client: notionClientClass({
    pagesRetrieve: mocks.pagesRetrieve,
    pagesUpdate: mocks.pagesUpdate,
  }),
}));

vi.mock("resend", () => ({
  Resend: resendClass({ send: mocks.send }),
}));

const { send_outreach_email, get_email_status } = await import("./outreach.ts");
const {
  COMPANIES_DATA_SOURCE_ID,
  CONTACTS_DATA_SOURCE_ID,
  SALES_FROM_EMAIL,
  SALES_REPLY_TO_EMAIL,
} = await import("./constants.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("send_outreach_email: preflight", () => {
  it("blocks when Do Not Contact is checked", async () => {
    mocks.pagesRetrieve.mockResolvedValueOnce({
      id: "p-1",
      parent: { data_source_id: COMPANIES_DATA_SOURCE_ID },
      properties: { "Do Not Contact": { type: "checkbox", checkbox: true } },
    });
    const raw = await send_outreach_email.execute!(
      {
        target: "company",
        page_id: "p-1",
        to: "alice@acme.com",
        subject: "hi",
        text: "hey",
      },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/Do Not Contact/i);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("blocks when the page belongs to a different data source than target", async () => {
    mocks.pagesRetrieve.mockResolvedValueOnce({
      id: "p-wrong",
      parent: { data_source_id: CONTACTS_DATA_SOURCE_ID },
      properties: { "Do Not Contact": { type: "checkbox", checkbox: false } },
    });
    const raw = await send_outreach_email.execute!(
      {
        target: "company",
        page_id: "p-wrong",
        to: "alice@acme.com",
        subject: "hi",
        text: "hey",
      },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/parent data source does not match/i);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("send_outreach_email: send path", () => {
  it("sends via Resend and writes Last Outreach ID", async () => {
    mocks.pagesRetrieve.mockResolvedValueOnce({
      id: "p-2",
      parent: { data_source_id: CONTACTS_DATA_SOURCE_ID },
      properties: { "Do Not Contact": { type: "checkbox", checkbox: false } },
    });
    mocks.send.mockResolvedValueOnce({ data: { id: "re_abc" }, error: null });
    mocks.pagesUpdate.mockResolvedValueOnce({ id: "p-2" });

    const raw = await send_outreach_email.execute!(
      {
        target: "contact",
        page_id: "p-2",
        to: "bob@acme.com",
        subject: "Hello",
        text: "Body",
      },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.id).toBe("re_abc");
    expect(parsed.target).toBe("contact");
    expect(mocks.send).toHaveBeenCalledWith({
      from: SALES_FROM_EMAIL,
      to: "bob@acme.com",
      subject: "Hello",
      text: "Body",
      html: undefined,
      replyTo: SALES_REPLY_TO_EMAIL,
    });
    expect(mocks.pagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: "p-2",
        properties: expect.objectContaining({
          "Last Outreach ID": { rich_text: [{ text: { content: "re_abc" } }] },
          "Outreach Status": { select: { name: "Sent" } },
        }),
      }),
    );
  });

  it("surfaces Resend errors without writing Notion", async () => {
    mocks.pagesRetrieve.mockResolvedValueOnce({
      id: "p-3",
      parent: { data_source_id: COMPANIES_DATA_SOURCE_ID },
      properties: { "Do Not Contact": { type: "checkbox", checkbox: false } },
    });
    mocks.send.mockResolvedValueOnce({
      data: null,
      error: { message: "domain not verified", name: "validation_error" },
    });
    const raw = await send_outreach_email.execute!(
      {
        target: "company",
        page_id: "p-3",
        to: "alice@acme.com",
        subject: "hi",
        text: "hey",
      },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toBe("domain not verified");
    expect(mocks.pagesUpdate).not.toHaveBeenCalled();
  });
});

describe("get_email_status", () => {
  it("summarizes tracking properties from the page", async () => {
    mocks.pagesRetrieve.mockResolvedValueOnce({
      id: "p-4",
      properties: {
        "Last Outreach ID": {
          type: "rich_text",
          rich_text: [{ plain_text: "re_777" }],
        },
        "Outreach Status": { type: "select", select: { name: "Opened" } },
        "Outreach Last Event At": { type: "date", date: { start: "2026-04-19T01:00:00Z" } },
        "Do Not Contact": { type: "checkbox", checkbox: false },
      },
    });
    const raw = await get_email_status.execute!({ page_id: "p-4" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.last_outreach_id).toBe("re_777");
    expect(parsed.outreach_status).toBe("Opened");
    expect(parsed.outreach_last_event_at).toBe("2026-04-19T01:00:00Z");
    expect(parsed.do_not_contact).toBe(false);
  });

  it("returns nulls when tracking properties are absent", async () => {
    mocks.pagesRetrieve.mockResolvedValueOnce({ id: "p-5", properties: {} });
    const raw = await get_email_status.execute!({ page_id: "p-5" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.last_outreach_id).toBeNull();
    expect(parsed.outreach_status).toBeNull();
    expect(parsed.outreach_last_event_at).toBeNull();
    expect(parsed.do_not_contact).toBeNull();
  });
});
