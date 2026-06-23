import type { ListingParam } from "./types";

/* Declared-interface / params block. */
export function PropertyCard({
  title,
  properties,
}: {
  title?: string;
  properties: ListingParam[];
}) {
  return (
    <div
      style={{
        borderRadius: "var(--r-sub)",
        border: "1px solid var(--border-dark)",
        overflow: "hidden",
      }}
    >
      {title && (
        <div
          style={{
            background: "var(--steel-4)",
            borderBottom: "1px solid var(--border-dark)",
            padding: "10px 16px",
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--text-secondary)",
              letterSpacing: "0.02em",
            }}
          >
            {title}
          </span>
        </div>
      )}
      <div>
        {properties.map((p, i) => (
          <div
            key={p.name}
            style={{
              padding: "13px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--steel-7)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                marginBottom: 5,
              }}
            >
              <code
                className="mono"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  background: "var(--surface-base)",
                  border: "1px solid var(--border-dark)",
                  borderRadius: 4,
                  padding: "1px 7px",
                }}
              >
                {p.name}
              </code>
              <span className="mono" style={{ fontSize: 12, color: "var(--accent-blue)" }}>
                {p.type}
              </span>
              {p.required ? (
                <span
                  className="pill"
                  style={{ color: "var(--st-danger-text)", background: "rgba(229,90,90,.08)" }}
                >
                  required
                </span>
              ) : (
                <span
                  className="pill"
                  style={{ color: "var(--text-dim)", background: "var(--steel-8)" }}
                >
                  optional
                </span>
              )}
              {p.default !== undefined && (
                <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  default:{" "}
                  <code className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {p.default}
                  </code>
                </span>
              )}
            </div>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
              {p.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
