"use client";

import type { SimTraceEntry } from "../types.ts";

import styles from "./inspector.module.css";

interface TraceInspectorProps {
  trace: SimTraceEntry[];
}

/**
 * A vertical timeline of the current turn's events — the stream, tool calls
 * (with durations), approval prompts/decisions, and how it finished. Built from
 * the same SSE events the chat renders, so it's a faithful "what happened, in
 * what order" view alongside the message UX.
 */
export function TraceInspector({ trace }: TraceInspectorProps) {
  if (trace.length === 0) {
    return <p className={styles.empty}>Run a turn to see its execution trace.</p>;
  }
  const start = trace[0].ts;
  return (
    <ol className={styles.timeline}>
      {trace.map((entry) => (
        <li key={`${entry.seq}-${entry.ref ?? entry.kind}`} className={styles.tlRow}>
          <span
            className={`${styles.tlDot} ${styles[`tl_${entry.kind.replace("-", "_")}`] ?? ""}`}
          />
          <span className={styles.tlTime}>+{((entry.ts - start) / 1000).toFixed(1)}s</span>
          <div className={styles.tlBody}>
            <div className={styles.tlLabel}>
              <span>{entry.label}</span>
              {typeof entry.durationMs === "number" ? (
                <span className={styles.tlDur}>{(entry.durationMs / 1000).toFixed(1)}s</span>
              ) : null}
            </div>
            {entry.detail ? <div className={styles.tlDetail}>{entry.detail}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
