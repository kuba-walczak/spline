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
  askClaude: (prompt: string) => ipcRenderer.invoke('askClaude', prompt) as Promise<string>,
  onClaudeEvent: (callback: (event: Record<string, unknown>) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: Record<string, unknown>): void => callback(data)
    ipcRenderer.on('claude:event', listener)
    return () => ipcRenderer.removeListener('claude:event', listener)
  },
  openChatWindow: () => ipcRenderer.invoke('chat:open') as Promise<void>,
  getChatLog: () =>
    ipcRenderer.invoke('notion:getChatLog') as Promise<
      Array<{ id: string; name: string; lastActive: string | null }>
    >,
  getChatTranscript: (pageId: string) =>
    ipcRenderer.invoke('notion:getChatTranscript', pageId) as Promise<
      Array<{ role: 'user' | 'assistant'; content: string; tools: Array<{ name: string; query: string }> }>
    >,
  updateLastActive: (pageId: string) => ipcRenderer.invoke('notion:updateLastActive', pageId) as Promise<void>,
  appendMessages: (
    pageId: string,
    messages: Array<{ content: string; tools: Array<{ name: string; query: string }> }>
  ) =>
    ipcRenderer.invoke('notion:appendMessages', pageId, messages) as Promise<void>,
  createChatPage: (name: string) => ipcRenderer.invoke('notion:createChatPage', name) as Promise<string>,
  updatePageTitle: (pageId: string, name: string) =>
    ipcRenderer.invoke('notion:updatePageTitle', pageId, name) as Promise<void>,
  setChatProject: (pageId: string, projectTitle: string) =>
    ipcRenderer.invoke('notion:setChatProject', pageId, projectTitle) as Promise<void>,
  archiveChatPage: (pageId: string) => ipcRenderer.invoke('notion:archiveChatPage', pageId) as Promise<void>,
  getProjects: () =>
    ipcRenderer.invoke('notion:getProjects') as Promise<
      Array<{ id: string; title: string; lastEdited: string | null; preview: string }>
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
      blocks: Array<{ id: string; type: string; text: string; checked?: boolean; url?: string }>
    }>,
  getProjectContext: (projectId: string) =>
    ipcRenderer.invoke('notion:getProjectContext', projectId) as Promise<string>,
  appendProjectNote: (pageId: string, text: string) =>
    ipcRenderer.invoke('notion:appendProjectNote', pageId, text) as Promise<void>,
  updateProjectInstructions: (projectId: string, text: string) =>
    ipcRenderer.invoke('notion:updateProjectInstructions', projectId, text) as Promise<void>,
  updateContextPageContent: (pageId: string, text: string) =>
    ipcRenderer.invoke('notion:updateContextPageContent', pageId, text) as Promise<void>,
  createContextPage: (projectId: string, title: string, text: string) =>
    ipcRenderer.invoke('notion:createContextPage', projectId, title, text) as Promise<string>
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
