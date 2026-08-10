import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit } from "./client.ts";
import { env } from "./config.ts";
import { isoDateOrDateTime, paginationInputShape, repoField } from "./constants.ts";

/** Get the content of a file or list a directory in a repository. */
export const get_file_content = defineTool({
  description: `Get the content of a file or list entries in a directory. For files, returns the decoded content (truncated at 50k chars), SHA, and URL. For directories, returns a list of entries with name, path, type, and size. Use the 'ref' param to read from a specific branch or tag.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    path: z.string().describe("File or directory path"),
    ref: z.string().exactOptional().describe("Branch/tag/SHA (defaults to default branch)"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.repos.getContent({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    if (Array.isArray(data)) {
      return JSON.stringify(
        data.map((f) => ({
          name: f.name,
          path: f.path,
          type: f.type,
          size: f.size,
        })),
      );
    }
    if (data.type === "file" && "content" in data) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return JSON.stringify({
        name: data.name,
        path: data.path,
        size: data.size,
        sha: data.sha,
        content: content.length > 50_000 ? content.slice(0, 50_000) + "\n...(truncated)" : content,
        html_url: data.html_url,
      });
    }
    return JSON.stringify({
      name: data.name,
      path: data.path,
      type: data.type,
      size: data.size,
    });
  },
});

/** Create or update a file in a repository via a commit. */
export const create_or_update_file = defineTool({
  description: `Create or update a file in a repository. The content is provided as plain text and will be base64-encoded automatically. For updates, you must provide the current file's SHA (get it from get_file_content). Returns the file path, new SHA, URL, and commit SHA.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    path: z.string().describe("File path"),
    content: z.string().describe("File content (plain text, will be base64-encoded)"),
    message: z.string().describe("Commit message"),
    branch: z.string().exactOptional().describe("Branch (defaults to default branch)"),
    sha: z
      .string()
      .exactOptional()
      .describe("SHA of the file being replaced (required for update)"),
  }),
  execute: async ({ repo, content, ...fields }) => {
    const { data } = await octokit().rest.repos.createOrUpdateFileContents({
      owner: env.GITHUB_ORG,
      repo,
      content: Buffer.from(content).toString("base64"),
      ...fields,
    });
    return JSON.stringify({
      path: data.content?.path,
      sha: data.content?.sha,
      html_url: data.content?.html_url,
      commit_sha: data.commit.sha,
    });
  },
});

/** Delete a file from a repository via a commit. */
export const delete_file = defineTool({
  description: `Delete a file from a repository by creating a commit that removes it. Requires the file's current SHA (get it from get_file_content).`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    path: z.string().describe("File path to delete"),
    message: z.string().describe("Commit message"),
    sha: z.string().describe("SHA of the file to delete"),
    branch: z.string().exactOptional(),
  }),
  execute: async ({ repo, ...fields }) => {
    await octokit().rest.repos.deleteFile({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({ deleted: true, path: fields.path });
  },
});

/** Get the full recursive directory tree of a repository. */
export const get_directory_tree = defineTool({
  description: `Get the full recursive directory tree of a repository. Returns all file and directory paths with their types and sizes. Useful for understanding project structure. May be truncated for very large repos.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    tree_sha: z.string().optional().describe("Tree SHA or branch name (defaults to HEAD)"),
  }),
  execute: async ({ repo, tree_sha }) => {
    const sha = tree_sha ?? "HEAD";
    const { data } = await octokit().rest.git.getTree({
      owner: env.GITHUB_ORG,
      repo,
      tree_sha: sha,
      recursive: "1",
    });
    return JSON.stringify({
      sha: data.sha,
      truncated: data.truncated,
      tree: data.tree.map((t) => ({
        path: t.path,
        type: t.type,
        size: t.size,
      })),
    });
  },
});

/** List commits for a repository or specific file path. */
export const list_commits = defineTool({
  description: `List commits for a repository, optionally filtered by branch, file path, or date range. Returns abbreviated SHA, message, author, date, and URL for each commit.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    sha: z.string().exactOptional().describe("Branch or SHA to list from"),
    path: z.string().exactOptional().describe("Filter to commits affecting this path"),
    since: isoDateOrDateTime
      .exactOptional()
      .describe("ISO 8601 date or timestamp — inclusive lower bound"),
    until: isoDateOrDateTime
      .exactOptional()
      .describe("ISO 8601 date or timestamp — inclusive upper bound"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, per_page, page, ...filters }) => {
    const { data } = await octokit().rest.repos.listCommits({
      owner: env.GITHUB_ORG,
      repo,
      ...filters,
      per_page: per_page ?? 20,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message,
        author: c.commit.author?.name,
        date: c.commit.author?.date,
        html_url: c.html_url,
      })),
    );
  },
});

/** Get details for a single commit including changed files. */
export const get_commit = defineTool({
  description: `Get full details for a single commit, including message, author, date, stats (additions/deletions), and a list of changed files with their status and line counts.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    ref: z.string().describe("Commit SHA, branch, or tag"),
  }),
  execute: async ({ repo, ref }) => {
    const { data } = await octokit().rest.repos.getCommit({
      owner: env.GITHUB_ORG,
      repo,
      ref,
    });
    return JSON.stringify({
      sha: data.sha,
      message: data.commit.message,
      author: data.commit.author?.name,
      date: data.commit.author?.date,
      html_url: data.html_url,
      stats: data.stats,
      files: data.files?.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    });
  },
});

/** Compare two commits, branches, or tags. */
export const compare_commits = defineTool({
  description: `Compare two commits, branches, or tags. Returns the comparison status (ahead/behind/diverged), commit count, a list of commits between them, and changed files with their diffs. Useful for understanding what changed between releases or branches.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    base: z.string().describe("Base ref (branch, tag, or SHA)"),
    head: z.string().describe("Head ref (branch, tag, or SHA)"),
  }),
  execute: async ({ repo, base, head }) => {
    const { data } = await octokit().rest.repos.compareCommitsWithBasehead({
      owner: env.GITHUB_ORG,
      repo,
      basehead: `${base}...${head}`,
    });
    return JSON.stringify({
      status: data.status,
      ahead_by: data.ahead_by,
      behind_by: data.behind_by,
      total_commits: data.total_commits,
      html_url: data.html_url,
      commits: data.commits.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message,
        author: c.commit.author?.name,
      })),
      files: data.files?.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    });
  },
});
