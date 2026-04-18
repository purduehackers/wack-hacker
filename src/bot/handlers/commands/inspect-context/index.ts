import { ApplicationCommandType, ContextMenuCommandBuilder } from "discord.js";

import { defineCommand } from "@/bot/commands/define";
import { isOrganizer, respond } from "@/bot/commands/helpers";
import { ContextSnapshotStore } from "@/bot/context-snapshot";
import { ConversationStore } from "@/bot/store";
import { breakdownFromSnapshot } from "@/lib/ai/inspect-context";

import { renderContextReport } from "./render";

export const inspectContext = defineCommand({
  builder: new ContextMenuCommandBuilder()
    .setName("Inspect Context")
    .setType(ApplicationCommandType.Message),
  ephemeral: true,
  async execute(ctx) {
    if (!isOrganizer(ctx)) {
      await respond(ctx, "You need the Organizer role to use this command.");
      return;
    }

    const channelId = ctx.interaction.channel_id;
    if (!channelId) {
      await respond(ctx, "Missing channel context on this interaction.");
      return;
    }

    const convState = await new ConversationStore().get(channelId);
    if (!convState) {
      await respond(
        ctx,
        "No active conversation in this channel/thread. Mention the bot first to start one.",
      );
      return;
    }

    const snap = await new ContextSnapshotStore().get(channelId);
    if (!snap) {
      await respond(
        ctx,
        "Conversation exists but no snapshot is available yet. Wait for the next turn to complete, then try again.",
      );
      return;
    }

    const breakdown = await breakdownFromSnapshot(snap);
    const messages = renderContextReport(breakdown);
    const [firstMessage, ...followUpMessages] = messages;
    await respond(ctx, firstMessage);
    for (const followUp of followUpMessages) {
      // Followups must set the EPHEMERAL flag explicitly (64); it doesn't
      // inherit from the deferred reply.
      await ctx.discord.interactions.followUp(
        ctx.interaction.application_id,
        ctx.interaction.token,
        { content: followUp, flags: 64 },
      );
    }
  },
});
