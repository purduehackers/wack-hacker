import type { ToolDefinition } from "eve/tools";
import type { z } from "zod";

import type { CapabilityDescriptor } from "./types.ts";

export type DomainAccessDescriptor = Pick<CapabilityDescriptor, "risk"> &
  Partial<Pick<CapabilityDescriptor, "minRole">> & {
    readonly confirm?: CapabilityDescriptor["confirmation"];
    readonly reason?: string;
  };

/** Project-owned provider operation before it is wrapped by Eve in a tool catalog. */
export type DomainToolSpec<I extends z.ZodType = z.ZodType, O = unknown> = Pick<
  ToolDefinition<z.output<I>, O>,
  "description" | "execute"
> & {
  readonly access: DomainAccessDescriptor;
  readonly input: I;
};

/** Retains the Zod input/output relationship while authoring heterogeneous registries. */
export function defineDomainTool<I extends z.ZodType, O>(
  spec: DomainToolSpec<I, O>,
): DomainToolSpec<I, O> {
  return spec;
}

export type DomainToolRegistry = Readonly<Record<string, DomainToolSpec<z.ZodType, unknown>>>;
export type DomainToolName<R extends DomainToolRegistry> = Extract<keyof R, string>;
export type DomainToolInput<R extends DomainToolRegistry, N extends DomainToolName<R>> = z.output<
  R[N]["input"]
>;
export type DomainToolOutput<R extends DomainToolRegistry, N extends DomainToolName<R>> = Awaited<
  ReturnType<R[N]["execute"]>
>;
