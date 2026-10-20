# Discord work cards

This is the first work-card implementation. It projects existing conversation
state; it does not introduce a second task execution machine or change task
identity, policy, scheduling, or authority.

## What ships

A short answer stays a normal streamed reply. Generic `thinking…`, `working…`,
or typing activity does not promote it. A tool operation, delegated work, a human
request, a failure, or an answer longer than 1,500 characters promotes the same
anchor into a work card. Once promoted, the card keeps its title through later
frames and completion. The title comes from the matching original delivery,
never from ambient channel history or a different active dispatch.

The card contains an escaped, bounded request title, requester, a plain-language
state, useful streamed text, and **Details**. A long response gets **Full result**
and a bounded preview. On the terminal frame, the complete saved response is also
attached as `wack-response.md` on that same Discord message. This native attachment
survives expiry of the seven-day Redis render record. Full result can return the
latest saved response privately while the record exists. It never silently
discards a tail because the public preview reached Discord's content limit.

The file is only this turn's answer plus any user-facing recovery instruction,
not prompts, credentials, traces, tool results, or history. It is at most the
existing 12,000-character answer and 2,000-character footer. The file's contents
participate in the anchor hash, so a changed tail updates even when the visible
preview is identical. Shorter replacements clear the old attachment explicitly.

Known machine-generated usage footers, raw tool status, and raw delegation names
are kept out of the main response. Meaningful subagent narration and answer
streaming remain visible. Recovery instructions and cancellation prose are
preserved. Requesters and current organizers can see the stored diagnostic footer,
activity, dispatch, and session in the private Details view. Other channel members
can view public state and the result, without those diagnostics.

## State mapping and gaps

| Product state               | Authoritative source                                            | Current presentation                                                                                                                             |
| --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Queued                      | Existing admission queue, before an agent render intent         | Existing immediate placeholder; no synthetic running state is stored. A richer queue card and typing-only acknowledgement remain follow-up work. |
| Working                     | Streaming intent with no human request                          | Working, with useful response text and narration.                                                                                                |
| Waiting for input           | Streaming `inputRequests[0]` question or session limit          | Your input is needed; separate notifying request keeps its existing answer controls.                                                             |
| Waiting for approval        | Streaming tool approval request                                 | Approval is needed; exact-revision approval controls remain on the separate request.                                                             |
| Connection needed           | A legacy authorization challenge                                | Connection is needed; existing legacy callbacks remain supported. This adds no connection requirement or new account integration.                |
| Blocked / failed            | Failed terminal intent                                          | Stopped — needs attention, with recovery text. No unsupported Resume button.                                                                     |
| Complete                    | Completed transport boundary                                    | Response ready. This means the turn ended, not that every requested external effect succeeded.                                                   |
| Cancelled                   | Matching `turn.cancelled` in separate optional control metadata | Cancelled, with partial output retained and a note that completed actions remain completed.                                                      |
| Paused / partially complete | No distinct authoritative wire outcome today                    | No new synthetic state or controls. Existing response text can explain the situation.                                                            |

Cancellation now uses separate optional metadata, preserving the strict legacy
intent schema. Paused and partial outcomes still require an authoritative source
and compatible rollout. Old stored intents retain their meaningful default.

The [exact-task cancellation slice](task-cancellation.md) implements Stop
admission, receipts, recovery and presentation, but hard-disables Stop on Eve
0.81.1 because its idle owner can ignore the target turn. Existing conversational
steering and HITL controls continue to work. Edit, retry, task switching and
review remain separate work.

## Discord contract

This renderer uses ordinary Discord Markdown, action rows, and attachments. It
does not set `IS_COMPONENTS_V2`. Discord only permits that flag to be set, and it
requires clearing ordinary content/embeds when converting a message. Converting
old anchors would make a rollback to the current renderer unsafe. A later V2
renderer should choose a format for newly created anchors and persist that choice,
while retaining a reader/writer for existing anchors.

Sources: [Discord message edits and attachment contracts](https://docs.discord.com/developers/resources/message#edit-message),
[Discord components](https://docs.discord.com/developers/components/overview), and
[interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding#responding-to-an-interaction).

Details and Full result are real read-only interactions. They acknowledge privately
before Redis reads or permission refresh. They validate the guild, channel,
dispatch, continuation, original message, and current anchor. An old read-only
button may show the latest state of the same task; a future revision or a button
on a replaced anchor is refused. Mutation and approval controls retain their
existing strict revision and requester/approver checks.

Before revealing a result, the bot refreshes guild membership and channel data,
checks channel visibility, and verifies membership of a private thread unless the
member can manage threads. Diagnostic access additionally requires the requester
or a current organizer. Read/permission failures fail closed with a private retry
message. Expired records explain that the task card has expired; the visible
response and native attachment remain in Discord.

Every public answer edit or post suppresses mentions, including attachment updates.
Human requests remain separate new messages with an explicit recipient allowlist;
editing a work card is not treated as a notification. A second request has a
different nonce and leaves the first decision record intact. Old `eve-hitl:`
callbacks and pre-card projection records continue to work.

## Recovery and rollout

The shared render writer still owns the fenced lease, revision checkpoint, and
terminal visibility barrier. Every Discord mutation renews ownership first and
checkpoints afterward. Upload completion is included in that barrier. A failed
upload is not marked rendered. If Discord rejects an attachment with 400, 403,
413, or 415, the renderer tries the complete response as ordinary text. Only a
successful text fallback records the per-turn `textOnlyResult` choice. A denial
of Send Messages therefore still fails; it is not mistaken for attachment-only
failure. Transient network failures retain the normal retry path.

The text fallback fits the full wire answer into at most eight messages. If
readable paragraph breaks waste capacity, it uses bounded UTF-16-safe slices
instead of dropping the tail. New overflow slots use hashed nonces, retaining
legacy slots and the old HITL nonce at slot 6 without collisions. The text is
durable in Discord after the render record expires, just as an attachment is.

A missing anchor now recreates during streaming as well as completion. Its
replacement generation is checkpointed before posting and selects a new stable
nonce, avoiding the deleted message's deduplication slot. A restart reuses that
replacement nonce. Routine retries do not allocate new generations or messages.

`workCard`, `anchorGeneration`, and `textOnlyResult` are optional bot projection
fields. Cancellation metadata is a separate optional record; malformed control
metadata reports a defect and withholds controls without blocking valid answers.
No strict agent wire field, lease heartbeat, or terminal release condition changes.
The existing index records the canonical message, so replies
and reset reactions continue to resolve its turn. Existing anchors can be edited
back to plain content and empty components; no irreversible Discord flag is set.
Keep the new read-only interaction handler deployed if rolling back the visual
presentation, so already-posted controls still answer until their records expire.

## Verification

The automated suite verifies promotion using the actual initial `thinking…`
activity, existing lifecycle mappings, bounded titles and UTF-16 previews, removal
of raw diagnostics, recovery prose, mention policy, and full-result bytes. Renderer
tests exercise real REST-port payload construction against an in-memory Discord
port, including duplicate nonces, deleted anchors, lost leases, new HITL requests,
terminal cleanup, lost upload acknowledgements, failed checkpoints after upload,
unchanged retries, shorter attachment replacements, and permission-specific text
fallback without truncation. Interaction tests cover
old/future revisions, replaced messages, cross-channel/guild controls, expiry,
denied access, read failures, and public versus diagnostic views.

These are payload and recovery checks, not visual validation. No community
messages were sent for this implementation. Before broad rollout, run a controlled
Discord canary on desktop and mobile, in light and dark themes, covering:

- A short answer that stays plain and a tool task that promotes once.
- An empty-body working card, a long title, lists, links, and code blocks.
- A long streamed response followed by a downloadable final attachment.
- Input, second-party approval, answered and expired requests, and failure recovery.
- Keyboard navigation, screen-reader labels, long member names, and small screens.
- Missing Attach Files / Send Messages / thread access, revoked roles, deleted
  anchors, a gateway restart, and record expiry with the attachment still usable.

Components V2, further task outcomes, typing-only acknowledgement, retry/edit,
artifact galleries, and independent task routing remain separate work. Stop
requires the upstream runtime release gate described above plus a real Discord
canary before it can be enabled.
