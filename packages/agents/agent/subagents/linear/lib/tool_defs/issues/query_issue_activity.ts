import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const query_issue_activity = defineTool({
  description:
    "Fetch an issue's field change history and comment thread. Use 'history' for who/when of changes, 'comments' for discussion context.",
  access: { risk: "read" },
  input: z.strictObject({ id: z.string() }),
  execute: async ({ id }) => {
    const issue = await linear.issue(id);
    const [history, comments] = await Promise.all([issue.history(), issue.comments()]);
    return JSON.stringify({
      history: history.nodes.map((h) => ({ id: h.id, createdAt: h.createdAt })),
      comments: comments.nodes.map((c) => ({
        id: c.id,
        body: c.body?.slice(0, 500),
        createdAt: c.createdAt,
        url: c.url,
      })),
    });
  },
});
