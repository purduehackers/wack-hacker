---
description: Read and change DNS records on a Cloudflare zone.
---

## When to use

Use when the user asks what a domain's DNS says, or asks to add, change, or remove a DNS record.

## Relevant tools

`list_dns_records`, `get_dns_record`, `create_dns_record`, `update_dns_record`, `delete_dns_record`, `export_zone_file`

## Instructions

<reading>
- Resolve the domain to a zone id with `list_zones` first; every tool here needs one.
- Filter with `name` and `type` rather than paging the whole zone — `list_dns_records({ type: 'MX' })` answers a mail question directly.
</reading>

<writing>
- `update_dns_record` replaces the whole record: read it with `get_dns_record` first and pass back the current value of anything you are not changing, or it will be cleared.
- Supported types are A, AAAA, CNAME, MX, NS and TXT. MX needs `priority`. Anything else has to be done in the Cloudflare dashboard.
- `proxied` only applies to A, AAAA and CNAME.
</writing>

<mail-safety>
- MX records and the TXT records holding SPF, DKIM and DMARC are load-bearing for the whole domain's mail. Read the record back and say what it does before changing or deleting it.
- A domain may only have one SPF TXT record. To authorize a new sender, edit the existing record to add an `include:` — never create a second one.
</mail-safety>
