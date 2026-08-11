import { app, BrowserWindow, ipcMain, IpcMainEvent, Menu, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { disconnectAllDevices, getStreamDeck, setAllDevicesSolidColor, setLedStripSolidColor } from './services/DeviceManager'
import { askClaude, stopClaude } from './services/ClaudeService'
import {
  appendMessages,
  fetchChatLog,
  fetchChatTranscript,
  updateLastActive,
  type ChatTranscriptMessage
} from './services/NotionService'
import { startWakeWordListener, stopWakeWordListener } from './services/WakeWordService'

let mainWindow: BrowserWindow
let chatWindow: BrowserWindow | null = null

function loadRenderer(window: BrowserWindow, page: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${page}`)
  } else {
    window.loadFile(join(__dirname, `../renderer/${page}`))
  }
}

function createChatWindow(): BrowserWindow {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show()
    chatWindow.focus()
    return chatWindow
  }

  chatWindow = new BrowserWindow({
    title: 'Claude',
    show: false,
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#1a1a19',
    // Frameless, but keep the native window controls overlaid on the 52px header.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a19',
      symbolColor: '#c3c2b7',
      height: 52
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  chatWindow.once('ready-to-show', () => chatWindow?.show())
  chatWindow.on('closed', () => {
    chatWindow = null
  })
  chatWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[chatWindow console:${level}] ${message} (${sourceId}:${line})`)
  })
  chatWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[chatWindow] render process gone:', details)
  })

  chatWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      chatWindow?.webContents.toggleDevTools()
    }
  })

  loadRenderer(chatWindow, 'chat.html')

  return chatWindow
}

function createWindow(): void {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds

  mainWindow = new BrowserWindow({
    title: 'jarvis',
    show: false,
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.showInactive()
    mainWindow.setAlwaysOnTop(true, 'floating')
    mainWindow.setIgnoreMouseEvents(true, { forward: true })

    startWakeWordListener({
      onWake: () => {
        void setLedStripSolidColor(255, 0, 0)
      },
      onTranscript: async (text) => {
        try {
          if (text.trim()) {
            console.log(text)
            const result = await askClaude(text)
            console.log(result)
          }
        } catch (error) {
          console.error('[wakeword] askClaude failed:', error)
        } finally {
          await setLedStripSolidColor(0, 0, 0)
        }
      }
    })
  })

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools()
    }
  })

  loadRenderer(mainWindow, 'index.html')
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  createWindow()
  createChatWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      createChatWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  await disconnectAllDevices()
  stopClaude()
  stopWakeWordListener()
})

ipcMain.on('setIgnoreMouseEvents', (event: IpcMainEvent, ignore: boolean) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.setIgnoreMouseEvents(ignore, { forward: true })
})

ipcMain.handle('setRgbColor', async (_event, r: number, g: number, b: number) => {
  await setAllDevicesSolidColor(r, g, b)
})

ipcMain.handle('setLedStripColor', async (_event, r: number, g: number, b: number) => {
  await setLedStripSolidColor(r, g, b)
})

ipcMain.handle('streamDeck:fillKeyColor', async (_event, keyIndex: number, r: number, g: number, b: number) => {
  const deck = await getStreamDeck()
  await deck?.fillKeyColor(keyIndex, r, g, b)
})

ipcMain.handle('streamDeck:fillKeyImage', async (_event, keyIndex: number, imageBuffer: Buffer) => {
  const deck = await getStreamDeck()
  await deck?.fillKeyImage(keyIndex, imageBuffer)
})

ipcMain.handle('streamDeck:clearPanel', async () => {
  const deck = await getStreamDeck()
  await deck?.clearPanel()
})

ipcMain.handle('streamDeck:setBrightness', async (_event, percentage: number) => {
  const deck = await getStreamDeck()
  await deck?.setBrightness(percentage)
})

ipcMain.handle('askClaude', async (_event, prompt: string) => {
  return askClaude(prompt)
})

ipcMain.handle('chat:open', () => {
  createChatWindow()
})

ipcMain.handle('notion:getChatLog', async () => {
  try {
    return await fetchChatLog()
  } catch (error) {
    console.error('[main] notion:getChatLog failed:', error)
    return []
  }
})

ipcMain.handle('notion:getChatTranscript', async (_event, pageId: string) => {
  try {
    return await fetchChatTranscript(pageId)
  } catch (error) {
    console.error('[main] notion:getChatTranscript failed:', error)
    return []
  }
})

ipcMain.handle('notion:updateLastActive', async (_event, pageId: string) => {
  await updateLastActive(pageId)
})

ipcMain.handle('notion:appendMessages', async (_event, pageId: string, messages: ChatTranscriptMessage[]) => {
  await appendMessages(pageId, messages)
})
