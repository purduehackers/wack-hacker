"use client";

import { UserRole } from "@/lib/ai/constants";

import type { SimConfig } from "../types.ts";

import styles from "./control-panel.module.css";

interface ControlPanelProps {
  config: SimConfig;
  status: "idle" | "streaming" | "done" | "error";
  onChange: (patch: Partial<SimConfig>) => void;
}

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: UserRole.Public, label: "Public" },
  { value: UserRole.Organizer, label: "Organizer" },
  { value: UserRole.Admin, label: "Admin" },
];

interface TextFieldProps {
  label: string;
  value: string;
  onInput: (value: string) => void;
}

function TextField({ label, value, onInput }: TextFieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        value={value}
        onChange={(event) => onInput(event.target.value)}
      />
    </label>
  );
}

interface CheckboxProps {
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}

function Checkbox({ label, checked, onToggle }: CheckboxProps) {
  return (
    <label className={styles.checkboxRow}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function ControlPanel({ config, status, onChange }: ControlPanelProps) {
  return (
    <aside className={styles.panel}>
      <div className={styles.statusRow}>
        <span className={`${styles.statusDot} ${styles[`status_${status}`]}`} />
        <span className={styles.statusLabel}>{status}</span>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Role</span>
        <select
          className={styles.select}
          value={config.role}
          onChange={(event) => onChange({ role: event.target.value as UserRole })}
        >
          {ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <TextField
        label="Username"
        value={config.username}
        onInput={(username) => onChange({ username })}
      />
      <TextField
        label="Nickname"
        value={config.nickname}
        onInput={(nickname) => onChange({ nickname })}
      />
      <TextField
        label="Channel"
        value={config.channelName}
        onInput={(channelName) => onChange({ channelName })}
      />

      <Checkbox
        label="Open a thread for channel replies"
        checked={config.openThread}
        onToggle={(openThread) => onChange({ openThread })}
      />

      <Checkbox
        label="Approve as 2nd organizer"
        checked={config.approveAsSecond}
        onToggle={(approveAsSecond) => onChange({ approveAsSecond })}
      />

      <p className={styles.hint}>
        Runs the real agent. The bot only replies when you @mention it (type <code>@</code> to
        autocomplete), or inside a thread it started.
      </p>
    </aside>
  );
}
