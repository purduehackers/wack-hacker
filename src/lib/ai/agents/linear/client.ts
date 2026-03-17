import { LinearClient, type IssueRelationType } from "@linear/sdk";

import { env } from "../../../../env.ts";

export const linear = new LinearClient({ apiKey: env.LINEAR_API_KEY });

/** Build a Linear issue filter from optional UUID fields. */
export function issueFilter(f: {
  teamId?: string;
  projectId?: string;
  assigneeId?: string;
  stateId?: string;
  labelId?: string;
  cycleId?: string;
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
export async function applyIssueRelations(
  issueId: string,
  relations: { issueId: string; type: string }[],
) {
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
      results.push({
        type: "unrelatedTo",
        target: rel.issueId,
        removed: toDelete.length,
      });
      continue;
    }

    const mapped = mapRelation(issueId, rel);
    if (!mapped) continue;
    const payload = await linear.createIssueRelation(mapped);
    const relation = await payload.issueRelation;
    if (relation) results.push({ id: relation.id, type: relation.type });
  }
  return results;
}

function mapRelation(sourceId: string, rel: { issueId: string; type: string }) {
  switch (rel.type) {
    case "isBlocking":
      return {
        issueId: sourceId,
        relatedIssueId: rel.issueId,
        type: "blocks" as IssueRelationType,
      };
    case "isBlockedBy":
      return {
        issueId: rel.issueId,
        relatedIssueId: sourceId,
        type: "blocks" as IssueRelationType,
      };
    case "isRelatedTo":
      return {
        issueId: sourceId,
        relatedIssueId: rel.issueId,
        type: "related" as IssueRelationType,
      };
    case "isDuplicateOf":
      return {
        issueId: sourceId,
        relatedIssueId: rel.issueId,
        type: "duplicate" as IssueRelationType,
      };
    case "isDuplicatedBy":
      return {
        issueId: rel.issueId,
        relatedIssueId: sourceId,
        type: "duplicate" as IssueRelationType,
      };
    default:
      return null;
  }
}
