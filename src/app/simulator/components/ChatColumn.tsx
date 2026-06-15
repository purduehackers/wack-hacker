"use client";

import type { SimMessage } from "@/lib/simulator/types";

import type { MentionResolver } from "../types.ts";

import styles from "../simulator.module.css";
import { Composer } from "./Composer.tsx";
import { MessageList } from "./MessageList.tsx";

interface ChatColumnProps {
  channelName: string;
  isThread: boolean;
  parentName?: string;
  parentId?: string;
  messages: SimMessage[];
  resolver: MentionResolver;
  busy: boolean;
  onSend: (content: string) => void;
  onDecide: (decision: "approve" | "deny", approvalId: string) => void;
  onSelectChannel: (id: string) => void;
}

function ThreadGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 4v6a4 4 0 0 0 4 4h9" />
    </svg>
  );
}

/** The single chat/thread column: breadcrumb header + messages + composer. */
export function ChatColumn({
  channelName,
  isThread,
  parentName,
  parentId,
  messages,
  resolver,
  busy,
  onSend,
  onDecide,
  onSelectChannel,
}: ChatColumnProps) {
  return (
    <main className={styles.chat}>
      <header className={styles.crumbBar}>
        {isThread && parentId ? (
          <>
            <button
              type="button"
              className={styles.crumbLink}
              onClick={() => onSelectChannel(parentId)}
            >
              # {parentName}
            </button>
            <span className={styles.crumbSep}>›</span>
            <span className={styles.crumbGlyph}>
              <ThreadGlyph />
            </span>
            <span>{channelName}</span>
          </>
        ) : (
          <>
            <span className={styles.crumbGlyph}>#</span>
            <span>{channelName}</span>
          </>
        )}
      </header>
      <MessageList
        messages={messages}
        resolver={resolver}
        channelName={channelName}
        onDecide={onDecide}
      />
      <Composer channelName={channelName} disabled={busy} resolver={resolver} onSend={onSend} />
    </main>
  );
}
