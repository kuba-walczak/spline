import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppConfig } from '../shared/config'
import type { Skill, SkillData } from '../shared/skills'
import type { ContextFolder } from '../shared/context'
import type { VoiceEvent } from '../shared/voice'

const api = {
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send('setIgnoreMouseEvents', ignore),
  setRgbColor: (r: number, g: number, b: number) => ipcRenderer.invoke('setRgbColor', r, g, b) as Promise<void>,
  setLedStripColor: (r: number, g: number, b: number) => ipcRenderer.invoke('setLedStripColor', r, g, b) as Promise<void>,
  streamDeck: {
    fillKeyColor: (keyIndex: number, r: number, g: number, b: number) =>
      ipcRenderer.invoke('streamDeck:fillKeyColor', keyIndex, r, g, b) as Promise<void>,
    fillKeyImage: (keyIndex: number, imageBuffer: Buffer) =>
      ipcRenderer.invoke('streamDeck:fillKeyImage', keyIndex, imageBuffer) as Promise<void>,
    clearPanel: () => ipcRenderer.invoke('streamDeck:clearPanel') as Promise<void>,
    setBrightness: (percentage: number) => ipcRenderer.invoke('streamDeck:setBrightness', percentage) as Promise<void>
  },
  askClaude: (sessionId: string, prompt: string, model: string, effort: string, systemPrompt: string) =>
    ipcRenderer.invoke('askClaude', sessionId, prompt, model, effort, systemPrompt) as Promise<string>,
  stopClaudeSession: (sessionId: string) => ipcRenderer.invoke('claude:stopSession', sessionId) as Promise<void>,
  restartClaudeSession: (sessionId: string, model: string, effort: string, systemPrompt?: string) =>
    ipcRenderer.invoke('claude:restartSession', sessionId, model, effort, systemPrompt) as Promise<void>,
  getSessionStatuses: () =>
    ipcRenderer.invoke('claude:getSessionStatuses') as Promise<Record<string, 'idle' | 'booting' | 'ready'>>,
  onClaudeStatus: (callback: (payload: { sessionId: string; status: 'idle' | 'booting' | 'ready' }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { sessionId: string; status: 'idle' | 'booting' | 'ready' }
    ): void => callback(data)
    ipcRenderer.on('claude:status', listener)
    return () => ipcRenderer.removeListener('claude:status', listener)
  },
  readSessionContextTokens: (sessionId: string) =>
    ipcRenderer.invoke('claude:readContextTokens', sessionId) as Promise<number | null>,
  readSessionTranscript: (sessionId: string) =>
    ipcRenderer.invoke('claude:readTranscript', sessionId) as Promise<
      Array<{
        role: 'user' | 'assistant'
        parts: Array<{
          kind: 'text' | 'tool'
          text: string
          label?: string
          outcome?: { links: Array<{ title: string; url: string }>; tools: string[]; text: string }
        }>
      }>
    >,
  generateChatTitle: (prompt: string) => ipcRenderer.invoke('claude:generateTitle', prompt) as Promise<string>,
  onClaudeEvent: (callback: (payload: { sessionId: string; event: Record<string, unknown> }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { sessionId: string; event: Record<string, unknown> }
    ): void => callback(data)
    ipcRenderer.on('claude:event', listener)
    return () => ipcRenderer.removeListener('claude:event', listener)
  },
  onClaudeDebug: (callback: (payload: { sessionId: string; line: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { sessionId: string; line: string }
    ): void => callback(data)
    ipcRenderer.on('claude:debug', listener)
    return () => ipcRenderer.removeListener('claude:debug', listener)
  },
  /** Whether the listener turns what it hears into text. Wake detection runs regardless. */
  setVoiceListening: (on: boolean) => ipcRenderer.send('voice:setListening', on),
  /** Whether input level is reported. Only worth having on while something is showing it. */
  setVoiceMeter: (on: boolean) => ipcRenderer.send('voice:setMeter', on),
  onVoiceEvent: (callback: (event: VoiceEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: VoiceEvent): void => callback(data)
    ipcRenderer.on('voice:event', listener)
    return () => ipcRenderer.removeListener('voice:event', listener)
  },
  openChatWindow: () => ipcRenderer.invoke('chat:open') as Promise<void>,
  getChatLog: () =>
    ipcRenderer.invoke('notion:getChatLog') as Promise<
      Array<{
        id: string
        name: string
        lastActive: string | null
        projectRefs: string[]
        sessionId: string | null
        model: string | null
        effort: string | null
      }>
    >,
  updateLastActive: (pageId: string) => ipcRenderer.invoke('notion:updateLastActive', pageId) as Promise<void>,
  createChatPage: (name: string, sessionId: string, model: string, effort: string) =>
    ipcRenderer.invoke('notion:createChatPage', name, sessionId, model, effort) as Promise<string>,
  setChatModel: (pageId: string, model: string) =>
    ipcRenderer.invoke('notion:setChatModel', pageId, model) as Promise<void>,
  setChatEffort: (pageId: string, effort: string) =>
    ipcRenderer.invoke('notion:setChatEffort', pageId, effort) as Promise<void>,
  setChatSessionId: (pageId: string, sessionId: string) =>
    ipcRenderer.invoke('notion:setChatSessionId', pageId, sessionId) as Promise<void>,
  updatePageTitle: (pageId: string, name: string) =>
    ipcRenderer.invoke('notion:updatePageTitle', pageId, name) as Promise<void>,
  archiveChatPage: (pageId: string) => ipcRenderer.invoke('notion:archiveChatPage', pageId) as Promise<void>,
  getProjects: () =>
    ipcRenderer.invoke('notion:getProjects') as Promise<
      Array<{
        id: string
        title: string
        lastEdited: string | null
        color: string | null
        instructions: string
      }>
    >,
  createProject: (title: string) => ipcRenderer.invoke('notion:createProject', title) as Promise<string>,
  archiveProject: (pageId: string) => ipcRenderer.invoke('notion:archiveProject', pageId) as Promise<void>,
  updateProjectTitle: (pageId: string, title: string) =>
    ipcRenderer.invoke('notion:updateProjectTitle', pageId, title) as Promise<void>,
  getProjectDetail: (pageId: string) =>
    ipcRenderer.invoke('notion:getProjectDetail', pageId) as Promise<{
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
    }>,
  getProjectContext: (projectId: string, excludeSessionId?: string) =>
    ipcRenderer.invoke('notion:getProjectContext', projectId, excludeSessionId) as Promise<string>,
  getProjectVersion: (projectId: string, excludeSessionId?: string) =>
    ipcRenderer.invoke('notion:getProjectVersion', projectId, excludeSessionId) as Promise<string>,
  appendProjectNote: (pageId: string, text: string) =>
    ipcRenderer.invoke('notion:appendProjectNote', pageId, text) as Promise<void>,
  updateProjectInstructions: (projectId: string, text: string) =>
    ipcRenderer.invoke('notion:updateProjectInstructions', projectId, text) as Promise<void>,
  updateProjectColor: (projectId: string, color: string) =>
    ipcRenderer.invoke('notion:updateProjectColor', projectId, color) as Promise<void>,
  updateContextPageContent: (pageId: string, text: string) =>
    ipcRenderer.invoke('notion:updateContextPageContent', pageId, text) as Promise<void>,
  createContextPage: (projectId: string, title: string, text: string) =>
    ipcRenderer.invoke('notion:createContextPage', projectId, title, text) as Promise<string>,
  deleteContextPage: (pageId: string) =>
    ipcRenderer.invoke('notion:deleteContextPage', pageId) as Promise<void>,
  removeContextPage: (parentId: string, pageId: string) =>
    ipcRenderer.invoke('notion:removeContextPage', parentId, pageId) as Promise<void>,
  createPage: (title: string, text: string) =>
    ipcRenderer.invoke('notion:createPage', title, text) as Promise<string>,
  getPages: () =>
    ipcRenderer.invoke('notion:getPages') as Promise<
      Array<{ id: string; title: string; lastEdited: string | null }>
    >,
  createContextFolder: (projectId: string, name: string) =>
    ipcRenderer.invoke('notion:createContextFolder', projectId, name) as Promise<string>,
  deleteContextFolder: (folderId: string) =>
    ipcRenderer.invoke('notion:deleteContextFolder', folderId) as Promise<void>,

  moveContextPage: (pageId: string, fromId: string, toId: string) =>
    ipcRenderer.invoke('notion:moveContextPage', pageId, fromId, toId) as Promise<string>,
  renameContextPage: (pageId: string, title: string) =>
    ipcRenderer.invoke('notion:renameContextPage', pageId, title) as Promise<void>,
  renameContextFolder: (folderId: string, name: string) =>
    ipcRenderer.invoke('notion:renameContextFolder', folderId, name) as Promise<void>,
  getContextProjectMap: () =>
    ipcRenderer.invoke('notion:getContextProjectMap') as Promise<Record<string, string[]>>,
  linkContext: (parentId: string, targetIds: string[]) =>
    ipcRenderer.invoke('notion:linkContext', parentId, targetIds) as Promise<void>,
  unlinkContext: (parentId: string, targetId: string) =>
    ipcRenderer.invoke('notion:unlinkContext', parentId, targetId) as Promise<void>,
  migrateProjectMembership: () =>
    ipcRenderer.invoke('notion:migrateProjectMembership') as Promise<{
      chats: number
      people: number
      folders: number
    }>,
  getPeople: () =>
    ipcRenderer.invoke('notion:getPeople') as Promise<
      Array<{ id: string; name: string; affiliation: string }>
    >,
  getPerson: (pageId: string) =>
    ipcRenderer.invoke('notion:getPerson', pageId) as Promise<{
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
    }>,
  createPerson: (name: string) => ipcRenderer.invoke('notion:createPerson', name) as Promise<string>,
  updatePersonContent: (pageId: string, text: string) =>
    ipcRenderer.invoke('notion:updatePersonContent', pageId, text) as Promise<void>,
  updatePersonAffiliation: (pageId: string, affiliation: string) =>
    ipcRenderer.invoke('notion:updatePersonAffiliation', pageId, affiliation) as Promise<void>,
  renamePerson: (pageId: string, name: string) =>
    ipcRenderer.invoke('notion:renamePerson', pageId, name) as Promise<void>,
  archivePerson: (pageId: string) => ipcRenderer.invoke('notion:archivePerson', pageId) as Promise<void>,
  getSkills: () => ipcRenderer.invoke('notion:getSkills') as Promise<Skill[]>,
  getSkill: (pageId: string) => ipcRenderer.invoke('notion:getSkill', pageId) as Promise<Skill>,
  createSkill: (name: string) => ipcRenderer.invoke('notion:createSkill', name) as Promise<string>,
  saveSkill: (pageId: string, skill: SkillData) =>
    ipcRenderer.invoke('notion:saveSkill', pageId, skill) as Promise<void>,
  renameSkill: (pageId: string, name: string) =>
    ipcRenderer.invoke('notion:renameSkill', pageId, name) as Promise<void>,
  archiveSkill: (pageId: string) => ipcRenderer.invoke('notion:archiveSkill', pageId) as Promise<void>,
  getConfig: () => ipcRenderer.invoke('notion:getConfig') as Promise<AppConfig>,
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('notion:saveConfig', config) as Promise<void>
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
