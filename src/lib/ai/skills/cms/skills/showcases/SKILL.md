---
name: showcases
description: Manage the ugrants (microgrants) and shelter-projects showcases on cms.purduehackers.com
criteria: Use when the user asks to add, edit, publish, or remove entries in the microgrant or shelter wall project showcases
tools:
  [
    list_ugrants,
    get_ugrant,
    create_ugrant,
    update_ugrant,
    delete_ugrant,
    publish_ugrant,
    unpublish_ugrant,
    list_shelter_projects,
    get_shelter_project,
    create_shelter_project,
    update_shelter_project,
    delete_shelter_project,
    publish_shelter_project,
    unpublish_shelter_project,
  ]
minRole: organizer
mode: inline
---

<ugrants>

- `ugrants` (microgrants) is the recipient showcase — `name`, `author`, `description`, `image`, `authorUrl`, `projectUrl`, `visible`.
- `visible: true` is public. Default on create is false — ask the user before toggling visible on new entries since the image may still be blurry / the description may need review.
- `publish_ugrant` / `unpublish_ugrant` flip visibility.
  </ugrants>

<shelter-projects>

- `shelter-projects` is the shelter wall showcase — `name`, `last_division`, `last_owner`, `description`, `image`, `visible`.
- Same visibility semantics as ugrants.
  </shelter-projects>

<images>

- Both collections require an `image_id` pointing at an existing `media` record. Upload via the `media` sub-skill's `upload_media({ url, alt })` first, then pass the returned `id` as `image_id` when creating or updating.
- Images are required on create for both collections; updates can omit `image_id` to keep the existing reference.
  </images>
