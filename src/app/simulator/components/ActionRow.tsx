"use client";

import type { SimActionRow } from "@/lib/simulator/types";

import { Button } from "./Button.tsx";
import styles from "./components.module.css";

interface ActionRowProps {
  row: SimActionRow;
  onDecide: (decision: "approve" | "deny", approvalId: string) => void;
}

export function ActionRow({ row, onDecide }: ActionRowProps) {
  return (
    <div className={styles.actionRow}>
      {row.components.map((button, idx) => (
        <Button key={button.custom_id ?? button.url ?? idx} button={button} onDecide={onDecide} />
      ))}
    </div>
  );
}
