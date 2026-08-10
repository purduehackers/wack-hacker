import type { GetPublishedVariablesResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const get_published_variables = defineTool({
  description:
    "Get published variables and variable collections in a Figma file. Only returns variables that have been published and are visible to consumers.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: fileKey,
  }),
  execute: async ({ file_key }) => {
    const data = await figma.get<GetPublishedVariablesResponse>(
      `/v1/files/${file_key}/variables/published`,
    );
    return data.meta;
  },
});
