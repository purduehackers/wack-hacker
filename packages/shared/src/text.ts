/**
 * @fileoverview Splitting text to fit Discord's message limit.
 *
 * Lives in shared because the bot uses the same readable splitting policy for
 * transcriptions and agent render intents.
 *
 * The split priority is what makes the output readable rather than merely
 * short. Break at a paragraph if there is one, then a sentence, then a word.
 * Only chop mid-word as a last resort. Splitting a code block or a sentence
 * at an arbitrary character is the difference between two outcomes. The
 * message either reads naturally across two posts or looks corrupted.
 */

/** Discord's hard limit is 2000. The default leaves room for a footer. */
const DEFAULT_MAX_CHARS = 1_900;

const SENTENCE_ENDINGS = [". ", "! ", "? "] as const;

/** Takes a UTF-16 prefix without leaving an unmatched high surrogate. */
export function sliceText(value: string, length: number): string {
  let sliced = value.slice(0, length);
  const last = sliced.charCodeAt(sliced.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) sliced = sliced.slice(0, -1);
  return sliced;
}

/** The best break point at or before `limit`, or `undefined` for none. */
function bestBreak(text: string, limit: number): number | undefined {
  const paragraph = text.lastIndexOf("\n\n", limit);
  if (paragraph > 0) return paragraph + 2;

  const sentence = Math.max(...SENTENCE_ENDINGS.map((ending) => text.lastIndexOf(ending, limit)));
  if (sentence > 0) return sentence + 2;

  const newline = text.lastIndexOf("\n", limit);
  if (newline > 0) return newline + 1;

  const word = text.lastIndexOf(" ", limit);
  if (word > 0) return word + 1;

  return undefined;
}

/**
 * Splits into chunks of at most `maxChars`.
 *
 * Always returns at least one chunk, so a caller can index the first without
 * checking — an empty input yields a single empty string.
 */
export function splitText(text: string, maxChars: number = DEFAULT_MAX_CHARS): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > maxChars) {
    // No natural break means a very long unbroken run — a URL, a base64 blob —
    // and a hard cut is the only option left.
    let cut = bestBreak(rest, maxChars) ?? maxChars;
    const previous = rest.charCodeAt(cut - 1);
    const following = rest.charCodeAt(cut);
    // Never split a UTF-16 surrogate pair during the last-resort hard cut.
    if (previous >= 0xd800 && previous <= 0xdbff && following >= 0xdc00 && following <= 0xdfff)
      cut--;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut);
  }

  if (rest !== "") chunks.push(rest);
  return chunks.length === 0 ? [""] : chunks;
}

/**
 * Splits text and appends a footer to the final chunk.
 *
 * This function measures the footer as part of the budget rather than
 * appending it blindly, which is the bug this exists to avoid. A last chunk
 * sitting just under the limit plus a footer pushes the message over, and
 * Discord rejects the whole thing.
 */
export function splitWithFooter(
  text: string,
  footer: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): string[] {
  if (footer === "") return splitText(text, maxChars);

  const chunks = splitText(text, maxChars);
  const last = chunks.at(-1) ?? "";

  if (last.length + footer.length <= maxChars) {
    chunks[chunks.length - 1] = last + footer;
    return chunks;
  }

  // The tail plus footer overflows, so re-split the tail against a budget that
  // already accounts for the footer.
  const resplit = splitText(last, maxChars - footer.length);
  resplit[resplit.length - 1] = (resplit.at(-1) ?? "") + footer;
  return [...chunks.slice(0, -1), ...resplit];
}
