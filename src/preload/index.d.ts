import { ElectronAPI } from '@electron-toolkit/preload'

interface ChatToolCall {
  name: string
  query: string
}

/** Stored shape — role is positional: messages alternate, starting with the user. */
interface ChatMessage {
  content: string
  tools: ChatToolCall[]
  projects: string[]
}

type ChatTranscriptMessage = ChatMessage & { role: 'user' | 'assistant' }

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      setIgnoreMouseEvents: (ignore: boolean) => void
      setRgbColor: (r: number, g: number, b: number) => Promise<void>
      setLedStripColor: (r: number, g: number, b: number) => Promise<void>
      askClaude: (prompt: string) => Promise<string>
      claudeConsumeNeedsGuidelines: () => Promise<boolean>
      getClaudeModel: () => Promise<string>
      setClaudeModel: (model: string) => Promise<void>
      getClaudeEffort: () => Promise<string>
      setClaudeEffort: (effort: string) => Promise<void>
      onClaudeEvent: (callback: (event: Record<string, unknown>) => void) => () => void
      openChatWindow: () => Promise<void>
      getChatLog: () => Promise<
        Array<{ id: string; name: string; lastActive: string | null; projects: string[] }>
      >
      getChatTranscript: (pageId: string) => Promise<ChatTranscriptMessage[]>
      updateLastActive: (pageId: string) => Promise<void>
      appendMessages: (pageId: string, messages: ChatMessage[]) => Promise<void>
      createChatPage: (name: string) => Promise<string>
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
        chats: Array<{ id: string; name: string }>
      }>
      getProjectContext: (projectId: string) => Promise<string>
      appendProjectNote: (pageId: string, text: string) => Promise<void>
      updateProjectInstructions: (projectId: string, text: string) => Promise<void>
      updateProjectColor: (projectId: string, color: string) => Promise<void>
      updateContextPageContent: (pageId: string, text: string) => Promise<void>
      createContextPage: (projectId: string, title: string, text: string) => Promise<string>
      getProjectMarkdown: () => Promise<string>
      saveProjectMarkdown: (text: string) => Promise<void>
      getChatMarkdown: () => Promise<string>
      saveChatMarkdown: (text: string) => Promise<void>
    }
  }
}
