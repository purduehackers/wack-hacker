---
name: cart
description: Add, remove, update quantities, and clear the shared cart.
criteria: Use when the user wants to add an item, remove an item, change a quantity, or clear the cart.
tools: [add_to_cart, remove_from_cart, update_quantity, clear_cart]
minRole: organizer
mode: inline
---

<adding>
- Use the ASIN, title, and price returned by `search_products`. Never invent an ASIN.
- If `price` was `null` in the search result, ask the user for a price or skip the item.
- Adding the same ASIN again merges quantities — this is expected.
</adding>

<removing>
- `remove_from_cart` takes an ASIN. If the user names an item by title, look it up with `view_cart` first.
</removing>

<updating>
- `update_quantity` with `quantity: 0` removes the item.
- Quantities are integers only.
</updating>

<clearing>
- `clear_cart` wipes every item for everyone. Always confirm before calling.
</clearing>
