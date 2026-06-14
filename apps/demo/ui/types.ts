/* @reineira-os/ui — shared types for the registry/design-system surface. */

export type TrustTier = 'canonical' | 'verified' | 'listed'
export type Maturity = 'live' | 'chaos-net' | 'spec' | 'research'
export type Conformance = 'pass' | 'pending' | 'na'

export interface SnippetLine {
  content: string
  highlighted?: boolean
}

export interface CodeTab {
  label: string
  lines: SnippetLine[]
}

export interface AddressRow {
  network: string
  address: string
  note?: string
}

export interface ListingParam {
  name: string
  type: string
  required?: boolean
  default?: string
  description: string
}

export interface Listing {
  id: string
  name: string
  icon: string
  type: string
  subcat?: string
  tier: TrustTier
  maturity: Maturity
  maturityDetail?: string
  conformance: Conformance
  flagship?: boolean
  risk?: boolean
  listed?: boolean
  oneLine: string
  longDesc: string
  author: string
  org: string
  manifestId: string
  chain: string[]
  license: string
  rssVersion: string
  addresses: AddressRow[]
  repo: string
  docsHref: string
  rssNote: string
  iface: string
  params: ListingParam[]
  snippet: { install: SnippetLine[]; use: SnippetLine[] }
}
