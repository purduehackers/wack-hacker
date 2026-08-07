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
import { SENTRY_BASE_TOOL_NAMES, SENTRY_SKILLS, type SentrySkillName } from "./skills.generated.ts";
import type { SentryToolName } from "./tool-registry.ts";

function descriptorForSkill(skill: (typeof SENTRY_SKILLS)[number]): CapabilityDescriptor {
  return {
    kind: CapabilityKind.Skill,
    name: skill.name,
    minRole: skill.minRole,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  };
}

export function availableSentrySkills(current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  return SENTRY_SKILLS.filter((skill) => {
    const decision = decideCapability(principal.value, descriptorForSkill(skill));
    return !Result.isError(decision) && decision.value.discover;
  });
}

export function loadSentrySkill(name: string, current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  const skill = SENTRY_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) return Result.err(new NotFound({ kind: "Sentry skill", id: name }));
  const decision = decideCapability(principal.value, descriptorForSkill(skill));
  if (Result.isError(decision)) return decision;
  if (!decision.value.execute) {
    return Result.err(
      new Forbidden({
        required: skill.minRole,
        actual: principal.value.role,
        subject: `Sentry skill ${name}`,
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

export function extractLoadedSentrySkills(messages: readonly ModelMessage[]): SentrySkillName[] {
  const loadedSkills = new Set<SentrySkillName>();
  for (const historyMessage of messages) {
    if (historyMessage.role !== "tool") continue;
    for (const part of historyMessage.content) {
      if (part.type !== "tool-result" || part.toolName !== "load_skill") continue;
      const activation = skillActivation(part.output);
      if (!activation?.startsWith("sentry.skill.loaded:")) continue;
      const activatedName = activation.slice("sentry.skill.loaded:".length);
      const matchingSkill = SENTRY_SKILLS.find((skill) => skill.name === activatedName);
      if (matchingSkill !== undefined) loadedSkills.add(matchingSkill.name);
    }
  }
  return [...loadedSkills];
}

export function progressiveSentryToolNames(messages: readonly ModelMessage[]): SentryToolName[] {
  const names = new Set<SentryToolName>(SENTRY_BASE_TOOL_NAMES);
  for (const loaded of extractLoadedSentrySkills(messages)) {
    const skill = SENTRY_SKILLS.find((candidate) => candidate.name === loaded);
    if (skill === undefined) continue;
    for (const toolName of skill.toolNames) names.add(toolName);
  }
  return [...names];
}
