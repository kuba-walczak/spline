import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send('setIgnoreMouseEvents', ignore),
  setRgbColor: (r: number, g: number, b: number) => ipcRenderer.invoke('setRgbColor', r, g, b) as Promise<void>,
  streamDeck: {
    fillKeyColor: (keyIndex: number, r: number, g: number, b: number) =>
      ipcRenderer.invoke('streamDeck:fillKeyColor', keyIndex, r, g, b) as Promise<void>,
    fillKeyImage: (keyIndex: number, imageBuffer: Buffer) =>
      ipcRenderer.invoke('streamDeck:fillKeyImage', keyIndex, imageBuffer) as Promise<void>,
    clearPanel: () => ipcRenderer.invoke('streamDeck:clearPanel') as Promise<void>,
    setBrightness: (percentage: number) => ipcRenderer.invoke('streamDeck:setBrightness', percentage) as Promise<void>
  }
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
