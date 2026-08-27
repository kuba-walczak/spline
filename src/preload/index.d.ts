import { ElectronAPI } from '@electron-toolkit/preload'

/** One part of a message as the CLI's session transcript stores it. */
interface TranscriptPart {
  kind: 'text' | 'tool'
  text: string
  label?: string
  /** What the call came back with: sources, resolved tool names, or plain text. */
  outcome?: { links: Array<{ title: string; url: string }>; tools: string[]; text: string }
}

/** `idle` — no process. `booting` — spawned, nothing heard back yet. `ready` — the CLI has spoken. */
type SessionStatus = 'idle' | 'booting' | 'ready'

interface TranscriptMessage {
  role: 'user' | 'assistant'
  parts: TranscriptPart[]
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      setIgnoreMouseEvents: (ignore: boolean) => void
      setRgbColor: (r: number, g: number, b: number) => Promise<void>
      setLedStripColor: (r: number, g: number, b: number) => Promise<void>
      askClaude: (
        sessionId: string,
        prompt: string,
        model: string,
        effort: string,
        systemPrompt: string
      ) => Promise<string>
      stopClaudeSession: (sessionId: string) => Promise<void>
      restartClaudeSession: (
        sessionId: string,
        model: string,
        effort: string,
        systemPrompt?: string
      ) => Promise<void>
      getSessionStatuses: () => Promise<Record<string, SessionStatus>>
      onClaudeStatus: (
        callback: (payload: { sessionId: string; status: SessionStatus }) => void
      ) => () => void
      readSessionTranscript: (sessionId: string) => Promise<TranscriptMessage[]>
      generateChatTitle: (prompt: string) => Promise<string>
      onClaudeEvent: (
        callback: (payload: { sessionId: string; event: Record<string, unknown> }) => void
      ) => () => void
      openChatWindow: () => Promise<void>
      getChatLog: () => Promise<
        Array<{
          id: string
          name: string
          lastActive: string | null
          projects: string[]
          sessionId: string | null
          model: string | null
          effort: string | null
        }>
      >
      updateLastActive: (pageId: string) => Promise<void>
      createChatPage: (name: string, sessionId: string, model: string, effort: string) => Promise<string>
      setChatModel: (pageId: string, model: string) => Promise<void>
      setChatEffort: (pageId: string, effort: string) => Promise<void>
      setChatSessionId: (pageId: string, sessionId: string) => Promise<void>
      updatePageTitle: (pageId: string, name: string) => Promise<void>
      setChatProject: (pageId: string, projectTitles: string[]) => Promise<void>
      archiveChatPage: (pageId: string) => Promise<void>
      getProjects: () => Promise<
        Array<{ id: string; title: string; lastEdited: string | null; preview: string; color: string | null }>
      >
      createProject: (title: string) => Promise<string>
      updateProjectTitle: (pageId: string, title: string) => Promise<void>
      getProjectDetail: (pageId: string) => Promise<{
        id: string
        title: string
        lastEdited: string | null
        instructions: string
        color: string | null
        blocks: Array<{ id: string; type: string; text: string; checked?: boolean; url?: string }>
        chats: Array<{ id: string; name: string; sessionId: string | null }>
      }>
      getProjectContext: (projectId: string) => Promise<string>
      /** Stamp that moves whenever anything the project contributes to the system prompt changes. */
      getProjectVersion: (projectId: string) => Promise<string>
      appendProjectNote: (pageId: string, text: string) => Promise<void>
      updateProjectInstructions: (projectId: string, text: string) => Promise<void>
      updateProjectColor: (projectId: string, color: string) => Promise<void>
      updateContextPageContent: (pageId: string, text: string) => Promise<void>
      createContextPage: (projectId: string, title: string, text: string) => Promise<string>
      /** The instruction prepended to every chat's system prompt, stored as SYSTEM.md. */
      getSystemMarkdown: () => Promise<string>
      saveSystemMarkdown: (text: string) => Promise<void>
      getTitleMarkdown: () => Promise<string>
      saveTitleMarkdown: (text: string) => Promise<void>
    }
  }
}
