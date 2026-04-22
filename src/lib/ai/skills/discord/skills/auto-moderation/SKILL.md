---
name: auto-moderation
description: Manage Discord auto-moderation rules — keyword filters, spam detection, mention flooding.
criteria: Use when the user wants to configure Discord's built-in auto-mod — creating keyword filters, spam protection, or mention-flood rules.
tools:
  [
    list_auto_mod_rules,
    get_auto_mod_rule,
    create_auto_mod_rule,
    update_auto_mod_rule,
    delete_auto_mod_rule,
  ]
minRole: organizer
mode: inline
---

<triggers>
- 1=keyword: `trigger_metadata.keyword_filter` is an array of substrings.
- 3=spam: Discord's spam heuristic (no metadata needed).
- 4=keyword_preset: `trigger_metadata.presets` array — 1=profanity, 2=sexual_content, 3=slurs.
- 5=mention_spam: `trigger_metadata.mention_total_limit` (int).
- 6=member_profile: matches against username/nickname.
</triggers>

<actions>
- 1=block_message, 2=send_alert (`metadata.channel_id` required), 3=timeout (`metadata.duration_seconds` max 2419200), 4=block_member.
</actions>

- event_type: 1 (message_send) for content rules, 2 (member_update) for profile rules.
- Always confirm before delete_auto_mod_rule — active rules protect the server.
