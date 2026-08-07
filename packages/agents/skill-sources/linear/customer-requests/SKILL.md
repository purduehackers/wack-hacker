---
name: customer-requests
description: Create, update, list, and analyze customer requests.
criteria: Use when the user wants to log, update, list, or analyze customer feedback/requests.
tools: [create_customer_need, update_customer_need, list_customer_needs]
minRole: organizer
mode: inline
---

In Linear, customer requests are called "customer needs."

<creating>
- Must attach to an issue or project.
- Capture the customer's ask in the body without "enhancing" it.
- Importance: 0 (not important) or 1 (important).
- Resolve customer via search_entities(entityType: "Customer").
</creating>

<updating>
- Only change fields requested. Don't rewrite bodies opportunistically.
</updating>

<listing_analysis>

- List by issue/project/customer; can filter by state.
- For theme analysis, group themes clearly and reference specific requests as examples.
  </listing_analysis>
