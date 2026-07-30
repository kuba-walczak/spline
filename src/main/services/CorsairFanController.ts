import * as HID from 'node-hid'
import { LightingService } from './LightingService'

const CORSAIR_VID = 0x1b1c
const LIGHTING_NODE_CORE_PID = 0x0c1a

const WRITE_PACKET_SIZE = 65

const PACKET_ID_DIRECT = 0x32
const PACKET_ID_COMMIT = 0x33
const PACKET_ID_PORT_STATE = 0x38
const PACKET_ID_BRIGHTNESS = 0x39

const CHANNEL_0 = 0x00
const PORT_STATE_SOFTWARE = 0x02

const DIRECT_CHANNEL_RED = 0x00
const DIRECT_CHANNEL_GREEN = 0x01
const DIRECT_CHANNEL_BLUE = 0x02

const DIRECT_MAX_LEDS_PER_PACKET = 50

// Lighting Node Core reverts to rainbow mode if it doesn't see a packet
// within ~20s of the last direct-mode update, so keep nudging it.
const KEEPALIVE_INTERVAL_MS = 5000

export class CorsairFanController implements LightingService {
    private keepaliveTimer: NodeJS.Timeout | null = null
    private softwareModeEnabled = false

    private constructor(private readonly dev: HID.HIDAsync, private readonly ledCount: number) {}

    static async connect(ledCount = 3 * 34): Promise<CorsairFanController | null> {
        const info = HID.devices().find(
            (d) => d.vendorId === CORSAIR_VID && d.productId === LIGHTING_NODE_CORE_PID && d.path
        )
        if (!info?.path) return null

        let dev: HID.HIDAsync
        try {
            dev = await HID.HIDAsync.open(info.path)
        } catch (e) {
            return null
        }

        const controller = new CorsairFanController(dev, ledCount)
        controller.keepaliveTimer = setInterval(() => void controller.sendCommit(), KEEPALIVE_INTERVAL_MS)
        return controller
    }

    async setSolidColor(r: number, g: number, b: number): Promise<void> {
        if (!this.softwareModeEnabled) {
            await this.sendPortState(PORT_STATE_SOFTWARE)
            this.softwareModeEnabled = true
        }

        let offset = 0
        let remaining = this.ledCount
        while (remaining > 0) {
            const count = Math.min(remaining, DIRECT_MAX_LEDS_PER_PACKET)

            await this.sendDirect(offset, count, DIRECT_CHANNEL_RED, new Array(count).fill(r))
            await this.sendDirect(offset, count, DIRECT_CHANNEL_GREEN, new Array(count).fill(g))
            await this.sendDirect(offset, count, DIRECT_CHANNEL_BLUE, new Array(count).fill(b))

            remaining -= count
            offset += count
        }

        await this.sendCommit()
    }

    async setBrightness(percentage: number): Promise<void> {
        const buf = Buffer.alloc(WRITE_PACKET_SIZE)
        buf[0x01] = PACKET_ID_BRIGHTNESS
        buf[0x02] = CHANNEL_0
        buf[0x03] = Math.min(100, Math.max(0, percentage))
        await this.dev.write(buf)
    }

    private async sendPortState(state: number): Promise<void> {
        const buf = Buffer.alloc(WRITE_PACKET_SIZE)
        buf[0x01] = PACKET_ID_PORT_STATE
        buf[0x02] = CHANNEL_0
        buf[0x03] = state
        await this.dev.write(buf)
    }

    private async sendDirect(start: number, count: number, colorChannel: number, colorData: number[]): Promise<void> {
        const buf = Buffer.alloc(WRITE_PACKET_SIZE)
        buf[0x01] = PACKET_ID_DIRECT
        buf[0x02] = CHANNEL_0
        buf[0x03] = start
        buf[0x04] = count
        buf[0x05] = colorChannel
        Buffer.from(colorData).copy(buf, 0x06)
        await this.dev.write(buf)
    }

    private async sendCommit(): Promise<void> {
        const buf = Buffer.alloc(WRITE_PACKET_SIZE)
        buf[0x01] = PACKET_ID_COMMIT
        buf[0x02] = 0xff
        await this.dev.write(buf)
    }

    async disconnect(): Promise<void> {
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer)
            this.keepaliveTimer = null
        }
        await this.dev.close()
    }
}
