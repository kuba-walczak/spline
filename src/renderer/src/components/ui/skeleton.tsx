import type { ReactElement } from 'react'

/** A grey block standing in for content still loading. Sized to whatever it replaces, so the panel
    does not resize when the real thing arrives.

    The sweep itself is `.pdskeleton` in chat.css — a highlight band travelling across a flat fill,
    rather than a pulse, so a column of these reads as one motion. */
export function Skeleton({
  width = '100%',
  height,
  radius,
  delay = 0,
  maxWidth
}: {
  width?: string | number
  height: number | string
  radius?: number | string
  maxWidth?: number | string
  /** Offsets the sweep so a stack of these reads as one pass rather than several in lockstep. */
  delay?: number
}): ReactElement {
  return (
    <div
      className="pdskeleton"
      style={{
        width,
        maxWidth,
        height,
        borderRadius: radius,
        animationDelay: delay ? `${delay}s` : undefined
      }}
    />
  )
}

/** A paragraph's worth of lines, the last one short so it reads as prose rather than a block. */
export function SkeletonLines({
  lines = 3,
  height = 12,
  gap = 8,
  maxWidth,
  delay = 0
}: {
  lines?: number
  height?: number
  gap?: number
  maxWidth?: number | string
  delay?: number
}): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, maxWidth }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          height={height}
          width={i === lines - 1 ? '62%' : '100%'}
          delay={delay + i * 0.1}
        />
      ))}
    </div>
  )
}
