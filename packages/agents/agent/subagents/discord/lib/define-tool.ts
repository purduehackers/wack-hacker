import type { DiscordCommandOperation } from "@repo/shared/discord-command-wire";
import type { ToolDefinition } from "eve/tools";
import type { z } from "zod";

import type { CapabilityDescriptor } from "../../../lib/policy/index.ts";

export type DiscordAccessDescriptor = Pick<CapabilityDescriptor, "risk"> & {
  readonly minRole?: CapabilityDescriptor["minRole"];
  readonly confirm?: CapabilityDescriptor["confirmation"];
  readonly reason?: string;
};

export type DiscordToolSpec<I extends z.ZodType = z.ZodType> = Pick<
  ToolDefinition<z.output<I>, unknown>,
  "description" | "execute"
> & {
  readonly name: DiscordCommandOperation;
  readonly domain: "discord";
  readonly access: DiscordAccessDescriptor;
  readonly input: I;
};

export function defineTool<I extends z.ZodType>(spec: DiscordToolSpec<I>): DiscordToolSpec<I> {
  return spec;
}
