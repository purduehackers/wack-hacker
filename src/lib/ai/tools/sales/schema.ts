import { tool } from "ai";
import { z } from "zod";

import { notion } from "./client.ts";
import {
  COMPANIES_DATA_SOURCE_ID,
  CONTACTS_DATA_SOURCE_ID,
  DEALS_DATA_SOURCE_ID,
} from "./constants.ts";

export const retrieve_crm_schema = tool({
  description: `Retrieve the live schema for all three CRM data sources (Companies, Contacts, Deals). Returns property names, types, and options. Call this before any write so field names and select options are exact.`,
  inputSchema: z.object({}),
  execute: async () => {
    const [companies, contacts, deals] = await Promise.all([
      notion.dataSources.retrieve({ data_source_id: COMPANIES_DATA_SOURCE_ID }),
      notion.dataSources.retrieve({ data_source_id: CONTACTS_DATA_SOURCE_ID }),
      notion.dataSources.retrieve({ data_source_id: DEALS_DATA_SOURCE_ID }),
    ]);
    const summarize = (ds: { id: string; title?: unknown; properties?: unknown }) => ({
      id: ds.id,
      title: ds.title,
      properties: ds.properties,
    });
    return JSON.stringify({
      companies: summarize(companies),
      contacts: summarize(contacts),
      deals: summarize(deals),
    });
  },
});
