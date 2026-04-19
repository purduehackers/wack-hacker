import { describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const retrieveMock = vi.fn();

vi.mock("./client.ts", () => ({
  notion: { dataSources: { retrieve: retrieveMock } },
  companiesDataSourceId: () => "companies-ds",
  contactsDataSourceId: () => "contacts-ds",
  dealsDataSourceId: () => "deals-ds",
}));

const { retrieve_crm_schema } = await import("./schema.ts");

describe("retrieve_crm_schema", () => {
  it("queries all three data sources and merges the result", async () => {
    retrieveMock
      .mockResolvedValueOnce({ id: "c", title: "Companies", properties: { Company: {} } })
      .mockResolvedValueOnce({ id: "t", title: "Contacts", properties: { Name: {} } })
      .mockResolvedValueOnce({ id: "d", title: "Deals", properties: { Deal: {} } });

    const raw = await retrieve_crm_schema.execute!({}, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.companies.id).toBe("c");
    expect(parsed.contacts.id).toBe("t");
    expect(parsed.deals.id).toBe("d");
    expect(retrieveMock).toHaveBeenCalledTimes(3);
    expect(retrieveMock).toHaveBeenCalledWith({ data_source_id: "companies-ds" });
    expect(retrieveMock).toHaveBeenCalledWith({ data_source_id: "contacts-ds" });
    expect(retrieveMock).toHaveBeenCalledWith({ data_source_id: "deals-ds" });
  });
});
