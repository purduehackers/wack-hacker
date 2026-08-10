import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, packageName, packageTypeSchema, resourceId } from "../../constants.ts";

export const delete_package_version = defineTool({
  description: `Delete a specific version of a package from the purduehackers organization. This action is irreversible. You need the package version ID (get it from list_package_versions).`,
  access: { risk: "destructive" },
  input: z.strictObject({
    package_type: packageTypeSchema,
    package_name: packageName,
    package_version_id: resourceId.describe("Package version ID"),
  }),
  execute: async ({ package_type, package_name, package_version_id }) => {
    await octokit().rest.packages.deletePackageVersionForOrg({
      org: env.GITHUB_ORG,
      package_type,
      package_name,
      package_version_id,
    });
    return JSON.stringify({ deleted: true });
  },
});
