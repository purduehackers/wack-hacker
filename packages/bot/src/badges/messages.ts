import { designerText } from "@repo/badges/presentation";
import type { APIEmbed } from "discord.js";

export function badgeEmbed(description: string, title = "Badge review"): APIEmbed {
  return { title, description: designerText(description), color: 0xffcc00 };
}
