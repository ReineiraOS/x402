import type { CSSProperties } from "react";
import {
  Zap,
  Lock,
  Shield,
  Fingerprint,
  Rss,
  Umbrella,
  Clock,
  Plug,
  Search,
  Copy,
  Check,
  ArrowRight,
  ArrowUpRight,
  Github,
  TriangleAlert,
  Command,
  X,
  BookOpen,
  ChevronRight,
  Layers,
  FileText,
  KeyRound,
  Play,
  RotateCw,
  Box,
  Globe,
  Terminal,
  Sun,
  Moon,
  Plus,
  Pencil,
  PanelLeft,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

/* Stable name → lucide component map. Keeps the prototype's `name` API so
   ported components don't churn, while upgrading the hand-drawn glyphs to
   crisp, landing-grade monochrome icons (stroke 1.5–1.6). */
const ICONS: Record<string, LucideIcon> = {
  bolt: Zap,
  lock: Lock,
  shield: Shield,
  fingerprint: Fingerprint,
  feed: Rss,
  umbrella: Umbrella,
  clock: Clock,
  plug: Plug,
  search: Search,
  copy: Copy,
  check: Check,
  arrowRight: ArrowRight,
  externalLink: ArrowUpRight,
  github: Github,
  alert: TriangleAlert,
  command: Command,
  x: X,
  book: BookOpen,
  chevronRight: ChevronRight,
  layers: Layers,
  doc: FileText,
  passkey: KeyRound,
  play: Play,
  plus: Plus,
  edit: Pencil,
  panel: PanelLeft,
  chart: BarChart3,
  refresh: RotateCw,
  cube: Box,
  globe: Globe,
  terminal: Terminal,
  sun: Sun,
  moon: Moon,
};

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 16, stroke = 1.6, className, style }: IconProps) {
  const Cmp = ICONS[name] ?? Zap;
  return (
    <Cmp size={size} strokeWidth={stroke} className={className} style={style} aria-hidden="true" />
  );
}
