import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { COMPANIES_DATA_SOURCE_ID } from "../../constants.ts";
import { isCreateProperties } from "../../notion-input.ts";

export const create_company = defineTool({
  description: `Create a new Company row in the CRM. Provide at least the company name; other properties should match the Companies data source schema (call retrieve_crm_schema first if unsure).`,
  access: { risk: "write" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    name: z.string().describe("Company name (required)"),
    properties: z
      .record(z.string(), z.json())
      .optional()
      .describe("Additional Notion properties keyed by property name"),
  }),
  execute: async ({ name, properties }) => {
    const additionalProperties = properties ?? {};
    if (!isCreateProperties(additionalProperties)) {
      return { error: "Invalid Notion CRM properties" };
    }
    const page = await notion.pages.create({
      parent: { data_source_id: COMPANIES_DATA_SOURCE_ID },
      properties: {
        Name: { title: [{ text: { content: name } }] },
        ...additionalProperties,
      },
    });
    return {
      id: page.id,
      url: "url" in page ? page.url : undefined,
      name,
    };
  },
});
