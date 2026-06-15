"use client";

import type { SimMessage, VirtualMember } from "@/lib/simulator/types";

import type { MentionResolver } from "../types.ts";

import { avatarColor, initials } from "../avatar.ts";
import styles from "./components.module.css";
import { Message } from "./Message.tsx";

interface MessageGroupProps {
  messages: SimMessage[];
  resolver: MentionResolver;
  onDecide: (decision: "approve" | "deny", approvalId: string) => void;
}

function authorOf(resolver: MentionResolver, message: SimMessage): VirtualMember | undefined {
  return resolver.members[message.authorId];
}

function displayName(member: VirtualMember | undefined, message: SimMessage): string {
  if (member) return member.displayName;
  return message.authorKind === "bot" ? "Wack Hack" : "User";
}

/** Highest role color for the author, used to tint the username like Discord. */
function roleColor(
  member: VirtualMember | undefined,
  resolver: MentionResolver,
): string | undefined {
  for (const id of member?.roles ?? []) {
    const role = resolver.roles[id];
    if (role?.color) return role.color;
  }
  return undefined;
}

function formatStamp(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today at ${time}` : `${date.toLocaleDateString("en-US")} ${time}`;
}

export function MessageGroup({ messages, resolver, onDecide }: MessageGroupProps) {
  const head = messages[0];
  const member = authorOf(resolver, head);
  const name = displayName(member, head);
  const isBot = head.authorKind === "bot" || Boolean(member?.bot);
  const color = roleColor(member, resolver);

  return (
    <div className={styles.group}>
      <div className={styles.hoverToolbar}>
        <button type="button" className={styles.hoverBtn} title="Add Reaction">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 14a4 4 0 0 0 7 0" strokeLinecap="round" />
            <circle cx="9" cy="10" r="0.6" fill="currentColor" stroke="none" />
            <circle cx="15" cy="10" r="0.6" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button type="button" className={styles.hoverBtn} title="Reply">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 7 4 12l5 5" />
            <path d="M4 12h10a5 5 0 0 1 5 5v1" />
          </svg>
        </button>
        <button type="button" className={styles.hoverBtn} title="More">
          ⋯
        </button>
      </div>
      <div className={styles.avatar} style={{ background: avatarColor(head.authorId) }}>
        {member?.avatarUrl ? (
          <img className={styles.avatarImg} src={member.avatarUrl} alt="" draggable={false} />
        ) : (
          initials(name)
        )}
      </div>
      <div className={styles.groupBody}>
        <div className={styles.groupHeader}>
          <span className={styles.authorName} style={color ? { color } : undefined}>
            {name}
          </span>
          {isBot ? (
            <span className={styles.appBadge}>
              <span className={styles.appBadgeCheck}>✓</span>App
            </span>
          ) : null}
          <span className={styles.timestampMeta}>{formatStamp(head.createdAt)}</span>
        </div>
        {messages.map((message) => (
          <Message key={message.id} message={message} resolver={resolver} onDecide={onDecide} />
        ))}
      </div>
    </div>
  );
}
