import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { linear } from "./client.ts";
import { sdkInput } from "./sdk-input.ts";

export const create_project = defineTool({
  description:
    "Create a project. Requires name and at least one teamId. Supports lead, members, dates, priority, and Markdown content.",
  access: { risk: "write" },
  input: z.object({
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
    const payload = await linear.createProject(
      sdkInput<Parameters<typeof linear.createProject>[0]>(input),
    );
    const project = await payload.project;
    if (!project) return "Failed to create project";
    return JSON.stringify({ id: project.id, name: project.name, url: project.url });
  },
});

export const update_project = defineTool({
  description:
    "Update a project by ID. Only include fields to change — omitted fields are left unchanged.",
  access: { risk: "write" },
  input: z.object({
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
    const payload = await linear.updateProject(
      id,
      sdkInput<Parameters<typeof linear.updateProject>[1]>(input),
    );
    const project = await payload.project;
    if (!project) return "Failed to update project";
    return JSON.stringify({ id: project.id, name: project.name, url: project.url });
  },
});

export const create_project_milestone = defineTool({
  description:
    "Create a milestone inside a project. Milestones mark key deliverables within a project timeline.",
  access: { risk: "write" },
  input: z.object({
    projectId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    targetDate: z.string().optional().describe("ISO date"),
  }),
  execute: async (input) => {
    const payload = await linear.createProjectMilestone(
      sdkInput<Parameters<typeof linear.createProjectMilestone>[0]>(input),
    );
    const milestone = await payload.projectMilestone;
    if (!milestone) return "Failed to create milestone";
    return JSON.stringify({ id: milestone.id, name: milestone.name });
  },
});

export const update_project_milestone = defineTool({
  description: "Update a project milestone.",
  access: { risk: "write" },
  input: z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    targetDate: z.string().optional().describe("ISO date"),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateProjectMilestone(
      id,
      sdkInput<Parameters<typeof linear.updateProjectMilestone>[1]>(input),
    );
    const milestone = await payload.projectMilestone;
    if (!milestone) return "Failed to update milestone";
    return JSON.stringify({ id: milestone.id, name: milestone.name });
  },
});

export const get_project = defineTool({
  description:
    "Get a single project's details by ID — name, status, description, progress, lead, target/start dates, and URL.",
  access: { risk: "read" },
  input: z.object({ id: z.string().describe("Project UUID") }),
  execute: async ({ id }) => {
    const project = await linear.project(id);
    return JSON.stringify({
      id: project.id,
      name: project.name,
      description: project.description,
      state: project.state,
      progress: project.progress,
      startDate: project.startDate,
      targetDate: project.targetDate,
      url: project.url,
    });
  },
});

export const archive_project = defineTool({
  description:
    "Archive a project. Archived projects are hidden from default views but preserved. Prefer this over delete_project.",
  access: { risk: "destructive" },
  input: z.object({ id: z.string().describe("Project UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.archiveProject(id);
    return JSON.stringify({ success: payload.success });
  },
});

export const unarchive_project = defineTool({
  description: "Restore an archived project.",
  access: { risk: "write" },
  input: z.object({ id: z.string().describe("Project UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.unarchiveProject(id);
    return JSON.stringify({ success: payload.success });
  },
});

export const delete_project = defineTool({
  description: "Permanently delete a project. Irreversible — prefer archive_project.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.object({ id: z.string().describe("Project UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.deleteProject(id);
    return JSON.stringify({ success: payload.success });
  },
});

export const query_project_activity = defineTool({
  description:
    "Fetch a project's change history, status updates, and comments. Use for 'what happened on project X' questions.",
  access: { risk: "read" },
  input: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const project = await linear.project(id);
    const [history, updates, comments] = await Promise.all([
      project.history(),
      project.projectUpdates(),
      project.comments(),
    ]);
    return JSON.stringify({
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
