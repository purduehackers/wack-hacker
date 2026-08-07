import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

export const LINEAR_SKILL_DEFINITIONS = [
  {
    name: "comments",
    description: "Post, edit, and delete comments on issues.",
    criteria: "Use when the user explicitly asks to comment on, reply to, or annotate an issue.",
    minRole: "organizer",
    tools: ["create_comment", "edit_comment", "delete_comment"],
    instructions:
      "<posting>\n- Only use comment tools when the user explicitly asks to comment.\n- Keep the comment body aligned to what the user asked.\n- Search for the target issue first via search_entities.\n</posting>\n\n<editing_deleting>\n\n- Editing/deleting typically only works for comments created earlier in this thread.\n- Only delete when explicitly asked.\n  </editing_deleting>\n\n<formatting>\n- Markdown supported: **bold**, _italic_, `code`, lists, code blocks.\n</formatting>",
  },
  {
    name: "customer-requests",
    description: "Create, update, list, and analyze customer requests.",
    criteria:
      "Use when the user wants to log, update, list, or analyze customer feedback/requests.",
    minRole: "organizer",
    tools: ["create_customer_need", "update_customer_need", "list_customer_needs"],
    instructions:
      'In Linear, customer requests are called "customer needs."\n\n<creating>\n- Must attach to an issue or project.\n- Capture the customer\'s ask in the body without "enhancing" it.\n- Importance: 0 (not important) or 1 (important).\n- Resolve customer via search_entities(entityType: "Customer").\n</creating>\n\n<updating>\n- Only change fields requested. Don\'t rewrite bodies opportunistically.\n</updating>\n\n<listing_analysis>\n\n- List by issue/project/customer; can filter by state.\n- For theme analysis, group themes clearly and reference specific requests as examples.\n  </listing_analysis>',
  },
  {
    name: "cycles",
    description: "List, create, update, and archive Linear cycles (sprints).",
    criteria:
      "Use when the user wants to manage Linear cycles — creating a new sprint, updating dates, or archiving an old cycle.",
    minRole: "organizer",
    tools: ["list_cycles", "get_cycle", "create_cycle", "update_cycle", "archive_cycle"],
    instructions:
      "- Cycles are per-team; always provide team_id on create.\n- Dates are ISO 8601 (e.g. '2026-05-01T00:00:00.000Z').\n- Linear does not support hard-deleting cycles — archive instead.\n- progress is a 0-1 completion ratio based on issue status.",
  },
  {
    name: "documents",
    description: "Create and update documents attached to a project, initiative, issue, or cycle.",
    criteria: "Use when the user wants to create or update a document.",
    minRole: "organizer",
    tools: ["create_document", "update_document"],
    instructions:
      "Documents attach to exactly one parent (project, initiative, issue, or cycle).\n\n<creating>\n- Preserve user-provided content verbatim unless asked to rewrite.\n- If parent isn't specified, ask rather than guessing.\n- Resolve parent entity ID via suggest_property_values or search_entities.\n</creating>\n\n<updating>\n- Apply the minimal requested edits. Don't \"refactor\" wording unless asked.\n- Can move to a different parent if requested.\n</updating>",
  },
  {
    name: "initiative-updates",
    description: "Query, create, and update initiative status updates.",
    criteria: "Use for cross-project status reporting on an initiative.",
    minRole: "organizer",
    tools: ["query_initiative_updates", "create_initiative_update", "update_initiative_update"],
    instructions:
      "<querying>\n- Pull prior updates to match tone and set reporting window.\n- Can include sub-initiative and related project updates.\n</querying>\n\n<drafting>\n- Unless asked to post immediately, draft first for review.\n- Lead with cross-cutting highlights (wins or risks).\n- Summarize meaningful movement across sub-initiatives/projects.\n- Call out key dependencies/risks and what's needed.\n</drafting>\n\n<health>\n- onTrack / atRisk / offTrack — same logic as project updates, applied across the portfolio.\n</health>",
  },
  {
    name: "initiatives",
    description: "Create/update initiatives; query initiative activity and history.",
    criteria: "Use when the user wants to create/update an initiative or inspect its history.",
    minRole: "organizer",
    tools: [
      "create_initiative",
      "update_initiative",
      "list_initiatives",
      "query_initiative_activity",
    ],
    instructions:
      'Initiatives group projects under strategic goals.\n\n<creating_updating>\n\n- Only set fields explicitly provided. Don\'t guess owner, target dates, or narrative content.\n- Status values: "Planned", "Active", "Completed".\n  </creating_updating>\n\n<activity>\n- Use history for "when did it become Active / who changed owner?"\n- Supports pagination and date ranges.\n</activity>',
  },
  {
    name: "issue-views",
    description: "Query and analyze issue views in list or insight mode, with filters.",
    criteria: 'Use for "show me issues matching X" or "count/break down issues by Y".',
    minRole: "organizer",
    tools: ["query_issue_view"],
    instructions:
      '<views>\nAvailable slices: user views (my issues, created, subscribed, recent activity), team views (triage/backlog/active/all), project/milestone, cycle, label, custom view.\n</views>\n\n<list_mode>\n\n- Paginated (limit/skip); orderable (manual/updated/created/priority).\n- Best for: "show me the issues", "top 10", "which ones are blocked?"\n  </list_mode>\n\n<insight_mode>\n\n- Best for: "how many", "break down by...", "trend over time".\n- Typical aggregations: count by assignee, priority, label, status, week.\n- Output: CSV (dimension,count).\n  </insight_mode>\n\n<filters>\n- Keep filters explicit and simple. Prefer single AND chains.\n- If multiple values for one field, express as alternatives on that field.\n</filters>',
  },
  {
    name: "issues",
    description: "Create, update, delete issues; query issue activity and history.",
    criteria:
      "Use when the user wants to create, update, delete, or inspect the history of a specific issue.",
    minRole: "organizer",
    tools: [
      "create_issue",
      "update_issue",
      "delete_issue",
      "archive_issue",
      "unarchive_issue",
      "query_issue_activity",
    ],
    instructions:
      '<creating>\n- Title: short, single-line, 6-12 words. Only backticks allowed as formatting.\n- Description: factual, self-contained. Only what\'s explicitly stated or strongly implied.\n- ALWAYS assign to the requesting user by default unless they explicitly name someone else or ask to leave it unassigned.\n- Resolve the requesting user via suggest_property_values (field: "Issue.assigneeId", query: nickname).\n- Status types: triage, backlog, unstarted, started, completed, canceled.\n- Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low.\n- Only set fields the user explicitly asked for or that are strongly implied.\n- Relationships: isBlocking, isBlockedBy, isRelatedTo, isDuplicateOf, isDuplicatedBy, unrelatedTo.\n</creating>\n\n<updating>\n- Update only fields the user asks for. Don\'t opportunistically "clean up" other fields.\n- Description replaces the entire description; preserve existing text when "adding" something.\n</updating>\n\n<deleting>\n- Only when explicitly asked. Only delete issues created by me earlier in this thread.\n- Prefer archive_issue over delete_issue — archive is reversible via unarchive_issue.\n</deleting>\n\n<activity>\n- Use "history" for who/when of field changes; "comments" for discussion context.\n- Supports pagination and date ranges.\n</activity>',
  },
  {
    name: "labels",
    description: "List, create, update, and delete Linear issue labels.",
    criteria:
      "Use when the user wants to manage Linear labels — creating, renaming, recoloring, or deleting them, or scoping labels to a team.",
    minRole: "organizer",
    tools: ["list_labels", "get_label", "create_label", "update_label", "delete_label"],
    instructions:
      "- Colors are hex with a leading '#' (e.g. '#FF0000').\n- Labels can be workspace-wide or team-scoped. Scope to a team by passing team_id on create.\n- delete_label removes the label from all issues — always confirm first.",
  },
  {
    name: "membership",
    description: "Invite new members to the Linear workspace or remove existing ones (admin only).",
    criteria:
      "Use when the user wants to add a new member to the Linear workspace or remove an existing member.",
    minRole: "admin",
    tools: ["add_member_to_platform", "remove_member_from_platform"],
    instructions:
      "<adding>\n- add_member_to_platform sends a Linear invite by email. Role defaults to 'member'; use 'admin' or 'guest' only when explicitly asked.\n- Never guess or fabricate an email address — always confirm the exact address with the user.\n- Returns the invite id, email, role, and expiresAt. Invite expires if not accepted.\n</adding>\n\n<removing>\n- remove_member_from_platform handles two cases:\n  - If the user has not accepted their invite yet: pass `email` to revoke the pending invite.\n  - If the user has joined the workspace: pass `user_id` to suspend them (data is preserved).\n- Always confirm identity before calling — resolve the email or user_id explicitly.\n- Suspension, not deletion — all their data (issues, comments, projects) stays in Linear.\n</removing>",
  },
  {
    name: "project-updates",
    description: "Query, create, and update project status updates.",
    criteria: "Use when the user wants to post, edit, or read project status updates.",
    minRole: "organizer",
    tools: ["query_project_updates", "create_project_update", "update_project_update"],
    instructions:
      '<querying>\n- Pull recent updates first to match tone and avoid repeating old news.\n</querying>\n\n<drafting>\n- Unless explicitly told "post it", draft first for review.\n- Start with the most important outcome in one sentence.\n- Call out notable shipped work and key decisions.\n- Name real blockers/risks if present.\n- Close with concrete next steps.\n</drafting>\n\n<health>\n- onTrack: normal progress, no major risk.\n- atRisk: credible risk, still recoverable.\n- offTrack: major slip or blocker.\n- Set based on evidence, not optimism.\n</health>',
  },
  {
    name: "project-views",
    description: "Query and analyze project views in list or count mode, with filters.",
    criteria: 'Use for "show/count projects matching X".',
    minRole: "organizer",
    tools: ["query_project_view"],
    instructions:
      '<views>\nAvailable scopes: workspace (all projects), initiative-scoped, project label, custom view.\n</views>\n\n<list_mode>\n\n- See individual projects with status/lead/health/priority. Supports pagination and ordering.\n  </list_mode>\n\n<count_mode>\n\n- Fast totals: "how many active projects?" Use when only aggregate numbers needed.\n  </count_mode>',
  },
  {
    name: "projects",
    description: "Create/update projects and milestones; query project activity.",
    criteria:
      "Use when the user wants to create/update a project, manage milestones, or inspect project history.",
    minRole: "organizer",
    tools: [
      "create_project",
      "update_project",
      "get_project",
      "archive_project",
      "unarchive_project",
      "delete_project",
      "create_project_milestone",
      "update_project_milestone",
      "query_project_activity",
      "query_project_view",
    ],
    instructions:
      '<creating_updating>\n\n- Only populate fields the user provided. Don\'t invent scope, timelines, or owners.\n- teamIds is required for creation. Resolve via suggest_property_values.\n- Project states: planned, started, paused, completed, canceled.\n  </creating_updating>\n\n<milestones>\n- Must be attached to a project. Only create milestones the user explicitly requests.\n- Clear target date with null only when asked.\n</milestones>\n\n<activity>\n- Use history for "when did status/lead/dates change?"\n- Supports pagination and date ranges.\n</activity>\n\n<archiving>\n- Prefer archive_project over delete_project — archive is reversible via unarchive_project.\n- delete_project is permanent and only for mistaken creations.\n</archiving>',
  },
  {
    name: "reminders",
    description:
      "Set a reminder for the current user on an issue, document, project, or initiative.",
    criteria: "Use when the user wants to set a reminder or be nudged about something.",
    minRole: "organizer",
    tools: ["set_reminder"],
    instructions:
      "<time_handling>\n\n- Absolute date -> triggers at 9am in user's timezone.\n- Absolute datetime -> triggers at that exact time.\n- Duration (\"in 2 hours\") -> triggers relative to now.\n- Next weekday/week -> triggers next occurrence at 9am.\n  </time_handling>\n\n<behavior>\n- Only for the current user (can't set for teammates).\n- One reminder per entity; setting a new one replaces the old.\n- Search for the target entity first via search_entities.\n</behavior>\n\n<alternative>\n- For deadline-based reminders, use update_issue with dueDate instead.\n</alternative>",
  },
  {
    name: "teams",
    description: "List team members and manage team membership.",
    criteria:
      "Use when the user wants to see who is on a team, add a user to a team, or remove a user from a team.",
    minRole: "organizer",
    tools: ["list_team_members", "add_user_to_team", "remove_user_from_team"],
    instructions:
      "<listing>\n- list_team_members returns all members of a team with name, email, role flags, and active status.\n- Resolve team name to ID first via suggest_property_values if only a name is given.\n</listing>\n\n<managing>\nAdmin tools — only use when explicitly asked.\n\n- add_user_to_team adds a workspace member to a team. Resolve both user and team IDs first.\n- remove_user_from_team removes a user from a team. Always confirm identity and team before removing.\n- Never act on ambiguous input — resolve the user and team first.\n  </managing>",
  },
  {
    name: "users",
    description: "List, inspect, and manage workspace users — profiles, teams, workload, invites.",
    criteria:
      "Use when the user wants to look up a person, see who's on a team, check workload, invite someone, or manage accounts.",
    minRole: "organizer",
    tools: [
      "list_users",
      "get_user",
      "get_user_teams",
      "get_user_assigned_issues",
      "suspend_user",
      "unsuspend_user",
      "invite_user",
      "list_invites",
      "delete_invite",
    ],
    instructions:
      '<lookup>\n- list_users returns all workspace members.\n- get_user returns a single user\'s full profile.\n- get_user_teams shows which teams a user belongs to.\n- get_user_assigned_issues shows their open issues.\n- When resolving "me", use user.nickname from execution context via suggest_property_values.\n</lookup>\n\n<admin>\nAdmin tools require workspace admin privileges. Only use when explicitly asked.\n\n- suspend_user disables access. Data is preserved. Always confirm identity first.\n- unsuspend_user restores access.\n- invite_user sends an email invite. Never guess or fabricate an email.\n- Role defaults to "member". Can invite as "admin" or "guest".\n- list_invites shows pending invites. delete_invite revokes a pending invite.\n  </admin>',
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, LINEAR_SKILL_DEFINITIONS),
  },
});
