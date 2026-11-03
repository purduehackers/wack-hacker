# Wack Hacker product refactor

Status: implementation started. October 19, 2026.

The first change establishes the reproducible provider inventory and migration
parity baseline described in [Capability baseline](../system/capability-baseline.md).
The remaining work and release bars below are planned, not completed.

Wack should be a capable teammate inside Discord: easy to talk to, quick to start,
able to finish substantial work across the organization's tools, and clear about
what happened. Someone should be able to give it a task, refine the task while it
works, review the result, and return later without reconstructing the conversation.

The selected product direction is **Work card**. A substantial task gets one
recognizable home for its status, decisions, outputs, and next actions. Quick
questions remain quick conversations. The work card must be built from real
Discord components and validated in Discord on desktop and mobile.

Grok Bot's public presentation provides useful product goals: conversational task
assignment, finished work, persistent context, routines, and approvals at meaningful
boundaries. These are product references, not evidence of its private implementation
or a requirement to reproduce its account or computer model.
[Grok Bot](https://x.ai/bot)

**Decisions carried into this plan**

- Streaming is acceptable. The discarded feedback about edits polluting logs or
  search is not a reason for this refactor.
- Use typing for short work and a persistent work card for substantial work.
  Progress should describe meaningful changes; preserve useful answer streaming.
  Execution heartbeats must work independently of visible message edits.
- Use direct SDK and HTTP integrations with Wack or organization-managed
  credentials. No MCP and no requirement for users to connect their own accounts.
- Expose as much of each provider's supported surface as practical. A handful of
  attractive workflows must not become a ceiling on capability coverage.
- Put the skill tree and ordinary tool execution on the main agent. Delegate only
  when independent parallel work or a separate context has a demonstrated benefit.
- Use just-bash for ordinary computation once durable storage and runtime support
  are implemented. Keep real compute for native workloads and the Discord gateway.
- Preserve Wack's personality and existing community features while raising the
  standard of clarity, usefulness, and consistency.

**What the current evidence establishes**

The checkout has 12 provider domains, 670 provider tool definitions, and 106 skill
documents. These counts describe authored surface, not proven end-to-end coverage.
Provider operations execute through the shared application-side policy runtime.
They do not require a VM merely to call an API.

The sandbox audit inspected all 101 retained sandbox/session command lists across
the current and legacy Wack projects. One sandbox hosts the Discord bot; 100 were
agent workspaces. Of 1,946 agent commands, 1,897 were file uploads, setup, or probes.
Eighty-four agent workspaces had no other commands. Useful work included JSON
processing, member batching, date calculations, file inspection, and HTTP requests.
The audit covers retained history; upload metadata does not reveal archive contents,
and four long command arguments were truncated.

Local just-bash 3.6.0 probes passed representative shell, JSON, Python, and QuickJS
tasks. The installed Eve 0.31.3 adapter stores a local filesystem path; a fresh-host
simulation lost a saved file. Its optional language runtimes are not enabled by the
stock adapter. These are migration requirements, not reasons to keep routine API
work in VMs. Sandbox command timestamps also do not establish that VM startup is the
dominant source of response latency.
[Sandbox audit and probe results](../research/sandbox-audit-summary-2026-10-19.md)

## 1. Discord interaction design

**Excellent means:** Wack looks and behaves like a well-built Discord app. A person
can tell what it is doing, what it needs, and what it accomplished without opening
another interface or reading a transcript of internal operations.

Build a small, complete set of response patterns:

| Pattern      | Behavior                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Quick answer | A direct message or reply with the answer first; no task ceremony for a trivial exchange.                         |
| Work card    | Task title, requester, meaningful status, useful progress or result, and the few relevant actions.                |
| Choice       | A short question with buttons or a select menu; a normal text reply also works.                                   |
| Edit         | A native modal for structured edits, or conversational correction when that is easier.                            |
| Review       | The exact draft or change, target, consequences, and approve/edit/cancel actions when review is required.         |
| Result       | Finished answer or artifact, links to changed objects, and a concise account of partial completion if applicable. |
| Recovery     | What succeeded, what failed, and a specific way to continue without repeating completed effects.                  |

The work card needs designed states for queued, working, waiting for input, waiting
for approval, paused, blocked, partially complete, complete, and cancelled. These
are presentation states mapped from authoritative execution state, not another
independently maintained execution machine.

Keep the default card compact: one clear title, one status, the useful content, one
primary action, and only necessary secondary actions. Put sources, activity, and
diagnostics behind a Details action that opens an appropriate private interaction
view or task thread. Do not promise arbitrary expandable HTML inside Discord.
Remove routine model names, token totals, raw tool names, trace IDs, and decorative
status clutter from the main conversation. Keep diagnostic access available to
the people who need it.

Use Components V2 for the new card renderer where it fits the chosen layout. Its
flag changes the message payload contract: traditional content and embeds are
disabled for that message. Treat this as a renderer change, with a deliberately
supported fallback and migration path.
[Discord components](https://docs.discord.com/developers/components/overview)

Preserve useful streaming within a stable layout. Use actual progress such as
“Found the event; checking its images” rather than invented percentages or repeated
“still working” messages. Typing can cover brief work before a card is needed.
Notify on a new request for human input or a requested completion; message edits
alone are not a notification strategy.

**Completion bar:** every state renders correctly on desktop and mobile, in light
and dark themes, with long names, long answers, attachments, missing permissions,
expired actions, and errors. Labels work without relying on color or emoji. Keyboard
and screen-reader interaction is usable. A new user can identify the task's state
and next action within five seconds in a usability test. At least 90% of pilot
users finish the standard task/review/correction flows without explanation.

## 2. Conversation, task identity, and collaboration

**Excellent means:** people speak normally, can interrupt or refine work, and do
not have to manage Wack's sessions. Separate conversations never accidentally share
instructions or authority.

Support mentions, replies to Wack, replies to a source message, existing threads,
DMs where the integration is permitted, and message context commands such as Ask
Wack, Summarize, and Turn into a task. Slash commands should help with discovery,
settings, and task management; ordinary work should not require learning a command
language. Short voice notes should enter the same task flow through transcription.

Introduce explicit task identity and reply routing. A reply to a card continues
that task. A new request in a busy channel can start an independent task. Existing
threads retain an understandable continuation policy. A follow-up with an ambiguous
target gets a small task chooser rather than silently attaching to unrelated work.
Use task threads when discussion or output warrants them, without creating a thread
for every small answer.

This changes the current channel/thread-based continuation boundary and must have a
separate migration design. Do not simply change a Redis key and orphan active runs.
Preserve old continuation mappings while existing work drains; route new tasks
through the new identity map. Serialize changes to the same task and conflicting
provider objects while allowing genuinely unrelated tasks to proceed independently.

Represent every contribution with its author, task, source message, and time. The
requester's authority is not inherited by everyone who replies. Make assignment,
handoff, and shared review explicit. “Make that shorter,” “use the other contact,”
and “stop” should work against the correct current draft or task. Acknowledge a
change immediately, preserve it durably, and explain any external effect that was
already completed before cancellation arrived.

Keep the current request distinct from quoted evidence. Explicit replies and
attachments may supply context; arbitrary nearby channel chatter must not become
instructions. Treat retrieved messages, document text, and historical bot promises
as evidence, never as fresh authorization. Maintain source boundaries after summary
and compaction.

Use a consistent voice: direct, capable, friendly, and suited to Purdue Hackers.
Lead with the answer or action. Ask only for information that materially changes
the result. Reuse decisions already made in the task. Avoid redundant permission
questions and follow-up offers when Wack can finish authorized work itself.

**Completion bar:** the conversation suite covers two people working concurrently,
multiple tasks in one channel, nested replies, missing/deleted source messages,
attachments, topic changes, interruption, compaction, handoff, and restart. There
are no wrong-task actions or authority transfers in that suite. All unresolved
choices remain visible and resumable.

## 3. Main agent skills and tool orchestration

**Excellent means:** the main agent can discover and use the full capability surface
without an extra model conversation for each provider, and without loading hundreds
of irrelevant tool schemas into every prompt.

Build the skill tree as a native deferred catalog:

1. A compact index describes domains and capabilities.
2. Search or navigation locates the relevant skill and operations.
3. The selected instructions and tool schemas load on demand.
4. The main agent calls the existing SDK/HTTP implementation through shared policy.
5. Independent reads can execute concurrently; dependent operations preserve order.

Use stable namespaced identities such as `discord.messages.search` and
`notion.pages.update`, mapped to the framework's supported identifier format.
Eliminate collisions between generic names such as search, events, and membership.
Keep descriptions specific enough to distinguish searching a service, retrieving a
known object, and changing it. Make missing configuration and permission constraints
discoverable rather than letting the model discover them through repeated failure.

Evaluate a pinned Eve upgrade in isolation before moving the catalogs. Current Eve
documents deferred capabilities and markdown-only skills that need not materialize
files in a sandbox. Verify that behavior against the installed candidate, including
our existing package patch, tool serialization, approval callbacks, role changes,
and resumed sessions. Prefer native framework support over rebuilding an agent
registry or accumulating private framework patches.
[Eve skills](https://eve.dev/docs/skills),
[Eve dynamic capabilities](https://eve.dev/docs/guides/dynamic-capabilities)

Preserve authorization at discovery and execution. Loading a skill never grants
permission. Cache static catalog metadata, while deriving access from the current
actor and current task. Provider credentials remain outside model-visible text.

Subagents remain available for large independent research branches, independent
review, or a native execution task that benefits from separate context. Each
delegation has a clear deliverable, bounded context, and explicit join/cancel rules.
A provider boundary alone is not a reason to delegate. Do not add another LLM
router in front of the main agent without evidence that its quality and latency
benefit exceeds its extra call.

**Completion bar:** all 670 existing provider definitions are accounted for in a
before/after parity manifest; all 106 existing skills are retained, merged, or
replaced with an explicit mapping. Ordinary single-provider tasks have zero child
agent handoffs. Loading markdown-only skills starts zero VMs. Cross-provider tasks
use the appropriate operations without exposing the entire catalog on every step.

## 4. Complete integrations and dependable actions

**Excellent means:** Wack can finish the work a provider supports, including the
less glamorous steps around search, pagination, schemas, uploads, updates, and
verification. A large tool count is not a substitute for reliable workflows.

Maintain a capability ledger for every provider. Each operation records its API or
SDK source, account scope, implementation, permission, readiness, pagination,
input/output contract, side-effect behavior, verification, and known limitation.
Use distinct states for implemented, configured, validated, unavailable under the
organization's plan, and unsupported by the provider API. Nothing should be counted
as working merely because a wrapper exists.

Generate repetitive typed bindings from official specifications where useful, then
add curated operation descriptions and policy. Keep a structured escape path for
supported long-tail operations, with validation and policy; do not expose a generic
credential-bearing arbitrary request tool. Preserve full operation coverage while
keeping high-value compound workflows easy to discover.

| Domain     | Authored tools today | Completion scope                                                                                                                                        |
| ---------- | -------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord    |                   68 | Messages, search/retrieval where available, threads/forums, channels, roles, permissions, members, events, moderation, attachments, and audit evidence. |
| GitHub     |                  119 | Repositories, code/search, issues, PRs/reviews, projects, actions/checks, releases, deployments, and supported administrative operations.               |
| Linear     |                   64 | Issues, projects, cycles, labels, relationships, comments, documents, assignment, and supported team administration.                                    |
| Notion     |                   24 | Pages, blocks, databases/data sources, live schema discovery, properties/relations, comments, search, and supported file operations.                    |
| CMS        |                   54 | Collections, content, drafts, publishing, assets, relations, scheduling, and verification of resulting public content.                                  |
| Outreach   |                   23 | Research, contacts/companies, relationship records, verified addresses, drafts, authorized sending, replies, follow-ups, and outcome reporting.         |
| Finance    |                   16 | Available ledger, transaction, budget, grant, sponsor, receipt, and reporting operations with clear read/write boundaries.                              |
| Figma      |                   33 | Available file, component, variable, image, comment, and asset operations; explicitly distinguish API read support from write support.                  |
| Vercel     |                  166 | Projects, deployments, logs, domains, environments, aliases, rollbacks, observability, storage, and available platform administration.                  |
| Cloudflare |                   29 | Available zone, DNS, Worker, route, storage, cache, rule, and observability operations.                                                                 |
| Sentry     |                   68 | Issues, events, traces, projects, releases, assignment, alerts, and available monitoring/administration.                                                |
| Shopping   |                    6 | Search, variants, availability, comparisons, quotes, carts, and authorized purchase workflows where the provider supports them.                         |

The table defines directions for coverage, not a claim that every listed operation
already works or that each provider exposes the same APIs. Enumerate the remaining
official surface and explain each exclusion. Add organization-managed calendar,
email, document/spreadsheet, web research, and file/media capabilities wherever
they close genuine gaps. Users should not have to supply an account to make a
promised capability work.

Every integration needs complete pagination, schema-aware input validation,
normalized errors, bounded retries, rate-limit handling, result-size controls,
stable object links, and clear handling of partial results. Resolve mutable provider
schemas instead of assuming property names. Preserve native IDs internally. Return
an actionable explanation when an object is missing or access is unavailable.

Mutations return receipts: target, action, provider identifier, timestamp, and
verification where the API permits it. Distinguish draft creation, send acceptance,
delivery, publication, and later human response. A successful request is not proof
of a downstream outcome. For multi-step tasks, retain the succeeded steps and expose
the remaining work; do not restart the entire sequence blindly.

**Completion bar:** 100% of existing operations have a parity decision; every newly
promised operation is configured and exercised end to end. The published coverage
ledger has no silent omissions. Each domain passes representative discovery,
read/write, pagination, schema-change, permission, and failure cases. Compound
workflows verify resulting objects in their actual destination.

## 5. Speed and economical execution

**Excellent means:** Wack acknowledges immediately, finishes ordinary work quickly,
and spends additional time only when it improves the result or waits on a real
dependency. Progress should make long work understandable without masking latency.

Instrument the full path before tuning: Discord receipt, queue delay, context
assembly, catalog discovery, model start/first token, every model and tool call,
provider wait, optional sandbox initialization, rendering, and final visibility.
Track model-call count, delegation count, input/output tokens, cache behavior,
timeouts, and provider retries with the same task correlation.

Use these initial release targets, measured from the initiating Discord event to
the visible result. They are proposed targets, not current measurements.

| Task class                                                   | p50 target | p95 target |
| ------------------------------------------------------------ | ---------: | ---------: |
| Interaction acknowledgement or defer                         |     250 ms |     750 ms |
| Useful first response or meaningful status                   |   1 second |  2 seconds |
| Simple conversational answer                                 |  3 seconds |  8 seconds |
| One ordinary provider read and answer                        |  5 seconds | 12 seconds |
| Routine workflow with up to three short dependent operations | 12 seconds | 30 seconds |

Publish raw latency and its breakdown by workload, provider, and cold/warm execution.
Human review and inherently long external jobs have separate waiting states; do not
hide queueing, retries, or provider outages by silently removing them from reporting.
Long-running work needs prompt acknowledgement, accurate state, and useful progress,
not an arbitrary fast completion promise. Discord requires the initial interaction
response within three seconds; its original interaction token lasts 15 minutes.
Long-lived tasks need durable message identifiers and bot-authenticated updates.
[Discord interaction lifecycle](https://docs.discord.com/developers/interactions/receiving-and-responding)

The main changes are:

- Remove routine provider delegation and avoid repeated planning/summarization hops.
- Make task navigation, status inspection, structured choices, and other known UI
  transitions deterministic. Opening a task or acknowledging an edit should not
  require an LLM call. Reserve capacity for steering and cancellation so a large
  background job cannot make the interface unresponsive.
- Cache static skill metadata and compiled schemas. Keep task context compact while
  preserving constraints and source references. Cache provider reads only with
  appropriate freshness, permission scope, and invalidation.
- Batch independent reads and use provider bulk endpoints. Do not parallelize
  conflicting writes or speculate with side effects.
- Use fair queues and explicit concurrency limits across users, tasks, and providers.
  A slow integration or large job should not hold unrelated interactive work behind
  it. Show queueing honestly and measure it as part of the user's latency.
- Keep semantic progress and lease heartbeats separate from Discord paint. Coalesce
  renders without delaying input acknowledgement or terminal visibility.
- Review synchronous budget/audit/telemetry work on the critical path. Batch or move
  only nonessential work; required authorization and durable action receipts stay
  on the correct side of the effect.
- Compare candidate model configurations on the same quality suite. Change the
  model only when measured latency/cost improves without weakening completion or
  tool-use quality.

Use three execution paths. API calls and skill loading need no workspace. Ordinary
shell/data work gets a just-bash virtual filesystem. Native builds, browsers, or
media tools get an isolated real sandbox on demand. The Discord gateway remains a
long-running Bun process on real compute.

The just-bash provider must preserve bounded files and environment state in durable,
session-scoped storage across workflow steps and fresh instances. Persist completed
changes before acknowledging the step, use versioned updates for concurrent access,
and define recovery after an ambiguous checkpoint. Store large artifacts separately
and retain references. Enable Python/WASM and QuickJS deliberately; guide JavaScript
to `js-exec`. Keep host credentials and arbitrary host process execution inaccessible.
Never mix mutually untrusted sessions in one shared writable workspace merely to
save startup time.

**Completion bar:** ordinary skills/API tasks create zero VMs; just-bash survives
restart and cross-instance resume without file loss; heavy-work escalation works
without losing artifacts; latency targets pass for the named workload classes;
quality does not regress against the frozen baseline. Report cost per successfully
completed task, rather than cost per model call.

## 6. Knowledge, research, memory, and multimodal input

**Excellent means:** Wack finds the right evidence, understands its context, and
uses it to complete the request. It can explain where an answer came from and
does not confuse an incomplete search with the absence of information.

Provide a unified, permission-aware research flow across Discord, repositories,
project trackers, documents, the CMS, and public web sources. Keep exact search for
names, IDs, dates, and quotes alongside semantic retrieval. Expand the relevant
thread or document when the answer requires context, then cite the original object
or message. Prefer the current authoritative record when copies disagree.

Ingest images/screenshots, PDFs, documents, spreadsheets, and audio/voice notes into
the same task. Preserve the original attachment, extraction method, page or time
location, and any ambiguity. OCR/transcription output is derived evidence; retain a
path back to the source. Re-fetch expired attachment URLs through an authorized
reference where possible, and ask for replacement only when recovery is impossible.

Separate active task context, personal preferences, project facts, and shared
organizational knowledge. Every durable memory needs scope, provenance, update time,
and a way to inspect, correct, or forget it. Corrections should improve future work
without silently promoting one person's statement into organization-wide policy.
Edits, deletions, and access changes must invalidate derived data and caches.

Measure retrieval by whether all material facts needed for the question are present
and supported. Evaluate conflicting versions, ambiguous entities, missing sources,
time-sensitive questions, and multi-step history. Do not treat a pile of citations
or a green retrieval request as a quality pass. Any new bulk Discord indexing must
use supported access and satisfy the platform's data handling requirements before
production adoption.

**Completion bar:** the held-out research set meets the evidence-completion target
below, answer citations resolve to actual sources, attachment extraction retains
provenance, and deletion/permission-change cases remove access reliably. People can
correct or forget saved context through Discord. Missing evidence remains visible.

## 7. Durable work, routines, and proactive usefulness

**Excellent means:** a task continues to make sense after a process restart, a long
approval wait, or a return tomorrow. Wack can own recurring work without requiring
someone to repeatedly prompt it or tolerate irrelevant notifications.

Give every substantial task a stable identifier, owner, origin, current revision,
source references, outputs, and history. Build a Discord task view for active,
waiting, scheduled, failed, and completed work with filters by person and channel.
Link every view back to the canonical card. Keep durable business history separate
from ephemeral transport state; derive running status from the existing execution
owner rather than adding a second competing queue/state machine.

Implement pause, resume, cancel, retry the unfinished part, edit the request, and
continue from a completed result. After restart, recover accepted human input,
approvals, artifacts, and notifications. If an external action's outcome is uncertain,
reconcile with the provider before retrying. Cancellation must say what was already
done and stop further authorized work where the provider permits it.

Support one-time tasks, recurring routines, conditional monitoring, and bounded
multi-step sequences. Natural language should produce an inspectable routine with
its scope, owner, schedule/timezone, next run, success condition, permissions, and
notification destination. Users can edit, pause, or delete it in Discord. Handle
DST, duplicate scheduler delivery, missed runs, expired credentials, and revoked
roles explicitly.

Turn successful repeatable work into a versioned routine when requested. Capture
inputs, tools, verification, stopping conditions, and exceptions; save useful
procedural knowledge rather than replaying an opaque conversation. Preview the
routine's effects and preserve the authorization attached to its scope.

Monitoring should report a meaningful change, completed work, failure needing action,
or requested digest. Keep unchanged checks quiet. Use per-task notification choices,
quiet hours, and opt-in DMs. A scheduled task that needs fresh human approval parks
with a clear review item instead of silently skipping the step or treating a
schedule as unrestricted permission.

**Completion bar:** routines survive restarts and timezone transitions, permission
changes are honored, duplicate delivery does not duplicate effects, and every run
has a durable outcome. Active work is findable without scrolling through old chat.

## 8. Finished deliverables and cross-tool workflows

**Excellent means:** Wack returns usable work in the right place and format. Users
should not need to copy a long response into another app and finish the task by hand.

Support durable files and editable destination artifacts: documents, spreadsheets,
presentations, reports, research packets, drafts, code changes, images, and supported
media. Each artifact has a stable reference, title, type, owner/access scope,
version, preview, and source task. Render the appropriate preview in Discord, with
download/open/edit actions. A local temporary path is not a delivered artifact.

The main agent should move naturally between research, creation, review, and action.
An event workflow can inspect the CMS, prepare content, check assets, update the
event, and verify the public result. A bug workflow can gather evidence, identify
the relevant code, prepare a change in isolated compute when needed, and present a
reviewable result. An outreach workflow can preserve the relationship history,
prepare a relevant draft, record the authorized send, and track the outcome.

Use typed result contracts for links, files, changes, sources, and follow-up actions
so the Discord renderer does not guess semantics from prose. A completed result
states what was delivered and links to it. A partially complete result preserves
the useful output and identifies the specific remaining dependency. Avoid claiming
publication, delivery, deployment, or collection based only on preparation.

Add a deliberate finishing pass: check that the result answers the whole request,
links and files open, layouts render, requested format is correct, and the destination
contains the intended change. Workflows involving rendering should inspect the actual
rendered output. Keep domain-specific quality requirements with each workflow.

**Completion bar:** every supported artifact opens and is usable from Discord on
mobile and desktop; edits create understandable revisions; permissions and retention
match the task; and reference workflows complete across provider boundaries without
manual copying or repeated instructions. The workflows are validation scenarios,
not a limit on available tools.

## 9. Reliability, authority, observability, and release quality

**Excellent means:** visible state is truthful, actions are attributable, failures
are recoverable, and a refactor cannot silently weaken the system's existing
coordination guarantees.

Preserve the current ownership model: the bot owns Discord I/O and projection; the
agent owns reasoning and provider tools; the shared conversation layer owns fenced
transitions; durable stores own task history, schedules, and action records. Keep
the existing terminal visibility barrier and duplicate suppression. Do not rebuild
these guarantees inside a new card renderer.

Unify policy across authored and framework-default capabilities. Check the current
actor and target scope at execution, refresh authority at sensitive boundaries, and
verify both requester and approver when two people are required. Do not ask again
for already authorized work. When review is required, bind it to the exact target,
payload, and revision; editing the draft invalidates an old approval. Old buttons
must return an understandable state without replaying an action.

Review the documented approval-routing and framework-default coverage gaps against
current code before expanding access. Private data must not leak through shared
cards, search results, file previews, logs, or error text. External fetching needs
appropriate destination, redirect, and size controls. Treat provider credentials
as organization infrastructure, not conversation context.

Use a typed error model that distinguishes temporary provider failure, rate limiting,
missing configuration, permission denial, invalid input, changed schema, uncertain
effect, and permanent failure. Limit automatic repair attempts, and stop repeated
calls that cannot resolve the same error. A partially successful workflow keeps its
receipts and resumes from the remaining step.

Give operators one correlated task timeline covering ingress, routing, model/tool
calls, policy, provider results, storage, and Discord rendering. Track stale work,
queue age, renderer divergence, model/provider failure, unavailable capabilities,
notification delivery, latency, and cost. Show useful diagnosis without exposing
raw secrets or private payloads. A card's status must correspond to persisted
execution, including after a bot replacement or deployment.

Build a frozen release suite of at least 200 representative scenarios, balanced
across the 12 domains and including cross-provider work, conversation, retrieval,
artifacts, permissions, and recovery. Add scenario coverage when new features land.
Use offline fixtures for determinism, controlled integration environments for real
provider behavior, and actual Discord clients for rendered UX. Keep live/generative
evaluation within the explicitly approved model and account scope.

**Completion bar:** at least 95% strict end-to-end success overall and in each
primary workflow class; at least 95% required-fact evidence completion on the
held-out research suite; no known unsupported material claims or false success
receipts in accepted results; and 100% passing permission, duplicate-effect,
stale-approval, interruption, and restart invariants in the release suite. Publish
sample counts and failure categories so the percentages cannot conceal gaps.

## Implementation sequence

Ship coherent vertical slices with explicit gates. The broad scope is the target;
sequencing it should not turn a partial implementation into a claim of completion.

| Stage                         | Deliverables                                                                                                                                                  | Exit gate                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 0. Baseline and contracts     | Capability ledger, representative task corpus, latency tracing, task/card state specification, current-code audit, and a rendering matrix.                    | Baseline results are reproducible; the selected work-card direction has every lifecycle state specified.          |
| 1. Main agent and runtime     | Isolated Eve upgrade evaluation, namespaced deferred catalogs, parity migration, direct execution, and durable just-bash provider.                            | Existing capabilities retained; no VM for skill/API work; resume, policy, serialization, and latency checks pass. |
| 2. Discord experience         | Typed result/card contract, renderer, task routing, contextual actions, human-input flows, steering/cancellation, and compatibility with active old sessions. | Complete tasks work in real Discord on desktop/mobile, including concurrent users and failures.                   |
| 3. Integration completeness   | Provider-by-provider missing surface, schema/pagination/receipt repair, organization-managed readiness, and compound workflows.                               | Coverage ledger and domain acceptance suites pass; critical workflows are fully usable.                           |
| 4. Knowledge and deliverables | Permission-aware retrieval, multimodal input, inspectable memory, durable artifacts, and destination verification.                                            | Evidence, artifact, edit/delete, and access-change suites pass.                                                   |
| 5. Ongoing work               | Task inbox, saved routines, schedules, monitoring, notification controls, and outcome history.                                                                | Restart, duplicate-delivery, timezone, approval, and long-running-task suites pass.                               |
| 6. Release hardening          | Failure injection, accessibility/rendering review, load and latency checks, canary rollout, operations documentation, and rollback drill.                     | All release bars pass in the pilot and the measured production observation period.                                |

UI prototyping and capability inventory can proceed while runtime compatibility is
evaluated. Catalog/runtime and renderer changes should remain independently
switchable during rollout. Each stage includes its own tests and recovery behavior;
reliability is not postponed until Stage 6.

Start the canary in a designated test channel, then a small organizer cohort, then
broader use. Compare old and new behavior on read-only/shadow evaluation where
possible; never run real writes twice for comparison. Keep legacy handlers for
outstanding cards, approvals, and sessions until they drain or are explicitly
migrated. Rollback must preserve accepted work, action receipts, and durable files.
Do not stop active sandboxes or reset conversations as a generic deployment tactic.

Associate each task with a compatible execution version. An Eve upgrade or catalog
rename must not make a parked tool callback impossible to deserialize. New tasks
can adopt the new runtime while existing tasks finish on the compatible version;
remove old handlers only after that compatibility obligation has ended.

## Engineering ownership and proof

| Workstream                | Existing code to build on                                                                                                                                                                       | Proof required                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cards and interactions    | [Renderer](../../packages/bot/src/agent/render/renderer.ts), [interactions](../../packages/bot/src/agent/hitl/interaction.ts), and [wire contract](../../packages/shared/src/wire.ts)           | State fixtures plus actual Discord rendering and action handling.                              |
| Task routing and steering | [Chat routing](../../packages/bot/src/events/agent-chat.ts), [message context](../../packages/bot/src/agent/message-context.ts), shared conversation transitions, and the agent Discord channel | Concurrent tasks, attribution, interruption, backward compatibility, and recovery.             |
| Main-agent catalog        | [Policy runtime](../../packages/agents/agent/lib/policy/domain-runtime.ts), provider registries, and skill/tool catalogs                                                                        | Capability parity, deferred discovery, role changes, serialization, and zero routine handoffs. |
| Runtime and speed         | Agent configuration, Eve sandbox adapter, usage/audit hooks, render publisher                                                                                                                   | Full traces, cold-instance file recovery, execution isolation, latency, and cost.              |
| Provider completeness     | Existing provider SDK/HTTP implementations and `lib/tool_defs`                                                                                                                                  | Coverage manifest, schema/pagination cases, real destination verification, and receipts.       |
| Ongoing work and history  | Existing schedule store/dispatcher, shared conversation transitions, durable database                                                                                                           | Lifecycle and duplicate-effect invariants; findable history and reliable notifications.        |

Use Bun throughout. Implementation changes must pass `bun run lint` with
`--deny-warnings`, `bunx oxfmt --check .`, relevant capability/serialization checks,
and meaningful focused tests with `bun test`. Do not weaken lint rules or substitute
a mocked renderer for Discord verification. Documentation that disagrees with
current source is a migration item, not a reason to silently assume behavior.

Useful existing references are the
[architecture](../../docs/architecture.md),
[conversation engine](../../docs/system/conversation-engine.md),
[control plane](../../docs/system/control-plane.md), and
[policy and integrations](../../docs/system/eve-policy-and-integrations.md).

## Reference journeys for release review

| Request                                                | Required complete outcome                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| “What did we decide about this?” replying to a message | Correct contextual answer, original-message evidence, and explicit remaining uncertainty.                            |
| “Find five relevant partners and prepare outreach”     | Relevant prospects, relationship/Do Not Contact checks, evidence, useful drafts, and a reviewable next action.       |
| “Publish this event with these images”                 | Validated content/assets, any required review, provider receipt, and verified public result.                         |
| “Make an issue from this error and investigate it”     | Correct project/owner, linked evidence, investigation, and a concrete result or precise blocker.                     |
| “Analyze this spreadsheet and make a report”           | Correct computation, inspectable assumptions, usable report, and durable source/output files.                        |
| “Watch this deployment and tell me if it fails”        | Inspectable monitor, quiet unchanged checks, meaningful notification, and cancellation controls.                     |
| “Actually, use the other date” during active work      | Correction attached to the correct task, stale approvals invalidated, and updated output without duplicated effects. |
| Return after a restart or the next day                 | The same task, files, decisions, and remaining actions are available from its card or task view.                     |

The refactor is complete when these journeys and the wider coverage suite work
consistently, existing capabilities remain available, the measured speed improves,
and every important state is understandable inside Discord. A polished mockup,
large catalog, or successful build alone does not meet that bar.
