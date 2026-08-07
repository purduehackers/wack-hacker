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
import { FIGMA_BASE_TOOL_NAMES, FIGMA_SKILLS, type FigmaSkillName } from "./skills.generated.ts";
import type { FigmaToolName } from "./tool-registry.ts";

function descriptorForSkill(skill: (typeof FIGMA_SKILLS)[number]): CapabilityDescriptor {
  return {
    kind: CapabilityKind.Skill,
    name: skill.name,
    minRole: skill.minRole,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  };
}

export function availableFigmaSkills(current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  return FIGMA_SKILLS.filter((skill) => {
    const decision = decideCapability(principal.value, descriptorForSkill(skill));
    return !Result.isError(decision) && decision.value.discover;
  });
}

export function loadFigmaSkill(name: string, current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  const skill = FIGMA_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) return Result.err(new NotFound({ kind: "Figma skill", id: name }));
  const decision = decideCapability(principal.value, descriptorForSkill(skill));
  if (Result.isError(decision)) return decision;
  if (!decision.value.execute) {
    return Result.err(
      new Forbidden({
        required: skill.minRole,
        actual: principal.value.role,
        subject: `Figma skill ${name}`,
      }),
    );
  }
  return Result.ok(skill);
}

function isFigmaSkillName(value: string): value is FigmaSkillName {
  return FIGMA_SKILLS.some((skill) => skill.name === value);
}

function loadedFigmaSkillName(output: unknown): FigmaSkillName | undefined {
  const projected =
    typeof output === "object" && output !== null && "type" in output && "value" in output
      ? output.value
      : output;
  if (typeof projected !== "object" || projected === null) return undefined;
  const activation = Reflect.get(projected, "activation");
  if (typeof activation !== "string" || !activation.startsWith("figma.skill.loaded:")) {
    return undefined;
  }
  const candidate = activation.slice("figma.skill.loaded:".length);
  return isFigmaSkillName(candidate) ? candidate : undefined;
}

export function extractLoadedFigmaSkills(thread: readonly ModelMessage[]): FigmaSkillName[] {
  const loadedSkills = new Set<FigmaSkillName>();
  for (const entry of thread) {
    if (entry.role !== "tool") continue;
    for (const part of entry.content) {
      if (part.type !== "tool-result" || part.toolName !== "load_skill") continue;
      const loadedName = loadedFigmaSkillName(part.output);
      if (loadedName !== undefined) loadedSkills.add(loadedName);
    }
  }
  return [...loadedSkills];
}

export function progressiveFigmaToolNames(messages: readonly ModelMessage[]): FigmaToolName[] {
  const names = new Set<FigmaToolName>(FIGMA_BASE_TOOL_NAMES);
  for (const loaded of extractLoadedFigmaSkills(messages)) {
    const skill = FIGMA_SKILLS.find((candidate) => candidate.name === loaded);
    if (skill === undefined) continue;
    for (const toolName of skill.toolNames) names.add(toolName);
  }
  return [...names];
}
