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
  COMPANIES_DATA_SOURCE_ID: "companies-ds",
}));

const {
  list_companies,
  get_company,
  update_company_status,
  update_company_email,
  update_company_next_followup,
  set_company_last_outreach,
} = await import("./companies.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_companies", () => {
  it("queries the Companies data source and maps results", async () => {
    queryMock.mockResolvedValueOnce({
      results: [{ id: "page-1", url: "https://notion.so/page-1", properties: { Company: {} } }],
      has_more: false,
      next_cursor: null,
    });

    const raw = await list_companies.execute!(
      { filter: { property: "Status", select: { equals: "Not Contacted" } } },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.results[0].id).toBe("page-1");
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: "companies-ds", page_size: 25 }),
    );
  });
});

describe("get_company", () => {
  it("retrieves a company page and returns a summary", async () => {
    retrieveMock.mockResolvedValueOnce({
      id: "page-2",
      url: "https://notion.so/page-2",
      properties: { Company: {} },
    });
    const raw = await get_company.execute!({ company_id: "page-2" }, toolOpts);
    expect(JSON.parse(raw as string).id).toBe("page-2");
    expect(retrieveMock).toHaveBeenCalledWith({ page_id: "page-2" });
  });
});

describe("update_company_status", () => {
  it("updates the Status select property", async () => {
    updateMock.mockResolvedValueOnce({ id: "page-3" });
    const raw = await update_company_status.execute!(
      { company_id: "page-3", status: "Contacted" },
      toolOpts,
    );
    expect(JSON.parse(raw as string).status).toBe("Contacted");
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "page-3",
      properties: { Status: { select: { name: "Contacted" } } },
    });
  });
});

describe("update_company_email", () => {
  it("writes the Email property", async () => {
    updateMock.mockResolvedValueOnce({ id: "page-4" });
    await update_company_email.execute!(
      { company_id: "page-4", email: "alice@example.com" },
      toolOpts,
    );
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "page-4",
      properties: { Email: { email: "alice@example.com" } },
    });
  });
});

describe("update_company_next_followup", () => {
  it("sets the Next Follow-up date when provided", async () => {
    updateMock.mockResolvedValueOnce({ id: "page-5" });
    await update_company_next_followup.execute!(
      { company_id: "page-5", date: "2026-05-01" },
      toolOpts,
    );
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "page-5",
      properties: { "Next Follow-up": { date: { start: "2026-05-01" } } },
    });
  });

  it("clears the Next Follow-up date when null", async () => {
    updateMock.mockResolvedValueOnce({ id: "page-5" });
    await update_company_next_followup.execute!({ company_id: "page-5", date: null }, toolOpts);
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "page-5",
      properties: { "Next Follow-up": { date: null } },
    });
  });
});

describe("set_company_last_outreach", () => {
  it("writes outreach tracking props with Sent status", async () => {
    updateMock.mockResolvedValueOnce({ id: "page-6" });
    await set_company_last_outreach.execute!(
      { company_id: "page-6", email_id: "re_123", sent_at: "2026-04-19T00:00:00Z" },
      toolOpts,
    );
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "page-6",
      properties: {
        "Last Outreach ID": { rich_text: [{ text: { content: "re_123" } }] },
        "Outreach Status": { select: { name: "Sent" } },
        "Outreach Last Event At": { date: { start: "2026-04-19T00:00:00Z" } },
      },
    });
  });
});
