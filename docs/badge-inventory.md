---
meta:
  contentType: How-to
---

# Track your badge materials

Use `/badge inventory` to track whole sheets of acrylic and stamp rubber. You can view counts and history in the Purdue Hackers server. An organizer role lets you change counts.

## Record sheets on hand

Choose `/badge inventory add` when you receive material. Select the material from autocomplete, then enter the count, sheet width and height in inches, and thickness in millimeters. For ⅛-inch acrylic, enter `3.175` for thickness. Add a note when the purchase or storage location helps identify the stock.

The command adds to the existing count when material, dimensions, and thickness match. Rotating the dimensions does not create another item. The response shows the remaining count privately.

## Record use or correct a count

Choose the action that matches the physical sheets:

- **See stock**: Run `/badge inventory list`. Use its page option for more materials.
- **Record other use**: Run `/badge inventory use`, choose a material, and enter the sheets used outside an already published layout.
- **Correct a count**: Run `/badge inventory set` after counting the sheets. Enter `0` when none remain.
- **Check history**: Run `/badge inventory history` to see the last 10 changes, who recorded them, and their notes.

Publishing badge files deducts the acrylic sheets used in the layout. Don’t record those sheets again after cutting. Use manual commands for stamp rubber, discarded sheets, and other projects. A partly used sheet no longer counts as a whole sheet; this inventory does not track offcuts.

## Check the sheets before publication

Choose acrylic before checking your designs. One dropdown lists the available sheets by acrylic and size. Each option is one sheet; identical sheets have separate entries. Select all the sheets you want to use, including different colors or sizes. Reserved and out-of-stock sheets are excluded.

You can also tell Wack Hacker the acrylic, sizes, and quantities in chat. Discord limits a dropdown to 25 options; if inventory exceeds that, use chat to choose from the full stock. Each batch can use up to 10 sheets.

The arrangement starts with exactly those sheets. The manufacturer can change their sizes and quantities after design confirmation. The bot never substitutes another acrylic. If stock runs out, update the selection or ask an organizer to replenish it.

During publication, inventory shows those sheets as reserved. After the bot verifies the saved files, it deducts the sheets and records the Hack Night in history. Retrying publication or the shortlink does not deduct them again.

A newly published revision deducts another set of sheets. If you replace files before cutting the previous set, use **add** to return the unused sheets. Include a note identifying the replacement.

If publication fails, retry it from the badge thread. The bot retains reservations while the outcome is uncertain. An event change before merging releases the sheets so you can confirm the updated event.

## Understand the badge preview

The design check shows a rendered badge and stamp impression. The badge preview uses one of your selected acrylics at its stock thickness. Select **View in 3D** to rotate and zoom. Packing uses the colors, sizes, and quantities you selected.
