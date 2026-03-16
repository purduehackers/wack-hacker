---
name: roles
description: Create, edit, delete roles, and assign/remove roles from members.
criteria: Use when the user wants to create, edit, or delete a role, or assign/remove a role from a member.
tools: create_role, edit_role, delete_role, assign_role, remove_role
---

<creating>
- Roles require a name. Color, hoist, mentionable, and position are optional.
- Color uses hex format: '#FF0000' for red, '#00FF00' for green, etc.
- Hoist (true) displays role members in a separate sidebar section.
- Position determines hierarchy — higher positions have more authority.
- New roles are created at the bottom of the hierarchy by default.
- icon sets a custom image as the role icon (requires server boost level 2+).
- unicode_emoji sets a unicode emoji as the role icon (alternative to image icon). Cannot use both icon and unicode_emoji simultaneously.
</creating>

<editing>
- Only modify the fields the user asked to change.
- Changing a role's position affects the hierarchy. Higher = more authority.
- Be cautious with position changes — they affect permission inheritance.
- icon and unicode_emoji can be updated. Set to null to remove.
</editing>

<deleting>
- Always confirm before deleting a role.
- Deleting a role removes it from all members who have it.
- Managed roles (created by integrations/bots) cannot be deleted.
- Report the role name in confirmation, not just the ID.
</deleting>

<assigning>
- Resolve both the member and role before assigning.
- If the target is the requesting user ("me", "myself"), use their ID from `<execution_context>` directly — don't search for them.
- For other users, use search_members to find the member ID by name. Carefully distinguish the requesting user from the target user.
- Use list_roles to find the role ID by name.
- assign_role adds a role; remove_role removes it.
- A member can have multiple roles simultaneously.
</assigning>

<hierarchy>
- You can only manage roles below your user's highest role in the hierarchy.
- If a tool call fails due to hierarchy, explain that the target role is too high and suggest asking someone with a higher role.
- Role position determines hierarchy — higher position = more authority.
- The @everyone role (position 0) is always at the bottom and cannot be deleted or assigned.
</hierarchy>
