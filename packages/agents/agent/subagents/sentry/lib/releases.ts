import {
  listAnOrganization_sReleases,
  retrieveAnOrganization_sRelease,
  createANewReleaseForAnOrganization,
  listARelease_sDeploys,
  createADeploy,
  listAnOrganizationRelease_sCommits,
  unwrapResult,
} from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "./client.ts";

// Read-only projection over fields the generated SDK type omits: an unexpected
// shape must degrade to "absent" rather than fail the tool.
const releaseCommitProjectionSchema = z.looseObject({
  // `.catch` keeps the "can never fail" property the previous `z.unknown()` had:
  // `z.json()` rejects a shape Sentry might introduce, and this projection is
  // read through a throwing `.parse`.
  author: z.json().optional().catch(undefined),
  repository: z
    .looseObject({ name: z.string().nullish().catch(undefined) })
    .nullish()
    .catch(undefined),
});

/** List releases for the organization. */
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

/** Get full details for a release. */
export const get_release = defineTool({
  description: "Get full details for a Sentry release by version string.",
  access: { risk: "read" },
  input: z.strictObject({
    version: z.string().describe("Release version (e.g. '1.0.0' or a commit SHA)"),
  }),
  execute: async ({ version }) => {
    const result = await retrieveAnOrganization_sRelease({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        version,
      },
    });
    const { data } = unwrapResult(result, "getRelease");
    return JSON.stringify(data);
  },
});

/** Create a new release. */
export const create_release = defineTool({
  description:
    "Create a new Sentry release. Requires a version string and at least one project slug.",
  access: { risk: "write" },
  input: z.strictObject({
    version: z.string().describe("Release version string"),
    projects: z.array(z.string()).describe("Project slugs to associate with this release"),
    ref: z.string().optional().describe("Git ref (commit SHA or tag)"),
    date_released: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("ISO 8601 release timestamp, e.g. 2024-05-01T18:30:00Z"),
  }),
  execute: async ({ version, projects, ref, date_released }) => {
    const result = await createANewReleaseForAnOrganization({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      body: {
        version,
        projects,
        ...(ref === undefined ? {} : { ref }),
        ...(date_released === undefined ? {} : { dateReleased: date_released }),
      },
    });
    const { data } = unwrapResult(result, "createRelease");
    return JSON.stringify(data);
  },
});

/** List deploys for a release. */
export const list_release_deploys = defineTool({
  description: "List deploys for a Sentry release. Shows environment, dates, and deploy name.",
  access: { risk: "read" },
  input: z.strictObject({
    version: z.string().describe("Release version"),
  }),
  execute: async ({ version }) => {
    const result = await listARelease_sDeploys({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        version,
      },
    });
    const { data } = unwrapResult(result, "listReleaseDeploys");
    return JSON.stringify(data);
  },
});

/** Record a deploy for a release. */
export const create_deploy = defineTool({
  description:
    "Record a deploy for a Sentry release. Requires an environment name (e.g. 'production', 'staging').",
  access: { risk: "write" },
  input: z.strictObject({
    version: z.string().describe("Release version"),
    environment: z.string().describe("Environment name (e.g. 'production')"),
    date_started: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("ISO 8601 deploy start timestamp, e.g. 2024-05-01T18:30:00Z"),
    date_finished: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("ISO 8601 deploy finish timestamp, e.g. 2024-05-01T18:35:00Z"),
    name: z.string().optional().describe("Optional deploy name"),
  }),
  execute: async ({ version, environment, date_started, date_finished, name }) => {
    const result = await createADeploy({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        version,
      },
      body: {
        environment,
        ...(date_started === undefined ? {} : { dateStarted: date_started }),
        ...(date_finished === undefined ? {} : { dateFinished: date_finished }),
        ...(name === undefined ? {} : { name }),
      },
    });
    const { data } = unwrapResult(result, "createDeploy");
    return JSON.stringify(data);
  },
});

/** List commits associated with a release. */
export const list_release_commits = defineTool({
  description: "List commits associated with a Sentry release.",
  access: { risk: "read" },
  input: z.strictObject({
    version: z.string().describe("Release version"),
  }),
  execute: async ({ version }) => {
    const result = await listAnOrganizationRelease_sCommits({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        version,
      },
    });
    const { data } = unwrapResult(result, "listReleaseCommits");
    return JSON.stringify(
      data.map((commit) => {
        const projection = releaseCommitProjectionSchema.parse(commit);
        return {
          id: commit.id,
          message: commit.message,
          dateCreated: commit.dateCreated,
          author: projection.author,
          repository: projection.repository?.name,
        };
      }),
    );
  },
});
