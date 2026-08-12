import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      setIgnoreMouseEvents: (ignore: boolean) => void
      setRgbColor: (r: number, g: number, b: number) => Promise<void>
      setLedStripColor: (r: number, g: number, b: number) => Promise<void>
      askClaude: (prompt: string) => Promise<string>
      onClaudeEvent: (callback: (event: Record<string, unknown>) => void) => () => void
      openChatWindow: () => Promise<void>
      getChatLog: () => Promise<Array<{ id: string; name: string; lastActive: string | null }>>
      getChatTranscript: (pageId: string) => Promise<Array<{ role: 'user' | 'assistant'; text: string }>>
      updateLastActive: (pageId: string) => Promise<void>
      appendMessages: (pageId: string, messages: Array<{ role: 'user' | 'assistant'; text: string }>) => Promise<void>
      createChatPage: (name: string) => Promise<string>
      updatePageTitle: (pageId: string, name: string) => Promise<void>
    }
  }
}
