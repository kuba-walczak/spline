import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ChatWindow from './ChatWindow'
import './chat.css'

/* macOS draws overlay scrollbars: they float above the content and reserve no width. Every
   scrolling pane in this app takes its horizontal inset from `.chatscroll`'s `scrollbar-gutter`,
   so with nothing to reserve the rows sit flush against both edges — the sidebar's labels and
   titles touch the sides. Windows' bars occupy real width, which is why the same stylesheet
   insets correctly there.

   Measured rather than inferred from `process.platform`: a Mac set to "Show scroll bars: Always"
   gets space-taking bars, and there the gutter works and padding would double the inset. The probe
   is deliberately unclassed — a `.chatscroll` one would report the width its own
   `::-webkit-scrollbar` rule asks for, which is the thing being tested. */
function markOverlayScrollbars(): void {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow-y:scroll'
  document.body.appendChild(probe)
  const overlay = probe.offsetWidth === probe.clientWidth
  probe.remove()
  if (overlay) document.documentElement.dataset.overlayScrollbars = 'true'
}

markOverlayScrollbars()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatWindow onSend={window.api.askClaude} />
  </StrictMode>
)
