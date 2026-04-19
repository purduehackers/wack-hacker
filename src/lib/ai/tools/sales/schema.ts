import { tool } from "ai";
import { z } from "zod";

import {
  companiesDataSourceId,
  contactsDataSourceId,
  dealsDataSourceId,
  notion,
} from "./client.ts";

export const retrieve_crm_schema = tool({
  description: `Retrieve the live schema for all three CRM data sources (Companies, Contacts, Deals). Returns property names, types, and options. Call this before any write so field names and select options are exact.`,
  inputSchema: z.object({}),
  execute: async () => {
    const [companies, contacts, deals] = await Promise.all([
      notion.dataSources.retrieve({ data_source_id: companiesDataSourceId() }),
      notion.dataSources.retrieve({ data_source_id: contactsDataSourceId() }),
      notion.dataSources.retrieve({ data_source_id: dealsDataSourceId() }),
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
