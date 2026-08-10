import { LightingService } from './LightingService'
import { KeyboardController } from './KeyboardController'
import { MouseController } from './MouseController'
import { CorsairFanController } from './CorsairFanController'
import { StreamDeckController } from './StreamDeckController'
import { SacnController } from './SacnController'

interface DeviceHandle<T extends LightingService> {
    name: string
    promise: Promise<T | null> | null
    connect: () => Promise<T | null>
}

function createHandle<T extends LightingService>(name: string, connect: () => Promise<T | null>): DeviceHandle<T> {
    return { name, promise: null, connect }
}

const keyboard = createHandle('G915 X keyboard', () => KeyboardController.connect())
const mouse = createHandle('G502 HERO mouse', () => MouseController.connect())
const fans = createHandle('Corsair Lighting Node Core', () => CorsairFanController.connect())
const streamDeck = createHandle('Stream Deck', () => StreamDeckController.connect())
const sacn = createHandle('sACN LED strip', () => SacnController.connect())

const devices: DeviceHandle<LightingService>[] = [keyboard, mouse, fans, streamDeck, sacn]

function getDevice<T extends LightingService>(handle: DeviceHandle<T>): Promise<T | null> {
    if (!handle.promise) {
        handle.promise = handle.connect()
    }
    return handle.promise
}

async function applySolidColor(handle: DeviceHandle<LightingService>, r: number, g: number, b: number): Promise<void> {
    const device = await getDevice(handle)
    if (!device) {
        console.error(`No ${handle.name} found.`)
        handle.promise = null
        return
    }

    try {
        await device.setSolidColor(r, g, b)
    } catch (err) {
        console.error(`Failed on ${handle.name}: ${(err as Error).message}`)
        handle.promise = null
    }
}

export async function setAllDevicesSolidColor(r: number, g: number, b: number): Promise<void> {
    await Promise.all(devices.map((handle) => applySolidColor(handle, r, g, b)))
}

export async function setLedStripSolidColor(r: number, g: number, b: number): Promise<void> {
    await applySolidColor(sacn, r, g, b)
}

export function getStreamDeck(): Promise<StreamDeckController | null> {
    return getDevice(streamDeck)
}

export async function disconnectAllDevices(): Promise<void> {
    const instances = await Promise.all(devices.map((handle) => handle.promise ?? Promise.resolve(null)))
    for (const handle of devices) handle.promise = null
    await Promise.all(instances.map((device) => device?.disconnect()))
}
