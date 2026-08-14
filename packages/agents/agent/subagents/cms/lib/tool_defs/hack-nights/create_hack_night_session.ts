import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { payload, wrapPayloadError } from "../../client.ts";
import { sessionFields } from "../../constants.ts";
import { projectSession, richTextParagraph } from "../../projections.ts";

export const create_hack_night_session = defineTool({
  description:
    "Create a new hack night session entry. Pass host as { preferred_name, discord_id }.",
  access: { risk: "write" },
  input: z.strictObject(sessionFields),
  execute: async ({
    title,
    date,
    host_preferred_name,
    host_discord_id,
    description,
    published,
  }) => {
    try {
      const doc = await payload.create({
        collection: "hack-night-sessions",
        data: {
          title,
          date,
          host: { preferred_name: host_preferred_name, discord_id: host_discord_id },
          description: richTextParagraph(description),
          published: published ?? false,
        },
      });
      return JSON.stringify(projectSession(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
