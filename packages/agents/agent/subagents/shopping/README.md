# `shopping`

Amazon product search and one shared wishlist cart for Purdue Hackers.

The cart is virtual. Nothing here places an order or reaches Amazon checkout:
`search_products` reads SerpAPI's Amazon results, and the cart tools read and
write a single row set in Turso. A subtotal is `sum(price × quantity)` — not an
order total, with no tax, shipping, or coupons in it.

There is exactly one cart. It is not scoped per user, per session, or per
channel, and it keeps no history, so a change made in one conversation is what
every other conversation sees next.

It does not own purchasing or reimbursement. No tool in this repository spends
money — `finance` reads Hack Club Bank and writes nothing back — so a cart entry
is a request that someone still has to act on by hand.

<!-- generated: do not edit below this line -->

## Surface

**6 tools** across **1 skills**, plus 2 always-available.

## Skills

| Skill                    | Role      | Tools | Description                                                |
| ------------------------ | --------- | ----: | ---------------------------------------------------------- |
| [`cart`](skills/cart.md) | organizer |     4 | Add, remove, update quantities, and clear the shared cart. |

## Always available

Reachable without loading a skill.

| Tool              | Risk | Role   | What it does                                 |
| ----------------- | ---- | ------ | -------------------------------------------- |
| `search_products` | read | public | Search Amazon for products matching a query. |
| `view_cart`       | read | public | View the shared cart.                        |

## `cart`

Add, remove, update quantities, and clear the shared cart.

| Tool               | Risk  | Role      | What it does                             |
| ------------------ | ----- | --------- | ---------------------------------------- |
| `add_to_cart`      | write | organizer | Add a product to the shared cart.        |
| `clear_cart`       | write | organizer | Remove every item from the shared cart.  |
| `remove_from_cart` | write | organizer | Remove a product from the cart by ASIN.  |
| `update_quantity`  | write | organizer | Set the quantity of an item in the cart. |
