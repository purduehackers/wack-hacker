"use client";

import { useState } from "react";

import type { SimContextSnapshot } from "@/lib/simulator/types";

import type { SimConfig, SimTraceEntry } from "../types.ts";

import styles from "../simulator.module.css";
import { ContextInspector } from "./ContextInspector.tsx";
import { ControlPanel } from "./ControlPanel.tsx";
import { TraceInspector } from "./TraceInspector.tsx";

interface InspectorPanelProps {
  config: SimConfig;
  status: "idle" | "streaming" | "done" | "error";
  onChange: (patch: Partial<SimConfig>) => void;
  snapshot?: SimContextSnapshot;
  trace: SimTraceEntry[];
}

const TABS: { id: "controls" | "context" | "trace"; label: string }[] = [
  { id: "controls", label: "Controls" },
  { id: "context", label: "Context" },
  { id: "trace", label: "Trace" },
];

/**
 * The right-hand dev surface: a tabbed playground (tweak the session config) +
 * two read-only inspectors over the latest run — the context the model saw and
 * its execution trace. This is where simulator-only visualization lives so the
 * chat column stays a faithful Discord view.
 */
export function InspectorPanel({ config, status, onChange, snapshot, trace }: InspectorPanelProps) {
  const [tab, setTab] = useState<"controls" | "context" | "trace">("controls");
  return (
    <aside className={styles.inspector}>
      <div className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "trace" && trace.length > 0 ? (
              <span className={styles.tabCount}>{trace.length}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className={styles.tabBody}>
        {tab === "controls" ? (
          <ControlPanel config={config} status={status} onChange={onChange} />
        ) : null}
        {tab === "context" ? <ContextInspector snapshot={snapshot} /> : null}
        {tab === "trace" ? <TraceInspector trace={trace} /> : null}
      </div>
    </aside>
  );
}
