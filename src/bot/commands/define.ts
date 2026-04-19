import type {
  CommandBuilder,
  InteractionResponsePayload,
  SlashCommand,
  SlashCommandContext,
} from "./types";

export function defineCommand(cmd: {
  builder: CommandBuilder;
  ephemeral?: boolean;
  modal?: boolean;
  execute: (ctx: SlashCommandContext) => Promise<InteractionResponsePayload | void>;
}): SlashCommand {
  return {
    name: cmd.builder.name,
    builder: cmd.builder,
    ephemeral: cmd.ephemeral,
    modal: cmd.modal,
    execute: cmd.execute,
  };
}
