import { app, BrowserWindow, ipcMain, IpcMainEvent, Menu } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { disconnectAllDevices, getStreamDeck, setAllDevicesSolidColor, setLedStripSolidColor } from './services/DeviceManager'
import {
  askClaude,
  claudeEvents,
  consumeNeedsGuidelines,
  generateChatTitle,
  getClaudeEffort,
  getClaudeModel,
  setClaudeEffort,
  setClaudeModel,
  stopClaude
} from './services/ClaudeService'
import {
  appendMessages,
  appendProjectNote,
  archiveChatPage,
  createChatPage,
  createContextPage,
  createProjectPage,
  fetchChatLog,
  fetchChatMarkdown,
  fetchTitleMarkdown,
  fetchChatTranscript,
  fetchProjectContext,
  fetchProjectDetail,
  fetchProjectMarkdown,
  fetchProjects,
  saveChatMarkdown,
  saveTitleMarkdown,
  saveProjectMarkdown,
  setChatProjects,
  updateContextPageContent,
  updateLastActive,
  updatePageTitle,
  updateProjectColor,
  updateProjectInstructions,
  updateProjectTitle,
  type ChatMessage
} from './services/NotionService'
import { startWakeWordListener, stopWakeWordListener } from './services/WakeWordService'

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
      color: '#111111',
      symbolColor: '#c3c2b7',
      height: 32
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

function startWakeWord(): void {
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
}

claudeEvents.on('event', (event) => {
  chatWindow?.webContents.send('claude:event', event)
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  createChatWindow()
  startWakeWord()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
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

ipcMain.handle('claude:consumeNeedsGuidelines', () => {
  return consumeNeedsGuidelines()
})

ipcMain.handle('claude:getModel', () => {
  return getClaudeModel()
})

ipcMain.handle('claude:setModel', (_event, model: string) => {
  setClaudeModel(model)
})

ipcMain.handle('claude:getEffort', () => {
  return getClaudeEffort()
})

ipcMain.handle('claude:setEffort', (_event, effort: string) => {
  setClaudeEffort(effort)
})

ipcMain.handle('claude:generateTitle', async (_event, prompt: string) => {
  return generateChatTitle(prompt)
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

ipcMain.handle('notion:appendMessages', async (_event, pageId: string, messages: ChatMessage[]) => {
  await appendMessages(pageId, messages)
})

ipcMain.handle('notion:createChatPage', async (_event, name: string) => {
  return createChatPage(name)
})

ipcMain.handle('notion:updatePageTitle', async (_event, pageId: string, name: string) => {
  await updatePageTitle(pageId, name)
})

ipcMain.handle('notion:setChatProject', async (_event, pageId: string, projectTitles: string[]) => {
  await setChatProjects(pageId, projectTitles)
})

ipcMain.handle('notion:archiveChatPage', async (_event, pageId: string) => {
  await archiveChatPage(pageId)
})

ipcMain.handle('notion:getProjects', async () => {
  try {
    return await fetchProjects()
  } catch (error) {
    console.error('[main] notion:getProjects failed:', error)
    return []
  }
})

ipcMain.handle('notion:createProject', async (_event, title: string) => {
  return createProjectPage(title)
})

ipcMain.handle('notion:updateProjectTitle', async (_event, pageId: string, title: string) => {
  await updateProjectTitle(pageId, title)
})

ipcMain.handle('notion:getProjectDetail', async (_event, pageId: string) => {
  return fetchProjectDetail(pageId)
})

ipcMain.handle('notion:getProjectContext', async (_event, projectId: string) => {
  return fetchProjectContext(projectId)
})

ipcMain.handle('notion:appendProjectNote', async (_event, pageId: string, text: string) => {
  await appendProjectNote(pageId, text)
})

ipcMain.handle('notion:updateProjectInstructions', async (_event, projectId: string, text: string) => {
  await updateProjectInstructions(projectId, text)
})

ipcMain.handle('notion:updateProjectColor', async (_event, projectId: string, color: string) => {
  await updateProjectColor(projectId, color)
})

ipcMain.handle('notion:updateContextPageContent', async (_event, pageId: string, text: string) => {
  await updateContextPageContent(pageId, text)
})

ipcMain.handle('notion:createContextPage', async (_event, projectId: string, title: string, text: string) => {
  return createContextPage(projectId, title, text)
})

ipcMain.handle('notion:getProjectMarkdown', async () => {
  return fetchProjectMarkdown()
})

ipcMain.handle('notion:saveProjectMarkdown', async (_event, text: string) => {
  await saveProjectMarkdown(text)
})

ipcMain.handle('notion:getChatMarkdown', async () => {
  return fetchChatMarkdown()
})

ipcMain.handle('notion:saveChatMarkdown', async (_event, text: string) => {
  await saveChatMarkdown(text)
})

ipcMain.handle('notion:getTitleMarkdown', async () => {
  return fetchTitleMarkdown()
})

ipcMain.handle('notion:saveTitleMarkdown', async (_event, text: string) => {
  await saveTitleMarkdown(text)
})
