import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import type { InteractionResponsePayload } from "@/bot/commands/types";

import { defineCommand } from "@/bot/commands/define";
import { isAdmin, isOrganizer } from "@/bot/commands/helpers";
import { InteractionResponseType } from "@/lib/protocol/constants";
import { getOrganizers } from "@/lib/protocol/organizers";

const EPHEMERAL_FLAG = 64;

const PLATFORM_FIELDS = [
  { id: "linear", label: "Linear user UUID" },
  { id: "notion", label: "Notion user UUID" },
  { id: "sentry", label: "Sentry member ID" },
  { id: "github", label: "GitHub username" },
  { id: "figma", label: "Figma user ID" },
] as const;

function ephemeralMessage(content: string): InteractionResponsePayload {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content, flags: EPHEMERAL_FLAG },
  };
}

export const identityCommand = defineCommand({
  builder: new SlashCommandBuilder()
    .setName("identity")
    .setDescription("Link your platform user IDs (Linear, Notion, Sentry, GitHub, Figma)")
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Admin-only: edit another organizer's identity")
        .setRequired(false),
    ),
  modal: true,
  async execute(ctx): Promise<InteractionResponsePayload> {
    const invokerId = ctx.interaction.member?.user.id ?? ctx.interaction.user?.id;
    if (!invokerId) return ephemeralMessage("Could not determine who invoked this command.");

    const targetOption = ctx.options.get("user");
    const hasTarget = typeof targetOption === "string" && targetOption.length > 0;

    let mode: "self" | "admin";
    let targetId: string;

    if (hasTarget) {
      if (!isAdmin(ctx)) {
        return ephemeralMessage("Only admins can edit another organizer's identity.");
      }
      mode = "admin";
      targetId = targetOption;
    } else {
      if (!isOrganizer(ctx) && !isAdmin(ctx)) {
        return ephemeralMessage("Only organizers can link their platform IDs.");
      }
      mode = "self";
      targetId = invokerId;
    }

    const organizers = await getOrganizers();
    const existing = organizers[targetId];

    let title: string;
    if (mode === "self") {
      title = "Link your platform IDs";
    } else {
      const resolved = ctx.interaction.data?.resolved?.users?.[targetId];
      const displayName = resolved?.global_name ?? resolved?.username ?? targetId;
      title = `Edit ${displayName}'s platform IDs`.slice(0, 45);
    }

    const modal = new ModalBuilder()
      .setCustomId(`identity:${mode}:${targetId}`)
      .setTitle(title)
      .addComponents(
        ...PLATFORM_FIELDS.map(({ id, label }) => {
          const input = new TextInputBuilder()
            .setCustomId(id)
            .setLabel(label)
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
          const prior = existing?.[id];
          if (prior) input.setValue(prior);
          return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
        }),
      );

    return {
      type: InteractionResponseType.Modal,
      data: modal.toJSON(),
    };
  },
});
