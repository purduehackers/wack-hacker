import { Forbidden, NotFound } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { ModelMessage } from "ai";
import type { SessionAuthContext } from "eve/context";

import { decideCapability } from "../../../lib/policy/engine.ts";
import { requirePrincipal } from "../../../lib/policy/principal.ts";
import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/types.ts";
import { CMS_BASE_TOOL_NAMES, CMS_SKILLS, type CmsSkillName } from "./skills.generated.ts";
import type { CmsToolName } from "./tool-registry.ts";

function descriptorForSkill(skill: (typeof CMS_SKILLS)[number]): CapabilityDescriptor {
  return {
    kind: CapabilityKind.Skill,
    name: skill.name,
    minRole: skill.minRole,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  };
}

export function availableCmsSkills(current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  return CMS_SKILLS.filter((skill) => {
    const decision = decideCapability(principal.value, descriptorForSkill(skill));
    return !Result.isError(decision) && decision.value.discover;
  });
}

export function loadCmsSkill(name: string, current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  const skill = CMS_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) return Result.err(new NotFound({ kind: "CMS skill", id: name }));
  const decision = decideCapability(principal.value, descriptorForSkill(skill));
  if (Result.isError(decision)) return decision;
  if (!decision.value.execute) {
    return Result.err(
      new Forbidden({
        required: skill.minRole,
        actual: principal.value.role,
        subject: `CMS skill ${name}`,
      }),
    );
  }
  return Result.ok(skill);
}

function isObject(value: unknown): value is object {
  // oxlint-disable-next-line unicorn/no-null -- narrowing unknown JSON
  return typeof value === "object" && value !== null;
}

function loadedSkillFromOutput(output: unknown): CmsSkillName | undefined {
  const projected =
    isObject(output) && "type" in output && "value" in output ? output.value : output;
  if (!isObject(projected)) return undefined;
  const activation = Reflect.get(projected, "activation");
  if (typeof activation !== "string" || !activation.startsWith("cms.skill.loaded:")) {
    return undefined;
  }
  const candidate = activation.slice("cms.skill.loaded:".length);
  return CMS_SKILLS.find((skill) => skill.name === candidate)?.name;
}

export function extractLoadedCmsSkills(history: readonly ModelMessage[]): CmsSkillName[] {
  const loaded = new Set<CmsSkillName>();
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

export function progressiveCmsToolNames(messages: readonly ModelMessage[]): CmsToolName[] {
  const names = new Set<CmsToolName>(CMS_BASE_TOOL_NAMES);
  for (const loaded of extractLoadedCmsSkills(messages)) {
    const skill = CMS_SKILLS.find((candidate) => candidate.name === loaded);
    if (skill === undefined) continue;
    for (const toolName of skill.toolNames) names.add(toolName);
  }
  return [...names];
}
