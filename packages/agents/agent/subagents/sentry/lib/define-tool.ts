import type { ToolDefinition } from "eve/tools";
import type { z } from "zod";

import type { CapabilityDescriptor } from "../../../lib/policy/index.ts";

export type SentryAccessDescriptor = Pick<CapabilityDescriptor, "risk"> & {
  readonly minRole?: CapabilityDescriptor["minRole"];
  readonly confirm?: CapabilityDescriptor["confirmation"];
  readonly reason?: string;
};

export type SentryToolSpec<I extends z.ZodType = z.ZodType> = Pick<
  ToolDefinition<z.output<I>, unknown>,
  "description" | "execute"
> & {
  readonly name: string;
  readonly domain: "sentry";
  readonly access: SentryAccessDescriptor;
  readonly input: I;
};

/** Domain implementation descriptor. Eve wrapping happens inline in tools/catalog.ts. */
export function defineTool<I extends z.ZodType>(spec: SentryToolSpec<I>): SentryToolSpec<I> {
  return spec;
}
