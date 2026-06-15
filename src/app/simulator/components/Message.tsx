"use client";

import type { SimMessage, SimReaction } from "@/lib/simulator/types";

import type { MentionResolver } from "../types.ts";

import { renderMarkdown } from "../discord-markdown.tsx";
import { ActionRow } from "./ActionRow.tsx";
import styles from "./components.module.css";
import { Embed } from "./Embed.tsx";

interface MessageProps {
  message: SimMessage;
  resolver: MentionResolver;
  onDecide: (decision: "approve" | "deny", approvalId: string) => void;
}

function Reactions({ reactions }: { reactions: SimReaction[] }) {
  if (reactions.length === 0) return null;
  return (
    <div className={styles.reactions}>
      {reactions.map((reaction) => (
        <span
          key={reaction.emoji}
          className={`${styles.reaction} ${reaction.me ? styles.reactionMine : ""}`}
        >
          <span>{reaction.emoji}</span>
          <span className={styles.reactionCount}>{reaction.count}</span>
        </span>
      ))}
    </div>
  );
}

export function Message({ message, resolver, onDecide }: MessageProps) {
  return (
    <div className={styles.message}>
      {message.content ? (
        <div className={styles.messageContent}>
          {renderMarkdown(message.content, resolver)}
          {message.editedAt ? <span className={styles.editedTag}>(edited)</span> : null}
        </div>
      ) : null}

      {message.embeds.map((embed, idx) => (
        <Embed key={idx} embed={embed} resolver={resolver} />
      ))}

      {message.components.map((row, idx) => (
        <ActionRow key={idx} row={row} onDecide={onDecide} />
      ))}

      <Reactions reactions={message.reactions} />
    </div>
  );
}
