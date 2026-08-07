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
  FINANCE_BASE_TOOL_NAMES,
  FINANCE_SKILLS,
  type FinanceSkillName,
} from "./skills.generated.ts";
import type { FinanceToolName } from "./tool-registry.ts";

function descriptorForSkill(skill: (typeof FINANCE_SKILLS)[number]): CapabilityDescriptor {
  return {
    kind: CapabilityKind.Skill,
    name: skill.name,
    minRole: skill.minRole,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  };
}

export function availableFinanceSkills(current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  return FINANCE_SKILLS.filter((skill) => {
    const decision = decideCapability(principal.value, descriptorForSkill(skill));
    return !Result.isError(decision) && decision.value.discover;
  });
}

export function loadFinanceSkill(name: string, current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  const skill = FINANCE_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) return Result.err(new NotFound({ kind: "Finance skill", id: name }));
  const decision = decideCapability(principal.value, descriptorForSkill(skill));
  if (Result.isError(decision)) return decision;
  if (!decision.value.execute) {
    return Result.err(
      new Forbidden({
        required: skill.minRole,
        actual: principal.value.role,
        subject: `Finance skill ${name}`,
      }),
    );
  }
  return Result.ok(skill);
}

function isFinanceSkillName(value: string): value is FinanceSkillName {
  return FINANCE_SKILLS.some((skill) => skill.name === value);
}

function loadedFinanceSkillName(output: unknown): FinanceSkillName | undefined {
  const projected =
    typeof output === "object" && output !== null && "type" in output && "value" in output
      ? output.value
      : output;
  if (typeof projected !== "object" || projected === null) return undefined;
  const activation = Reflect.get(projected, "activation");
  if (typeof activation !== "string" || !activation.startsWith("finance.skill.loaded:")) {
    return undefined;
  }
  const candidate = activation.slice("finance.skill.loaded:".length);
  return isFinanceSkillName(candidate) ? candidate : undefined;
}

export function extractLoadedFinanceSkills(thread: readonly ModelMessage[]): FinanceSkillName[] {
  const loadedSkills = new Set<FinanceSkillName>();
  for (const entry of thread) {
    if (entry.role !== "tool") continue;
    for (const part of entry.content) {
      if (part.type !== "tool-result" || part.toolName !== "load_skill") continue;
      const loadedName = loadedFinanceSkillName(part.output);
      if (loadedName !== undefined) loadedSkills.add(loadedName);
    }
  }
  return [...loadedSkills];
}

export function progressiveFinanceToolNames(messages: readonly ModelMessage[]): FinanceToolName[] {
  const names = new Set<FinanceToolName>(FINANCE_BASE_TOOL_NAMES);
  for (const loaded of extractLoadedFinanceSkills(messages)) {
    const skill = FINANCE_SKILLS.find((candidate) => candidate.name === loaded);
    if (skill === undefined) continue;
    for (const toolName of skill.toolNames) names.add(toolName);
  }
  return [...names];
}
