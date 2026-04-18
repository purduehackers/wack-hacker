import type { CommandBuilder, SlashCommand, SlashCommandContext } from "./types";

export function defineCommand(cmd: {
  builder: CommandBuilder;
  ephemeral?: boolean;
  execute: (ctx: SlashCommandContext) => Promise<void>;
}): SlashCommand {
  return {
    name: cmd.builder.name,
    builder: cmd.builder,
    ephemeral: cmd.ephemeral,
    execute: cmd.execute,
  };
}
