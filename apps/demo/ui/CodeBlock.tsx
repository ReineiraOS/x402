"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import type { CodeTab } from "./types";

/* ── docs tokenizer (FHE-aware) ── */
function tokenize(line: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  let remaining = line;
  let key = 0;
  const push = (text: string, cls?: string) => {
    if (!text) return;
    tokens.push(
      cls ? (
        <span key={key++} className={cls}>
          {text}
        </span>
      ) : (
        <span key={key++}>{text}</span>
      ),
    );
  };
  const cm = remaining.match(/^(.*?)(\/\/.*|#.*)$/);
  if (cm) {
    tokens.push(...tokenize(cm[1]));
    push(cm[2], "tk-comment");
    return tokens;
  }
  const patterns: [RegExp, string][] = [
    [/"[^"]*"|'[^']*'|`[^`]*`/, "tk-string"],
    [
      /\b(import|from|const|let|var|return|async|await|function|new|export|true|false|null|undefined)\b/,
      "tk-keyword",
    ],
    [
      /\b(euint64|euint32|ebool|eaddress|TFHE|FHE|bytes32|bytes|uint16|uint64|address|bool|string|ZeroDevSession)\b/,
      "tk-fhe",
    ],
    [/\b\d+(\.\d+)?\b/, "tk-number"],
    [/[(){}[\];,.]/, "tk-punct"],
  ];
  while (remaining.length > 0) {
    let matched = false;
    for (const [re, cls] of patterns) {
      const m = remaining.match(re);
      if (m && m.index !== undefined) {
        push(remaining.slice(0, m.index));
        push(m[0], cls);
        remaining = remaining.slice(m.index + m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      push(remaining);
      break;
    }
  }
  return tokens;
}

export function CodeBlock({ tabs }: { tabs: CodeTab[] }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const cur = tabs[active];
  const handleCopy = () => {
    const text = cur.lines.map((l) => l.content).join("\n");
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
  return (
    <div
      style={{
        borderRadius: "var(--r-sub)",
        border: "1px solid var(--steel-20)",
        overflow: "hidden",
        boxShadow: "var(--code-shadow)",
        background: "var(--surface-raised)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--steel-4)",
          borderBottom: "1px solid var(--border-dark)",
        }}
      >
        <div style={{ display: "flex" }}>
          {tabs.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setActive(i)}
              type="button"
              style={{
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: i === active ? 600 : 500,
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${i === active ? "var(--accent-blue)" : "transparent"}`,
                color: i === active ? "var(--accent-blue)" : "var(--text-muted)",
                transition: "color .15s var(--ease)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          type="button"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginRight: 8,
            padding: "5px 9px",
            borderRadius: "var(--r-min)",
            fontSize: 12,
            background: "transparent",
            border: "none",
            color: copied ? "var(--st-live-text)" : "var(--text-muted)",
            transition: "color .15s var(--ease)",
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={13} stroke={copied ? 2.4 : 1.6} />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div
        className="thin-scroll"
        style={{ background: "var(--surface-raised)", padding: "14px 0", overflowX: "auto" }}
      >
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, lineHeight: 1.7 }}
        >
          <tbody>
            {cur.lines.map((line, i) => (
              <tr key={i}>
                <td
                  aria-hidden="true"
                  style={{
                    userSelect: "none",
                    textAlign: "right",
                    color: "var(--blue-25)",
                    paddingRight: 16,
                    paddingLeft: 16,
                    width: 30,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                  }}
                >
                  {i + 1}
                </td>
                <td
                  style={{
                    paddingLeft: 4,
                    paddingRight: 20,
                    whiteSpace: "pre",
                    fontFamily: "var(--font-mono)",
                    color: "var(--syntax-variable)",
                  }}
                >
                  {tokenize(line.content)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
