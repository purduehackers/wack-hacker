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
  DISCORD_BASE_TOOL_NAMES,
  DISCORD_SKILLS,
  type DiscordSkillName,
} from "./skills.generated.ts";
import type { DiscordToolName } from "./tool-registry.ts";

function descriptorForSkill(skill: (typeof DISCORD_SKILLS)[number]): CapabilityDescriptor {
  return {
    kind: CapabilityKind.Skill,
    name: skill.name,
    minRole: skill.minRole,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  };
}

export function availableDiscordSkills(current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  return DISCORD_SKILLS.filter((skill) => {
    const decision = decideCapability(principal.value, descriptorForSkill(skill));
    return !Result.isError(decision) && decision.value.discover;
  });
}

export function loadDiscordSkill(name: string, current: SessionAuthContext | null | undefined) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return principal;
  const skill = DISCORD_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) return Result.err(new NotFound({ kind: "Discord skill", id: name }));
  const decision = decideCapability(principal.value, descriptorForSkill(skill));
  if (Result.isError(decision)) return decision;
  if (!decision.value.execute) {
    return Result.err(
      new Forbidden({
        required: skill.minRole,
        actual: principal.value.role,
        subject: `Discord skill ${name}`,
      }),
    );
  }
  return Result.ok(skill);
}

function loadedSkillName(output: unknown): DiscordSkillName | undefined {
  const projected =
    typeof output === "object" && output !== null && "type" in output && "value" in output
      ? output.value
      : output;
  if (typeof projected !== "object" || projected === null) return undefined;
  const activation = Reflect.get(projected, "activation");
  if (typeof activation !== "string" || !activation.startsWith("discord.skill.loaded:")) {
    return undefined;
  }
  const candidate = activation.slice("discord.skill.loaded:".length);
  return DISCORD_SKILLS.find((skill) => skill.name === candidate)?.name;
}

export function extractLoadedDiscordSkills(history: readonly ModelMessage[]): DiscordSkillName[] {
  const loaded = new Set<DiscordSkillName>();
  for (const entry of history) {
    if (entry.role !== "tool") continue;
    for (const part of entry.content) {
      if (part.type !== "tool-result" || part.toolName !== "load_skill") continue;
      const skillName = loadedSkillName(part.output);
      if (skillName !== undefined) loaded.add(skillName);
    }
  }
  return [...loaded];
}

export function progressiveDiscordToolNames(messages: readonly ModelMessage[]): DiscordToolName[] {
  const names = new Set<DiscordToolName>(DISCORD_BASE_TOOL_NAMES);
  for (const loaded of extractLoadedDiscordSkills(messages)) {
    const skill = DISCORD_SKILLS.find((candidate) => candidate.name === loaded);
    if (skill === undefined) continue;
    for (const toolName of skill.toolNames) names.add(toolName);
  }
  return [...names];
}
