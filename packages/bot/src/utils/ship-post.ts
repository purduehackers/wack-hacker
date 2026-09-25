import { postTextWithoutUrls } from "./post-content.ts";

const WORD_PATTERN = /\p{L}/u;
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });

export type ShipPostIssue = "attachment-only" | "short-explanation";

export function shipPostIssue(content: string): ShipPostIssue | undefined {
  if (content.trim() === "") return "attachment-only";

  let words = 0;
  for (const part of WORD_SEGMENTER.segment(postTextWithoutUrls(content))) {
    if (part.isWordLike && WORD_PATTERN.test(part.segment)) words++;
    if (words > 5) return undefined;
  }
  return "short-explanation";
}
