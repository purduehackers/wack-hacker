import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_global_config_backup = defineTool({
  description: "Retrieve a specific Global Config backup.",
  access: { risk: "read" },
  input: z.strictObject({
    global_config_id: z.string(),
    backup_version_id: z.string(),
  }),
  execute: async ({ global_config_id, backup_version_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigBackup({
      ...TEAM,
      edgeConfigId: global_config_id,
      edgeConfigBackupVersionId: backup_version_id,
    });
    return JSON.stringify(result);
  },
});
