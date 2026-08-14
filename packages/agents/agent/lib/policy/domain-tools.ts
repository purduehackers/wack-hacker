import type { ToolDefinition } from "eve/tools";
import type { z } from "zod";

import type { CapabilityDescriptor } from "./types.ts";

export type DomainAccessDescriptor = Pick<CapabilityDescriptor, "risk"> &
  Partial<Pick<CapabilityDescriptor, "minRole">> & {
    readonly confirm?: CapabilityDescriptor["confirmation"];
    readonly reason?: string;
  };

/** Project-owned provider operation before Eve wraps it into a tool catalog. */
export type DomainToolSpec<I extends z.ZodType = z.ZodType, O = unknown> = Pick<
  ToolDefinition<z.output<I>, O>,
  "description" | "execute"
> & {
  readonly access: DomainAccessDescriptor;
  readonly input: I;
  /**
   * Environment key(s) this tool cannot run without.
   *
   * The key lives on the tool, not in a name branch inside the domain's
   * `configurationError`. That branch style is how `shopping` and `outreach`
   * ended up with hardcoded `Set`s of tool names beside the registry. Such a
   * list silently goes stale the first time someone adds a tool.
   */
  readonly requires?: string | readonly string[];
};

/** Retains the Zod input/output relationship while authoring heterogeneous registries. */
export function defineDomainTool<I extends z.ZodType, O>(
  spec: DomainToolSpec<I, O>,
): DomainToolSpec<I, O> {
  return spec;
}

export type DomainToolRegistry = Readonly<Record<string, DomainToolSpec<z.ZodType, unknown>>>;
export type DomainToolName<R extends DomainToolRegistry> = Extract<keyof R, string>;
