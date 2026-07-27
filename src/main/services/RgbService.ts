import { KeyboardController } from './KeyboardController'
import { MouseController } from './MouseController'

let keyboardPromise: Promise<KeyboardController | null> | null = null
let mousePromise: Promise<MouseController | null> | null = null

function getKeyboard(): Promise<KeyboardController | null> {
    if (!keyboardPromise) {
        keyboardPromise = KeyboardController.connect()
    }
    return keyboardPromise
}

function getMouse(): Promise<MouseController | null> {
    if (!mousePromise) {
        mousePromise = MouseController.connect()
    }
    return mousePromise
}

async function setKeyboardColor(r: number, g: number, b: number): Promise<void> {
    const keyboard = await getKeyboard()
    if (!keyboard) {
        console.error('No G915 X keyboard found.')
        keyboardPromise = null
        return
    }
    try {
        await keyboard.setColor(r, g, b)
    } catch (err) {
        console.error(`Failed on keyboard: ${(err as Error).message}`)
        keyboardPromise = null
    }
}

async function setMouseColor(r: number, g: number, b: number): Promise<void> {
    const mouse = await getMouse()
    if (!mouse) {
        console.error('No G502 HERO mouse found.')
        mousePromise = null
        return
    }
    try {
        await mouse.setColor(r, g, b)
    } catch (err) {
        console.error(`Failed on mouse: ${(err as Error).message}`)
        mousePromise = null
    }
}

export async function setRgbColor(r: number, g: number, b: number): Promise<void> {
    await Promise.all([setKeyboardColor(r, g, b), setMouseColor(r, g, b)])
}

export async function disconnectRgbDevices(): Promise<void> {
    const [keyboard, mouse] = await Promise.all([
        keyboardPromise ?? Promise.resolve(null),
        mousePromise ?? Promise.resolve(null)
    ])
    keyboardPromise = null
    mousePromise = null
    await Promise.all([keyboard?.disconnect(), mouse?.disconnect()])
}
