import type { StepResult, ToolSet } from "ai";

import type { UserRole } from "../constants.ts";
import type { SkillRegistry } from "./registry.ts";
import type { SkillBundle } from "./types.ts";

/** Maps a loaded skill to the tool names it activates. Defaults to `skill.toolNames`. */
type SkillToToolsFn = (skill: SkillBundle) => readonly string[];

/**
 * Scan step history for `loadSkill` tool calls and compute the resulting
 * `activeTools` set. Returns `undefined` when no valid skills have been
 * loaded so the caller can fall back to the default active tools.
 */
export function computeActiveTools<T extends ToolSet>(options: {
  steps: ReadonlyArray<StepResult<T>>;
  registry: SkillRegistry;
  role: UserRole;
  baseToolNames: readonly string[];
  skillToTools?: SkillToToolsFn;
}): string[] | undefined {
  const { steps, registry, role, baseToolNames, skillToTools } = options;

  const loaded = new Set<string>();
  for (const step of steps) {
    for (const call of step.toolCalls) {
      if (call.toolName !== "loadSkill") continue;
      const name = (call as { input?: { name?: string } }).input?.name;
      if (name) loaded.add(name);
    }
  }

  if (loaded.size === 0) return undefined;

  const active = new Set<string>(baseToolNames);
  for (const name of loaded) {
    const skill = registry.loadSkill(name, role);
    if (!skill) continue;
    const tools = skillToTools ? skillToTools(skill) : skill.toolNames;
    for (const toolName of tools) active.add(toolName);
  }
  return [...active];
}
