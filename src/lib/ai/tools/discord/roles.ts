import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { discord } from "./client.ts";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const create_role = tool({
  description:
    "Create a new role in the server. You can set the name, color, whether it is hoisted (displayed separately in the sidebar), mentionable, and an icon or unicode emoji.",
  inputSchema: z.object({
    name: z.string().describe("Role name"),
    color: z
      .string()
      .optional()
      .describe("Hex color (e.g. '#FF0000') — will be converted to integer"),
    hoist: z.boolean().optional().describe("Display role members separately in the sidebar"),
    mentionable: z.boolean().optional().describe("Allow anyone to mention this role"),
    position: z.number().optional().describe("Role position (higher = more authority)"),
    icon: z.string().optional().describe("Role icon image URL (requires server boost level 2+)"),
    unicode_emoji: z
      .string()
      .optional()
      .describe("Unicode emoji for the role icon (alternative to image icon)"),
  }),
  execute: async ({ name, color, hoist, mentionable, position, icon, unicode_emoji }) => {
    const body: Record<string, any> = { name };
    if (color) body.color = parseInt(color.replace("#", ""), 16);
    if (hoist !== undefined) body.hoist = hoist;
    if (mentionable !== undefined) body.mentionable = mentionable;
    if (icon) body.icon = icon;
    if (unicode_emoji) body.unicode_emoji = unicode_emoji;

    const role = (await discord.post(Routes.guildRoles(DISCORD_GUILD_ID), {
      body,
    })) as any;

    // If position was requested, modify it separately
    if (position !== undefined) {
      await discord.patch(Routes.guildRoles(DISCORD_GUILD_ID), {
        body: [{ id: role.id, position }],
      });
    }

    return JSON.stringify({
      id: role.id,
      name: role.name,
      color: `#${role.color.toString(16).padStart(6, "0")}`,
      position: role.position,
    });
  },
});

export const edit_role = tool({
  description:
    "Edit an existing role's settings including name, color, hoist, mentionable, icon, and unicode emoji.",
  inputSchema: z.object({
    role_id: z.string().describe("Role ID"),
    name: z.string().optional().describe("New role name"),
    color: z.string().optional().describe("New hex color"),
    hoist: z.boolean().optional().describe("Display separately in sidebar"),
    mentionable: z.boolean().optional().describe("Allow mentioning"),
    position: z.number().optional().describe("New position"),
    icon: z
      .string()
      .nullable()
      .optional()
      .describe("Role icon image URL (requires server boost level 2+, null to remove)"),
    unicode_emoji: z
      .string()
      .nullable()
      .optional()
      .describe("Unicode emoji for the role icon (alternative to image icon, null to remove)"),
  }),
  execute: async ({ role_id, name, color, hoist, mentionable, position, icon, unicode_emoji }) => {
    const body: Record<string, any> = {};
    if (name) body.name = name;
    if (color) body.color = parseInt(color.replace("#", ""), 16);
    if (hoist !== undefined) body.hoist = hoist;
    if (mentionable !== undefined) body.mentionable = mentionable;
    if (icon !== undefined) body.icon = icon;
    if (unicode_emoji !== undefined) body.unicode_emoji = unicode_emoji;

    const edited = (await discord.patch(Routes.guildRole(DISCORD_GUILD_ID, role_id), {
      body,
    })) as any;

    if (position !== undefined) {
      await discord.patch(Routes.guildRoles(DISCORD_GUILD_ID), {
        body: [{ id: role_id, position }],
      });
    }

    return JSON.stringify({
      id: edited.id,
      name: edited.name,
      color: `#${edited.color.toString(16).padStart(6, "0")}`,
      position: edited.position,
    });
  },
});

export const delete_role = tool({
  description:
    "Delete a role from the server. This is irreversible and will remove the role from all members who have it.",
  inputSchema: z.object({
    role_id: z.string().describe("Role ID"),
  }),
  execute: async ({ role_id }) => {
    // Fetch the role first to get its name
    const allRoles = (await discord.get(Routes.guildRoles(DISCORD_GUILD_ID))) as any[];
    const target = allRoles.find((r) => r.id === role_id);
    if (!target) return JSON.stringify({ error: "Role not found" });
    await discord.delete(Routes.guildRole(DISCORD_GUILD_ID, role_id));
    return JSON.stringify({ success: true, deleted: target.name });
  },
});

export const assign_role = tool({
  description:
    "Assign a role to a server member. Requires both the member's user ID and the role ID.",
  inputSchema: z.object({
    member_id: z.string().describe("Member (user) ID"),
    role_id: z.string().describe("Role ID to assign"),
  }),
  execute: async ({ member_id, role_id }) => {
    await discord.put(Routes.guildMemberRole(DISCORD_GUILD_ID, member_id, role_id));
    return JSON.stringify({ success: true, member: member_id, role: role_id });
  },
});

export const remove_role = tool({
  description:
    "Remove a role from a server member. Requires both the member's user ID and the role ID.",
  inputSchema: z.object({
    member_id: z.string().describe("Member (user) ID"),
    role_id: z.string().describe("Role ID to remove"),
  }),
  execute: async ({ member_id, role_id }) => {
    await discord.delete(Routes.guildMemberRole(DISCORD_GUILD_ID, member_id, role_id));
    return JSON.stringify({ success: true, member: member_id, role: role_id });
  },
});
