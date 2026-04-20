import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/ai/tools/sales/client", () => ({
  notion: {
    dataSources: { query: queryMock },
    pages: { update: updateMock },
  },
}));
vi.mock("@/lib/ai/tools/sales/constants", () => ({
  COMPANIES_DATA_SOURCE_ID: "companies-ds",
  CONTACTS_DATA_SOURCE_ID: "contacts-ds",
}));

const { applyResendEvent } = await import("./resend-webhook.ts");

function event(type: string, extra?: Record<string, unknown>) {
  return {
    type,
    created_at: "2026-04-19T01:00:00Z",
    data: { email_id: "re_123", ...extra },
  };
}

function pageWithStatus(status: string | null, lastEventAt?: string) {
  const properties: Record<string, unknown> = {
    "Outreach Status": status ? { type: "select", select: { name: status } } : undefined,
  };
  if (lastEventAt) {
    properties["Outreach Last Event At"] = { type: "date", date: { start: lastEventAt } };
  }
  return { id: "page-1", properties };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyResendEvent: filtering", () => {
  it("ignores malformed events", async () => {
    await applyResendEvent({ foo: "bar" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("ignores unsupported event types", async () => {
    await applyResendEvent(event("email.scheduled"));
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("no-ops when no row matches the email_id in either data source", async () => {
    queryMock.mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: [] });
    await applyResendEvent(event("email.opened"));
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("applyResendEvent: routing", () => {
  it("applies a delivered event to the matched Company row", async () => {
    queryMock.mockResolvedValueOnce({ results: [pageWithStatus("Sent")] });
    await applyResendEvent(event("email.delivered"));

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith({
      data_source_id: "companies-ds",
      filter: { property: "Last Outreach ID", rich_text: { equals: "re_123" } },
      page_size: 1,
    });
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "page-1",
      properties: {
        "Outreach Last Event At": { date: { start: "2026-04-19T01:00:00Z" } },
        "Outreach Status": { select: { name: "Delivered" } },
      },
    });
  });

  it("falls through to Contacts when no Company matches", async () => {
    queryMock
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({ results: [pageWithStatus("Sent")] });

    await applyResendEvent(event("email.opened"));

    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data_source_id: "companies-ds" }),
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data_source_id: "contacts-ds" }),
    );
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "page-1",
      properties: expect.objectContaining({
        "Outreach Status": { select: { name: "Opened" } },
      }),
    });
  });
});

describe("applyResendEvent: monotonic status", () => {
  it("does not regress status once it reaches Clicked", async () => {
    queryMock.mockResolvedValueOnce({ results: [pageWithStatus("Clicked")] });
    await applyResendEvent(event("email.delivered"));

    const props = updateMock.mock.calls[0]![0].properties;
    expect(props["Outreach Status"]).toBeUndefined();
    expect(props["Outreach Last Event At"]).toEqual({
      date: { start: "2026-04-19T01:00:00Z" },
    });
  });

  it("advances status when monotonic", async () => {
    queryMock.mockResolvedValueOnce({ results: [pageWithStatus("Opened")] });
    await applyResendEvent(event("email.clicked"));
    const props = updateMock.mock.calls[0]![0].properties;
    expect(props["Outreach Status"]).toEqual({ select: { name: "Clicked" } });
  });
});

describe("applyResendEvent: monotonic timestamp", () => {
  it("does not overwrite a newer Outreach Last Event At", async () => {
    queryMock.mockResolvedValueOnce({
      results: [pageWithStatus("Opened", "2026-04-19T05:00:00Z")],
    });
    await applyResendEvent(event("email.clicked"));

    const props = updateMock.mock.calls[0]![0].properties;
    expect(props["Outreach Last Event At"]).toBeUndefined();
    expect(props["Outreach Status"]).toEqual({ select: { name: "Clicked" } });
  });

  it("writes the timestamp when incoming is strictly newer", async () => {
    queryMock.mockResolvedValueOnce({
      results: [pageWithStatus("Sent", "2026-04-18T00:00:00Z")],
    });
    await applyResendEvent(event("email.delivered"));

    const props = updateMock.mock.calls[0]![0].properties;
    expect(props["Outreach Last Event At"]).toEqual({
      date: { start: "2026-04-19T01:00:00Z" },
    });
  });

  it("skips the update entirely when nothing changes", async () => {
    queryMock.mockResolvedValueOnce({
      results: [pageWithStatus("Clicked", "2026-04-19T05:00:00Z")],
    });
    await applyResendEvent(event("email.delivered"));
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("applyResendEvent: bounce handling", () => {
  it("flips Do Not Contact on bounce", async () => {
    queryMock.mockResolvedValueOnce({ results: [pageWithStatus("Delivered")] });
    await applyResendEvent(event("email.bounced"));

    expect(updateMock).toHaveBeenCalledWith({
      page_id: "page-1",
      properties: expect.objectContaining({
        "Outreach Status": { select: { name: "Bounced" } },
        "Do Not Contact": { checkbox: true },
      }),
    });
  });

  it("flips Do Not Contact on complaint", async () => {
    queryMock.mockResolvedValueOnce({ results: [pageWithStatus("Delivered")] });
    await applyResendEvent(event("email.complained"));

    expect(updateMock).toHaveBeenCalledWith({
      page_id: "page-1",
      properties: expect.objectContaining({
        "Outreach Status": { select: { name: "Bounced" } },
        "Do Not Contact": { checkbox: true },
      }),
    });
  });
});
