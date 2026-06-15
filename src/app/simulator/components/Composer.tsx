"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import type { MentionResolver } from "../types.ts";

import { avatarColor, initials } from "../avatar.ts";
import { EmojiIcon, GiftIcon, StickerIcon } from "../icons.tsx";
import styles from "./composer.module.css";

interface ComposerProps {
  channelName: string;
  disabled: boolean;
  resolver: MentionResolver;
  onSend: (content: string) => void;
}

interface Suggestion {
  id: string;
  insert: string;
  label: string;
  detail?: string;
  color?: string;
  glyph?: string;
  imageUrl?: string;
}

interface ActiveToken {
  kind: "@" | "#" | ":";
  query: string;
  start: number;
}

const TITLES: Record<ActiveToken["kind"], string> = {
  "@": "Members",
  "#": "Channels",
  ":": "Emoji",
};

const STATIC_EMOJI: { name: string; char: string }[] = [
  { name: "tada", char: "🎉" },
  { name: "fire", char: "🔥" },
  { name: "rocket", char: "🚀" },
  { name: "eyes", char: "👀" },
  { name: "heart", char: "❤️" },
  { name: "joy", char: "😂" },
  { name: "thumbsup", char: "👍" },
  { name: "wave", char: "👋" },
  { name: "sparkles", char: "✨" },
  { name: "pray", char: "🙏" },
];

function detectToken(text: string, caret: number): ActiveToken | null {
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|\s)([@#:])([\w-]*)$/);
  if (!match) return null;
  const query = match[2];
  return { kind: match[1] as ActiveToken["kind"], query, start: caret - query.length - 1 };
}

function buildSuggestions(token: ActiveToken, resolver: MentionResolver): Suggestion[] {
  const q = token.query.toLowerCase();
  if (token.kind === "@") {
    return Object.values(resolver.members)
      .filter(
        (m) => m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q),
      )
      .slice(0, 8)
      .map((m) => ({
        id: m.id,
        insert: `<@${m.id}>`,
        label: m.displayName,
        detail: m.username,
        color: avatarColor(m.id),
        glyph: initials(m.displayName),
        imageUrl: m.avatarUrl,
      }));
  }
  if (token.kind === "#") {
    return Object.values(resolver.channels)
      .filter((c) => c.kind === "channel" && c.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({ id: c.id, insert: `<#${c.id}>`, label: c.name, glyph: "#" }));
  }
  const custom = Object.values(resolver.emojis)
    .filter((e) => e.name.toLowerCase().includes(q))
    .map((e) => ({
      id: e.id,
      insert: `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`,
      label: e.name,
      imageUrl: e.url,
    }));
  const unicode = STATIC_EMOJI.filter((e) => e.name.includes(q)).map((e) => ({
    id: `u-${e.name}`,
    insert: e.char,
    label: e.name,
    glyph: e.char,
  }));
  return [...custom, ...unicode].slice(0, 8);
}

export function Composer({ channelName, disabled, resolver, onSend }: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [token, setToken] = useState<ActiveToken | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState(0);

  const open = token !== null && suggestions.length > 0;

  const refresh = (text: string, caret: number): void => {
    const next = detectToken(text, caret);
    const list = next ? buildSuggestions(next, resolver) : [];
    setToken(list.length > 0 ? next : null);
    setSuggestions(list);
    setSelected(0);
  };

  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    setToken(null);
    setSuggestions([]);
  };

  const applyInsert = (suggestion: Suggestion): void => {
    const textarea = ref.current;
    if (!textarea || !token) return;
    const caret = textarea.selectionStart;
    const before = value.slice(0, token.start);
    const after = value.slice(caret);
    const inserted = `${before}${suggestion.insert} ${after}`;
    setValue(inserted);
    setToken(null);
    setSuggestions([]);
    const pos = before.length + suggestion.insert.length + 1;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((s) => (s + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((s) => (s - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyInsert(suggestions[selected]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setToken(null);
        setSuggestions([]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.composer}>
      {open ? (
        <div className={styles.autocomplete}>
          <div className={styles.autocompleteHeader}>{TITLES[token.kind]}</div>
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              type="button"
              className={`${styles.suggestion} ${index === selected ? styles.suggestionActive : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                applyInsert(suggestion);
              }}
            >
              {suggestion.imageUrl ? (
                <img
                  className={styles.suggestionImg}
                  src={suggestion.imageUrl}
                  alt=""
                  draggable={false}
                />
              ) : (
                <span
                  className={styles.suggestionGlyph}
                  style={suggestion.color ? { background: suggestion.color } : undefined}
                >
                  {suggestion.glyph}
                </span>
              )}
              <span className={styles.suggestionLabel}>{suggestion.label}</span>
              {suggestion.detail ? (
                <span className={styles.suggestionDetail}>@{suggestion.detail}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.inputWrap}>
        <button type="button" className={styles.plus} title="Upload">
          +
        </button>
        <textarea
          ref={ref}
          className={styles.input}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={`Message #${channelName}`}
          onChange={(event) => {
            setValue(event.target.value);
            refresh(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={handleKeyDown}
        />
        <div className={styles.actions}>
          <button type="button" className={styles.actionBtn} title="Gift Nitro">
            <GiftIcon />
          </button>
          <button type="button" className={styles.actionBtn} title="GIF">
            GIF
          </button>
          <button type="button" className={styles.actionBtn} title="Sticker">
            <StickerIcon />
          </button>
          <button type="button" className={styles.actionBtn} title="Emoji">
            <EmojiIcon />
          </button>
          <button type="button" className={styles.actionBtn} title="Apps">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="7" cy="7" r="2" />
              <circle cx="17" cy="7" r="2" />
              <circle cx="7" cy="17" r="2" />
              <circle cx="17" cy="17" r="2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
