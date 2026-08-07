import { IssueRelationType, LinearClient } from "@linear/sdk";

import { env } from "../../../lib/env.ts";
import type { IssueRelation } from "./constants.ts";

const linearApiKey = env.LINEAR_API_KEY ?? "missing-linear-api-key";
export const linear = new LinearClient({ apiKey: linearApiKey });

/** Build a Linear issue filter from optional UUID fields. */
export function issueFilter(f: {
  teamId?: string | undefined;
  projectId?: string | undefined;
  assigneeId?: string | undefined;
  stateId?: string | undefined;
  labelId?: string | undefined;
  cycleId?: string | undefined;
}) {
  return {
    ...(f.teamId && { team: { id: { eq: f.teamId } } }),
    ...(f.projectId && { project: { id: { eq: f.projectId } } }),
    ...(f.assigneeId && { assignee: { id: { eq: f.assigneeId } } }),
    ...(f.stateId && { state: { id: { eq: f.stateId } } }),
    ...(f.labelId && { labels: { id: { eq: f.labelId } } }),
    ...(f.cycleId && { cycle: { id: { eq: f.cycleId } } }),
  };
}

/** Apply a list of semantic relations after creating/updating an issue. */
export async function applyIssueRelations(issueId: string, relations: IssueRelation[]) {
  const results = [];
  for (const rel of relations) {
    if (rel.type === "unrelatedTo") {
      const target = await linear.issue(rel.issueId);
      const issue = await linear.issue(issueId);
      const [fwd, inv] = await Promise.all([issue.relations(), issue.inverseRelations()]);
      const toDelete = [
        ...fwd.nodes.filter((r) => r.relatedIssueId === target.id),
        ...inv.nodes.filter((r) => r.issueId === target.id),
      ];
      await Promise.all(toDelete.map((r) => linear.deleteIssueRelation(r.id)));
      results.push({ type: "unrelatedTo", target: rel.issueId, removed: toDelete.length });
      continue;
    }

    const mapped = mapRelation(issueId, rel);
    if (!mapped) continue;
    const payload = await linear.createIssueRelation(mapped);
    const created = await payload.issueRelation;
    if (created) results.push({ id: created.id, type: created.type });
  }
  return results;
}

function mapRelation(sourceId: string, rel: IssueRelation) {
  switch (rel.type) {
    case "isBlocking":
      return {
        issueId: sourceId,
        relatedIssueId: rel.issueId,
        type: IssueRelationType.Blocks,
      };
    case "isBlockedBy":
      return {
        issueId: rel.issueId,
        relatedIssueId: sourceId,
        type: IssueRelationType.Blocks,
      };
    case "isRelatedTo":
      return {
        issueId: sourceId,
        relatedIssueId: rel.issueId,
        type: IssueRelationType.Related,
      };
    case "isDuplicateOf":
      return {
        issueId: sourceId,
        relatedIssueId: rel.issueId,
        type: IssueRelationType.Duplicate,
      };
    case "isDuplicatedBy":
      return {
        issueId: rel.issueId,
        relatedIssueId: sourceId,
        type: IssueRelationType.Duplicate,
      };
    default:
      return undefined;
  }
}
