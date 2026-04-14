import type { InteractionOption } from "@/lib/protocol/types";

export type { SlashCommandContext, SlashCommand } from "./types";
export { defineCommand } from "./define";

export function parseSubcommand(options?: InteractionOption[]): string | undefined {
  if (!options) return undefined;
  for (const opt of options) {
    if (opt.type === 1 || opt.type === 2) return opt.name;
  }
  return undefined;
}

export function parseOptions(
  options?: InteractionOption[],
): Map<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  if (!options) return result;

  for (const opt of options) {
    if (opt.value !== undefined) result.set(opt.name, opt.value);
    if (opt.options) {
      for (const [k, v] of parseOptions(opt.options)) result.set(k, v);
    }
  }
  return result;
}
