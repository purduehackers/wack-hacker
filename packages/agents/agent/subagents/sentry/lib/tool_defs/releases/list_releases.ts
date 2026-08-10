import { listAnOrganization_sReleases, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const list_releases = defineTool({
  description:
    "List releases for the Sentry organization. Returns version, date, commit count, new groups, and projects.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().optional().describe("Filter by project slug"),
    query: z.string().optional().describe("Filter by version string"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, query, cursor }) => {
    const releaseQuery = project_slug ? `${query ?? ""} project:${project_slug}`.trim() : query;
    const result = await listAnOrganization_sReleases({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        ...(releaseQuery === undefined ? {} : { query: releaseQuery }),
        ...(cursor === undefined ? {} : { cursor }),
      },
    });
    const { data } = unwrapResult(result, "listReleases");
    return JSON.stringify(
      data.map((r) => ({
        version: r.version,
        shortVersion: r.shortVersion,
        dateCreated: r.dateCreated,
        dateReleased: r.dateReleased,
        newGroups: r.newGroups,
        commitCount: r.commitCount,
        projects: r.projects?.map((p) => p.slug),
        lastDeploy: r.lastDeploy,
      })),
    );
  },
});
