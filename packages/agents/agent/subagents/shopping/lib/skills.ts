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
  SHOPPING_BASE_TOOL_NAMES,
  SHOPPING_SKILLS,
  type ShoppingSkillName,
} from "./skills.generated.ts";
import type { ShoppingToolName } from "./tool-registry.ts";

function descriptorForSkill(skill: (typeof SHOPPING_SKILLS)[number]): CapabilityDescriptor {
  return {
    kind: CapabilityKind.Skill,
    name: skill.name,
    minRole: skill.minRole,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  };
}

export function availableShoppingSkills(current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  return SHOPPING_SKILLS.filter((skill) => {
    const decision = decideCapability(principal.value, descriptorForSkill(skill));
    return !Result.isError(decision) && decision.value.discover;
  });
}

export function loadShoppingSkill(name: string, current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  const skill = SHOPPING_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) return Result.err(new NotFound({ kind: "Shopping skill", id: name }));
  const decision = decideCapability(principal.value, descriptorForSkill(skill));
  if (Result.isError(decision)) return decision;
  if (!decision.value.execute) {
    return Result.err(
      new Forbidden({
        required: skill.minRole,
        actual: principal.value.role,
        subject: `Shopping skill ${name}`,
      }),
    );
  }
  return Result.ok(skill);
}

function isShoppingSkillName(value: string): value is ShoppingSkillName {
  return SHOPPING_SKILLS.some((skill) => skill.name === value);
}

function loadedShoppingSkillName(output: unknown): ShoppingSkillName | undefined {
  const projected =
    typeof output === "object" && output !== null && "type" in output && "value" in output
      ? output.value
      : output;
  if (typeof projected !== "object" || projected === null) return undefined;
  const activation = Reflect.get(projected, "activation");
  if (typeof activation !== "string" || !activation.startsWith("shopping.skill.loaded:")) {
    return undefined;
  }
  const candidate = activation.slice("shopping.skill.loaded:".length);
  return isShoppingSkillName(candidate) ? candidate : undefined;
}

export function extractLoadedShoppingSkills(thread: readonly ModelMessage[]): ShoppingSkillName[] {
  const loadedSkills = new Set<ShoppingSkillName>();
  for (const entry of thread) {
    if (entry.role !== "tool") continue;
    for (const part of entry.content) {
      if (part.type !== "tool-result" || part.toolName !== "load_skill") continue;
      const loadedName = loadedShoppingSkillName(part.output);
      if (loadedName !== undefined) loadedSkills.add(loadedName);
    }
  }
  return [...loadedSkills];
}

export function progressiveShoppingToolNames(
  messages: readonly ModelMessage[],
): ShoppingToolName[] {
  const names = new Set<ShoppingToolName>(SHOPPING_BASE_TOOL_NAMES);
  for (const loaded of extractLoadedShoppingSkills(messages)) {
    const skill = SHOPPING_SKILLS.find((candidate) => candidate.name === loaded);
    if (skill === undefined) continue;
    for (const toolName of skill.toolNames) names.add(toolName);
  }
  return [...names];
}
