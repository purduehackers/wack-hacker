import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../../env";
import { octokit } from "../client";

/** Get the content of a file or list a directory in a repository. */
export const get_file_content = tool({
  description: `Get the content of a file or list entries in a directory. For files, returns the decoded content (truncated at 50k chars), SHA, and URL. For directories, returns a list of entries with name, path, type, and size. Use the 'ref' param to read from a specific branch or tag.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File or directory path"),
    ref: z.string().optional().describe("Branch/tag/SHA (defaults to default branch)"),
  }),
  execute: async ({ repo, path, ref }) => {
    const { data } = await octokit.rest.repos.getContent({
      owner: env.GITHUB_ORG,
      repo,
      path,
      ref,
    });
    if (Array.isArray(data)) {
      return JSON.stringify(
        data.map((f) => ({ name: f.name, path: f.path, type: f.type, size: f.size })),
      );
    }
    if (data.type === "file" && "content" in data) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return JSON.stringify({
        name: data.name,
        path: data.path,
        size: data.size,
        sha: data.sha,
        content: content.length > 50000 ? content.slice(0, 50000) + "\n...(truncated)" : content,
        html_url: data.html_url,
      });
    }
    return JSON.stringify({ name: data.name, path: data.path, type: data.type, size: data.size });
  },
});

/** Create or update a file in a repository via a commit. */
export const create_or_update_file = tool({
  description: `Create or update a file in a repository. The content is provided as plain text and will be base64-encoded automatically. For updates, you must provide the current file's SHA (get it from get_file_content). Returns the file path, new SHA, URL, and commit SHA.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path"),
    content: z.string().describe("File content (plain text, will be base64-encoded)"),
    message: z.string().describe("Commit message"),
    branch: z.string().optional().describe("Branch (defaults to default branch)"),
    sha: z.string().optional().describe("SHA of the file being replaced (required for update)"),
  }),
  execute: async ({ repo, path, content, message, branch, sha }) => {
    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner: env.GITHUB_ORG,
      repo,
      path,
      message,
      content: Buffer.from(content).toString("base64"),
      branch,
      sha,
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
export const delete_file = tool({
  description: `Delete a file from a repository by creating a commit that removes it. Requires the file's current SHA (get it from get_file_content).`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path to delete"),
    message: z.string().describe("Commit message"),
    sha: z.string().describe("SHA of the file to delete"),
    branch: z.string().optional(),
  }),
  execute: async ({ repo, path, message, sha, branch }) => {
    await octokit.rest.repos.deleteFile({
      owner: env.GITHUB_ORG,
      repo,
      path,
      message,
      sha,
      branch,
    });
    return JSON.stringify({ deleted: true, path });
  },
});

/** Get the full recursive directory tree of a repository. */
export const get_directory_tree = tool({
  description: `Get the full recursive directory tree of a repository. Returns all file and directory paths with their types and sizes. Useful for understanding project structure. May be truncated for very large repos.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    tree_sha: z.string().optional().describe("Tree SHA or branch name (defaults to HEAD)"),
  }),
  execute: async ({ repo, tree_sha }) => {
    const sha = tree_sha ?? "HEAD";
    const { data } = await octokit.rest.git.getTree({
      owner: env.GITHUB_ORG,
      repo,
      tree_sha: sha,
      recursive: "1",
    });
    return JSON.stringify({
      sha: data.sha,
      truncated: data.truncated,
      tree: data.tree.map((t) => ({ path: t.path, type: t.type, size: t.size })),
    });
  },
});

/** List commits for a repository or specific file path. */
export const list_commits = tool({
  description: `List commits for a repository, optionally filtered by branch, file path, or date range. Returns abbreviated SHA, message, author, date, and URL for each commit.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    sha: z.string().optional().describe("Branch or SHA to list from"),
    path: z.string().optional().describe("Filter to commits affecting this path"),
    since: z.string().optional().describe("ISO 8601 date to filter from"),
    until: z.string().optional().describe("ISO 8601 date to filter to"),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ repo, ...opts }) => {
    const { data } = await octokit.rest.repos.listCommits({
      owner: env.GITHUB_ORG,
      repo,
      sha: opts.sha,
      path: opts.path,
      since: opts.since,
      until: opts.until,
      per_page: opts.per_page ?? 20,
      page: opts.page ?? 1,
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
export const get_commit = tool({
  description: `Get full details for a single commit, including message, author, date, stats (additions/deletions), and a list of changed files with their status and line counts.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    ref: z.string().describe("Commit SHA, branch, or tag"),
  }),
  execute: async ({ repo, ref }) => {
    const { data } = await octokit.rest.repos.getCommit({
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
export const compare_commits = tool({
  description: `Compare two commits, branches, or tags. Returns the comparison status (ahead/behind/diverged), commit count, a list of commits between them, and changed files with their diffs. Useful for understanding what changed between releases or branches.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    base: z.string().describe("Base ref (branch, tag, or SHA)"),
    head: z.string().describe("Head ref (branch, tag, or SHA)"),
  }),
  execute: async ({ repo, base, head }) => {
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
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
