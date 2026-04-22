import { beforeEach, describe, expect, it, vi } from "vitest";

import { notionClientClass } from "@/lib/test/fixtures";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  pagesUpdate: vi.fn(),
}));

vi.mock("@notionhq/client", () => ({
  Client: notionClientClass({
    dataSourcesQuery: mocks.query,
    pagesUpdate: mocks.pagesUpdate,
  }),
}));

const { applyResendEvent } = await import("./resend-webhook.ts");
const { COMPANIES_DATA_SOURCE_ID, CONTACTS_DATA_SOURCE_ID } =
  await import("@/lib/ai/tools/sales/constants");

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
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each([null, undefined, "not-an-object", 42])("ignores non-object input %p", async (input) => {
    await applyResendEvent(input);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("ignores unsupported event types", async () => {
    await applyResendEvent(event("email.scheduled"));
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("no-ops when no row matches the email_id in either data source", async () => {
    mocks.query.mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: [] });
    await applyResendEvent(event("email.opened"));
    expect(mocks.pagesUpdate).not.toHaveBeenCalled();
  });
});

describe("applyResendEvent: routing", () => {
  it("applies a delivered event to the matched Company row", async () => {
    mocks.query.mockResolvedValueOnce({ results: [pageWithStatus("Sent")] });
    await applyResendEvent(event("email.delivered"));

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledWith({
      data_source_id: COMPANIES_DATA_SOURCE_ID,
      filter: { property: "Last Outreach ID", rich_text: { equals: "re_123" } },
      page_size: 1,
    });
    expect(mocks.pagesUpdate).toHaveBeenCalledWith({
      page_id: "page-1",
      properties: {
        "Outreach Last Event At": { date: { start: "2026-04-19T01:00:00Z" } },
        "Outreach Status": { select: { name: "Delivered" } },
      },
    });
  });

  it("falls through to Contacts when no Company matches", async () => {
    mocks.query
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({ results: [pageWithStatus("Sent")] });

    await applyResendEvent(event("email.opened"));

    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data_source_id: COMPANIES_DATA_SOURCE_ID }),
    );
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data_source_id: CONTACTS_DATA_SOURCE_ID }),
    );
    expect(mocks.pagesUpdate).toHaveBeenCalledWith({
      page_id: "page-1",
      properties: expect.objectContaining({
        "Outreach Status": { select: { name: "Opened" } },
      }),
    });
  });
});

describe("applyResendEvent: missing / unknown prior status", () => {
  it("treats a page with no Outreach Status as Sent (rank 1)", async () => {
    mocks.query.mockResolvedValueOnce({ results: [pageWithStatus(null)] });
    await applyResendEvent(event("email.delivered"));

    const props = mocks.pagesUpdate.mock.calls[0]![0].properties;
    expect(props["Outreach Status"]).toEqual({ select: { name: "Delivered" } });
  });

  it("treats an unknown select option as Sent (rank 1)", async () => {
    mocks.query.mockResolvedValueOnce({ results: [pageWithStatus("Scheduled")] });
    await applyResendEvent(event("email.opened"));

    const props = mocks.pagesUpdate.mock.calls[0]![0].properties;
    expect(props["Outreach Status"]).toEqual({ select: { name: "Opened" } });
  });
});

describe("applyResendEvent: monotonic status", () => {
  it("does not regress status once it reaches Clicked", async () => {
    mocks.query.mockResolvedValueOnce({ results: [pageWithStatus("Clicked")] });
    await applyResendEvent(event("email.delivered"));

    const props = mocks.pagesUpdate.mock.calls[0]![0].properties;
    expect(props["Outreach Status"]).toBeUndefined();
    expect(props["Outreach Last Event At"]).toEqual({
      date: { start: "2026-04-19T01:00:00Z" },
    });
  });

  it("advances status when monotonic", async () => {
    mocks.query.mockResolvedValueOnce({ results: [pageWithStatus("Opened")] });
    await applyResendEvent(event("email.clicked"));
    const props = mocks.pagesUpdate.mock.calls[0]![0].properties;
    expect(props["Outreach Status"]).toEqual({ select: { name: "Clicked" } });
  });
});

describe("applyResendEvent: monotonic timestamp", () => {
  it("does not overwrite a newer Outreach Last Event At", async () => {
    mocks.query.mockResolvedValueOnce({
      results: [pageWithStatus("Opened", "2026-04-19T05:00:00Z")],
    });
    await applyResendEvent(event("email.clicked"));

    const props = mocks.pagesUpdate.mock.calls[0]![0].properties;
    expect(props["Outreach Last Event At"]).toBeUndefined();
    expect(props["Outreach Status"]).toEqual({ select: { name: "Clicked" } });
  });

  it("writes the timestamp when incoming is strictly newer", async () => {
    mocks.query.mockResolvedValueOnce({
      results: [pageWithStatus("Sent", "2026-04-18T00:00:00Z")],
    });
    await applyResendEvent(event("email.delivered"));

    const props = mocks.pagesUpdate.mock.calls[0]![0].properties;
    expect(props["Outreach Last Event At"]).toEqual({
      date: { start: "2026-04-19T01:00:00Z" },
    });
  });

  it("skips the update entirely when nothing changes", async () => {
    mocks.query.mockResolvedValueOnce({
      results: [pageWithStatus("Clicked", "2026-04-19T05:00:00Z")],
    });
    await applyResendEvent(event("email.delivered"));
    expect(mocks.pagesUpdate).not.toHaveBeenCalled();
  });
});

describe("applyResendEvent: bounce handling", () => {
  it("flips Do Not Contact on bounce", async () => {
    mocks.query.mockResolvedValueOnce({ results: [pageWithStatus("Delivered")] });
    await applyResendEvent(event("email.bounced"));

    expect(mocks.pagesUpdate).toHaveBeenCalledWith({
      page_id: "page-1",
      properties: expect.objectContaining({
        "Outreach Status": { select: { name: "Bounced" } },
        "Do Not Contact": { checkbox: true },
      }),
    });
  });

  it("flips Do Not Contact on complaint", async () => {
    mocks.query.mockResolvedValueOnce({ results: [pageWithStatus("Delivered")] });
    await applyResendEvent(event("email.complained"));

    expect(mocks.pagesUpdate).toHaveBeenCalledWith({
      page_id: "page-1",
      properties: expect.objectContaining({
        "Outreach Status": { select: { name: "Bounced" } },
        "Do Not Contact": { checkbox: true },
      }),
    });
  });
});
