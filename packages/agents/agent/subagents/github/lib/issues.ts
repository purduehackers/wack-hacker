import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit } from "./client.ts";
import { env } from "./config.ts";
import { isoDateOrDateTime, paginationInputShape, repoField, resourceId } from "./constants.ts";

const issueNumber = resourceId.describe("Issue number");
const commentId = resourceId.describe("Comment ID");

/** Create a new issue in a repository. */
export const create_issue = defineTool({
  description: `Create a new issue in a repository. Supports Markdown body, assignees, labels, and milestone. Returns the issue number, title, URL, and state.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    title: z.string().describe("Issue title"),
    body: z.string().exactOptional().describe("Issue body (Markdown)"),
    assignees: z.array(z.string()).exactOptional().describe("GitHub usernames to assign"),
    labels: z.array(z.string()).exactOptional().describe("Label names to apply"),
    milestone: resourceId.exactOptional().describe("Milestone number"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.issues.create({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
    });
  },
});

/** Update an existing issue's title, body, state, assignees, labels, or milestone. */
export const update_issue = defineTool({
  description: `Update an existing issue. Can change its title, body, state (open/closed), assignees, labels, or milestone. Returns the updated issue summary.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    issue_number: issueNumber,
    title: z.string().exactOptional(),
    body: z.string().exactOptional(),
    state: z.enum(["open", "closed"]).exactOptional(),
    assignees: z.array(z.string()).exactOptional(),
    labels: z.array(z.string()).exactOptional(),
    milestone: resourceId.nullable().exactOptional().describe("Milestone number; null clears it"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.issues.update({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
    });
  },
});

/** Lock an issue's conversation. */
export const lock_issue = defineTool({
  description:
    "Lock the conversation on an issue or PR so only collaborators can comment. Useful for derailed threads.",
  access: { risk: "write", confirm: "self" },
  input: z.strictObject({
    repo: repoField,
    issue_number: resourceId.describe("Issue or PR number"),
    lock_reason: z
      .enum(["off-topic", "too heated", "resolved", "spam"])
      .exactOptional()
      .describe("Reason for locking"),
  }),
  execute: async ({ repo, ...fields }) => {
    await octokit().rest.issues.lock({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({ locked: true, issue_number: fields.issue_number });
  },
});

/** Unlock an issue's conversation. */
export const unlock_issue = defineTool({
  description: "Unlock a previously locked issue or PR conversation.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    issue_number: resourceId.describe("Issue or PR number"),
  }),
  execute: async ({ repo, issue_number }) => {
    await octokit().rest.issues.unlock({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
    });
    return JSON.stringify({ unlocked: true, issue_number });
  },
});

/** Add assignees to an issue or PR. */
export const add_assignees = defineTool({
  description: "Add assignees to an issue or PR. Up to 10 assignees.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    issue_number: resourceId.describe("Issue or PR number"),
    assignees: z.array(z.string()).min(1).max(10).describe("GitHub usernames to assign"),
  }),
  execute: async ({ repo, issue_number, assignees }) => {
    const { data } = await octokit().rest.issues.addAssignees({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
      assignees,
    });
    return JSON.stringify({
      number: data.number,
      assignees: data.assignees?.map((a) => a.login),
    });
  },
});

/** Remove assignees from an issue or PR. */
export const remove_assignees = defineTool({
  description: "Remove assignees from an issue or PR.",
  access: { risk: "write", confirm: "self" },
  input: z.strictObject({
    repo: repoField,
    issue_number: resourceId.describe("Issue or PR number"),
    assignees: z.array(z.string()).min(1).describe("GitHub usernames to unassign"),
  }),
  execute: async ({ repo, issue_number, assignees }) => {
    const { data } = await octokit().rest.issues.removeAssignees({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
      assignees,
    });
    return JSON.stringify({
      number: data.number,
      assignees: data.assignees?.map((a) => a.login),
    });
  },
});

/** List comments on an issue with pagination. */
export const list_issue_comments = defineTool({
  description: `List comments on an issue. Returns each comment's ID, body, author, timestamps, and URL. Useful for understanding discussion history.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    issue_number: issueNumber,
    ...paginationInputShape,
  }),
  execute: async ({ repo, issue_number, per_page, page }) => {
    const { data } = await octokit().rest.issues.listComments({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((c) => ({
        id: c.id,
        body: c.body,
        user: c.user?.login,
        created_at: c.created_at,
        updated_at: c.updated_at,
        html_url: c.html_url,
      })),
    );
  },
});

/** Add a comment to an issue. */
export const create_issue_comment = defineTool({
  description: `Add a new comment to an issue. Supports Markdown. Returns the comment ID and URL.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    issue_number: issueNumber,
    body: z.string().describe("Comment body (Markdown)"),
  }),
  execute: async ({ repo, issue_number, body }) => {
    const { data } = await octokit().rest.issues.createComment({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
      body,
    });
    return JSON.stringify({ id: data.id, html_url: data.html_url });
  },
});

/** Edit an existing issue comment. */
export const update_issue_comment = defineTool({
  description: `Edit an existing issue comment by its ID. Replaces the entire body with the new Markdown content. Returns the comment ID and URL.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    comment_id: commentId,
    body: z.string().describe("New comment body (Markdown)"),
  }),
  execute: async ({ repo, comment_id, body }) => {
    const { data } = await octokit().rest.issues.updateComment({
      owner: env.GITHUB_ORG,
      repo,
      comment_id,
      body,
    });
    return JSON.stringify({ id: data.id, html_url: data.html_url });
  },
});

/** Delete an issue comment. */
export const delete_issue_comment = defineTool({
  description: `Permanently delete an issue comment by its ID. This action cannot be undone.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    comment_id: commentId,
  }),
  execute: async ({ repo, comment_id }) => {
    await octokit().rest.issues.deleteComment({
      owner: env.GITHUB_ORG,
      repo,
      comment_id,
    });
    return JSON.stringify({ deleted: true });
  },
});

/** Create, update, or delete a label in a repository. */
export const manage_labels = defineTool({
  description: `Create, update, or delete a label in a repository. For 'create' and 'update', you can set name, color (hex without #), and description. For 'update', use new_name to rename. Returns the label name and color on success.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    action: z.enum(["create", "update", "delete"]),
    name: z.string().describe("Label name"),
    new_name: z.string().exactOptional().describe("New name (for update)"),
    color: z
      .stringFormat("github-label-color", /^[0-9A-Fa-f]{6}$/u)
      .exactOptional()
      .describe("Hex color without # (e.g. 'ff0000')"),
    description: z.string().exactOptional(),
  }),
  execute: async ({ repo, action, name, new_name, ...fields }) => {
    switch (action) {
      case "create": {
        const { data } = await octokit().rest.issues.createLabel({
          owner: env.GITHUB_ORG,
          repo,
          name,
          ...fields,
        });
        return JSON.stringify({ name: data.name, color: data.color });
      }
      case "update": {
        const { data } = await octokit().rest.issues.updateLabel({
          owner: env.GITHUB_ORG,
          repo,
          name,
          ...(new_name === undefined ? {} : { new_name }),
          ...fields,
        });
        return JSON.stringify({ name: data.name, color: data.color });
      }
      case "delete":
        await octokit().rest.issues.deleteLabel({
          owner: env.GITHUB_ORG,
          repo,
          name,
        });
        return JSON.stringify({ deleted: true, name });
    }
  },
});

/** Create, update, or delete a milestone in a repository. */
export const manage_milestones = defineTool({
  description: `Create, update, or delete a milestone in a repository. For 'create', title is required. For 'update' and 'delete', milestone_number is required. Supports setting description, state, and due date.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    action: z.enum(["create", "update", "delete"]),
    milestone_number: resourceId.exactOptional().describe("Milestone number (for update/delete)"),
    title: z.string().exactOptional().describe("Title (for create/update)"),
    description: z.string().exactOptional(),
    state: z.enum(["open", "closed"]).exactOptional(),
    due_on: isoDateOrDateTime
      .exactOptional()
      .describe("Due date, ISO 8601 (e.g. '2025-12-31T00:00:00Z')"),
  }),
  execute: async ({ repo, action, milestone_number, ...fields }) => {
    switch (action) {
      case "create": {
        const { title, ...rest } = fields;
        if (title === undefined) return "title is required when creating a milestone";
        const { data } = await octokit().rest.issues.createMilestone({
          owner: env.GITHUB_ORG,
          repo,
          title,
          ...rest,
        });
        return JSON.stringify({
          number: data.number,
          title: data.title,
          html_url: data.html_url,
        });
      }
      case "update": {
        if (milestone_number === undefined) {
          return "milestone_number is required when updating a milestone";
        }
        const { data } = await octokit().rest.issues.updateMilestone({
          owner: env.GITHUB_ORG,
          repo,
          milestone_number,
          ...fields,
        });
        return JSON.stringify({
          number: data.number,
          title: data.title,
          html_url: data.html_url,
        });
      }
      case "delete":
        if (milestone_number === undefined) {
          return "milestone_number is required when deleting a milestone";
        }
        await octokit().rest.issues.deleteMilestone({
          owner: env.GITHUB_ORG,
          repo,
          milestone_number,
        });
        return JSON.stringify({ deleted: true });
    }
  },
});
