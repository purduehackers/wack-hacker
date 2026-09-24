const URL_PATTERN = /https?:\/\/\S+/giu;
const WORD_PATTERN = /\p{L}/u;

export type ShipPostIssue = "attachment-only" | "short-explanation";

export function shipPostIssue(content: string): ShipPostIssue | undefined {
  if (content.trim() === "") return "attachment-only";

  const tokens = content
    .replace(URL_PATTERN, " ")
    .split(/\s+/u)
    .filter((candidate) => WORD_PATTERN.test(candidate));
  if (tokens.length <= 5) return "short-explanation";
  return undefined;
}
