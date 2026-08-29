import { app, BrowserWindow, ipcMain, IpcMainEvent, Menu, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { disconnectAllDevices, getStreamDeck, setAllDevicesSolidColor, setLedStripSolidColor } from './services/DeviceManager'
import {
  askClaude,
  assertClaudeExe,
  claudeEvents,
  generateChatTitle,
  getSessionStatuses,
  restartSession,
  stopAllSessions,
  stopSession
} from './services/ClaudeService'
import { readSessionContextTokens, readSessionTranscript } from './services/SessionTranscript'
import type { AppConfig } from '../shared/config'
import type { SkillData } from '../shared/skills'
import {
  appendProjectNote,
  archiveChatPage,
  archiveProject,
  createChatPage,
  createContextPage,
  createProjectPage,
  deleteContextPage,
  detachChatFromProject,
  fetchChatLog,
  archivePerson,
  attachChatToProject,
  archiveSkill,
  createPerson,
  renamePerson,
  updatePersonContent,
  createSkill,
  fetchConfig,
  fetchPeople,
  fetchPerson,
  fetchSkill,
  fetchSkills,
  fetchProjectContext,
  fetchProjectVersion,
  fetchProjectDetail,
  fetchProjects,
  migrateChatProjectRefs,
  renameSkill,
  saveConfig,
  saveSkill,
  setChatEffort,
  setChatModel,
  setChatProjects,
  setChatSessionId,
  updateContextPageContent,
  updateLastActive,
  updatePageTitle,
  updateProjectColor,
  updateProjectInstructions,
  updateProjectPeople,
  updateProjectTitle
} from './services/NotionService'
import { startWakeWordListener, stopWakeWordListener } from './services/WakeWordService'

/** Voice runs as its own long-lived chat so spoken turns keep context with each other, and
    never with whatever chat happens to be open in the window. Fixed so it resumes across runs. */
const WAKE_WORD_SESSION_ID = '6d1f0c8a-4b7e-4d21-9f3a-2c5e8b0a71d4'

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

  /* Links in a reply — a search result, a citation — belong in the user's own browser, with their
     session and extensions, not in a chrome-less Electron window that cannot navigate. Only http(s)
     is handed over: `shell.openExternal` will launch whatever a `file:` or custom-scheme URL is
     registered to, and those can arrive from model output or a fetched page. */
  const openExternally = (url: string): boolean => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    void shell.openExternal(url)
    return true
  }

  chatWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    /* Denied either way: an app window is never the right home for one of these. */
    return { action: 'deny' }
  })

  /* `target="_blank"` goes through the handler above; a plain link does not, and would replace the
     app itself with the page. */
  chatWindow.webContents.on('will-navigate', (event, url) => {
    if (url === chatWindow?.webContents.getURL()) return
    event.preventDefault()
    openExternally(url)
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
          const result = await askClaude(WAKE_WORD_SESSION_ID, text)
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

claudeEvents.on('event', (payload) => {
  chatWindow?.webContents.send('claude:event', payload)
})

claudeEvents.on('status', (payload) => {
  chatWindow?.webContents.send('claude:status', payload)
})

claudeEvents.on('debug', (payload) => {
  chatWindow?.webContents.send('claude:debug', payload)
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  /* Surfaced now rather than on the first send, where a missing binary would look like a chat
     that simply never answers. */
  try {
    assertClaudeExe()
  } catch (error) {
    console.error('[main]', error)
  }

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
  stopAllSessions()
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

ipcMain.handle(
  'askClaude',
  async (_event, sessionId: string, prompt: string, model: string, effort: string, systemPrompt: string) => {
    return askClaude(sessionId, prompt, model, effort, systemPrompt)
  }
)

ipcMain.handle('claude:stopSession', (_event, sessionId: string) => {
  stopSession(sessionId)
})

ipcMain.handle('claude:getSessionStatuses', () => {
  return getSessionStatuses()
})

ipcMain.handle(
  'claude:restartSession',
  (_event, sessionId: string, model: string, effort: string, systemPrompt?: string) => {
    restartSession(sessionId, model, effort, systemPrompt)
  }
)

ipcMain.handle('claude:readContextTokens', (_event, sessionId: string) => {
  try {
    return readSessionContextTokens(sessionId)
  } catch (error) {
    console.error('[main] claude:readContextTokens failed:', error)
    return null
  }
})

ipcMain.handle('claude:readTranscript', (_event, sessionId: string) => {
  try {
    return readSessionTranscript(sessionId)
  } catch (error) {
    console.error('[main] claude:readTranscript failed:', error)
    return []
  }
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

ipcMain.handle('notion:updateLastActive', async (_event, pageId: string) => {
  await updateLastActive(pageId)
})

ipcMain.handle(
  'notion:createChatPage',
  async (_event, name: string, sessionId: string, model: string, effort: string) => {
    return createChatPage(name, sessionId, model, effort)
  }
)

ipcMain.handle('notion:setChatModel', async (_event, pageId: string, model: string) => {
  await setChatModel(pageId, model)
})

ipcMain.handle('notion:setChatEffort', async (_event, pageId: string, effort: string) => {
  await setChatEffort(pageId, effort)
})

ipcMain.handle('notion:setChatSessionId', async (_event, pageId: string, sessionId: string) => {
  await setChatSessionId(pageId, sessionId)
})

ipcMain.handle('notion:updatePageTitle', async (_event, pageId: string, name: string) => {
  await updatePageTitle(pageId, name)
})

ipcMain.handle('notion:setChatProject', async (_event, pageId: string, projectIds: string[]) => {
  await setChatProjects(pageId, projectIds)
})

ipcMain.handle(
  'notion:migrateChatProjectRefs',
  async (_event, projects: Array<{ id: string; title: string }>) => {
    return migrateChatProjectRefs(projects)
  }
)

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

ipcMain.handle('notion:archiveProject', async (_event, pageId: string) => {
  await archiveProject(pageId)
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

ipcMain.handle('notion:getProjectVersion', async (_event, projectId: string) => {
  return fetchProjectVersion(projectId)
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

ipcMain.handle('notion:deleteContextPage', async (_event, pageId: string) => {
  await deleteContextPage(pageId)
})

ipcMain.handle(
  'notion:unlinkChatFromProject',
  async (_event, pageId: string, projectId: string, projectTitle: string) => {
    await detachChatFromProject(pageId, projectId, projectTitle)
  }
)

ipcMain.handle(
  'notion:linkChatToProject',
  async (_event, pageId: string, projectId: string, projectTitle: string) => {
    await attachChatToProject(pageId, projectId, projectTitle)
  }
)

ipcMain.handle('notion:updateProjectPeople', async (_event, projectId: string, personIds: string[]) => {
  await updateProjectPeople(projectId, personIds)
})

ipcMain.handle('notion:getPeople', async () => {
  return fetchPeople()
})

ipcMain.handle('notion:getPerson', async (_event, pageId: string) => {
  return fetchPerson(pageId)
})

ipcMain.handle('notion:createPerson', async (_event, name: string) => {
  return createPerson(name)
})

ipcMain.handle('notion:updatePersonContent', async (_event, pageId: string, text: string) => {
  await updatePersonContent(pageId, text)
})

ipcMain.handle('notion:renamePerson', async (_event, pageId: string, name: string) => {
  await renamePerson(pageId, name)
})

ipcMain.handle('notion:archivePerson', async (_event, pageId: string) => {
  await archivePerson(pageId)
})

ipcMain.handle('notion:getSkills', async () => {
  return fetchSkills()
})

ipcMain.handle('notion:getSkill', async (_event, pageId: string) => {
  return fetchSkill(pageId)
})

ipcMain.handle('notion:createSkill', async (_event, name: string) => {
  return createSkill(name)
})

ipcMain.handle('notion:saveSkill', async (_event, pageId: string, skill: SkillData) => {
  await saveSkill(pageId, skill)
})

ipcMain.handle('notion:renameSkill', async (_event, pageId: string, name: string) => {
  await renameSkill(pageId, name)
})

ipcMain.handle('notion:archiveSkill', async (_event, pageId: string) => {
  await archiveSkill(pageId)
})

ipcMain.handle('notion:getConfig', async () => {
  return fetchConfig()
})

ipcMain.handle('notion:saveConfig', async (_event, config: AppConfig) => {
  await saveConfig(config)
})
