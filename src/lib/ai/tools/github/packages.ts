import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../env.ts";
import { octokit } from "./client.ts";

const packageTypeSchema = z.enum(["npm", "maven", "rubygems", "docker", "nuget", "container"]);

/** List packages in the organization. */
export const list_packages = tool({
  description: `List packages in the purduehackers organization filtered by package type (npm, docker, container, etc.). Returns each package's ID, name, type, visibility, URL, and timestamps.`,
  inputSchema: z.object({
    package_type: packageTypeSchema.describe("Package type"),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ package_type, per_page, page }) => {
    const { data } = await octokit.rest.packages.listPackagesForOrganization({
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

/** Get details for a specific package. */
export const get_package = tool({
  description: `Get detailed information about a specific package in the purduehackers organization, including its ID, name, type, visibility, URL, and timestamps.`,
  inputSchema: z.object({
    package_type: packageTypeSchema,
    package_name: z.string().describe("Package name"),
  }),
  execute: async ({ package_type, package_name }) => {
    const { data } = await octokit.rest.packages.getPackageForOrganization({
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

/** List versions of a package. */
export const list_package_versions = tool({
  description: `List all versions of a package in the purduehackers organization. Returns each version's ID, name (tag), timestamps, URL, and metadata.`,
  inputSchema: z.object({
    package_type: packageTypeSchema,
    package_name: z.string().describe("Package name"),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ package_type, package_name, per_page, page }) => {
    const { data } = await octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
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

/** Delete a specific package version. */
export const delete_package_version = tool({
  description: `Delete a specific version of a package from the purduehackers organization. This action is irreversible. You need the package version ID (get it from list_package_versions).`,
  inputSchema: z.object({
    package_type: packageTypeSchema,
    package_name: z.string().describe("Package name"),
    package_version_id: z.number().describe("Package version ID"),
  }),
  execute: async ({ package_type, package_name, package_version_id }) => {
    await octokit.rest.packages.deletePackageVersionForOrg({
      org: env.GITHUB_ORG,
      package_type,
      package_name,
      package_version_id,
    });
    return JSON.stringify({ deleted: true });
  },
});
