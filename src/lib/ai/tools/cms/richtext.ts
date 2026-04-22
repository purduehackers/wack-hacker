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
      direction: null,
      children: [
        {
          type: "paragraph",
          format: "",
          indent: 0,
          version: 1,
          direction: null,
          children: [
            { type: "text", text, format: 0, detail: 0, mode: "normal", style: "", version: 1 },
          ],
        },
      ],
    },
  };
}
