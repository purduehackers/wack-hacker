import type { GetFileResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma, figmaFileUrl } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const get_file = defineTool({
  description:
    "Get a Figma file's metadata and document structure. Use depth to control how deep the node tree goes (default 1 = pages only). Large files can be enormous — start shallow.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: fileKey,
    depth: z
      .int()
      .min(1)
      .max(4)
      .default(1)
      .describe("How deep to traverse the node tree (1 = pages only, max 4)"),
  }),
  execute: async ({ file_key, depth }) => {
    const file = await figma.get<GetFileResponse>(`/v1/files/${file_key}?depth=${depth}`);
    return {
      name: file.name,
      lastModified: file.lastModified,
      version: file.version,
      url: figmaFileUrl(file_key),
      document: file.document,
      editorType: file.editorType,
    };
  },
});
