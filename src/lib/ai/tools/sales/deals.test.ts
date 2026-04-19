import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const queryMock = vi.fn();
const retrieveMock = vi.fn();
const updateMock = vi.fn();
const createMock = vi.fn();

vi.mock("./client.ts", () => ({
  notion: {
    dataSources: { query: queryMock },
    pages: { retrieve: retrieveMock, update: updateMock, create: createMock },
  },
  dealsDataSourceId: () => "deals-ds",
}));

const { list_deals, get_deal, create_deal, update_deal_stage, update_deal } =
  await import("./deals.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_deals", () => {
  it("queries the Deals data source", async () => {
    queryMock.mockResolvedValueOnce({
      results: [{ id: "d-1", properties: { Deal: {} } }],
      has_more: false,
      next_cursor: null,
    });
    const raw = await list_deals.execute!({}, toolOpts);
    expect(JSON.parse(raw as string).results[0].id).toBe("d-1");
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: "deals-ds", page_size: 25 }),
    );
  });
});

describe("get_deal", () => {
  it("retrieves a deal page", async () => {
    retrieveMock.mockResolvedValueOnce({ id: "d-2" });
    const raw = await get_deal.execute!({ deal_id: "d-2" }, toolOpts);
    expect(JSON.parse(raw as string).id).toBe("d-2");
  });
});

describe("create_deal", () => {
  it("creates a deal with defaults when only name is given", async () => {
    createMock.mockResolvedValueOnce({ id: "d-3" });
    await create_deal.execute!({ name: "Acme sponsorship" }, toolOpts);
    const call = createMock.mock.calls[0]![0];
    expect(call.parent).toEqual({ type: "data_source_id", data_source_id: "deals-ds" });
    expect(call.properties.Deal).toEqual({ title: [{ text: { content: "Acme sponsorship" } }] });
    expect(call.properties.Stage).toEqual({ status: { name: "Lead" } });
    expect(call.properties.Amount).toBeUndefined();
  });

  it("respects optional fields", async () => {
    createMock.mockResolvedValueOnce({ id: "d-4" });
    await create_deal.execute!(
      {
        name: "Hackathon sponsor",
        amount: 5000,
        stage: "Qualified",
        priority: "High",
        close_date: "2026-06-01",
        notes: "Intro from advisor",
      },
      toolOpts,
    );
    const call = createMock.mock.calls[0]![0];
    expect(call.properties.Amount).toEqual({ number: 5000 });
    expect(call.properties.Stage).toEqual({ status: { name: "Qualified" } });
    expect(call.properties.Priority).toEqual({ select: { name: "High" } });
    expect(call.properties["Close date"]).toEqual({ date: { start: "2026-06-01" } });
    expect(call.properties.Notes).toEqual({
      rich_text: [{ text: { content: "Intro from advisor" } }],
    });
  });
});

describe("update_deal_stage", () => {
  it("updates only the Stage status", async () => {
    updateMock.mockResolvedValueOnce({ id: "d-5" });
    await update_deal_stage.execute!({ deal_id: "d-5", stage: "Won" }, toolOpts);
    expect(updateMock).toHaveBeenCalledWith({
      page_id: "d-5",
      properties: { Stage: { status: { name: "Won" } } },
    });
  });
});

describe("update_deal", () => {
  it("updates only the provided fields", async () => {
    updateMock.mockResolvedValueOnce({ id: "d-6" });
    await update_deal.execute!({ deal_id: "d-6", amount: 1000, notes: "Update" }, toolOpts);
    const call = updateMock.mock.calls[0]![0];
    expect(call.page_id).toBe("d-6");
    expect(call.properties.Amount).toEqual({ number: 1000 });
    expect(call.properties.Notes).toEqual({ rich_text: [{ text: { content: "Update" } }] });
    expect(call.properties.Priority).toBeUndefined();
  });
});
