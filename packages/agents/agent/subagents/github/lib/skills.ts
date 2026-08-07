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
import { GITHUB_BASE_TOOL_NAMES, GITHUB_SKILLS, type GithubSkillName } from "./skills.generated.ts";
import type { GithubToolName } from "./tool-registry.ts";

function descriptorForSkill(skill: (typeof GITHUB_SKILLS)[number]): CapabilityDescriptor {
  return {
    kind: CapabilityKind.Skill,
    name: skill.name,
    minRole: skill.minRole,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  };
}

export function availableGithubSkills(current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  return GITHUB_SKILLS.filter((skill) => {
    const decision = decideCapability(principal.value, descriptorForSkill(skill));
    return !Result.isError(decision) && decision.value.discover;
  });
}

export function loadGithubSkill(name: string, current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  const skill = GITHUB_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) return Result.err(new NotFound({ kind: "Github skill", id: name }));
  const decision = decideCapability(principal.value, descriptorForSkill(skill));
  if (Result.isError(decision)) return decision;
  if (!decision.value.execute) {
    return Result.err(
      new Forbidden({
        required: skill.minRole,
        actual: principal.value.role,
        subject: `Github skill ${name}`,
      }),
    );
  }
  return Result.ok(skill);
}

function skillActivation(output: unknown): string | undefined {
  const projected =
    typeof output === "object" && output !== null && "type" in output && "value" in output
      ? Reflect.get(output, "value")
      : output;
  if (typeof projected !== "object" || projected === null) return undefined;
  const activation = Reflect.get(projected, "activation");
  return typeof activation === "string" ? activation : undefined;
}

export function extractLoadedGithubSkills(messages: readonly ModelMessage[]): GithubSkillName[] {
  const loadedSkills = new Set<GithubSkillName>();
  for (const historyMessage of messages) {
    if (historyMessage.role !== "tool") continue;
    for (const part of historyMessage.content) {
      if (part.type !== "tool-result" || part.toolName !== "load_skill") continue;
      const activation = skillActivation(part.output);
      if (!activation?.startsWith("github.skill.loaded:")) continue;
      const activatedName = activation.slice("github.skill.loaded:".length);
      const matchingSkill = GITHUB_SKILLS.find((skill) => skill.name === activatedName);
      if (matchingSkill !== undefined) loadedSkills.add(matchingSkill.name);
    }
  }
  return [...loadedSkills];
}

export function progressiveGithubToolNames(messages: readonly ModelMessage[]): GithubToolName[] {
  const names = new Set<GithubToolName>(GITHUB_BASE_TOOL_NAMES);
  for (const loaded of extractLoadedGithubSkills(messages)) {
    const skill = GITHUB_SKILLS.find((candidate) => candidate.name === loaded);
    if (skill === undefined) continue;
    for (const toolName of skill.toolNames) names.add(toolName);
  }
  return [...names];
}
