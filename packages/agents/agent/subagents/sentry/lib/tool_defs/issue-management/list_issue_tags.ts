import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryGet, sentryResponse } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

const issueTagsResponseSchema = z.array(
  z.looseObject({
    key: z.string(),
    name: z.string(),
    totalValues: z.number(),
    topValues: z.array(z.looseObject({ value: z.string(), count: z.number(), name: z.string() })),
  }),
);

export const list_issue_tags = defineTool({
  description:
    "List tag distributions for a Sentry issue. Shows tag keys (browser, os, environment, etc.) with value counts.",
  access: { risk: "read" },
  input: z.strictObject({
    issue_id: sentryNumericId.describe("Sentry issue ID (numeric)"),
  }),
  execute: async ({ issue_id }) => {
    // No direct SDK method for listing all tags. Use raw fetch.
    const data = sentryResponse(
      issueTagsResponseSchema,
      await sentryGet(`/issues/${issue_id}/tags/`),
    );
    return JSON.stringify(
      data.map((t) => ({
        key: t.key,
        name: t.name,
        totalValues: t.totalValues,
        topValues: t.topValues.slice(0, 5),
      })),
    );
  },
});
