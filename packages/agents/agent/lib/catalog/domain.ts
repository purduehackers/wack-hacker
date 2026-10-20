import type { SessionAuthContext } from "eve/context";
import type { ToolContext } from "eve/tools";
import type { ApprovalContext } from "eve/tools/approval";

import { subagentDiscoverable } from "../policy/discovery.ts";
import type { createDomainRuntime } from "../policy/domain-runtime.ts";
import type { DomainToolRegistry } from "../policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../policy/skill-catalog.ts";

/** An application-side adapter, never a durable callback capture. */
export function integrationDomain<R extends DomainToolRegistry>(input: {
  readonly name: string;
  readonly tools: R;
  readonly skills: readonly IntegrationSkillDefinition[];
  readonly instructions: string;
  readonly runtime: ReturnType<typeof createDomainRuntime<R>>;
}) {
  const { runtime } = input;
  const tools: DomainToolRegistry = input.tools;
  function toolName(name: string) {
    if (!runtime.isToolName(name)) throw new Error(`Unknown ${input.name} operation: ${name}`);
    return name;
  }
  return {
    name: input.name,
    tools,
    skills: input.skills,
    instructions: input.instructions,
    discoverable: (current: SessionAuthContext | null | undefined) =>
      subagentDiscoverable(current, runtime.subagentDescriptor),
    visibleToolNames: (current: SessionAuthContext | null | undefined) =>
      current !== undefined && subagentDiscoverable(current, runtime.subagentDescriptor)
        ? runtime.visibleToolNames(current, Object.keys(input.tools))
        : Promise.resolve([]),
    approval: (name: string, ctx: ApprovalContext) => runtime.approvalForTool(toolName(name), ctx),
    execute: (name: string, value: unknown, ctx: ToolContext) =>
      runtime.executeTool(toolName(name), value, ctx),
  };
}
