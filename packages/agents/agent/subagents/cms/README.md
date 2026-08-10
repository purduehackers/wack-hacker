# `cms`

The content of purduehackers.com. A Payload CMS instance at
`cms.purduehackers.com` holding nine collections: events, RSVPs, email drafts,
hack night sessions, the microgrant and shelter wall showcases, the media
library, human user accounts, and the service accounts bots authenticate as.

Every write is live. Payload has no staging copy, so a change lands on the
public site the moment it is saved — `published` and `visible` are the only
things standing between a draft and a visitor.

It does not own mail delivery. Payload's `afterChange` hooks dispatch through
Payload, which sends through Cloudflare like everything else here; this domain only flips the flag that starts them. One-off transactional
mail belongs to the `cloudflare` subagent's Email Sending tools, and CRM
outreach belongs to `outreach`, which honors Do Not Contact and records the
send. It also does not own the websites themselves — the events site and the
hack night dashboard read this data but are deployed elsewhere.

Payload assigns numeric ids on Postgres and string ids on Mongo, so ids are
opaque and come from a list call rather than being constructed.

<!-- generated: do not edit below this line -->

## Surface

**54 tools** across **6 skills**, plus 5 always-available.

## Skills

| Skill                                                    | Role      | Tools | Description                                                                              |
| -------------------------------------------------------- | --------- | ----: | ---------------------------------------------------------------------------------------- |
| [`events`](lib/skill_defs/events.md)                     | organizer |    19 | Manage events, RSVPs, and email blasts on cms.purduehackers.com                          |
| [`hack-nights`](lib/skill_defs/hack-nights.md)           | organizer |     7 | Create, update, and publish hack night session records on cms.purduehackers.com          |
| [`media`](lib/skill_defs/media.md)                       | organizer |     4 | List, fetch, upload, and delete image/file assets in the CMS media library               |
| [`service-accounts`](lib/skill_defs/service-accounts.md) | organizer |     5 | Manage service-account (API-key-only) identities in the CMS — bots and integrations      |
| [`showcases`](lib/skill_defs/showcases.md)               | organizer |    14 | Manage the ugrants (microgrants) and shelter-projects showcases on cms.purduehackers.com |
| [`users`](lib/skill_defs/users.md)                       | admin     |     5 | Admin-only management of CMS user accounts — invite, update roles, remove                |

## Always available

Reachable without loading a skill.

| Tool                       | Risk | Role   | What it does                                 |
| -------------------------- | ---- | ------ | -------------------------------------------- |
| `list_events`              | read | public | List events from the CMS.                    |
| `list_hack_night_sessions` | read | public | List hack night session records.             |
| `list_media`               | read | public | List media assets uploaded to Payload CMS.   |
| `list_shelter_projects`    | read | public | List shelter wall project showcase entries.  |
| `list_ugrants`             | read | public | List microgrant ("ugrant") showcase entries. |

## `events`

Manage events, RSVPs, and email blasts on cms.purduehackers.com

| Tool              | Risk        | Role      | What it does                                                                                                           |
| ----------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `create_email`    | write       | organizer | Draft a new email blast tied to an event.                                                                              |
| `create_event`    | write       | organizer | Create a new event.                                                                                                    |
| `create_rsvp`     | write       | organizer | Create an RSVP for an event on behalf of a user.                                                                       |
| `delete_email`    | destructive | organizer | Delete an email draft record permanently.                                                                              |
| `delete_event`    | destructive | organizer | Delete an event permanently.                                                                                           |
| `delete_rsvp`     | destructive | organizer | Delete an RSVP permanently.                                                                                            |
| `get_email`       | read        | public    | Fetch a single email blast record by ID.                                                                               |
| `get_event`       | read        | public    | Fetch a single event by ID.                                                                                            |
| `get_rsvp`        | read        | public    | Fetch a single RSVP by ID.                                                                                             |
| `list_emails`     | read        | public    | List email blast records.                                                                                              |
| `list_events`     | read        | public    | List events from the CMS.                                                                                              |
| `list_rsvps`      | read        | public    | List RSVPs across events.                                                                                              |
| `publish_event`   | destructive | organizer | Mark an event as published (visible on the website).                                                                   |
| `send_blast`      | destructive | organizer | Fire the email blast for this event to all active RSVPs (sets `send: true`).                                           |
| `send_email`      | destructive | organizer | Fire the email blast (flips `send: true`, Payload's afterChange hook dispatches the real emails via Cloudflare, then … |
| `unpublish_event` | destructive | organizer | Mark an event as unpublished (hidden from the website).                                                                |
| `update_email`    | write       | organizer | Update an email draft's subject/body or retarget it to a different event.                                              |
| `update_event`    | write       | organizer | Update an event by ID.                                                                                                 |
| `update_rsvp`     | write       | organizer | Update an RSVP.                                                                                                        |

## `hack-nights`

Create, update, and publish hack night session records on cms.purduehackers.com

| Tool                           | Risk        | Role      | What it does                                                                 |
| ------------------------------ | ----------- | --------- | ---------------------------------------------------------------------------- |
| `create_hack_night_session`    | write       | organizer | Create a new hack night session entry.                                       |
| `delete_hack_night_session`    | destructive | organizer | Delete a hack night session record permanently.                              |
| `get_hack_night_session`       | read        | public    | Fetch a single hack night session by ID.                                     |
| `list_hack_night_sessions`     | read        | public    | List hack night session records.                                             |
| `publish_hack_night_session`   | destructive | organizer | Publish a hack night session (makes it visible on the hack night dashboard). |
| `unpublish_hack_night_session` | destructive | organizer | Unpublish a hack night session.                                              |
| `update_hack_night_session`    | write       | organizer | Update a hack night session.                                                 |

## `media`

List, fetch, upload, and delete image/file assets in the CMS media library

| Tool           | Risk        | Role      | What it does                                                |
| -------------- | ----------- | --------- | ----------------------------------------------------------- |
| `delete_media` | destructive | organizer | Delete a media asset permanently.                           |
| `get_media`    | read        | public    | Fetch a single media asset by ID.                           |
| `list_media`   | read        | public    | List media assets uploaded to Payload CMS.                  |
| `upload_media` | write       | organizer | Upload an image from a public URL to the CMS media library. |

## `service-accounts`

Manage service-account (API-key-only) identities in the CMS — bots and integrations

| Tool                     | Risk        | Role      | What it does                                                                       |
| ------------------------ | ----------- | --------- | ---------------------------------------------------------------------------------- |
| `create_service_account` | destructive | organizer | Create a new service account.                                                      |
| `delete_service_account` | destructive | organizer | Delete a service account permanently.                                              |
| `get_service_account`    | read        | public    | Fetch a single service account by ID.                                              |
| `list_service_accounts`  | read        | public    | List service accounts (API-key-only CMS identities used by bots and integrations). |
| `update_service_account` | destructive | organizer | Update a service account.                                                          |

## `showcases`

Manage the ugrants (microgrants) and shelter-projects showcases on cms.purduehackers.com

| Tool                        | Risk        | Role      | What it does                                                           |
| --------------------------- | ----------- | --------- | ---------------------------------------------------------------------- |
| `create_shelter_project`    | write       | organizer | Create a new shelter project.                                          |
| `create_ugrant`             | write       | organizer | Create a new ugrant showcase entry.                                    |
| `delete_shelter_project`    | destructive | organizer | Delete a shelter project permanently.                                  |
| `delete_ugrant`             | destructive | organizer | Delete a ugrant permanently.                                           |
| `get_shelter_project`       | read        | public    | Fetch a single shelter project by ID.                                  |
| `get_ugrant`                | read        | public    | Fetch a single ugrant by ID.                                           |
| `list_shelter_projects`     | read        | public    | List shelter wall project showcase entries.                            |
| `list_ugrants`              | read        | public    | List microgrant ("ugrant") showcase entries.                           |
| `publish_shelter_project`   | destructive | organizer | Make a shelter project visible on the public showcase (visible: true). |
| `publish_ugrant`            | destructive | organizer | Make a ugrant visible on the public showcase (visible: true).          |
| `unpublish_shelter_project` | destructive | organizer | Hide a shelter project from the public showcase (visible: false).      |
| `unpublish_ugrant`          | destructive | organizer | Hide a ugrant from the public showcase (visible: false).               |
| `update_shelter_project`    | write       | organizer | Update a shelter project.                                              |
| `update_ugrant`             | write       | organizer | Update a ugrant.                                                       |

## `users`

Admin-only management of CMS user accounts — invite, update roles, remove

| Tool          | Risk        | Role  | What it does                                     |
| ------------- | ----------- | ----- | ------------------------------------------------ |
| `create_user` | destructive | admin | Invite a new CMS user.                           |
| `delete_user` | destructive | admin | Remove a CMS user permanently.                   |
| `get_user`    | read        | admin | Fetch a single CMS user by ID.                   |
| `list_users`  | read        | admin | List CMS user accounts (email + assigned roles). |
| `update_user` | destructive | admin | Update a CMS user's email or roles.              |
