import { describe, expect, it, vi } from "vitest";

import { notionClientClass, toolOpts } from "@/lib/test/fixtures";

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
}));

vi.mock("@notionhq/client", () => ({
  Client: notionClientClass({ dataSourcesRetrieve: mocks.retrieve }),
}));

const { retrieve_crm_schema } = await import("./schema.ts");
const { COMPANIES_DATA_SOURCE_ID, CONTACTS_DATA_SOURCE_ID, DEALS_DATA_SOURCE_ID } =
  await import("./constants.ts");

describe("retrieve_crm_schema", () => {
  it("queries all three data sources and merges the result", async () => {
    mocks.retrieve
      .mockResolvedValueOnce({ id: "c", title: "Companies", properties: { Company: {} } })
      .mockResolvedValueOnce({ id: "t", title: "Contacts", properties: { Name: {} } })
      .mockResolvedValueOnce({ id: "d", title: "Deals", properties: { Deal: {} } });

    const raw = await retrieve_crm_schema.execute!({}, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.companies.id).toBe("c");
    expect(parsed.contacts.id).toBe("t");
    expect(parsed.deals.id).toBe("d");
    expect(mocks.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.retrieve).toHaveBeenCalledWith({ data_source_id: COMPANIES_DATA_SOURCE_ID });
    expect(mocks.retrieve).toHaveBeenCalledWith({ data_source_id: CONTACTS_DATA_SOURCE_ID });
    expect(mocks.retrieve).toHaveBeenCalledWith({ data_source_id: DEALS_DATA_SOURCE_ID });
  });
});
