import {
  InitiativeStatus,
  InitiativeUpdateHealthType,
  ProjectUpdateHealthType,
  UserRoleType,
} from "@linear/sdk";
import { z } from "zod";

/**
 * Input fields, enums and response sentinels shared across this domain's tools.
 *
 * Anything more than one tool file needs lives here rather than in copies. The
 * issue field set alone feeds two write tools. A field that drifts between
 * create and update is a bug the type system cannot see.
 */

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
 * Linear renders label colors from a six-digit hex triple. The regex spells out
 * the case-insensitive class rather than carrying an `i` flag, because
 * `z.toJSONSchema` emits `RegExp.source` and drops flags. A lowercase-only
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

/** Health on a project update. Distinct from the initiative-update enum. */
export const projectUpdateHealth = z.enum(ProjectUpdateHealthType).exactOptional();

/** Health on an initiative update. Distinct from the project-update enum. */
export const initiativeUpdateHealth = z.enum(InitiativeUpdateHealthType).exactOptional();

export const initiativeStatus = z.enum(InitiativeStatus);

/**
 * The invite roles this domain offers, mapped to Linear's enum. "member" is
 * Linear's `User`, and the rename is deliberate: nobody asks to invite someone
 * as a "user".
 */
export const INVITE_ROLE: Record<"admin" | "member" | "guest", UserRoleType> = {
  admin: UserRoleType.Admin,
  member: UserRoleType.User,
  guest: UserRoleType.Guest,
};

/**
 * Value the label projections report for a workspace-wide label, which has no
 * team. Every label in a list keeps the same key set so the model can compare
 * rows. "No team" therefore has to serialize as an explicit null rather than a
 * missing key. One named sentinel keeps the label tools under the no-null
 * rule.
 */
// oxlint-disable-next-line unicorn/no-null -- serialized label rows keep a stable key set, so an unscoped label is an explicit null
export const NO_TEAM = null;
