---
name: customer-requests
description: Create/update/list/analyze customer requests attached to issues, projects, or customers.
criteria: Use when the user wants to log, update, list, or analyze customer feedback/requests.
tools: create_customer_need, update_customer_need, list_customer_needs
---

In Linear, customer requests are called "customer needs."

<creating>
- Must attach to an issue or project; only do so when it clearly matches or the user asks.
- If there isn't an appropriate issue/project, create an issue first and attach the customer request as part of intake.
- Capture the customer's ask in the body without "enhancing" it into a spec.
- Mark importance when explicitly stated (or clearly implied): 0 (not important) or 1 (important).
- Optionally set source URL if provided.
- Resolve customer via search_entities(entityType: "Customer").
</creating>

<updating>
- Only change fields requested (customer, attachment target, priority, body).
- Don't rewrite bodies opportunistically.
</updating>

<listing_analysis>

- List by issue/project/customer; can filter by state.
- When doing theme analysis, present grouped themes clearly, reference specific customer requests as examples, and avoid overconfident prioritization if the data doesn't support it.
  </listing_analysis>
