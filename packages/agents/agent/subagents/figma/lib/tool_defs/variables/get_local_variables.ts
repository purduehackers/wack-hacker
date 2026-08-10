import type { GetLocalVariablesResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const get_local_variables = defineTool({
  description:
    "Get all local variables and variable collections in a Figma file, including unpublished ones. Variables have modes (e.g., Light/Dark) with per-mode values.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: fileKey,
  }),
  execute: async ({ file_key }) => {
    const data = await figma.get<GetLocalVariablesResponse>(
      `/v1/files/${file_key}/variables/local`,
    );
    return data.meta;
  },
});
