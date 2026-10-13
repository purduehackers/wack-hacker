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

## Remaining live checks

The previous Discord demos used an earlier flow. They do not validate this revision. Keep the local bot stopped until a new live demonstration is requested.

Before release, exercise these cases in a fresh testing thread:

- **Native client behavior**: Open file uploads and feedback modals in Discord, including a denied and stale interaction.
- **Delivery**: Follow the four-turn path and upload a requested revision without another mention.
- **Providers**: Verify production credentials, bot permissions, repository protection, and live shortlink propagation in the intended environment.

The implementation and pull request remain open for review. Do not treat offline SVG or layout checks as a physical laser test.
