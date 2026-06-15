"use client";

import styles from "./code-block.module.css";

interface CodeBlockProps {
  lang?: string;
  code: string;
}

/**
 * Extracted code-block renderer — the message-construction iteration seam. The
 * markdown parser stays decoupled (it just hands {lang, code}), so experiments
 * like live sandbox-output streaming or syntax highlighting are a one-file
 * change here behind this contract.
 */
export function CodeBlock({ lang, code }: CodeBlockProps) {
  return (
    <div className={styles.block}>
      {lang ? <div className={styles.header}>{lang}</div> : null}
      <pre className={styles.pre}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
