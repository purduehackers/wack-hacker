import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit } from "./client.ts";
import { env } from "./config.ts";
import { perPageField, repoField, repoPaginatedInputShape } from "./constants.ts";

const commitSha = z.stringFormat("git-object-sha", /^[0-9a-fA-F]{40}$/u);

export const list_tags = defineTool({
  description: "List tags for a repository. Returns tag name, commit SHA, and commit URL.",
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.repos.listTags({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((t) => ({
        name: t.name,
        commit_sha: t.commit.sha,
        commit_url: t.commit.url,
      })),
    );
  },
});

export const list_refs = defineTool({
  description:
    "List git refs (branches or tags) matching a prefix. Use 'heads/' for branches, 'tags/' for tags. Returns ref names and their target SHAs.",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    namespace: z.enum(["heads", "tags"]).describe("heads for branches, tags for tags"),
    per_page: perPageField,
  }),
  execute: async ({ repo, namespace, per_page }) => {
    const { data } = await octokit().rest.git.listMatchingRefs({
      owner: env.GITHUB_ORG,
      repo,
      ref: namespace,
      per_page: per_page ?? 30,
    });
    return JSON.stringify(
      data.map((r) => ({
        ref: r.ref,
        sha: r.object.sha,
        type: r.object.type,
      })),
    );
  },
});

export const get_ref = defineTool({
  description: "Get a single git ref (branch or tag) by its full name (e.g. 'heads/main').",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    ref: z.string().min(1).describe("Ref path (e.g. 'heads/main', 'tags/v1.0.0')"),
  }),
  execute: async ({ repo, ref }) => {
    const { data } = await octokit().rest.git.getRef({
      owner: env.GITHUB_ORG,
      repo,
      ref,
    });
    return JSON.stringify({ ref: data.ref, sha: data.object.sha, type: data.object.type });
  },
});

export const create_ref = defineTool({
  description:
    "Create a new branch or tag. For branches use ref='refs/heads/my-branch'; for tags use 'refs/tags/v1.0.0'. Requires the target commit SHA.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    ref: z
      .templateLiteral(["refs/", z.enum(["heads", "tags"]), "/", z.string().min(1)])
      .describe("Full ref name (e.g. 'refs/heads/new-branch')"),
    sha: commitSha.describe("Target commit SHA"),
  }),
  execute: async ({ repo, ref, sha }) => {
    const { data } = await octokit().rest.git.createRef({
      owner: env.GITHUB_ORG,
      repo,
      ref,
      sha,
    });
    return JSON.stringify({ ref: data.ref, sha: data.object.sha });
  },
});

export const update_ref = defineTool({
  description:
    "Update a ref to point to a different commit SHA. For branches, equivalent to a fast-forward or force-push (set force=true for non-fast-forward).",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    ref: z.string().min(1).describe("Ref path WITHOUT the 'refs/' prefix (e.g. 'heads/main')"),
    sha: commitSha.describe("New target SHA"),
    force: z.boolean().default(false).describe("Allow non-fast-forward (default false)"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.git.updateRef({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({ ref: data.ref, sha: data.object.sha });
  },
});

export const delete_ref = defineTool({
  description:
    "Delete a git ref (branch or tag). Irreversible. Ref path without 'refs/' prefix (e.g. 'heads/old-branch').",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    ref: z.string().min(1).describe("Ref path (e.g. 'heads/old-branch')"),
  }),
  execute: async ({ repo, ref }) => {
    await octokit().rest.git.deleteRef({
      owner: env.GITHUB_ORG,
      repo,
      ref,
    });
    return JSON.stringify({ deleted: true, ref });
  },
});
