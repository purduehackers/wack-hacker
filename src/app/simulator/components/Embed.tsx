"use client";

import type { SimEmbed } from "@/lib/simulator/types";

import type { MentionResolver } from "../types.ts";

import { renderMarkdown } from "../discord-markdown.tsx";
import styles from "./components.module.css";

interface EmbedProps {
  embed: SimEmbed;
  resolver: MentionResolver;
}

/** A Discord int color → CSS hex, falling back to the grey accent. */
function colorHex(color: number | undefined): string {
  if (color === undefined) return "var(--accent-grey)";
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function Embed({ embed, resolver }: EmbedProps) {
  return (
    <div className={styles.embed}>
      <div className={styles.embedAccent} style={{ background: colorHex(embed.color) }} />
      <div className={styles.embedBody}>
        {embed.author ? (
          <div className={styles.embedAuthor}>
            {embed.author.icon_url ? (
              <img
                className={styles.embedAuthorIcon}
                src={embed.author.icon_url}
                alt=""
                draggable={false}
              />
            ) : null}
            <span>{embed.author.name}</span>
          </div>
        ) : null}

        {embed.title ? <div className={styles.embedTitle}>{embed.title}</div> : null}

        {embed.description ? (
          <div className={styles.embedDescription}>
            {renderMarkdown(embed.description, resolver)}
          </div>
        ) : null}

        {embed.fields && embed.fields.length > 0 ? (
          <div className={styles.embedFields}>
            {embed.fields.map((field, idx) => (
              <div key={`${field.name}-${idx}`} className={styles.embedField}>
                <div className={styles.embedFieldName}>{field.name}</div>
                <div className={styles.embedFieldValue}>
                  {renderMarkdown(field.value, resolver)}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {embed.footer ? (
          <div className={styles.embedFooter}>
            <span>{embed.footer.text}</span>
            {embed.timestamp ? (
              <span className={styles.embedTimestamp}>
                {new Date(embed.timestamp).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
