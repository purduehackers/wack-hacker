/** Read-only views of a work card. Approval and mutation controls stay in HITL. */

import type { ConversationStore, StoredRenderProjection } from "@repo/shared/conversations";
import { roleAtLeast, roleFromMemberRoles, UserRole } from "@repo/shared/discord";
import { messageOf, tagOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import { sliceText } from "@repo/shared/text";
import type { RenderIntent, RenderTarget } from "@repo/shared/wire";
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import type { ButtonInteraction, Interaction, InteractionEditReplyOptions } from "discord.js";

import { parseWorkCardCustomId, publicFooter, workCardState } from "./work-card.ts";

interface Access {
  readonly visible: boolean;
  readonly diagnostics: boolean;
}

export interface WorkCardInteraction {
  readonly customId: string;
  readonly channelId: string;
  readonly guildId?: string;
  readonly messageId: string;
  readonly defer: () => Promise<void>;
  readonly respond: (message: InteractionEditReplyOptions) => Promise<void>;
  readonly access: (target: RenderTarget) => Promise<Access>;
}

interface WorkCardInteractionDeps {
  readonly renders: Pick<ConversationStore["renders"], "intent" | "target" | "projection">;
  readonly reporter: Reporter;
  readonly guildId: string;
}

interface Snapshot {
  readonly intent: RenderIntent;
  readonly target: RenderTarget;
  readonly projection: StoredRenderProjection;
}

const UNAVAILABLE = "This task is temporarily unavailable. Try Details again in a moment.";
const EXPIRED =
  "This task card has expired or been replaced. The response in the channel is still available.";

async function respond(interaction: WorkCardInteraction, content: string): Promise<void> {
  await interaction.respond({ content, components: [], allowedMentions: { parse: [] } });
}

async function loadSnapshot(
  deps: WorkCardInteractionDeps,
  interaction: WorkCardInteraction,
  locator: NonNullable<ReturnType<typeof parseWorkCardCustomId>>,
): Promise<Snapshot | { readonly rejection: string }> {
  if (interaction.guildId !== deps.guildId) return { rejection: EXPIRED };
  const [desired, destination] = await Promise.all([
    deps.renders.intent(locator.dispatchId),
    deps.renders.target(locator.dispatchId),
  ]);
  if (Result.isError(desired)) throw desired.error;
  if (Result.isError(destination)) throw destination.error;
  const intent = desired.value;
  const target = destination.value;
  if (
    intent === undefined ||
    target === undefined ||
    intent.dispatchId !== locator.dispatchId ||
    target.dispatchId !== intent.dispatchId ||
    intent.continuationKey !== target.continuationKey ||
    intent.messageId !== target.messageId ||
    intent.revision < locator.revision ||
    interaction.channelId !== target.channelId
  ) {
    return { rejection: EXPIRED };
  }
  const projected = await deps.renders.projection(locator.dispatchId, target.anchorMessageId);
  if (Result.isError(projected)) throw projected.error;
  if (projected.value.anchorMessageId !== interaction.messageId) return { rejection: EXPIRED };
  return { intent, target, projection: projected.value };
}

function details(snapshot: Snapshot, diagnostics: boolean): string {
  const { intent, projection } = snapshot;
  const title = projection.workCard?.title ?? "Your request";
  const lines = [`**${title}**`, `Current state: ${workCardState(intent)}.`];
  const footer = publicFooter(intent.footer);
  if (footer !== undefined) lines.push(footer);
  if (diagnostics) {
    if (intent.activity !== "") lines.push(`Activity: ${intent.activity}`);
    if (projection.subagentActivity !== undefined) {
      lines.push(`Delegated activity: ${projection.subagentActivity}`);
    }
    if (intent.footer !== undefined) lines.push(`Run details: ${intent.footer}`);
    lines.push(`Dispatch: \`${intent.dispatchId}\``, `Session: \`${intent.sessionId}\``);
    if (intent.authoredAt !== undefined) lines.push(`Last update: ${intent.authoredAt}`);
  }
  return sliceText(lines.join("\n\n"), 1_900);
}

async function fullResult(interaction: WorkCardInteraction, intent: RenderIntent): Promise<void> {
  const content = [intent.text, publicFooter(intent.footer)]
    .filter((section) => section !== undefined && section !== "")
    .join("\n\n");
  if (content.length <= 1_900) {
    await respond(
      interaction,
      content || "There is no response yet. The card will update as work continues.",
    );
    return;
  }
  await interaction.respond({
    content: "The complete response is attached. This is the latest saved version of this turn.",
    components: [],
    files: [{ attachment: Buffer.from(content, "utf8"), name: "wack-response.md" }],
    allowedMentions: { parse: [] },
  });
}

/** Narrow port makes deadline, authorization, and stale-control behavior testable without Discord. */
export async function handleWorkCard(
  deps: WorkCardInteractionDeps,
  interaction: WorkCardInteraction,
): Promise<void> {
  // Acknowledge before Redis or permission refresh; Discord allows three seconds.
  await interaction.defer();
  const locator = parseWorkCardCustomId(interaction.customId);
  if (locator === undefined) return respond(interaction, EXPIRED);
  try {
    const snapshot = await loadSnapshot(deps, interaction, locator);
    if ("rejection" in snapshot) return respond(interaction, snapshot.rejection);
    const access = await interaction.access(snapshot.target);
    if (!access.visible)
      return respond(interaction, "You no longer have access to this task's channel.");
    if (locator.action === "result") return fullResult(interaction, snapshot.intent);
    await respond(interaction, details(snapshot, access.diagnostics));
  } catch (error) {
    deps.reporter.emit({
      op: "agent.work-card.read",
      status: "error",
      errorTag: tagOf(error),
      errorMessage: messageOf(error),
    });
    await respond(interaction, UNAVAILABLE).catch(() => undefined);
  }
}

async function currentAccess(
  interaction: ButtonInteraction,
  target: RenderTarget,
): Promise<Access> {
  const guild = interaction.guild;
  const denied = { visible: false, diagnostics: false };
  if (guild === null || !interaction.memberPermissions?.has(PermissionFlagsBits.ViewChannel)) {
    return denied;
  }
  const [member, channel] = await Promise.all([
    guild.members.fetch({ user: interaction.user.id, force: true }),
    guild.channels.fetch(target.channelId, { force: true }),
  ]);
  if (channel === null || !channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) {
    return denied;
  }
  if (
    channel.isThread() &&
    channel.type === ChannelType.PrivateThread &&
    !channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageThreads)
  ) {
    const membership = await channel.members
      .fetch({ member: member.id, force: true })
      .catch(() => undefined);
    if (membership === undefined) return denied;
  }
  const roles = [...member.roles.cache.keys()];
  return {
    visible: true,
    diagnostics:
      member.id === target.requesterUserId ||
      roleAtLeast(roleFromMemberRoles(roles), UserRole.Organizer),
  };
}

export function createWorkCardInteractionHandler(deps: WorkCardInteractionDeps) {
  return async (interaction: Interaction): Promise<boolean> => {
    if (!interaction.isButton() || !interaction.customId.startsWith("wack-work:")) return false;
    await handleWorkCard(deps, {
      customId: interaction.customId,
      channelId: interaction.channelId,
      ...(interaction.guildId === null ? {} : { guildId: interaction.guildId }),
      messageId: interaction.message.id,
      defer: async () => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      },
      respond: async (message) => {
        await interaction.editReply(message);
      },
      access: (target) => currentAccess(interaction, target),
    });
    return true;
  };
}

export type WorkCardInteractionHandler = ReturnType<typeof createWorkCardInteractionHandler>;
