import { ToolLoopAgent, type ToolSet } from "ai";

import { AgentContext } from "./context.ts";
import { buildDelegationTools, getDelegateToolName } from "./delegates.ts";
import { SKILL_MANIFEST } from "./skills/generated/manifest.ts";
import { SkillRegistry, createLoadSkillTool, computeActiveTools } from "./skills/index.ts";
import { documentation } from "./tools/docs/index.ts";
import { scheduleTask, listScheduledTasks, cancelTask } from "./tools/schedule/index.ts";
import { currentTime } from "./tools/schedule/time.ts";

const registry = new SkillRegistry(SKILL_MANIFEST);

const ALWAYS_ON = ["currentTime", "loadSkill"] as const;

const SYSTEM_PROMPT = `<identity>
You are a helpful assistant for Purdue Hackers, embedded in Discord. You speak as "I" and keep responses concise and actionable.
</identity>

<date>
Today is {{DATE}}.
</date>

<skills>
You have access to skill bundles that unlock tools and detailed guidance. Load the relevant skill using the loadSkill tool BEFORE using any domain-specific tools.

{{SKILL_MENU}}

Before calling any tool, consider which skill best matches the user's intent. If the request spans multiple domains, plan the full sequence before starting.

For delegate-mode skills (linear, github, discord, notion), loading the skill activates a delegation tool that forwards the task to a focused domain subagent. Forward the user's original message to the subagent verbatim when possible — subagents need the exact wording.
</skills>

<tone>
- Concise and direct. No preamble, no filler.
- Never open with "Great question!", "Sure!", "Certainly!", or similar. Start with the answer or action.
- Warm but straightforward. First person: "I found...", "Here's...", "Done."
- Discord has a 2000-character limit. Keep responses well under it.
- For simple confirmations: one sentence. For data: clean bullet list.
</tone>

<formatting>
- Use Discord-compatible Markdown. Bullet lists use -.
- Include URLs when referencing entities. Never expose raw UUIDs.
- Never echo API keys, tokens, or secrets.
</formatting>`;

export function createOrchestrator(context: AgentContext) {
  const role = context.role;
  const skillMenu = registry.buildSkillMenu(role);
  const instructions = context.buildInstructions(
    SYSTEM_PROMPT.replace("{{SKILL_MENU}}", skillMenu),
  );

  const tools: ToolSet = {
    currentTime,
    loadSkill: createLoadSkillTool(registry, role),
    documentation,
    scheduleTask,
    listScheduledTasks,
    cancelTask,
    ...buildDelegationTools(role),
  };

  type ToolKey = keyof typeof tools;

  return new ToolLoopAgent({
    model: "anthropic/claude-sonnet-4.6",
    instructions,
    tools,
    activeTools: [...ALWAYS_ON] as ToolKey[],
    prepareStep: ({ steps }) => {
      const active = computeActiveTools({
        steps,
        registry,
        role,
        baseToolNames: ALWAYS_ON,
        skillToTools: (skill) =>
          skill.mode === "delegate" ? [getDelegateToolName(skill.name)] : skill.toolNames,
      });
      return active ? { activeTools: active as ToolKey[] } : undefined;
    },
  });
}
