import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { notion } from "./client.ts";
import {
  COMPANIES_DATA_SOURCE_ID,
  CONTACTS_DATA_SOURCE_ID,
  DEALS_DATA_SOURCE_ID,
} from "./constants.ts";

export const retrieve_crm_schema = defineTool({
  description: `Retrieve the live schema for all three CRM data sources (Companies, Contacts, Deals). Returns property names, types, and options. Call this before any write so field names and select options are exact.`,
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const [companies, contacts, deals] = await Promise.all([
      notion.dataSources.retrieve({ data_source_id: COMPANIES_DATA_SOURCE_ID }),
      notion.dataSources.retrieve({ data_source_id: CONTACTS_DATA_SOURCE_ID }),
      notion.dataSources.retrieve({ data_source_id: DEALS_DATA_SOURCE_ID }),
    ]);
    const summarize = (ds: Awaited<ReturnType<typeof notion.dataSources.retrieve>>) => ({
      id: ds.id,
      title: "title" in ds ? ds.title : undefined,
      properties: "properties" in ds ? ds.properties : undefined,
    });
    return {
      companies: summarize(companies),
      contacts: summarize(contacts),
      deals: summarize(deals),
    };
  },
});
