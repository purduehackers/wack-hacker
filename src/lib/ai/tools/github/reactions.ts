import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../env.ts";
import { approval } from "../../approvals/index.ts";
import { octokit } from "./client.ts";

const reactionSchema = z
  .enum(["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"])
  .describe("Reaction emoji");

export const add_issue_reaction = tool({
  description: "Add a reaction emoji to an issue. Returns the reaction ID for later removal.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    issue_number: z.number().describe("Issue number"),
    content: reactionSchema,
  }),
  execute: async ({ repo, issue_number, content }) => {
    const { data } = await octokit.rest.reactions.createForIssue({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
      content,
    });
    return JSON.stringify({ id: data.id, content: data.content });
  },
});

export const remove_issue_reaction = approval(
  tool({
    description: "Remove a reaction from an issue by reaction ID.",
    inputSchema: z.object({
      repo: z.string().describe("Repository name"),
      issue_number: z.number().describe("Issue number"),
      reaction_id: z.number().describe("Reaction ID (from add_issue_reaction)"),
    }),
    execute: async ({ repo, issue_number, reaction_id }) => {
      await octokit.rest.reactions.deleteForIssue({
        owner: env.GITHUB_ORG,
        repo,
        issue_number,
        reaction_id,
      });
      return JSON.stringify({ removed: true });
    },
  }),
);

export const add_comment_reaction = tool({
  description: "Add a reaction to an issue or PR comment.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    comment_id: z.number().describe("Comment ID"),
    content: reactionSchema,
  }),
  execute: async ({ repo, comment_id, content }) => {
    const { data } = await octokit.rest.reactions.createForIssueComment({
      owner: env.GITHUB_ORG,
      repo,
      comment_id,
      content,
    });
    return JSON.stringify({ id: data.id, content: data.content });
  },
});

export const remove_comment_reaction = approval(
  tool({
    description: "Remove a reaction from an issue or PR comment by reaction ID.",
    inputSchema: z.object({
      repo: z.string().describe("Repository name"),
      comment_id: z.number().describe("Comment ID"),
      reaction_id: z.number().describe("Reaction ID"),
    }),
    execute: async ({ repo, comment_id, reaction_id }) => {
      await octokit.rest.reactions.deleteForIssueComment({
        owner: env.GITHUB_ORG,
        repo,
        comment_id,
        reaction_id,
      });
      return JSON.stringify({ removed: true });
    },
  }),
);
