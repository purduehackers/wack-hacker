import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";

/**
 * Page decoration shared by the two tools that write a page.
 *
 * Notion accepts an icon as either an emoji or an external URL and a cover only
 * as a URL, but a model has one free-text string for each. Parsing them the
 * same way in `create_page` and `update_page` keeps an icon that was accepted
 * on create from being rejected on the next edit.
 */

export function parseIcon(icon: string | undefined): CreatePageParameters["icon"] {
  if (!icon) return undefined;
  if (icon.startsWith("http")) return { type: "external", external: { url: icon } };
  return { type: "emoji", emoji: icon };
}

export function parseCover(cover: string | undefined): CreatePageParameters["cover"] {
  if (!cover) return undefined;
  return { type: "external", external: { url: cover } };
}
