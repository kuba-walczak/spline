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
import { pullTranscript, schedulePush } from './services/TranscriptSync'
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
  removeContextPage,
  fetchPages,
  createPage,
  fetchChatLog,
  archivePerson,
  archiveSkill,
  createPerson,
  renamePerson,
  updatePersonContent,
  updatePersonAffiliation,
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
  renameSkill,
  saveConfig,
  saveSkill,
  setChatEffort,
  setChatModel,
  setChatSessionId,
  updateContextPageContent,
  updateLastActive,
  updatePageTitle,
  updateProjectColor,
  updateProjectInstructions,
  linkContext,
  fetchContextProjectMap,
  unlinkContext,
  migrateProjectMembership,
  createContextFolder,
  moveContextPage,
  renameContextPage,
  renameContextFolder,
  deleteContextFolder,
  updateProjectTitle
} from './services/NotionService'
import {
  startWakeWordListener,
  stopWakeWordListener,
  setVoiceListening,
  setVoiceMeter,
  setVoiceConfig
} from './services/WakeWordService'
import type { VoiceEvent } from '../shared/voice'

let chatWindow: BrowserWindow | null = null

/* The renderer owns the voice mode - it is what the buttons show and what the wake word toggles -
   so these two are a mirror of it, kept for the moments the renderer cannot speak for itself: a
   reload, a closed window, a worker that died. Something has to switch the listener off then, and
   it cannot be the side that just went away. */
let voiceListening = false
let voiceAvailable = false

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
    forceVoiceOff()
  })
  /* Fires on the first load and on every reload after it, which makes it the one place that means
     "the renderer is new": it has no voice mode yet, so the listener must not still be in one. */
  chatWindow.webContents.on('did-finish-load', () => {
    voiceListening = false
    setVoiceListening(false)
    setVoiceMeter(false)
    void setLedStripSolidColor(0, 0, 0)
    pushVoiceStatus()
  })
  chatWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[chatWindow console:${level}] ${message} (${sourceId}:${line})`)
  })
  chatWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[chatWindow] render process gone:', details)
    forceVoiceOff()
  })

  chatWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      chatWindow?.webContents.toggleDevTools()
    }
  })

  loadRenderer(chatWindow, 'chat.html')

  return chatWindow
}

/* Dropped when there is no window: voice mode types into the composer, so with it gone there is
   nowhere for a wake word to land. Opening the window on hearing one would be a surprise rather
   than a convenience. */
function sendVoiceEvent(event: VoiceEvent): void {
  chatWindow?.webContents.send('voice:event', event)
}

function pushVoiceStatus(): void {
  sendVoiceEvent({ kind: 'status', listening: voiceListening, available: voiceAvailable })
}

/** Switches the listener off when the side that asked for it is no longer there to switch it off
    itself, and says so, so the renderer that comes back does not think it is still listening. */
function forceVoiceOff(): void {
  if (!voiceListening) return
  voiceListening = false
  setVoiceListening(false)
  setVoiceMeter(false)
  void setLedStripSolidColor(0, 0, 0)
  pushVoiceStatus()
}

function startWakeWord(): void {
  startWakeWordListener({
    onReady: () => {
      voiceAvailable = true
      pushVoiceStatus()
    },
    onWake: () => sendVoiceEvent({ kind: 'wake' }),
    onLevel: (db) => sendVoiceEvent({ kind: 'level', db }),
    onSegment: (text) => sendVoiceEvent({ kind: 'segment', text }),
    onSilence: () => sendVoiceEvent({ kind: 'silence' }),
    onExit: () => {
      voiceAvailable = false
      voiceListening = false
      void setLedStripSolidColor(0, 0, 0)
      pushVoiceStatus()
    }
  })
}

claudeEvents.on('event', (payload) => {
  chatWindow?.webContents.send('claude:event', payload)
  if (payload.event.type === 'result') schedulePush(payload.sessionId)
})

claudeEvents.on('status', (payload) => {
  chatWindow?.webContents.send('claude:status', payload)
  if (payload.status === 'idle') schedulePush(payload.sessionId)
})

claudeEvents.on('debug', (payload) => {
  chatWindow?.webContents.send('claude:debug', payload)
})

app.whenReady().then(() => {
  /* macOS routes Cmd+C/V/X/A/Z and Cmd+Q through the application menu, so removing it outright —
     which is the right move on Windows and Linux, where this window draws its own chrome — would
     leave the composer unable to paste. Keep the two roles that carry those shortcuts; the menu
     bar lives at the top of the screen there, so it costs the window nothing. */
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
  } else {
    Menu.setApplicationMenu(null)
  }

  /* Surfaced now rather than on the first send, where a missing binary would look like a chat
     that simply never answers. */
  try {
    assertClaudeExe()
  } catch (error) {
    console.error('[main]', error)
  }

  createChatWindow()
  startWakeWord()
  /* After, and unawaited: the mic and both models start on the defaults compiled into the listener,
     so a slow or unreachable Notion delays a threshold rather than the whole feature. */
  void fetchConfig()
    .then((config) => setVoiceConfig(config.voiceSilenceDb, config.voiceSilenceMs))
    .catch((error) => console.error('[wakeword] could not read voice settings:', error))

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

/* Only the chat window may steer the listener: it is the one that owns the mode, and a message
   from anywhere else would be setting a state nothing is showing. */
function fromChatWindow(event: IpcMainEvent): boolean {
  return chatWindow !== null && !chatWindow.isDestroyed() && event.sender === chatWindow.webContents
}

ipcMain.on('voice:setListening', (event: IpcMainEvent, on: boolean) => {
  if (!fromChatWindow(event)) return
  voiceListening = on
  setVoiceListening(on)
  /* The strip is driven from here rather than the renderer because the forced-off paths above run
     here too, and a listening light that only one of the two can turn off gets left on. */
  void setLedStripSolidColor(on ? 255 : 0, 0, 0)
})

ipcMain.on('voice:setMeter', (event: IpcMainEvent, on: boolean) => {
  if (!fromChatWindow(event)) return
  setVoiceMeter(on)
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
    /* Before the spawn: `ensureSession` picks `--resume` only if the transcript is on disk. */
    await pullTranscript(sessionId, true)
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

ipcMain.handle('claude:readContextTokens', async (_event, sessionId: string) => {
  try {
    await pullTranscript(sessionId)
    return readSessionContextTokens(sessionId)
  } catch (error) {
    console.error('[main] claude:readContextTokens failed:', error)
    return null
  }
})

ipcMain.handle('claude:readTranscript', async (_event, sessionId: string) => {
  try {
    await pullTranscript(sessionId)
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

ipcMain.handle('notion:getProjectContext', async (_event, projectId: string, excludeSessionId?: string) => {
  return fetchProjectContext(projectId, excludeSessionId)
})

ipcMain.handle('notion:getProjectVersion', async (_event, projectId: string, excludeSessionId?: string) => {
  return fetchProjectVersion(projectId, excludeSessionId)
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

ipcMain.handle('notion:removeContextPage', async (_event, parentId: string, pageId: string) => {
  await removeContextPage(parentId, pageId)
})

ipcMain.handle('notion:getPages', async () => {
  return fetchPages()
})

ipcMain.handle('notion:createPage', async (_event, title: string, text: string) => {
  return createPage(title, text)
})

ipcMain.handle('notion:linkContext', async (_event, parentId: string, targetIds: string[]) => {
  await linkContext(parentId, targetIds)
})

ipcMain.handle('notion:unlinkContext', async (_event, parentId: string, targetId: string) => {
  await unlinkContext(parentId, targetId)
})

ipcMain.handle('notion:getContextProjectMap', async () => {
  return fetchContextProjectMap()
})

ipcMain.handle('notion:migrateProjectMembership', async () => {
  return migrateProjectMembership()
})

ipcMain.handle('notion:createContextFolder', async (_event, projectId: string, name: string) => {
  return createContextFolder(projectId, name)
})

ipcMain.handle('notion:deleteContextFolder', async (_event, folderId: string) => {
  await deleteContextFolder(folderId)
})

ipcMain.handle('notion:moveContextPage', async (_event, pageId: string, fromId: string, toId: string) => {
  return moveContextPage(pageId, fromId, toId)
})

ipcMain.handle('notion:renameContextPage', async (_event, pageId: string, title: string) => {
  await renameContextPage(pageId, title)
})

ipcMain.handle('notion:renameContextFolder', async (_event, folderId: string, name: string) => {
  await renameContextFolder(folderId, name)
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

ipcMain.handle('notion:updatePersonAffiliation', async (_event, pageId: string, affiliation: string) => {
  await updatePersonAffiliation(pageId, affiliation)
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
  /* Reaches the running listener directly: a threshold is worth nothing until the thing measuring
     against it has been told, and it should not take a restart. */
  setVoiceConfig(config.voiceSilenceDb, config.voiceSilenceMs)
})
