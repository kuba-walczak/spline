import type { CSSProperties, ReactElement, SVGProps } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Blocks,
  Briefcase,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock,
  CodeXml,
  CornerRightDown,
  Download,
  EllipsisVertical,
  FileText,
  Folder,
  Globe,
  House,
  Info,
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
  Settings,
  SlidersHorizontal,
  Terminal,
  User,
  Users,
  Wrench,
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

/* Notion's mark, outlined. Not a redraw: this is `brand-notion` from Tabler Icons (MIT), which is
   the same 24px grid and round caps Lucide uses, so it sits beside `message-circle` and `user`
   without reading as a foreign glyph. Notion publishes no outline logo of its own — the official
   asset is the solid mark, and a filled glyph among stroked ones reads as a sticker.

   Source: https://github.com/tabler/tabler-icons — icons/outline/brand-notion.svg. Drawn for a 2px
   stroke; the shape survives the app's 1.5. */
function NotionGlyph(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M11 17.5v-6.5h.5l4 6h.5v-6.5" />
      <path d="M19.077 20.071l-11.53 .887a1 1 0 0 1 -.876 -.397l-2.471 -3.294a1 1 0 0 1 -.2 -.6v-10.741a1 1 0 0 1 .923 -.997l11.389 -.876a2 2 0 0 1 1.262 .33l1.535 1.023a2 2 0 0 1 .891 1.664v12.004a1 1 0 0 1 -.923 .997" />
      <path d="M4.5 5.5l2.5 2.5" />
      <path d="M20 7l-13 1v12.5" />
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
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  clipboard: Clipboard,
  clock: Clock,
  'code-xml': CodeXml,
  'corner-right-down': CornerRightDown,
  download: Download,
  'ellipsis-vertical': EllipsisVertical,
  'file-text': FileText,
  folder: Folder,
  globe: Globe,
  house: House,
  info: Info,
  lock: Lock,
  'message-circle': MessageCircle,
  menu: Menu,
  notion: NotionGlyph as unknown as LucideIcon,
  mic: Mic,
  palette: Palette,
  'panel-left': PanelLeftGlyph as unknown as LucideIcon,
  pencil: Pencil,
  pin: Pin,
  plus: Plus,
  redo: Redo2,
  'refresh-cw': RefreshCw,
  search: Search,
  settings: Settings,
  'sliders-horizontal': SlidersHorizontal,
  terminal: Terminal,
  user: User,
  users: Users,
  wrench: Wrench,
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
