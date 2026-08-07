import type { ToolDefinition } from "eve/tools";
import type { z } from "zod";

import type { CapabilityDescriptor } from "../../../lib/policy/index.ts";

export type FinanceAccessDescriptor = Pick<CapabilityDescriptor, "risk"> &
  Partial<Pick<CapabilityDescriptor, "minRole">> & {
    readonly confirm?: CapabilityDescriptor["confirmation"];
    readonly reason?: string;
  };

export type FinanceToolSpec<I extends z.ZodType = z.ZodType> = Pick<
  ToolDefinition<z.output<I>, unknown>,
  "description" | "execute"
> & {
  readonly name: string;
  readonly domain: "finance";
  readonly access: FinanceAccessDescriptor;
  readonly input: I;
};

/** Plain-JSON domain implementation; Eve wrapping happens inline in tools/catalog.ts. */
export function defineTool<I extends z.ZodType>(spec: FinanceToolSpec<I>): FinanceToolSpec<I> {
  return spec;
}
