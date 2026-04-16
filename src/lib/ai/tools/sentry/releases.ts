import {
  listAnOrganization_sReleases,
  retrieveAnOrganization_sRelease,
  createANewReleaseForAnOrganization,
  listARelease_sDeploys,
  createADeploy,
  listAnOrganizationRelease_sCommits,
  unwrapResult,
} from "@sentry/api";
import { tool } from "ai";
import { z } from "zod";

import { sentryOpts, sentryOrg } from "./client.ts";

/** List releases for the organization. */
export const list_releases = tool({
  description:
    "List releases for the Sentry organization. Returns version, date, commit count, new groups, and projects.",
  inputSchema: z.object({
    project_slug: z.string().optional().describe("Filter by project slug"),
    query: z.string().optional().describe("Filter by version string"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, query, cursor }) => {
    const result = await listAnOrganization_sReleases({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        query: project_slug ? `${query ?? ""} project:${project_slug}`.trim() : query,
        cursor,
      },
    });
    const { data } = unwrapResult(result, "listReleases");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((r) => ({
        version: r.version,
        shortVersion: r.shortVersion,
        dateCreated: r.dateCreated,
        dateReleased: r.dateReleased,
        newGroups: r.newGroups,
        commitCount: r.commitCount,
        projects: (r.projects as Array<Record<string, unknown>>)?.map((p) => p.slug),
        lastDeploy: r.lastDeploy,
      })),
    );
  },
});

/** Get full details for a release. */
export const get_release = tool({
  description: "Get full details for a Sentry release by version string.",
  inputSchema: z.object({
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
export const create_release = tool({
  description:
    "Create a new Sentry release. Requires a version string and at least one project slug.",
  inputSchema: z.object({
    version: z.string().describe("Release version string"),
    projects: z.array(z.string()).describe("Project slugs to associate with this release"),
    ref: z.string().optional().describe("Git ref (commit SHA or tag)"),
    date_released: z.string().optional().describe("ISO 8601 release date"),
  }),
  execute: async ({ version, projects, ref, date_released }) => {
    const result = await createANewReleaseForAnOrganization({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      body: {
        version,
        projects,
        ref,
        dateReleased: date_released,
      },
    });
    const { data } = unwrapResult(result, "createRelease");
    return JSON.stringify(data);
  },
});

/** List deploys for a release. */
export const list_release_deploys = tool({
  description: "List deploys for a Sentry release. Shows environment, dates, and deploy name.",
  inputSchema: z.object({
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
export const create_deploy = tool({
  description:
    "Record a deploy for a Sentry release. Requires an environment name (e.g. 'production', 'staging').",
  inputSchema: z.object({
    version: z.string().describe("Release version"),
    environment: z.string().describe("Environment name (e.g. 'production')"),
    date_started: z.string().optional().describe("ISO 8601 deploy start time"),
    date_finished: z.string().optional().describe("ISO 8601 deploy finish time"),
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
        dateStarted: date_started,
        dateFinished: date_finished,
        name,
      },
    });
    const { data } = unwrapResult(result, "createDeploy");
    return JSON.stringify(data);
  },
});

/** List commits associated with a release. */
export const list_release_commits = tool({
  description: "List commits associated with a Sentry release.",
  inputSchema: z.object({
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
      (data as Array<Record<string, unknown>>).map((c) => ({
        id: c.id,
        message: c.message,
        dateCreated: c.dateCreated,
        author: c.author,
        repository: (c.repository as Record<string, unknown> | null)?.name,
      })),
    );
  },
});
