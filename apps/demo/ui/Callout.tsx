import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { TrustTier } from './types'

type CalloutVariant = 'info' | 'tip' | 'warning'

const CALLOUT_CFG: Record<CalloutVariant, { border: string; bg: string; label: string; icon: string }> = {
  info: { border: 'var(--accent-blue)', bg: 'var(--blue-6)', label: 'Info', icon: 'feed' },
  tip: { border: 'var(--st-live)', bg: 'rgba(36,196,116,.06)', label: 'Note', icon: 'check' },
  warning: { border: 'var(--st-spec)', bg: 'rgba(243,166,40,.06)', label: 'Heads up', icon: 'alert' },
}

export function Callout({ variant = 'info', title, children }: { variant?: CalloutVariant; title?: string; children: ReactNode }) {
  const cfg = CALLOUT_CFG[variant]
  return (
    <div role="note" style={{ borderRadius: 'var(--r-sub)', borderLeft: `3px solid ${cfg.border}`, background: cfg.bg, padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: cfg.border, marginBottom: 5 }}>
        <Icon name={cfg.icon} size={13} stroke={2} />
        {title || cfg.label}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{children}</div>
    </div>
  )
}

export function RiskCallout({ tier }: { tier: TrustTier }) {
  const word = tier === 'listed' ? 'Listed' : 'Chaos-net'
  return (
    <div role="alert" style={{ borderRadius: 'var(--r-sub)', borderLeft: '3px solid var(--st-spec)', background: 'rgba(243,166,40,.08)', padding: '13px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--st-spec)', marginBottom: 6 }}>
        <Icon name="alert" size={13} stroke={2} />
        {word} — unaudited
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
        {word} is unaudited and testnet-only. Interacting with deployed contracts may result in loss of testnet funds — use at your own risk. Inspect the source before integrating.
      </div>
    </div>
  )
}
