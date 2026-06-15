import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { VirtualMember } from "@/lib/simulator/types";

import { SIM_USER_ID } from "@/lib/simulator/constants";

import type { MentionResolver } from "./types.ts";

import { renderMarkdown } from "./discord-markdown.tsx";

const EMPTY: MentionResolver = { members: {}, channels: {}, roles: {}, emojis: {} };

function html(content: string, resolver: MentionResolver = EMPTY): string {
  return renderToStaticMarkup(renderMarkdown(content, resolver));
}

describe("renderMarkdown", () => {
  it("renders -# as muted subtext, not a heading", () => {
    const out = html("-# foo");
    expect(out).toContain("subtext");
    expect(out).not.toContain("<h1");
    expect(out).not.toContain("<h2");
    expect(out).not.toContain("<h3");
    expect(out).toContain("foo");
  });

  it("renders __x__ as underline, not bold", () => {
    const out = html("__x__");
    expect(out).toContain("underline");
    expect(out).not.toContain("<strong>");
  });

  it("renders **x** as bold", () => {
    expect(html("**x**")).toContain("<strong>");
  });

  it("renders the bot footer line as small subtext", () => {
    const out = html("-# `abc` · 3.2s · 1,423 tokens");
    expect(out).toContain("subtext");
    expect(out).toContain("3.2s");
    expect(out).toContain("1,423 tokens");
    // The inline code inside the footer still renders as code.
    expect(out).toContain("<code");
    expect(out).toContain("abc");
  });

  it("groups consecutive > lines into one blockquote", () => {
    const out = html("> quote line one\n> quote line two");
    expect(out).toContain("<blockquote");
    expect(out).toContain("quote line one");
    expect(out).toContain("quote line two");
    // One blockquote, not two.
    expect(out.match(/<blockquote/g)?.length).toBe(1);
  });

  it("resolves a user mention to the member display name", () => {
    const member: VirtualMember = {
      id: SIM_USER_ID,
      username: "rayhan",
      displayName: "Ray",
      roles: [],
    };
    const resolver: MentionResolver = {
      ...EMPTY,
      members: { [SIM_USER_ID]: member },
    };
    const out = html(`hello <@${SIM_USER_ID}>`, resolver);
    expect(out).toContain("@Ray");
    expect(out).not.toContain(SIM_USER_ID);
  });

  it("renders headings capped at h3", () => {
    expect(html("# Big")).toContain("<h1");
    expect(html("## Mid")).toContain("<h2");
    expect(html("### Small")).toContain("<h3");
  });

  it("renders a fenced code block literally", () => {
    const out = html("```py\ncreate_channel(\n    name=demo,\n)\n```");
    expect(out).toContain("<pre");
    expect(out).toContain("create_channel(");
    // Inline markdown inside the fence is NOT interpreted.
    expect(out).not.toContain("<strong>");
  });

  it("renders a spoiler span", () => {
    expect(html("||secret||")).toContain("spoiler");
  });

  it("renders a custom emoji as a CDN image", () => {
    const out = html("<:wave:12345>");
    expect(out).toContain("https://cdn.discordapp.com/emojis/12345.png");
    expect(out).toContain('alt=":wave:"');
  });

  it("renders an animated custom emoji as a gif", () => {
    expect(html("<a:dance:67890>")).toContain("https://cdn.discordapp.com/emojis/67890.gif");
  });

  it("renders a masked link", () => {
    const out = html("[Docs](https://example.com)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain(">Docs<");
  });
});
