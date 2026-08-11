import type { CSSProperties, ReactElement } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Blocks,
  Briefcase,
  ChartNoAxesColumn,
  ChevronDown,
  Clipboard,
  Clock,
  CodeXml,
  Download,
  Folder,
  House,
  MessageCircle,
  Mic,
  Palette,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/* Lucide is the design system's icon set: 1.5px stroke, round caps/joins,
   24px grid. The DS resolves icons by kebab-case name, so keep that API. */
const ICONS: Record<string, LucideIcon> = {
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'audio-lines': AudioLines,
  blocks: Blocks,
  briefcase: Briefcase,
  'chart-no-axes-column': ChartNoAxesColumn,
  'chevron-down': ChevronDown,
  clipboard: Clipboard,
  clock: Clock,
  'code-xml': CodeXml,
  download: Download,
  folder: Folder,
  house: House,
  'message-circle': MessageCircle,
  mic: Mic,
  palette: Palette,
  plus: Plus,
  'refresh-cw': RefreshCw,
  search: Search,
  'sliders-horizontal': SlidersHorizontal,
  x: X
}

export type IconName = keyof typeof ICONS | (string & {})

export interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
  style?: CSSProperties
}

export function Icon({ name, size = 16, strokeWidth = 1.5, className, style }: IconProps): ReactElement | null {
  const Glyph = ICONS[name]
  if (!Glyph) return null
  return (
    <Glyph
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      aria-hidden
      focusable="false"
      className={className}
      style={{ display: 'block', flex: '0 0 auto', ...style }}
    />
  )
}
