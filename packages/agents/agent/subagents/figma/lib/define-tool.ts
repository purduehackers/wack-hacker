import type { ToolDefinition } from "eve/tools";
import type { z } from "zod";

import type { CapabilityDescriptor } from "../../../lib/policy/index.ts";

export type FigmaAccessDescriptor = Pick<CapabilityDescriptor, "risk"> &
  Partial<Pick<CapabilityDescriptor, "minRole">> & {
    readonly confirm?: CapabilityDescriptor["confirmation"];
    readonly reason?: string;
  };

export type FigmaToolSpec<I extends z.ZodType = z.ZodType> = Pick<
  ToolDefinition<z.output<I>, unknown>,
  "description" | "execute"
> & {
  readonly name: string;
  readonly domain: "figma";
  readonly access: FigmaAccessDescriptor;
  readonly input: I;
};

/** Plain-JSON domain implementation; Eve wrapping happens inline in tools/catalog.ts. */
export function defineTool<I extends z.ZodType>(spec: FigmaToolSpec<I>): FigmaToolSpec<I> {
  return spec;
}
