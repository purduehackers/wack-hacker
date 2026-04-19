import { DISCORD_IDS } from "@/lib/protocol/constants";

import type { SlashCommandContext } from "./types";

export function respond(ctx: SlashCommandContext, msg: string): Promise<unknown> {
  return ctx.discord.interactions.editReply(ctx.interaction.application_id, ctx.interaction.token, {
    content: msg,
  });
}

export function isOrganizer(ctx: SlashCommandContext): boolean {
  return (ctx.interaction.member?.roles ?? []).includes(DISCORD_IDS.roles.ORGANIZER);
}

export function isAdmin(ctx: SlashCommandContext): boolean {
  return (ctx.interaction.member?.roles ?? []).includes(DISCORD_IDS.roles.ADMIN);
}
