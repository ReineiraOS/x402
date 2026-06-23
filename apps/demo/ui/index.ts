/* @reineira-os/ui — shared design system barrel. */
export * from "./types";

export { Icon } from "./Icon";
export type { IconName, IconProps } from "./Icon";

export { Wordmark } from "./Wordmark";

export {
  TIER_CONFIG,
  STATUS_CONFIG,
  TrustTierBadge,
  MaturityStatusBadge,
  ConformanceChip,
  TagPill,
} from "./badges";

export { CodeBlock } from "./CodeBlock";
export { useCopy, CopyField, CopyInline } from "./CopyField";
export { DocsTable } from "./DocsTable";
export type { DocsColumn } from "./DocsTable";
export { PropertyCard } from "./PropertyCard";
export { Callout, RiskCallout } from "./Callout";

export { SiteFooter } from "./SiteFooter";
export type { FooterLink, FooterColumn, FooterSocial, SiteFooterProps } from "./SiteFooter";
export { HonestyRail } from "./HonestyRail";
