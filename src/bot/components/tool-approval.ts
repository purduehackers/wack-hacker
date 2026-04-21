import type { API } from "@discordjs/core/http-only";

import { log } from "evlog";

import type { ApprovalState, ApprovalStoreLike } from "@/lib/ai/approvals";
import type { DiscordInteraction } from "@/lib/protocol/types";

import { ApprovalStore, buildDecisionEmbed } from "@/lib/ai/approvals";

import type { ComponentHandler } from "./types";

import { defineComponent } from "./define";

type DecidedStatus = Exclude<ApprovalState["status"], "pending">;

const EPHEMERAL_FLAG = 64;

/**
 * Build the Discord component handler for Approve / Deny buttons. Exposed as
 * a factory so tests can inject a store backed by the in-memory Redis fixture;
 * production auto-discovery picks up `toolApproval` below.
 */
export function buildToolApprovalHandler(store?: ApprovalStoreLike): ComponentHandler {
  return defineComponent({
    prefix: "tool-approval",
    async handle(ctx) {
      const { interaction, discord, customId } = ctx;

      const parsed = parseCustomId(customId);
      if (!parsed) {
        await sendEphemeral(discord, interaction, "Malformed approval button.");
        return;
      }
      const { action, id } = parsed;

      const stateStore: ApprovalStoreLike = store ?? new ApprovalStore();
      const state = await stateStore.get(id);

      if (!state) {
        await sendEphemeral(
          discord,
          interaction,
          "This approval request has expired or was already processed.",
        );
        return;
      }

      const clickerId = interaction.member?.user.id ?? interaction.user?.id;
      if (!clickerId) {
        await sendEphemeral(discord, interaction, "Could not identify the clicker.");
        return;
      }

      if (clickerId !== state.requesterUserId) {
        await sendEphemeral(
          discord,
          interaction,
          `Only <@${state.requesterUserId}> can approve this request.`,
        );
        return;
      }

      if (state.status !== "pending") {
        await sendEphemeral(discord, interaction, `This request has already been ${state.status}.`);
        return;
      }

      const newStatus: DecidedStatus = action === "approve" ? "approved" : "denied";
      const updated = await stateStore.decide(id, newStatus, clickerId);
      const finalState = updated ?? state;

      await editOriginalMessage(discord, finalState, newStatus, clickerId);
    },
  });
}

export const toolApproval = buildToolApprovalHandler();

function parseCustomId(customId: string): { action: "approve" | "deny"; id: string } | null {
  const [, action, id] = customId.split(":");
  if (!id) return null;
  if (action !== "approve" && action !== "deny") return null;
  return { action, id };
}

async function sendEphemeral(
  discord: API,
  interaction: DiscordInteraction,
  content: string,
): Promise<void> {
  try {
    await discord.interactions.followUp(interaction.application_id, interaction.token, {
      content,
      flags: EPHEMERAL_FLAG,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    log.warn("tool-approval", `Failed to send ephemeral reply: ${message}`);
  }
}

async function editOriginalMessage(
  discord: API,
  state: ApprovalState,
  action: DecidedStatus,
  decidedByUserId: string,
): Promise<void> {
  if (!state.messageId) {
    log.warn("tool-approval", `No messageId stored for approval ${state.id}; skipping edit.`);
    return;
  }
  const targetChannelId = state.threadId ?? state.channelId;
  const decisionEmbed = buildDecisionEmbed(state, action, decidedByUserId);
  try {
    await discord.channels.editMessage(targetChannelId, state.messageId, {
      embeds: [decisionEmbed],
      components: [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    log.warn("tool-approval", `Failed to edit approval message ${state.messageId}: ${message}`);
  }
}
