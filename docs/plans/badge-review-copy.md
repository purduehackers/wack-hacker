---
meta:
  contentType: Reference
---

# Review the badge interactions before release

Use this checklist to verify the designer’s workflow before release. You double-check your own badge and stamp, confirm each design, then publish the cutting files.

## Plan the designer’s next action

The goal is to help you confirm your work without handing it to a separate reviewer. Workflow cards show the design and its next action. Questions receive short, plain messages.

Apply these decisions to the implementation, agent instructions, and architecture documentation:

- **Badge**: After file checks pass, show **Automatic verification** and **Manual verification** together, with **Confirm badge** and **Upload revised badge** below.
- **Stamp**: Show the same verification pair, with **Confirm stamp** and **Upload revised stamp**, after badge confirmation.
- **Revisions**: Open the native file upload directly. Do not ask you to write feedback to yourself.
- **Publication**: Show **Publish files** after both confirmations and arrangement. Only the original designer can confirm or publish their work.
- **Conversation**: Answer questions in plain text. Expose each button action as an agent tool using the same controller. Keep each workflow step in one message.
- **Quantity**: Replace layout retries with calculated defaults and a native custom-quantity modal. Accept the same targets through chat.
- **Sizing**: Search within configured limits for larger targets. Generate a new preview and reopen only badge confirmation when size changes.

Keep existing revision checks, static checks, and publication safeguards. Preserve the agreed metadata shape; its existing `reviewer` field records the designer who confirms publication. No product decisions remain open for this change.

## Approved presentation

Apply the supplied Vercel writing guidelines within Discord’s supported features:

- **Messages**: Send two embeds for design verification after file checks pass. Use one embed for failed checks and other workflow steps. Answer questions in plain messages. Update completed titles and selections while preserving verification evidence.
- **Automatic verification**: List all six file checks with ✅ or ❌. Mark missing or uncertain evidence as “Not verified.” Use only evidence from the current file. Keep this embed’s result unchanged when the designer confirms.
- **Manual verification**: Show the expected details, design preview, and next action only after file checks pass. Keep this embed yellow until confirmation.
- **Previews**: Show a full design. Label uploads with filenames and add Badge or Stamp after identification. Keep the image inside its embed when editing the card. Do not generate close-ups.
- **Controls**: Put native buttons and selects below the embed. **Upload revised badge** and **Upload revised stamp** open a Label and File Upload directly.
- **Progress**: Use typing while work runs. Do not post separate checking, preparing, packing, or publishing cards.
- **Completed steps**: Remove all buttons after an accepted action. Use **✅ Badge Selected** with the file assignments and **✅ Acrylic Selected** with the chosen material. Use yellow for input or ongoing work, green for completion, and red for failures. Opening an upload dialog does not complete the step.
- **Failed checks**: Put the checklist, repair guidance, and design preview in one **Automatic verification** embed with an upload button. File failures block confirmation. A pending upload never hides failed checks. Label the completed card **Previous verification** and preserve its findings when a revision arrives.
- **Revised files**: Show the new preview and current check results before asking for more input. If the Hack Night is unknown, include both in the event selection card.
- **Language**: Explain a concrete action in the design app. Use status emoji in the automatic checklist and completed titles. Keep code, diagnostic details, and internal policies out of copy.

## Designer confirmation checks

The current implementation passes a local walkthrough using the actual service, worker, database, SVG renderer, and Discord builders. The designer has no organizer roles. External publication responses use controlled fixtures.

The walkthrough and focused interaction checks verify:

- **Ownership**: The original designer confirms both designs and publishes. A different organizer cannot confirm or replace the designer’s files.
- **Revisions**: Revision buttons open the native file upload directly. Older change buttons open that same upload instead of a feedback form.
- **Copy**: All 14 generated cards use confirmation language. The normal path remains badge, stamp, arrangement, and download.
- **Questions**: The renderer sends plain text and suppresses link previews. Durable checkpoints, retry nonces, and replay suppression still work.
- **Controls**: Stale submissions receive a private link to the latest step. Signed roles, fresh membership, and file limits remain enforced.
- **Order**: Static failures block confirmation. A stamp revision preserves badge confirmation; arrangement starts after both confirmations.

Lint, formatting, the bot bundle, and all 7 existing tests pass. No new test files are committed.

The verification update passes 10 focused checks using the production Discord builders, interaction handler, and delivery loop. They cover independent embed colors, current-file evidence, preserved previews, cancelled uploads, replacements, publication receipts, edit retries, duplicate deliveries, and deleted cards.

### Selection cards and visible failures

The designer’s [new thread](https://discord.com/channels/772576325897945119/1559663827551789056) exposed a hidden palette failure and a duplicated image after editing. The worker had set a pending upload before presenting its findings. Completed-card edits had reused a resolved image URL instead of its attachment reference.

Eleven focused checks now cover filename labels, selected roles, attachment replacement, completed titles, material descriptions, all six check results, repair guidance, direct replacement uploads, removed controls, preserved evidence, and XML escaping. The real worker checks the submitted blue badge against an isolated database. A pending upload cannot hide its failed palette check.

Additional checks cover a single automatic embed for badge and stamp failures, uncertain results, and preserved findings after replacement. Passing designs still show both verification embeds. Confirming a design changes only its manual result.

Ten focused checks exercise the revision button through the real interaction handler, controller, worker, and delivery loop. Discord transport and event data use fixtures. The corrected upload passes inspection, keeps the stamp, and displays its new preview beside event selection. Selecting an event prepares that same design for confirmation. Repeated edits keep previews inside embeds even when Discord omits their attachment metadata.

The existing Discord cards now show **✅ Badge Selected**, **✅ Acrylic Selected**, and the failed automatic check with grayscale guidance. Completed cards contain no controls, and previews stay inside their embeds. The unrelated production reply was removed from this thread. Both bot instances still share an account; local testing does not prevent the production listener from answering a leading mention.

### Quantity and chat actions

A focused walkthrough uses the real controller, database, packing search, contour audit, and Discord builders. Publication uses a fixture; this check does not publish real designs:

- **Defaults**: The sample offers 80 as 37 + 43 and 100 as 37 + 63 at 2.2 inches
- **Custom target**: 120 badges fit at 2.05 inches, split 47 + 73. The size change reopens badge confirmation and preserves stamp confirmation
- **Exact exports**: After reconfirmation, both sheet files contain exactly 120 cutting outlines
- **Unmet target**: A target of 500 reports the found 158 at 1.8 inches. Publication remains blocked
- **Guards**: Unauthorized actors, stale revisions, out-of-range quantities, and premature publication fail
- **Inventory**: Fixture publication reserves and consumes the sheets once

Seven tool checks verify staged-message identity, designer ownership, stale revisions, one action per message, revision uploads, and cancellation. The agent uses the controller without accepting identity or attachment URLs from the model.

The same [Discord test thread](https://discord.com/channels/772576325897945119/1559651097570840680) verifies the live agent and controls:

- **Chat target**: “I want to have 120 badges” calls the quantity tool and produces a new 2-inch preview. The saved orientation search differs from the fresh offline run
- **Question**: Asking what to check returns plain text and records no confirmation
- **Chat confirmation**: “Confirm the badge” records the current design and prepares exactly 120 badges
- **Native quantity**: **Change quantity** shows 80 as 45 + 35, 100 as 45 + 55, and 127 as 45 + 82. The custom dialog prepares exactly 110 at the same confirmed size
- **Publication**: This run stops before publication and deducts no stock

The local listener now accepts new threads in #p-wack-hacker. A concurrently running production bot can still create plain placeholders when a message starts with its mention; those are not local workflow cards.

### Split verification and completed steps

A [new thread in #p-wack-hacker](https://discord.com/channels/772576325897945119/1559651097570840680) exercises the updated local bot through native Discord controls:

- **File failure**: Blue artwork produces one ❌ in a red automatic embed. The current presentation keeps its guidance and preview in that embed, with only an upload button
- **Revision**: The native upload modal accepts the corrected SVG. The automatic embed shows six ✅ checks in green; manual verification remains yellow
- **Confirmation**: Badge and stamp confirmations turn their manual embeds green. Both embeds retain their original evidence and previews. The current presentation removes all completed controls
- **Arrangement**: The bot arranges badges after both confirmations. This run stops before publication and leaves inventory unchanged

The production bot won the initial thread creation race and posted its own question. The test passed the original observed submission to the local route endpoint in that same new thread. The subsequent material selection, failed check, upload, confirmations, and arrangement used the running local bot.

## Earlier offline checks

The earlier workflow used organizer approvals and embedded question replies. The evidence below records that behavior before the designer confirmation change. Validation used the actual service, worker, SVG renderer, packing audit, and Discord builders with a local database.

The walkthrough verifies these outcomes:

- **Normal flow**: Badge review, stamp review, arrangement, and download produce exactly four one-embed messages.
- **Inference**: Explicit attachment order and exact CMS versions skip questions. Ambiguous files get A/B controls; one missing file gets one upload control.
- **Production**: A 3:1 stamp becomes 4.5 × 1.5 inches and mirrors once for cutting. Arrangement retains the accepted badge size.
- **Corrections**: A static failure blocks approval. A stamp revision preserves badge approval. Changed event details require another badge review.
- **Controls**: Required feedback and upload modals serialize to native Discord components. Unauthorized people cannot open them; stale submissions receive a private jump link.
- **Concurrency**: Competing decisions produce one accepted mutation. Repacking preserves design decisions.
- **Recovery**: A failed shortlink retains the merge receipt. Retry finishes the link without merging again. A published review accepts a new revision while preserving the previous link.

## Earlier live checks

On October 13, 2026, a focused local runner exercised the production handlers in Vesktop, scoped to #p-wack-hacker. CMS reads, Luna routing, Discord membership checks, controls, file downloads, rendering, and packing used real services. Review storage and saved routes were local; conversational Eve and publication were disabled.

- **Design review**: Approved the badge, requested a stamp change through the feedback modal, uploaded the revised SVG through the native file modal, and approved the stamp. Badge approval survived the stamp revision.
- **Arrangement**: Packing ran only after both approvals. The first layout held 100 badges; **Try another layout** produced 91 at the same 2.2-inch size. Both arrangements passed the contour audit and used both sheets.
- **Delivery**: Every public bot response had exactly one embed, no message text, and no edit timestamp. Repacking preserved both design approvals.
- **Stale controls**: An old approval produced one private embed with a working jump to the latest review.
- **Upload repair**: The native modal exposed a rejected `/ephemeral-attachments/` URL. The downloader now accepts that Discord path alongside ordinary attachments. Retrying the same upload succeeded. Focused checks retained the host, HTTPS, credentials, redirect, and size restrictions.

The first submission hit an expired local model token. After refreshing it, the runner replayed the original bot-observed Discord message through the routing endpoint. This was not an uninterrupted fresh-submission run.

### Full local flow

A second [fresh submission in #p-wack-hacker](https://discord.com/channels/772576325897945119/1559532100120485929) used the real badge Eve app, production conversation queue, authenticated callbacks, local Redis, and a local libSQL server with both migrations applied. Only the channel and infrastructure configuration changed; workflow, model, Discord, CMS, GitHub, and Vercel responses were real. The gateway was scoped to the test channel to avoid unrelated bot jobs.

- **Intake and conversation**: The user account uploaded both SVGs in a new channel message. The bot created the thread, classified it with Luna, resolved unpublished CMS event 240, and checked the files. A question exercised Eve and `review_status`; the next question reused the saved route.
- **Approval and arrangement**: Native badge and stamp buttons advanced one logical step each. Packing began after both approvals and fit 100 badges at 2.2 inches. The stamp measured 1.5 inches on its shortest side.
- **Publication**: **Approve & publish** created and merged [badge-designs #2](https://github.com/purduehackers/badge-designs/pull/2). All eight asset hashes matched the saved GitHub bytes. Metadata has exactly the agreed CMS, author, and reviewer objects, and the README has the agreed badge/stamp format.
- **Recovery and completion**: A rejected dotted Global Config key exposed the shortlink integration error. Badge URLs now use Vercel project redirects with a verified change set. **Retry link** completed [phack.rs/badge-0.0](https://phack.rs/badge-0.0), which returns a 307 to the saved version directory. The GitHub merge receipt stayed unchanged across retries. Discord reached **Hack Night 0.0 is ready** with **Get the files**.
- **Reply repairs**: The first Eve answer exposed a projection hash that the durable schema rejected, and preliminary assistant text repeated in the final embed. The corrected hash saves successfully; embed conversations retain the final answer while ordinary conversations preserve streaming. A subsequent real question completed with one concise reply and a durable receipt.

This was a debugging run, not an uninterrupted four-card demonstration. The earlier duplicate reply and three failed-link cards remain in its history. Every workflow/reply card has one embed, empty message text, and no edit timestamp. The CMS test event remains unpublished; the disposable 0.0 assets and shortlink are public.

Focused local checks additionally cover durable reply serialization, replay suppression, existing shortlinks, unrelated staged changes, altered existing redirects, a concurrent version change, and retrying the same staged content. No new test files are committed.

## Remaining live checks

Before release, exercise the updated designer confirmations and plain replies through the deployed badge app. Also check a denied interaction from another account and a revision attached as a message. General Eve routing and production infrastructure were not exercised by the full local runner. Publication permission and redirect propagation were verified with disposable assets; intended production designs and physical cutting still need review.

The implementation and pull request remain open for review. Do not treat offline SVG or layout checks as a physical laser test.
