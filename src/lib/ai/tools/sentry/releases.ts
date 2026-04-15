import { tool } from "ai";
import { z } from "zod";

import { orgPath, sentryGet, sentryPaginated } from "./client.ts";

export const list_sentry_releases = tool({
  description: `List releases for the organization, optionally filtered by project. Returns version, date, commit count, and new issues count.`,
  inputSchema: z.object({
    project_slug: z.string().optional().describe("Filter by project slug"),
    query: z.string().optional().describe("Filter releases by version substring"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, query, cursor }) => {
    const params: Record<string, string | undefined> = { query, cursor };
    if (project_slug) params.project = project_slug;
    const { results, nextCursor } = await sentryPaginated<Record<string, unknown>>(
      orgPath("/releases/"),
      params,
    );
    return JSON.stringify({
      releases: results.map((r) => ({
        version: r.version,
        shortVersion: r.shortVersion,
        dateCreated: r.dateCreated,
        dateReleased: r.dateReleased,
        newGroups: r.newGroups,
        commitCount: r.commitCount,
        lastDeploy: r.lastDeploy,
        firstEvent: r.firstEvent,
        lastEvent: r.lastEvent,
      })),
      nextCursor,
    });
  },
});

export const get_sentry_release = tool({
  description: `Get details of a specific release — version info, commits, authors, deploy history, and associated projects.`,
  inputSchema: z.object({
    version: z.string().describe("Release version identifier"),
  }),
  execute: async ({ version }) => {
    const release = await sentryGet<Record<string, unknown>>(
      orgPath(`/releases/${encodeURIComponent(version)}/`),
    );
    return JSON.stringify({
      version: release.version,
      shortVersion: release.shortVersion,
      dateCreated: release.dateCreated,
      dateReleased: release.dateReleased,
      newGroups: release.newGroups,
      commitCount: release.commitCount,
      authors: release.authors,
      projects: release.projects,
      firstEvent: release.firstEvent,
      lastEvent: release.lastEvent,
      lastDeploy: release.lastDeploy,
      deployCount: release.deployCount,
    });
  },
});

export const list_sentry_deploys = tool({
  description: `List deploys for a specific release. Shows environment, date, and deploy name.`,
  inputSchema: z.object({
    version: z.string().describe("Release version identifier"),
  }),
  execute: async ({ version }) => {
    const deploys = await sentryGet<Array<Record<string, unknown>>>(
      orgPath(`/releases/${encodeURIComponent(version)}/deploys/`),
    );
    return JSON.stringify(
      deploys.map((d) => ({
        id: d.id,
        environment: d.environment,
        name: d.name,
        dateStarted: d.dateStarted,
        dateFinished: d.dateFinished,
      })),
    );
  },
});
