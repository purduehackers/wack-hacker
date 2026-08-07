import type { ToolDefinition } from "eve/tools";
import type { z } from "zod";

import type { CapabilityDescriptor } from "../../../lib/policy/index.ts";

export type GithubAccessDescriptor = Pick<CapabilityDescriptor, "risk"> & {
  readonly minRole?: CapabilityDescriptor["minRole"];
  readonly confirm?: CapabilityDescriptor["confirmation"];
  readonly reason?: string;
};

export type GithubToolSpec<I extends z.ZodType = z.ZodType> = Pick<
  ToolDefinition<z.output<I>, unknown>,
  "description" | "execute"
> & {
  readonly name: string;
  readonly domain: "github";
  readonly access: GithubAccessDescriptor;
  readonly input: I;
};

/** Domain implementation descriptor. Eve wrapping happens inline in tools/catalog.ts. */
export function defineTool<I extends z.ZodType>(spec: GithubToolSpec<I>): GithubToolSpec<I> {
  return spec;
}
