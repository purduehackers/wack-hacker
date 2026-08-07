import type { ToolDefinition } from "eve/tools";
import type { z } from "zod";

import type { CapabilityDescriptor } from "../../../lib/policy/index.ts";

export type ShoppingAccessDescriptor = Pick<CapabilityDescriptor, "risk"> &
  Partial<Pick<CapabilityDescriptor, "minRole">> & {
    readonly confirm?: CapabilityDescriptor["confirmation"];
    readonly reason?: string;
  };

export type ShoppingToolSpec<I extends z.ZodType = z.ZodType> = Pick<
  ToolDefinition<z.output<I>, unknown>,
  "description" | "execute"
> & {
  readonly name: string;
  readonly domain: "shopping";
  readonly access: ShoppingAccessDescriptor;
  readonly input: I;
};

/** Plain-JSON domain implementation; Eve wrapping happens inline in tools/catalog.ts. */
export function defineTool<I extends z.ZodType>(spec: ShoppingToolSpec<I>): ShoppingToolSpec<I> {
  return spec;
}
