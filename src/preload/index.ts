import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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
  readSessionTranscript: (sessionId: string) =>
    ipcRenderer.invoke('claude:readTranscript', sessionId) as Promise<
      Array<{
        role: 'user' | 'assistant'
        parts: Array<{
          kind: 'text' | 'tool'
          text: string
          label?: string
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
  openChatWindow: () => ipcRenderer.invoke('chat:open') as Promise<void>,
  getChatLog: () =>
    ipcRenderer.invoke('notion:getChatLog') as Promise<
      Array<{
        id: string
        name: string
        lastActive: string | null
        projects: string[]
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
  setChatProject: (pageId: string, projectTitles: string[]) =>
    ipcRenderer.invoke('notion:setChatProject', pageId, projectTitles) as Promise<void>,
  archiveChatPage: (pageId: string) => ipcRenderer.invoke('notion:archiveChatPage', pageId) as Promise<void>,
  getProjects: () =>
    ipcRenderer.invoke('notion:getProjects') as Promise<
      Array<{ id: string; title: string; lastEdited: string | null; preview: string; color: string | null }>
    >,
  createProject: (title: string) => ipcRenderer.invoke('notion:createProject', title) as Promise<string>,
  updateProjectTitle: (pageId: string, title: string) =>
    ipcRenderer.invoke('notion:updateProjectTitle', pageId, title) as Promise<void>,
  getProjectDetail: (pageId: string) =>
    ipcRenderer.invoke('notion:getProjectDetail', pageId) as Promise<{
      id: string
      title: string
      lastEdited: string | null
      instructions: string
      color: string | null
      blocks: Array<{ id: string; type: string; text: string; checked?: boolean; url?: string }>
      chats: Array<{ id: string; name: string; sessionId: string | null }>
    }>,
  getProjectContext: (projectId: string) =>
    ipcRenderer.invoke('notion:getProjectContext', projectId) as Promise<string>,
  getProjectVersion: (projectId: string) =>
    ipcRenderer.invoke('notion:getProjectVersion', projectId) as Promise<string>,
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
  getTitleMarkdown: () => ipcRenderer.invoke('notion:getTitleMarkdown') as Promise<string>,
  saveTitleMarkdown: (text: string) => ipcRenderer.invoke('notion:saveTitleMarkdown', text) as Promise<void>
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
