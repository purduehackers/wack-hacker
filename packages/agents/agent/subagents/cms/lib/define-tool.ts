import type { ToolDefinition } from "eve/tools";
import type { z } from "zod";

import type { CapabilityDescriptor } from "../../../lib/policy/types.ts";

export type CmsAccessDescriptor = Pick<CapabilityDescriptor, "risk"> & {
  readonly minRole?: CapabilityDescriptor["minRole"];
  readonly confirm?: CapabilityDescriptor["confirmation"];
  readonly reason?: string;
};

export type CmsToolSpec<I extends z.ZodType = z.ZodType> = Pick<
  ToolDefinition<z.output<I>, unknown>,
  "description" | "execute"
> & {
  readonly name: string;
  readonly domain: "cms";
  readonly access: CmsAccessDescriptor;
  readonly input: I;
};

/** CMS domain descriptor authoring helper. Eve wrapping happens inline in tools/catalog.ts. */
export function defineTool<I extends z.ZodType>(spec: CmsToolSpec<I>): CmsToolSpec<I> {
  return spec;
}
