import type { CSSProperties, ReactElement, SVGProps } from 'react'
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
  CornerRightDown,
  Download,
  EllipsisVertical,
  Folder,
  House,
  Lock,
  MessageCircle,
  Menu,
  Mic,
  Palette,
  Pencil,
  Pin,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/* Lucide's own PanelLeft draws the divider with round caps from y=3 to y=21, so
   each cap bulges half a stroke past the frame's top and bottom edges and reads
   as a seam. Same geometry, butt caps: the divider stops dead on the frame's
   centreline and disappears into it. */
function PanelLeftGlyph(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" strokeLinecap="butt" />
    </svg>
  )
}

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
  'corner-right-down': CornerRightDown,
  download: Download,
  'ellipsis-vertical': EllipsisVertical,
  folder: Folder,
  house: House,
  lock: Lock,
  'message-circle': MessageCircle,
  menu: Menu,
  mic: Mic,
  palette: Palette,
  'panel-left': PanelLeftGlyph as unknown as LucideIcon,
  pencil: Pencil,
  pin: Pin,
  plus: Plus,
  redo: Redo2,
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
