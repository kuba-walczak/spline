import { app, BrowserWindow, ipcMain, IpcMainEvent, Menu, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { disconnectAllDevices, getStreamDeck, setAllDevicesSolidColor } from './services/DeviceManager'

let mainWindow: BrowserWindow

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
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
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
})

ipcMain.on('setIgnoreMouseEvents', (event: IpcMainEvent, ignore: boolean) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.setIgnoreMouseEvents(ignore, { forward: true })
})

ipcMain.handle('setRgbColor', async (_event, r: number, g: number, b: number) => {
  await setAllDevicesSolidColor(r, g, b)
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
