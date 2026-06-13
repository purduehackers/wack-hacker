import { z } from "zod";

import { env } from "../../../../env.ts";
import { paginationInputShape, perPageField } from "../_shared/constants.ts";
import { defineTool } from "../_shared/define-tool.ts";
import { octokit } from "./client.ts";

export const list_releases = defineTool({
  name: "list_releases",
  domain: "github",
  description:
    "List releases for a repository, newest first. Returns tag name, title, draft/prerelease flags, created/published timestamps, and URL.",
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit.rest.repos.listReleases({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 20,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((r) => ({
        id: r.id,
        tag_name: r.tag_name,
        name: r.name,
        draft: r.draft,
        prerelease: r.prerelease,
        created_at: r.created_at,
        published_at: r.published_at,
        html_url: r.html_url,
      })),
    );
  },
});

export const get_release = defineTool({
  name: "get_release",
  domain: "github",
  description: "Get full details for a release including its body, assets, author, and timestamps.",
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    release_id: z.number().describe("Release ID"),
  }),
  execute: async ({ repo, release_id }) => {
    const { data } = await octokit.rest.repos.getRelease({
      owner: env.GITHUB_ORG,
      repo,
      release_id,
    });
    return JSON.stringify({
      id: data.id,
      tag_name: data.tag_name,
      name: data.name,
      body: data.body,
      draft: data.draft,
      prerelease: data.prerelease,
      author: data.author?.login,
      assets: data.assets.map((a) => ({
        name: a.name,
        size: a.size,
        download_count: a.download_count,
        browser_download_url: a.browser_download_url,
      })),
      created_at: data.created_at,
      published_at: data.published_at,
      html_url: data.html_url,
    });
  },
});

export const create_release = defineTool({
  name: "create_release",
  domain: "github",
  description:
    "Create a new release for a repository. Requires tag_name; will auto-create the tag if it doesn't exist. Supports draft releases and prereleases.",
  access: { risk: "write" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    tag_name: z.string().describe("Tag name (created if new)"),
    target_commitish: z.string().optional().describe("Branch or commit SHA the tag points to"),
    name: z.string().optional().describe("Release title"),
    body: z.string().optional().describe("Release notes (Markdown)"),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
    generate_release_notes: z
      .boolean()
      .optional()
      .describe("Auto-generate notes from PRs since the last release"),
  }),
  execute: async ({ repo, ...input }) => {
    const { data } = await octokit.rest.repos.createRelease({
      owner: env.GITHUB_ORG,
      repo,
      ...input,
    });
    return JSON.stringify({
      id: data.id,
      tag_name: data.tag_name,
      name: data.name,
      html_url: data.html_url,
    });
  },
});

export const update_release = defineTool({
  name: "update_release",
  domain: "github",
  description:
    "Update an existing release's tag name, title, body, draft/prerelease status, or target branch.",
  access: { risk: "write" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    release_id: z.number().describe("Release ID"),
    tag_name: z.string().optional(),
    target_commitish: z.string().optional(),
    name: z.string().optional(),
    body: z.string().optional(),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
  }),
  execute: async ({ repo, release_id, ...input }) => {
    const { data } = await octokit.rest.repos.updateRelease({
      owner: env.GITHUB_ORG,
      repo,
      release_id,
      ...input,
    });
    return JSON.stringify({
      id: data.id,
      tag_name: data.tag_name,
      name: data.name,
      html_url: data.html_url,
    });
  },
});

export const delete_release = defineTool({
  name: "delete_release",
  domain: "github",
  description: "Delete a release by ID. The associated tag is not deleted automatically.",
  access: { risk: "destructive" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    release_id: z.number().describe("Release ID"),
  }),
  execute: async ({ repo, release_id }) => {
    await octokit.rest.repos.deleteRelease({
      owner: env.GITHUB_ORG,
      repo,
      release_id,
    });
    return JSON.stringify({ deleted: true, release_id });
  },
});

export const list_release_assets = defineTool({
  name: "list_release_assets",
  domain: "github",
  description:
    "List assets (attached files) on a release. Returns name, size, download count, and download URL.",
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    release_id: z.number().describe("Release ID"),
    per_page: perPageField,
  }),
  execute: async ({ repo, release_id, per_page }) => {
    const { data } = await octokit.rest.repos.listReleaseAssets({
      owner: env.GITHUB_ORG,
      repo,
      release_id,
      per_page: per_page ?? 30,
    });
    return JSON.stringify(
      data.map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size,
        download_count: a.download_count,
        browser_download_url: a.browser_download_url,
      })),
    );
  },
});
