import { tool } from "ai";
import { z } from "zod";

import { sentryOrg, sentryGet, sentryMutate } from "./client.ts";

interface SentryRelease {
  version: string;
  dateCreated: string;
  dateReleased: string | null;
  shortVersion: string;
  newGroups: number;
  commitCount: number;
  projects: Array<{ slug: string; name: string }>;
  lastDeploy: { environment: string; dateFinished: string } | null;
}

interface SentryDeploy {
  id: string;
  environment: string;
  dateStarted: string | null;
  dateFinished: string;
  name: string | null;
}

interface SentryCommit {
  id: string;
  message: string;
  dateCreated: string;
  author: { name: string; email: string } | null;
  repository: { name: string } | null;
}

/** List releases for the organization. */
export const list_releases = tool({
  description:
    "List releases for the Sentry organization. Returns version, date, commit count, new groups, and projects.",
  inputSchema: z.object({
    project_slug: z.string().optional().describe("Filter by project slug"),
    query: z.string().optional().describe("Filter by version string"),
    per_page: z.number().max(100).optional(),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, query, per_page, cursor }) => {
    const params = new URLSearchParams();
    if (project_slug) params.set("project", project_slug);
    if (query) params.set("query", query);
    if (per_page) params.set("per_page", String(per_page));
    if (cursor) params.set("cursor", cursor);
    const data = await sentryGet<SentryRelease[]>(
      `/organizations/${sentryOrg()}/releases/?${params}`,
    );
    return JSON.stringify(
      data.map((r) => ({
        version: r.version,
        shortVersion: r.shortVersion,
        dateCreated: r.dateCreated,
        dateReleased: r.dateReleased,
        newGroups: r.newGroups,
        commitCount: r.commitCount,
        projects: r.projects.map((p) => p.slug),
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
    const data = await sentryGet<SentryRelease>(
      `/organizations/${sentryOrg()}/releases/${encodeURIComponent(version)}/`,
    );
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
    const data = await sentryMutate(`/organizations/${sentryOrg()}/releases/`, "POST", {
      version,
      projects,
      ref,
      dateReleased: date_released,
    });
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
    const data = await sentryGet<SentryDeploy[]>(
      `/organizations/${sentryOrg()}/releases/${encodeURIComponent(version)}/deploys/`,
    );
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
    const data = await sentryMutate(
      `/organizations/${sentryOrg()}/releases/${encodeURIComponent(version)}/deploys/`,
      "POST",
      {
        environment,
        dateStarted: date_started,
        dateFinished: date_finished,
        name,
      },
    );
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
    const data = await sentryGet<SentryCommit[]>(
      `/organizations/${sentryOrg()}/releases/${encodeURIComponent(version)}/commits/`,
    );
    return JSON.stringify(
      data.map((c) => ({
        id: c.id,
        message: c.message,
        dateCreated: c.dateCreated,
        author: c.author,
        repository: c.repository?.name,
      })),
    );
  },
});
