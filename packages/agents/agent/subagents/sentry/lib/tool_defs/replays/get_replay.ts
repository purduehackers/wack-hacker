import { retrieveAReplayInstance, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const get_replay = defineTool({
  description:
    "Get full details for a session replay — duration, error count, URLs, user info, browser/OS, and segment count.",
  access: { risk: "read" },
  input: z.strictObject({
    replay_id: z.string().describe("Replay ID"),
  }),
  execute: async ({ replay_id }) => {
    const result = await retrieveAReplayInstance({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        replay_id,
      },
    });
    const { data } = unwrapResult(result, "getReplay");
    return JSON.stringify(data);
  },
});
