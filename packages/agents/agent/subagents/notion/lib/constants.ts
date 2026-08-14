import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";

/**
 * Page decoration shared by the two tools that write a page.
 *
 * Notion accepts an icon as either an emoji or an external URL, and a cover
 * only as a URL. A model has one free-text string for each. Identical parsing
 * in `create_page` and `update_page` means `update_page` never rejects an icon
 * that `create_page` accepted.
 */

/**
 * Maps the model's one free-text icon string onto Notion's two icon shapes.
 * A string that starts with `http` becomes an external image. Anything else
 * must be an emoji. An empty or absent value yields `undefined`, so the caller
 * omits the field and Notion leaves the icon untouched.
 */
export function parseIcon(icon: string | undefined): CreatePageParameters["icon"] {
  if (!icon) return undefined;
  if (icon.startsWith("http")) return { type: "external", external: { url: icon } };
  return { type: "emoji", emoji: icon };
}

/**
 * Notion accepts a cover only as an external URL, never as an emoji, so the
 * string passes through without inspection. An empty or absent value yields
 * `undefined`, so the caller omits the field and Notion leaves the cover
 * untouched.
 */
export function parseCover(cover: string | undefined): CreatePageParameters["cover"] {
  if (!cover) return undefined;
  return { type: "external", external: { url: cover } };
}
