import { Forbidden, NotFound } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { ModelMessage } from "ai";
import type { SessionAuthContext } from "eve/context";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  decideCapability,
  requirePrincipal,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { NOTION_BASE_TOOL_NAMES, NOTION_SKILLS, type NotionSkillName } from "./skills.generated.ts";
import type { NotionToolName } from "./tool-registry.ts";

function descriptorForSkill(skill: (typeof NOTION_SKILLS)[number]): CapabilityDescriptor {
  return {
    kind: CapabilityKind.Skill,
    name: skill.name,
    minRole: skill.minRole,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  };
}

export function availableNotionSkills(current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  return NOTION_SKILLS.filter((skill) => {
    const decision = decideCapability(principal.value, descriptorForSkill(skill));
    return !Result.isError(decision) && decision.value.discover;
  });
}

export function loadNotionSkill(name: string, current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  const skill = NOTION_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) return Result.err(new NotFound({ kind: "Notion skill", id: name }));
  const decision = decideCapability(principal.value, descriptorForSkill(skill));
  if (Result.isError(decision)) return decision;
  if (!decision.value.execute) {
    return Result.err(
      new Forbidden({
        required: skill.minRole,
        actual: principal.value.role,
        subject: `Notion skill ${name}`,
      }),
    );
  }
  return Result.ok(skill);
}

function isNotionSkillName(value: string): value is NotionSkillName {
  return NOTION_SKILLS.some((skill) => skill.name === value);
}

function loadedNotionSkillName(output: unknown): NotionSkillName | undefined {
  const projected =
    typeof output === "object" && output !== null && "type" in output && "value" in output
      ? output.value
      : output;
  if (typeof projected !== "object" || projected === null) return undefined;
  const activation = Reflect.get(projected, "activation");
  if (typeof activation !== "string" || !activation.startsWith("notion.skill.loaded:")) {
    return undefined;
  }
  const candidate = activation.slice("notion.skill.loaded:".length);
  return isNotionSkillName(candidate) ? candidate : undefined;
}

export function extractLoadedNotionSkills(thread: readonly ModelMessage[]): NotionSkillName[] {
  const loadedSkills = new Set<NotionSkillName>();
  for (const entry of thread) {
    if (entry.role !== "tool") continue;
    for (const part of entry.content) {
      if (part.type !== "tool-result" || part.toolName !== "load_skill") continue;
      const loadedName = loadedNotionSkillName(part.output);
      if (loadedName !== undefined) loadedSkills.add(loadedName);
    }
  }
  return [...loadedSkills];
}

export function progressiveNotionToolNames(messages: readonly ModelMessage[]): NotionToolName[] {
  const names = new Set<NotionToolName>(NOTION_BASE_TOOL_NAMES);
  for (const loaded of extractLoadedNotionSkills(messages)) {
    const skill = NOTION_SKILLS.find((candidate) => candidate.name === loaded);
    if (skill === undefined) continue;
    for (const toolName of skill.toolNames) names.add(toolName);
  }
  return [...names];
}
