import { designerText } from "@repo/badges/presentation";
import type { APIEmbed } from "discord.js";

export function badgeEmbed(description: string, title = "Your designs"): APIEmbed {
  return { title, description: designerText(description), color: 0x5865f2 };
}
