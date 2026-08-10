import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const artifact_exists = defineTool({
  description: "Check whether a Turborepo artifact with the given hash exists.",
  access: { risk: "read" },
  input: z.strictObject({ hash: z.string() }),
  execute: async ({ hash }) => {
    await vercel().artifacts.artifactExists({ ...TEAM, hash });
    return JSON.stringify({ exists: true, hash });
  },
});
