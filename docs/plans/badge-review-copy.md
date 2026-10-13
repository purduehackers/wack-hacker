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

## Remaining live checks

Before release, exercise a fresh submission through the deployed badge app, conversational Eve replies, a denied interaction from another account, and a requested revision attached as a message. Complete the fourth turn with intended assets to verify repository protection, publication permissions, and live shortlink propagation. None of the disposable sample files were published.

The implementation and pull request remain open for review. Do not treat offline SVG or layout checks as a physical laser test.
