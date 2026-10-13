---
meta:
  contentType: Reference
---

# Review material previews and inventory before release

Start the designer’s workflow with an acrylic selection from available stock. Use that selection in the rendered image, interactive viewer, and cutting-sheet allocation. Show the file checks that passed inside **Check your badge**.

## Implementation plan

The goal is to choose acrylic and confirm a badge using the same material throughout. Designers choose from a native Discord menu; organizers maintain inventory; maintainers configure dimensions and spacing.

Apply these decisions:

- **Preview**: Adapt the extrusion, engraving, and acrylic presets from [Purdue Hackers’ badge viewer](https://github.com/purduehackers/badges/tree/8598f7513f993f30389470c85b88427db46256f1). Render a PNG in Chromium and store it with the checked revision.
- **Dimensions**: Use the physical SVG’s cut outline and millimeter coordinates. Render the selected acrylic at its stock thickness. The preview does not simulate laser strength.
- **Selection**: Offer materials with available 12 × 12-inch and 12 × 18-inch sheets at the configured thickness. Validate the designer’s selection against current inventory. Keep the selection through file revisions and never substitute another material during packing.
- **Checks**: List only passing checks tied to the current badge file: supported SVG features, vector artwork, outlined lettering, engraving fills, grayscale, and a closed red cutting outline. Keep version, date, readability, and strength as designer checks.
- **Presentation**: Combine the full flat design and angled material preview into one image. Add a native **View in 3D** link beside the confirmation and revision buttons. Share the same scene between the image and interactive viewer.
- **Stock**: Track material, sheet dimensions, thickness, and whole-sheet count. Keep an audit of the organizer, change, and optional note.
- **Commands**: Add `/badge inventory list`, `add`, `use`, `set`, and `history`. Use native autocomplete and one private embed per result.
- **Consumption**: Allocate the selected material to occupied cutting sheets and reserve it during publication. Deduct those sheets after GitHub verifies the saved files. If stock runs out, ask for a new selection or replenishment. A material change requires a fresh badge confirmation. Keep `add`, `use`, and `set` for manual changes.
- **Permissions**: Guild members can read inventory. Fresh organizer membership permits stock changes. The model has no inventory write tool.
- **Recovery**: Reject negative counts and changes that consume reserved sheets. Save each deduction and its receipt together so retries cannot apply it twice. Release reservations when an event change stops publication before merging. Keep uncertain publication attempts reserved until a retry resolves them.
- **Viewer access**: Sign the exact asset, material, and thickness. Serve only that checked design, with bundled scripts and a restrictive Content Security Policy. Keep credentials out of the page.

The confirmed behavior deducts sheets when files publish and includes an interactive preview link. A newly published revision consumes another set; a retry does not. Stamp rubber remains manual because the stamp export does not define whole-sheet use. Historical import remains outside this change.

## Documentation plan

Update the architecture page to explain rendering and the stock boundary. Add a separate [inventory guide](../badge-inventory.md) for recording purchases, use, and corrected counts. Keep technical rendering instructions outside designer-facing copy.

## Validation to review

Review the actual preview image, native command schema, and inventory audit behavior. Validate bounded rendering, safe SVG rejection, rotated sheet dimensions, duplicate requests, concurrent use, and permissions. Confirm the production build includes Chromium and its software rendering libraries. No physical cutting result establishes itself from a preview.

## Verified locally

The actual service, worker, database, renderers, and Discord builders complete the five-step workflow. The walkthrough validates 15 cards across 18 checks, including material selection, revisions, stale controls, packing, and publication recovery. External publication responses use controlled fixtures.

Focused checks pass:

- **Inventory**: Duplicate interaction receipts, rotated dimensions, overuse rollback, zero counts, organizer permissions, competing reservations, atomic publication deductions, autocomplete, pagination, and command serialization
- **Material selection**: Seven focused checks cover available stock, all 42 acrylic choices, material changes, render differences, current-file evidence, shortages, and restocking. Changing material requires badge confirmation again and preserves the stamp confirmation. Packing never substitutes another acrylic.
- **Publication recovery**: The worker releases stock when event changes prevent a merge. After a lost merge response, retry verifies the saved files and consumes once, even if the event has since changed. Link retries do not consume stock.
- **Viewer**: The local Eve endpoint serves signed designs and rejects altered asset, material, thickness, or signature parameters. Browser checks verify rotation, zoom, and reset. Script input fails validation; inline data cannot terminate the script element.
- **API**: Authenticated reads, bearer rejection, malformed input, guild scope, and organizer denial against the local Eve app
- **Images**: A badge, curved outline with offset coordinates, and narrow sword geometry retain artwork alignment. The combined image uses the production Discord attachment composer.
- **Linux**: The pinned Chromium package renders with network access disabled in an emulated Linux x64 container. The latest cold render takes 22.6s; this is not a deployed latency measurement.
- **Builds**: Lint, formatting, existing tests, database migrations, capability checks, serialization checks, both Eve apps, and the Linux bot image pass. The badge build includes Chromium and its software rendering libraries.

The [Discord attachment](../images/badge-material-preview.png) and [interactive viewer screenshot](../images/badge-viewer.png) use disposable test artwork. A local bot completed the designer confirmations, plain question reply, interactive viewer, publication, and inventory deduction in #p-wack-hacker. A subsequent revision verified the native acrylic menu, six passing checks, and selected red material in both previews. The new revision stopped before publication and left the seeded local stock unchanged.

Slash-command registration, production stock entry, and physical cutting remain deployment checks. No production stock or material counts changed. No new test files are committed.
