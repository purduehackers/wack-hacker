import type { API } from "@discordjs/core/http-only";

import { log } from "evlog";

import type { FooterMeta } from "./types.ts";

const EDIT_INTERVAL_MS = 1500;
const MAX_LENGTH = 1900;
const MAX_MESSAGES = 5;

export class MessageRenderer {
  private messageId: string | null = null;
  private text = "";
  private activity: string | null = null;
  private subagentPreview = "";
  private taskId: string | undefined;
  private lastEdit = 0;
  private lastRendered = "";

  constructor(
    private discord: API,
    private channelId: string,
    options?: { taskId?: string },
  ) {
    this.taskId = options?.taskId;
  }

  /** Get the accumulated text. */
  get content(): string {
    return this.text;
  }

  /** Create initial placeholder message. */
  async init(): Promise<void> {
    const msg = await this.discord.channels.createMessage(this.channelId, {
      content: "> Thinking...",
    });
    this.messageId = msg.id;
    this.lastRendered = "> Thinking...";
    this.lastEdit = Date.now();
  }

  /** Append streamed text. Clears activity/preview since text is arriving. */
  async appendText(delta: string): Promise<void> {
    this.text += delta;
    this.activity = null;
    this.subagentPreview = "";
    await this.flush();
  }

  /** Show tool call activity indicator. */
  async showToolCall(toolName: string): Promise<void> {
    this.activity = `Calling \`${toolName}\`...`;
    this.subagentPreview = "";
    await this.flush();
  }

  /** Show subagent progress preview. */
  async showSubagentPreview(text: string): Promise<void> {
    this.subagentPreview = text;
    await this.flush();
  }

  /** Clear activity state (e.g. after non-preliminary tool-result). */
  clearActivity(): void {
    this.activity = null;
    this.subagentPreview = "";
  }

  /** Finalize: render footer, split across messages, send. */
  async finalize(meta: FooterMeta): Promise<void> {
    let footer = MessageRenderer.formatFooter(meta);
    if (this.taskId) footer += `\n-# Task: ${this.taskId}`;

    const finalText = this.text || "I didn't have anything to say.";
    const chunks = MessageRenderer.splitWithFooter(finalText, footer);

    // Edit the original message with the first chunk
    try {
      await this.discord.channels.editMessage(this.channelId, this.messageId!, {
        content: chunks[0],
      });
    } catch (err) {
      log.warn("streaming", `Final edit failed, sending new message: ${String(err)}`);
      await this.discord.channels.createMessage(this.channelId, { content: chunks[0] });
    }

    // Send additional messages for overflow chunks
    for (let i = 1; i < chunks.length; i++) {
      await this.discord.channels.createMessage(this.channelId, { content: chunks[i] });
    }
  }

  // ---------------------------------------------------------------------------
  // Static utilities
  // ---------------------------------------------------------------------------

  static formatFooter({
    elapsedMs,
    totalTokens,
    toolCallCount,
    stepCount,
    traceId,
  }: FooterMeta): string {
    const parts = [`${(elapsedMs / 1000).toFixed(1)}s`];

    if (totalTokens != null) parts.push(`${totalTokens.toLocaleString("en-US")} tokens`);
    if (toolCallCount === 1) parts.push("1 tool call");
    else if (toolCallCount > 1) parts.push(`${toolCallCount} tool calls`);
    if (stepCount > 1) parts.push(`${stepCount} steps`);
    if (traceId) parts.push(`Trace: \`${traceId}\``);

    return `-# ${parts.join(" · ")}`;
  }

  /** Split text into chunks that each fit within maxLength. */
  static splitText(text: string, maxLength = MAX_LENGTH): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];

    let remaining = text;
    while (remaining.length > maxLength) {
      if (chunks.length >= MAX_MESSAGES - 1) {
        // Last allowed chunk — truncate with ellipsis
        chunks.push(remaining.slice(0, maxLength - 1) + "…");
        return chunks;
      }

      const slice = remaining.slice(0, maxLength);

      // Find best split point: paragraph > sentence > word > hard
      let splitAt = slice.lastIndexOf("\n\n");
      if (splitAt <= 0) {
        // Sentence boundaries — look for ". ", "! ", "? "
        for (const sep of [". ", "! ", "? "]) {
          const idx = slice.lastIndexOf(sep);
          if (idx > 0) {
            splitAt = idx + sep.length - 1; // keep the punctuation, split after it
            break;
          }
        }
      }
      if (splitAt <= 0) splitAt = slice.lastIndexOf(" ");
      if (splitAt <= 0) splitAt = maxLength; // hard split

      chunks.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining) chunks.push(remaining);
    return chunks;
  }

  /** Split text and append footer to the last chunk. */
  static splitWithFooter(text: string, footer: string): string[] {
    const separator = "\n\n";
    const footerSize = separator.length + footer.length;
    const available = MAX_LENGTH - footerSize;

    // Simple case: everything fits in one message
    if (text.length <= available) {
      return [text + separator + footer];
    }

    // Split the text, reserving space in the last chunk for the footer
    const chunks = MessageRenderer.splitText(text, MAX_LENGTH);

    // Check if footer fits on the last chunk
    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk.length <= available) {
      chunks[chunks.length - 1] = lastChunk + separator + footer;
    } else {
      // Re-split the last chunk to make room for footer
      chunks.pop();
      const reSplit = MessageRenderer.splitText(lastChunk, available);
      for (const part of reSplit) {
        chunks.push(part);
      }
      // Enforce MAX_MESSAGES cap — merge overflow into the last allowed chunk
      if (chunks.length > MAX_MESSAGES) {
        const overflow = chunks.splice(MAX_MESSAGES - 1);
        chunks.push(overflow.join(" ").slice(0, available - 1) + "…");
      }
      chunks[chunks.length - 1] += separator + footer;
    }

    return chunks;
  }

  // ---------------------------------------------------------------------------
  // Private rendering
  // ---------------------------------------------------------------------------

  /** Rate-limited mid-stream edit. */
  private async flush(): Promise<void> {
    if (Date.now() - this.lastEdit < EDIT_INTERVAL_MS) return;
    const content = this.render();
    if (content === this.lastRendered) return;
    this.lastEdit = Date.now();
    this.lastRendered = content;
    try {
      await this.discord.channels.editMessage(this.channelId, this.messageId!, { content });
    } catch (err) {
      log.warn("streaming", `Edit failed mid-stream: ${String(err)}`);
    }
  }

  /** Compose components into a single Discord message string (mid-stream). */
  private render(): string {
    const parts: string[] = [];
    if (this.activity) parts.push(`-# ${this.activity}`);
    if (this.subagentPreview) parts.push(`> ${this.subagentPreview.replaceAll("\n", "\n> ")}`);
    if (this.text) parts.push(this.text);
    const body = parts.join("\n\n") || "> Thinking...";
    return body.length > MAX_LENGTH ? body.slice(0, MAX_LENGTH - 1) + "…" : body;
  }
}
