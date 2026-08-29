import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppConfig } from '../shared/config'
import type { Skill, SkillData } from '../shared/skills'

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
      readSessionContextTokens: (sessionId: string) => Promise<number | null>
      readSessionTranscript: (sessionId: string) => Promise<TranscriptMessage[]>
      generateChatTitle: (prompt: string) => Promise<string>
      onClaudeEvent: (
        callback: (payload: { sessionId: string; event: Record<string, unknown> }) => void
      ) => () => void
      onClaudeDebug: (callback: (payload: { sessionId: string; line: string }) => void) => () => void
      openChatWindow: () => Promise<void>
      getChatLog: () => Promise<
        Array<{
          id: string
          name: string
          lastActive: string | null
          /** The chat's projects as page ids — or, on a row not written since the app moved off
              titles, the project titles it used to store. */
          projectRefs: string[]
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
      /** Replaces the chat's project tags. Ids, not titles — a title breaks the link the moment the
          project is renamed in Notion. */
      setChatProject: (pageId: string, projectIds: string[]) => Promise<void>
      /** Rewrites chat rows still tagged by project title to tag by id instead, and answers how many
          it changed. Idempotent, so it is safe to call at every start. */
      migrateChatProjectRefs: (projects: Array<{ id: string; title: string }>) => Promise<number>
      archiveChatPage: (pageId: string) => Promise<void>
      getProjects: () => Promise<
        Array<{ id: string; title: string; lastEdited: string | null; preview: string; color: string | null }>
      >
      /** People are Notion pages and nothing more — the app lists them and shows what they say. */
      getPeople: () => Promise<Array<{ id: string; name: string }>>
      getPerson: (pageId: string) => Promise<{
      id: string
      name: string
      lastEdited: string | null
      blocks: Array<{ id: string; type: string; text: string; checked?: boolean; url?: string }>
    }>
      createPerson: (name: string) => Promise<string>
      updatePersonContent: (pageId: string, text: string) => Promise<void>
      renamePerson: (pageId: string, name: string) => Promise<void>
      archivePerson: (pageId: string) => Promise<void>
      createProject: (title: string) => Promise<string>
      archiveProject: (pageId: string) => Promise<void>
      updateProjectTitle: (pageId: string, title: string) => Promise<void>
      getProjectDetail: (pageId: string) => Promise<{
        id: string
        title: string
        lastEdited: string | null
        instructions: string
        color: string | null
        blocks: Array<{ id: string; type: string; text: string; checked?: boolean; url?: string }>
        chats: Array<{ id: string; name: string; sessionId: string | null; lastEdited?: string | null }>
        people: Array<{ id: string; name: string }>
      }>
      getProjectContext: (projectId: string) => Promise<string>
      /** Stamp that moves whenever anything the project contributes to the system prompt changes. */
      getProjectVersion: (projectId: string) => Promise<string>
      appendProjectNote: (pageId: string, text: string) => Promise<void>
      updateProjectInstructions: (projectId: string, text: string) => Promise<void>
      updateProjectColor: (projectId: string, color: string) => Promise<void>
      updateContextPageContent: (pageId: string, text: string) => Promise<void>
      createContextPage: (projectId: string, title: string, text: string) => Promise<string>
      /** Archives a context page, taking it out of the project and into Notion's trash. */
      deleteContextPage: (pageId: string) => Promise<void>
      /** Drops one project's tag from a chat's Notion row, leaving the chat itself in the Chat Log. */
      unlinkChatFromProject: (pageId: string, projectId: string, projectTitle: string) => Promise<void>
      linkChatToProject: (pageId: string, projectId: string, projectTitle: string) => Promise<void>
      updateProjectPeople: (projectId: string, personIds: string[]) => Promise<void>
      /** Every skill, bodies included — a one-shot skill has to be injectable the instant it is
          typed, with no fetch on the send path. */
      getSkills: () => Promise<Skill[]>
      /** One skill, re-read on selection so the editor shows what Notion holds now. */
      getSkill: (pageId: string) => Promise<Skill>
      createSkill: (name: string) => Promise<string>
      saveSkill: (pageId: string, skill: SkillData) => Promise<void>
      renameSkill: (pageId: string, name: string) => Promise<void>
      archiveSkill: (pageId: string) => Promise<void>
      /** The whole configuration, as one JSON block on the Notion Config page. */
      getConfig: () => Promise<AppConfig>
      saveConfig: (config: AppConfig) => Promise<void>
    }
  }
}
