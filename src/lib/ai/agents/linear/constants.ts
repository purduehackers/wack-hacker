import { z } from "zod";

export const issueRelationSchema = z
  .array(
    z.object({
      issueId: z.string().describe("Issue identifier (e.g. TEAM-123) or UUID"),
      type: z.enum([
        "isBlocking",
        "isBlockedBy",
        "isRelatedTo",
        "isDuplicateOf",
        "isDuplicatedBy",
        "unrelatedTo",
      ]),
    }),
  )
  .optional()
  .describe("Relations to add or remove");

export const issueFields = {
  title: z.string().optional(),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
  stateId: z.string().optional(),
  priority: z.number().optional().describe("0=None, 1=Urgent, 2=High, 3=Normal, 4=Low"),
  projectId: z.string().optional(),
  projectMilestoneId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  dueDate: z.string().optional().describe("ISO date YYYY-MM-DD"),
  cycleId: z.string().optional(),
  parentId: z.string().optional().describe("Parent issue ID for sub-issues"),
};

export const healthSchema = z.enum(["onTrack", "atRisk", "offTrack"]).optional();
