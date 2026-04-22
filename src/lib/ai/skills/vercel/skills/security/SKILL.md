---
name: security
description: Firewall configuration, attack challenge mode, bypass IPs, auth tokens.
criteria: Use when the user asks about firewall rules, attack challenge mode, bypass IPs, firewall events, or managing Vercel auth tokens.
tools:
  [
    get_firewall_config,
    get_active_attack_status,
    update_attack_challenge_mode,
    list_bypass_ips,
    list_firewall_events,
    list_auth_tokens,
    get_auth_token,
    delete_auth_token,
  ]
minRole: organizer
mode: inline
---

<firewall>
- `get_firewall_config` takes `configVersion: "active"` for the live version (or a specific version id).
- Updating the firewall config is deliberately not exposed — its nested rule types make it risky to drive from an LLM. Direct the user to the dashboard.
</firewall>

<attack-mode>
- `update_attack_challenge_mode` shows a managed challenge page to suspected bots. Can gate legitimate users — use sparingly and disable once the attack subsides.
- `attackModeActiveUntil` is an auto-expiration (unix ms). Omit for indefinite.
</attack-mode>

<bypass-ips>
- Bypass IPs skip all firewall protections for that IP. List-only here; writes are intentionally omitted.
</bypass-ips>

<auth-tokens>
- `delete_auth_token` immediately revokes the token. Any script holding it breaks.
- Creating new auth tokens is deliberately not exposed — generate from the Vercel dashboard to keep the token handling out of Discord.
</auth-tokens>
