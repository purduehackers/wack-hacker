import type { ToolSet } from "ai";

import type { AgentContext } from "./context.ts";
import type { SkillBundle } from "./skills/types.ts";
import type { TurnUsageTracker } from "./turn-usage.ts";
import type { SubagentPromptConfig, SubagentSpecBase, TelemetryMetadata } from "./types.ts";

import { DELEGATE_PREFIX, UserRole } from "./constants.ts";
import { DOMAINS } from "./skills/generated/domains.ts";
import { SKILL_MANIFEST } from "./skills/generated/manifest.ts";
import { SkillRegistry } from "./skills/registry.ts";
import { createDelegationTool } from "./subagent.ts";
import {
  buildCodeExperimentalContext,
  codeDelegationInputSchema,
  codePostFinish,
  getCodeDelegationPrompt,
} from "./tools/code/delegation.ts";

/**
 * Per-domain overrides layered into the `SubagentSpec` before creating the
 * delegation tool. Today only `code` needs non-default values — stronger
 * model, more steps, custom input schema + prompt extractor, sandbox context
 * builder, and the post-finish commit/push/PR step. Other domains use the
 * defaults from the generated `DOMAINS` registry. These reference runtime
 * functions, so they stay hand-written rather than compiler-emitted.
 *
 * Keys are plain strings (the generated `DOMAINS` is `Record<string, …>`), so
 * a stale key no longer fails typecheck — delegates.test.ts asserts the
 * override is observably applied instead. The base fields are `Partial`, but
 * `SubagentPromptConfig` is kept whole so an override can't introduce a custom
 * `inputSchema` without its paired `getPrompt`.
 */
const DOMAIN_SPEC_OVERRIDES: Partial<
  Record<string, Partial<SubagentSpecBase> & SubagentPromptConfig>
> = {
  code: {
    model: "anthropic/claude-opus-4.7",
    stopSteps: 60,
    inputSchema: codeDelegationInputSchema,
    getPrompt: getCodeDelegationPrompt,
    buildExperimentalContext: buildCodeExperimentalContext,
    postFinish: codePostFinish,
  },
};

const registry = new SkillRegistry(SKILL_MANIFEST);

/**
 * Delegate-mode domains the role can access, paired with their top-level
 * skill bundle. Single filter shared by `buildDelegationTools` and
 * `buildDelegateDocs` so the rendered prompt can never drift from the actual
 * tool surface.
 */
function availableDelegates(
  role: UserRole,
): { name: string; config: (typeof DOMAINS)[string]; skill: SkillBundle }[] {
  return Object.entries(DOMAINS).flatMap(([name, config]) => {
    const skill = registry.loadSkill(name, role);
    if (!skill || skill.mode !== "delegate") return [];
    return [{ name, config, skill }];
  });
}

/** Build delegation tools for every delegate-mode skill the role can access. */
export function buildDelegationTools(
  context: AgentContext,
  tracker: TurnUsageTracker,
  extraMetadata?: TelemetryMetadata,
): ToolSet {
  const tools: ToolSet = {};
  for (const { name, config, skill } of availableDelegates(context.role)) {
    const overrides = DOMAIN_SPEC_OVERRIDES[name] ?? {};
    tools[DELEGATE_PREFIX + name] = createDelegationTool(
      {
        name,
        description: `${skill.description}. Use when: ${skill.criteria}`,
        systemPrompt: skill.instructions,
        ...config,
        ...overrides,
      },
      context,
      tracker,
      extraMetadata,
    );
  }
  return tools;
}

/**
 * Render the system prompt's delegate-tool section for a role. Generated from
 * the same registry that `buildDelegationTools` uses, so the prompt lists
 * exactly the delegate tools the role actually has — public users see no
 * delegation docs at all. Returns an empty string when the role has no
 * delegates.
 */
export function buildDelegateDocs(role: UserRole): string {
  const delegates = availableDelegates(role);
  if (delegates.length === 0) return "";

  // Criteria + routing only — each delegate tool's own description already
  // carries `description. Use when: criteria`, so repeating the description
  // here would double-spend tokens on every step.
  const lines = delegates.map(({ name, skill }) => {
    const routing = skill.routing ? ` ${skill.routing}` : "";
    return `- **${DELEGATE_PREFIX + name}** — use when: ${skill.criteria}.${routing}`;
  });

  return `These delegation tools forward a task to a focused domain subagent:

${lines.join("\n")}

Delegation rules:

- Only delegate when the user's request clearly requires a domain-specific action (e.g. creating a channel, filing an issue, querying a database). If the message is casual, ambiguous, or conversational, respond directly — do not delegate.
- Forward the user's wording verbatim; the subagent needs the exact phrasing. Wait for the subagent's final result.
- Delegations to different domains are independent — when a request spans domains, emit the delegate calls in a single turn so they run in parallel.`;
}
