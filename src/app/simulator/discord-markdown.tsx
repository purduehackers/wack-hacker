import { type ReactNode, useState } from "react";

import type { MentionResolver } from "./types.ts";

import { CodeBlock } from "./components/CodeBlock.tsx";
import styles from "./discord-markdown.module.css";

/**
 * A hand-rolled subset of Discord's message markdown. We do NOT reuse an HTML
 * pipeline because the real client supports things common libraries miss:
 * `-#` subtext (rendered muted, NOT a heading), `||spoilers||`, and
 * `__underline__` (underline, not bold). Block parsing is line-oriented and
 * ORDER-SENSITIVE; inline parsing is a single left-to-right scan.
 */

const CDN = "https://cdn.discordapp.com/emojis";

let keySeq = 0;
function nextKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${keySeq}`;
}

// ---------------------------------------------------------------------------
// Inline pass
// ---------------------------------------------------------------------------

function resolveMember(resolver: MentionResolver, id: string): string {
  return resolver.members[id]?.displayName ?? "unknown-user";
}

function formatTimestamp(unix: number, style: string | undefined): string {
  const date = new Date(unix * 1000);
  if (Number.isNaN(date.getTime())) return `<t:${unix}>`;
  switch (style) {
    case "t":
      return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    case "T":
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      });
    case "d":
      return date.toLocaleDateString("en-US");
    case "D":
      return date.toLocaleDateString("en-US", { dateStyle: "long" });
    case "R":
      return relativeTime(date);
    case "F":
      return date.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
    default:
      return date.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
  }
}

function relativeTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const fmt = (n: number, unit: string): string => {
    const rounded = Math.round(n);
    const plural = rounded === 1 ? unit : `${unit}s`;
    return diffMs < 0 ? `${rounded} ${plural} ago` : `in ${rounded} ${plural}`;
  };
  if (abs < hour) return fmt(abs / minute, "minute");
  if (abs < day) return fmt(abs / hour, "hour");
  return fmt(abs / day, "day");
}

interface InlineToken {
  /** Regex matched at the scan position. Capture groups feed `render`. */
  pattern: RegExp;
  render: (match: RegExpExecArray, resolver: MentionResolver) => ReactNode;
}

/** Mention + emoji + timestamp tokens (rendered atomically, never recursed). */
function atomicTokens(): InlineToken[] {
  return [
    {
      pattern: /^<a?:(\w+):(\d+)>/,
      render: (m) => {
        const animated = m[0].startsWith("<a:");
        return (
          <img
            key={nextKey("emoji")}
            className={styles.emoji}
            src={`${CDN}/${m[2]}.${animated ? "gif" : "png"}`}
            alt={`:${m[1]}:`}
            draggable={false}
          />
        );
      },
    },
    {
      pattern: /^<@!?(\d+)>/,
      render: (m, r) => (
        <span key={nextKey("um")} className={styles.mention}>
          @{resolveMember(r, m[1])}
        </span>
      ),
    },
    {
      pattern: /^<#(\d+)>/,
      render: (m, r) => (
        <span key={nextKey("cm")} className={styles.mention}>
          #{r.channels[m[1]]?.name ?? "unknown-channel"}
        </span>
      ),
    },
    {
      pattern: /^<@&(\d+)>/,
      render: (m, r) => {
        const role = r.roles[m[1]];
        return (
          <span
            key={nextKey("rm")}
            className={styles.roleMention}
            style={role?.color ? { color: role.color } : undefined}
          >
            @{role?.name ?? "unknown-role"}
          </span>
        );
      },
    },
    {
      pattern: /^<t:(-?\d+)(?::([tTdDfFR]))?>/,
      render: (m) => (
        <span key={nextKey("ts")} className={styles.timestamp}>
          {formatTimestamp(Number(m[1]), m[2])}
        </span>
      ),
    },
  ];
}

/** Emphasis/wrapper tokens whose inner content is recursively parsed. */
function wrapperTokens(): InlineToken[] {
  const recur = (inner: string, r: MentionResolver): ReactNode => renderInline(inner, r);
  return [
    {
      pattern: /^`([^`]+)`/,
      render: (m) => (
        <code key={nextKey("code")} className={styles.inlineCode}>
          {m[1]}
        </code>
      ),
    },
    {
      pattern: /^\|\|([\s\S]+?)\|\|/,
      render: (m, r) => <Spoiler key={nextKey("spoiler")}>{recur(m[1], r)}</Spoiler>,
    },
    {
      pattern: /^\*\*([\s\S]+?)\*\*/,
      render: (m, r) => <strong key={nextKey("b")}>{recur(m[1], r)}</strong>,
    },
    {
      pattern: /^__([\s\S]+?)__/,
      render: (m, r) => (
        <span key={nextKey("u")} className={styles.underline}>
          {recur(m[1], r)}
        </span>
      ),
    },
    {
      pattern: /^~~([\s\S]+?)~~/,
      render: (m, r) => <s key={nextKey("s")}>{recur(m[1], r)}</s>,
    },
    {
      pattern: /^\*([\s\S]+?)\*/,
      render: (m, r) => <em key={nextKey("i")}>{recur(m[1], r)}</em>,
    },
    {
      pattern: /^_([^_]+?)_/,
      render: (m, r) => <em key={nextKey("i")}>{recur(m[1], r)}</em>,
    },
    {
      pattern: /^\[([^\]]+)\]\(([^)\s]+)\)/,
      render: (m, r) => (
        <a key={nextKey("a")} href={m[2]} target="_blank" rel="noreferrer noopener">
          {recur(m[1], r)}
        </a>
      ),
    },
  ];
}

const ALL_TOKENS = [...wrapperTokens(), ...atomicTokens()];

/** Left-to-right inline scan: at each position try every token, else take a char. */
function renderInline(text: string, resolver: MentionResolver): ReactNode[] {
  const out: ReactNode[] = [];
  let buffer = "";
  let i = 0;
  const flush = (): void => {
    if (buffer) {
      out.push(buffer);
      buffer = "";
    }
  };
  while (i < text.length) {
    const slice = text.slice(i);
    let matched = false;
    for (const token of ALL_TOKENS) {
      const m = token.pattern.exec(slice);
      if (m) {
        flush();
        out.push(token.render(m, resolver));
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      buffer += text[i];
      i += 1;
    }
  }
  flush();
  return out;
}

interface SpoilerProps {
  children: ReactNode;
}

function Spoiler({ children }: SpoilerProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={styles.spoiler}
      data-revealed={revealed}
      role="button"
      tabIndex={0}
      onClick={() => setRevealed(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") setRevealed(true);
      }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Block pass
// ---------------------------------------------------------------------------

type Block =
  | { kind: "subtext"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "para"; lines: string[] };

function headingLevel(line: string): 1 | 2 | 3 | null {
  if (line.startsWith("### ")) return 3;
  if (line.startsWith("## ")) return 2;
  if (line.startsWith("# ")) return 1;
  return null;
}

function listMarker(line: string): { ordered: boolean; content: string } | null {
  if (/^[-*] /.test(line)) return { ordered: false, content: line.slice(2) };
  const ordered = /^(\d+)\. (.*)$/.exec(line);
  if (ordered) return { ordered: true, content: ordered[2] };
  return null;
}

interface Consumed {
  block: Block;
  next: number;
}

/** Try to start a single-line block (fence/subtext/heading) at `i`. */
function consumeSingleLine(lines: string[], i: number): Consumed | null {
  const line = lines[i];
  if (line.startsWith("```")) return consumeFence(lines, i);
  if (line.startsWith("-# ")) {
    return { block: { kind: "subtext", text: line.slice(3) }, next: i + 1 };
  }
  const level = headingLevel(line);
  if (level) {
    return { block: { kind: "heading", level, text: line.slice(level + 1) }, next: i + 1 };
  }
  return null;
}

function isQuoteLine(line: string): boolean {
  return line.startsWith("> ") || line === ">";
}

function consumeQuote(lines: string[], start: number): Consumed {
  const quote: string[] = [];
  let i = start;
  while (i < lines.length && isQuoteLine(lines[i])) {
    quote.push(lines[i] === ">" ? "" : lines[i].slice(2));
    i += 1;
  }
  return { block: { kind: "quote", lines: quote }, next: i };
}

function consumeList(lines: string[], start: number, first: { ordered: boolean }): Consumed {
  const items: string[] = [];
  let ordered = first.ordered;
  let i = start;
  while (i < lines.length) {
    const marker = listMarker(lines[i]);
    if (!marker) break;
    ordered = marker.ordered;
    items.push(marker.content);
    i += 1;
  }
  return { block: { kind: "list", ordered, items }, next: i };
}

function consumePara(lines: string[], start: number): Consumed {
  const para: string[] = [];
  let i = start;
  while (i < lines.length && !isBlockStart(lines[i]) && lines[i].trim() !== "") {
    para.push(lines[i]);
    i += 1;
  }
  return { block: { kind: "para", lines: para }, next: i };
}

/** Consume one block starting at `i`; `null` for a blank line (caller skips). */
function consumeBlock(lines: string[], i: number): Consumed | null {
  const single = consumeSingleLine(lines, i);
  if (single) return single;
  const line = lines[i];
  if (isQuoteLine(line)) return consumeQuote(lines, i);
  const marker = listMarker(line);
  if (marker) return consumeList(lines, i, marker);
  if (line.trim() === "") return null;
  return consumePara(lines, i);
}

/** Group lines into blocks. Order of checks matters: `-#` before `#` headings. */
function parseBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const consumed = consumeBlock(lines, i);
    if (!consumed) {
      i += 1;
      continue;
    }
    blocks.push(consumed.block);
    i = consumed.next;
  }
  return blocks;
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith("```") ||
    line.startsWith("-# ") ||
    headingLevel(line) !== null ||
    line.startsWith("> ") ||
    line === ">" ||
    listMarker(line) !== null
  );
}

function consumeFence(lines: string[], start: number): Consumed {
  const lang = lines[start].slice(3).trim();
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && !lines[i].startsWith("```")) {
    body.push(lines[i]);
    i += 1;
  }
  // Skip the closing fence if present.
  const next = i < lines.length ? i + 1 : i;
  return { block: { kind: "code", lang, code: body.join("\n") }, next };
}

// ---------------------------------------------------------------------------
// Block → React
// ---------------------------------------------------------------------------

function renderBlock(block: Block, resolver: MentionResolver): ReactNode {
  switch (block.kind) {
    case "subtext":
      return (
        <div key={nextKey("sub")} className={styles.subtext}>
          {renderInline(block.text, resolver)}
        </div>
      );
    case "heading":
      return renderHeading(block.level, renderInline(block.text, resolver));
    case "code":
      return <CodeBlock key={nextKey("pre")} lang={block.lang} code={block.code} />;
    case "quote":
      return (
        <blockquote key={nextKey("q")} className={styles.blockquote}>
          {renderMultiline(block.lines, resolver)}
        </blockquote>
      );
    case "list":
      return renderList(block, resolver);
    case "para":
      return (
        <p key={nextKey("p")} className={styles.paragraph}>
          {renderMultiline(block.lines, resolver)}
        </p>
      );
    default:
      return null;
  }
}

function renderHeading(level: 1 | 2 | 3, children: ReactNode): ReactNode {
  const key = nextKey("h");
  if (level === 1)
    return (
      <h1 key={key} className={styles.h1}>
        {children}
      </h1>
    );
  if (level === 2)
    return (
      <h2 key={key} className={styles.h2}>
        {children}
      </h2>
    );
  return (
    <h3 key={key} className={styles.h3}>
      {children}
    </h3>
  );
}

function renderList(block: Extract<Block, { kind: "list" }>, resolver: MentionResolver): ReactNode {
  const items = block.items.map((item) => (
    <li key={nextKey("li")}>{renderInline(item, resolver)}</li>
  ));
  return block.ordered ? (
    <ol key={nextKey("ol")} className={styles.list}>
      {items}
    </ol>
  ) : (
    <ul key={nextKey("ul")} className={styles.list}>
      {items}
    </ul>
  );
}

/** Render lines joined by <br/>, each line inline-parsed. */
function renderMultiline(lines: string[], resolver: MentionResolver): ReactNode[] {
  const out: ReactNode[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) out.push(<br key={nextKey("br")} />);
    out.push(...renderInline(line, resolver));
  });
  return out;
}

/**
 * Render a Discord-flavored markdown string to React. `resolver` supplies the
 * lookups for mentions/emoji; pass an empty resolver for plain content.
 */
export function renderMarkdown(content: string, resolver: MentionResolver): ReactNode {
  const blocks = parseBlocks(content);
  return (
    <div className={styles.markdown}>{blocks.map((block) => renderBlock(block, resolver))}</div>
  );
}
