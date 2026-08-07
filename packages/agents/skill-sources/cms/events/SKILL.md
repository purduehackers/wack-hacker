---
name: events
description: Manage events, RSVPs, and email blasts on cms.purduehackers.com
criteria: Use when the user asks about Purdue Hackers events, RSVP lists, unsubscribe requests, or sending email blasts to attendees
tools:
  [
    list_events,
    get_event,
    create_event,
    update_event,
    delete_event,
    publish_event,
    unpublish_event,
    send_blast,
    list_rsvps,
    get_rsvp,
    create_rsvp,
    update_rsvp,
    delete_rsvp,
    list_emails,
    get_email,
    create_email,
    update_email,
    delete_email,
    send_email,
  ]
minRole: organizer
mode: inline
---

<events>

- `events` holds name, start/end, eventType ('hack-night' by default), location, description (richText), published flag, and an email-send pipeline (send / sentAt).
- `publish_event` and `unpublish_event` flip `published` — they are NOT approval-gated but are publicly visible, so confirm before flipping.
- `send_blast` flips `send: true` on an event and Payload's afterChange hook dispatches real emails to all non-unsubscribed RSVPs via Resend. Approval-gated. Confirm the event + draft first.
  </events>

<rsvps>

- `rsvps` links each attendee (email, name) to an event via the `event` relationship.
- Prefer `update_rsvp({ unsubscribed: true })` over `delete_rsvp` — preserves the audit trail and keeps historical attendance counts accurate.
- To audit attendance for an event: `list_rsvps({ event_id: <id>, limit: 100 })`; paginate if totalDocs > limit.
  </rsvps>

<emails>

- `emails` are standalone email-blast drafts tied to an event (subject + body).
- Creating an email doesn't send it. `send_email` flips `send: true` and Payload's afterChange hook fires the blast via Resend, then resets `send` to false.
- Both `send_email` and `send_blast` (the event-scoped equivalent) are approval-gated. Use `send_email` when there's already a drafted email row; use `send_blast` when the event's own `send` flag is the pipeline.
  </emails>
