"use client";

import { useState } from "react";

import type { SimButton } from "@/lib/simulator/types";

import styles from "./components.module.css";

interface ButtonProps {
  button: SimButton;
  onDecide: (decision: "approve" | "deny", approvalId: string) => void;
}

const STYLE_CLASS: Record<number, string> = {
  1: styles.buttonPrimary,
  2: styles.buttonSecondary,
  3: styles.buttonSuccess,
  4: styles.buttonDanger,
  5: styles.buttonLink,
};

/** Parse a `tool-approval:<decision>:<id>` custom_id, or null if not one. */
function parseApproval(
  customId: string | undefined,
): { decision: "approve" | "deny"; approvalId: string } | null {
  if (!customId) return null;
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== "tool-approval") return null;
  if (parts[1] !== "approve" && parts[1] !== "deny") return null;
  return { decision: parts[1], approvalId: parts[2] };
}

export function Button({ button, onDecide }: ButtonProps) {
  const [clicked, setClicked] = useState(false);
  const approval = parseApproval(button.custom_id);
  const className = `${styles.button} ${STYLE_CLASS[button.style] ?? styles.buttonSecondary}`;
  const disabled = button.disabled || clicked;

  const handleClick = (): void => {
    if (!approval || disabled) return;
    setClicked(true);
    onDecide(approval.decision, approval.approvalId);
  };

  if (button.style === 5 && button.url) {
    return (
      <a className={className} href={button.url} target="_blank" rel="noreferrer noopener">
        {button.emoji?.name ? `${button.emoji.name} ` : ""}
        {button.label}
      </a>
    );
  }

  return (
    <button type="button" className={className} disabled={disabled} onClick={handleClick}>
      {button.emoji?.name ? `${button.emoji.name} ` : ""}
      {button.label}
    </button>
  );
}
