# Exact-task cancellation

## Release status

The application implementation is complete enough to review and test, but **Stop
is deliberately unavailable on Eve 0.81.1**. Its public fixed-session
`Session.cancel({ turnId })` preserves the target on delivery and protects a newer
active turn. However, the installed owner's `nextTurnDelivery` ignores that
target when cancelling working tasks or a session-limit prompt between turns.
A delayed cancellation can therefore affect later work on the same session.

`EXACT_TURN_CANCEL_SUPPORTED` is hard false in
`packages/agents/agent/lib/discord/cancellation.ts`. There is no environment
override. The runtime does not advertise Stop on streaming cards and its cancel
route refuses before execution. Operator routing capabilities alone cannot
override that refusal. Do not remove this guard simply because the public method
accepts a turn ID or because the application tests pass.

The installed-runtime regression in `task-cancel-runtime.test.ts` uses Eve's real
fixed-session adapter, `ActiveTurn`, and `nextTurnDelivery`. It verifies the
preserved session/turn command, correct active-turn rejection, and the unsafe idle
behavior. These internal imports are confined to the test fixture; production
uses the documented public API and carries no framework patch.

Before enabling Stop, upgrade to a runtime that demonstrably rejects stale
target turns in **both active and idle owners**, including held session-limit
prompts, background tasks, duplicate delivery, and completion racing acceptance.
Change the known-limitation assertion into a rejection assertion and run a
deployment canary. A Redis query immediately before cancellation cannot fix the
engine race because the owner may move after that query.

Authoritative **Cancelled** presentation is usable independently: the existing
`turn.cancelled` event writes an optional outcome beside the legacy render. The
card preserves partial output, removes held input controls through the normal
terminal render, and explains that completed actions remain completed.

## Command and authority

Once the engine release gate is met, Stop appears only when both the runtime's
stored control offer and the continuation's persisted deployment capability
support `exact-turn-cancel-v1`. A short answer may stay a plain streamed reply;
promoted task cards carry the contextual button.

The bot privately acknowledges the interaction before reads. It refreshes guild
membership and channel permissions, checks private-thread membership unless the
member can manage threads, and requires the **original requester**. Diagnostic
access for organizers does not imply authority to stop another person's work.
Losing an organizer role does not prevent a still-authorized channel member from
withdrawing their own pending approval.

The durable admission transaction compares the exact:

- Dispatch, continuation, session, and Eve turn.
- Current render revision and applied projection revision.
- Original message, channel, requester, and current anchor.
- Active delivery owner, live phase, reset barrier, and input ingress lease.

A deleted/replaced anchor or old revision cannot admit a command. An input
response entering Eve returns a truthful busy result; the user can retry against
the refreshed card. This slice adds no Edit or Retry control.

`POST /discord/cancel` requires the existing bot bearer, rechecks the saved
command and execution owner, then calls
`attachSession(sessionId).cancel({ turnId: eveTurnId })`. It never calls
`from(channel).cancel()`, starts a session, resolves a replacement, resets history,
replays the requested work, or bypasses a legacy deployment binding.

## Receipt, recovery, and truthfulness

`agent:task-control:<dispatchId>` is optional side metadata with the capability,
exact session/turn, authoritative cancelled outcome, and one cancellation
command receipt with the existing seven-day render retention.
`agent:cancel-ready` indexes pending commands; missing records are pruned from it.
The receipt stores the original payload JSON verbatim, preserving empty role
arrays through Redis Lua.

The first authorized click wins. Later clicks cannot change its identity. The
command is saved before HTTP, so a restart can resume delivery. HTTP loss retries
the same command; a durable acknowledgement returns the existing receipt. The
worker isolates corrupt records and per-command failures, so one bad record
does not strand other cancellations. It reports defects; it never treats
corruption as proof that work stopped.

Recovery runs independently of rendering and queue reconciliation, with at most
two commands in flight and a per-dispatch guard. Each wake rotates through the
pending index, so repeatedly failing records do not monopolize the available
slots. A stalled HTTP request cannot block another final answer. Shutdown stops
new scans and drains both rendering and cancellation within the existing shared
15-second budget; unacknowledged intents remain durable.

The raw HTTP client now supplies its retry policy in the installed
`better-result` API's second argument. Reset, HITL, and exact-target Stop retry
transient failures once with unchanged request bytes; 4xx refusals do not retry.
New message admission remains one attempt. Legacy steering also remains one
attempt because it resolves the current session and cancels without a turn ID or
receipt; replaying it after a lost response could stop later work.

| Evidence                                                    | Presentation                                    |
| ----------------------------------------------------------- | ----------------------------------------------- |
| Authorized command saved locally; no engine acknowledgement | Stop requested                                  |
| Engine durably accepted the command                         | Stopping                                        |
| Matching authoritative `turn.cancelled`                     | Cancelled                                       |
| Turn completed first                                        | Response ready; no cancellation claim           |
| Exact target no longer active                               | Private explanation that the task already ended |
| Legacy/unsupported engine                                   | Private refusal; no cancel sent                 |

Only the engine cancellation event sets the cancelled outcome. HTTP acceptance
does not erase approval controls, claim that external effects were undone, or
release the active delivery. Final publication and queue advancement retain the
existing terminal visibility barrier.

Changing command state atomically increments the existing render revision and
advertises it for the normal renderer. It does not create another task lifecycle
or change lease heartbeats. Incrementing the numeric revision preserves the rest
of the strict render JSON byte-for-byte, including empty option arrays and
quoted text. Acknowledgements after terminal publication do not create another
terminal revision or bypass its visibility fence.

There are no new fields on the strict `RenderIntent` wire. Legacy bots ignore
the separate record and continue rendering existing intents; old runtimes never
offer Stop. Keep the new handler available for already-posted controls during
rollback. Optional control read/decode failures hide controls and report a
defect, while valid answers, private results, and terminal rendering continue.
Publication also tolerates corrupt optional metadata, preserving it for the
reader's diagnostics without interrupting the authoritative render transition.

## Verification and remaining work

Automated checks cover real Redis admission, concurrent clicks, stale target
coordinates and anchors, completion before admission, a newer dispatch,
restart recovery, acknowledgement loss, stalled HTTP alongside final rendering,
exact public cancel arguments, held
approval preservation until settlement, bounded retention, empty arrays,
corrupt optional metadata, and the terminal visibility barrier. Interaction and
renderer checks cover authorization refusal, private acknowledgement, legacy
capabilities, status wording, and retained partial results.

These are code, payload, and recovery checks. They do not establish appearance or
accessibility in a real Discord client. After the upstream engine gate is fixed,
run controlled desktop/mobile canaries for active and held-input Stop, revoked
membership, a private thread, concurrent completion, deleted cards, process
restart, and a temporarily unavailable pinned deployment. Production routing,
session migration, and sandbox replay gates remain independent.
