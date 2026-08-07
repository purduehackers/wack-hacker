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
import { LINEAR_BASE_TOOL_NAMES, LINEAR_SKILLS, type LinearSkillName } from "./skills.generated.ts";
import type { LinearToolName } from "./tool-registry.ts";

function descriptorForSkill(skill: (typeof LINEAR_SKILLS)[number]): CapabilityDescriptor {
  return {
    kind: CapabilityKind.Skill,
    name: skill.name,
    minRole: skill.minRole,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  };
}

export function availableLinearSkills(current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  return LINEAR_SKILLS.filter((skill) => {
    const decision = decideCapability(principal.value, descriptorForSkill(skill));
    return !Result.isError(decision) && decision.value.discover;
  });
}

export function loadLinearSkill(name: string, current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  const skill = LINEAR_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) return Result.err(new NotFound({ kind: "Linear skill", id: name }));
  const decision = decideCapability(principal.value, descriptorForSkill(skill));
  if (Result.isError(decision)) return decision;
  if (!decision.value.execute) {
    return Result.err(
      new Forbidden({
        required: skill.minRole,
        actual: principal.value.role,
        subject: `Linear skill ${name}`,
      }),
    );
  }
  return Result.ok(skill);
}

function isObject(value: unknown): value is object {
  // oxlint-disable-next-line unicorn/no-null -- narrowing unknown JSON
  return typeof value === "object" && value !== null;
}

function loadedSkillFromOutput(output: unknown): LinearSkillName | undefined {
  const projected =
    isObject(output) && "type" in output && "value" in output ? output.value : output;
  if (!isObject(projected)) return undefined;
  const activation = Reflect.get(projected, "activation");
  if (typeof activation !== "string" || !activation.startsWith("linear.skill.loaded:")) {
    return undefined;
  }
  const candidate = activation.slice("linear.skill.loaded:".length);
  return LINEAR_SKILLS.find((skill) => skill.name === candidate)?.name;
}

export function extractLoadedLinearSkills(history: readonly ModelMessage[]): LinearSkillName[] {
  const loaded = new Set<LinearSkillName>();
  for (const entry of history) {
    if (entry.role !== "tool") continue;
    for (const part of entry.content) {
      if (part.type !== "tool-result" || part.toolName !== "load_skill") continue;
      const skillName = loadedSkillFromOutput(part.output);
      if (skillName !== undefined) loaded.add(skillName);
    }
  }
  return [...loaded];
}

export function progressiveLinearToolNames(messages: readonly ModelMessage[]): LinearToolName[] {
  const names = new Set<LinearToolName>(LINEAR_BASE_TOOL_NAMES);
  for (const loaded of extractLoadedLinearSkills(messages)) {
    const skill = LINEAR_SKILLS.find((candidate) => candidate.name === loaded);
    if (skill === undefined) continue;
    for (const toolName of skill.toolNames) names.add(toolName);
  }
  return [...names];
}
