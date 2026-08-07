---
name: collaborators
description: Manage direct repository collaborators and pending invitations (admin only for writes).
criteria: Use when the user wants to list repo collaborators, add/remove one, or manage pending repo invitations.
tools:
  [
    list_collaborators,
    add_collaborator,
    remove_collaborator,
    list_repo_invitations,
    cancel_repo_invitation,
  ]
minRole: admin
mode: inline
---

- Direct collaborators have access to a single repo; this is separate from org membership.
- Permission levels: pull (read), triage, push (write, default), maintain, admin.
- add_collaborator may trigger an invitation if the user isn't already in the org.
- Always confirm with the user before remove_collaborator or cancel_repo_invitation.
