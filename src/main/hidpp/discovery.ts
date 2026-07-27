import * as HID from 'node-hid'
import { HidppDevice } from './HidppDevice'

export const LOGITECH_VID = 0x046d

export function listLogitechHidppInterfaces(): HID.Device[] {
    const all = HID.devices().filter(
        (d) => d.vendorId === LOGITECH_VID && d.usagePage === 0xff00
    )
    const long = all.filter((d) => d.usage === 2)
    return long.length > 0 ? long : all
}

export interface OpenedHidppDevice {
    hidDevice: HID.HIDAsync
    hidpp: HidppDevice
}

export async function openHidppDevice(productId: number, deviceIndex: number): Promise<OpenedHidppDevice | null> {
    const candidates = listLogitechHidppInterfaces()
    const info = candidates.find((d) => d.productId === productId && d.path)
    if (!info || !info.path) return null

    let hidDevice: HID.HIDAsync
    try {
        hidDevice = await HID.HIDAsync.open(info.path)
    } catch (e) {
        return null
    }

    return { hidDevice, hidpp: new HidppDevice(hidDevice, deviceIndex) }
}
