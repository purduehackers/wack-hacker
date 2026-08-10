import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, packageName, packageTypeSchema, paginationInputShape } from "../../constants.ts";

export const list_package_versions = defineTool({
  description: `List all versions of a package in the purduehackers organization. Returns each version's ID, name (tag), timestamps, URL, and metadata.`,
  access: { risk: "read" },
  input: z.strictObject({
    package_type: packageTypeSchema,
    package_name: packageName,
    ...paginationInputShape,
  }),
  execute: async ({ package_type, package_name, per_page, page }) => {
    const { data } = await octokit().rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
      org: env.GITHUB_ORG,
      package_type,
      package_name,
      per_page: per_page ?? 20,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((v) => ({
        id: v.id,
        name: v.name,
        created_at: v.created_at,
        updated_at: v.updated_at,
        html_url: v.html_url,
        metadata: v.metadata,
      })),
    );
  },
});
