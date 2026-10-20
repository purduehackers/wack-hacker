/** Private work-card views and exact-task stop; approval still belongs to HITL. */

import type {
  CancellationStatus,
  ConversationStore,
  StoredRenderProjection,
  TaskControl,
} from "@repo/shared/conversations";
import { roleAtLeast, roleFromMemberRoles, UserRole } from "@repo/shared/discord";
import { messageOf, tagOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import { sliceText } from "@repo/shared/text";
import type { Principal, RenderIntent, RenderTarget } from "@repo/shared/wire";
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import type { ButtonInteraction, Interaction, InteractionEditReplyOptions } from "discord.js";

import type { ConversationFlow } from "../../utils/conversation/types.ts";
import { readTaskControl } from "./control-state.ts";
import {
  cancellationNote,
  parseWorkCardCustomId,
  publicFooter,
  workCardStatus,
} from "./work-card.ts";

interface Access {
  readonly visible: boolean;
  readonly diagnostics: boolean;
  readonly principal?: Principal;
}

export interface WorkCardInteraction {
  readonly customId: string;
  readonly interactionId: string;
  readonly channelId: string;
  readonly guildId?: string;
  readonly messageId: string;
  readonly defer: () => Promise<void>;
  readonly respond: (message: InteractionEditReplyOptions) => Promise<void>;
  readonly access: (target: RenderTarget) => Promise<Access>;
}

interface WorkCardInteractionDeps {
  readonly renders: Pick<ConversationStore["renders"], "intent" | "target" | "projection">;
  readonly cancellations?: Pick<ConversationStore["cancellations"], "read">;
  readonly flow?: Pick<ConversationFlow, "cancel" | "supportsCancel">;
  readonly reporter: Reporter;
  readonly guildId: string;
}

interface Snapshot {
  readonly intent: RenderIntent;
  readonly target: RenderTarget;
  readonly projection: StoredRenderProjection;
  readonly control?: TaskControl;
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
    (locator.action === "stop" && intent.revision !== locator.revision) ||
    interaction.channelId !== target.channelId
  ) {
    return { rejection: EXPIRED };
  }
  const projected = await deps.renders.projection(locator.dispatchId, target.anchorMessageId);
  if (Result.isError(projected)) throw projected.error;
  if (projected.value.anchorMessageId !== interaction.messageId) return { rejection: EXPIRED };
  if (locator.action === "stop" && projected.value.appliedRevision !== locator.revision)
    return { rejection: EXPIRED };
  const control = await readTaskControl(deps.cancellations, deps.reporter, locator.dispatchId);
  return {
    intent,
    target,
    projection: projected.value,
    ...(control === undefined ? {} : { control }),
  };
}

function details(snapshot: Snapshot, diagnostics: boolean): string {
  const { intent, projection } = snapshot;
  const title = projection.workCard?.title ?? "Your request";
  const lines = [`**${title}**`, `Current state: ${workCardStatus(intent, snapshot.control)}.`];
  if (snapshot.control?.request?.status === "no-active-turn") {
    lines.push(
      "The stop request reached a task that had already ended. Its final response may still be arriving.",
    );
  }
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

const STOP_RESPONSE: Readonly<Record<CancellationStatus, string>> = {
  pending: "Your stop request is saved. I'll keep trying to deliver it for this task.",
  accepted:
    "Stop requested. The card will say Cancelled only after the agent confirms it stopped. Actions already completed remain completed.",
  "no-active-turn": "This task has already ended. Its final response may still be arriving.",
  stale: "This control no longer matches the active task. Use Stop on its latest card.",
  busy: "This task is processing an answer. Try Stop again on the updated card in a moment.",
  unsupported: "Stop isn’t available for this task yet.",
};

async function stopTask(
  deps: WorkCardInteractionDeps,
  interaction: WorkCardInteraction,
  snapshot: Snapshot,
  access: Access,
): Promise<void> {
  const principal = access.principal;
  if (principal === undefined || principal.userId !== snapshot.target.requesterUserId) {
    return respond(interaction, "Only the person who requested this task can stop it.");
  }
  if (snapshot.intent.phase !== "streaming")
    return respond(interaction, STOP_RESPONSE["no-active-turn"]);
  if (
    deps.flow === undefined ||
    snapshot.control?.sessionId !== snapshot.intent.sessionId ||
    snapshot.control.eveTurnId !== snapshot.intent.eveTurnId ||
    !(await deps.flow.supportsCancel(snapshot.intent))
  ) {
    return respond(interaction, STOP_RESPONSE.unsupported);
  }
  const status = await deps.flow.cancel({
    continuationKey: snapshot.intent.continuationKey,
    dispatchId: snapshot.intent.dispatchId,
    sessionId: snapshot.intent.sessionId,
    eveTurnId: snapshot.intent.eveTurnId,
    renderRevision: snapshot.intent.revision,
    anchorMessageId: interaction.messageId,
    channelId: snapshot.target.channelId,
    interactionId: interaction.interactionId,
    principal,
  });
  return respond(interaction, STOP_RESPONSE[status]);
}

async function fullResult(interaction: WorkCardInteraction, snapshot: Snapshot): Promise<void> {
  const { intent, control } = snapshot;
  const content = [intent.text, cancellationNote(intent, control), publicFooter(intent.footer)]
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
    if (locator.action === "stop") return stopTask(deps, interaction, snapshot, access);
    if (locator.action === "result") return fullResult(interaction, snapshot);
    await respond(interaction, details(snapshot, access.diagnostics));
  } catch (error) {
    deps.reporter.emit({
      op: locator.action === "stop" ? "agent.work-card.stop" : "agent.work-card.read",
      status: "error",
      errorTag: tagOf(error),
      errorMessage: messageOf(error),
    });
    await respond(
      interaction,
      locator.action === "stop"
        ? "I couldn't confirm the stop request. Check the task card or try Stop again; I won't target a newer task."
        : UNAVAILABLE,
    ).catch(() => undefined);
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
    principal: {
      userId: member.id,
      username: member.user.username,
      nickname: member.displayName,
      memberRoles: roles,
    },
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
      interactionId: interaction.id,
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
