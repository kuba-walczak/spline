import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppConfig } from '../shared/config'
import type { VoiceEvent } from '../shared/voice'
import type { Skill, SkillData } from '../shared/skills'
import type { ContextFolder } from '../shared/context'

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
      setVoiceListening: (on: boolean) => void
      setVoiceMeter: (on: boolean) => void
      onVoiceEvent: (callback: (event: VoiceEvent) => void) => () => void
      openChatWindow: () => Promise<void>
      getChatLog: () => Promise<
        Array<{
          id: string
          name: string
          lastActive: string | null
          /** The chat's projects as page ids, from rows written before membership moved onto the
              project pages. A fallback until `migrateProjectMembership` has cleared them. */
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
      archiveChatPage: (pageId: string) => Promise<void>
      getProjects: () => Promise<
        Array<{
        id: string
        title: string
        lastEdited: string | null
        color: string | null
        instructions: string
      }>
      >
      /** People are Notion pages and nothing more — the app lists them and shows what they say. */
      getPeople: () => Promise<Array<{ id: string; name: string; affiliation: string }>>
      getPerson: (pageId: string) => Promise<{
      id: string
      name: string
      affiliation: string
      lastEdited: string | null
      blocks: Array<{
        id: string
        type: string
        text: string
        checked?: boolean
        url?: string
        /** `table` only: every row, the header included when there is one. */
        rows?: string[][]
        /** `table` only: whether the first of `rows` is the column header. */
        hasColumnHeader?: boolean
      }>
    }>
      createPerson: (name: string) => Promise<string>
      updatePersonContent: (pageId: string, text: string) => Promise<void>
      updatePersonAffiliation: (pageId: string, affiliation: string) => Promise<void>
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
        blocks: Array<{
          id: string
          type: string
          text: string
          checked?: boolean
          url?: string
          /** `table` only: every row, the header included when there is one. */
          rows?: string[][]
          /** `table` only: whether the first of `rows` is the column header. */
          hasColumnHeader?: boolean
        }>
        chats: Array<{ id: string; name: string; sessionId: string | null; lastEdited?: string | null }>
        people: Array<{ id: string; name: string }>
        folders: ContextFolder[]
      }>
      /** `excludeSessionId` leaves one chat's transcript out — the chat the context is being built
          for, which the CLI is already resuming and so already holds. */
      getProjectContext: (projectId: string, excludeSessionId?: string) => Promise<string>
      /** Stamp that moves whenever anything the project contributes to the system prompt changes.
          Takes the same exclusion, or the excluded chat would restamp the project by sending. */
      getProjectVersion: (projectId: string, excludeSessionId?: string) => Promise<string>
      appendProjectNote: (pageId: string, text: string) => Promise<void>
      updateProjectInstructions: (projectId: string, text: string) => Promise<void>
      updateProjectColor: (projectId: string, color: string) => Promise<void>
      updateContextPageContent: (pageId: string, text: string) => Promise<void>
      createContextPage: (projectId: string, title: string, text: string) => Promise<string>
      /** Archives a context page, taking it out of the project and into Notion's trash. */
      deleteContextPage: (pageId: string) => Promise<void>
      removeContextPage: (parentId: string, pageId: string) => Promise<void>
      createPage: (title: string, text: string) => Promise<string>
      getPages: () => Promise<Array<{ id: string; title: string; lastEdited: string | null }>>
      /** Which projects each thing is in — chats, people, anything a project links to — keyed by
          the linked page's id. Read by looking in the projects, so it costs a request per project:
          hold the result rather than asking per row. */
      getContextProjectMap: () => Promise<Record<string, string[]>>
      /** Puts one or more things in a project, or in one of its folders: a link block each on the
          page they belong to. The single way anything is attached. */
      linkContext: (parentId: string, targetIds: string[]) => Promise<void>
      /** Takes one back out, by deleting the link block naming it. A mention typed by hand in Notion
          is left alone — it is removed the same way it was added. */
      unlinkContext: (parentId: string, targetId: string) => Promise<void>
      /** One-shot: converts chat row tags, the CLAUDE.md people list and folders' JSON blocks into
          link blocks, clearing each old record as it goes. Safe to run twice. */
      migrateProjectMembership: () => Promise<{ chats: number; people: number; folders: number }>
      /** Creates the folder's own Notion page under the project and returns its id. */
      createContextFolder: (projectId: string, name: string) => Promise<string>
      /** Archives the folder's page, taking the context pages inside it to Notion's trash with it.
          Chats and people are only recorded there, so they stay attached to the project. */
      deleteContextFolder: (folderId: string) => Promise<void>
      /** Moves a context page under another parent, returning its new id. Notion cannot reparent a
          page, so this copies the body across and archives the original. */
      moveContextPage: (pageId: string, fromId: string, toId: string) => Promise<string>
      /** Retitles a context page. */
      renameContextPage: (pageId: string, title: string) => Promise<void>
      /** Renames a folder. Takes the name without the "(folder)" marker; the marker is put back on
          the way to Notion, since a folder that loses it stops being one. */
      renameContextFolder: (folderId: string, name: string) => Promise<void>
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
