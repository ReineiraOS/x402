import type { ReactNode } from "react";

export interface DocsColumn {
  key: string;
  header: string;
}

/* Mono-cipher address tables (per-network deployed addresses). */
export function DocsTable({
  columns,
  rows,
}: {
  columns: DocsColumn[];
  rows: Record<string, ReactNode>[];
}) {
  return (
    <div
      style={{
        borderRadius: "var(--r-sub)",
        border: "1px solid var(--border-dark)",
        overflow: "hidden",
        boxShadow: "var(--shadow-dark-lg)",
      }}
    >
      <div style={{ overflowX: "auto" }} className="thin-scroll">
        <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--steel-4)" }}>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    textAlign: "left",
                    padding: "11px 16px",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--text-dim)",
                    borderBottom: "1px solid var(--border-dark)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--steel-7)" }}>
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: "11px 16px", lineHeight: 1.5 }}>
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
