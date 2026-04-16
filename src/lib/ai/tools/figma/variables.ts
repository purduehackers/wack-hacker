import { tool } from "ai";
import { z } from "zod";

import { figma } from "./client.ts";

export const get_local_variables = tool({
  description:
    "Get all local variables and variable collections in a Figma file, including unpublished ones. Variables have modes (e.g., Light/Dark) with per-mode values.",
  inputSchema: z.object({
    file_key: z.string().describe("The file key"),
  }),
  execute: async ({ file_key }) => {
    const data = (await figma.get(`/v1/files/${file_key}/variables/local`)) as any;
    return JSON.stringify(data.meta);
  },
});

export const get_published_variables = tool({
  description:
    "Get published variables and variable collections in a Figma file. Only returns variables that have been published and are visible to consumers.",
  inputSchema: z.object({
    file_key: z.string().describe("The file key"),
  }),
  execute: async ({ file_key }) => {
    const data = (await figma.get(`/v1/files/${file_key}/variables/published`)) as any;
    return JSON.stringify(data.meta);
  },
});

export const modify_variables = tool({
  description:
    'Bulk create, update, or delete variables and variable collections in a Figma file. Each entry specifies an action ("CREATE", "UPDATE", or "DELETE"). Read current variables first before modifying.',
  inputSchema: z.object({
    file_key: z.string().describe("The file key"),
    variable_collections: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Variable collection mutations (action + fields)"),
    variable_modes: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Variable mode mutations (action + fields)"),
    variables: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Variable mutations (action + fields)"),
  }),
  execute: async ({ file_key, variable_collections, variable_modes, variables }) => {
    const body: Record<string, unknown> = {};
    if (variable_collections) body.variableCollections = variable_collections;
    if (variable_modes) body.variableModes = variable_modes;
    if (variables) body.variables = variables;
    const result = await figma.post(`/v1/files/${file_key}/variables`, body);
    return JSON.stringify(result);
  },
});
