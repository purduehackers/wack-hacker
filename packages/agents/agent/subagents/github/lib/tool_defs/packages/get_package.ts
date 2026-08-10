import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, packageName, packageTypeSchema } from "../../constants.ts";

export const get_package = defineTool({
  description: `Get detailed information about a specific package in the purduehackers organization, including its ID, name, type, visibility, URL, and timestamps.`,
  access: { risk: "read" },
  input: z.strictObject({
    package_type: packageTypeSchema,
    package_name: packageName,
  }),
  execute: async ({ package_type, package_name }) => {
    const { data } = await octokit().rest.packages.getPackageForOrganization({
      org: env.GITHUB_ORG,
      package_type,
      package_name,
    });
    return JSON.stringify({
      id: data.id,
      name: data.name,
      package_type: data.package_type,
      visibility: data.visibility,
      html_url: data.html_url,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  },
});
