import { tool } from "ai";
import { z } from "zod";

import { linear } from "../client";

const json = JSON.stringify;

export const create_project = tool({
  description:
    "Create a project. Requires name and at least one teamId. Supports lead, members, dates, priority, and Markdown content.",
  inputSchema: z.object({
    name: z.string(),
    teamIds: z.array(z.string()),
    description: z.string().optional(),
    content: z.string().optional().describe("Markdown body"),
    leadId: z.string().optional(),
    memberIds: z.array(z.string()).optional(),
    targetDate: z.string().optional().describe("ISO date"),
    startDate: z.string().optional().describe("ISO date"),
    priority: z.number().optional().describe("0=None, 1=Urgent, 2=High, 3=Normal, 4=Low"),
  }),
  execute: async (input) => {
    const payload = await linear.createProject(input);
    const project = await payload.project;
    if (!project) return "Failed to create project";
    return json({ id: project.id, name: project.name, url: project.url });
  },
});

export const update_project = tool({
  description:
    "Update a project by ID. Only include fields to change — omitted fields are left unchanged.",
  inputSchema: z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    content: z.string().optional().describe("Markdown body"),
    leadId: z.string().optional(),
    memberIds: z.array(z.string()).optional(),
    targetDate: z.string().optional().describe("ISO date"),
    startDate: z.string().optional().describe("ISO date"),
    priority: z.number().optional().describe("0=None, 1=Urgent, 2=High, 3=Normal, 4=Low"),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateProject(id, input);
    const project = await payload.project;
    if (!project) return "Failed to update project";
    return json({ id: project.id, name: project.name, url: project.url });
  },
});

export const create_project_milestone = tool({
  description:
    "Create a milestone inside a project. Milestones mark key deliverables within a project timeline.",
  inputSchema: z.object({
    projectId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    targetDate: z.string().optional().describe("ISO date"),
  }),
  execute: async (input) => {
    const payload = await linear.createProjectMilestone(input);
    const milestone = await payload.projectMilestone;
    if (!milestone) return "Failed to create milestone";
    return json({ id: milestone.id, name: milestone.name });
  },
});

export const update_project_milestone = tool({
  description: "Update a project milestone.",
  inputSchema: z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    targetDate: z.string().optional().describe("ISO date"),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateProjectMilestone(id, input);
    const milestone = await payload.projectMilestone;
    if (!milestone) return "Failed to update milestone";
    return json({ id: milestone.id, name: milestone.name });
  },
});

export const query_project_activity = tool({
  description:
    "Fetch a project's change history, status updates, and comments. Use for 'what happened on project X' questions.",
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const project = await linear.project(id);
    const [history, updates, comments] = await Promise.all([
      project.history(),
      project.projectUpdates(),
      project.comments(),
    ]);
    return json({
      history: history.nodes.map((h) => ({ id: h.id, createdAt: h.createdAt })),
      updates: updates.nodes.map((u) => ({
        id: u.id,
        health: u.health,
        createdAt: u.createdAt,
        url: u.url,
      })),
      comments: comments.nodes.map((c) => ({
        id: c.id,
        body: c.body?.slice(0, 500),
        createdAt: c.createdAt,
        url: c.url,
      })),
    });
  },
});
