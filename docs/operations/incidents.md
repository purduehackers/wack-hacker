# Redis and schedule incidents

Start with bot health, the supervisor/function logs, Sentry, and a read-only
snapshot. Never use `KEYS *`, flush Redis, or delete a family of keys from the
Upstash console during diagnosis.
Run the inspector from an operator shell populated with the named
`UPSTASH_REDIS_REST_*` and, for schedules, `TURSO_*` variables; do not copy
production secrets into a root `.env.local` or an incident ticket.

```bash
bun packages/shared/scripts/ops-inspect.ts redis
bun packages/shared/scripts/ops-inspect.ts redis --continuation <continuation-key>
bun packages/shared/scripts/ops-inspect.ts redis --dispatch <dispatch-id>
bun packages/shared/scripts/ops-inspect.ts schedules
```

The inspector calls the same `ConversationStore` inspection API as the runtimes,
so operators do not maintain another spelling of conversation keys. It
deliberately omits queued message bodies, prompts, claim tokens, and credentials.
Attach its JSON and timestamps to the incident.

## Conversation or render appears stuck

1. Confirm `/health` is 200 and `ready: true`. A 503 or missing active sandbox is
   a runtime incident; invoke the supervisor before touching coordination data.
2. For a conversation, compare pending depth, `agent:active:*`,
   `agent:parked:*`, ingress/reset presence, and membership in `agent:ready`.
   Claimed delivery leases are 30 seconds. For a render, compare
   `agent:render-ready`, target/intent/projection/outcome presence, and the
   render-claim TTL; render claims expire after 45 seconds.
3. Restart/replace the bot and allow recovery to scan durable ready/index sets.
   HTTP callbacks are only wakeups, so a missed callback is not data loss.
4. Wait longer than the relevant lease and re-snapshot. A terminal render
   outcome (`applied` or `discarded`) is required before the queued turn can be
   released; do not manufacture that outcome manually.
5. If one conversation remains wedged, have the original requester or a current
   organizer use the product reset: react ✅ to a still-indexed terminal agent
   reply. That path executes the atomic Lua cleanup. Do not independently delete
   `agent:active`, queue, authorization, render, or set-membership keys: partial
   deletion can double-admit a turn, strand private authorization state, or
   break the visible-commit barrier. Escalate with the sanitized snapshot if the
   atomic path is unavailable.

The supervisor mutex `wack:bot-sandbox:supervisor:v1` has a ten-minute TTL. An
existing mutex means wait and inspect the in-flight function. Never delete it:
an older invocation could still commit unless its fencing token remains intact.
The monotonically increasing fence and `wack:bot-sandbox:active:v1` are not
cache and must not be reset.

## Scheduled task is late or failed

There are two different schedulers:

- Bot community cron jobs are in-process and claim
  `bot:schedule:<name>:<Indiana-minute>` for 14 days to suppress overlap.
- User-created tasks live in Turso. Eve polls once a minute, leases at most 25
  due rows for two minutes, retries after 1/2/4/8-minute backoff, and marks the fifth failed attempt
  `failed`.
  The bot separately receipts each occurrence in
  `agent:scheduled-fire:<occurrence-id>`.

For a user task:

1. Inspect `status`, `next_run_at`, `available_at`, `lease_expires_at`, attempt
   count, and the bounded `last_error` with `ops-inspect.ts schedules`.
2. Check the once-a-minute Eve schedule log, active bot generation/health, and
   bot scheduled-fire logs. A lease in the future means another invocation owns
   it; do not clear it. An expired lease is automatically reclaimable.
3. Fix the dependency first (bot health, ingress secret, Discord permission, or
   downstream outage). Active tasks retry automatically. A `failed` task is a
   terminal audit fact; do not reset its counters with ad-hoc SQL. Have the
   owner cancel/recreate it after reviewing `last_error`, or use a reviewed
   repair migration if product recovery is impossible.
4. For a missed community cron, verify the Indiana nominal minute and its claim.
   Never delete a valid claim merely to rerun a side effect. Perform an
   explicitly approved manual business action instead, recording why duplicate
   suppression was bypassed.
