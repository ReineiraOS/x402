import type { ReactNode } from "react";

export interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}
export interface FooterColumn {
  title: string;
  links: FooterLink[];
}
export interface FooterSocial {
  label: string;
  href: string;
  icon: ReactNode;
}

export interface SiteFooterProps {
  brand: ReactNode;
  tagline?: string;
  columns: FooterColumn[];
  legal?: FooterLink[];
  risk?: ReactNode;
  socials?: FooterSocial[];
  bottomLeft?: ReactNode;
  bottomRight?: ReactNode;
}

function FootLink({ link }: { link: FooterLink }) {
  const style = { fontSize: 13, color: "var(--text-muted)", transition: "color .2s var(--ease)" };
  return (
    <a
      href={link.href}
      {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="foot-link"
      style={style}
    >
      {link.label}
    </a>
  );
}

/* Landing-grade footer: accent hairline, brand + link columns, legal row,
   risk notice, bottom bar with socials. Framework-agnostic (plain <a>). */
export function SiteFooter({
  brand,
  tagline,
  columns,
  legal,
  risk,
  socials,
  bottomLeft,
  bottomRight,
}: SiteFooterProps) {
  return (
    <footer style={{ background: "var(--surface-void)", marginTop: 96 }}>
      <div className="section-divider" />
      <div className="container">
        {/* Brand + link columns */}
        <div
          style={{
            paddingTop: 56,
            paddingBottom: 48,
            display: "flex",
            flexWrap: "wrap",
            gap: "40px 56px",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div style={{ maxWidth: 300 }}>
            {brand}
            {tagline && (
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-dim)",
                  lineHeight: 1.7,
                  marginTop: 14,
                  maxWidth: 240,
                }}
              >
                {tagline}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 56, flexWrap: "wrap" }}>
            {columns.map((col) => (
              <div key={col.title}>
                <h3
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.16em",
                    color: "var(--accent-blue)",
                    marginBottom: 16,
                  }}
                >
                  {col.title}
                </h3>
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 11,
                  }}
                >
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <FootLink link={link} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Legal row */}
        {legal && legal.length > 0 && (
          <div
            style={{
              borderTop: "1px solid var(--steel-8)",
              padding: "16px 0",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 24,
            }}
          >
            {legal.map((link, i) => (
              <span
                key={link.label}
                style={{ display: "inline-flex", alignItems: "center", gap: 24 }}
              >
                {i > 0 && (
                  <span aria-hidden="true" style={{ fontSize: 11, color: "var(--steel-25)" }}>
                    ·
                  </span>
                )}
                <a
                  href={link.href}
                  className="foot-link"
                  style={{ fontSize: 13, letterSpacing: "0.01em", color: "var(--text-dim)" }}
                >
                  {link.label}
                </a>
              </span>
            ))}
          </div>
        )}

        {/* Risk notice */}
        {risk && (
          <div
            style={{
              borderTop: "1px solid var(--steel-6)",
              padding: "20px 0",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: 12,
                lineHeight: 1.6,
                maxWidth: 640,
                margin: "0 auto",
                color: "var(--text-faint)",
              }}
            >
              {risk}
            </p>
          </div>
        )}

        {/* Bottom bar */}
        <div
          style={{
            borderTop: "1px solid var(--steel-6)",
            padding: "24px 0",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            {bottomLeft}
            {bottomRight && (
              <p
                className="mono"
                style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}
              >
                {bottomRight}
              </p>
            )}
          </div>
          {socials && socials.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {socials.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="social-link"
                  style={{
                    width: 44,
                    height: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "var(--r-full)",
                    color: "var(--text-faint)",
                    transition: "color .2s var(--ease), background-color .2s var(--ease)",
                  }}
                >
                  {s.icon}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
