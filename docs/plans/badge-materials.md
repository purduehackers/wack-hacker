---
meta:
  contentType: Reference
---

# Review material previews and inventory before release

Keep the designer’s four-step workflow. Add a rendered 3D badge beside the flat artwork, inside the existing badge embed. Add native Discord commands for organizers to track whole sheets.

## Implementation plan

The goal is to check a material preview and configure stock without adding a designer questionnaire. Designers see the image; organizers maintain inventory; maintainers configure rendering and publication.

Apply these decisions:

- **Preview**: Adapt the extrusion, engraving, and acrylic presets from [Purdue Hackers’ badge viewer](https://github.com/purduehackers/badges/tree/8598f7513f993f30389470c85b88427db46256f1). Render a PNG in Chromium and store it with the checked revision.
- **Dimensions**: Use the physical SVG’s cut outline and millimeter coordinates. Show an example of ⅛-inch light blue acrylic. The example does not assign stock or simulate laser strength.
- **Presentation**: Combine the full flat design and angled material preview into one image. Keep the existing confirmation and revision buttons. Do not add a viewer link or close-ups.
- **Stock**: Track material, sheet dimensions, thickness, and whole-sheet count. Keep an audit of the organizer, change, and optional note.
- **Commands**: Add `/badge inventory list`, `add`, `use`, `set`, and `history`. Use native autocomplete and one private embed per result.
- **Consumption**: Record actual use with `use`. Publishing does not consume or reserve sheets. Inventory does not change the configured packing sheets.
- **Permissions**: Guild members can read inventory. Fresh organizer membership permits stock changes. The model has no inventory write tool.
- **Recovery**: Reject negative counts. Save a mutation and its receipt together so a retry cannot apply it twice. Keep failed renders retryable through the existing workflow.

The designer selected an embedded rendered image. No reply selected automatic consumption, so this implementation records actual use explicitly. Historical import and new material-selection steps remain outside this change.

## Documentation plan

Update the architecture page to explain rendering and the stock boundary. Add a separate [inventory guide](../badge-inventory.md) for recording purchases, use, and corrected counts. Keep technical rendering instructions outside designer-facing copy.

## Validation to review

Review the actual preview image, native command schema, and inventory audit behavior. Validate bounded rendering, safe SVG rejection, rotated sheet dimensions, duplicate requests, concurrent use, and permissions. Confirm the production build includes Chromium and its software rendering libraries. No physical cutting result establishes itself from a preview.

## Verified locally

The actual service, worker, database, renderers, and Discord builders complete the four-step workflow. The walkthrough validates 14 cards, including revisions, stale controls, packing, and publication recovery. External publication responses use controlled fixtures.

Focused checks pass:

- **Inventory**: Duplicate interaction receipts, rotated dimensions, overuse rollback, zero counts, organizer permissions, concurrent consumption, autocomplete, pagination, and command serialization
- **API**: Authenticated reads, bearer rejection, malformed input, guild scope, and organizer denial against the local Eve app
- **Images**: A badge, curved outline with offset coordinates, and narrow sword geometry retain artwork alignment. The combined image uses the production Discord attachment composer.
- **Linux**: The pinned Chromium package renders with network access disabled in an emulated Linux x64 container. The measured cold render takes 20.1 seconds; this is not a deployed latency measurement.
- **Builds**: Lint, formatting, existing tests, database migrations, capability checks, serialization checks, both Eve apps, and the Linux bot image pass. The badge build includes Chromium and its software rendering libraries.

The [preview image](../images/badge-material-preview.png) uses disposable test artwork. Live Discord registration, production stock entry, and physical cutting remain deployment checks. No production stock or material counts changed. No new test files are committed.
