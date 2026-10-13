import { designerText } from "@repo/badges/presentation";
import type { APIEmbed } from "discord.js";

export const badgeColors = { success: 0x57f287, warning: 0xfee75c, error: 0xed4245 };
export type BadgeStatus = keyof typeof badgeColors;

export function badgeEmbed(
  description: string,
  title = "Your designs",
  status: BadgeStatus = "warning",
): APIEmbed {
  return { title, description: designerText(description), color: badgeColors[status] };
}
