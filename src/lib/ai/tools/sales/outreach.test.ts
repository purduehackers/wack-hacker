import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

vi.mock("../../../../env.ts", () => ({
  env: {
    SALES_FROM_EMAIL: "sales@ph.example",
    SALES_REPLY_TO_EMAIL: "reply@ph.example",
  },
}));

const sendMock = vi.fn();
const retrieveMock = vi.fn();
const updateMock = vi.fn();

vi.mock("./client.ts", () => ({
  notion: { pages: { retrieve: retrieveMock, update: updateMock } },
  resend: () => ({ emails: { send: sendMock } }),
  companiesDataSourceId: () => "companies-ds",
  contactsDataSourceId: () => "contacts-ds",
}));

const { send_outreach_email, get_email_status } = await import("./outreach.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("send_outreach_email: preflight", () => {
  it("blocks when Do Not Contact is checked", async () => {
    retrieveMock.mockResolvedValueOnce({
      id: "p-1",
      parent: { data_source_id: "companies-ds" },
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
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("blocks when the page belongs to a different data source than target", async () => {
    retrieveMock.mockResolvedValueOnce({
      id: "p-wrong",
      parent: { data_source_id: "contacts-ds" },
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
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("send_outreach_email: send path", () => {
  it("sends via Resend and writes Last Outreach ID", async () => {
    retrieveMock.mockResolvedValueOnce({
      id: "p-2",
      parent: { data_source_id: "contacts-ds" },
      properties: { "Do Not Contact": { type: "checkbox", checkbox: false } },
    });
    sendMock.mockResolvedValueOnce({ data: { id: "re_abc" }, error: null });
    updateMock.mockResolvedValueOnce({ id: "p-2" });

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
    expect(sendMock).toHaveBeenCalledWith({
      from: "sales@ph.example",
      to: "bob@acme.com",
      subject: "Hello",
      text: "Body",
      html: undefined,
      replyTo: "reply@ph.example",
    });
    expect(updateMock).toHaveBeenCalledWith(
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
    retrieveMock.mockResolvedValueOnce({
      id: "p-3",
      parent: { data_source_id: "companies-ds" },
      properties: { "Do Not Contact": { type: "checkbox", checkbox: false } },
    });
    sendMock.mockResolvedValueOnce({
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
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("get_email_status", () => {
  it("summarizes tracking properties from the page", async () => {
    retrieveMock.mockResolvedValueOnce({
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
    retrieveMock.mockResolvedValueOnce({ id: "p-5", properties: {} });
    const raw = await get_email_status.execute!({ page_id: "p-5" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.last_outreach_id).toBeNull();
    expect(parsed.outreach_status).toBeNull();
    expect(parsed.outreach_last_event_at).toBeNull();
    expect(parsed.do_not_contact).toBeNull();
  });
});
