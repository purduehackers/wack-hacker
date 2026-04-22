---
name: audiences
description: Manage Resend audiences (segments) and their contact rosters.
criteria: Use when the user wants to list, create, or delete audiences, or add/remove contacts from an audience.
tools:
  [
    list_audiences,
    get_audience,
    create_audience,
    delete_audience,
    list_contacts_in_audience,
    add_contact_to_audience,
    remove_contact_from_audience,
  ]
minRole: organizer
mode: inline
---

- Resend calls these "segments" internally; "audience" is the product-level name.
- add_contact_to_audience creates the contact if it doesn't already exist.
- remove_contact_from_audience takes either contact_id (preferred) or email.
- delete_audience removes the segment but does not delete the contacts.
