import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, packageTypeSchema, paginationInputShape } from "../../constants.ts";

export const list_packages = defineTool({
  description: `List packages in the purduehackers organization filtered by package type (npm, docker, container, etc.). Returns each package's ID, name, type, visibility, URL, and timestamps.`,
  access: { risk: "read" },
  input: z.strictObject({
    package_type: packageTypeSchema.describe("Package type"),
    ...paginationInputShape,
  }),
  execute: async ({ package_type, per_page, page }) => {
    const { data } = await octokit().rest.packages.listPackagesForOrganization({
      org: env.GITHUB_ORG,
      package_type,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((p) => ({
        id: p.id,
        name: p.name,
        package_type: p.package_type,
        visibility: p.visibility,
        html_url: p.html_url,
        created_at: p.created_at,
        updated_at: p.updated_at,
      })),
    );
  },
});
