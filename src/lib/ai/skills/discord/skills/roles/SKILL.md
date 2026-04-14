---
name: roles
description: Create, edit, delete roles, and assign/remove roles from members.
criteria: Use when the user wants to create, edit, or delete a role, or assign/remove a role from a member.
tools: [create_role, edit_role, delete_role, assign_role, remove_role]
minRole: organizer
mode: inline
---

<creating>
- Roles require a name. Color, hoist, mentionable, and position are optional.
- Color uses hex format: '#FF0000' for red.
- Hoist (true) displays role members in a separate sidebar section.
- New roles are created at the bottom of the hierarchy by default.
</creating>

<editing>
- Only modify the fields the user asked to change.
- Changing position affects the hierarchy. Higher = more authority.
</editing>

<deleting>
- Always confirm before deleting. Removes the role from all members.
- Managed roles (created by integrations/bots) cannot be deleted.
</deleting>

<assigning>
- Resolve both the member and role before assigning.
- If the target is the requesting user, use their ID from execution context directly.
- For other users, use search_members to find the member ID.
- A member can have multiple roles simultaneously.
</assigning>
