import { z } from "zod";

export const issueRelationSchema = z
  .array(
    z.strictObject({
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

export type IssueRelation = NonNullable<z.output<typeof issueRelationSchema>>[number];

/**
 * Linear renders label colors from a six-digit hex triple. The case-insensitive
 * class is spelled out rather than carried on an `i` flag because
 * `z.toJSONSchema` emits `RegExp.source` and drops flags — a lowercase-only
 * `pattern` would advertise a narrower field than this schema accepts.
 */
export const hexColor = z.stringFormat("hex-color", /^#[0-9a-fA-F]{6}$/u);

export const issueFields = {
  title: z.string().exactOptional(),
  description: z.string().exactOptional(),
  assigneeId: z.string().exactOptional(),
  stateId: z.string().exactOptional(),
  priority: z
    .literal([0, 1, 2, 3, 4])
    .exactOptional()
    .describe("0=None, 1=Urgent, 2=High, 3=Normal, 4=Low"),
  projectId: z.string().exactOptional(),
  projectMilestoneId: z.string().exactOptional(),
  labelIds: z.array(z.string()).exactOptional(),
  dueDate: z.iso.date().exactOptional().describe("ISO date YYYY-MM-DD"),
  cycleId: z.string().exactOptional(),
  parentId: z.string().exactOptional().describe("Parent issue ID for sub-issues"),
};
