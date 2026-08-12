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
      Array<{ role: 'user' | 'assistant'; text: string }>
    >,
  updateLastActive: (pageId: string) => ipcRenderer.invoke('notion:updateLastActive', pageId) as Promise<void>,
  appendMessages: (pageId: string, messages: Array<{ role: 'user' | 'assistant'; text: string }>) =>
    ipcRenderer.invoke('notion:appendMessages', pageId, messages) as Promise<void>,
  createChatPage: (name: string) => ipcRenderer.invoke('notion:createChatPage', name) as Promise<string>,
  updatePageTitle: (pageId: string, name: string) =>
    ipcRenderer.invoke('notion:updatePageTitle', pageId, name) as Promise<void>
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
