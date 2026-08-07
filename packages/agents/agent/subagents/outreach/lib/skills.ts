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
import {
  OUTREACH_BASE_TOOL_NAMES,
  OUTREACH_SKILLS,
  type OutreachSkillName,
} from "./skills.generated.ts";
import type { OutreachToolName } from "./tool-registry.ts";

function descriptorForSkill(skill: (typeof OUTREACH_SKILLS)[number]): CapabilityDescriptor {
  return {
    kind: CapabilityKind.Skill,
    name: skill.name,
    minRole: skill.minRole,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  };
}

export function availableOutreachSkills(current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  return OUTREACH_SKILLS.filter((skill) => {
    const decision = decideCapability(principal.value, descriptorForSkill(skill));
    return !Result.isError(decision) && decision.value.discover;
  });
}

export function loadOutreachSkill(name: string, current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  const skill = OUTREACH_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) return Result.err(new NotFound({ kind: "Outreach skill", id: name }));
  const decision = decideCapability(principal.value, descriptorForSkill(skill));
  if (Result.isError(decision)) return decision;
  if (!decision.value.execute) {
    return Result.err(
      new Forbidden({
        required: skill.minRole,
        actual: principal.value.role,
        subject: `Outreach skill ${name}`,
      }),
    );
  }
  return Result.ok(skill);
}

function isOutreachSkillName(value: string): value is OutreachSkillName {
  return OUTREACH_SKILLS.some((skill) => skill.name === value);
}

function loadedOutreachSkillName(output: unknown): OutreachSkillName | undefined {
  const projected =
    typeof output === "object" && output !== null && "type" in output && "value" in output
      ? output.value
      : output;
  if (typeof projected !== "object" || projected === null) return undefined;
  const activation = Reflect.get(projected, "activation");
  if (typeof activation !== "string" || !activation.startsWith("outreach.skill.loaded:")) {
    return undefined;
  }
  const candidate = activation.slice("outreach.skill.loaded:".length);
  return isOutreachSkillName(candidate) ? candidate : undefined;
}

export function extractLoadedOutreachSkills(thread: readonly ModelMessage[]): OutreachSkillName[] {
  const loadedSkills = new Set<OutreachSkillName>();
  for (const entry of thread) {
    if (entry.role !== "tool") continue;
    for (const part of entry.content) {
      if (part.type !== "tool-result" || part.toolName !== "load_skill") continue;
      const loadedName = loadedOutreachSkillName(part.output);
      if (loadedName !== undefined) loadedSkills.add(loadedName);
    }
  }
  return [...loadedSkills];
}

export function progressiveOutreachToolNames(
  messages: readonly ModelMessage[],
): OutreachToolName[] {
  const names = new Set<OutreachToolName>(OUTREACH_BASE_TOOL_NAMES);
  for (const loaded of extractLoadedOutreachSkills(messages)) {
    const skill = OUTREACH_SKILLS.find((candidate) => candidate.name === loaded);
    if (skill === undefined) continue;
    for (const toolName of skill.toolNames) names.add(toolName);
  }
  return [...names];
}
