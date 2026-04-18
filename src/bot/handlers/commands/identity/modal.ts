import { log } from "evlog";

import type { InteractionResponsePayload } from "@/bot/commands/types";
import type { ModalSubmitContext } from "@/bot/modals/types";
import type { OrganizerPatch, UpsertResult } from "@/lib/protocol/organizers";

import { defineModal } from "@/bot/modals/define";
import { DISCORD_IDS, InteractionResponseType } from "@/lib/protocol/constants";
import { upsertOrganizer } from "@/lib/protocol/organizers";

const EPHEMERAL_FLAG = 64;

const PLATFORM_LABELS: Record<string, string> = {
  linear: "Linear",
  notion: "Notion",
  sentry: "Sentry",
  github: "GitHub",
  figma: "Figma",
};

function ephemeral(content: string): InteractionResponsePayload {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content, flags: EPHEMERAL_FLAG },
  };
}

function authorize(
  mode: string,
  targetId: string,
  invokerId: string | undefined,
  invokerRoles: string[],
): InteractionResponsePayload | null {
  const invokerIsAdmin = invokerRoles.includes(DISCORD_IDS.roles.ADMIN);
  const invokerIsOrganizer = invokerRoles.includes(DISCORD_IDS.roles.ORGANIZER);

  if (mode === "self") {
    if (invokerId !== targetId) return ephemeral("You can only edit your own identity.");
    if (!invokerIsOrganizer && !invokerIsAdmin) {
      return ephemeral("Only organizers can link their platform IDs.");
    }
    return null;
  }
  if (mode === "admin") {
    if (!invokerIsAdmin) return ephemeral("Only admins can edit another organizer's identity.");
    return null;
  }
  return ephemeral("Unrecognized form mode.");
}

function buildPatch(fields: Map<string, string>): OrganizerPatch {
  return {
    linear: fields.get("linear") ?? "",
    notion: fields.get("notion") ?? "",
    sentry: fields.get("sentry") ?? "",
    github: fields.get("github") ?? "",
    figma: fields.get("figma") ?? "",
  };
}

async function fetchDisplay(
  ctx: ModalSubmitContext,
  targetId: string,
): Promise<{ name?: string; slug?: string }> {
  try {
    const user = await ctx.discord.users.get(targetId);
    return {
      name: user.global_name ?? user.username,
      slug: user.username.toLowerCase(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    log.warn("identity-modal", `Could not fetch user ${targetId}: ${msg}`);
    return {};
  }
}

function summarise(result: UpsertResult, mode: string, targetId: string): string {
  const parts: string[] = [];
  if (result.set.length > 0) {
    parts.push(`Set: ${result.set.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")}`);
  }
  if (result.cleared.length > 0) {
    parts.push(`Cleared: ${result.cleared.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")}`);
  }
  const detail = parts.length > 0 ? parts.join(" \u00B7 ") : "No changes.";
  const prefix = mode === "self" ? "Identity updated." : `Identity updated for <@${targetId}>.`;
  return `${prefix} ${detail}`;
}

export const identityModal = defineModal({
  prefix: "identity",
  async handle(ctx): Promise<InteractionResponsePayload> {
    const [, mode, targetId] = ctx.customId.split(":");
    if (!mode || !targetId) return ephemeral("Malformed form submission.");

    const invokerId = ctx.interaction.member?.user.id ?? ctx.interaction.user?.id;
    const invokerRoles = ctx.interaction.member?.roles ?? [];

    const rejection = authorize(mode, targetId, invokerId, invokerRoles);
    if (rejection) return rejection;

    const patch = buildPatch(ctx.fields);
    const display = await fetchDisplay(ctx, targetId);

    const result = await upsertOrganizer(targetId, {
      ...(display.name ? { name: display.name } : {}),
      ...(display.slug ? { slug: display.slug } : {}),
      ...patch,
    });

    return ephemeral(summarise(result, mode, targetId));
  },
});
