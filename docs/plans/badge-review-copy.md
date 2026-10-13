---
meta:
  contentType: Reference
---

# Review the badge interactions before release

Use this checklist to compare the implementation with the approved Discord flow. Designers need one visible design and one logical next step. Organizers need the event details, physical size, and an explicit approval button.

## Approved presentation

Apply the supplied Vercel writing guidelines within Discord’s supported features:

- **Messages**: Send one embed per turn. Keep copy short and specific. Never rewrite earlier messages.
- **Previews**: Show a full design. Combine A/B files or both cutting sheets into one image when needed. Do not generate close-ups.
- **Controls**: Put native buttons and selects below the embed. Request changes uses a Label and required Text Input. Upload uses a Label and File Upload.
- **Progress**: Use typing while work runs. Do not post separate checking, preparing, packing, or publishing cards.
- **Language**: Explain a concrete action in the design app. Keep code, status symbols, diagnostic details, and internal policies out of copy.

## Completed offline checks

Validation uses the actual service, worker, SVG renderer, packing audit, and Discord builders with a local database. External services are replaced with controlled responses; no new test files are committed.

The walkthrough verifies these outcomes:

- **Normal flow**: Badge review, stamp review, arrangement, and download produce exactly four one-embed messages.
- **Inference**: Explicit attachment order and exact CMS versions skip questions. Ambiguous files get A/B controls; one missing file gets one upload control.
- **Production**: A 3:1 stamp becomes 4.5 × 1.5 inches and mirrors once for cutting. Arrangement retains the accepted badge size.
- **Corrections**: A static failure blocks approval. A stamp revision preserves badge approval. Changed event details require another badge review.
- **Controls**: Required feedback and upload modals serialize to native Discord components. Unauthorized people cannot open them; stale submissions receive a private jump link.
- **Concurrency**: Competing decisions produce one accepted mutation. Repacking preserves design decisions.
- **Recovery**: A failed shortlink retains the merge receipt. Retry finishes the link without merging again. A published review accepts a new revision while preserving the previous link.

## Completed live checks

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

Before release, exercise a fresh submission through the deployed badge app, a denied interaction from another account, and a requested revision attached as a message. General Eve routing and production infrastructure were not exercised by the full local runner. Publication permission and redirect propagation were verified with disposable assets; intended production designs and physical cutting still need review.

The implementation and pull request remain open for review. Do not treat offline SVG or layout checks as a physical laser test.
