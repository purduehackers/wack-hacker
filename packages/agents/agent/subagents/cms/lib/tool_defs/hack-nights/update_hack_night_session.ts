import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectSession, richTextParagraph, sessionFields } from "../../constants.ts";

export const update_hack_night_session = defineTool({
  description:
    "Update a hack night session. Only fields you pass are changed. If updating host, pass both host_preferred_name and host_discord_id (Payload treats the host group as a replace-on-write object; a partial patch would clobber the other subfield). Description (if provided) is wrapped as a single Lexical paragraph.",
  access: { risk: "write" },
  input: z
    .strictObject({ id: documentId, ...z.object(sessionFields).partial().shape })
    .refine(
      ({ host_preferred_name, host_discord_id }) =>
        (host_preferred_name === undefined) === (host_discord_id === undefined),
      {
        message:
          "host_preferred_name and host_discord_id must be provided together when updating host.",
        path: ["host_preferred_name"],
      },
    ),
  execute: async ({ id, host_preferred_name, host_discord_id, description, ...rest }) => {
    try {
      const data = {
        ...rest,
        ...(host_preferred_name !== undefined &&
          host_discord_id !== undefined && {
            host: { preferred_name: host_preferred_name, discord_id: host_discord_id },
          }),
        ...(description !== undefined && { description: richTextParagraph(description) }),
      };
      const doc = await payload.update({
        collection: "hack-night-sessions",
        id,
        data,
      });
      return JSON.stringify(projectSession(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
