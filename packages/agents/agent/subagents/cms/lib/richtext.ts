/**
 * Lexical encodes "inherit the parent's text direction" as an explicit JSON
 * `null` on every node. Payload rejects the field when it is missing, so the
 * literal is required on the wire; naming it once keeps the rest of this module
 * under the no-null rule.
 */
// oxlint-disable-next-line unicorn/no-null -- Payload's Lexical wire format requires an explicit null direction
const INHERIT_DIRECTION = null;

/**
 * Wrap plain text as the minimal Lexical JSON shape Payload's `richText`
 * field expects on writes. Keeps the rendered shape consistent across
 * collections so any future tweak (version bumps, formatting defaults)
 * happens in one place.
 */
export function richTextParagraph(text: string) {
  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: INHERIT_DIRECTION,
      children: [
        {
          type: "paragraph",
          format: "",
          indent: 0,
          version: 1,
          direction: INHERIT_DIRECTION,
          children: [
            { type: "text", text, format: 0, detail: 0, mode: "normal", style: "", version: 1 },
          ],
        },
      ],
    },
  };
}
