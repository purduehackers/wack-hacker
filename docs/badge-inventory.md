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
- **Record cutting**: Run `/badge inventory use`, choose a material, and enter how many whole sheets you used.
- **Correct a count**: Run `/badge inventory set` after counting the sheets. Enter `0` when none remain.
- **Check history**: Run `/badge inventory history` to see the last 10 changes, who recorded them, and their notes.

Publishing badge files does not change inventory. Record use after cutting, including sheets you discard. A partly used sheet no longer counts as a whole sheet; this inventory does not track offcuts.

## Understand the badge preview

The badge embed shows your flat design and a rendered acrylic example. The example does not reserve material or select stock. Inventory counts do not change badge size, spacing, or the two configured cutting sheets.
