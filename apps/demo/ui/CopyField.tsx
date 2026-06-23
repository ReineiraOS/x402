"use client";

import { useState } from "react";
import { Icon } from "./Icon";

/* Copy-to-clipboard hook with a 2s "Copied!" window. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done);
      else done();
    } catch {
      done();
    }
  };
  return [copied, copy];
}

/* A labelled mono value with a copy button. */
export function CopyField({
  label,
  value,
  cipher = false,
  hint,
}: {
  label?: string;
  value: string;
  cipher?: boolean;
  hint?: string;
}) {
  const [copied, copy] = useCopy();
  return (
    <div
      style={{
        border: "1px solid var(--border-dark)",
        borderRadius: "var(--r-sub)",
        background: "var(--surface-base)",
        overflow: "hidden",
      }}
    >
      {label && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            borderBottom: "1px solid var(--border-dark)",
            background: "var(--steel-4)",
          }}
        >
          <span className="eyebrow-mono" style={{ color: "var(--text-dim)" }}>
            {label}
          </span>
          {hint && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{hint}</span>}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
        <code
          className={cipher ? "cipher" : "mono"}
          style={{
            fontSize: 13.5,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: cipher ? "var(--syntax-string)" : "var(--text-primary)",
          }}
        >
          {value}
        </code>
        <button
          onClick={() => copy(value)}
          type="button"
          className="copy-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            padding: "5px 10px",
            borderRadius: "var(--r-min)",
            fontSize: 12,
            border: "1px solid var(--border-dark)",
            background: "transparent",
            color: copied ? "var(--st-live-text)" : "var(--text-muted)",
            transition: "all .15s var(--ease)",
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={13} stroke={copied ? 2.4 : 1.6} />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/* Inline mono value + small copy affordance (used in tables). */
export function CopyInline({ value, cipher }: { value: string; cipher?: boolean }) {
  const [copied, copy] = useCopy();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <code
        className={cipher ? "cipher" : "mono"}
        style={{ fontSize: 13, color: cipher ? "var(--syntax-string)" : "var(--text-primary)" }}
      >
        {value}
      </code>
      <button
        onClick={() => copy(value)}
        type="button"
        title="Copy"
        style={{
          background: "none",
          border: "none",
          padding: 2,
          color: copied ? "var(--st-live-text)" : "var(--text-dim)",
          display: "inline-flex",
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={13} stroke={copied ? 2.4 : 1.6} />
      </button>
    </span>
  );
}
