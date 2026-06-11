import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { TrustTier, Maturity, Conformance } from './types'

/* ── TrustTierBadge ── */
export const TIER_CONFIG: Record<TrustTier, { label: string; dot: string; color: string; bg: string; border: string }> = {
  canonical: { label: 'Canonical', dot: 'var(--accent-blue)', color: 'var(--accent-blue)', bg: 'var(--blue-8)', border: 'var(--blue-20)' },
  verified: { label: 'Verified', dot: 'var(--st-live)', color: 'var(--st-live-text)', bg: 'rgba(36,196,116,.08)', border: 'rgba(36,196,116,.25)' },
  listed: { label: 'Listed', dot: 'var(--st-spec)', color: 'var(--st-spec-text)', bg: 'rgba(243,166,40,.08)', border: 'rgba(243,166,40,.22)' },
}

export function TrustTierBadge({ tier }: { tier: TrustTier }) {
  const c = TIER_CONFIG[tier] ?? TIER_CONFIG.listed
  return (
    <span className="pill" style={{ color: c.color, background: c.bg, borderColor: c.border }} title={`Trust tier: ${c.label}`}>
      <span className="dot" style={{ background: c.dot }} />
      {c.label}
    </span>
  )
}

/* ── MaturityStatusBadge (docs StatusBadge taxonomy) ── */
export const STATUS_CONFIG: Record<Maturity, { label: string; dot: string; color: string; bg: string }> = {
  live: { label: 'Live', dot: 'var(--st-live)', color: 'var(--st-live-text)', bg: 'rgba(36,196,116,.08)' },
  'chaos-net': { label: 'Chaos-net', dot: 'var(--st-chaos)', color: 'var(--accent-blue)', bg: 'var(--blue-8)' },
  spec: { label: "Spec'd", dot: 'var(--st-spec)', color: 'var(--st-spec-text)', bg: 'rgba(243,166,40,.08)' },
  research: { label: 'Research', dot: 'var(--st-research)', color: 'var(--st-research-text)', bg: 'rgba(160,110,220,.10)' },
}

export function MaturityStatusBadge({ status, detail }: { status: Maturity; detail?: string }) {
  const c = STATUS_CONFIG[status] ?? STATUS_CONFIG.spec
  const text = detail ? `${c.label} · ${detail}` : c.label
  return (
    <span className="pill" style={{ color: c.color, background: c.bg }} title={text}>
      <span className="dot" style={{ background: c.dot }} />
      {text}
    </span>
  )
}

/* ── ConformanceChip ── */
export function ConformanceChip({ state }: { state: Conformance }) {
  if (state === 'pass') {
    return (
      <span className="pill" style={{ color: 'var(--st-live-text)', background: 'rgba(36,196,116,.08)', borderColor: 'rgba(36,196,116,.22)' }} title="RSS v1 conformance suite passed">
        <Icon name="check" size={11} stroke={2.4} />
        RSS v1
      </span>
    )
  }
  if (state === 'pending') {
    return <span className="pill" style={{ color: 'var(--st-spec-text)', background: 'rgba(243,166,40,.08)' }} title="No conformance suite run published yet">pending</span>
  }
  return <span className="pill" style={{ color: 'var(--text-dim)', background: 'var(--steel-8)' }} title="Conformance not applicable">n/a</span>
}

/* ── Generic tag pill ── */
export function TagPill({
  children,
  active,
  onClick,
  as = 'span',
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  as?: 'span' | 'button'
}) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 'var(--r-full)',
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    border: `1px solid ${active ? 'var(--blue-25)' : 'var(--border-dark)'}`,
    background: active ? 'var(--blue-8)' : 'transparent',
    color: active ? 'var(--accent-blue)' : 'var(--text-muted)',
    transition: 'all .15s var(--ease)',
    cursor: onClick ? 'pointer' : 'default',
    fontFamily: 'var(--font-sans)',
  }
  if (as === 'button') {
    return (
      <button onClick={onClick} style={base} className="tag-pill" type="button">
        {children}
      </button>
    )
  }
  return <span style={base}>{children}</span>
}
