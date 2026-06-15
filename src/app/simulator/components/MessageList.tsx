"use client";

import { Fragment, useEffect, useRef } from "react";

import type { SimMessage } from "@/lib/simulator/types";

import type { MentionResolver } from "../types.ts";

import { PencilIcon } from "../icons.tsx";
import styles from "./message-list.module.css";
import { MessageGroup } from "./MessageGroup.tsx";

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

interface MessageListProps {
  messages: SimMessage[];
  resolver: MentionResolver;
  channelName: string;
  onDecide: (decision: "approve" | "deny", approvalId: string) => void;
}

const GROUP_GAP_MS = 7 * 60 * 1000;

/** Split a flat message list into author-grouped runs (<7min gap, same author). */
function groupMessages(messages: SimMessage[]): SimMessage[][] {
  const groups: SimMessage[][] = [];
  for (const message of messages) {
    const current = groups[groups.length - 1];
    const last = current?.[current.length - 1];
    const continues =
      last !== undefined &&
      last.authorId === message.authorId &&
      new Date(message.createdAt).getTime() - new Date(last.createdAt).getTime() < GROUP_GAP_MS;
    if (continues) current.push(message);
    else groups.push([message]);
  }
  return groups;
}

export function MessageList({ messages, resolver, channelName, onDecide }: MessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const groups = groupMessages(messages);

  // Keep the newest message in view as the bot streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className={styles.list}>
      {messages.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>#</div>
          <div className={styles.emptyTitle}>Welcome to #{channelName}!</div>
          <div className={styles.emptyBody}>This is the start of the #{channelName} channel.</div>
          <a className={styles.emptyEdit} href="#" onClick={(event) => event.preventDefault()}>
            <PencilIcon />
            Edit Channel
          </a>
        </div>
      ) : (
        groups.map((group, index) => {
          const head = group[0];
          const previous = groups[index - 1];
          const showDivider = !previous || dayKey(previous[0].createdAt) !== dayKey(head.createdAt);
          return (
            <Fragment key={head.id}>
              {showDivider ? (
                <div className={styles.dateDivider}>
                  <span className={styles.dateDividerLabel}>{dateLabel(head.createdAt)}</span>
                </div>
              ) : null}
              <MessageGroup messages={group} resolver={resolver} onDecide={onDecide} />
            </Fragment>
          );
        })
      )}
      <div ref={endRef} />
    </div>
  );
}
