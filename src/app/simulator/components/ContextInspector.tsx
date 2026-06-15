"use client";

import type { SimContextSnapshot } from "@/lib/simulator/types";

import styles from "./inspector.module.css";

interface ContextInspectorProps {
  snapshot?: SimContextSnapshot;
}

function tok(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Renders the {@link SimContextSnapshot} — exactly what the model saw this turn
 * (built backend-side from the real `buildContextSnapshot`/`breakdownFromSnapshot`,
 * so it matches `/inspect-context`). The point is to *deeply* see the context:
 * budget by category, the live system prompt, the tool set, and the running
 * conversation, all in one scrollable panel.
 */
export function ContextInspector({ snapshot }: ContextInspectorProps) {
  if (!snapshot) {
    return <p className={styles.empty}>Run a turn to capture the context the model sees.</p>;
  }
  const { model, estimatedInputTokens, categories, totalUsage, totalCostUsd } = snapshot;
  const { systemPrompt, tools, messages, context, turnCount } = snapshot;
  const maxCat = Math.max(1, ...categories.map((c) => c.estimatedTokens));

  return (
    <div className={styles.body}>
      <dl className={styles.kvGrid}>
        <dt className={styles.k}>Model</dt>
        <dd className={styles.v}>{model}</dd>
        <dt className={styles.k}>Next-turn input</dt>
        <dd className={styles.v}>~{tok(estimatedInputTokens)} tok</dd>
        <dt className={styles.k}>Cumulative</dt>
        <dd className={styles.v}>
          {tok(totalUsage.inputTokens)} in · {tok(totalUsage.outputTokens)} out
        </dd>
        <dt className={styles.k}>Turns</dt>
        <dd className={styles.v}>{turnCount}</dd>
        {totalCostUsd ? (
          <>
            <dt className={styles.k}>Cost</dt>
            <dd className={styles.v}>${totalCostUsd.total.toFixed(4)}</dd>
          </>
        ) : null}
      </dl>

      <h3 className={styles.h3}>Context budget</h3>
      <ul className={styles.bars}>
        {categories.map((cat) => (
          <li key={cat.label} className={styles.barRow}>
            <div className={styles.barHead}>
              <span>{cat.label}</span>
              <span className={styles.barNum}>{tok(cat.estimatedTokens)}</span>
            </div>
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                style={{ width: `${(cat.estimatedTokens / maxCat) * 100}%` }}
              />
            </div>
            {cat.items && cat.items.length > 0 ? (
              <ul className={styles.subItems}>
                {cat.items.map((item) => (
                  <li key={item.name}>
                    <span>{item.name}</span>
                    <span className={styles.barNum}>{tok(item.estimatedTokens)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <h3 className={styles.h3}>Execution context</h3>
      <dl className={styles.kvGrid}>
        <dt className={styles.k}>User</dt>
        <dd className={styles.v}>
          {context.nickname} (@{context.username})
        </dd>
        <dt className={styles.k}>Channel</dt>
        <dd className={styles.v}>#{context.channel.name}</dd>
        {context.thread ? (
          <>
            <dt className={styles.k}>Thread</dt>
            <dd className={styles.v}>{context.thread.name}</dd>
          </>
        ) : null}
        {context.memberRoles && context.memberRoles.length > 0 ? (
          <>
            <dt className={styles.k}>Roles</dt>
            <dd className={styles.v}>{context.memberRoles.join(", ")}</dd>
          </>
        ) : null}
        <dt className={styles.k}>Lead-in</dt>
        <dd className={styles.v}>{context.recentMessages?.length ?? 0} recent msg</dd>
      </dl>

      <details className={styles.details}>
        <summary className={styles.summary}>
          System prompt <span className={styles.count}>{tok(systemPrompt.length)} chars</span>
        </summary>
        <pre className={styles.pre}>{systemPrompt}</pre>
      </details>

      <details className={styles.details}>
        <summary className={styles.summary}>
          Tools <span className={styles.count}>{tools.length}</span>
        </summary>
        <ul className={styles.toolList}>
          {tools.map((t) => (
            <li key={t.name} className={styles.toolItem}>
              <code className={styles.toolName}>{t.name}</code>
              <span className={styles.toolDesc}>{t.description}</span>
            </li>
          ))}
        </ul>
      </details>

      <details className={styles.details} open>
        <summary className={styles.summary}>
          Conversation <span className={styles.count}>{messages.length}</span>
        </summary>
        <ol className={styles.msgList}>
          {messages.map((m, i) => (
            <li key={`${i}-${m.role}`} className={styles.msgRow}>
              <span
                className={`${styles.roleTag} ${m.role === "assistant" ? styles.roleAssistant : styles.roleUser}`}
              >
                {m.role}
              </span>
              <pre className={styles.msgContent}>{m.content}</pre>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
