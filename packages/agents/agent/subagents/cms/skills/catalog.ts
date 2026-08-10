import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type LegacySkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

export const CMS_BASE_TOOL_NAMES = [
  "list_events",
  "list_hack_night_sessions",
  "list_ugrants",
  "list_shelter_projects",
  "list_media",
] as const;

export const CMS_SKILL_DEFINITIONS = [
  {
    name: "events",
    description: "Manage events, RSVPs, and email blasts on cms.purduehackers.com",
    criteria:
      "Use when the user asks about Purdue Hackers events, RSVP lists, unsubscribe requests, or sending email blasts to attendees",
    minRole: "organizer",
    tools: [
      "list_events",
      "get_event",
      "create_event",
      "update_event",
      "delete_event",
      "publish_event",
      "unpublish_event",
      "send_blast",
      "list_rsvps",
      "get_rsvp",
      "create_rsvp",
      "update_rsvp",
      "delete_rsvp",
      "list_emails",
      "get_email",
      "create_email",
      "update_email",
      "delete_email",
      "send_email",
    ],
    instructions:
      "<events>\n\n- `events` holds name, start/end, eventType ('hack-night' by default), location, description (richText), published flag, and an email-send pipeline (send / sentAt).\n- `publish_event` and `unpublish_event` flip `published` — they are NOT approval-gated but are publicly visible, so confirm before flipping.\n- `send_blast` flips `send: true` on an event and Payload's afterChange hook dispatches real emails to all non-unsubscribed RSVPs via Resend. Approval-gated. Confirm the event + draft first.\n  </events>\n\n<rsvps>\n\n- `rsvps` links each attendee (email, name) to an event via the `event` relationship.\n- Prefer `update_rsvp({ unsubscribed: true })` over `delete_rsvp` — preserves the audit trail and keeps historical attendance counts accurate.\n- To audit attendance for an event: `list_rsvps({ event_id: <id>, limit: 100 })`; paginate if totalDocs > limit.\n  </rsvps>\n\n<emails>\n\n- `emails` are standalone email-blast drafts tied to an event (subject + body).\n- Creating an email doesn't send it. `send_email` flips `send: true` and Payload's afterChange hook fires the blast via Resend, then resets `send` to false.\n- Both `send_email` and `send_blast` (the event-scoped equivalent) are approval-gated. Use `send_email` when there's already a drafted email row; use `send_blast` when the event's own `send` flag is the pipeline.\n  </emails>",
  },
  {
    name: "hack-nights",
    description: "Create, update, and publish hack night session records on cms.purduehackers.com",
    criteria:
      "Use when the user asks to record, edit, or publish a hack night session (title, date, host, description)",
    minRole: "organizer",
    tools: [
      "list_hack_night_sessions",
      "get_hack_night_session",
      "create_hack_night_session",
      "update_hack_night_session",
      "delete_hack_night_session",
      "publish_hack_night_session",
      "unpublish_hack_night_session",
    ],
    instructions:
      "<records>\n\n- `hack-night-sessions` records hold title, date (ISO datetime), host `{ preferred_name, discord_id }`, description (richText), and a published flag.\n- Host is a group field — always pass both `host_preferred_name` and `host_discord_id` on create, or neither on update.\n- `publish_hack_night_session` / `unpublish_hack_night_session` flip `published`. They are NOT approval-gated — confirm with the user before flipping because it affects the hack night dashboard.\n  </records>\n\n<images>\n\n- Image uploads go through the `media` sub-skill. Upload via `upload_media({ url, alt, source: 'hack-night', batch_id })` first, then (if needed) pass references into the hack night session via the admin UI or `update_hack_night_session`. In v1, image attachment via the agent is best-effort — the admin UI is canonical.\n  </images>",
  },
  {
    name: "media",
    description: "List, fetch, upload, and delete image/file assets in the CMS media library",
    criteria:
      "Use when the user asks to upload a photo to the CMS, audit the media library, or delete a media asset",
    minRole: "organizer",
    tools: ["list_media", "get_media", "upload_media", "delete_media"],
    instructions:
      '<uploads>\n\n- `upload_media({ url, alt })` fetches the URL server-side and posts it to Payload. The `alt` text is required (accessibility).\n- Optional fields: `filename` (derived from URL if omitted), `source` (`"manual"` default, `"hack-night"` for bot-driven batch uploads), `batch_id` (groups a batch of hack-night uploads), `discord_message_id` / `discord_user_id` (provenance for hack-night auto-uploads).\n- The response includes the new `id` — keep it around if you\'re about to reference the asset from a ugrant / shelter-project / hack-night-session.\n  </uploads>\n\n<listing>\n\n- `list_media` supports filtering by `source` and `batch_id`. Use `batch_id` to surface a specific hack-night upload batch for cleanup.\n- Returned fields are camelCase → snake_case: `thumbnail_url`, `mime_type`, `discord_message_id`, etc.\n  </listing>\n\n<destructive>\n\n- `delete_media` is approval-gated. Deletion is permanent and any page/post referencing the asset loses its image until relinked.\n  </destructive>',
  },
  {
    name: "service-accounts",
    description:
      "Manage service-account (API-key-only) identities in the CMS — bots and integrations",
    criteria:
      "Use when the user asks about CMS service accounts, revoking API keys, or provisioning a new integration identity",
    minRole: "organizer",
    tools: [
      "list_service_accounts",
      "get_service_account",
      "create_service_account",
      "update_service_account",
      "delete_service_account",
    ],
    instructions:
      "<service-accounts>\n\n- Service accounts are API-key-only CMS identities used by bots and integrations. Each has `name`, `revoked` flag, and a role set.\n- The API key itself is minted in the Payload admin UI _after_ creating the record. This tool only provisions the identity and its roles.\n- Available roles: `admin`, `editor`, `viewer`, `hack_night_dashboard`, `events_website`, `wack_hacker`.\n  </service-accounts>\n\n<revocation>\n\n- Prefer `update_service_account({ revoked: true })` over `delete_service_account` — flipping `revoked` kills the API key without dropping the row, preserving the audit trail.\n- `delete_service_account` is approval-gated for genuinely-dead identities.\n  </revocation>",
  },
  {
    name: "showcases",
    description:
      "Manage the ugrants (microgrants) and shelter-projects showcases on cms.purduehackers.com",
    criteria:
      "Use when the user asks to add, edit, publish, or remove entries in the microgrant or shelter wall project showcases",
    minRole: "organizer",
    tools: [
      "list_ugrants",
      "get_ugrant",
      "create_ugrant",
      "update_ugrant",
      "delete_ugrant",
      "publish_ugrant",
      "unpublish_ugrant",
      "list_shelter_projects",
      "get_shelter_project",
      "create_shelter_project",
      "update_shelter_project",
      "delete_shelter_project",
      "publish_shelter_project",
      "unpublish_shelter_project",
    ],
    instructions:
      "<ugrants>\n\n- `ugrants` (microgrants) is the recipient showcase — `name`, `author`, `description`, `image`, `authorUrl`, `projectUrl`, `visible`.\n- `visible: true` is public. Default on create is false — ask the user before toggling visible on new entries since the image may still be blurry / the description may need review.\n- `publish_ugrant` / `unpublish_ugrant` flip visibility.\n  </ugrants>\n\n<shelter-projects>\n\n- `shelter-projects` is the shelter wall showcase — `name`, `last_division`, `last_owner`, `description`, `image`, `visible`.\n- Same visibility semantics as ugrants.\n  </shelter-projects>\n\n<images>\n\n- Both collections require an `image_id` pointing at an existing `media` record. Upload via the `media` sub-skill's `upload_media({ url, alt })` first, then pass the returned `id` as `image_id` when creating or updating.\n- Images are required on create for both collections; updates can omit `image_id` to keep the existing reference.\n  </images>",
  },
  {
    name: "users",
    description: "Admin-only management of CMS user accounts — invite, update roles, remove",
    criteria:
      "Use when the user asks to grant, change, or revoke CMS access for a teammate (admin only)",
    minRole: "admin",
    tools: ["list_users", "get_user", "create_user", "update_user", "delete_user"],
    instructions:
      '<roles>\n\n- The CMS defines these roles: `admin`, `editor`, `viewer`, `hack_night_dashboard`, `events_website`, `wack_hacker`.\n- Hierarchy is enforced server-side: `admin` implies `editor` implies `viewer`. The specialized roles (`hack_night_dashboard`, `events_website`, `wack_hacker`) are additive.\n- `update_user({ roles: [...] })` REPLACES the role set — not a merge. Read the current roles with `get_user` first when adding/removing a single role.\n  </roles>\n\n<writes>\n\n- `create_user` needs an email and an initial password (≥ 8 chars). The user can change it on first login.\n- `delete_user` is approval-gated AND admin-gated. Prefer `update_user({ roles: ["viewer"] })` to strip editorial access instead — keeps audit trail + sessions table intact.\n  </writes>\n\n<visibility>\n\n- This sub-skill is admin-only. Organizers cannot load it; they cannot see user-management tools in the menu.\n  </visibility>',
  },
] as const satisfies readonly LegacySkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, CMS_SKILL_DEFINITIONS),
  },
});
