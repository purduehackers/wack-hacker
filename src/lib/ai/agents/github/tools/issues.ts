import { tool } from "ai";
import { z } from "zod";

import { octokit } from "../client";
import { ORG } from "../constants";

/** Create a new issue in a repository. */
export const create_issue = tool({
  description: `Create a new issue in a repository. Supports Markdown body, assignees, labels, and milestone. Returns the issue number, title, URL, and state.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    title: z.string().describe("Issue title"),
    body: z.string().optional().describe("Issue body (Markdown)"),
    assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
    labels: z.array(z.string()).optional().describe("Label names to apply"),
    milestone: z.number().optional().describe("Milestone number"),
  }),
  execute: async ({ repo, ...input }) => {
    const { data } = await octokit.rest.issues.create({
      owner: ORG,
      repo,
      ...input,
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
export const update_issue = tool({
  description: `Update an existing issue. Can change its title, body, state (open/closed), assignees, labels, or milestone. Returns the updated issue summary.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    issue_number: z.number().describe("Issue number"),
    title: z.string().optional(),
    body: z.string().optional(),
    state: z.enum(["open", "closed"]).optional(),
    assignees: z.array(z.string()).optional(),
    labels: z.array(z.string()).optional(),
    milestone: z.number().nullable().optional(),
  }),
  execute: async ({ repo, issue_number, ...input }) => {
    const { data } = await octokit.rest.issues.update({
      owner: ORG,
      repo,
      issue_number,
      ...input,
    });
    return JSON.stringify({
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
    });
  },
});

/** List comments on an issue with pagination. */
export const list_issue_comments = tool({
  description: `List comments on an issue. Returns each comment's ID, body, author, timestamps, and URL. Useful for understanding discussion history.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    issue_number: z.number().describe("Issue number"),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ repo, issue_number, per_page, page }) => {
    const { data } = await octokit.rest.issues.listComments({
      owner: ORG,
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
export const create_issue_comment = tool({
  description: `Add a new comment to an issue. Supports Markdown. Returns the comment ID and URL.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    issue_number: z.number().describe("Issue number"),
    body: z.string().describe("Comment body (Markdown)"),
  }),
  execute: async ({ repo, issue_number, body }) => {
    const { data } = await octokit.rest.issues.createComment({
      owner: ORG,
      repo,
      issue_number,
      body,
    });
    return JSON.stringify({ id: data.id, html_url: data.html_url });
  },
});

/** Edit an existing issue comment. */
export const update_issue_comment = tool({
  description: `Edit an existing issue comment by its ID. Replaces the entire body with the new Markdown content. Returns the comment ID and URL.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    comment_id: z.number().describe("Comment ID"),
    body: z.string().describe("New comment body (Markdown)"),
  }),
  execute: async ({ repo, comment_id, body }) => {
    const { data } = await octokit.rest.issues.updateComment({
      owner: ORG,
      repo,
      comment_id,
      body,
    });
    return JSON.stringify({ id: data.id, html_url: data.html_url });
  },
});

/** Delete an issue comment. */
export const delete_issue_comment = tool({
  description: `Permanently delete an issue comment by its ID. This action cannot be undone.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    comment_id: z.number().describe("Comment ID"),
  }),
  execute: async ({ repo, comment_id }) => {
    await octokit.rest.issues.deleteComment({
      owner: ORG,
      repo,
      comment_id,
    });
    return JSON.stringify({ deleted: true });
  },
});

/** Create, update, or delete a label in a repository. */
export const manage_labels = tool({
  description: `Create, update, or delete a label in a repository. For 'create' and 'update', you can set name, color (hex without #), and description. For 'update', use new_name to rename. Returns the label name and color on success.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    action: z.enum(["create", "update", "delete"]),
    name: z.string().describe("Label name"),
    new_name: z.string().optional().describe("New name (for update)"),
    color: z.string().optional().describe("Hex color without # (e.g. 'ff0000')"),
    description: z.string().optional(),
  }),
  execute: async ({ repo, action, name, new_name, color, description }) => {
    switch (action) {
      case "create": {
        const { data } = await octokit.rest.issues.createLabel({
          owner: ORG,
          repo,
          name,
          color,
          description,
        });
        return JSON.stringify({ name: data.name, color: data.color });
      }
      case "update": {
        const { data } = await octokit.rest.issues.updateLabel({
          owner: ORG,
          repo,
          name,
          new_name,
          color,
          description,
        });
        return JSON.stringify({ name: data.name, color: data.color });
      }
      case "delete":
        await octokit.rest.issues.deleteLabel({ owner: ORG, repo, name });
        return JSON.stringify({ deleted: true, name });
    }
  },
});

/** Create, update, or delete a milestone in a repository. */
export const manage_milestones = tool({
  description: `Create, update, or delete a milestone in a repository. For 'create', title is required. For 'update' and 'delete', milestone_number is required. Supports setting description, state, and due date.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    action: z.enum(["create", "update", "delete"]),
    milestone_number: z.number().optional().describe("Milestone number (for update/delete)"),
    title: z.string().optional().describe("Title (for create/update)"),
    description: z.string().optional(),
    state: z.enum(["open", "closed"]).optional(),
    due_on: z.string().optional().describe("Due date ISO 8601 (e.g. '2025-12-31T00:00:00Z')"),
  }),
  execute: async ({ repo, action, milestone_number, ...input }) => {
    switch (action) {
      case "create": {
        const { data } = await octokit.rest.issues.createMilestone({
          owner: ORG,
          repo,
          title: input.title!,
          description: input.description,
          state: input.state,
          due_on: input.due_on,
        });
        return JSON.stringify({ number: data.number, title: data.title, html_url: data.html_url });
      }
      case "update": {
        const { data } = await octokit.rest.issues.updateMilestone({
          owner: ORG,
          repo,
          milestone_number: milestone_number!,
          title: input.title,
          description: input.description,
          state: input.state,
          due_on: input.due_on,
        });
        return JSON.stringify({ number: data.number, title: data.title, html_url: data.html_url });
      }
      case "delete":
        await octokit.rest.issues.deleteMilestone({
          owner: ORG,
          repo,
          milestone_number: milestone_number!,
        });
        return JSON.stringify({ deleted: true });
    }
  },
});
